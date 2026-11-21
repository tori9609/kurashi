-- まとめ:014(固定費の支払日・収入・レシート写真)・015(お店の分類・ふり返り・あと使える額)・016(年払い・買い時・つけ忘れ)
-- Supabase の SQL Editor に全部貼り付けて、1回だけ Run します。2回実行しても壊れません。

-- 暮らし帳 追加分14:固定費の支払日・収入・レシートの写真
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。013 のあとに実行してください。

-- ========== 1. 固定費の支払日(1〜31。31は末日) ==========
alter table fixed_costs add column if not exists pay_day int not null default 1;
do $$ begin
  alter table fixed_costs add constraint fixed_costs_pay_day_check check (pay_day between 1 and 31);
exception when duplicate_object then null; end $$;

-- ========== 2. 収入(給与・投資・臨時収入・その他の収入) ==========
alter table transactions add column if not exists kind text not null default 'expense';
do $$ begin
  alter table transactions add constraint transactions_kind_check check (kind in ('expense', 'income'));
exception when duplicate_object then null; end $$;
alter table transactions drop constraint if exists transactions_category_check;
alter table transactions add constraint transactions_category_check check (category in (
  '住居','食費','外食','日用品','家具・家電','光熱費','通信','交通','趣味','その他',
  '給与','投資','臨時収入','その他の収入'));

-- 予算の通知は、支出だけを数える
create or replace function q_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare m0 date; b int; total int; lvl int; who uuid; mem record; tag text;
begin
  if new.scope <> 'shared' or new.deleted_at is not null or new.kind = 'income' then return new; end if;
  select amount into b from budgets where household_id = new.household_id and category = new.category;
  if b is null or b <= 0 then return new; end if;
  m0 := date_trunc('month', new.date)::date;
  select coalesce(sum(amount), 0) into total from transactions
   where household_id = new.household_id and category = new.category and scope = 'shared' and deleted_at is null and kind = 'expense'
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

-- ウィジェットの「今月のふたりの支出」も、支出だけを数える
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
   where household_id = h and scope = 'shared' and deleted_at is null and kind = 'expense' and date >= m0 and date < (m0 + interval '1 month')::date;
  select nullif(sum(amount), 0) into budget from budgets where household_id = h;

  return jsonb_build_object('me', nm, 'today', t, 'events', ev, 'chores', ch, 'shopping', sh,
    'spent', spent, 'budget', budget, 'at', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'));
end $$;
revoke all on function widget_data(text, int, int, boolean) from public;
grant execute on function widget_data(text, int, int, boolean) to anon, authenticated;


-- ========== 3. レシートの写真 ==========
alter table transactions add column if not exists receipt_path text;
alter table card_inbox add column if not exists receipt_path text;
-- 写真の置き場所(公開しない。1枚3MBまで・JPEGだけ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;
-- 置けるのは自分のフォルダ(ログインした人のidの名前)にだけ
drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
-- 見られるのは、自分の写真と、ふたりの記録に付いた写真だけ(相手の「自分だけ」の写真は見えない)
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.transactions t
                where t.receipt_path = storage.objects.name and t.scope = 'shared' and t.deleted_at is null and public.is_member(t.household_id))));
-- 消せるのは自分の写真だけ(ふだんは、通知係が毎晩まとめて片付ける)
drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

-- 暮らし帳 追加分15:お店の分類を覚える・先月のふり返りの通知・今月あと使える額(ウィジェット)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。014 のあとに実行してください。

-- ========== 1. お店の分類を覚える(本人の分だけ。相手には見えない) ==========
create table if not exists shop_categories (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_key text not null,          -- お店の名前を、比べやすい形にしたもの
  category text not null,
  updated_at timestamptz not null default now(),
  primary key (owner, shop_key)
);
alter table shop_categories enable row level security;
drop policy if exists shop_categories_own on shop_categories;
create policy shop_categories_own on shop_categories for all using (owner = auth.uid()) with check (owner = auth.uid());
grant all on shop_categories to authenticated;

-- ========== 2. 先月のふり返りの通知(毎月1日の朝7時。人ごとにオンオフ) ==========
alter table notify_prefs add column if not exists monthly boolean not null default true;

