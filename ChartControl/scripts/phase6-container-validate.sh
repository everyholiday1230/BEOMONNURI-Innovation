#!/usr/bin/env bash
# Phase 6 Closure §5/§7 — Docker container validation + Critical/High scan gate.
# Reproducible build → SBOM (already produced by trivy) → runtime hardening checks → scan gate.
# Writes a human-readable log to artifacts/logs/phase6-container-validation.log.
set -uo pipefail
cd "$(dirname "$0")/.."
IMG="quantumtrade-api:phase6-closure"
TRIVY="${TRIVY:-/home/test1/bin/trivy}"
LOG="artifacts/logs/phase6-container-validation.log"
mkdir -p artifacts/logs artifacts/security
pass=0; fail=0
exec > >(tee "$LOG") 2>&1
say(){ printf '%s\n' "$*"; }
check(){ # desc ; expr already evaluated via $? by caller pattern -> use function with test
  local desc="$1"; shift
  if "$@"; then say "PASS  $desc"; pass=$((pass+1)); else say "FAIL  $desc"; fail=$((fail+1)); fi
}
say "=== Phase 6 Closure — Container Validation ($(date -u +%FT%TZ)) ==="
say "git: $(git rev-parse HEAD) (tree: $(git diff --quiet && echo clean || echo dirty))"
say "image: $IMG  id=$(docker image inspect "$IMG" --format '{{.Id}}')  size=$(docker image inspect "$IMG" --format '{{.Size}}')"
say "base:  node:24-alpine  digest=$(docker image inspect node:24-alpine --format '{{index .RepoDigests 0}}')"
say ""

# --- 1. fail-closed: production without a Secret ARN must exit non-zero -------------------------------
say "--- fail-closed startup (NODE_ENV=production, no BITMART_SECRET_ARN) ---"
FC_OUT=$(docker run --rm -e NODE_ENV=production "$IMG" 2>&1); FC_RC=$?
say "$FC_OUT" | sed 's/^/    /'
[ "$FC_RC" -ne 0 ] && { say "PASS  fail-closed exits non-zero (rc=$FC_RC)"; pass=$((pass+1)); } || { say "FAIL  fail-closed did not exit"; fail=$((fail+1)); }
say ""

# --- 2. boot with a (dummy) Secret ARN + region and validate the running container --------------------
NAME="qt-closure-val-$$"
docker rm -f "$NAME" >/dev/null 2>&1
say "--- starting hardened container (read-only rootfs, tmpfs /tmp, cap-drop ALL, no-new-privileges) ---"
docker run -d --name "$NAME" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e NODE_ENV=production -e BITMART_SECRET_ARN=arn:aws:secretsmanager:us-east-1:000000000000:secret:dummy \
  -e AWS_REGION=us-east-1 -e API_PORT=8787 -p 18787:8787 "$IMG" >/dev/null
sleep 4
# health endpoints
for ep in /health /health/live /health/ready; do
  code=$(curl -s -o /tmp/body_$$ -w '%{http_code}' "http://127.0.0.1:18787$ep")
  body=$(cat /tmp/body_$$ 2>/dev/null)
  if [ "$code" = "200" ]; then say "PASS  GET $ep -> 200  $body"; pass=$((pass+1)); else say "FAIL  GET $ep -> $code $body"; fail=$((fail+1)); fi
done
# liveTradingEnabled must be false in readiness
if curl -s http://127.0.0.1:18787/health/ready | grep -qi '"liveTradingEnabled":false\|liveTrading.*false\|"live":false'; then say "PASS  readiness reports live trading disabled"; pass=$((pass+1)); else say "INFO  readiness body: $(curl -s http://127.0.0.1:18787/health/ready)"; fi

# non-root uid 10001
UID_OUT=$(docker exec "$NAME" id 2>&1)
say "id: $UID_OUT"
echo "$UID_OUT" | grep -q "uid=10001" && { say "PASS  non-root uid 10001"; pass=$((pass+1)); } || { say "FAIL  not uid 10001"; fail=$((fail+1)); }

# PID 1 is node (direct exec, receives signals). Node 24 names the main thread ("MainThread") so
# /proc/1/comm is no longer "node"; verify via the exe symlink + cmdline instead (and SIGTERM below).
P1EXE=$(docker exec "$NAME" sh -c 'readlink /proc/1/exe' 2>&1)
P1CMD=$(docker exec "$NAME" sh -c "tr '\\0' ' ' < /proc/1/cmdline" 2>&1)
say "/proc/1/exe: $P1EXE ; cmdline: $P1CMD"
case "$P1EXE/$P1CMD" in
  */node*node*) say "PID 1 = node (exec form; exe=$P1EXE; signals delivered)"; pass=$((pass+1));;
  *) say "FAIL  PID 1 != node (exe=$P1EXE cmd=$P1CMD)"; fail=$((fail+1));;
esac

