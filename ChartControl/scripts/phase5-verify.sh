#!/usr/bin/env bash
# Phase 5 verification runner. Writes artifacts/logs/phase5-<name>.log with a header
# (command / env / git SHA / start / end / exit code) + raw output.
set -u
cd "$(dirname "$0")/.." || exit 2
LOGDIR="artifacts/logs"; mkdir -p "$LOGDIR"
GITSHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="$(test -n "$(git status --porcelain)" && echo 'dirty(phase-5 delta)' || echo 'clean')"
ENVLINE="Node $(node -v) · pnpm $(pnpm -v) · $(uname -srm)"

run() {
  local name="$1"; shift; local cmd="$*"; local log="$LOGDIR/phase5-${name}.log"; local start end code
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  { echo "=== command: $cmd"; echo "=== env: $ENVLINE"; echo "=== git SHA: $GITSHA (tree: $DIRTY)"; echo "=== start: $start"; echo "----- OUTPUT -----"; } > "$log"
  eval "$cmd" >> "$log" 2>&1; code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  { echo "----- END -----"; echo "=== end: $end"; echo "=== exit_code: $code"; } >> "$log"
  printf '%-12s exit=%-3s -> %s\n' "$name" "$code" "$log"; return $code
}

echo "### Phase 5 verification — git $GITSHA ($DIRTY)"
run install     "pnpm install --frozen-lockfile"
run lint        "pnpm lint"
run typecheck   "pnpm typecheck"
run test        "env -u PG_TEST_URL pnpm test"
run build       "pnpm build"
run e2e         "pnpm e2e"
if [ -n "${PG_TEST_URL:-}" ]; then run postgres "PG_TEST_URL=$PG_TEST_URL pnpm test:postgres"; else run postgres "pnpm test:postgres"; fi
run integration "pnpm test:integration"
run admin       "pnpm test:admin"
echo "### done"
