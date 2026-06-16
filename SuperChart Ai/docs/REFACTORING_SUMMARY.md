# 리팩토링 요약 (2026-05-07 ~ 2026-05-08)

BEOM ON AI 차트 프로젝트의 구조 개선 작업 기록.

## 목표

`main.py`와 `src/api/auth.py` 두 거대 파일을 **도메인별로 분리**하고,
**공통 유틸/헬퍼를 서비스 레이어로 추출**하여 유지보수성과 가독성을 개선.

---

## 결과 요약

### 주요 파일 크기 변화

| 파일 | Before | After | 감소량 |
|------|--------|-------|--------|
| `src/main.py` | ~885 | **419** | −466 (53%) |
| `src/api/auth.py` | 967 | **334** | −633 (65%) |
| `src/models/schemas.py` | 98 | 7개 파일로 분할 | — |

### 새로 생성된 모듈

#### `src/middleware/` (10개 파일, 555줄)
미들웨어 분리 프로젝트 (Task 4–11, 5월 7일 작업):
- `brotli.py` (63줄) — Brotli 압축
- `compression.py` (20줄) — GZip 압축
- `static_cache.py` (29줄) — 정적 파일 Cache-Control
- `cors.py` (50줄) — CORS (환경별 origins 검증)
- `csrf.py` (75줄) — CSRF Double Submit Cookie
- `cookie_auth.py` (33줄) — 쿠키→Bearer 변환
- `security.py` (157줄) — 보안 헤더 + 점검모드 + 응답시간
- `source_protection.py` (35줄) — chart-engine / 시스템 파일 차단
- `body_size.py` (26줄) — 요청 크기 1MB 제한
- `track_visits.py` (42줄) — Rate Limit + 방문 카운트

#### `src/api/ops/` (2개 파일, 349줄)
운영 엔드포인트 분리:
- `health.py` (81줄) — `/health`
- `ops.py` (268줄) — `/v1/ops/*`, `/v1/debug/ingest`, `/v1/stats/visits`

#### `src/models/schemas/` (7개 파일, 196줄)
Pydantic 스키마 도메인별 분리:
- `common.py` (43줄) — Meta, ApiResponse, ErrorDetail, ApiError, PagedData
- `auth.py` (36줄) — SignupRequest, LoginRequest, TokenPair, UserOut
- `symbols.py` (22줄) — SymbolOut
- `charts.py` (18줄) — CandleOut
- `alerts.py` (17줄) — AlertCreateRequest
- `ai.py` (15줄) — AnalysisRequest

#### `src/services/` (신규 4개 파일, 565줄)
비즈니스 로직/헬퍼 분리:
- `env_check.py` (147줄) — 환경변수 기능별 상태 점검 + prod 필수 키 검증
- `auth_helpers.py` (118줄) — set_auth_cookies, effective_tier, Bitmart/Bitget 검증
- `admin_helpers.py` (207줄) — admin 세션/쿠키/Redis 레지스트리
- `visit_tracker.py` (93줄) — 방문 통계 (파일 기반 저장)

#### `src/api/` (auth 도메인 분리, 779줄)
- `auth.py` (334줄) — 핵심 user 인증 + 라우터 병합
- `auth_admin.py` (417줄) — 관리자 전용 10개 엔드포인트
- `auth_exchange.py` (208줄) — 거래소 인증 7개 엔드포인트
- `auth_oauth.py` (154줄) — Google OAuth

### 공개 API 경로 변화
**0건** — 모든 엔드포인트 경로 유지. `prefix=/v1/auth`가 sub-router에 상속됨.

### 하위 호환성
**완전 보존**. 모든 기존 import 경로 유지:
- `from src.api.auth import _verify_admin_cookie_async` ✅
- `from src.api.auth import _auth_admin_check` ✅
- `from src.models.schemas import SignupRequest` ✅

---

## 완료된 Task

