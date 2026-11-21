-- 暮らし帳 追加分18:アプリの「状態チェック」と、SQLの版・バックアップの記録
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。
-- これ以降は、GitHubに上げると自動で反映する仕組み(.github/workflows/deploy.yml)が、この版を見て新しいSQLだけを流します。

-- SQLの版(どこまで実行したか)
create table if not exists app_meta (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table app_meta enable row level security;
drop policy if exists app_meta_read on app_meta;
create policy app_meta_read on app_meta for select to authenticated using (true);
grant select on app_meta to authenticated;
insert into app_meta(key, value) values ('schema_version', '18')
  on conflict (key) do update set value = greatest(app_meta.value::int, 18)::text, updated_at = now();

-- 最後にPCへバックアップした日時
alter table backup_tokens add column if not exists last_used_at timestamptz;

-- バックアップの書き出し(13と同じ中身。書き出した日時を記録するようにした)
create or replace function backup_dump(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid;
begin
  select user_id into u from backup_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  update backup_tokens set last_used_at = now() where user_id = u;
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

-- 状態チェック:ログインしている本人の準備の具合をまとめて返す(鍵そのものは返さない)
create or replace function app_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h uuid; jobs jsonb := null;
begin
  if u is null then raise exception 'ログインが必要です'; end if;
  select household_id into h from members where user_id = u limit 1;
  begin
    if to_regclass('cron.job') is not null then execute 'select coalesce(jsonb_agg(jobname order by jobname), ''[]'') from cron.job' into jobs; end if;
  exception when others then jobs := null;
  end;
  return jsonb_build_object(
    'schema_version', (select value::int from app_meta where key = 'schema_version'),
    'members',        (select count(*) from members where household_id = h),
    'push_subs',      (select count(*) from push_subs where user_id = u),
    'widget_token',   exists (select 1 from widget_tokens where user_id = u),
    'card_token',     exists (select 1 from card_tokens where user_id = u),
    'backup_token',   exists (select 1 from backup_tokens where user_id = u),
    'backup_last',    (select last_used_at from backup_tokens where user_id = u),
    'card_last',      (select max(created_at) from card_inbox where owner = u),
    'card_misses',    (select count(*) from card_misses where owner = u),
    'cron',           jobs
  );
end $$;
revoke all on function app_status() from public;
grant execute on function app_status() to authenticated;

notify pgrst, 'reload schema';
