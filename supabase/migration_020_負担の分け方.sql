-- 暮らし帳 追加分20:ふたりの支出の「負担の分け方」と「返してもらった額」
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です(自動で反映する仕組みを入れたあとは、GitHubに上げるだけで流れます)。
--
-- split の書き方
--   'equal'             … 割り勘(人数で等分)。空(null)も割り勘として扱う
--   'u:<人の番号>:70'    … その人が 70% を負担し、残りをほかの人で等分する(100 ならその人のおごり)
--   'y:<人の番号>:820'   … その人が 820円 を負担し、残りをほかの人で等分する
--   'deal'              … 話して決めた額で済ませる。ほかの人の負担は「返してもらった額」だけで、残りは払った人の負担(精算に差が出ない)
-- 予算(budgets)の split は、その分類の「負担のめやす」。記録に分け方が入っていないときの初めの値になる
-- repaid_amount は、払った人がほかの人からその場で返してもらった額。月の精算でその分を差し引く

alter table transactions add column if not exists split text;
alter table transactions add column if not exists repaid_amount int;
alter table budgets add column if not exists split text;

do $$ begin
  alter table transactions drop constraint if exists transactions_split_check;
  alter table transactions add constraint transactions_split_check
    check (split is null or split in ('equal', 'deal') or split ~ '^u:[0-9a-f-]{36}:(100|[1-9]?[0-9])$' or split ~ '^y:[0-9a-f-]{36}:[0-9]{1,9}$');
  alter table transactions drop constraint if exists transactions_repaid_check;
  alter table transactions add constraint transactions_repaid_check check (repaid_amount is null or (repaid_amount >= 0 and repaid_amount <= amount));
  alter table budgets drop constraint if exists budgets_split_check;
  alter table budgets add constraint budgets_split_check
    check (split is null or split = 'equal' or split ~ '^u:[0-9a-f-]{36}:(100|[1-9]?[0-9])$');
end $$;

-- 分け方を入れずに記録したふたりの支出(固定費の自動記録・カードやレシートのまとめ記録など)は、分類の負担のめやすを入れる
create or replace function tx_default_split() returns trigger language plpgsql as $$
begin
  if new.split is null and new.scope = 'shared' and coalesce(new.kind, 'expense') <> 'income' then
    select b.split into new.split from budgets b where b.household_id = new.household_id and b.category = new.category;
  end if;
  return new;
end $$;
drop trigger if exists tx_default_split on transactions;
create trigger tx_default_split before insert on transactions for each row execute function tx_default_split();
