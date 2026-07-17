# API 테스트 가이드

## 자동화된 회귀 테스트
```bash
bash scripts/release_check.sh
```
기본 스모크/보안 항목 자동 검증 (헬스/입력검증/CSRF/보안헤더/WS/인증 필수 엔드포인트).

## 수동 API 테스트 시나리오

### 1. 정상 응답
```bash
# 캔들 (정상)
curl "http://localhost:8000/v1/charts/candles?symbolId=BTCUSDT&timeframe=1m&limit=10"
# → 200 + {success:true, data:{candles:[...]}}

# 종목 검색 (캐시 hit 확인 - 두 번째 호출)
curl "http://localhost:8000/v1/symbols?asset_class=crypto&limit=20"
curl "http://localhost:8000/v1/symbols?asset_class=crypto&limit=20"  # 더 빠름
```

### 2. 입력 검증
```bash
# SQL 인젝션 (400 기대)
curl "http://localhost:8000/v1/charts/candles?symbolId=BTC';DROP&timeframe=1m"

# XSS payload (400 기대)
curl "http://localhost:8000/v1/charts/candles?symbolId=%3Cscript%3E&timeframe=1m"

# 미지원 심볼 (200 + supported:false + 빈 candles 기대)
curl "http://localhost:8000/v1/charts/candles?symbolId=NONEXISTENT&timeframe=1m"
# → 200 + {success:true, data:{candles:[], supported:false, ...}}

# 잘못된 timeframe (400 기대)
curl "http://localhost:8000/v1/charts/candles?symbolId=BTCUSDT&timeframe=invalid"

# 너무 큰 limit (자동 capping)
curl "http://localhost:8000/v1/charts/candles?symbolId=BTCUSDT&timeframe=1m&limit=999999"
# → 200 + 2000개로 capping
```

### 3. CSRF 보호
```bash
# CSRF 쿠키만 있고 헤더 없음 (설정/미들웨어 순서에 따라 401 또는 403)
curl -X POST "http://localhost:8000/v1/auth/update-profile" \
  -H "Cookie: csrf_token=test" \
  -H "Content-Type: application/json" \
  -d '{"nickname":"qa"}'

# CSRF 쿠키/헤더 일치 시 CSRF 단계 통과 (인증 없음이면 401 기대)
curl -X POST "http://localhost:8000/v1/auth/update-profile" \
  -H "Cookie: csrf_token=test" \
  -H "X-CSRF-Token: test" \
  -H "Content-Type: application/json" \
  -d '{"nickname":"qa"}'
```

### 4. Rate Limiting
```bash
# 분당 600회 한도 (700회 중 100회+가 429)
for i in {1..700}; do
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000/health"
done | sort | uniq -c
```

### 5. 외부 API 실패 시 fallback
```bash
# Binance 차단된 상태에서도 stale 응답
# (테스트 어려움 - 실제 장애 시에만 작동)
curl "http://localhost:8000/v1/charts/ticker-24hr?symbol=BTCUSDT"
```

### 6. WebSocket
```bash
# 정상 연결
python3 -c "
import asyncio, websockets, json
async def main():
    async with websockets.connect('ws://localhost:8000/v1/ws',
        origin='http://localhost:8000') as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=3)
        print(msg)
asyncio.run(main())
"

# evil.com origin (차단 기대)
python3 -c "
import asyncio, websockets
async def main():
    try:
        await websockets.connect('ws://localhost:8000/v1/ws',
            origin='https://evil.com')
        print('LEAK')
    except: print('blocked')
asyncio.run(main())
"
```

### 7. 입력 검증 - 추가 endpoint
```bash
# layouts (인증 필요)
TOKEN=$(curl -s -X POST "http://localhost:8000/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password"}' | jq -r '.data.tokens.access_token')

# XSS name (검증 필요)
curl -X POST "http://localhost:8000/v1/layouts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>","symbol_id":"00000000-0000-0000-0000-000000000000","timeframe":"1m"}'
# → 422 (Pydantic validation)

# 잘못된 UUID
curl -X POST "http://localhost:8000/v1/layouts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","symbol_id":"not-a-uuid","timeframe":"1m"}'
# → 422
```

### 8. 보안 헤더
```bash
curl -I "http://localhost:8000/" | grep -iE "x-frame|content-security|hsts|strict-transport|x-request-id"
# 기대:
# x-frame-options: DENY
# content-security-policy: ...frame-ancestors 'none'...
# strict-transport-security: max-age=63072000; includeSubDomains; preload (HTTPS만)
# x-request-id: ...
```

### 9. 인증 brute-force
```bash
# 5회 실패 후 30분 잠금 (운영 환경에서는 IP 잠금 위험 - 주의)
for i in {1..6}; do
  curl -s -X POST "http://localhost:8000/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
  echo ""
done
# 6번째 → 429 Too Many Requests + "30분 후 재시도"
```

### 10. 헬스체크 + 메트릭
```bash
# 공개
curl "http://localhost:8000/health"

# 어드민 (X-Admin-Key 필요)
curl -H "X-Admin-Key: $ADMIN_KEY" "http://localhost:8000/v1/ops/metrics"
curl -H "X-Admin-Key: $ADMIN_KEY" "http://localhost:8000/v1/debug/ingest"
```

## 부하 테스트 (선택)

### k6 (추천)
```bash
# k6 설치 후
k6 run --vus 50 --duration 30s scripts/k6_chart_load.js
```

### Apache Bench
```bash
ab -n 1000 -c 10 "http://localhost:8000/health"
ab -n 500 -c 5 "http://localhost:8000/v1/charts/candles?symbolId=BTCUSDT&timeframe=1m&limit=100"
```

## CI/CD 통합
```yaml
# .github/workflows/ci.yml 에 추가
- name: API Regression Test
  run: bash scripts/release_check.sh
```
