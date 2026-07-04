# Chart-OS — AI 차트 분석 시스템

실시간 암호화폐 차트 + AI 분석 + 뉴스 요약 + 가격 예측을 제공하는 올인원 트레이딩 플랫폼.

## 주요 기능

- 실시간 차트 (Binance/Upbit WebSocket)
- AI 차트 분석 (추세, RSI, MACD, 매물대, 패턴)
- AI 가격 예측 (Transformer 모델)
- LLM 자연어 해설 (Ollama + kanana-chart)
- 뉴스 수집 + AI 요약
- 알림 시스템
- 사용자 인증 + 워치리스트

## 🆕 2026-07-04 결제/레퍼럴/포인트/관리자 고도화 (핵심 백엔드)

- 대상 모듈:
  - `src/api/purchases.py`
  - `src/api/referral.py`
  - `.env.example`
- 개선 내용:
  - 결제 웹훅 엔드포인트 추가: `POST /v1/purchases/webhook/payment`
    - HMAC-SHA256 서명 검증 (`PAYMENT_WEBHOOK_SECRET`)
    - 멱등 처리 (`payment_events`의 `provider + event_id` unique)
    - 주문 상태(`pending/paid/failed/canceled`) 반영
    - 결제 성공 시 레퍼럴 첫 결제 보상 `on_payment()` 원자적 연동
  - 구매 플로우 고도화:
    - `POST /v1/purchases/buy` 시 `order_id` 발급
    - `GET /v1/purchases/mine`에 `order_id`, `payment_ref` 노출
  - 레퍼럴 정합성 강화:
    - 월 지급 상한(`MONTHLY_REFERRAL_CAP`) 실제 적용
    - 이메일 인증 보상/첫 결제 보상 멱등 강화
    - `registered → verified → paid` 상태 전이 보강
    - point_lots 존재 시 자동 연동(만료/FIFO 정책과 정합)
  - 관리자 운영 API 추가:
    - `GET /v1/referral/admin/integrity-check` (이상 데이터 탐지)
    - `POST /v1/referral/admin/reconcile` (건별 복구, dry-run 지원)
    - `GET /v1/purchases/admin/payments` (결제 이벤트 감사 조회)
  - 관리자 UI 연동(`templates/admin.html`):
    - 포인트/레퍼럴 탭에서 정합성 점검 결과 테이블 실시간 조회
    - `referred_id` 기준 dry-run/실행 복구 폼 제공
    - 결제 이벤트 감사 로그 페이지네이션 조회(최근 이벤트 추적)

## 🆕 2026-07-04 랜딩 SEO/디자인 고도화

- 대상 페이지: `https://chart.beomonnuri.com/landing`
- 핵심 키워드 반영: `AI 지표`, `AI자동분석`, `AI 차트`, `AI 차트분석`, `퀀트`
- 개선 내용:
  - 메타 태그(Title/Description/Keywords/OG) 정교화
  - `SoftwareApplication + FAQPage + BreadcrumbList` 구조화 데이터(JSON-LD) 고도화
  - 검색 의도 중심 키워드 섹션 + 성능 기준(지연시간/정확도/자동화율/안정성) 섹션 추가
  - 회사 홈페이지 톤앤매너(와인 컬러·모노 라벨·엔터프라이즈 카피) 반영
  - 푸터에 회사 홈페이지(`https://beomonnuri.ai/`) 연결 추가

## 🆕 2026-06-22 워치리스트 가시성/가격 커버리지 고도화

