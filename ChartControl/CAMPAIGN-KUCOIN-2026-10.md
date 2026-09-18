# KuCoin 공동 캠페인 — 제출한 약속과 이행 사양

작성 2026-09-18. **운영자가 이 내용대로 KuCoin 신청서를 제출했다.**
따라서 아래는 희망사항이 아니라 **이행해야 하는 약속**이다.

캠페인 기간: **2026-10-01 ~ 2026-10-31 (31일)**

---

## 1. 제출한 혜택 4가지

### 혜택 ① 웰컴 포인트 30,000pt
- 대상: 캠페인 기간에 **우리 KuCoin 브로커 링크**를 통해 KuCoin 계정을 만들거나
  연결하고, ChartControl AI 에 가입한 이용자
- 링크: `https://www.kucoin.com/r/broker/CXE8HTY1`
- 지급 시점: **API 키 연결(검증 성공) 후 24시간 내**
- 가치 표기: Pro 플랜 1개월(월 30,000pt, $49) 상당
- 조건: 카드·입금·최소 거래량 요구 없음

### 혜택 ② 영구 무료 등급 — 월 1,000pt
- **이미 있는 기능이다.** 추가 작업 없음.
- 확인: `/api/plans` → `free` 플랜 `monthlyPoints: 1000`

### 혜택 ③ 플랫폼 거래 수수료 0
- **이미 사실이다.** 우리는 거래 수수료를 받지 않는다(약관 제2조6호).

### 혜택 ④ 신호 규칙 저장 5회 무료
- 평시 저장 비용 100pt(`STRATEGY_SAVE_COST.signal`)
- 캠페인 참여자는 **처음 5회 무료**

---

## 2. 이행에 필요한 작업

| # | 작업 | 상태 |
|---|---|---|
| 1 | 캠페인 창(시작·종료) 설정 | **미구현** |
| 2 | KuCoin 키 검증 성공 시 웰컴 포인트 지급 | **미구현** |
| 3 | 브로커 귀속 확인(우리 링크 경유인지) | **미구현** |
| 4 | 신호 규칙 저장 5회 무료 | **미구현** |
| 5 | 무료 등급 월 1,000pt | 이미 있음 |
| 6 | 거래 수수료 0 | 이미 사실 |

### 2-1. 브로커 귀속 확인 — 방법은 있다
`packages/exchange-kucoin/src/broker-rest.ts` 의 `KucoinBrokerClient.getUserList()`
가 **우리 브로커에 속한 이용자 목록**을 준다(`/api/v2/broker/queryUser`, Broker Pro).

★ 도메인 주의(그 파일 머리말 실측): Broker Pro 는 `api.kucoin.com`, Exchange Broker
  는 `api-broker.kucoin.com` 이다. 우리는 이용자가 **자기 키로** 거래하므로 Broker Pro.

즉 이용자의 KuCoin UID 를 알면 귀속을 **확인할 수 있다.** UID 는 키 검증 시
개인 REST 로 조회한다.

★★ 확인이 실패하면(브로커 API 오류 등) **지급을 보류하고 로그를 남긴다.**
  조용히 주면 귀속되지 않은 계정에도 나가고, 조용히 안 주면 자격 있는 고객이
  약속받은 것을 못 받는다. 둘 다 나쁘므로 **보류 + 운영자 확인** 으로 둔다.

### 2-2. 멱등성
웰컴 포인트는 **1인 1회**다. 기존 포인트 원장의 방어를 그대로 쓴다 —
`uq_points_ref (user_id, reason, ref_type, ref_id)` 유니크 인덱스
(`infrastructure/postgres/0016_points.postgres.sql:154`).
`reason` 을 캠페인 전용 값으로 두고 `ref_id` 에 이용자 id 를 넣으면 두 번 들어가지 않는다.

---

## 3. 신청서에 쓴 문구 (영문, 제출본)

이 문구가 곧 약속이다. 기능이 이 문구와 어긋나면 **문구가 아니라 기능을 고친다.**

```
1) 30,000 welcome points (worth one month of our Pro plan, $49) — free
   Step 1 — Open a KuCoin account (or link your existing one) via
            https://www.kucoin.com/r/broker/CXE8HTY1
   Step 2 — Sign up at https://chartcontrol.onrender.com
   Step 3 — Connect your KuCoin API keys (read + trade only; do NOT grant
            withdrawal permission — we never need it)
   Step 4 — Points are credited automatically to your account balance.
   No credit card, no deposit, and no minimum trading volume required.

2) Permanently free tier — 1,000 points every month, for everyone

3) Zero platform trading fees, forever

4) Your own signal rules — 5 free saves during the campaign
   Normally 100 points per saved rule; the first five are free for campaign
   participants.

CONDITIONS
   One benefit set per person. Duplicate or automated accounts are excluded.
   Points have no cash value, are not withdrawable and are not transferable.
   Benefits are credited within 24 hours of API-key connection.
   Support: support@beomonnuri.com
```

★ "Points have no cash value, are not withdrawable and are not transferable" 를
  적었다. 포인트를 현금성으로 오해하게 만들면 안 되므로 이 문구를 화면에도 유지한다.

---

## 4. 운영자 몫

- [ ] Render env `LEGAL_VERSION` → `2026-09-18` (약관 개정 게시 + 기존 고객 재동의)
- [ ] 캠페인 창 env 설정 (아래 이행 작업이 끝난 뒤)
- [ ] 캠페인 종료 후 KuCoin 리베이트 내역과 지급 내역 대조
- [ ] 지급 보류된 건(귀속 확인 실패) 검토

---

## 5. 사업 소개 (제출본, 118 단어)

```
ChartControl AI is a non-custodial trading terminal for KuCoin. Traders connect
their own KuCoin API keys, and every order they approve is transmitted straight
to their own exchange account — we never hold funds, never trade on our own
initiative, and charge no trading fees.

What sets us apart is that the analysis is the trader's own. Alongside 27 built-in
indicators, users write their own indicators and signal rules as formulas, and the
chart marks each candle where their condition occurred, naming the rule and the
timestamp so a detection is never mistaken for a forecast. An AI copilot reads the
same chart and explains what it shows.

We earn only from optional paid plans and KuCoin's broker programme, never from
our users' losses.
```

★ 이 소개문의 주장은 모두 사실이어야 한다. 특히:
  · "27 built-in indicators" — `AI_INDICATORS` 27종, `indicator-parity.test.ts` 가 잠근다
  · "users write their own indicators and signal rules as formulas" — DSL 23함수
  · "naming the rule and the timestamp" — 마커 라벨에 규칙명·건수를 적는다
  · "charge no trading fees" — 약관 제2조6호
  · "never from our users' losses" — 리베이트는 거래량 기준이고 손익과 무관하다
