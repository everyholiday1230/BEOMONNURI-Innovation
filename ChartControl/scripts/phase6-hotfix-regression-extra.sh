#!/usr/bin/env bash
# Phase 6 UI/Chart Hotfix — hotfix-specific + release-gate regression (runs AFTER the 19-command set).
# Appends to the same summary file so one table covers the whole run.
set -u
cd "$(dirname "$0")/.."

OUT_DIR="artifacts/logs/phase6-hotfix"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/regression-summary.tsv"
GIT_SHA="$(git rev-parse HEAD)"
NODE_VERSION="$(node -v)"
PNPM_VERSION="$(pnpm -v)"

run() {
  local slug="$1"; shift
  local log="$OUT_DIR/$slug.log"
  local start end dur code result
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=== [$slug] $* ==="
  {
    echo "# command : $*"
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

# ---- Hotfix-specific coverage ----
run 20-e2e-layout-geometry npx playwright test -c tests/e2e/playwright.config.ts flow-l-layout-geometry
run 21-e2e-chart-render    npx playwright test -c tests/e2e/playwright.config.ts flow-m-chart-render
run 22-e2e-admin-console   npx playwright test -c tests/e2e-admin/playwright.config.ts admin-console

# ---- Browser matrix (Chromium + Firefox + WebKit) ----
PW_ALL_BROWSERS=1 PW_WEBKIT=1 run 23-e2e-user-3browsers  npx playwright test -c tests/e2e/playwright.config.ts
PW_ALL_BROWSERS=1 PW_WEBKIT=1 run 24-e2e-admin-3browsers npx playwright test -c tests/e2e-admin/playwright.config.ts

# ---- Release gates ----
# The Phase 6 production dependency gate is "0 critical AND 0 high" (scripts/ci-audit-gate.sh).
# Bare `pnpm audit --prod` exits 1 on ANY severity, so it is recorded separately from this gate.
run 25-audit-gate          bash scripts/ci-audit-gate.sh
run 26-container-validation bash scripts/phase6-container-validate.sh

echo
echo "===== FULL SUMMARY ====="
column -t -s $'\t' "$SUMMARY"
exit 0
