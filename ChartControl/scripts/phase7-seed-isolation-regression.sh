#!/usr/bin/env bash
# Phase 7 §6 — dev-seed isolation / production fail-closed regression (process + artifact level).
#
# Complements apps/api/src/__tests__/production-artifact.test.ts (source + logic level) by actually
# starting the API and running the seed command, because "does the process refuse to boot" cannot be
# asserted from inside the same process.
#
# Scenarios
#   R1  built dist contains none of the forbidden dev credential strings
#   R2  production container filesystem contains none of them (via phase7-artifact-scan.sh)
#   R3  production build emits no source map
#   R4  NODE_ENV=production + ADMIN_SEED=true  -> dev seed does NOT run
#   R5  NODE_ENV=production                    -> `seed:dev` command refuses (non-zero exit)
#   R6  dev runtime                            -> `seed:dev` command works and is idempotent
#   R7  seeded (test) database                 -> fixtures present and usable
#   R8  NODE_ENV=production on a seeded DB     -> start-up blocked with DEV_SEED_ACCOUNT_DETECTED
#   R9  the blocking log line leaks no e-mail / password / user id
#   R10 clean production DB                    -> fixture scan passes (guard is not a blanket block)
#
# No secret value is printed. Forbidden tokens are matched by SHA-256 digest, so the literals do not
# appear in this script either.
set -uo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="artifacts/logs/phase7"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/seed-isolation-regression.log"
IMAGE="${IMAGE:-quantumtrade-api:phase7-preflight}"
PROD_KEY="$(head -c 48 /dev/urandom | base64 | tr -d '\n=' | cut -c1-40)"   # ephemeral, test-only
pass=0; fail=0
: > "$LOG"

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
ok()   { say "PASS  $1"; pass=$((pass+1)); }
bad()  { say "FAIL  $1"; fail=$((fail+1)); }

# Digest list of the forbidden dev tokens (identifiers + passwords + the retired dev signing key).
FORBIDDEN_HASHES="$(cat <<'EOF'
c5e786688e2d2852061c72783fcf13855a0858b37b9e62b10944f8579d13d9d8
ada11dea291d6d8cb0f638f66ac03aa7e275141622c620defbda4bdae9aa0b86
f257cdeb2b16d6aa30b17abcf2193cd0b36ae49877ada543bb5bd52642796701
3c4388e44ac4e6916e6c26eaa9689e02594411b47a23a9346c2441691c05eb24
7f81a7a4f7bf7ebdeb92533bb05011216ce2c77d0e0ca322f540abcd46a0c744
9440b2de45de8c1e536ff9128cb481c9cb1306ba1b4c5d81c3d57c26b7948d9d
EOF
)"

count_forbidden() { # file -> prints number of forbidden-token hits
  FORBIDDEN_HASHES="$FORBIDDEN_HASHES" python3 - "$1" <<'PY'
import hashlib, os, re, sys
hashes=set(os.environ["FORBIDDEN_HASHES"].split())
try: data=open(sys.argv[1],'rb').read().decode('utf-8','replace')
except Exception: print(0); raise SystemExit(0)
hits=sum(1 for t in re.findall(r"[A-Za-z0-9@._+-]{6,120}", data)
         if hashlib.sha256(t.strip().lower().encode()).hexdigest() in hashes)
# The retired dev signing key is matched structurally (it was a marker string, not a real secret).
hits += len(re.findall(r"insecure[-_](?:csrf|signing|session)[-_]key", data, re.I))
hits += len(re.findall(r"@qt\.local", data))
print(hits)
PY
}

say "=== Phase 7 dev-seed isolation regression ==="
say "git sha : $(git rev-parse HEAD)"
say "node    : $(node -v)"
say "image   : $IMAGE"
say "started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""

