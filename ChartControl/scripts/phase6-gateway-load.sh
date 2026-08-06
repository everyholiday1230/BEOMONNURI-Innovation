#!/usr/bin/env bash
# Phase 6 §4 — internal WS Gateway load runner. Boots the gateway (MOCK_REPLAY, isolated port), runs k6
# WS at 100 then 1,000 connections, records ws handshake success + fan-out, then tears down. 10,000 WS
# is a goal; if the environment cannot sustain it we record Not Executed (never estimated).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
PORT=8790
export GATEWAY_PORT=$PORT GATEWAY_HOST=127.0.0.1 GATEWAY_UPSTREAM=MOCK_REPLAY NODE_ENV=development
export GATEWAY_ORIGIN_ALLOWLIST=http://localhost:5173,http://127.0.0.1:5173
echo "=== booting gateway on :$PORT (MOCK_REPLAY) ==="
setsid bash -c "cd $(pwd); GATEWAY_PORT=$PORT GATEWAY_HOST=127.0.0.1 GATEWAY_UPSTREAM=MOCK_REPLAY NODE_ENV=development GATEWAY_ORIGIN_ALLOWLIST=http://localhost:5173,http://127.0.0.1:5173 pnpm --filter @quantumtrade/market-gateway-server exec tsx src/index.ts" >/tmp/qt-gw-load.log 2>&1 < /dev/null &
GW_SETSID=$!
for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then echo "gateway not healthy"; tail -20 /tmp/qt-gw-load.log; exit 1; fi
echo "gateway healthy."

stage() {
  local name="$1" vus="$2" dur="$3"
  echo "=== WS stage: $name (VUS=$vus DURATION=$dur) ==="
  GW_PORT=$PORT k6 run -e GW_PORT=$PORT -e VUS="$vus" -e DURATION="$dur" tests/load/gateway-ws.js 2>&1 \
    | grep -E "ws_connecting|ws_sessions|ws_session_duration|handshake 101|fan-out|checks|ws_msgs|iterations" || true
}
stage smoke-100 100 15s
stage baseline-1000 1000 20s
echo "=== 10,000 WS = attempted only if resources allow; otherwise Not Executed (not estimated) ==="
echo "=== upstream connection count (dedup): 1 per subscribed key regardless of client count (see /metrics gw_upstream_connections) ==="
curl -s "http://127.0.0.1:$PORT/metrics" | grep -E "gw_active_connections|gw_upstream_connections|gw_messages_out|gw_dropped_messages" || true
# teardown
pkill -f "market-gateway/src/index.ts" 2>/dev/null || true
kill $GW_SETSID 2>/dev/null || true
