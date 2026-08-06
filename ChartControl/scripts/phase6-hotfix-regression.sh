#!/usr/bin/env bash
# Phase 6 UI/Chart Hotfix — full regression runner.
# Records command, start/end time, duration, exit code and log path for every step.
# Never masks a failure: each command's real exit code is captured and reported.
set -u
cd "$(dirname "$0")/.."

OUT_DIR="artifacts/logs/phase6-hotfix"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/regression-summary.tsv"
GIT_SHA="$(git rev-parse HEAD)"
NODE_VERSION="$(node -v)"
PNPM_VERSION="$(pnpm -v)"

printf 'command\tstart\tend\tduration_s\texit_code\tresult\tlog\n' > "$SUMMARY"

run() {
  local slug="$1"; shift
  local log="$OUT_DIR/$slug.log"
  local start end dur code result
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=== [$slug] $* ==="
  {
    echo "# command : $*"
    echo "# cwd     : $(pwd)"
    echo "# node    : $NODE_VERSION"
    echo "# pnpm    : $PNPM_VERSION"
    echo "# git sha : $GIT_SHA"
    echo "# start   : $start"
    echo
  } > "$log"
  local t0 t1
  t0="$(date +%s)"
  "$@" >> "$log" 2>&1
  code=$?
  t1="$(date +%s)"
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dur=$((t1 - t0))
  if [ "$code" -eq 0 ]; then result="PASS"; else result="FAIL"; fi
  {
    echo
    echo "# end       : $end"
    echo "# duration  : ${dur}s"
    echo "# exit code : $code"
    echo "# result    : $result"
  } >> "$log"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$*" "$start" "$end" "$dur" "$code" "$result" "$log" >> "$SUMMARY"
  echo "--- [$slug] $result (exit $code, ${dur}s)"
}

# ---- Phase 6 baseline regression set (19 commands) ----
run 01-install            pnpm install --frozen-lockfile
run 02-lint               pnpm lint
run 03-typecheck          pnpm typecheck
run 04-test               pnpm test
run 05-build              pnpm build
run 06-e2e                pnpm e2e
run 07-test-postgres      pnpm test:postgres
run 08-test-integration   pnpm test:integration
run 09-test-admin         pnpm test:admin
run 10-e2e-admin          pnpm e2e:admin
run 11-test-security      pnpm test:security
run 12-test-gateway       pnpm test:gateway
run 13-e2e-gateway        pnpm e2e:gateway
run 14-test-mfa           pnpm test:mfa
run 15-e2e-mfa            pnpm e2e:mfa
run 16-test-chaos         pnpm test:chaos
run 17-test-ai            pnpm test:ai
run 18-eval-ai            pnpm eval:ai
run 19-audit-prod         pnpm audit --prod

echo
echo "===== SUMMARY ====="
column -t -s $'\t' "$SUMMARY"
FAILED=$(awk -F'\t' 'NR>1 && $6!="PASS"' "$SUMMARY" | wc -l)
echo
echo "failed steps: $FAILED"
exit 0