- `static/js/modules/watchlist.js`
  - 기본 가격 필터 정책을 `all` 중심으로 조정: 가격 미확인 종목도 리스트에서 유지하고 상태 배지로 안내
  - 가격 수집 안정화: in-flight lock + 1.2초 cooldown 추가로 중복 호출/레이스 완화
  - 누락 티커 보강 범위 확대(`MAX_FILL` 동적 상향) + 현재 선택 종목 우선 보강
  - 가격 맵 조회 시 캐시 fallback(`_wlPriceCache`) 적용으로 순간 API 누락 시 리스트 공백 방지
  - 저커버리지(<35%) 상황에서 1회 자동 재시도해 초기 진입 시 가격 배지 품질 개선
  - 자산 탭 필터를 localStorage(`chartOS_wlAssetFilter`)에 저장/복원
  - `symbolChanged` 시 검색어가 현재 종목으로 잠겨 리스트가 1개만 보이는 상황을 자동 복구
  - 심볼 목록 로컬 캐시(`chartOS_wlSymbolsCache_v1`)를 도입해 네트워크 지연/일시 장애 시에도 워치리스트 즉시 복구
  - 가격 캐시 로컬 복구(`chartOS_wlPriceCache_v1`, TTL 5분) + 초기 렌더 즉시 표시로 `···` 체감 시간 단축
- `static/index.html`
  - 워치리스트 자산 탭에 `전체` 탭 추가 및 기본 활성화

## 🆕 2026-06 실서비스 UX 개선 (실제 차트 페이지)

`static/index.html`, `static/js/page-events.js` 기준으로 실제 서비스 화면 UX를 보강했습니다.

- **빠른 시작 도크 추가**: 첫 진입 사용자가 바로 실행할 수 있는 5단계 액션 제공
  - 종목 찾기 → 5분봉 전환 → AI 분석 탭 이동 → 초보 집중 모드 → 회원가입
- **초보 집중 모드 추가**: 과밀한 화면에서 핵심 조작만 남기도록 토글 제공
  - 관심종목/관심지표 행, 더보기 도구, 일부 보조 정보 숨김
  - `localStorage(chartOS_beginnerFocus)`로 사용자 선택 유지
- **행동 이벤트 계측 추가**
  - `superchart_quick_start_shown`
  - `superchart_quick_start_click`
  - `superchart_quick_start_dismissed`
  - `superchart_beginner_focus_toggled`
- **2차 모바일 UX 강화**
  - 하단 네비 위 `mobileQuickActions`(종목검색/AI분석/가이드/회원가입) 추가
  - `aiIndRunBtn` 식별자 추가로 AI 분석 실행 퍼널 정확도 개선
- **온보딩 퍼널 스텝 추적(세션 기준 1회)**
  - `superchart_onboarding_step` (visit, search_focus, timeframe_select, ai_tab_open, signup_click, ai_analysis_run)
  - `superchart_mobile_quick_action`
- **보조지표 잔상(ghost) 정리 강화 (2026-06-17)**
  - `static/js/main-app.js`에 `__guardSubChartWrites`, `__pruneInactiveSubCharts` 루틴 적용
  - 비활성 토글 상태에서 늦게 도착한 비동기 응답이 `setSubChart()`를 다시 쓰는 문제를 차단
  - `pvi-nvi / patterns / ttr` 드로잉에 `_calcOwner`를 부여하고, 응답 적용 직전 토글 상태 재검증(`!it`, `!Ue`, `!le`) 추가
  - 런타임 진단용 `window.__indicatorResidueProbe()` 노출 (서브차트/지표/드로잉 잔존 탐지)
  - 결과적으로 ON→OFF 반복 시 `subCharts`/`drawings` 내부 잔존 가능성을 낮추는 안전장치 반영
