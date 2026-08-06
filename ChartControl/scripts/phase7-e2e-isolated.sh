#!/usr/bin/env bash
# Phase 7 §5 — isolated E2E runner for CI and release verification.
#
# Why this exists: a Phase 7 regression run reported a false `e2e:admin` failure because
# `reuseExistingServer` let Playwright adopt a manually started dev server bound to the same port and
# wired to a persistent database. The suite measured that process instead of the build under test.
#
# Guarantees provided here:
#   1. reuseExistingServer is OFF (the configs default to off; PW_ALLOW_REUSE is never set here)
#   2. every port this run needs is verified FREE *before* Playwright starts — Playwright launches
#      webServer before globalSetup, so the check cannot live inside the config
#   3. each suite uses its own ports, so the three suites never contend
#   4. throwaway databases (temp file or :memory:) — never a developer .data file
#   5. GIT_SHA is injected so the in-suite guard spec can prove the API is THIS build
#   6. processes and temp databases are cleaned up on exit, including on failure
#
# Usage:
#   bash scripts/phase7-e2e-isolated.sh              # all three suites, Chromium
#   PW_ALL_BROWSERS=1 PW_WEBKIT=1 bash scripts/phase7-e2e-isolated.sh   # 3-browser matrix
#   SUITES="user admin" bash scripts/phase7-e2e-isolated.sh
set -uo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="artifacts/logs/phase7"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/e2e-isolated.log"
SUMMARY="$OUT_DIR/e2e-isolated-summary.tsv"
: > "$LOG"

export GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"
# Reuse must never be enabled for a verification run.
unset PW_ALLOW_REUSE

SUITES="${SUITES:-user admin mfa}"

# Distinct port sets per suite so back-to-back (or concurrent) runs cannot collide.
export E2E_API_PORT="${E2E_API_PORT:-8787}"
export E2E_WEB_PORT="${E2E_WEB_PORT:-5173}"
export E2E_ADMIN_API_PORT="${E2E_ADMIN_API_PORT:-8788}"
export E2E_ADMIN_PORT="${E2E_ADMIN_PORT:-5174}"
# The MFA suite reuses the user-suite ports by design (see tests/e2e-mfa/playwright.config.ts):
# suites run sequentially with cleanup, and the pre-flight check still makes an occupied port fatal.
export E2E_MFA_API_PORT="${E2E_MFA_API_PORT:-8787}"
export E2E_MFA_WEB_PORT="${E2E_MFA_WEB_PORT:-5173}"

TMP_ROOT="$(mktemp -d /tmp/qt-e2e-run-XXXXXX)"
export E2E_SQLITE_PATH="$TMP_ROOT/user-e2e.db"

say() { printf '%s\n' "$*" | tee -a "$LOG"; }

cleanup() {
  local rc=$?
  say ""
  say "--- cleanup ---"
  # Kill anything still bound to this run's ports (a crashed webServer can outlive Playwright).
  for p in "$E2E_API_PORT" "$E2E_WEB_PORT" "$E2E_ADMIN_API_PORT" "$E2E_ADMIN_PORT" \
           "$E2E_MFA_API_PORT" "$E2E_MFA_WEB_PORT"; do
    for pid in $(ss -ltnp 2>/dev/null | grep -E ":$p\b" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
      ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      say "  terminating pid $pid (port $p)"
      kill "$pid" 2>/dev/null
      if [ -n "$ppid" ] && [ "$ppid" != "1" ]; then kill "$ppid" 2>/dev/null; fi
    done
  done
  rm -rf "$TMP_ROOT" 2>/dev/null
  say "  removed temp databases: $TMP_ROOT"
  exit $rc
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Pre-flight: every port must be free. An occupied port is a hard failure, never a reuse.
# ---------------------------------------------------------------------------
check_ports() {
  local ports=("$@")
  node -e '
const net = require("net");
const ports = process.argv.slice(1).map(Number);
(async () => {
  for (const p of ports) {
    await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", (e) => {
        if (e.code === "EADDRINUSE" || e.code === "EACCES") {
          reject(new Error(`PORT ${p} IS ALREADY IN USE. Refusing to run: Playwright would adopt that process and the results would describe it, not this build. Stop the process on port ${p} (e.g. a manually started `+"`pnpm dev`"+`) and re-run.`));
        } else reject(e);
      });
      s.once("listening", () => s.close(() => resolve()));
      s.listen(p, "127.0.0.1");
    });
  }
  console.log("ports free: " + ports.join(", "));
})().catch((e) => { console.error(String(e.message)); process.exit(1); });
' "${ports[@]}"
}

printf 'suite\tstart\tend\tduration_s\texit_code\tresult\tports\tlog\n' > "$SUMMARY"

run_suite() { # name config ports...
  local name="$1"; shift
  local config="$1"; shift
  local ports=("$@")
  local slog="$OUT_DIR/e2e-isolated-$name.log"

  say ""
  say "=== suite: $name ==="
  say "config : $config"
  say "ports  : ${ports[*]}"
  say "git sha: $GIT_SHA"

  if ! check_ports "${ports[@]}" >>"$LOG" 2>&1; then
    say "FAIL  $name — port pre-check failed (see $LOG)"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 0 1 "FAIL_PORT_IN_USE" "${ports[*]}" "$LOG" >> "$SUMMARY"
    return 1
  fi

  local s t0 t1 e rc
  s="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; t0=$(date +%s)
  npx playwright test -c "$config" > "$slog" 2>&1
  rc=$?
  t1=$(date +%s); e="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local result=PASS; [ "$rc" -ne 0 ] && result=FAIL
  local passed
  passed=$(grep -aoE '[0-9]+ passed' "$slog" | tail -1)
  say "$result  $name (exit $rc, $((t1-t0))s) ${passed:-}"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$s" "$e" "$((t1-t0))" "$rc" "$result" "${ports[*]}" "$slog" >> "$SUMMARY"
  return $rc
}

say "=== Phase 7 isolated E2E run ==="
say "git sha        : $GIT_SHA"
say "node           : $(node -v)"
say "reuse allowed  : no (PW_ALLOW_REUSE unset)"
say "browsers       : chromium$([ "${PW_ALL_BROWSERS:-}" = "1" ] && echo ' + firefox')$([ "${PW_WEBKIT:-}" = "1" ] && echo ' + webkit')"
say "temp db root   : $TMP_ROOT"
say "started        : $(date -u +%Y-%m-%dT%H:%M:%SZ)"

fail=0
for suite in $SUITES; do
  case "$suite" in
    user)  run_suite user tests/e2e/playwright.config.ts "$E2E_API_PORT" "$E2E_WEB_PORT" || fail=1 ;;
    admin) run_suite admin tests/e2e-admin/playwright.config.ts "$E2E_ADMIN_API_PORT" "$E2E_ADMIN_PORT" || fail=1 ;;
    mfa)   run_suite mfa tests/e2e-mfa/playwright.config.ts "$E2E_MFA_API_PORT" "$E2E_MFA_WEB_PORT" || fail=1 ;;
    *)     say "unknown suite: $suite"; fail=1 ;;
  esac
done

say ""
say "=== SUMMARY ==="
column -t -s $'\t' "$SUMMARY" | tee -a "$LOG"
say ""
say "summary: $SUMMARY"
[ "$fail" -eq 0 ] || exit 1
exit 0
