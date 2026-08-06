# 📖 Design Library — 작업 가이드

**대표님이 이 앱에 새로운 페이지 · 컴포넌트 · 팝업을 추가하실 때 이 문서를 먼저 보세요.**

---

## 목차

1. [폴더 구조](#폴더-구조)
2. [새 페이지 만들기 (5단계)](#새-페이지-만들기-5단계)
3. [새 컴포넌트 만들기](#새-컴포넌트-만들기)
4. [새 팝업/모달 만들기](#새-팝업모달-만들기)
5. [사이드바에 아이템 추가하기](#사이드바에-아이템-추가하기)
6. [거래소·Referral 관리](#거래소referral-관리)
7. [디자인 원칙 (꼭 지켜주세요)](#디자인-원칙)
8. [파일 명명 규칙](#파일-명명-규칙)
9. [디버깅 팁](#디버깅-팁)

---

## 폴더 구조

```
QuantumTrade AI/
├── index.html                    ← 메인 앱 진입점
├── design-system.html            ← 디자인 시스템 문서
├── developer-handoff.html        ← 개발자 핸드오프
├── design-library/               ← 🏗️ 여기가 라이브러리
│   ├── index.html                라이브러리 홈
│   ├── components/index.html     컴포넌트 카탈로그
│   ├── snippets/index.html       코드 스니펫
│   ├── templates/                페이지 템플릿
│   │   ├── blank.html
│   │   ├── list.html
│   │   ├── detail.html
│   │   ├── form.html
│   │   └── dashboard.html
│   └── guide.md                  ← 이 파일
└── src/
    ├── tokens.css                모든 색·타입·간격 토큰
    ├── base.css                  reset · typography · shell layout
    ├── components.css            버튼 · 인풋 · 모달 · 토스트 등
    ├── widgets.css               트레이딩 위젯 스타일
    ├── pages.css                 페이지 셸 · KPI · Section · Table
    ├── icons.jsx                 62개 인라인 SVG 아이콘
    ├── mock-data.js              트레이딩 mock (심볼, 캔들, 오더북)
    ├── mock-app-data.js          앱 mock (⭐ 거래소·유저·관리자·전략 · 편집 가능)
    ├── mock-stream.js            WS mock
    ├── chart-canvas.jsx          Canvas 2D 차트
    ├── widgets.jsx               MarketWatch · Chart · OrderBook 등
    ├── ai-copilot.jsx            AI Copilot
    ├── layout-engine.jsx         24-col grid engine
    ├── tweaks.jsx                Tweaks panel
    ├── page-shell.jsx            ⭐ PageShell · Sidebar · KPICard · SectionCard · DataTable
    ├── pages-user.jsx            ⭐ 사용자 페이지 (Markets, Portfolio, ...)
    ├── pages-admin.jsx           ⭐ 관리자 페이지 (Dashboard, Users, ...)
    └── app.jsx                   메인 App · route dispatch
```

⭐ 표시 파일이 **대표님이 자주 편집할 파일**입니다.

---

## 새 페이지 만들기 (5단계)

### Step 1 · 어떤 종류의 페이지인지 결정
- **리스트 조회** (사용자, 주문, 심볼) → `templates/list.html` 참고
- **상세 화면** (사용자 상세, 전략 상세) → `templates/detail.html` 참고
- **입력 폼** (사용자 생성, 공지 등록) → `templates/form.html` 참고
- **대시보드** (KPI + 차트 + 표) → `templates/dashboard.html` 참고
- **기타** → `templates/blank.html`

### Step 2 · 페이지 컴포넌트 작성
`src/pages-user.jsx` (사용자용) 또는 `src/pages-admin.jsx` (관리자용) 파일에 다음 형태로 추가:

```jsx
window.MyNewPage = function MyNewPage({ shellProps }) {
  return (
    <window.PageShell
      {...shellProps}
      title="My New Page"
      subtitle="이 페이지의 짧은 설명"
      breadcrumb={['Home', 'My New Page']}
      actions={<button className="btn btn--sm btn--primary">Action</button>}
    >
      {/* KPI 4개 */}
      <div className="grid-4">
        <window.KPICard label="Total" value="1,240" tone="brand"/>
        {/* ... */}
      </div>

      {/* Section */}
      <window.SectionCard title="Data">
        <window.DataTable columns={cols} rows={rows}/>
      </window.SectionCard>
    </window.PageShell>
  );
};
```

### Step 3 · Mock 데이터 추가
`src/mock-app-data.js` 안 `window.QTApp` 객체에 데이터 배열 추가.
예: 새 페이지가 "이벤트"라면 `window.QTApp.EVENTS = [...]`.

### Step 4 · 라우트 등록
`src/app.jsx` 안 **ROUTE DISPATCH 블록**에 한 줄 추가:

```jsx
{route.path === '/my-new-page'  && <window.MyNewPage shellProps={shellProps}/>}
```

같은 파일 아래쪽 **fallback 체크 배열**에도 라우트 이름을 추가해서
"Not found"로 잘못 잡히지 않게 하세요:

```jsx
{![
  '/markets', '/portfolio', /* ... existing */
  '/my-new-page',       // ← 추가
].includes(route.path) && (
  <window.PagePlaceholder title="Not Found"/>
)}
```

### Step 5 · 사이드바 등록
`src/page-shell.jsx` 안 `SIDEBAR_ITEMS` 배열에 추가:

```js
{
  section: 'account',         // trading | market | account | admin
  label: 'My New Page',
  icon: 'Sparkles',           // window.Icons key 중 하나
  route: '/my-new-page',
  roles: ['user','ops','admin','super'],  // 이 페이지를 볼 수 있는 role
}
```

✅ 완료! 사이드바 클릭 → 새 페이지로 이동.

---

## 새 컴포넌트 만들기

작은 재사용 컴포넌트 (예: "Feature Card"):

**Step 1 · CSS 추가** — `src/pages.css` 하단에:
```css
.feature-card { padding: 12px; background: var(--color-bg-panel); border-radius: 6px; }
.feature-card__title { font-size: 14px; font-weight: 600; }
```

**Step 2 · React 컴포넌트** — `src/page-shell.jsx` 안:
```jsx
window.FeatureCard = function FeatureCard({ title, children }) {
  return (
    <div className="feature-card">
      <div className="feature-card__title">{title}</div>
      {children}
    </div>
  );
};
```

**Step 3 · 컴포넌트 카탈로그 추가 (선택)** — `design-library/components/index.html`에 새 섹션 추가하여
시각적 프리뷰 + 코드 스니펫 노출.

---

## 새 팝업/모달 만들기

**패턴 1 · 확인 모달** (스니펫 페이지의 "5. Confirmation Modal" 참조):

```jsx
const [open, setOpen] = useState(false);

{open && (
  <div className="overlay" onClick={() => setOpen(false)}>
    <div className="modal" style={{width: 420}} onClick={e => e.stopPropagation()}>
      <div className="modal__header">
        <div className="modal__title">제목</div>
        <button className="btn btn--icon" onClick={() => setOpen(false)}>✕</button>
      </div>
      <div className="modal__body">본문</div>
      <div className="modal__footer">
        <button className="btn btn--sm" onClick={() => setOpen(false)}>취소</button>
        <button className="btn btn--sm btn--primary" onClick={handleOK}>확인</button>
      </div>
    </div>
  </div>
)}
```

**패턴 2 · 사이드 드로어** (Wallet의 Widget Library 참조) — 우측 fixed floating panel:
`.widget-library` 클래스를 참조하여 새 클래스로 복사.

**패턴 3 · Multi-step wizard** — Order Preview Modal (app.jsx) 참조.
`.op-flow-steps` + `.op-grid` + 단계별 body 교체.

---

## 사이드바에 아이템 추가하기

`src/page-shell.jsx`의 `SIDEBAR_ITEMS` 배열 편집. **section**과 **roles**가 중요:

- `section`: `'trading'` · `'market'` · `'account'` · `'admin'` 4개 중 하나
- `roles`: 이 아이템이 보여야 하는 role의 배열
  - `['user','ops','admin','super']` = 모두에게
  - `['ops','admin','super']` = 관리자만
  - `['super']` = 슈퍼 관리자만

새 section을 만들려면 아래 `SECTION_LABELS`에도 추가:
```js
const SECTION_LABELS = {
  trading: 'Trading',
  market:  'Markets',
  account: 'Account',
  admin:   'Admin',
  finance: 'Finance',    // ← 새 섹션
};
```

---

## 거래소·Referral 관리

**거래소 회원가입 링크 (referral)**는 모두 `src/mock-app-data.js` 안 `EXCHANGES` 배열에서 관리됩니다.

새 거래소 추가:
```js
{
  id: 'newexchange',
  name: 'NewExchange',
  logoText: 'Ne',
  logoBg: '#FF6600',
  logoColor: '#FFFFFF',
  market: 'Global · Description',
  supportedProducts: ['Spot', 'Perp'],
  minLatency: 20,
  apiDocs: 'https://newexchange.com/api-docs',
  permissions: ['Read', 'Trade'],
  required: ['apiKey', 'apiSecret'],
  referral: 'https://newexchange.com/register?ref=QUANTUM',  // ⭐ 회원가입 링크
  referralNote: '수수료 30% 페이백',                           // ⭐ 리워드 문구
  status: 'available',        // available | beta | coming-soon
  recommended: true,          // 추천 배지 표시
},
```

이 파일만 편집하면 **Wallet 페이지 · Settings > API keys · 컴포넌트 카탈로그 모두 자동 반영**됩니다.

---

## 디자인 원칙

### ✅ 반드시 따를 것
1. **토큰만 사용** — `var(--color-brand)` `var(--sp-4)` `var(--fs-md)` 등. 임의의 색·간격 금지.
2. **폰트** — 숫자는 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`. 한글은 자동으로 Pretendard.
3. **Directional glyphs** — Long/Short는 항상 `▲` `▼` + 색 함께.
4. **Simulation stripe** — 시뮬레이션 모드일 때 항상 상단 대각선 스트라이프 유지 (프로덕션 시에도 페이퍼 트레이딩엔 필수).
5. **Focus ring** — 모든 인터랙티브 요소에 `:focus-visible { outline: 2px solid brand }`. base.css에 이미 정의.

### 🚫 하지 말 것
1. 임의로 `#F0B90B` 같은 hex 코드를 직접 사용 (거래소 로고 색 같은 브랜드 자산 제외)
2. Long = 초록, Short = 빨강 하드코딩 (`--color-trade-long` / `--color-trade-short` 사용)
3. `font-family: sans-serif` 같은 fallback 하드코딩
4. 색상만으로 상태 전달 (색맹 사용자 접근성)

---

## 파일 명명 규칙

| 종류 | 위치 | 예시 |
|---|---|---|
| 사용자 페이지 컴포넌트 | `src/pages-user.jsx` 안 | `window.MyPage = function...` |
| 관리자 페이지 컴포넌트 | `src/pages-admin.jsx` 안 | `window.AdminMyPage = function...` |
| 재사용 컴포넌트 | `src/page-shell.jsx` 안 | `window.FeatureCard = function...` |
| Mock 데이터 | `src/mock-app-data.js` 안 | `window.QTApp.EVENTS = [...]` |
| CSS 클래스 | BEM-lite | `.feature-card__title` `.feature-card--large` |
| 라우트 | kebab-case | `/user-management` `/admin/design-ops` |

---

## 디버깅 팁

### 페이지가 안 나올 때
1. **콘솔 확인** — Cmd+Opt+I → Console 탭 → 빨간 에러 확인
2. **컴포넌트 이름** — `window.MyPage` 정확히 매치되는가?
3. **라우트 등록** — `src/app.jsx`의 route dispatch에 추가했는가?
4. **fallback 배열** — 라우트를 fallback 배열에도 넣었는가?
5. **mount check** — `index.html`의 `tryMount` 함수에 새 window 컴포넌트 확인 조건 추가

### 스타일이 안 먹을 때
1. **CSS import 순서** — `index.html`에서 `pages.css`가 `widgets.css` 뒤에 오는가?
2. **토큰 사용 확인** — `background: red` 대신 `background: var(--color-danger)`
3. **크로스브라우저** — Chrome dev tools > Elements에서 computed style 확인
4. **캐시** — 큰 변경 후엔 hard reload (Cmd+Shift+R)

### 사이드바에 안 나올 때
1. **role 확인** — 헤더의 role switcher에서 현재 role이 `SIDEBAR_ITEMS[].roles` 에 포함되는가?
2. **section 정의** — 새 section을 썼다면 `SECTION_LABELS`에도 추가?
3. **icon** — `window.Icons`에 없는 icon 이름을 지정하면 fallback으로 Grid 아이콘이 나옴

---

## 자주 쓰는 라우트 목록

**사용자:**
- `/trade` — 메인 트레이딩
- `/markets` — 시장
- `/ai-strategies` — AI 전략
- `/portfolio` — 포트폴리오
- `/analytics` — 분석
- `/multi-chart` — 멀티 차트
- `/wallet` — 지갑 · 거래소 연동
- `/order-history` — 주문 내역
- `/notifications` — 알림
- `/settings` — 설정

**관리자:**
- `/admin` — 대시보드
- `/admin/users` — 유저 관리
- `/admin/trades` — 거래 모니터
- `/admin/risk` — 리스크 큐
- `/admin/assets` — 자산 · 입출금
- `/admin/ai-ops` — AI 운영
- `/admin/fees` — 수수료 · 프로모션
- `/admin/notices` — 공지 · CS
- `/admin/system` — 시스템 상태
- `/admin/audit` — 감사 로그
- `/admin/design-ops` — 디자인 운영 (Super Admin only)

---

## 마지막으로

이 라이브러리는 **살아있는 문서**입니다. 대표님이 새 컴포넌트나 패턴을 만드시면
`design-library/components/index.html`이나 `snippets/index.html`에도 예시를 추가해두시면
다음 페이지 만들 때 재사용하기 편해집니다.

새 라이브러리 파일 위치는 항상 `../src/` 경로가 유효하도록 관리되어야 합니다.

**Happy building! 🚀**
