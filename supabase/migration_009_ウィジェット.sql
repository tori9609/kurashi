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
