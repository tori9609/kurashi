-- 2026-11-20 カード利用の取り込み(iPhoneのショートカット → 受け箱 → アプリで確認して家計簿へ)
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる

-- 受け箱:カードを使った本人だけが見える(相手には見えない)
create table if not exists card_inbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  card text,
  merchant text,
  amount int not null check (amount > 0),
  used_at timestamptz not null default now(),
  source text not null default 'wallet',
  status text not null default 'new' check (status in ('new','recorded','ignored')),
  created_at timestamptz not null default now()
);
alter table card_inbox enable row level security;
drop policy if exists inbox_own on card_inbox;
create policy inbox_own on card_inbox for all
  using (owner = auth.uid() and is_member(household_id))
  with check (owner = auth.uid() and is_member(household_id));
grant select, insert, update, delete on card_inbox to authenticated;

-- ショートカット用の鍵(人ごとに1つ)。表は直接読めず、下の関数からだけ使う
create table if not exists card_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table card_tokens enable row level security;

-- 自分の鍵を出す(p_renew = true で作り直す。古い鍵は使えなくなる)
create or replace function card_token(p_renew boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if not p_renew then
    select token into t from card_tokens where user_id = auth.uid();
    if t is not null then return t; end if;
  end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into card_tokens(user_id, token) values (auth.uid(), t)
    on conflict (user_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;

-- ショートカットから呼ぶ:鍵で本人を確かめて、受け箱に1件入れる
-- 金額は「¥1,280」「1,280円」「1280.00」などでも数字だけを読む
create or replace function card_inbox_add(p_token text, p_card text, p_merchant text, p_amount text, p_used_at text default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; a int; ts timestamptz;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  a := nullif(regexp_replace(split_part(coalesce(p_amount, ''), '.', 1), '[^0-9]', '', 'g'), '')::int;
  if a is null or a <= 0 then raise exception '金額を読み取れません: %', p_amount; end if;
  begin ts := nullif(p_used_at, '')::timestamptz; exception when others then ts := null; end;
  insert into card_inbox(household_id, owner, card, merchant, amount, used_at)
    values (h, u, left(p_card, 60), left(p_merchant, 80), a, coalesce(ts, now()));
  return 'ok';
end $$;

revoke all on function card_inbox_add(text, text, text, text, text) from public;
grant execute on function card_inbox_add(text, text, text, text, text) to anon, authenticated;
revoke all on function card_token(boolean) from public;
grant execute on function card_token(boolean) to authenticated;

-- 受け箱に入ったら、開いているアプリにすぐ反映する
do $$ begin
  execute 'alter publication supabase_realtime add table card_inbox';
exception when duplicate_object then null; end $$;