- **오류 복원력/성능 최적화 (2026-06-17 2차)**
  - `static/js/modules/fetch.js`: inflight dedup key를 `method+url+body(+auth)` 기반으로 개선해 잘못된 응답 공유 방지
  - `static/js/modules/fetch.js`: 응답 캐시 상한(`CACHE_MAX`) 추가로 메모리 사용량 급증 방지
  - `static/js/modules/watchlist.js`: 핵심 API 호출을 `dedupFetch`로 통일하고 비정상 응답(JSON 파싱 실패/비OK) 안전 처리
  - `static/js/modules/trend-insights.js`: 중복 로딩 방지(`loading` guard), 비JSON 응답 무시, 비정상 응답 안전 처리
  - `static/js/modules/position-panel.js`: long-short/청산 데이터 호출과 heatmap 계산 시 비정상 수치(NaN/0분모) 방어
  - `static/js/modules/referral-ui.js`: `_safeFetchJson()` 기반으로 레퍼럴/스토어 API 호출 안전화(비JSON/비OK 응답 무시)
  - `static/js/modules/hotmap.js`: ticker 맵 TTL 캐시(8초) + 빈 데이터/실패 UI 처리로 반복호출 부하와 실패 전파 완화
  - `static/js/modules/ai-panel.js`: AI 요약/지표 분석 API를 안전 파서로 감싸 비정상 응답 시 UI 깨짐 방지
  - `static/js/modules/multi-chart.js`: 서브차트/비교차트 데이터 로드 전 구간을 안전 JSON 요청으로 통일해 레이스/파싱 오류 내성 강화
  - `static/js/modules/chart-extras.js`: 비교 심볼 추가 시 응답 상태/콘텐츠타입 검증으로 런타임 예외 방지
  - `static/js/page-events.js`: 모바일에서 quick-start 도크가 다시 노출되는 재오픈 버그 방지(`isMobileView` 고정 제어)
- **릴리즈 직전 핫픽스 (2026-06-17 3차)**
  - `src/main.py`: `/v1/charts/qsignal` 라우터 누락(include) 수정으로 404 제거
  - `src/api/ops/health.py`: 로컬 기본값(DB/Redis 미설정) 환경에서 `db/redis=not_configured` 처리로 헬스 false-degraded 방지
    - 운영 강제 점검 필요 시 `HEALTH_REQUIRE_DB=1`, `HEALTH_REQUIRE_REDIS=1` 사용
  - `static/js/modules/position-panel.js`: `liquidation-heatmap`가 `insufficient data`일 때
    - 사용자 안내 문구 + 재시도 버튼 노출
    - 캔버스/오버레이 정리, 오버레이 버튼 비활성화로 오작동 방지
  - `static/js/auth.js`: 비밀번호 입력 필드를 `<form>` 컨텍스트로 정리하고 `autocomplete` 지정
    - 브라우저 password-field 경고 감소, 엔터 제출 UX 개선
  - QA 결과
    - `scripts/release_check.sh` PASS (10/10)
    - `pytest -q` PASS (6 passed)
    - `/?qa=indicator` residue self-test OK

- **UI/UX·접근성 고도화 (2026-06-17 4차)**
  - `static/index.html`
    - 스킵 링크를 인라인 스크립트 방식에서 `.skip-link` 클래스로 정리(키보드 접근성 개선)
    - `:focus-visible` 포커스 링 추가로 키보드 탐색 가시성 향상
    - `prefers-reduced-motion` 대응으로 모션 민감 사용자 배려
    - Hero CTA/Quick Start 버튼에 `type="button"` 및 구체적 `aria-label` 반영
    - Quick Start 안내문(`quickStartTip`)에 `aria-live="polite"` 적용
    - 중복 `class` 속성 정리(`지표/범온지표/매매전략/드로잉/프리셋`, `ohlcBar`)로 스타일 안정성 개선
  - `static/js/page-events.js`
    - 비네이티브 클릭 요소(`.tb[data-tf]`, `.asset-tab`, `.right-tab`, `.ind-tag`, `.tb-layout` 등)에 키보드 접근성 보강(`tabindex`, `role=button`, Enter/Space 동작)
    - `/` 단축키로 검색창 포커스 이동(입력 중 컨텍스트 제외)
    - `Esc` 키로 빠른 시작 도크 닫기 지원
  - 회귀 결과
    - `scripts/release_check.sh` PASS (10/10)
    - `pytest -q` PASS (6 passed)