# ---------- R1 / R3 : built artifact ----------
say "--- R1/R3 built production bundle ---"
pnpm --filter @quantumtrade/api build >> "$LOG" 2>&1 || bad "R0 build failed"
DIST="apps/api/dist"
if [ -f "$DIST/index.js" ]; then
  N=$(count_forbidden "$DIST/index.js")
  [ "$N" -eq 0 ] && ok "R1 dist/index.js forbidden tokens = 0" || bad "R1 dist/index.js forbidden tokens = $N"
  MAPS=$(find "$DIST" -name '*.map' | wc -l | tr -d ' ')
  [ "$MAPS" -eq 0 ] && ok "R3 no source map emitted" || bad "R3 $MAPS source map(s) emitted"
  DEVD=$(find "$DIST" -type d \( -name dev -o -name '__tests__' -o -name fixtures \) | wc -l | tr -d ' ')
  [ "$DEVD" -eq 0 ] && ok "R1b no dev/test directory in dist" || bad "R1b dev/test directory present in dist"
else
  bad "R1 dist/index.js missing"
fi

# ---------- R2 : container filesystem ----------
say ""
say "--- R2 production container filesystem ---"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  if IMAGE="$IMAGE" bash scripts/phase7-artifact-scan.sh >> "$LOG" 2>&1; then
    ok "R2 container + dist artifact scan: 0 findings"
  else
    bad "R2 artifact scan reported findings (see $LOG and artifacts/security/phase7-artifact-scan.json)"
  fi
else
  say "NOTE image $IMAGE absent — build it with:"
  say "     docker build -f infrastructure/docker/Dockerfile.api -t $IMAGE ."
  bad "R2 NOT_EXECUTED (image absent)"
fi

# ---------- helper: boot the API and capture stdout ----------
boot() { # port sqlite_path extra_env... -> writes /tmp/qt7-boot.log
  local port="$1"; shift
  local dbp="$1"; shift
  : > /tmp/qt7-boot.log
  env "$@" API_PORT="$port" API_HOST=127.0.0.1 SQLITE_PATH="$dbp" \
      DATA_MODE=MOCK_REPLAY TRADING_MODE=MOCK \
      timeout 25 pnpm --filter @quantumtrade/api dev > /tmp/qt7-boot.log 2>&1
}

