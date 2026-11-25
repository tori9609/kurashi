-- 2026-11-25 分類に「美容」「医療」を足す。分類を自分で足せるようにする(ふたりで同じ一覧)
-- 何回実行しても同じ結果になる

-- 分類の名前は決まった一覧から選ぶ決まりだったので、自由な名前(1〜12文字)にゆるめる
alter table transactions drop constraint if exists transactions_category_check;
alter table transactions add constraint transactions_category_check check (char_length(category) between 1 and 20);

-- 自分で足した分類(暮らしごとに1つの一覧。kind は expense=支出、income=収入)
create table if not exists categories (
  household_id uuid not null references households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 12),
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (household_id, name)
);
alter table categories enable row level security;
drop policy if exists categories_rw on categories;
create policy categories_rw on categories for all using (is_member(household_id)) with check (is_member(household_id));
grant all on categories to authenticated;

notify pgrst, 'reload schema';
