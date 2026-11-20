-- 暮らし帳 追加分12:iPhoneへの通知(Web Push)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。
-- 先に Edge Function「push」を置いておくと、すぐに動き始めます(置く前に実行しても問題ありません)。

-- 1分ごとに通知係(Edge Function「push」)を呼ぶための仕組み
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- 通知の設定(鍵はこの表の中だけ。だれも直接は読めず、通知係だけが読む)
create table if not exists push_config (
  id int primary key default 1 check (id = 1),
  public_key text,          -- 通知用の公開鍵(通知係が初めて動いたときに作る)
  private_jwk jsonb,        -- 通知用の秘密鍵
  cron_secret text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
insert into push_config(id) values (1) on conflict do nothing;
alter table push_config enable row level security;

-- 端末ごとの「通知を受け取る」登録
create table if not exists push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);
alter table push_subs enable row level security;
drop policy if exists push_subs_own on push_subs;
create policy push_subs_own on push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 人ごとの「何を通知するか」(行がなければ全部オン)
create table if not exists notify_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  partner boolean not null default true,   -- A 相手が追加・変更したとき
  urgent  boolean not null default true,   -- B 買い物に「急ぎ」が付いたとき
  todo    boolean not null default true,   -- C やることの期限(朝7時)
  events  boolean not null default true,   -- D 予定(前日20時・当日朝7時)
  card    boolean not null default true,   -- E カード利用の確認待ち(20時)
  updated_at timestamptz not null default now()
);
alter table notify_prefs enable row level security;
drop policy if exists notify_prefs_own on notify_prefs;
create policy notify_prefs_own on notify_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 送る前の通知と、朝・夜のまとめを送った記録(だれも直接は読めない)
create table if not exists notify_queue (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  url text not null default '#home',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notify_queue_unsent on notify_queue (created_at) where sent_at is null;
alter table notify_queue enable row level security;
create table if not exists push_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  day date not null,
  primary key (user_id, kind, day)
);
alter table push_log enable row level security;

-- A:お知らせ(activities)に1行入ったら、本人以外のメンバーへ
create or replace function q_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notify_queue(user_id, kind, title, body, url)
  select m.user_id, 'partner', '暮らし帳', new.message,
         case when new.message like '%買い物%' then '#shopping' when new.message like '%予定%' then '#calendar'
              when new.message like '%家計簿%' or new.message like '%精算%' then '#kakeibo'
              when new.message like '%やること%' or new.message like '%をやりました%' then '#chores' else '#home' end
    from members m left join notify_prefs p on p.user_id = m.user_id
   where m.household_id = new.household_id and m.user_id <> new.user_id and coalesce(p.partner, true);
  return new;
end $$;
drop trigger if exists q_activity on activities;
create trigger q_activity after insert on activities for each row execute function q_activity();

-- B:買い物に「急ぎ」が付いたら、付けた人以外のメンバーへ
create or replace function q_urgent() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid := coalesce(auth.uid(), new.added_by);
begin
  if new.urgent and not new.done and (tg_op = 'INSERT' or not old.urgent) then
    insert into notify_queue(user_id, kind, title, body, url)
    select m.user_id, 'urgent', '🛒 急ぎの買い物',
           new.name || case when new.qty > 1 then ' ×' || new.qty else '' end
             || coalesce('(' || (select display_name from members where user_id = who and household_id = new.household_id) || 'さん)', ''),
           '#shopping'
      from members m left join notify_prefs p on p.user_id = m.user_id
     where m.household_id = new.household_id and m.user_id <> who and coalesce(p.urgent, true);
  end if;
  return new;
end $$;
drop trigger if exists q_urgent on shopping_items;
create trigger q_urgent after insert or update of urgent on shopping_items for each row execute function q_urgent();

-- 1分ごとに通知係を呼ぶ(合言葉つき)
select cron.unschedule(jobid) from cron.job where jobname = 'kurashi-push';
select cron.schedule('kurashi-push', '* * * * *', $job$
  select net.http_post(
    url := 'https://nvvacuteciogpfvdjmwp.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-kurashi-cron', (select cron_secret from public.push_config where id = 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000);
$job$);

notify pgrst, 'reload schema';
