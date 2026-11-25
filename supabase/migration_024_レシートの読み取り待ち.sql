-- 2026-11-23 レシートの読み取り待ち
-- Gemini が混み合っていて読めなかったレシートの写真を「読み取り待ち」に入れ、10分ごとの時計(pg_cron)で自動で読み直す。
-- 読めたら「確認待ち」(card_inbox)に入り、読み取り待ちからは消える。
-- 何回実行しても同じ結果になる

create table if not exists receipt_queue (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,                                   -- 保存した写真(receipts の中)
  status text not null default 'waiting' check (status in ('waiting', 'failed')),   -- failed = 自動の読み直しを止めた
  tries int not null default 0,
  last_error text,
  next_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table receipt_queue enable row level security;
drop policy if exists rq_own on receipt_queue;
create policy rq_own on receipt_queue for all
  using (owner = auth.uid() and is_member(household_id))
  with check (owner = auth.uid() and is_member(household_id));
create index if not exists receipt_queue_due on receipt_queue(next_at) where status = 'waiting';

-- 読み取った結果を「確認待ち」に入れる(本人を指定して。読み直しの係だけが使う)
create or replace function receipt_add_as(p_user uuid, p_store text, p_date date, p_total int, p_items jsonb, p_time text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := p_user; h uuid; other uuid; done uuid; ts timestamptz; newid uuid;
begin
  if u is null then raise exception '利用者がわかりません'; end if;
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
revoke all on function receipt_add_as(uuid, text, date, int, jsonb, text) from public, anon, authenticated;
grant execute on function receipt_add_as(uuid, text, date, int, jsonb, text) to service_role;

-- アプリから呼ぶほうは、ログインしている本人で上の関数を使う
create or replace function receipt_add(p_store text, p_date date, p_total int, p_items jsonb, p_time text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  return receipt_add_as(auth.uid(), p_store, p_date, p_total, p_items, p_time);
end $$;
revoke all on function receipt_add(text, date, int, jsonb, text) from public;
grant execute on function receipt_add(text, date, int, jsonb, text) to authenticated;

-- 10分ごとに、読み直しの時刻が来たものがあれば、読み取りの係を呼ぶ(合言葉つき)
select cron.unschedule(jobid) from cron.job where jobname = 'kurashi-receipt';
select cron.schedule('kurashi-receipt', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://nvvacuteciogpfvdjmwp.supabase.co/functions/v1/receipt-read',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-kurashi-cron', (select cron_secret from public.push_config where id = 1)),
    body := '{"mode":"queue"}'::jsonb,
    timeout_milliseconds := 140000)
  where exists (select 1 from public.receipt_queue where status = 'waiting' and next_at <= now());
$job$);

notify pgrst, 'reload schema';
