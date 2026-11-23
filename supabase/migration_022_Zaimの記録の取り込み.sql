-- 2026-11-23 Zaim(無料版)の記録を、暮らし帳の家計簿へ一度だけ取り込む(2026-08-16〜2026-11-08 の支出29件)
-- 何回実行しても同じ結果になる。同じ日・同じ金額の記録がすでにあるものは入れない(二重よけ)
-- 払った人は とり、見せる範囲は「ふたり」(shared)。分け方(split)は空のまま=分類の「負担のめやす」に従う
-- 入れないもの:ATMの現金預入2件(Zaimでも集計から除外していた収入)
do $$
declare h uuid; ut uuid; us uuid; n_before int; n_after int;
begin
  select household_id, user_id into h, us from members
   where display_name ilike any (array['%しまだ%', '%島田%', '%ゆう%']) order by joined_at limit 1;
  if us is null then
    select household_id into h from members where is_admin order by joined_at limit 1;
    select user_id into us from members where household_id = h and not is_admin order by joined_at limit 1;
  end if;
  select user_id into ut from members where household_id = h and user_id <> us order by is_admin desc, joined_at limit 1;
  if h is null or ut is null then raise exception 'メンバーが2人そろっていません'; end if;

  select count(*) into n_before from transactions where household_id = h;
  insert into transactions(household_id, date, amount, shop, category, paid_by, scope, owner, kind)
  select h, v.d::date, v.a, nullif(v.shop, ''), v.cat, ut, 'shared', ut, 'expense'
    from (values
      ('2026-08-16', 30800, '火災保険', '住居'),
      ('2026-08-17', 297660, '初期費用', '住居'),
      ('2026-08-19', 91300, '初期費用 仲介手数料', '住居'),
      ('2026-09-14', 61800, '洗濯機', '家具・家電'),
      ('2026-09-14', 81461, '冷蔵庫', '家具・家電'),
      ('2026-09-19', 2890, '冷蔵庫マット ニトリ', '家具・家電'),
      ('2026-09-21', 1760, '', '日用品'),
      ('2026-09-21', 770, '洗濯、掃除類', '日用品'),
      ('2026-09-21', 1188, 'ゴミ袋', '日用品'),
      ('2026-09-22', 1262, '惣菜', '食費'),
      ('2026-09-22', 9495, '', '日用品'),
      ('2026-09-22', 8400, 'シャワーヘッド', '日用品'),
      ('2026-09-22', 13154, 'カインズ', '日用品'),
      ('2026-09-27', 1350, '', '食費'),
      ('2026-09-27', 880, '水回り', '日用品'),
      ('2026-09-27', 29058, '食器棚', '家具・家電'),
      ('2026-09-27', 1210, '収納小物', '日用品'),
      ('2026-10-03', 330, 'バス小物', '日用品'),
      ('2026-10-04', 1684, 'アピタ ワクワク広場', '食費'),
      ('2026-10-04', 250, 'おやつ IKEA', '食費'),
      ('2026-10-04', 18078, 'IKEA', '家具・家電'),
      ('2026-10-04', 9398, '食事と洗濯洗剤', '食費'),
      ('2026-10-10', 1320, 'ダイソー 突っ張り棒、保存容器など', '日用品'),
      ('2026-10-11', 131300, 'ソファ', '家具・家電'),
      ('2026-10-11', 2442, '北京飯', '外食'),
      ('2026-10-20', 40974, 'IKEA', '家具・家電'),
      ('2026-10-27', 123841, '賃料(口座振替)', '住居'),
      ('2026-11-07', 4874, '', '住居'),
      ('2026-11-08', 2116, '肉、惣菜', '食費')
    ) as v(d, a, shop, cat)
   where not exists (select 1 from transactions x
                      where x.household_id = h and x.date = v.d::date and x.amount = v.a and x.deleted_at is null);
  select count(*) into n_after from transactions where household_id = h;
  raise notice 'Zaimの記録:% 件を追加', n_after - n_before;
end $$;
