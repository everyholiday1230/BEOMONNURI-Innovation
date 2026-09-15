# 트레이딩 대회 운영 흐름 — 참가 → 집계 → 지급 (2026-09-15)

## 0. 지금 상태 (실측 근거)
- 서버 `GET /health` 실측: `tradingMode: MOCK, liveOrdersEnabled: false, killSwitchActive: true`
  → **현재는 모의(페이퍼) 모드다.** 실거래로 만들려면 §2의 절차가 반드시 선행된다.
- 리더보드(`/leaderboard`)는 `trade_journal`의 실현손익 집계로 동작하며,
  상단에 `disclosure: LIVE|PAPER` 로 지금이 실거래 기준인지 모의 기준인지 표시한다.

## 1. 대회 운영 흐름
### 1) 참가
- 별도 신청 없이 기간 중 거래하면 자동 집계된다(저널 기록 = 참가 기록).
- 운영자가 공지(`/admin/notices`)로 대회 기간·규칙·상품을 고지한다.
- 규칙에 반드시 적을 것: 집계 기준(실현손익, 수수료 포함), 기간(UTC), 상품, 지급 시점.

### 2) 집계 (리더보드)
- 기준: `trade_journal.realized_pnl` 합계(수수료는 이미 PnL에 반영 — 기록 시점에 서버 계산).
- 화면: `#/leaderboard` — 7일/30일/전체 창, 순위·별칭(Trader#XXXXXX 익명)·실현손익·수수료·거래수·승률.
- API: `GET /api/competition/leaderboard?window=7d|30d|all&limit=N` (공개, 읽기 전용).
- 정직성 규칙: 서버가 DB에서 직접 집계한다(클라이언트 제출 금지 — 분석 저널과 같은 원칙).
  손익 미확인 기록은 임의 추정하지 않는다.

### 3) 지급
- 포인트 상품형: `/admin/points` 의 competition 카탈로그로 지급 → 포인트 원장에
  `competition_prize` 로 기록(사용자 화면 포인트 내역에 그 이유로 보인다).
- USDT 직접 지급(실머니 대회): 온체인 송금 후 `/admin/cs` 티켓 또는 공지로 사실 기록을 남긴다.
  자동 지급 경로는 없다 — 수동이며, 그 사실을 공지에 명시해야 한다.

## 2. 실거래 전환 절차 (운영자 몫 — 미완료 상태)
1. `CREDENTIAL_KEK` 설정 — 미설정이면 프로덕션 부팅이 **거부**되도록 설계돼 있다.
   기존 자격증명은 `apps/api/scripts/rewrap-credentials.mts` 로 재래핑.
2. 거래 스위치 3종: `LIVE_EXECUTION_MODE` 를 LIVE_TRADE 계열로, `LIVE_TRADING_ENABLED=true`,
   `EMERGENCY_KILL_SWITCH=false`. (지금은 3개 전부 차단 조건 — 부팅 로그 실측 "LIVE ORDERS BLOCKED")
3. 전환 후 반드시 확인: `/health` 의 `tradingMode` 와 리더보드 상단 배지가 `LIVE` 로 바뀌는지.
4. 비상 정지: `EMERGENCY_KILL_SWITCH=true` 로 되돌리면 즉시 주문 차단(킬스위치).

## 3. 운영 체크리스트 (대회 개시 전)
- [ ] 공지 게시(기간·규칙·상품·지급 시점)
- [ ] 리더보드 배지가 기대 모드(PAPER/LIVE)와 일치하는지 확인
- [ ] 상품 지급 담당자·지급 기록 방식 지정
- [ ] 종료 후 순위 캡처 보관(분쟁 대비) — API 응답 JSON 저장
