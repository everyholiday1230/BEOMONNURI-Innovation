#!/usr/bin/env bash
# Phase 6 regression runner. Runs the 15 required commands with a header (command/env/git SHA/start/
# end/exit) + raw output to artifacts/logs/phase6-<name>.log, plus npm audit. e2e/e2e:admin use the
# default Chromium projects (the 3-browser matrix is captured separately in phase6-e2e-*-allbrowsers.log).
set -u
cd "$(dirname "$0")/.." || exit 2
LOGDIR="artifacts/logs"; mkdir -p "$LOGDIR"
GITSHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="$(test -n "$(git status --porcelain)" && echo dirty || echo clean)"
ENVLINE="Node $(node -v) · pnpm $(pnpm -v) · $(uname -srm)"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:16379}"
export PG_TEST_URL="${PG_TEST_URL:-postgres://newchart:newchart@127.0.0.1:15432/qtdb_p6c}"

run() {
  local name="$1"; shift; local cmd="$*"; local log="$LOGDIR/phase6-${name}.log"; local start end code
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  { echo "=== command: $cmd"; echo "=== env: $ENVLINE"; echo "=== git SHA: $GITSHA (tree: $DIRTY)"; echo "=== start: $start"; echo "----- OUTPUT -----"; } > "$log"
  eval "$cmd" >> "$log" 2>&1; code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  { echo "----- END -----"; echo "=== end: $end"; echo "=== exit_code: $code"; } >> "$log"
  printf '%-16s exit=%-3s -> %s\n' "$name" "$code" "$log"; return $code
}

echo "### Phase 6 regression — git $GITSHA ($DIRTY)"
run install      "pnpm install --frozen-lockfile"
run lint         "pnpm lint"
run typecheck    "pnpm typecheck"
run test         "pnpm test"
run build        "pnpm build"
run e2e          "pnpm e2e"
run test-postgres "pnpm test:postgres"
run test-integration "pnpm test:integration"
run test-admin   "pnpm test:admin"
run e2e-admin    "pnpm e2e:admin"
run test-security "pnpm test:security"
run test-gateway "pnpm test:gateway"
run e2e-gateway  "pnpm e2e:gateway"
run test-mfa     "pnpm test:mfa"
run e2e-mfa      "pnpm e2e:mfa"
run test-chaos   "pnpm test:chaos"
run test-load    "pnpm test:load"
run audit-prod   "pnpm audit --prod || true"
run ci-audit-gate "bash scripts/ci-audit-gate.sh"
echo "### done"