# ---------- R4 : production + ADMIN_SEED=true must not seed ----------
say ""
say "--- R4 NODE_ENV=production + ADMIN_SEED=true ---"
rm -f /tmp/qt7-r4.db*
boot 8951 /tmp/qt7-r4.db NODE_ENV=production ADMIN_SEED=true AUTH_CSRF_KEY="$PROD_KEY"
SEEDED=$(grep -c "DEV admin seed ready" /tmp/qt7-boot.log)
[ "$SEEDED" -eq 0 ] && ok "R4 dev seed did not run in production" || bad "R4 dev seed ran in production"
USERS=$(python3 -c "
import sqlite3,sys
try:
    c=sqlite3.connect('/tmp/qt7-r4.db'); print(c.execute('select count(*) from users').fetchone()[0])
except Exception: print(-1)
")
[ "$USERS" -le 0 ] && ok "R4b no fixture rows written (users=$USERS)" || bad "R4b fixture rows written (users=$USERS)"

# ---------- R5 : production seed command refused ----------
say ""
say "--- R5 seed:dev refused in production ---"
NODE_ENV=production SQLITE_PATH=/tmp/qt7-r5.db timeout 60 pnpm --filter @quantumtrade/api seed:dev \
  > /tmp/qt7-r5.log 2>&1
RC=$?
if [ "$RC" -ne 0 ] && grep -q "REFUSED" /tmp/qt7-r5.log; then
  ok "R5 seed:dev refused in production (exit $RC)"
else
  bad "R5 seed:dev not refused in production (exit $RC)"
fi
[ ! -f /tmp/qt7-r5.db ] && ok "R5b no database created by the refused command" || bad "R5b database created by the refused command"

# ---------- R6 / R7 : dev seed command works, idempotent, fixtures usable ----------
say ""
say "--- R6/R7 dev seed command ---"
rm -f /tmp/qt7-r6.db*
SQLITE_PATH=/tmp/qt7-r6.db timeout 90 pnpm --filter @quantumtrade/api seed:dev > /tmp/qt7-r6.log 2>&1
RC1=$?
N1=$(python3 -c "import sqlite3;print(sqlite3.connect('/tmp/qt7-r6.db').execute('select count(*) from users').fetchone()[0])" 2>/dev/null || echo -1)
SQLITE_PATH=/tmp/qt7-r6.db timeout 90 pnpm --filter @quantumtrade/api seed:dev >> /tmp/qt7-r6.log 2>&1
RC2=$?
N2=$(python3 -c "import sqlite3;print(sqlite3.connect('/tmp/qt7-r6.db').execute('select count(*) from users').fetchone()[0])" 2>/dev/null || echo -1)
if [ "$RC1" -eq 0 ] && [ "$N1" -gt 0 ]; then ok "R6 seed:dev created $N1 fixtures in dev"; else bad "R6 seed:dev failed (exit $RC1, users=$N1)"; fi
if [ "$RC2" -eq 0 ] && [ "$N2" -eq "$N1" ]; then ok "R6b seed:dev is idempotent (users still $N2)"; else bad "R6b seed:dev not idempotent ($N1 -> $N2)"; fi
MARK=$(python3 -c "import sqlite3;print(sqlite3.connect('/tmp/qt7-r6.db').execute(\"select count(*) from feature_flags where key='e2e_seed'\").fetchone()[0])" 2>/dev/null || echo -1)
ROLES=$(python3 -c "import sqlite3;print(sqlite3.connect('/tmp/qt7-r6.db').execute(\"select count(*) from users where role is not null and role<>'USER'\").fetchone()[0])" 2>/dev/null || echo -1)
if [ "$MARK" -ge 1 ]; then ok "R7 test fixture marker recorded"; else bad "R7 fixture marker missing"; fi
if [ "$ROLES" -ge 1 ]; then ok "R7b admin roles granted to fixtures (count=$ROLES)"; else bad "R7b admin roles not granted (count=$ROLES)"; fi

# ---------- R8 / R9 : production start-up blocked on a seeded DB ----------
say ""
say "--- R8/R9 production start-up on a seeded database ---"
boot 8952 /tmp/qt7-r6.db NODE_ENV=production AUTH_CSRF_KEY="$PROD_KEY"
if grep -q "DEV_SEED_ACCOUNT_DETECTED" /tmp/qt7-boot.log; then
  ok "R8 start-up blocked with DEV_SEED_ACCOUNT_DETECTED"
else
  bad "R8 start-up NOT blocked on a seeded database"
fi
LEAK=$(count_forbidden /tmp/qt7-boot.log)
if [ "$LEAK" -eq 0 ]; then ok "R9 block log leaks no identifier/password (hits=0)"; else bad "R9 block log leaked $LEAK token(s)"; fi
if grep -qE "matches=[0-9]+" /tmp/qt7-boot.log; then ok "R9b block log reports aggregate counts only"; else bad "R9b aggregate counts absent"; fi
cp /tmp/qt7-boot.log "$OUT_DIR/r8-production-blocked.log"

# ---------- R10 : clean production DB passes the scan ----------
say ""
say "--- R10 clean production database ---"
rm -f /tmp/qt7-r10.db*
boot 8953 /tmp/qt7-r10.db NODE_ENV=production AUTH_CSRF_KEY="$PROD_KEY"
if grep -q "production fixture scan: OK" /tmp/qt7-boot.log && ! grep -q "DEV_SEED_ACCOUNT_DETECTED" /tmp/qt7-boot.log; then
  ok "R10 clean production database passes the fixture scan"
else
  bad "R10 clean production database did not pass the fixture scan"
fi
cp /tmp/qt7-boot.log "$OUT_DIR/r10-clean-db.log"

rm -f /tmp/qt7-r4.db* /tmp/qt7-r6.db* /tmp/qt7-r10.db* /tmp/qt7-boot.log /tmp/qt7-r5.log /tmp/qt7-r6.log 2>/dev/null

say ""
say "=== RESULT: $pass passed / $fail failed ==="
say "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "log     : $LOG"
[ "$fail" -eq 0 ] || exit 1
exit 0
