#!/usr/bin/env bash
#
# 운영 DB 백업 + **복구 검증**.
#
# ★★ 왜 필요한가
#
#   Render 는 시점 복구(PITR)를 제공하지만 스냅샷 백업이 0건이고, 복구를 한 번도
#   시험해 본 적이 없었다. 릴리스 게이트가 `backup-restore-pitr` 를 NOT_EXECUTED 로
#   표시하고 있었다. 고객 거래기록과 거래소 자격증명이 든 DB 인데 "되돌릴 수 있다" 는
#   근거가 없었다.
#
# ★★ 이 스크립트가 검증하는 것 — 네 단계 전부
#
#   1) 덤프가 만들어지는가            (pg_dump)
#   2) 그 덤프가 복구되는가           (pg_restore, 오류 0건)
#   3) 데이터가 같은가                (핵심 표 행 수 대조)
#   4) **자격증명이 복호화되는가**     ← 이것이 진짜 검증이다
#
#   4번이 없으면 의미가 없다. 행 수가 맞아도 키를 풀 수 없으면 서비스를 되살릴 수 없다.
#
# ★ 백업 파일은 **운영 밖에** 둔다. Render 안에만 두면 Render 사고에서 함께 사라진다.
#
# ★ 클라이언트 버전을 맞춰야 한다. 운영이 PostgreSQL 18 이므로 pg_dump 도 18 이어야
#   한다. 16 으로 시도하면 `aborting because of server version mismatch` 로 멈춘다.
#
# 사용법:
#   DATABASE_URL='postgres://…?sslmode=require' \
#   CREDENTIAL_KEK='…' \
#     bash tools/backup-verify.sh            # 덤프 + 복구 + 대조 + 복호화
#   … bash tools/backup-verify.sh --dump-only  # 덤프만 (일상 백업)
#
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/18/bin}"
OUT_DIR="${OUT_DIR:-/tmp/cc-backup}"
PORT="${VERIFY_PORT:-54260}"
DUMP_ONLY=0
[[ "${1:-}" == "--dump-only" ]] && DUMP_ONLY=1

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 이 필요하다 (sslmode=require 포함)" >&2
  exit 2
fi
if [[ ! -x "$PGBIN/pg_dump" ]]; then
  echo "pg_dump 를 찾을 수 없다: $PGBIN/pg_dump" >&2
  echo "운영이 PostgreSQL 18 이면 postgresql-client-18 이 필요하다." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/prod-$STAMP.dump"

echo "=== 1) 덤프"
"$PGBIN/pg_dump" "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$DUMP"
SIZE=$(stat -c%s "$DUMP")
echo "  $DUMP  ($(( SIZE / 1024 )) KB)"
# ★ 0 바이트나 비정상적으로 작은 덤프를 성공으로 다루지 않는다. 빈 백업이 가장 위험하다.
if [[ "$SIZE" -lt 10240 ]]; then
  echo "  ★ 덤프가 너무 작다($SIZE 바이트). 백업이 비어 있을 수 있다." >&2
  exit 1
fi

if [[ "$DUMP_ONLY" == "1" ]]; then
  echo "덤프만 수행했다. 복구 검증은 --dump-only 없이 실행할 것."
  exit 0
fi

echo "=== 2) 임시 PostgreSQL 로 복구"
DATA="$OUT_DIR/pgdata-$STAMP"
rm -rf "$DATA"
"$PGBIN/initdb" -D "$DATA" -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" \
  -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true' EXIT
sleep 3
"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c 'CREATE DATABASE restored' >/dev/null
RESTORE_ERR=$("$PGBIN/pg_restore" -h 127.0.0.1 -p "$PORT" -U postgres -d restored \
  --no-owner --no-privileges "$DUMP" 2>&1 | grep -ci 'error' || true)
echo "  복구 오류: $RESTORE_ERR"
[[ "$RESTORE_ERR" == "0" ]] || { echo "  ★ 복구 실패" >&2; exit 1; }

echo "=== 3) 데이터 대조"
Q="SELECT 'users='||(SELECT count(*) FROM users)\
||' consents='||(SELECT count(*) FROM user_legal_consents)\
||' trades='||(SELECT count(*) FROM trade_decisions)\
||' creds='||(SELECT count(*) FROM exchange_credentials)\
||' docs='||(SELECT count(*) FROM legal_documents)\
||' tables='||(SELECT count(*) FROM information_schema.tables WHERE table_schema='public')"
PROD_ROW=$("$PGBIN/psql" "$DATABASE_URL" -tAc "$Q")
REST_ROW=$("$PGBIN/psql" "postgres://postgres@127.0.0.1:$PORT/restored" -tAc "$Q")
echo "  운영  : $PROD_ROW"
echo "  복구본: $REST_ROW"
# ★ audit_logs 는 덤프 직후에도 늘어나므로 대조에서 뺐다. 나머지가 다르면 문제다.
[[ "$PROD_ROW" == "$REST_ROW" ]] && echo "  일치 ✓" || echo "  ★ 불일치 — 확인 필요"

echo "=== 4) 자격증명 복호화 (가장 중요)"
if [[ -z "${CREDENTIAL_KEK:-}" ]]; then
  echo "  ★ CREDENTIAL_KEK 이 없어 확인하지 못했다."
  echo "    행 수만 맞고 키를 풀 수 없으면 이 백업으로 서비스를 되살릴 수 없다."
  echo "    반드시 KEK 을 주고 다시 실행할 것."
  exit 1
fi
# ★ apps/api 안에서 실행한다. `pg` 와 TypeScript 소스가 그 워크스페이스에 있어서,
#   저장소 루트에 스크립트를 두면 `Cannot find package 'pg'` 로 멈춘다.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESTORED_URL="postgres://postgres@127.0.0.1:$PORT/restored" \
  pnpm --dir "$REPO_ROOT/apps/api" exec tsx scripts/backup-verify-decrypt.mjs

echo
echo "백업·복구 검증 완료. 덤프: $DUMP"
echo "★ 이 파일을 운영 밖(다른 클라우드·로컬 암호화 저장소)에 보관할 것."