- **UI/UX·모바일 사용성 고도화 (2026-06-17 5차)**
  - `static/index.html`
    - 모바일에서 `quick-start-dock`는 숨기고 `mobile-quick-actions`는 유지하도록 정책 조정
    - `mobile-quick-actions`에 `role="navigation"` 및 버튼 `type="button"` 명시
    - 모바일 하단 안전영역(`env(safe-area-inset-bottom)`) 반영으로 네비 충돌 완화
  - `static/js/page-events.js`
    - Quick Start/모바일 퀵액션 표시 상태를 `_syncQuickStartVisibility()`로 일원화(`aria-hidden` 동기화 포함)
    - Hero 오버레이 접근성 개선: 초기 포커스 이동 + `Esc` 닫기 + `Tab` 포커스 트랩
    - 모바일 `가이드` 액션에서 dismiss 해제 후 가이드 재노출 및 Help 패널 연동
  - 회귀 결과
    - `scripts/release_check.sh` PASS (10/10)
    - `pytest -q` PASS (6 passed)

- **UI/UX·온보딩 전환 고도화 (2026-06-17 6차)**
  - `static/js/page-events.js`
    - 초보 집중 모드 버튼 상태 동기화 함수 추가(`_syncBeginnerButtonState`) 및 `aria-pressed` 동기화
    - 첫 방문(`quickStartSeen===1`) 사용자를 위한 시작 액션 하이라이트 + 안내 카피 노출
    - 뷰포트 전환 시(모바일↔데스크톱) Quick Start/모바일 퀵액션 상태 자동 재동기화(`resize` + debounce)
    - 전환 이벤트 계측(`superchart_viewport_mode_changed`) 추가
  - `static/index.html`
    - `quickStartBeginner` 버튼에 `aria-pressed="false"` 기본값 명시
  - 회귀 결과
    - `scripts/release_check.sh` PASS (10/10)
    - `pytest -q` PASS (6 passed)

- **UI/UX·운영 안정화 고도화 (2026-06-17 7차)**
  - `static/js/modules/fetch.js`
    - 반복 재시도 실패 시 단순 문구 대신 원인/행동 가이드가 포함된 Rich Toast로 개선
    - 네트워크 지연 상태를 `chartos:network-state` 커스텀 이벤트로 브로드캐스트
  - `static/js/modules/fetch-csrf.js`
    - fetch 실패 시 `서버 연결 실패` 단문 토스트를 사용자 친화형 안내 토스트로 개선
    - 연결 복구 시 자동으로 `ok` 상태 이벤트 전파해 UI 배너와 동기화
  - `static/index.html`
    - 상단 오프라인 배너를 개선: 상태 문구 + `지금 재시도` 버튼 + 복구 시 자동 숨김
    - 기존 online 즉시 `location.reload()` 제거로 UX 끊김 감소
  - 회귀 결과
    - `scripts/release_check.sh` PASS (10/10)
    - `pytest -q` PASS (6 passed)

## ✅ 현재 운영 유사 점검 상태 (2026-06-17)

- **현재 헬스 상태**: `status=ok`, `redis=ok`, `db=not_configured`
- **의미**:
  - Redis는 실제 연결 검증 완료(OK)
  - DB는 미연결 실패가 아니라, `DATABASE_URL` 미주입 정책에 따른 `not_configured`
- **즉시 운영 기준으로 100% green 하려면**:
  1. 실제 Postgres `DATABASE_URL` 주입
  2. 서버 재기동
  3. `/health`에서 `db=ok` 확인

### 현재 결론
- 프론트 핵심 기능 QA, 회귀 테스트, Redis, 헬스 정책 기준 점검까지는 **정상**입니다.
- 단, **실DB 연동까지 완료된 상태는 아님**(현재 `db=not_configured`).
- 따라서 "모든 것이 완전 정상(운영 DB 포함)"을 확정하려면 `DATABASE_URL` 반영이 마지막 필수 단계입니다.