| # | 작업 | 커밋 | 효과 |
|---|------|------|------|
| 1 | scripts/ 폴더 분류 | `6c3833f` | 25개 스크립트 4개 하위 폴더 |
| 2 | utils/validators.py | `7a9f11e` | 공용 검증 함수 |
| 3 | utils/constants.py | `f1b721c` | 전역 상수 |
| 4 | Brotli 미들웨어 | `6898499` | main.py −37줄 |
| 5 | GZip + 캐시 | `f24c0d3` | main.py −18줄 |
| 6 | CORS | `53a0dd2` | main.py −22줄 |
| 7 | CSRF | `a377b83` | main.py −24줄 |
| 8 | 쿠키→Bearer | `a22d4bf` | main.py −6줄 |
| 9 | body_size + source_protection | `ea5fd34` | main.py −13줄 |
| 10 | security_headers + track_visits | `cff70d7` | main.py −108줄 |
| 11 | 환경변수 상태 로깅 | `ab74e1d` | feature.status 로그 |
| 12 | prod 필수 키 검증 | `9a3074b` | enforce 함수 |
| 13 | 빈 except 로깅 | `e090426` | 7건 개선 |
| 14 | /health 분리 | `568f705` | main.py −43줄 |
| 15 | /v1/ops/* 분리 | `ddb52c6` | main.py −212줄 |
| 16 | /v1/stats/visits | `926c04f` | ops 통합 |
| 17 | schemas 패키지 | `7d8cb84`, `db564b3` | 6개 도메인 |
| 18 | auth_helpers | `0089c97` | auth.py −60줄 |
| 19 | admin_helpers | `0f70ea4` | auth.py −108줄 |
| 20 | auth_oauth | `752936c` | auth.py −82줄 |
| 21 | auth_exchange | `9a15990` | auth.py −103줄 |
| 22 | auth_admin | `8dd7af0` | auth.py −291줄 |

### 버그 픽스 (부가)
- compare.js → app.js window 전역 참조 (`68b5274`)
- /auth/me 401 콘솔 노이즈 (`6a18b2c`)
- AI 시그널 종목 등록 3버그 (`4195209`)
- AI 목표 지표 로그아웃 후 안 보이는 버그 (`3fbe925`)

---

## 검증 결과

### 최종 회귀 테스트 (2026-05-08)

**정상 동작 확인 (17/17 PASS):**
- 비인증 GET 엔드포인트: `/`, `/health`, `/v1/symbols`, `/v1/charts/candles` → 200
- 인증 필요 GET: `/v1/auth/me` (no auth) → 401
- Admin 보호 엔드포인트 (GET + POST): 모두 403
- Ops 엔드포인트 5개: 모두 403

**인증 플로우 완전 동작:**
- signup → True
- login → True
- /me (쿠키) → True
- profile 수정 with CSRF → True
- profile 수정 without CSRF → 403 (CSRF 보호 정상)
- verification-status → none
- request-verification (bitget) → pending
- logout → 200

**미들웨어 정상:**
- CORS preflight: `access-control-allow-origin: http://localhost:3000`
- Brotli: 52,726 bytes (app.js)
- GZip: 59,542 bytes
- 정적 캐시: `public, max-age=31536000, immutable` (?v= 有)

**소스 보호:**
- `/.env` → 404
- `/src/main.py` → 404
- `/chart-engine/*.js` (no referer) → 403

**기존 테스트:**
- pytest 340개 수집 정상
- 에러 로그 0건

---

## 구조 개선 원칙

모든 작업에 일관되게 적용된 원칙:

1. **baseline 기록 → 변경 → 검증 → 커밋** (원자 단위)
2. **하위 호환 alias 유지** — 기존 코드가 깨지지 않도록
3. **동작 변경 금지** — 순수 구조 개선만 (버그 픽스는 별도 커밋)
4. **파일 이동과 로직 변경 분리** — 한 번에 하나만
5. **의존성 주입 패턴** — `register(app, logger, metrics)` 형태
6. **도메인별 응집도** — 관련 기능끼리 같은 파일
7. **순환 참조 회피** — 지연 import 적극 사용

---

## 유지보수 가이드

### 새 미들웨어 추가 시
```python
# src/middleware/my_middleware.py
from fastapi import FastAPI

async def _my_middleware(request, call_next):
    ...
    return await call_next(request)

def register(app: FastAPI) -> None:
    app.middleware("http")(_my_middleware)
```
그리고 `src/main.py`에서 import + `_register_my_middleware(app)` 호출.

### 새 API 라우터 추가 시
```python
# src/api/my_feature.py
from fastapi import APIRouter
router = APIRouter()

@router.get("/endpoint")
async def handler(): ...
```
그리고 `src/main.py`의 `include_router` 섹션에 추가.

### 새 Pydantic 스키마 추가 시
도메인에 맞는 `src/models/schemas/<domain>.py` 에 추가.
단일 파일로 재통합 필요하면 `__init__.py`의 re-export 참고.

### auth 하위 기능 추가 시
- 일반 사용자 기능 → `src/api/auth.py` (메인 router)
- 관리자 기능 → `src/api/auth_admin.py`
- 거래소 관련 → `src/api/auth_exchange.py`
- 소셜 로그인 → `src/api/auth_oauth.py`
- 공용 헬퍼 → `src/services/auth_helpers.py` 또는 `admin_helpers.py`

### 환경변수 추가 시
`src/services/env_check.py`의 `_FEATURES` 에 키 그룹 추가 →
기동 시 `feature.status` 로그에 자동 포함.

---

## 남은 작업 (향후)

---

## 추가 작업 (2026-05-08 새벽~아침 프론트엔드 정리)

백엔드 리팩토링 이후 진행한 프론트엔드 구조 개선:

### C단계: 공용 fetch 래퍼 (api.js)
**커밋**: `996ab2f`

- `static/js/api.js` (139줄) 추가
  - `window.api.get/post/put/del/patch/raw`
  - CSRF 토큰 자동 첨부 (POST/PUT/DELETE/PATCH)
  - 401 감지 → 세션 만료 처리
  - 객체 body → JSON 자동 변환
- `app.js`의 POST/DELETE 11곳을 `window.api.*`로 교체
- `index.html`에 api.js 로드 추가

**실질 효과**: 로그인 상태에서 CSRF 실패로 조용히 거부되던 POST 요청들 (알림 생성/삭제, 차트 설정 저장 등)이 이제 정상 동작.

### B단계: admin.html JS 분리
**커밋**: `22cd5d7`

- `static/js/admin.js` (411줄) 신규
  - 다이얼로그 유틸 (adConfirm, adPrompt)
  - 관리자 로직 (사용자/로그/통계/인증/문의/차트설정 탭)
- `templates/admin.html` 596줄 → 204줄 (66% 감소)
- inline `<script>` 2개 블록 제거 → 외부 파일 로드

### A-1단계: app.js 독립 IIFE 추출
**커밋**: `6dba907`

- `static/js/page-events.js` (79줄) 신규
  - 모바일 스와이프 종목 전환
  - 알림 패널 종목 클릭 위임
- `app.js` 4,114 → 4,065줄 (51줄 감소)
- defer 로드로 app.js 이후 실행

### A-3 (Vite 번들러): 보류
현재 프로젝트 규모에선 과잉 투자. ES Module 전환 선행 필요. 팀/사용자 규모 증가 시 재검토.

---

**총 커밋 수 (프론트 작업 포함):** 25개
**새 파일 추가:** 30개
**프론트엔드 파일 크기 변화:**
- admin.html: 596줄 → 204줄 (66% 감소)
- app.js: 4,115줄 → 4,065줄 (1% 감소, 점진 개선)
- 신규 JS 파일 3개 (api.js, admin.js, page-events.js) — 총 629줄

---

**총 커밋 수:** 22개  
**총 변경 파일:** 30+  
**새 파일:** 27개  
**삭제 파일:** 1개 (schemas.py → 패키지로 대체)  
**작업 기간:** 2026-05-07 (주간) + 2026-05-08 새벽 (자동 작업)

---

## 추가 작업 (2026-05-08 아침~오후)

### 실용 개선 3개

#### 작업 1: window 전역 변수 문서화
**커밋**: `2088bdd`

- `docs/GLOBALS.md` (481줄) — 239개 전역 변수 매핑
  - 13개 카테고리로 분류 (인증, 차트, 지표, 알림 등)
  - 각 심볼의 정의 위치 + 참조 수
  - 미사용/미정의 참조/TOP 20 섹션
- `scripts/generate_globals_doc.py` — 언제든 재생성 가능

#### 작업 2: overlay.js JSDoc 추가
**커밋**: `f0c263d`

- 1,173줄 → 1,279줄 (주석만 +106줄)
- 클래스 최상단 JSDoc (28개 렌더 메서드 요약)
- 6개 공용 메서드 JSDoc
- 4개 섹션 구분 주석

#### 작업 3: 드로잉 도구 UX 개선
**커밋**: `0498a14`

- 수평선/텍스트 '모드' 방식 추가 (모바일 지원)
- 텍스트 드로잉: 2단계 prompt → 클릭 위치에 바로 입력
- 드로잉 리스트에 개별 삭제 버튼 (×)
- hline은 가격, text는 미리보기 표시

### 새 기능 3개

#### 작업 4: 모바일 반응형 개선
**커밋**: `ca1fab1`

- BEOM 시그널 그리드 3열 → 2열
- 토스트 컨테이너 화면 꽉 채움
- 모달 95vw 전체 사용
- input/select/textarea font-size 16px (iOS 자동 줌 방지)
- 초소형(374px) 전용 규칙 추가

#### 작업 5: 알림 발동 이력 UI
**커밋**: `6c700db`

- 백엔드: `GET /v1/alerts/history?limit=30`
  - `last_triggered_at` 있는 본인 알림만 최신순
- 프론트: 알림 탭 하단 `<details>` 접을 수 있는 섹션
- 각 항목 클릭 → 해당 종목 차트 전환
- rule_type 한글화 + 발동 시간 표시

#### 작업 6: 관심종목 정렬 기능
**커밋**: `a7ce086`

- 7가지 정렬 모드:
  - 기본 (시총 순)
  - 등락률 높은순/낮은순
  - 가격 높은순/낮은순
  - 이름 A→Z / Z→A
- 검색창 아래 드롭다운
- localStorage에 선택 저장 (재방문 시 복원)
- 가격 기반 정렬은 데이터 로드 후 자동 재정렬

### 부가 버그 수정

**커밋**: `42184e0` — admin 대시보드 탭 전환 버그 수정
- `showAdminTab`이 `window.`에 등록 안 됨
- 인덱스 기반 섹션 매핑이 실제 DOM과 불일치
- → `data-section` 속성 기반으로 재작성 + `window.showAdminTab` 등록

---

## 최종 지표

**총 커밋 수:** 30개+ (오늘 14개 추가)
**새 프론트 파일:** 5개 (api.js, admin.js, page-events.js + docs/GLOBALS.md + scripts/generate_globals_doc.py)
**회귀 테스트:** 28/28 PASS (test_refactoring_regression.py)

**사용자 직접 가치:**
- 로그인 상태 POST 요청 정상화 (CSRF 자동화)
- admin 대시보드 탭 기능 작동
- 관심종목 정렬 가능
- 모바일 UX 개선
- 알림 이력 확인 가능
- 드로잉 도구 모바일 사용 가능

## 남은 작업 (향후)

- **app.js 추가 분리** — 현재 4,094줄, 독립 섹션 점진 분리 가능
- **tests/test_regression.py 재정비** — 코드 변경 따라오지 못하는 오래된 테스트 수정 필요
- **Redis 기반 multi-worker** — alert_engine 메모리 상태를 Redis로
- **Vite 번들러 도입** — 현재 규모에선 과잉. 팀 커지면 고려
