#!/usr/bin/env bash
# 暮らし帳:まだ流していない SQL(supabase/migration_番号_*.sql)だけを、番号の順にデータベースへ流す。
# GitHub Actions から呼ばれる。DB_URL にデータベースの接続先(Session pooler)を入れておく。
# どこまで流したかは、データベースの app_meta(schema_version)で覚えている(追加分18で作る表)。
set -euo pipefail
: "${DB_URL:?DB_URL(データベースの接続先)がありません}"
DIR="${1:-supabase}"
psql_q() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -At "$@"; }

if [ "$(psql_q -c "select to_regclass('public.app_meta') is not null")" != "t" ]; then
  echo "::error::app_meta がありません。最初の1回だけ、まとめ_014から019.sql を Supabase の SQL Editor で実行してください"; exit 1
fi
cur=$(psql_q -c "select coalesce((select value::int from app_meta where key = 'schema_version'), 0)")
echo "今のSQLの版: $cur"
ran=0
for f in $(ls "$DIR"/migration_[0-9]*.sql | sort -t_ -k2,2n); do
  n=$(basename "$f" | sed -E 's/^migration_0*([0-9]+)_.*/\1/')
  [ "$n" -le "$cur" ] && continue
  echo "流します: $(basename "$f")"
  psql_q -f "$f"
  psql_q -c "insert into app_meta(key, value) values ('schema_version', '$n') on conflict (key) do update set value = '$n', updated_at = now()"
  ran=$((ran + 1))
done
echo "流したSQL: ${ran}本(今の版: $(psql_q -c "select value from app_meta where key = 'schema_version'"))"
