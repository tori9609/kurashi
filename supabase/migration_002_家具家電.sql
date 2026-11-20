-- 2026-11-20 第3段階(家計簿)のための追加。分類に「家具・家電」を足す(日用品と分けるため)
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる
alter table transactions drop constraint if exists transactions_category_check;
alter table transactions add constraint transactions_category_check
  check (category in ('住居','食費','外食','日用品','家具・家電','光熱費','通信','交通','趣味','その他'));