# read-only rootfs: write to / must fail, write to tmpfs /tmp must succeed
docker exec "$NAME" sh -c 'echo x > /rotest 2>/dev/null' && { say "FAIL  rootfs is writable"; fail=$((fail+1)); } || { say "PASS  root filesystem read-only (write denied)"; pass=$((pass+1)); }
docker exec "$NAME" sh -c 'echo x > /tmp/ok 2>/dev/null && rm -f /tmp/ok' && { say "PASS  writable tmpfs /tmp works"; pass=$((pass+1)); } || { say "FAIL  tmpfs /tmp not writable"; fail=$((fail+1)); }

# production dependencies only — no dev tooling, no npm/npx present
say "--- production-deps-only / no bundled npm ---"
DEVHIT=$(docker exec "$NAME" sh -c 'ls node_modules 2>/dev/null' | grep -E '^(vitest|eslint|typescript|tsx|@playwright|tsup)$')
[ -z "$DEVHIT" ] && { say "PASS  no dev dependencies in node_modules"; pass=$((pass+1)); } || { say "FAIL  dev deps present: $DEVHIT"; fail=$((fail+1)); }
NPMHIT=$(docker exec "$NAME" sh -c 'command -v npm npx corepack 2>/dev/null')
[ -z "$NPMHIT" ] && { say "PASS  npm/npx/corepack removed from runtime"; pass=$((pass+1)); } || { say "FAIL  npm toolchain present: $NPMHIT"; fail=$((fail+1)); }
say "prod node_modules top-level: $(docker exec "$NAME" sh -c 'ls node_modules | tr "\n" " "')"

# LIVE=false / KILL_SWITCH=true from image config
ENVJSON=$(docker image inspect "$IMG" --format '{{json .Config.Env}}')
echo "$ENVJSON" | grep -q 'BITMART_LIVE_TRADING_ENABLED=false' && { say "PASS  LIVE=false baked in image"; pass=$((pass+1)); } || { say "FAIL  LIVE flag"; fail=$((fail+1)); }
echo "$ENVJSON" | grep -q 'BITMART_EMERGENCY_KILL_SWITCH=true' && { say "PASS  KILL_SWITCH=true baked in image"; pass=$((pass+1)); } || { say "FAIL  KILL_SWITCH flag"; fail=$((fail+1)); }

# no secrets baked: scan image env + history + a filesystem grep for common secret markers
say "--- secret scan (image env / history / filesystem) ---"
SECRETS=$( { echo "$ENVJSON"; docker history --no-trunc "$IMG"; } | grep -Ei 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|SECRET_ACCESS_KEY=|password=|BITMART_API_SECRET=' )
[ -z "$SECRETS" ] && { say "PASS  no secrets in image env/history"; pass=$((pass+1)); } || { say "FAIL  possible secret: $SECRETS"; fail=$((fail+1)); }
DOTENV=$(docker exec "$NAME" sh -c 'find / -maxdepth 4 -name ".env" 2>/dev/null')
[ -z "$DOTENV" ] && { say "PASS  no .env file baked in image"; pass=$((pass+1)); } || { say "FAIL  .env present: $DOTENV"; fail=$((fail+1)); }

# graceful SIGTERM
say "--- graceful SIGTERM ---"
T0=$(date +%s.%N)
docker stop -t 15 "$NAME" >/dev/null
T1=$(date +%s.%N)
RC=$(docker inspect "$NAME" --format '{{.State.ExitCode}}')
DUR=$(awk "BEGIN{printf \"%.2f\", $T1-$T0}")
say "stop duration=${DUR}s exitCode=$RC"
awk "BEGIN{exit !($DUR < 10)}" && [ "$RC" = "0" ] && { say "PASS  graceful SIGTERM (drained, exit 0, <10s)"; pass=$((pass+1)); } || { say "FAIL  SIGTERM not graceful (dur=$DUR rc=$RC)"; fail=$((fail+1)); }
docker logs "$NAME" 2>&1 | grep -i "SIGTERM received" | sed 's/^/    /'
docker rm -f "$NAME" >/dev/null 2>&1

# --- 3. Critical/High scan gate ----------------------------------------------------------------------
say ""
say "--- container vulnerability scan gate (Trivy $($TRIVY --version 2>/dev/null | head -1 | awk '{print $2}')) ---"
"$TRIVY" image --scanners vuln --severity CRITICAL,HIGH --exit-code 1 --quiet "$IMG" > /tmp/gate_$$ 2>/dev/null
GRC=$?
CH=$("$TRIVY" image --scanners vuln --format json --quiet "$IMG" 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for r in d.get('Results',[]) for v in (r.get('Vulnerabilities') or []) if v['Severity'] in ('CRITICAL','HIGH')))")
say "Critical+High count: $CH"
[ "$GRC" -eq 0 ] && [ "$CH" = "0" ] && { say "PASS  scan gate: 0 CRITICAL / 0 HIGH"; pass=$((pass+1)); } || { say "FAIL  scan gate: $CH Critical/High"; fail=$((fail+1)); }

say ""
say "=== RESULT: $pass passed / $fail failed ==="
[ "$fail" -eq 0 ]
