#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
PASS=0
FAIL=0

ok(){
  echo "[PASS] $1"
  PASS=$((PASS+1))
}
ng(){
  echo "[FAIL] $1"
  FAIL=$((FAIL+1))
}

check_status(){
  local name="$1"
  local method="$2"
  local path="$3"
  local expect="$4"
  local data="${5:-}"

  local code
  if [[ "$method" == "GET" ]]; then
    code=$(curl -sS -o /tmp/rc_body.txt -w "%{http_code}" "${BASE_URL}${path}" || true)
  else
    code=$(curl -sS -o /tmp/rc_body.txt -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "${BASE_URL}${path}" || true)
  fi

  if [[ "$code" == "$expect" ]]; then
    ok "$name ($code)"
  else
    ng "$name (expected $expect got $code)"
    head -c 220 /tmp/rc_body.txt || true
    echo
  fi
}

echo "== Release smoke check =="
echo "BASE_URL=$BASE_URL"

check_status "health endpoint" GET "/health" 200
check_status "root page" GET "/" 200
check_status "symbols endpoint" GET "/v1/symbols?limit=5" 200
check_status "candles endpoint" GET "/v1/charts/candles?symbolId=BTCUSDT&timeframe=1m&limit=10" 200
check_status "SQLi validation" GET "/v1/charts/candles?symbolId=BTC';DROP&timeframe=1m" 400
check_status "XSS validation" GET "/v1/charts/candles?symbolId=%3Cscript%3E&timeframe=1m" 400
check_status "invalid timeframe validation" GET "/v1/charts/candles?symbolId=BTCUSDT&timeframe=invalid" 400
check_status "unknown symbol validation" GET "/v1/charts/candles?symbolId=NONEXISTENT&timeframe=1m" 404
# 미인증 요청은 401(우선 인증), 설정/미들웨어 순서에 따라 403(CSRF) 가능
csrf_code=$(curl -sS -o /tmp/rc_body.txt -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: csrf_token=test" -d '{"nickname":"qa"}' "${BASE_URL}/v1/auth/update-profile" || true)
if [[ "$csrf_code" == "401" || "$csrf_code" == "403" ]]; then
  ok "csrf/auth guard ($csrf_code)"
else
  ng "csrf/auth guard (expected 401 or 403 got $csrf_code)"
  head -c 220 /tmp/rc_body.txt || true
  echo
fi

# 보안 헤더 확인
headers=$(curl -sS -I "${BASE_URL}/" || true)
if echo "$headers" | grep -qi "x-frame-options:" && echo "$headers" | grep -qi "content-security-policy:"; then
  ok "security headers (x-frame-options + csp)"
else
  ng "security headers missing"
fi

# WebSocket Origin 정책 확인
python3 - <<'PY' || FAIL=$((FAIL+1))
import asyncio, websockets, os
base = os.environ.get('BASE_URL','http://127.0.0.1:3000').replace('http://','ws://').replace('https://','wss://')
url = base + '/v1/ws'

async def test():
    # 허용 origin
    async with websockets.connect(url, origin='http://localhost:8000', open_timeout=5) as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=3)
        assert 'system.connected' in msg
    # 차단 origin
    blocked = False
    try:
        await websockets.connect(url, origin='https://evil.com', open_timeout=5)
    except Exception:
        blocked = True
    assert blocked

asyncio.run(test())
print('[PASS] websocket origin policy')
PY

echo
if [[ $FAIL -gt 0 ]]; then
  echo "RESULT: FAIL (pass=$PASS fail=$FAIL)"
  exit 1
fi

echo "RESULT: PASS (pass=$PASS fail=$FAIL)"
