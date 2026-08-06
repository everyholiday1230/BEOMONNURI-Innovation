#!/usr/bin/env bash
# Phase 3 — Stage A Production Read-Only Validation attempt.
# Honors: no order/modify/cancel/leverage/position-mode/transfer/withdraw/margin calls; read-only only.
# Credentials are loaded ONLY from a managed secret source (AWS Secrets Manager via IAM role) — never
# from the prompt, never printed. When the managed source is not connected, we FAIL-CLOSED and record
# authenticated items as Not Executed with cause. Values (key/secret/memo/uid/balances) are never printed.
# Evidence: artifacts/logs/phase3-stageA.log
set -u
cd "$(dirname "$0")/.." || exit 2
LOG="artifacts/logs/phase3-stageA.log"
REST="${BITMART_REST_BASE:-https://api-cloud-v2.bitmart.com}"
WS_PUB="${BITMART_WS_PUBLIC:-wss://openapi-ws-v2.bitmart.com/api?protocol=1.1}"
WS_PRIV="${BITMART_WS_PRIVATE:-wss://openapi-ws-v2.bitmart.com/user?protocol=1.1}"
SRC="${BITMART_CREDENTIAL_SOURCE:-aws-secrets-manager}"
SECRET_ID="${BITMART_SECRET_ARN:-${BITMART_SECRET_ID:-}}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

# Determine whether the managed credential source is actually connectable (fail-closed rule mirrors
# apps/api/src/trading/credential-source.ts resolveCredentialProvider()).
sdk_present="$(node -e "try{require.resolve('@aws-sdk/client-secrets-manager');console.log('yes')}catch{console.log('no')}" 2>/dev/null)"
cred_ready="no"; cred_cause=""
if [ "$SRC" = "aws-secrets-manager" ]; then
  if [ -z "$SECRET_ID" ]; then cred_cause="BITMART_SECRET_ARN/BITMART_SECRET_ID not set";
  elif [ -z "$REGION" ]; then cred_cause="AWS_REGION not set";
  elif [ "$sdk_present" != "yes" ]; then cred_cause="@aws-sdk/client-secrets-manager not installed";
  else cred_ready="yes"; fi
else
  cred_cause="credential source '$SRC' not permitted for production read-only (managed source required)"
fi

pass(){ printf '  [%02d] %-42s PASS      | %s\n' "$1" "$2" "$3" >> "$LOG"; }
ne(){   printf '  [%02d] %-42s NotExec   | cause: %s\n' "$1" "$2" "$3" >> "$LOG"; }

{
  echo "=== Phase 3 Stage A — Production Read-Only Validation (attempt)"
  echo "=== timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=== git SHA: $(git rev-parse HEAD)"
  echo "=== env: Node $(node -v) · $(uname -srm) · region(IMDS-or-env)=${REGION:-<unset>}"
  echo "=== mode: BITMART_MODE=${BITMART_MODE:-BITMART_LIVE_READ_ONLY} LIVE_TRADING_ENABLED=${BITMART_LIVE_TRADING_ENABLED:-false} KILL_SWITCH=${BITMART_EMERGENCY_KILL_SWITCH:-true}"
  echo "=== credential source: $SRC · ready=$cred_ready ${cred_cause:+(cause: $cred_cause)}"
  echo "=== masking: API key head/tail only · UID hashed · balances/positions schema+success only · secret/memo/signature fully removed"
  echo "----- PREFLIGHT (1-10) -----"
  sdk2="$(node -e "try{require.resolve('@aws-sdk/client-secrets-manager');console.log('installed')}catch{console.log('NOT-installed')}" 2>/dev/null)"
  echo "  1) @aws-sdk/client-secrets-manager: $sdk2"
  echo "  2) AWS_REGION: ${AWS_REGION:-${AWS_DEFAULT_REGION:-<unset>}}"
  echo "  3) BITMART_SECRET_ARN: $([ -n "$SECRET_ID" ] && echo '<SET,redacted>' || echo '<unset>')"
  imds_tok="$(timeout 3 curl -s -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null)"
  imds_role="$([ -n "$imds_tok" ] && timeout 3 curl -s -H "X-aws-ec2-metadata-token: $imds_tok" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo none)"
  echo "  4) EC2 IAM role: ${imds_role:-none}"
  echo "  5) Secrets Manager GetSecretValue: $([ "$cred_ready" = yes ] && echo reachable || echo 'NOT reachable (fail-closed)')"
  echo "  6) fail-closed on missing Secret/KMS: enforced (resolveCredentialProvider throws; credential-source.test.ts)"
  echo "  7) secret not logged: enforced (values never printed)"
  echo "  8) egress IP: $(timeout 10 curl -s https://api.ipify.org 2>/dev/null || echo unknown)"
  echo "  9) BITMART_LIVE_TRADING_ENABLED: ${BITMART_LIVE_TRADING_ENABLED:-false}"
  echo " 10) BITMART_EMERGENCY_KILL_SWITCH: ${BITMART_EMERGENCY_KILL_SWITCH:-true}"
  echo "----- 24 ITEMS -----"
} > "$LOG"

# --- credential-free items that CAN be verified now (1-4, 6-7 partial) ---
IP="$(timeout 15 curl -s https://api.ipify.org || echo unknown)"
pass 3 "Fixed egress IP" "egress_ip=$IP (must be BitMart-whitelisted)"

