-- 暮らし帳 追加分 006〜013 のまとめ(朝にこれ1本を実行すればよい)
-- Supabase の SQL Editor に全部貼り付けて Run。何度実行しても大丈夫です。

-- ======================================================
-- migration_006_iPhoneカレンダーの取り込み.sql
-- ======================================================
-- 2026-11-21 iPhone(iCloud)のカレンダーの取り込み(ショートカット → 暮らし帳の予定)
-- ショートカットは、予定を1件ずつ calendar_push で送り、最後に calendar_finish を1回呼ぶ。
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる

alter table events add column if not exists synced_at timestamptz;

-- 予定1件を受け取る。日時は「ISO 8601」の形(例 2026-11-25T19:30:00+09:00)
create or replace function calendar_push(p_token text, p_title text, p_start text, p_end text default null,
  p_all_day text default null, p_calendar text default 'iPhone') returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; s timestamptz; e timestamptz; allday boolean; d date; t time; et time; x text; ttl text;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  begin s := p_start::timestamptz; exception when others then raise exception '開始日を読み取れません: %', p_start; end;
  begin e := nullif(p_end, '')::timestamptz; exception when others then e := null; end;
  allday := lower(coalesce(p_all_day, '')) in ('1', 'true', 'yes', 'はい', 'オン')
    or ((s at time zone 'Asia/Tokyo')::time = '00:00' and e is not null and (e at time zone 'Asia/Tokyo')::time in ('00:00', '23:59'));
  d := (s at time zone 'Asia/Tokyo')::date;
  t := case when allday then null else (s at time zone 'Asia/Tokyo')::time end;
  et := case when allday or e is null then null else (e at time zone 'Asia/Tokyo')::time end;
  ttl := left(coalesce(nullif(trim(p_title), ''), '(タイトルなし)'), 80);
  x := 'ios:' || md5(coalesce(p_calendar, '') || '|' || ttl || '|' || s::text);

  update events set title = ttl, date = d, time = t, end_time = et, synced_at = now()
   where created_by = u and ext_id = x;
  if not found then
    insert into events(household_id, date, time, end_time, title, for_user, is_private, created_by, source, ext_id, calendar_id, calendar_name, synced_at)
    values (h, d, t, et, ttl, u, true, u, 'iphone', x, 'iphone', coalesce(nullif(p_calendar, ''), 'iPhone'), now());
  end if;
  return 'ok';
end $$;

