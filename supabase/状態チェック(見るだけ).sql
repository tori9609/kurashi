-- 暮らし帳:データベースに、どの追加分(migration)まで入っているかを確かめる。見るだけで、何も変えません。
-- SQL Editor に貼り付けて Run。結果の表で「×」の行が、まだ流れていない追加分です。
with c(no, name, ok) as (values
  (3,  'カード利用の取り込み',           to_regclass('public.card_inbox') is not null),
  (4,  'メールの取り込みと重複よけ',     exists(select 1 from information_schema.columns where table_name='card_inbox' and column_name='ext_id')),
  (5,  'カレンダーの取り込み',           exists(select 1 from information_schema.columns where table_name='events' and column_name='source')),
  (6,  'iPhoneカレンダーの取り込み',     exists(select 1 from information_schema.columns where table_name='events' and column_name='synced_at')),
  (7,  'レシートの読み込み',             exists(select 1 from information_schema.columns where table_name='transactions' and column_name='items')),
  (8,  '固定費の見せる範囲',             exists(select 1 from information_schema.columns where table_name='fixed_costs' and column_name='scope')),
  (9,  'ウィジェット',                   to_regclass('public.widget_tokens') is not null),
  (10, 'やることリスト',                 exists(select 1 from information_schema.columns where table_name='chores' and column_name='due')),
  (11, '買い物の候補',                   exists(select 1 from information_schema.columns where table_name='item_names' and column_name='pinned')),
  (12, '通知',                           to_regclass('public.push_subs') is not null),
  (13, 'ゴミ箱・くり返し・バックアップ', exists(select 1 from information_schema.columns where table_name='transactions' and column_name='deleted_at')),
  (14, '固定費の支払日・収入・写真',     exists(select 1 from information_schema.columns where table_name='transactions' and column_name='kind')),
  (15, 'お店の分類・あと使える額',       to_regclass('public.shop_categories') is not null),
  (16, '固定費の年払い・買い時',         exists(select 1 from information_schema.columns where table_name='fixed_costs' and column_name='cycle')),
  (17, 'カード取り込みの記録',           to_regclass('public.card_misses') is not null),
  (18, '状態チェック・バックアップ記録', to_regclass('public.app_meta') is not null),
  (19, 'カードの引き落とし予定',         to_regclass('public.card_bills') is not null),
  (20, '負担の分け方',                   exists(select 1 from information_schema.columns where table_name='transactions' and column_name='split')))
select no as "番号", name as "内容", case when ok then '○' else '×' end as "入っているか" from c order by no;
