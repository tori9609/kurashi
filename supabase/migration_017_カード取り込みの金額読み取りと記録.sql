-- 暮らし帳 追加分17:ウォレットの取り込みで金額を読めなかったときも、お店と日時を残す(届いた値も記録して原因を見られるようにする)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。

-- 金額を読めなかった支払い(本人だけが見られる)
create table if not exists card_misses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  card text, merchant text,
  amount_raw text,            -- ショートカットから届いた金額の値(そのまま)
  used_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);
alter table card_misses enable row level security;
drop policy if exists card_misses_own on card_misses;
create policy card_misses_own on card_misses for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
grant select, delete on card_misses to authenticated;

-- 取り込み:全角の数字・「円」・小数点つき(1200.00)・前後の記号も読む。読めないときは card_misses に残して、理由を返す
create or replace function card_inbox_add(p_token text, p_card text, p_merchant text, p_amount text,
  p_used_at text default null, p_source text default 'wallet', p_ext_id text default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; a int; ts timestamptz; src text; other uuid; newid uuid; v text; digits text;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  begin ts := nullif(p_used_at, '')::timestamptz; exception when others then ts := null; end;
  ts := coalesce(ts, now());

  v := translate(coalesce(p_amount, ''), '０１２３４５６７８９．，', '0123456789.,');
  digits := regexp_replace(split_part(v, '.', 1), '[^0-9]', '', 'g');
  if length(digits) between 1 and 9 then a := digits::int; end if;
  if a is null or a <= 0 then
    insert into card_misses(household_id, owner, card, merchant, amount_raw, used_at, reason)
      values (h, u, left(p_card, 60), left(p_merchant, 80), left(coalesce(p_amount, '(空)'), 100), ts, '金額を読み取れません');
    return '金額を読み取れません(届いた値:「' || left(coalesce(nullif(p_amount, ''), '空'), 40) || '」)。お店と日時は暮らし帳の家計簿に残しました';
  end if;
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

notify pgrst, 'reload schema';
