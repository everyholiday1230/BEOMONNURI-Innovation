# BEOMONNURI Homepage v2 — 인계 문서

**작업일:** 2026-07-02  
**작업 요청:** 권누리 대표님 · 이혜원 대표님  
**상태:** ✅ 최신 버전 (v2 — 인터랙션 개선 반영)

---

## 📦 폴더 구조

```
homepage2/
├── index.html                    # 홈 (Living Intelligence OS 랜딩)
├── products.html                 # 제품 인덱스 (4개 카드 그리드 + 비교표)
├── products-private.html         # 01 — 범온 프라이빗 AI 상세
├── products-agent.html           # 02 — 범온 에이전트 AI 상세
├── products-superchart.html      # 03 — 범온 슈퍼차트 AI 상세
├── products-apartment.html       # 04 — 범온 공동주택 관리 AI 상세
├── cases.html                    # 도입 사례 (10개+)
├── why.html                      # Why BEOMONNURI
├── contact.html                  # 도입 진단 신청 폼
└── assets/
    ├── favicon.svg
    ├── og-image.png              # 소셜 공유 이미지
    ├── css/  (5개)
    ├── js/   (6개)
    └── img/  (팀 사진 4장 + 스튜디오)
```

---

## ✨ 이번 세션 주요 변경사항

### 1. 제품 라인업 축소 (6개 → 4개)
- **제거된 제품:** 범온 농산물 출하 AI, 범온 원자재 조달 AI
- **유지된 4개:**
  - 01 · **프라이빗 AI** (사내 지식 검색 · RAG · RBAC)
  - 02 · **에이전트 AI** (업무 자동화 · HITL)
  - 03 · **슈퍼차트 AI** (금융 리서치 · 시장 신호)
  - 04 · **공동주택 관리 AI** (민원·시설·회계·공지)

### 2. 제품 상세 페이지 분리
- 이전: `products.html` 한 페이지에 6개 제품 모두 나열
- 이후: `products.html` (인덱스 + 비교표) + `products-*.html` (4개 개별 상세 페이지)
- 각 상세 페이지에 `.prod-nav` (prev/next) 컴포넌트 추가

### 3. 홈페이지 SECTION 03 · 제품 카드 그리드 리레이아웃
- 3-col → **2×2 그리드**로 변경 (4개 제품에 균형 있게 맞춤)
- 카드 padding 확대 (36→44px), 타이틀 크기 확대 (30→34px)

### 4. products.html 제품 카드 hover 인터랙션 개선
- 이전: 밋밋한 `bg-deep` 배경 전환
- 이후: 홈페이지 `.svc` 카드와 동일한 **acid 붉은색 배경 + 흰 텍스트 전환** (0.4s cubic-bezier)
- 태그, 화살표, 서브텍스트도 hover 상태에 맞춰 함께 전환

### 5. 최신 기술 효과 항상 실행 보장 ⭐
- 이전: `prefers-reduced-motion: reduce`가 활성화된 환경에서 WebGL/캔버스 애니메이션 스킵
- 이후: **모든 미디어 쿼리와 JS 가드를 무력화** — 브랜드 경험 우선
- 영향 파일:
  - JS 5개 (`ai-frontier.js`, `v5-nextgen.js`, `core.js`, `v5-anchor.js`, `v5-webgpu.js`)
  - CSS 5개 — `@media (prefers-reduced-motion: reduce)` → `@media not all and (...)` 로 변경하여 매칭 불가로 만듦
- 항상 렌더링되는 효과:
  - 히어로 3D 신경망 파티클 (Three.js)
  - 액체 셰이더 배경 (`#liquid-hero`)
  - Three.js 유리 반사 orbs
  - 파트너 3D 실린더 회전
  - 파이프라인 캔버스 애니메이션
  - WebGPU 파티클 (마우스 추종)
  - 마우스 트레일 · scroll-reveal

