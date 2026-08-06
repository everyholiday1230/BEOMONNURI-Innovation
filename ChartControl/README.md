# 🚀 QuantumTrade AI — 팀 전달 패키지

**작성**: 권누리 대표님, 이혜원 대표님
**대상**: QuantumTrade AI 엔지니어링 팀
**날짜**: 2026-08-02
**상태**: **프론트엔드 100% 완료** · 백엔드/인프라 개발 대기

---

## ⚡ 빠른 시작

### 1단계 · 로컬에서 실행 (30초)
```bash
# 이 폴더를 압축 해제 후
cd team_delivery/

# 정적 파일 서버 실행 (아무거나 선택)
python3 -m http.server 8080
# 또는
npx serve .

# 브라우저에서 열기:
open http://localhost:8080/index.html
```

### 2단계 · 문서 읽기 (30분)
1. **`HANDOFF_SUMMARY.html`** — 시각적 요약 (42 페이지 · 백엔드 To-Do)
2. **`HANDOFF_TO_ENGINEERING.md`** — 상세 요구사항 (36KB)
3. **`developer-handoff.html`** — 12-섹션 개발 명세 (JSON schema · State map)

### 3단계 · 프로토타입 탐색
- 헤더 우측 **USER / OPS / ADMIN / SUPER** role 스위치 클릭
- 사이드바에서 각 페이지 클릭 → 42개 라우트 전부 실 페이지로 이동
- `Design` · `Handoff` · `Library` 링크로 문서 접근

---

## 📦 이 패키지에 포함된 것

```
team_delivery/
├── 🚀 README.md                      ← 이 문서 (팀 시작 지점)
├── 📄 HANDOFF_TO_ENGINEERING.md      ⭐ 상세 백엔드 요구사항 (필독)
├── 🌐 HANDOFF_SUMMARY.html           ⭐ 시각적 페이지 지도
│
├── 🌐 index.html                     프론트엔드 진입점 (React SPA)
├── 🌐 design-system.html             디자인 시스템 카탈로그
├── 🌐 developer-handoff.html         12-섹션 개발 명세서
│
├── 📁 src/                           프론트엔드 소스코드 (22개 파일)
│   ├── tokens.css                     디자인 토큰 (OKLCH · 4 브랜드)
│   ├── base.css · components.css · widgets.css · pages.css · pages-auth.css
│   ├── icons.jsx                      62 SVG 아이콘
│   ├── mock-data.js · mock-app-data.js · mock-stream.js  ⭐ API 스키마 참조
│   ├── chart-canvas.jsx               Canvas 2D 차트
│   ├── widgets.jsx                    트레이딩 위젯
│   ├── ai-copilot.jsx                 AI Copilot
│   ├── layout-engine.jsx              24-col 그리드 엔진
│   ├── tweaks.jsx                     Tweaks Panel
│   ├── page-shell.jsx                 재사용 PageShell · Sidebar · KPI · Section · Table
│   ├── pages-user.jsx                 사용자 페이지 (Markets · Portfolio · Analytics 등)
│   ├── pages-more.jsx                 사용자 추가 페이지 (Deposit · Withdraw · Referral 등)
│   ├── pages-auth.jsx                 인증 (Landing · Login · Signup · KYC · 404)
│   ├── pages-admin.jsx                관리자 페이지 (Dashboard · Users · AI Ops 등)
│   ├── pages-admin-more.jsx           관리자 추가 (KYC · Broadcast · Notice Editor 등)
│   └── app.jsx                        최상위 앱 (라우팅 · 헤더 · 사이드바)
│
└── 📁 design-library/                재사용 UI 라이브러리
    ├── index.html                      라이브러리 홈 (5단계 워크플로우)
    ├── components/index.html           30+ 컴포넌트 카탈로그 (Copy 가능)
    ├── snippets/index.html             14개 코드 스니펫
    ├── templates/                      페이지 템플릿 5종 (blank/list/detail/form/dashboard)
    └── guide.md                        페이지 · 컴포넌트 추가 가이드
```

---

## 📊 프론트엔드 완성 요약

