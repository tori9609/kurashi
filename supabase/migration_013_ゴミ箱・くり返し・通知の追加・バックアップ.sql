-- 暮らし帳 追加分13:ゴミ箱(7日間)・くり返し予定の「この日だけ」・予定ごとのお知らせ・予算の通知・PCへのバックアップ
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。012 のあとに実行してください。

-- ========== 1. ゴミ箱:消しても7日間は戻せる ==========
alter table events       add column if not exists deleted_at timestamptz;
alter table chores       add column if not exists deleted_at timestamptz;
alter table transactions add column if not exists deleted_at timestamptz;
alter table fixed_costs  add column if not exists deleted_at timestamptz;
alter table goals        add column if not exists deleted_at timestamptz;
-- 7日を過ぎたものを、毎日3時ごろ(日本時間)に本当に消す
select cron.unschedule(jobid) from cron.job where jobname = 'kurashi-trash';
select cron.schedule('kurashi-trash', '17 18 * * *', $job$
  delete from public.events       where deleted_at < now() - interval '7 days';
  delete from public.chores       where deleted_at < now() - interval '7 days';
  delete from public.transactions where deleted_at < now() - interval '7 days';
  delete from public.fixed_costs  where deleted_at < now() - interval '7 days';
  delete from public.goals        where deleted_at < now() - interval '7 days';
$job$);

-- ========== 2. くり返し予定の「この日だけ休み」 ==========
alter table events add column if not exists exdates date[] not null default '{}';
-- 「この日だけ変更」で作った1回分が、どのくり返しから来たか
alter table events add column if not exists series_id uuid references events(id) on delete set null;

-- ========== 3. 予定ごとのお知らせ(何分前か。null はなし) ==========
alter table events add column if not exists remind_min int check (remind_min is null or remind_min between 0 and 2880);

-- ========== 4. 通知の種類を2つ増やす ==========
alter table notify_prefs add column if not exists remind boolean not null default true;   -- F 予定ごとのお知らせ
alter table notify_prefs add column if not exists budget boolean not null default true;   -- G 予算の8割・超えたとき

-- 予算:ふたりの支出が、分類ごとの予算の8割・10割を超えたら、メンバー全員へ(月に1回ずつ)
create or replace function q_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare m0 date; b int; total int; lvl int; who uuid; mem record; tag text;
begin
  if new.scope <> 'shared' or new.deleted_at is not null then return new; end if;
  select amount into b from budgets where household_id = new.household_id and category = new.category;
  if b is null or b <= 0 then return new; end if;
  m0 := date_trunc('month', new.date)::date;
  select coalesce(sum(amount), 0) into total from transactions
   where household_id = new.household_id and category = new.category and scope = 'shared' and deleted_at is null
     and date >= m0 and date < (m0 + interval '1 month')::date;
  lvl := case when total >= b then 100 when total * 10 >= b * 8 then 80 else 0 end;
  if lvl = 0 then return new; end if;
  for mem in select m.user_id from members m left join notify_prefs p on p.user_id = m.user_id
              where m.household_id = new.household_id and coalesce(p.budget, true) loop
    tag := 'budget' || lvl || ':' || new.category;
    insert into push_log(user_id, kind, day) values (mem.user_id, tag, m0) on conflict do nothing;
    if found then
      insert into notify_queue(user_id, kind, title, body, url) values (mem.user_id, 'budget',
        case when lvl = 100 then '💴 予算を超えました' else '💴 予算の8割を使いました' end,
        to_char(new.date, 'FMMM') || '月の' || new.category || ':' || to_char(total, 'FM999,999,999') || '円 / 予算 ' || to_char(b, 'FM999,999,999') || '円',
        '#kakeibo');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists q_budget on transactions;
create trigger q_budget after insert or update of amount, category, scope, date, deleted_at on transactions for each row execute function q_budget();

-- ========== 5. PCへのバックアップ(読むだけの鍵) ==========
create table if not exists backup_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table backup_tokens enable row level security;
create or replace function backup_token(p_renew boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if not p_renew then
    select token into t from backup_tokens where user_id = auth.uid();
    if t is not null then return t; end if;
  end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into backup_tokens(user_id, token) values (auth.uid(), t)
    on conflict (user_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;
revoke all on function backup_token(boolean) from public;
grant execute on function backup_token(boolean) to authenticated;

-- 鍵の持ち主に見えるものを、ゴミ箱の中も含めて全部書き出す(相手の「自分だけ」は入らない)
create or replace function backup_dump(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid;
begin
  select user_id into u from backup_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  return jsonb_build_object(
    'version', 1, 'exported_at', now(), 'user_id', u, 'household_id', h,
    'members',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.joined_at), '[]') from members x where x.household_id = h),
    'events',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.date), '[]') from events x where x.household_id = h and (not x.is_private or x.created_by = u)),
    'event_comments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from event_comments x join events e on e.id = x.event_id
                        where x.household_id = h and (not e.is_private or e.created_by = u)),
    'chores',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from chores x where x.household_id = h and (not x.is_private or x.created_by = u)),
    'shopping_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from shopping_items x where x.household_id = h),
    'item_names',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from item_names x where x.household_id = h),
    'transactions',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.date), '[]') from transactions x where x.household_id = h and (x.scope = 'shared' or x.owner = u)),
    'fixed_costs',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from fixed_costs x where x.household_id = h and (x.scope = 'shared' or x.owner = u)),
    'budgets',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from budgets x where x.household_id = h),
    'goals',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from goals x where x.household_id = h),
    'settlements',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from settlements x where x.household_id = h),
    'card_inbox',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.used_at), '[]') from card_inbox x where x.owner = u),
    'activities',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from (select * from activities where household_id = h order by created_at desc limit 500) x)
  );
end $$;
revoke all on function backup_dump(text) from public;
grant execute on function backup_dump(text) to anon, authenticated;

notify pgrst, 'reload schema';
