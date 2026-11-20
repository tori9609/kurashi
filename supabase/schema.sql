-- ふたりの暮らし帳：データベースの設計図（Supabase の SQL Editor に貼って一度だけ実行する）
-- 第1〜4段階で使う表をまとめて作る。何度実行しても壊れないように書いてある。

-- ========== 暮らし帳とメンバー ==========
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'ふたりの暮らし帳',
  invite_code text unique,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  color text not null default '#0A5BD3',
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- 「この人はこの暮らし帳のメンバーか」を調べる関数（権限チェックで使う）
create or replace function is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid());
$$;

-- ========== 第1段階：買い物リスト・お知らせ ==========
create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  qty int not null default 1 check (qty between 1 and 99),
  urgent boolean not null default false,
  added_by uuid not null default auth.uid() references auth.users(id),
  done boolean not null default false,
  done_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists item_names (   -- 入力候補（一度入れた品物）
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  uses int not null default 1,
  last_used timestamptz not null default now(),
  primary key (household_id, name)
);

create table if not exists activities (   -- お知らせ一覧
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now()
);

-- ========== 第2段階：カレンダー・家事 ==========
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  time time,                        -- null なら終日
  title text not null check (char_length(title) between 1 and 80),
  for_user uuid references auth.users(id),   -- null なら「ふたり」
  is_private boolean not null default false, -- true なら作った本人だけ見える
  repeat_rule text,                 -- 例 'weekly:2,5'（火・金）/ 'monthly:14'
  remind text not null default 'none' check (remind in ('none','morning','day_before')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists event_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create table if not exists chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  assignee uuid references auth.users(id),
  freq text not null default 'weekly' check (freq in ('daily','weekly','monthly','once')),
  weekdays text,                    -- 例 '2,5'
  last_done date,
  created_at timestamptz not null default now()
);

-- ========== 第3段階：家計簿 ==========
create table if not exists fixed_costs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  amount int not null check (amount > 0),
  category text not null,
  paid_by uuid not null references auth.users(id),
  active boolean not null default true
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date date not null default current_date,
  amount int not null check (amount > 0 and amount < 100000000),
  shop text,
  category text not null check (category in ('住居','食費','外食','日用品','家具・家電','光熱費','通信','交通','趣味','その他')),
  paid_by uuid not null references auth.users(id),
  scope text not null default 'shared' check (scope in ('shared','private')),
  owner uuid not null default auth.uid() references auth.users(id),
  fixed_cost_id uuid references fixed_costs(id) on delete set null,
  month text,                       -- 固定費の二重記録を防ぐための 'YYYY-MM'
  created_at timestamptz not null default now(),
  unique (fixed_cost_id, month)
);

create table if not exists budgets (
  household_id uuid not null references households(id) on delete cascade,
  category text not null,
  amount int not null check (amount >= 0),
  primary key (household_id, category)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  target int not null check (target > 0),
  saved int not null default 0 check (saved >= 0)
);

create table if not exists settlements (
  household_id uuid not null references households(id) on delete cascade,
  month text not null,
  settled_at timestamptz not null default now(),
  settled_by uuid not null default auth.uid() references auth.users(id),
  primary key (household_id, month)
);

-- ========== 権限（RLS）：メンバー以外は何も見えない ==========
alter table households enable row level security;
alter table members enable row level security;
do $$ declare t text; begin
  foreach t in array array['shopping_items','item_names','activities','events','event_comments','chores','fixed_costs','transactions','budgets','goals','settlements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists member_all on %I', t);
    execute format('create policy member_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t);
  end loop;
end $$;

-- 「自分だけ」の予定と支出は本人以外に見せない（上の共通ルールを上書き）
drop policy if exists member_all on events;
drop policy if exists events_rw on events;
create policy events_rw on events for all
  using (is_member(household_id) and (not is_private or created_by = auth.uid()))
  with check (is_member(household_id) and (not is_private or created_by = auth.uid()));

drop policy if exists member_all on transactions;
drop policy if exists tx_rw on transactions;
create policy tx_rw on transactions for all
  using (is_member(household_id) and (scope = 'shared' or owner = auth.uid()))
  with check (is_member(household_id) and (scope = 'shared' or owner = auth.uid()));

drop policy if exists hh_read on households;
create policy hh_read on households for select using (is_member(id));
drop policy if exists mem_read on members;
create policy mem_read on members for select using (is_member(household_id));
drop policy if exists mem_update_self on members;
create policy mem_update_self on members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ========== 作成・招待・参加（安全のため関数を通して行う） ==========
create or replace function new_code() returns text language sql as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

create or replace function create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'すでに暮らし帳に参加しています'; end if;
  insert into households(name, invite_code, invite_expires_at)
    values (coalesce(nullif(trim(p_name),''),'ふたりの暮らし帳'), new_code(), now() + interval '7 days') returning id into h;
  insert into members(household_id, user_id, display_name, color, is_admin)
    values (h, auth.uid(), left(trim(p_display_name),20), '#0A5BD3', true);
  return h;
end $$;

create or replace function join_household(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid; n int; colors text[] := array['#0A5BD3','#E07A1F','#7A4FD6','#C2410C','#0E7490'];
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'すでに暮らし帳に参加しています'; end if;
  select id into h from households where invite_code = upper(trim(p_code)) and invite_expires_at > now();
  if h is null then raise exception '招待コードが正しくないか、期限が切れています'; end if;
  select count(*) into n from members where household_id = h;
  if n >= 5 then raise exception 'メンバーは5人までです'; end if;
  insert into members(household_id, user_id, display_name, color, is_admin)
    values (h, auth.uid(), left(trim(p_display_name),20), colors[n+1], false);
  insert into activities(household_id, user_id, message) values (h, auth.uid(), left(trim(p_display_name),20) || 'さんが参加しました');
  return h;
end $$;

create or replace function renew_invite(h uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from members where household_id = h and user_id = auth.uid() and is_admin) then
    raise exception '招待できるのは管理者だけです'; end if;
  c := new_code();
  update households set invite_code = c, invite_expires_at = now() + interval '7 days' where id = h;
  return c;
end $$;

grant execute on function create_household(text,text), join_household(text,text), renew_invite(uuid) to authenticated;

-- ========== 相手の変更をすぐ画面に反映する（Realtime） ==========
do $$ declare t text; begin
  foreach t in array array['shopping_items','activities','events','event_comments','chores','transactions'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- 2026-11-20 追加:ログインした人が表を読み書きできるよう、API の権限を明示する
-- (Supabase の新しいプロジェクトでは、表の作成時に自動で権限が付かない設定があるため。中身は RLS で本人たちの分だけに絞られる)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