| 항목 | 개수 | 상태 |
|---|---|---|
| **Routes / Pages** | 42 | ✅ 100% Hi-fi |
| **React 컴포넌트** | 48 | ✅ 모두 mount |
| **재사용 UI Primitives** | 30+ | ✅ 카탈로그화 |
| **디자인 토큰** | 120+ | ✅ 4 브랜드 · Dark/Light |
| **User Roles** | 4 | ✅ User · Ops · Admin · Super |
| **지원 거래소** | 8 | ✅ referral 포함 |
| **인증 플로우** | 6단계 | ✅ Signup → Email → KYC → Login → 2FA → PW Reset |
| **관리자 페이지** | 17 | ✅ Dashboard + 16 detail |
| **Placeholder 페이지** | 0 | ✅ 없음 |
| **Console errors** | 0 | ✅ 클린 |

---

## 🔧 백엔드 팀의 To-Do (10개 카테고리 · P0/P1/P2)

**상세는 `HANDOFF_TO_ENGINEERING.md` 참조. 여기는 요약:**

### 🟥 P0 · 반드시 만들어야 함 (6개)
1. **인증 · 세션** — OAuth · JWT · 2FA · 세션 관리
2. **KYC · 규제 준수** — 서류 업로드 · Face match · PEP/Sanctions · AML
3. **WebSocket · 시세** — 8개 거래소 어댑터 · 캔들 · 오더북 · 체결 스트림
4. **거래 엔진 · 리스크** — Order matching · 마진 · 청산 · Position tracking
5. **지갑 · 자산** — Hot/Cold wallet · Multi-sig · 블록체인 노드 · 입금 감지
6. **AI 모델** — LLM 백엔드 · SSE 스트리밍 · Tool calling · Prompt versioning

### 🟨 P1 · 중요 (3개)
7. **관리자 백엔드** — 유저 관리 · 감사 로그 · Broadcast
8. **Referral · 수수료 · 프로모션** — 티어 자동 계산 · **30% 페이백** · 매월 정산
9. **알림 · CS** — Push (FCM/APNs) · Email · SMS · CS 티켓

### 🟩 P2 · 향후 (1개)
10. **확장** — 모바일 앱 · 백테스트 엔진 · Copy trading · Developer API

---

## 🎯 프론트엔드 → 백엔드 API 매핑 가이드

**`src/mock-app-data.js`가 곧 API 스키마입니다.** 백엔드에서 API를 만들 때 이 파일의 데이터 구조를 그대로 사용하세요.

예:
```javascript
// Frontend가 기대하는 응답 형태:
window.QTApp.EXCHANGES = [
  {
    id: 'binance',
    name: 'Binance',
    referral: 'https://accounts.binance.com/register?ref=QUANTUM-KURI',
    referralNote: '수수료 20% 페이백',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    required: ['apiKey', 'apiSecret'],
    // ...
  },
];

// Backend가 만들어야 할 endpoint:
GET /api/v1/exchanges  →  응답 스키마는 위와 동일
```

주요 mock → API 매핑:
- `EXCHANGES` → `GET /api/v1/exchanges` (거래소 리스트 · referral 포함)
- `USER` → `GET /api/v1/me` (현재 유저)
- `NOTIFICATIONS` → `GET /api/v1/notifications?filter=`
- `STRATEGIES` → `GET /api/v1/strategies?filter=&sort=`
- `TRADE_JOURNAL` → `GET /api/v1/analytics/journal`
- `ADMIN_USERS` → `GET /api/admin/users?q=&status=`
- `ADMIN_LIVE_TRADES` → `WS /admin/trades/stream`
- `ADMIN_RISK_QUEUE` → `GET /api/admin/risk/queue`
- `ADMIN_AI_METRICS` → `GET /api/admin/ai/metrics`
- (전체 매핑은 `HANDOFF_TO_ENGINEERING.md` 참조)

---

## 🏗️ 팀 이 프론트엔드를 어떻게 활용할 수 있나요?

### 옵션 A · 이 프론트엔드 그대로 배포 (빠른 MVP)
- 이 프로토타입은 사실상 **static SPA**입니다
- Nginx/CDN에 그대로 올리고, mock 데이터 부분만 실 API 호출로 교체
- 예상 소요: **API 통합 2-3주** + 백엔드 개발과 병렬 진행

### 옵션 B · 정식 프레임워크로 리팩터링 (권장)
- React 18 + TypeScript + Vite + Tailwind + Zustand 조합
- 이 프로토타입의 **컴포넌트 구조 · 디자인 토큰 · mock 데이터 스키마** 그대로 이식
- 예상 소요: **프론트엔드 리팩터링 4-6주** (기존 코드 참고하면 빠름)