-- 送り終わったら呼ぶ:今日以降で、今回送られてこなかった予定(iPhoneで消された予定)を消す
create or replace function calendar_finish(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; n int;
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  delete from events where created_by = u and source = 'iphone' and date >= (now() at time zone 'Asia/Tokyo')::date
     and (synced_at is null or synced_at < now() - interval '15 minutes');
  get diagnostics n = row_count;
  return '削除 ' || n || ' 件';
end $$;

revoke all on function calendar_push(text, text, text, text, text, text) from public;
grant execute on function calendar_push(text, text, text, text, text, text) to anon, authenticated;
revoke all on function calendar_finish(text) from public;
grant execute on function calendar_finish(text) to anon, authenticated;


-- ======================================================
-- migration_007_レシートの読み込み.sql
-- ======================================================
-- 2026-11-21 レシートの読み込み(アプリで撮影 → Gemini で読み取り → 確認待ち → 品目ごとに分類して記録)
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる

alter table card_inbox add column if not exists items jsonb;      -- 品目 [{name, price, category}]
alter table card_inbox add column if not exists note text;        -- 例:カードで記録済みの可能性
alter table transactions add column if not exists items jsonb;    -- 記録した品目(見るため)

-- レシート1枚を受け取る(アプリから、ログインした本人として呼ぶ)
-- 同じ日・同じ金額のカード利用が確認待ちにあれば、そこへ品目とお店の名前を足して1件にまとめる
create or replace function receipt_add(p_store text, p_date date, p_total int, p_items jsonb, p_time text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h uuid; other uuid; done uuid; ts timestamptz; newid uuid;
begin
  if u is null then raise exception 'ログインが必要です'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  if p_total is null or p_total <= 0 then raise exception '合計金額を読み取れませんでした'; end if;
  ts := (p_date::text || ' ' || coalesce(nullif(p_time, ''), '12:00') || ':00+09')::timestamptz;

  -- 確認待ちのカード利用とまとめる
  select id into other from card_inbox
   where owner = u and status = 'new' and source in ('wallet', 'email') and items is null and amount = p_total
     and (used_at at time zone 'Asia/Tokyo')::date = p_date
   order by created_at limit 1;
  if other is not null then
    update card_inbox set items = p_items, merchant = coalesce(nullif(p_store, ''), merchant), pair_id = coalesce(pair_id, other) where id = other;
    return jsonb_build_object('merged', true, 'id', other);
  end if;

  -- 同じ支払いのカード利用が、もう記録済みかもしれないとき
  select id into done from card_inbox
   where owner = u and status in ('recorded', 'ignored') and source in ('wallet', 'email') and amount = p_total
     and (used_at at time zone 'Asia/Tokyo')::date = p_date limit 1;

  insert into card_inbox(household_id, owner, card, merchant, amount, used_at, source, items, note)
    values (h, u, 'レシート', left(coalesce(nullif(p_store, ''), '(お店の名前なし)'), 80), p_total, ts, 'receipt', p_items,
            case when done is not null then '同じ日・同じ金額のカード利用を記録済みです。二重にならないか確かめてください' end)
    returning id into newid;
  return jsonb_build_object('merged', false, 'id', newid);
end $$;

revoke all on function receipt_add(text, date, int, jsonb, text) from public;
grant execute on function receipt_add(text, date, int, jsonb, text) to authenticated;


-- ======================================================
-- migration_008_固定費の見せる範囲とカード突き合わせ.sql
-- ======================================================
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


-- ======================================================
-- migration_009_ウィジェット.sql
-- ======================================================
-- 暮らし帳 追加分9:ホーム画面のウィジェット(Scriptable)用(ゴミ箱・「この日だけ休み」の列は 013 で足します)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。
-- ウィジェット用の鍵は「読むだけ」。カード取り込みの鍵とは別で、これでは何も書き換えられません。

create table if not exists widget_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table widget_tokens enable row level security;   -- 直接は誰も読めない(関数を通すだけ)

-- 自分のウィジェット用の鍵を出す(p_renew = true で作り直す。古い鍵は使えなくなる)
create or replace function widget_token(p_renew boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if not p_renew then
    select token into t from widget_tokens where user_id = auth.uid();
    if t is not null then return t; end if;
  end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into widget_tokens(user_id, token) values (auth.uid(), t)
    on conflict (user_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;
revoke all on function widget_token(boolean) from public;
grant execute on function widget_token(boolean) to authenticated;

-- ウィジェットから呼ぶ:今日の前後の予定(くり返しも展開)、今日やること、買い物リストの残り、今月のふたりの支出と予算
-- p_private = false なら「自分だけ」の予定・やることは出さない(ロック画面などで人に見えても困らないように)
drop function if exists widget_data(text, int, boolean);
create or replace function widget_data(p_token text, p_back int default 14, p_ahead int default 14, p_private boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; t date; m0 date; ev jsonb; ch jsonb; sh jsonb; nm text; spent int; budget int;
begin
  select user_id into u from widget_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id, display_name into h, nm from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  t := (now() at time zone 'Asia/Tokyo')::date;
  m0 := date_trunc('month', t)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
      'date', d::date, 'time', to_char(e.time, 'HH24:MI'), 'end', to_char(e.end_time, 'HH24:MI'), 'title', e.title,
      'who', coalesce((select display_name from members m where m.user_id = e.for_user and m.household_id = h), 'ふたり'),
      'color', (select color from members m where m.user_id = e.for_user and m.household_id = h),
      'private', e.is_private)
    order by d, e.time nulls first, e.title), '[]'::jsonb) into ev
  from generate_series(t - least(greatest(coalesce(p_back, 14), 0), 31), t + least(greatest(coalesce(p_ahead, 14), 0), 31), interval '1 day') d
  join events e on e.household_id = h and e.deleted_at is null
   and (not e.is_private or (e.created_by = u and p_private))
   and d::date >= e.date and not (d::date = any(e.exdates))
   and case
         when e.repeat_rule is null then e.date = d::date
         when split_part(e.repeat_rule, ':', 1) = 'weekly'
           then extract(dow from d)::int::text = any(string_to_array(split_part(e.repeat_rule, ':', 2), ','))
         when split_part(e.repeat_rule, ':', 1) = 'monthly'
           then extract(day from d)::int = nullif(split_part(e.repeat_rule, ':', 2), '')::int
         else false end;

  -- 今日やること(アプリの「今日やること」と同じ決まり。今日終えた分も ✓ つきで出す)
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'cat', c.category, 'done', c.last_done is not distinct from t,
      'late', c.freq = 'once' and c.last_done is null and c.due < t,
      'who', (select display_name from members m where m.user_id = c.assignee and m.household_id = h))
    order by (c.last_done is not distinct from t), c.due nulls last, c.name), '[]'::jsonb) into ch
  from chores c
  where c.household_id = h and not c.archived and c.deleted_at is null
    and (not c.is_private or (c.created_by = u and p_private))
    and (c.last_done = t or case c.freq
          when 'once' then c.last_done is null and (c.due is null or c.due <= t)
          when 'daily' then true
          when 'monthly' then c.last_done is null or t - c.last_done >= 30
          else case when c.weekdays is not null then extract(dow from t)::int::text = any(string_to_array(c.weekdays, ','))
                    else c.last_done is null or t - c.last_done >= 7 end
        end);

  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'qty', s.qty, 'urgent', s.urgent)
    order by s.urgent desc, s.created_at), '[]'::jsonb) into sh
  from shopping_items s where s.household_id = h and not s.done;

  select coalesce(sum(amount), 0) into spent from transactions
   where household_id = h and scope = 'shared' and deleted_at is null and date >= m0 and date < (m0 + interval '1 month')::date;
  select nullif(sum(amount), 0) into budget from budgets where household_id = h;

  return jsonb_build_object('me', nm, 'today', t, 'events', ev, 'chores', ch, 'shopping', sh,
    'spent', spent, 'budget', budget, 'at', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'));
end $$;
revoke all on function widget_data(text, int, int, boolean) from public;
grant execute on function widget_data(text, int, int, boolean) to anon, authenticated;

notify pgrst, 'reload schema';


-- ======================================================
-- migration_010_やることリスト.sql
-- ======================================================
-- 暮らし帳 追加分10:家事 → やることリスト(期限・お休み・自分だけ・分類)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。

alter table chores add column if not exists due date;                                   -- 期限(1回だけのとき。なくてもよい)
alter table chores add column if not exists archived boolean not null default false;    -- くり返しを終えた(お休み中)。「復活」で戻せる
alter table chores add column if not exists is_private boolean not null default false;  -- true なら作った本人だけ見える
alter table chores add column if not exists created_by uuid references auth.users(id) default auth.uid();
alter table chores add column if not exists category text not null default '家事';          -- 分類(家事・用事・手続き・買い物・仕事・お金・健康・その他)

-- 「自分だけ」のやることは本人以外に見せない(作った人が分からない古い分は、ふたりのもの)
drop policy if exists member_all on chores;
drop policy if exists chores_rw on chores;
create policy chores_rw on chores for all
  using (is_member(household_id) and (not is_private or created_by = auth.uid()))
  with check (is_member(household_id) and (not is_private or created_by = auth.uid()));

notify pgrst, 'reload schema';


-- ======================================================
-- migration_011_買い物の候補.sql
-- ======================================================
-- 暮らし帳 追加分11:買い物の候補ボタン(よく買う物を上に・自分でボタンを固定・候補から外す)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。
alter table item_names add column if not exists pinned boolean not null default false;   -- ★ いつもボタンに出す
alter table item_names add column if not exists hidden boolean not null default false;   -- 候補から外した
notify pgrst, 'reload schema';


-- ======================================================
-- migration_012_通知.sql
-- ======================================================
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


-- ======================================================
-- migration_013_ゴミ箱・くり返し・通知の追加・バックアップ.sql
-- ======================================================
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

