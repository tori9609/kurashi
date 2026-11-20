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
