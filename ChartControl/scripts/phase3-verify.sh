#!/usr/bin/env bash
# §21 verification runner. Writes artifacts/logs/phase3-<name>.log with a standard header
# (command / env / start / end / exit code / git SHA) followed by the raw combined output.
set -u
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"
LOGDIR="$ROOT/artifacts/logs"
mkdir -p "$LOGDIR"
GITSHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="$(test -n "$(git status --porcelain)" && echo 'dirty(phase-3 completion delta)' || echo 'clean')"
ENVLINE="Node $(node -v) · pnpm $(pnpm -v) · $(uname -srm)"

run() {
  local name="$1"; shift
  local cmd="$*"
  local log="$LOGDIR/phase3-${name}.log"
  local start end exit_code
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    echo "=== command: $cmd"
    echo "=== env: $ENVLINE"
    echo "=== git SHA: $GITSHA (tree: $DIRTY)"
    echo "=== start: $start"
    echo "----- OUTPUT -----"
  } > "$log"
  # shellcheck disable=SC2086
  eval $cmd >> "$log" 2>&1
  exit_code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    echo "----- END -----"
    echo "=== end: $end"
    echo "=== exit_code: $exit_code"
  } >> "$log"
  printf '%-12s exit=%-3s start=%s end=%s -> %s\n' "$name" "$exit_code" "$start" "$end" "$log"
  return $exit_code
}

echo "### Phase 3 §21 verification — git $GITSHA ($DIRTY)"
run install    "pnpm install --frozen-lockfile"
run lint       "pnpm lint"
run typecheck  "pnpm typecheck"
run test       "env -u PG_TEST_URL pnpm test"
run build      "pnpm build"
run e2e        "pnpm e2e"
PG_URL="${PG_TEST_URL:-}"
if [ -n "$PG_URL" ]; then
  run postgres "PG_TEST_URL=$PG_URL pnpm test:postgres"
else
  run postgres "pnpm test:postgres"
fi
run integration "pnpm test:integration"
echo "### done"
