-- 暮らし帳 追加分19:カード会社の「お支払金額のお知らせ」メール(セゾンなど)を取り込み、引き落とし予定として見る
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です(自動で反映する仕組みを入れたあとは、GitHubに上げるだけで流れます)。
-- 引き落としの金額は「使った分の合計」なので、家計簿の支出には入れません(入れると、使った分と二重になるため)。

create table if not exists card_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  card text not null,
  pay_date date not null,          -- お支払日(引き落とし日)
  prepare_date date,               -- 口座へのご準備期日
  amount int not null check (amount >= 0),
  ext_id text,                     -- メールの番号
  event_id uuid,                   -- カレンダーに入れた「自分だけ」の予定
  created_at timestamptz not null default now(),
  unique (owner, card, pay_date)
);
alter table card_bills enable row level security;
drop policy if exists card_bills_own on card_bills;
create policy card_bills_own on card_bills for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
grant select, delete on card_bills to authenticated;

-- 取り込み(カード利用と同じ「③ 取り込み用の鍵」を使う)。同じカード・同じお支払日は1件にまとめ、金額が変われば直す
create or replace function card_bill_add(p_token text, p_card text, p_amount text, p_pay_date text,
  p_prepare_date text default null, p_ext_id text default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; a int; pd date; pr date; v text; digits text; old card_bills; ev uuid; ttl text;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  v := translate(coalesce(p_amount, ''), '０１２３４５６７８９．，', '0123456789.,');
  digits := regexp_replace(split_part(v, '.', 1), '[^0-9]', '', 'g');
  if length(digits) between 1 and 9 then a := digits::int; end if;
  if a is null then raise exception '金額を読み取れません: %', p_amount; end if;
  begin pd := p_pay_date::date; exception when others then raise exception 'お支払日を読み取れません: %', p_pay_date; end;
  begin pr := nullif(p_prepare_date, '')::date; exception when others then pr := null; end;
  ttl := '【引き落とし】' || left(coalesce(nullif(p_card, ''), 'カード'), 40) || ' ' || to_char(a, 'FM999,999,999') || '円';

  select * into old from card_bills where owner = u and card = left(coalesce(nullif(p_card, ''), 'カード'), 60) and pay_date = pd;
  if found then
    if old.amount <> a then
      update card_bills set amount = a, prepare_date = coalesce(pr, prepare_date) where id = old.id;
      update events set title = ttl where id = old.event_id;
      return 'updated';
    end if;
    return 'dup';
  end if;
  if a = 0 then return 'zero'; end if;   -- 支払いがない月は入れない
  insert into events(household_id, date, title, is_private, created_by, source)
    values (h, coalesce(pr, pd - 1), ttl, true, u, 'app') returning id into ev;
  insert into card_bills(household_id, owner, card, pay_date, prepare_date, amount, ext_id, event_id)
    values (h, u, left(coalesce(nullif(p_card, ''), 'カード'), 60), pd, pr, a, p_ext_id, ev);
  return 'ok';
end $$;
revoke all on function card_bill_add(text, text, text, text, text, text) from public;
grant execute on function card_bill_add(text, text, text, text, text, text) to anon, authenticated;

insert into app_meta(key, value) values ('schema_version', '19')
  on conflict (key) do update set value = greatest(app_meta.value::int, 19)::text, updated_at = now();
notify pgrst, 'reload schema';