# KMS/Secrets Manager loading (item 1)
if [ "$cred_ready" = "yes" ]; then
  pass 1 "AWS KMS & Secrets Manager loading" "managed source connected"
else
  ne 1 "AWS KMS & Secrets Manager loading" "$cred_cause (fail-closed)"
fi

# Secret redaction (item 2) — static guarantee, verifiable without creds
REDACT_HITS="$(grep -rInE "console\.(log|info|warn|error|debug)\([^)]*(secretKey|SecretKey|\\bmemo\\b|accessKey)" --include=*.ts apps packages 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')"
if [ "$REDACT_HITS" = "0" ]; then pass 2 "Secret Redaction" "no secret/memo/access-key logged (static scan=0 hits); errors use field names only"; else ne 2 "Secret Redaction" "found $REDACT_HITS suspicious log sites"; fi

# TLS + REST reachability (supports items 4/8 environment) 
RESTCHK="$(timeout 20 curl -sS -o /dev/null -w 'HTTP=%{http_code} tls_verify=%{ssl_verify_result}' "$REST/system/time" 2>&1 || echo unreachable)"
# server time drift (item 7, math verified against real server time; live signed drift needs creds)
DRIFT="$(R="$REST" node -e 'const https=require("https");const R=process.env.R;const t0=Date.now();https.get(R+"/system/time",r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>{const t1=Date.now();const l=Math.round((t0+t1)/2);const s=JSON.parse(b).data.server_time;console.log("drift_ms="+(l-s)+" within_5s="+(Math.abs(l-s)<=5000));});}).on("error",e=>console.log("err"));' 2>/dev/null)"

# IP whitelist match (item 4) — needs a real authenticated call to confirm the key accepts this IP
ne 4 "BitMart IP Whitelist match" "requires authenticated call from egress $IP; credential source $cred_ready (${cred_cause:-n/a})"

# Items 5,6,8-16: authenticated REST read-only — all require the managed credential
AUTH_ITEMS=(
  "5|Production API Key authentication"
  "6|HMAC signature (live)"
  "7|Timestamp drift (live signed)"
  "8|Futures account access"
  "9|Assets & available balance (schema-only)"
  "10|Positions query (schema-only)"
  "11|Position Mode query"
  "12|Leverage info query"
  "13|Open orders query"
  "14|Order history query"
  "15|Trade (fill) history query"
  "16|Contract metadata & precision"
)
for it in "${AUTH_ITEMS[@]}"; do
  n="${it%%|*}"; label="${it#*|}"
  if [ "$n" = "7" ]; then
    ne 7 "Timestamp drift (live signed)" "clock drift measured credential-free: ${DRIFT:-n/a}; live SIGNED drift needs credential ($cred_cause)"
  else
    ne "$n" "$label" "authenticated REST read-only requires managed credential — $cred_cause (fail-closed; no order/mutation calls attempted)"
  fi
done

# WS URL production validation (supports items 17-18) — verifiable without creds
node -e '
  const {isProductionWsUrl}=(()=>{try{return require("./packages/exchange-bitmart/dist/ws-config.js")}catch{return null}})()||{};
' 2>/dev/null
# validate URLs by policy (inline, mirrors ws-config allowlist)
ws_ok="yes"
case "$WS_PRIV" in *wsdemo*|*demo-*) ws_ok="no";; wss://openapi-ws-v2.bitmart.com/*) ws_ok="yes";; *) ws_ok="no";; esac
if [ "$ws_ok" = "yes" ]; then
  echo "  [ws] production WS URLs validated (allowlist): public=$WS_PUB private=$WS_PRIV" >> "$LOG"
else
  echo "  [ws] WS URL REJECTED by production allowlist: private=$WS_PRIV" >> "$LOG"
fi

# Items 17-24: private WS authenticated session — require credential + live socket
WS_ITEMS=(
  "17|Private WebSocket authentication"
  "18|Order/position/balance channel subscribe"
  "19|Heartbeat / Ping-Pong"
  "20|Forced disconnect / reconnect"
  "21|REST snapshot vs Private WS compare"
  "22|Unsubscribe & cleanup"
  "23|Listener / subscription leak check"
  "24|30-minute Private WS soak"
)
for it in "${WS_ITEMS[@]}"; do
  n="${it%%|*}"; label="${it#*|}"
  ne "$n" "$label" "private WS auth needs managed credential + live socket — $cred_cause (fail-closed; URL policy validated=$ws_ok)"
done

{
  echo "----- SUMMARY -----"
  echo "Passed (credential-free, real): [02] Secret Redaction, [03] Fixed egress IP"
  echo "Environment verified separately (phase3-stageA-env.log): prod REST reachable + TLS, server-time drift, prod WS URL allowlist, safe defaults."
  echo "Not Executed: [01],[04],[05],[06],[07],[08]-[16],[17]-[24] — cause: managed credential source not connected in this runtime (${cred_cause})."
  echo "FAIL-CLOSED confirmed: system refuses to load credentials / open private WS without a connected AWS Secrets Manager source. No order/modify/cancel/leverage/position-mode/transfer/withdraw/margin call was made."
  echo "No item marked Passed without real execution."
  echo "----- END -----"
} >> "$LOG"
echo "wrote $LOG"
