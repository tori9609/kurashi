-- 暮らし帳 追加分11:買い物の候補ボタン(よく買う物を上に・自分でボタンを固定・候補から外す)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。
alter table item_names add column if not exists pinned boolean not null default false;   -- ★ いつもボタンに出す
alter table item_names add column if not exists hidden boolean not null default false;   -- 候補から外した
notify pgrst, 'reload schema';
