-- 暮らし帳 追加分8:固定費の見せる範囲と、カード利用との突き合わせ
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。

-- 1. 固定費に「見せる範囲」と「持ち主」を足す(これまでの分は、払う人を持ち主にする)
alter table fixed_costs add column if not exists scope text not null default 'shared';
alter table fixed_costs add column if not exists owner uuid references auth.users(id) default auth.uid();
update fixed_costs set owner = paid_by where owner is null;
alter table fixed_costs alter column owner set not null;
do $$ begin
  alter table fixed_costs add constraint fixed_costs_scope_check check (scope in ('shared', 'private'));
exception when duplicate_object then null; end $$;

-- 2. 「自分だけ」の固定費は本人以外に見せない
drop policy if exists member_all on fixed_costs;
drop policy if exists fx_rw on fixed_costs;
create policy fx_rw on fixed_costs for all
  using (is_member(household_id) and (scope = 'shared' or owner = auth.uid()))
  with check (is_member(household_id) and (scope = 'shared' or owner = auth.uid()));

-- 3. カード利用の確認待ち:固定費で記録済みと判断したもの(fixed)と、その取り消し(nofix)
alter table card_inbox add column if not exists fixed_cost_id uuid references fixed_costs(id) on delete set null;
alter table card_inbox add column if not exists nofix boolean not null default false;
alter table card_inbox drop constraint if exists card_inbox_status_check;
alter table card_inbox add constraint card_inbox_status_check check (status in ('new', 'recorded', 'ignored', 'fixed'));

notify pgrst, 'reload schema';
