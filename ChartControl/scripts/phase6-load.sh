#!/usr/bin/env bash
# Phase 6 §9 — bounded load test runner. Boots the API (MOCK, isolated port), runs k6 HTTP smoke (10)
# + baseline (100) against /health, records p50/p95/p99 + error rate, then tears down. High (1,000
# users) and the 10,000-WebSocket internal-gateway target are Not Executed (resource/wiring limits)
# and recorded honestly in PHASE6-09. Never targets BitMart or production.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
PORT=8799
export DATA_MODE=MOCK_REPLAY TRADING_MODE=MOCK API_PORT=$PORT API_HOST=127.0.0.1 AUTH_ENABLED=true AUTH_COOKIE_INSECURE=true SQLITE_PATH=:memory: NODE_ENV=development
echo "=== booting API on :$PORT (MOCK) ==="
pnpm --filter @quantumtrade/api dev >/tmp/phase6-load-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then echo "API did not become healthy"; tail -20 /tmp/phase6-load-api.log; exit 1; fi
echo "API healthy."

run_stage() {
  local name="$1" vus="$2" dur="$3"
  echo "=== k6 stage: $name (VUS=$vus DURATION=$dur) ==="
  k6 run -e BASE_URL="http://127.0.0.1:$PORT" -e VUS="$vus" -e DURATION="$dur" tests/load/http.js 2>&1 \
    | grep -E "http_req_duration|http_req_failed|http_reqs|iterations|checks|p\(95\)|p\(99\)|avg=" || true
}

run_stage smoke 10 10s
run_stage baseline 100 15s
echo "=== high (1,000 users) = Not Executed (bounded environment) ==="
echo "=== internal WebSocket gateway 100/1,000/10,000 connections = Not Executed (gateway server not wired in this pass; core logic unit-tested in @quantumtrade/market-gateway) ==="