---

## 📁 프로젝트 구조 (새 개발자용 길잡이)

```
chart-os/
├── src/                  # 백엔드 (FastAPI)
│   ├── main.py           #   앱 진입점 · 라우터 등록 · startup
│   ├── api/              #   HTTP 엔드포인트 (auth, charts, analysis, purchases, ops...)
│   ├── services/         #   비즈니스 로직 (인증, 지표계산, tier_guard...)
│   ├── models/           #   DB 모델(ORM) · 응답 스키마
│   ├── middleware/       #   CSRF, 보안헤더, 압축(brotli/gzip), rate limit
│   ├── ingest/           #   거래소 데이터 수집 (Binance/Upbit WS)
│   ├── ws/               #   WebSocket 서버
│   └── db/               #   DB 세션 · 연결
├── static/               # 프론트엔드 (정적)
│   ├── index.html        #   메인 차트 페이지
│   ├── js/               #   main-app.js(번들) · modules/(원본 모듈) · i18n.js
│   ├── css/main.css      #   전역 스타일 (라이트/다크 테마)
│   ├── coin-logos/       #   코인 로고 · stock-logos/ · brand/(서비스 로고)
│   └── *.html            #   faq · notice · terms · privacy
├── templates/admin.html  # 어드민 대시보드
├── alembic/              # DB 마이그레이션
├── docs/                 # 문서 (배포·QA·리팩토링 기록)
├── src/db/ddl.sql        # 기준 DDL 스키마
├── scripts/release_check.sh  # 출시 전 자동 스모크 점검
├── tests/                # 기본 회귀 테스트
├── render.yaml           # 실서버 배포 설정 (Render)
└── Dockerfile            # 컨테이너 빌드
```

**핵심 흐름**: 사용자가 `static/index.html` → `src/api/*` 호출 → `src/services/*` 로직 → DB.
**배포**: GitHub `main` push → Render에서 수동 Deploy (`autoDeploy: false`).

---

## 🐳 방법 1: Docker Compose (권장 — 가장 간편)

```bash
git clone https://github.com/everyholiday1230/chart-os.git
cd chart-os
cp .env.example .env
cp .env.docker.example .env.docker

# .env: 일반 환경변수 (SECRET 등)
# .env.docker: Docker 컨테이너 전용 네트워킹 설정
#   (DATABASE_URL=postgresql+asyncpg://chart:chart@postgres:5432/chart_os 등)

docker compose up -d

# 첫 실행 시 Ollama 모델 다운로드에 2~3분 소요
# 진행 확인: docker compose logs -f ollama-init
```

접속: http://localhost:8000

```bash
# 종료
docker compose down

# 데이터 포함 완전 삭제
docker compose down -v
```

## 🔧 방법 2: 직접 설치 (setup.sh)

```bash
git clone https://github.com/everyholiday1230/chart-os.git
cd chart-os
chmod +x setup.sh
./setup.sh
```

자동으로 설치되는 것:
- Python 가상환경 + 패키지 (PyTorch CPU 포함)
- PostgreSQL + DB 스키마
- Redis
- Ollama + kanana-chart LLM 모델 (1.8GB)
- systemd 서비스 등록 (선택)

## 수동 실행

```bash
source .venv/bin/activate
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## 출시 전 점검 (권장)

```bash
# 서버 실행 후 자동 스모크 점검
bash scripts/release_check.sh

