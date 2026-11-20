-- 2026-11-21 カード利用メール(Gmail)からの取り込みと、ウォレットとの重複よけ
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる

alter table card_inbox add column if not exists ext_id text;      -- メールの識別番号(同じメールを2回入れない)
alter table card_inbox add column if not exists pair_id uuid;     -- ウォレットとメールで同じ支払いと分かった相手
create unique index if not exists card_inbox_ext_id on card_inbox(owner, ext_id) where ext_id is not null;

-- 前の版(引数5つ)を消して、引数を足した版にする。ショートカットからの呼び方はそのままで動く
drop function if exists card_inbox_add(text, text, text, text, text);
create or replace function card_inbox_add(p_token text, p_card text, p_merchant text, p_amount text,
  p_used_at text default null, p_source text default 'wallet', p_ext_id text default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; a int; ts timestamptz; src text; other uuid; newid uuid;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  a := nullif(regexp_replace(split_part(coalesce(p_amount, ''), '.', 1), '[^0-9]', '', 'g'), '')::int;
  if a is null or a <= 0 then raise exception '金額を読み取れません: %', p_amount; end if;
  begin ts := nullif(p_used_at, '')::timestamptz; exception when others then ts := null; end;
  ts := coalesce(ts, now());
  src := case when p_source in ('wallet', 'email') then p_source else 'wallet' end;

  -- 同じメールはもう入っている
  if p_ext_id is not null and exists (select 1 from card_inbox where owner = u and ext_id = p_ext_id) then return 'dup'; end if;

  -- ウォレットとメールの両方から同じ支払いが届いたら、2件目は入れない(同じ日・同じ金額で、まだ相手がいないもの)
  select id into other from card_inbox
   where owner = u and source <> src and pair_id is null and amount = a
     and (used_at at time zone 'Asia/Tokyo')::date = (ts at time zone 'Asia/Tokyo')::date
   order by created_at limit 1;
  if other is not null then
    update card_inbox set pair_id = other, ext_id = coalesce(ext_id, p_ext_id) where id = other;
    return 'dup';
  end if;

  insert into card_inbox(household_id, owner, card, merchant, amount, used_at, source, ext_id)
    values (h, u, left(p_card, 60), left(p_merchant, 80), a, ts, src, p_ext_id) returning id into newid;
  return 'ok';
end $$;

revoke all on function card_inbox_add(text, text, text, text, text, text, text) from public;
grant execute on function card_inbox_add(text, text, text, text, text, text, text) to anon, authenticated;