### 옵션 C · Next.js SSR 프로덕션 앱
- SEO 필요한 랜딩 · 로그인 등은 SSR
- 트레이딩 앱은 CSR (React SPA)
- 예상 소요: 프론트 6-8주

**어느 옵션이든** `src/tokens.css`는 그대로 사용 가능하며,
`design-library/`는 개발 내내 참조 문서로 활용하세요.

---

## 📞 대표님 요청 사항 · 완료 체크리스트

| 요청 | 결과 |
|---|---|
| 관리자 페이지 | ✅ 17개 Hi-fi 완성 |
| 사이드바 실제 페이지 연결 | ✅ 42/42 라우트 |
| 8개 거래소 referral 링크 | ✅ mock-app-data.js에서 한 곳 편집 |
| 회원가입 (우리 페이지) | ✅ Signup + Email + KYC 3단계 |
| Login · 2FA · PW reset | ✅ 모두 hi-fi |
| 재사용 디자인 라이브러리 | ✅ /design-library/ 완성 |
| Role 기반 사이드바 | ✅ 4 role 실시간 스위치 |
| Multi-Chart 별도 페이지 | ✅ /multi-chart · 4 레이아웃 |
| 관리자 KYC/Deposit/Broadcast | ✅ 실제 큐/에디터 UI |
| Design Ops (대표님 전용) | ✅ /admin/design-ops (SUPER role only) |
| 모든 페이지 placeholder 없음 | ✅ 확인 완료 |

---

## 🎨 절대 지켜야 할 UX 계약

프론트엔드가 지키는 규칙들 — 백엔드/향후 개발 시에도 유지 필수:

1. **Simulation Stripe** — 데모/페이퍼 모드일 때 상단 노란 스트라이프 상시 표시
2. **Approve Signal ≠ Submit Order** — AI 신호 승인은 오버레이 확정만. 실 주문은 별도 다단계 확인
3. **9-gate Risk Check** — 주문 제출 전 SL/TP 방향 · 청산거리 · 잔고 등 9개 검증
4. **Tabular Numerals** — 모든 가격/수량/퍼센트 `font-variant-numeric: tabular-nums`
5. **색상 + 방향 이중 표기** — Long/Short는 색만이 아니라 ▲/▼ 아이콘 필수 (WCAG)
6. **KYC 없이 거래 불가** — L1 이상만 거래 · L2 이상만 출금
7. **API key Withdraw 권한 절대 금지** — 사용자에게 UI 상시 안내
8. **Referral 링크는 mock-app-data.js에서만 관리** — 8개 거래소 한 곳에서 편집

---

## ✅ 배포 전 최종 체크

- [ ] 이 폴더 전체를 Git 저장소에 커밋
- [ ] `HANDOFF_TO_ENGINEERING.md` 팀 전체 회람
- [ ] 개발 리드에게 `HANDOFF_SUMMARY.html` + 이 README 오리엔테이션
- [ ] P0 6개 카테고리 스프린트 계획 수립
- [ ] `mock-app-data.js` 스키마 → 실 DB 스키마 매핑 회의
- [ ] 8개 거래소 API 계정 발급 · **대표님 referral 링크 확정**
- [ ] AI 모델 벤더 선정 (OpenAI · Anthropic · 자체)
- [ ] 지갑 hosting 결정 (Fireblocks · Custody · 자체 multi-sig)
- [ ] KYC 벤더 선정 (Onfido · Jumio · Sumsub)
- [ ] 인프라 결정 (AWS · GCP · 자체)

---

## 문의 · 이슈

- **디자인 · 프론트 이슈**: 대표님 (권누리 / 이혜원)
- **이 프로토타입의 참조 코드**: `src/` 폴더의 각 `.jsx` 파일 상단 주석 참조
- **Design Library 사용법**: `design-library/guide.md`

---

**🎯 결론: 프론트엔드는 완료. 이제 백엔드만 만들면 됩니다.**

*이 패키지는 QuantumTrade AI · Institutional Cool 브랜드 v1.0 기준입니다.*
*모든 mock 데이터는 결정적(deterministic)이며 실제 자금이 이동하지 않습니다.*
