-- 2026-11-24 ウィジェットに「今月の収支」を出す。月の区切り(始まりの日)を人ごとに選べるようにする
-- 何回実行しても同じ結果になる

alter table members add column if not exists month_start int not null default 1;
do $$ begin
  alter table members add constraint members_month_start_check check (month_start between 1 and 28);
exception when duplicate_object then null; end $$;

-- 月の始まりの日を変える(本人の分だけ)
create or replace function set_month_start(p_day int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if p_day is null or p_day < 1 or p_day > 28 then raise exception '1〜28日の中から選んでください'; end if;
  update members set month_start = p_day where user_id = auth.uid();
end $$;
revoke all on function set_month_start(int) from public;
grant execute on function set_month_start(int) to authenticated;

create or replace function widget_data(p_token text, p_back int default 14, p_ahead int default 14, p_private boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; t date; m0 date; ev jsonb; ch jsonb; sh jsonb; nm text; spent int; budget int; upcoming int;
  ms int; r0 date; r1 date; inc int; paid int;
begin
  select user_id into u from widget_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id, display_name, coalesce(month_start, 1) into h, nm, ms from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;
  t := (now() at time zone 'Asia/Tokyo')::date;
  m0 := date_trunc('month', t)::date;
  -- 自分で決めた「月の区切り」(始まりの日 ms 〜 翌月の ms の前日)。初めは1日〜月末
  r0 := make_date(extract(year from t)::int, extract(month from t)::int, ms);
  if r0 > t then r0 := (r0 - interval '1 month')::date; end if;
  r1 := (r0 + interval '1 month')::date;

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
   where household_id = h and scope = 'shared' and deleted_at is null and kind = 'expense' and date >= r0 and date < r1;
  -- 自分の収支(アプリの「自分の収支」と同じ:自分の収入 − 自分が払った分)
  select coalesce(sum(amount) filter (where kind = 'income'), 0), coalesce(sum(amount) filter (where kind = 'expense'), 0) into inc, paid
    from transactions
   where household_id = h and deleted_at is null and paid_by = u and (scope = 'shared' or owner = u) and date >= r0 and date < r1;
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
    'days_left', r1 - t, 'from', r0, 'to', r1 - 1, 'month_start', ms, 'income', inc, 'paid', paid, 'at', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'));
end $$;
revoke all on function widget_data(text, int, int, boolean) from public;
grant execute on function widget_data(text, int, int, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