# 기본 유닛 테스트
python3 -m pytest -q
```

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | 메인 차트 UI |
| GET | `/health` | 헬스체크 |
| POST | `/v1/analysis/chart` | AI 차트 분석 (추세+패턴+예측+LLM) |
| POST | `/v1/analysis/predict` | AI 가격 예측 |
| GET | `/v1/symbols` | 심볼 목록 |
| GET | `/v1/charts/candles` | 캔들 데이터 (symbolId/timeframe/limit) |
| WS | `/v1/ws` | 실시간 WebSocket |
| POST | `/v1/auth/signup` | 회원가입 |
| POST | `/v1/auth/login` | 로그인 |

> 보안 정책: 프로덕션에서는 OpenAPI 문서(`/docs`, `/openapi.json`)가 기본 비활성화(`docs_url=None`)입니다.

---

## 프로젝트 구조

```
chart-os/
├── docker-compose.yml      # 원클릭 Docker 실행
├── Dockerfile              # 앱 컨테이너
├── Modelfile               # Ollama LLM 모델 정의
├── setup.sh                # 직접 설치 스크립트
├── pyproject.toml          # Python 의존성
├── .env.example            # 환경변수 템플릿
│
├── models/                 # AI 모델 (Git에 포함)
│   └── ai_model/
│       ├── model.py        # TradingTransformer 정의
│       └── checkpoints/
│           └── model_BTCUSDT.pt  # 학습된 가중치
│
├── src/
│   ├── main.py             # FastAPI 앱 팩토리 + startup/shutdown
│   ├── config.py           # 환경변수/설정
│   ├── api/                # REST API 라우터 (auth, charts, analysis, site, ops 등)
│   ├── services/           # 비즈니스 로직
│   │   ├── ai_analysis.py      # 지표 기반 AI 분석
│   │   ├── ai_predict.py       # Transformer 가격 예측
│   │   ├── llm_commentary.py   # LLM(Ollama) 해설
│   │   ├── strategy_autobot.py # AI 자동매매 (Paper Trading)
│   │   └── retrain.py          # 모델 재학습
│   ├── db/                 # DB 스키마 / Redis
│   ├── ingest/             # WebSocket/REST 실시간 수집
│   ├── middleware/         # CORS/CSRF/Security/Cookie auth 등
│   ├── models/             # SQLAlchemy 테이블 + Pydantic schema
│   └── ws/                 # WebSocket 게이트웨이
│
├── archive/                # 사용 중단된 이전 모듈 (참조 보존, 프로덕션 제외)
│
├── static/                 # 프론트엔드
│   ├── index.html
│   └── chart-engine/       # 차트 렌더링 JS
│
└── tests/
```

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | `postgresql+asyncpg://chart:chart@localhost:5432/chart_os` | PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis |
| `JWT_SECRET` | `change-me-in-production` | JWT 서명 키 |
| `OLLAMA_URL` | `http://localhost:11434/api/generate` | Ollama API |

## 📦 Archive (보존용)

`archive/` 폴더에는 **사용 중단된 이전 모듈**이 보존되어 있습니다:
- **프로덕션 빌드/테스트에서 제외** (`.dockerignore`, pytest 수집 대상 아님)
- 과거 구현 참조용 (전략 버전, old_modules 등)
- 실제 서비스에는 영향 없음

완전 삭제 대신 보존 이유:
- 향후 재도입 가능성이 있는 전략 파라미터/코드
- git history 로만 찾으면 탐색이 불편

## 🔕 PWA / Service Worker (현재 비활성)

과거에 PWA 지원을 위해 등록됐던 Service Worker 는 **현재 비활성화**된 상태입니다:

- `static/sw.js` — no-op 자가제거 버전 (기존 SW 정리용)
- `static/manifest.json` — PWA 매니페스트 (유지)
- `static/js/ui.js` — `register()` 호출 없음, 기존 등록만 `unregister()`

### 비활성화 이유
UI/디자인 대공사 중 SW 캐싱이 새 배포를 차단해 "새로고침이 안 되는" 문제가 반복 발생.  
`CACHE_VER` 수동 관리 방식이 개발 속도를 못 따라감.

### 재도입 계획
UI 안정화 또는 "앱으로 설치" 피드백 발생 시 재도입 예정.  
자세한 방안은 `docs/SW_PWA_REINTRODUCE.md` 참조.

