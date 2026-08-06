#!/usr/bin/env bash
# Phase 3 Live Validation — Stage A DEPLOYMENT-ENVIRONMENT probe (§2).
# CREDENTIAL-FREE: only unauthenticated public checks (egress IP, production URL reachability, TLS,
# server-time drift). It NEVER uses API key/secret/memo and NEVER calls order/withdraw/transfer/margin
# endpoints. Auth-dependent Stage A items are reported as Not Executed when no credential is injected.
# Evidence is written redacted to artifacts/logs/phase3-stageA-env.log.
set -u
cd "$(dirname "$0")/.." || exit 2
LOG="artifacts/logs/phase3-stageA-env.log"
REST="${BITMART_REST_BASE:-https://api-cloud-v2.bitmart.com}"
WS_PUB="${BITMART_WS_PUBLIC:-wss://openapi-ws-v2.bitmart.com/api?protocol=1.1}"
WS_PRIV="${BITMART_WS_PRIVATE:-wss://openapi-ws-v2.bitmart.com/user?protocol=1.1}"

# credential presence (names only; values never printed)
cred_present="no"
if [ -n "${BITMART_ACCESS_KEY:-}${BITMART_API_KEY:-}" ] && [ -n "${BITMART_SECRET_KEY:-}${BITMART_SECRET:-}" ] && [ -n "${BITMART_MEMO:-}${BITMART_API_MEMO:-}" ]; then
  cred_present="yes"
fi

{
  echo "=== Phase 3 Stage A — deployment-environment probe (credential-free)"
  echo "=== timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=== git SHA: $(git rev-parse HEAD)"
  echo "=== env: Node $(node -v) · $(uname -srm)"
  echo "=== real credential injected: $cred_present (values never printed)"
  echo "----- CHECKS -----"

  echo "[egress-ip] server public egress IP (needs BitMart IP whitelist):"
  ip="$(timeout 15 curl -s https://api.ipify.org || echo unknown)"
  echo "  egress_ip=$ip"

  echo "[rest-url] production REST base (must be api-cloud-v2, NOT demo):"
  echo "  rest_base=$REST"
  case "$REST" in *demo*) echo "  DEMO ENDPOINT DETECTED — FAIL";; *) echo "  production=OK";; esac

  echo "[rest-reach+tls] unauthenticated GET /system/time:"
  code_tls="$(timeout 20 curl -sS -o /tmp/_bm_time.json -w 'HTTP=%{http_code} tls_verify=%{ssl_verify_result} t=%{time_total}s' "$REST/system/time" 2>&1 || echo 'unreachable')"
  echo "  $code_tls  (tls_verify=0 means certificate validated)"

  echo "[server-time-drift] local vs BitMart server_time (±5s window):"
  node -e '
    const https=require("https");const REST=process.env.REST||"https://api-cloud-v2.bitmart.com";
    const t0=Date.now();https.get(REST+"/system/time",r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>{
    const t1=Date.now();const local=Math.round((t0+t1)/2);const s=JSON.parse(b).data.server_time;
    console.log("  rtt_ms="+(t1-t0)+" drift_ms="+(local-s)+" within_5s="+(Math.abs(local-s)<=5000));});}).on("error",e=>console.log("  ERR "+e.message));
  ' REST="$REST"

  echo "[ws-urls] production WS (public + private) that WOULD be used (no connect without creds):"
  echo "  ws_public=$WS_PUB"
  echo "  ws_private=$WS_PRIV"
  case "$WS_PUB$WS_PRIV" in *wsdemo*) echo "  DEMO WS DETECTED — FAIL";; *) echo "  production=OK";; esac

  echo "[safe-defaults] live trading + kill switch (server-authoritative):"
  echo "  BITMART_LIVE_TRADING_ENABLED=${BITMART_LIVE_TRADING_ENABLED:-<unset→false>}"
  echo "  BITMART_EMERGENCY_KILL_SWITCH=${BITMART_EMERGENCY_KILL_SWITCH:-<unset→true(blocked)>}"
  echo "  BITMART_MODE=${BITMART_MODE:-<unset→BITMART_LIVE_READ_ONLY>}"

  echo "[secret-manager] KMS/Secret Manager connection:"
  if [ -n "${AWS_SECRETS_MANAGER_ARN:-}" ]; then echo "  configured (ARN present)"; else echo "  NOT configured → dev LocalKekProvider (Not Executed for prod KMS)"; fi

  echo "----- AUTH-DEPENDENT STAGE A ITEMS -----"
  if [ "$cred_present" = "yes" ]; then
    echo "  credentials present — (this probe still does NOT run them; use the authenticated runner under explicit approval)"
  else
    echo "  API key auth / HMAC live / futures account / balances / positions / position-mode /"
    echo "  leverage / open-orders / order-history / trade-history / metadata / private-WS auth+subscribe/"
    echo "  heartbeat / reconnect / REST-vs-WS snapshot compare: Not Executed (no real credential injected)."
  fi
  echo "----- END -----"
} > "$LOG" 2>&1
echo "wrote $LOG"