### 6. 캔버스 CSS 사이즈 명시
- `#hero-canvas`, `#liquid-hero`, `#glass-orbs`, `#mouse-trail`에 `width: 100%; height: 100%` 명시적으로 추가
- 일부 브라우저에서 캔버스가 300×150 기본 크기로 축소되는 이슈 방지

### 7. 사이트 전역 정합성 업데이트
- `index.html` 히어로: "N° 06" → "N° 04"
- 모든 페이지 `footer` Products 링크 4개로 축소
- `cases.html` FEATURED CASE 4개 & 하단 리스트 6개로 재구성 (FARM·COMMODITY 케이스 제거)
- `contact.html` 도입 진단 폼 관심제품 체크박스 4개로
- AI 챗봇 프롬프트 (`ai-frontier.js`, `v5-nextgen.js`) 4개 제품 라인업으로 시스템 프롬프트 수정
- AI 위젯 chip 라벨 "6개 제품 요약" → "4개 제품 요약"
- HUD MODEL 툴팁 "산업 도메인 6개" → "4개"

### 8. CSS 신규 추가 (in `ai-frontier.css`)
- `.products-index` — 인덱스 페이지 2×2 카드 그리드 (hover 인터랙션 포함)
- `.prod-nav` — 상세 페이지 prev/next 네비게이션

---

## 🚀 배포 방법

### 옵션 A: Static Hosting (권장)
1. `homepage2/` 폴더 전체를 웹 서버 루트에 업로드
2. 도메인 연결 (Cloudflare Pages, Netlify, Vercel, GitHub Pages 등)
3. `index.html`이 랜딩 페이지로 자동 서빙됨

### 옵션 B: 기존 사이트 대체
1. 기존 프로덕션 파일 백업
2. `homepage2/` 파일들을 프로덕션 위치로 복사
3. 캐시 무효화 (CDN 사용 시)

### 로컬 프리뷰
```bash
cd homepage2
python3 -m http.server 8000
# → http://localhost:8000
```

---

## ⚠️ 남은 작업 (직원분 마무리 예정)

1. **실제 도메인 연동** — `<link rel="canonical" href="https://beomonnuri.ai/...">` 등 메타 태그의 도메인 확인
2. **Analytics 연동** — GA4 / Amplitude 등 트래킹 스크립트 추가
3. **`hello@beomonnuri.ai` 실제 수신함 연결**
4. **contact.html 폼 백엔드 연동** — 현재는 UI만 있음 (submit endpoint 미연결)
5. **AI 위젯 백엔드 이관** — 현재 `window.genspark.complete` 사용 중, 프로덕션에서는 자체 LLM 엔드포인트로 교체 권장 (시스템 프롬프트는 `assets/js/ai-frontier.js` 및 `v5-nextgen.js`에 하드코딩됨)
6. **이미지 최적화** — team 사진 각 ~2MB, WebP 변환 권장
7. **Open Graph 이미지** — `assets/og-image.png` 최종 확정
8. **접근성 재검토** — Section 5의 `prefers-reduced-motion` 무력화는 클라이언트 지시에 따른 브랜드 경험 우선 결정임. WCAG 2.3.3 (Animation from Interactions) 관련 컴플라이언스가 필요한 시장 진입 시 재검토 권장.

---

## 🎨 디자인 시스템

- **컬러:** `--acid` (#921230 — 브랜드 붉은색), `--paper` (#0d0d0d), `--bg` (#f6f4ef 크림톤), `--mute`
- **폰트:** Archivo Black / Archivo (EN) · Pretendard (KO) · JetBrains Mono (Code)
- **레이아웃:** 12-col container (max-width ~1520px), 100-120px section padding
- **인터랙션:** Grain 텍스처, WebGL 캔버스, cursor ring, mouse trail, scroll progress, 3D 실린더 파트너 마퀴, 히어로 신경망 파티클

---

문의: 이번 작업 관련 컨텍스트는 Genspark 프로젝트에 보존되어 있습니다.