### 긴급 초기화
브라우저 캐시/쿠키 오염 시 사용자가 `/reset` 접속:
- `Clear-Site-Data` 헤더로 자동 삭제
- 2초 후 메인 페이지로 이동

## 🌐 전역 관리 전략 (window.* → BeomApp 네임스페이스)

### 현재 상태
- JS 파일 간 통신이 `window.*` 전역 기반 (총 182 개)
- ES module 미도입 (`type="module"` 은 `app.js` 만)
- 로드 순서: `init.js` → `api.js` → `namespace.js` → 나머지

### 네임스페이스 구조
`static/js/namespace.js` 가 `window.BeomApp` 객체를 노출:

| 카테고리 | 용도 | 예시 |
|---------|------|------|
| `state` | UI/세션 상태 | `BeomApp.state.curSymbol` |
| `core` | 핵심 객체 | `BeomApp.core.chart`, `BeomApp.core.API` |
| `util` | 유틸 함수 | `BeomApp.util.api`, `BeomApp.util.showToast` |
| `render` | 렌더링 함수 | `BeomApp.render._refreshOverlays` |
| `action` | 사용자 액션 | `BeomApp.action.auth.googleLogin` |
| `data` | 캐시/컬렉션 | `BeomApp.data._favSymbols` |
| `demo` | 데모 모드 | `BeomApp.demo._demoLong` |

### 정책
- **기존 `window.*` 는 유지** — 하위 호환 보장, 런타임 변경 없음
- **신규 전역은 namespace 에만 등록 권장**
- namespace 는 getter/setter 로 window 와 양방향 동기화
- 점진 마이그레이션: 한 번에 하나의 파일씩 `BeomApp.*` 로 호출 전환

### 타입 지원
`static/js/globals.d.js` — IDE 자동완성 / TypeScript check 용 JSDoc 타입 선언.

### 향후 ES module 전환 (장기)
1. Phase 1 ✅ — 네임스페이스 도입 (현재)
2. Phase 2 — 주요 유틸/서비스 ES module 변환 (`api.js`, `namespace.js`)
3. Phase 3 — 카테고리별 모듈 분리 (state/, action/auth/, action/chart/ ...)
4. Phase 4 — app.js 분해 (현재 4,000+ 줄)
5. Phase 5 — build tool 도입 (vite / esbuild)

**예상 총 작업량**: 1~2 주 (전역 참조 수 백 개 치환 필요).  
`window.BeomApp` 은 그동안의 브리지 역할.

## 2026-06-21 안정화 업데이트 (우측 탭: AI/히트맵/포지션)

### 완료된 개선
- AI/히트맵/포지션(및 HOT) 패널 로더에 **중복 호출 방지 가드**를 추가했습니다.
  - 짧은 시간 내 중복 호출 쿨다운(1.2초)
  - 로딩 중 재진입 차단(in-flight lock)
  - 강제 갱신(force) 옵션 분리
- 탭 클릭 시에는 `force: true`로 즉시 갱신하되, 주기 갱신/이벤트 갱신에서는 쿨다운이 적용되어
  불필요한 중복 API 호출과 상태 깜빡임을 줄였습니다.
- 포지션 패널 로더에 예외 안전 처리(try/catch/finally)를 보강하여
  일시적 API 오류 시에도 상태 배지가 일관되게 갱신되도록 개선했습니다.
- 히트맵 모듈 내 깨진 주석 문자열(인코딩 이슈)을 정리했습니다.

### 영향 범위
- `static/js/modules/ai-panel.js`
- `static/js/modules/hotmap.js`
- `static/js/modules/position-panel.js`

### 확인 포인트
- 탭 전환 직후 중복 호출 감소
- 심볼 변경 직후 과도한 재요청 완화
- 주기 갱신 중 상태 배지/메시지 안정성 향상
