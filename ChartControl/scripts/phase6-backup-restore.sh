#!/usr/bin/env bash
# Phase 6 §7 — PostgreSQL backup/restore drill (REAL, local container). Creates a source DB with
# sample user/order/audit/AI rows, takes an encrypted-at-rest backup (pg_dump | gzip | openssl AES),
# restores into a fresh DB, runs an integrity check (row-count + checksum parity), and measures
# Recovery Time (RTO). Managed PITR is Not Executed (no managed PG). Idempotent.
set -uo pipefail
HOST="${PGHOST:-127.0.0.1}"; PORT="${PGPORT:-15432}"; USER="${PGUSER:-newchart}"; PW="${PGPASSWORD:-newchart}"
export PGPASSWORD="$PW"
SRC="qtdb_p6_src"; DST="qtdb_p6_restore"
BK="/tmp/qt_p6_backup.sql.gz"; ENC="/tmp/qt_p6_backup.sql.gz.enc"; KEY="phase6-backup-key-demo"
psql_() { psql -h "$HOST" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 "$@"; }

echo "=== [1] provision source DB ($SRC) ==="
psql_ -d postgres -c "DROP DATABASE IF EXISTS $SRC;" -c "CREATE DATABASE $SRC;" || exit 1
psql_ -d "$SRC" <<'SQL'
CREATE TABLE users(id serial primary key, email text unique not null, role text not null default 'USER', created_at timestamptz default now());
CREATE TABLE orders(id serial primary key, user_id int references users(id), client_order_id text unique, status text, notional numeric);
CREATE TABLE audit(id serial primary key, actor int, action text, at timestamptz default now());
CREATE TABLE ai_usage(id serial primary key, user_id int, tokens int, cost_micros bigint);
INSERT INTO users(email,role) SELECT 'u'||g||'@qt.local', CASE WHEN g=1 THEN 'SUPER_ADMIN' ELSE 'USER' END FROM generate_series(1,50) g;
INSERT INTO orders(user_id,client_order_id,status,notional) SELECT (random()*49+1)::int, 'coid-'||g, 'FILLED', (random()*1000)::numeric(12,2) FROM generate_series(1,500) g;
INSERT INTO audit(actor,action) SELECT (random()*49+1)::int, 'login' FROM generate_series(1,200) g;
INSERT INTO ai_usage(user_id,tokens,cost_micros) SELECT (random()*49+1)::int, (random()*2000)::int, (random()*100000)::bigint FROM generate_series(1,120) g;
SQL
SRC_COUNTS=$(psql_ -tA -d "$SRC" -c "SELECT (SELECT count(*) FROM users)||','||(SELECT count(*) FROM orders)||','||(SELECT count(*) FROM audit)||','||(SELECT count(*) FROM ai_usage);")
SRC_CKSUM=$(psql_ -tA -d "$SRC" -c "SELECT md5(string_agg(client_order_id||status||notional::text, ',' ORDER BY id)) FROM orders;")
echo "source counts (users,orders,audit,ai_usage) = $SRC_COUNTS ; orders md5=$SRC_CKSUM"

echo "=== [2] backup (pg_dump[PG17 via container] | gzip | openssl AES-256 encrypt-at-rest) ==="
PG_CONTAINER="${PG_CONTAINER:-newchart-postgres-1}"
RPO_T0=$(date +%s%3N)
docker exec -e PGPASSWORD="$PW" "$PG_CONTAINER" pg_dump -U "$USER" -h 127.0.0.1 -d "$SRC" | gzip | openssl enc -aes-256-cbc -pbkdf2 -pass "pass:$KEY" -out "$ENC" || exit 1
BK_BYTES=$(stat -c%s "$ENC")
echo "encrypted backup bytes=$BK_BYTES (recovery point = snapshot at backup time)"

echo "=== [3] restore into fresh DB ($DST) + measure RTO ==="
RTO_T0=$(date +%s%3N)
psql_ -d postgres -c "DROP DATABASE IF EXISTS $DST;" -c "CREATE DATABASE $DST;" || exit 1
openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$KEY" -in "$ENC" | gunzip | psql -h "$HOST" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 -d "$DST" >/dev/null || exit 1
RTO_MS=$(( $(date +%s%3N) - RTO_T0 ))

echo "=== [4] integrity check (counts + checksum parity) ==="
DST_COUNTS=$(psql_ -tA -d "$DST" -c "SELECT (SELECT count(*) FROM users)||','||(SELECT count(*) FROM orders)||','||(SELECT count(*) FROM audit)||','||(SELECT count(*) FROM ai_usage);")
DST_CKSUM=$(psql_ -tA -d "$DST" -c "SELECT md5(string_agg(client_order_id||status||notional::text, ',' ORDER BY id)) FROM orders;")
echo "restored counts = $DST_COUNTS ; orders md5=$DST_CKSUM"
echo "=== [5] migration up/down/re-up sanity (DDL replay) ==="
psql_ -d "$DST" -c "ALTER TABLE users ADD COLUMN mfa_enabled boolean default false;" -c "ALTER TABLE users DROP COLUMN mfa_enabled;" -c "ALTER TABLE users ADD COLUMN mfa_enabled boolean default false;" >/dev/null && echo "migration up/down/re-up OK"

RESULT="FAIL"
if [ "$SRC_COUNTS" = "$DST_COUNTS" ] && [ "$SRC_CKSUM" = "$DST_CKSUM" ]; then RESULT="PASS"; fi
echo "=== RESULT: integrity=$RESULT ; RTO=${RTO_MS}ms ; RPO=snapshot(0s data loss at backup instant) ; encrypted=yes ==="
echo "=== Managed PITR (WAL/base-backup on managed PG) = Not Executed (no managed PostgreSQL) ==="

# cleanup temp DBs (keep artifacts small); keep encrypted backup file as evidence
psql_ -d postgres -c "DROP DATABASE IF EXISTS $SRC;" -c "DROP DATABASE IF EXISTS $DST;" >/dev/null 2>&1
rm -f "$BK"
[ "$RESULT" = "PASS" ] && exit 0 || exit 1
