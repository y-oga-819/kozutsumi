#!/usr/bin/env bash
# public schema の構造化スナップショットを 1 行 JSON で出力する。
#
# 使い方:
#   scripts/db-migration-diff/snapshot.sh "$DATABASE_URL" path/to/output.json
#
# scripts/db-migration-diff/snapshot.sql を psql に流すだけのラッパ。
# ADR 0023 を参照。
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 DATABASE_URL OUTPUT_JSON_PATH" >&2
  exit 2
fi

database_url="$1"
output="$2"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -At: aligned tuple-only。JSON 1 行が裸で出る (ヘッダ / 区切り / 末尾改行は psql 標準のまま)
# --no-psqlrc: ローカル環境の psqlrc に左右されない
psql "$database_url" --no-psqlrc -At -f "$script_dir/snapshot.sql" > "$output"
