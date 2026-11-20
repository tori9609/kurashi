-- 2026-11-21 Googleカレンダーの取り込み(Google Apps Script → 暮らし帳の予定)
-- Supabase の SQL Editor に貼って「Run」を押す。何回実行しても同じ結果になる

alter table events add column if not exists source text not null default 'app';  -- app(暮らし帳で書いた)/ google(取り込んだ)
alter table events add column if not exists ext_id text;                          -- 元のカレンダーの予定の識別番号
alter table events add column if not exists calendar_id text;                     -- 元のカレンダー
alter table events add column if not exists calendar_name text;
alter table events add column if not exists end_time time;
create unique index if not exists events_ext_id on events(created_by, ext_id) where ext_id is not null;

-- 1つのカレンダーの、決まった期間の予定をまとめて受け取り、追加・更新・削除する
-- 新しく入る予定は p_share が false なら「自分だけ」。すでにある予定の「見せる/見せない」は本人の選んだままにする
create or replace function calendar_sync(p_token text, p_calendar_id text, p_calendar_name text,
  p_from date, p_to date, p_events jsonb, p_share boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; h uuid; ev jsonb; n_new int := 0; n_upd int := 0; n_del int := 0; ids text[] := '{}';
begin
  select user_id into u from card_tokens where token = p_token;
  if u is null then raise exception '鍵が正しくありません'; end if;
  select household_id into h from members where user_id = u limit 1;
  if h is null then raise exception '暮らし帳に参加していません'; end if;

  for ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    ids := ids || (ev->>'ext_id');
    update events set title = left(coalesce(nullif(ev->>'title', ''), '(タイトルなし)'), 80),
                      date = (ev->>'date')::date, time = nullif(ev->>'time', '')::time,
                      end_time = nullif(ev->>'end_time', '')::time, calendar_name = p_calendar_name
     where created_by = u and ext_id = ev->>'ext_id';
    if found then n_upd := n_upd + 1;
    else
      insert into events(household_id, date, time, end_time, title, for_user, is_private, created_by, source, ext_id, calendar_id, calendar_name)
      values (h, (ev->>'date')::date, nullif(ev->>'time', '')::time, nullif(ev->>'end_time', '')::time,
              left(coalesce(nullif(ev->>'title', ''), '(タイトルなし)'), 80), u, not p_share, u, 'google', ev->>'ext_id', p_calendar_id, p_calendar_name);
      n_new := n_new + 1;
    end if;
  end loop;

  -- 元のカレンダーで消された予定(期間内で、今回届かなかったもの)を消す
  delete from events
   where created_by = u and source = 'google' and calendar_id = p_calendar_id
     and date between p_from and p_to and not (ext_id = any(ids));
  get diagnostics n_del = row_count;
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'deleted', n_del);
end $$;

revoke all on function calendar_sync(text, text, text, date, date, jsonb, boolean) from public;
grant execute on function calendar_sync(text, text, text, date, date, jsonb, boolean) to anon, authenticated;