-- ========== 3. ウィジェット:今月あと使える額のための数字を足す ==========
create or replace function widget_data(p_token text, p_back int default 14, p_ahead int default 14, p_private boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; t date; m0 date; ev jsonb; ch jsonb; sh jsonb; nm text; spent int; budget int; upcoming int;
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
   where household_id = h and scope = 'shared' and deleted_at is null and kind = 'expense' and date >= m0 and date < (m0 + interval '1 month')::date;
  select nullif(sum(amount), 0) into budget from budgets where household_id = h;
  -- 今月これから払う固定費(ふたりの分・予算のある分類だけ):あと使える額から先に引いておく
  select coalesce(sum(f.amount), 0) into upcoming from fixed_costs f
   where f.household_id = h and f.active and f.scope = 'shared' and f.deleted_at is null
     and f.category in (select category from budgets where household_id = h and amount > 0)
     and least(f.pay_day, extract(day from (m0 + interval '1 month - 1 day'))::int) > extract(day from t)::int
     and not exists (select 1 from transactions x where x.fixed_cost_id = f.id and x.month = to_char(t, 'YYYY-MM'));

  return jsonb_build_object('me', nm, 'today', t, 'events', ev, 'chores', ch, 'shopping', sh,
    'spent', spent, 'budget', budget, 'upcoming', upcoming,
    'days_left', (extract(day from (m0 + interval '1 month - 1 day'))::int - extract(day from t)::int + 1), 'at', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'));
end $$;
revoke all on function widget_data(text, int, int, boolean) from public;
grant execute on function widget_data(text, int, int, boolean) to anon, authenticated;



notify pgrst, 'reload schema';

-- 暮らし帳 追加分16:固定費の年払い・消耗品の買い時・つけ忘れ防止の通知
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。

-- 固定費:毎月(monthly)か年に1回(yearly)か。年払いは pay_month の月だけ記録する
alter table fixed_costs add column if not exists cycle text not null default 'monthly';
alter table fixed_costs add column if not exists pay_month int;
alter table fixed_costs drop constraint if exists fixed_costs_cycle_check;
alter table fixed_costs add constraint fixed_costs_cycle_check check (cycle in ('monthly', 'yearly') and (pay_month is null or pay_month between 1 and 12));

-- 買い物:リストに入れた日(最近8回)。買い時の見当に使う
alter table item_names add column if not exists added_dates date[] not null default '{}';

-- 通知:つけ忘れ防止(夜8時)
alter table notify_prefs add column if not exists forgot boolean not null default true;

-- ウィジェット:「これから払う固定費」に、年払いは支払月だけ入れる
create or replace function widget_data(p_token text, p_back int default 14, p_ahead int default 14, p_private boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; t date; m0 date; ev jsonb; ch jsonb; sh jsonb; nm text; spent int; budget int; upcoming int;
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
   where household_id = h and scope = 'shared' and deleted_at is null and kind = 'expense' and date >= m0 and date < (m0 + interval '1 month')::date;
  select nullif(sum(amount), 0) into budget from budgets where household_id = h;
  -- 今月これから払う固定費(ふたりの分・予算のある分類だけ):あと使える額から先に引いておく
  select coalesce(sum(f.amount), 0) into upcoming from fixed_costs f
   where f.household_id = h and f.active and f.scope = 'shared' and f.deleted_at is null
     and f.category in (select category from budgets where household_id = h and amount > 0)
     and (f.cycle = 'monthly' or f.pay_month = extract(month from t)::int)
     and least(f.pay_day, extract(day from (m0 + interval '1 month - 1 day'))::int) > extract(day from t)::int
     and not exists (select 1 from transactions x where x.fixed_cost_id = f.id and x.month = to_char(t, 'YYYY-MM'));

  return jsonb_build_object('me', nm, 'today', t, 'events', ev, 'chores', ch, 'shopping', sh,
    'spent', spent, 'budget', budget, 'upcoming', upcoming,
    'days_left', (extract(day from (m0 + interval '1 month - 1 day'))::int - extract(day from t)::int + 1), 'at', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'));
end $$;
revoke all on function widget_data(text, int, int, boolean) from public;
grant execute on function widget_data(text, int, int, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
