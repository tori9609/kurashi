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
