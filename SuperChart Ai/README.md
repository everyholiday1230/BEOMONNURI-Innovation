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
├── scripts/
│   ├── bots/             #   자동매매 봇 (운영 중)
│   ├── backtest/         #   백테스트 스크립트 (실험용)
│   ├── analysis/         #   데이터 분석 스크립트
│   ├── db/               #   DB 시드/스키마 (ensure_schema, reseed_symbols, seed_faqs)
│   └── manage_bots.sh    #   봇 관리 (start/stop/check) — cron 연동
├── alembic/              # DB 마이그레이션
├── tests/                # 테스트
├── docs/                 # 문서 (배포·QA·리팩토링 기록)
├── archive/              # 보관 (옛 모듈, 백테스트 결과 등 — 운영 미사용)
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
