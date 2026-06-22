# 범온누리 이노베이션 기업 홈페이지

Vite 기반 정적 멀티페이지 사이트 (KR/EN). Cloudflare Pages 배포 전제.
산업 현장 적용성을 앞세운 B2B 기술기업 톤의 절제된 브랜드 사이트.

## 개발 / 빌드

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # dist/ 생성 (22 페이지)
npm run preview  # wrangler pages dev 로 dist 미리보기 (3000)
```

## 구조

- `site.config.js` — **모든 전역 설정의 단일 출처** (도메인·이메일·폼 엔드포인트·회사정보)
- `vite.config.js` — `{{SITE_URL}}`, `{{EMAIL}}`, `{{FORM_ENDPOINT}}`, `{{GOOGLE_SITE_VERIFICATION}}`, `{{NAVER_SITE_VERIFICATION}}` 등 영문 토큰을 빌드 시 치환
- `src/site.js` — 공통 헤더/푸터/모바일내비/스크롤모션/FAQ를 런타임 렌더 (`data-layout="header|footer"` 마운트)
- `src/icons.js` — Lucide 인라인 SVG 레지스트리 (`<span data-icon="...">` 주입, 외부 요청 없음)
- `src/contact-form.js` — 문의 폼 유효성검사 + 제출(엔드포인트 fetch 또는 mailto fallback)
- `src/styles.css` — 디자인 시스템(토큰) + 컴포넌트
- 페이지: `index.html`, `products/*`, `company/`, `contact/`, `privacy/` + `en/` 동일 구조

각 페이지는 `<body data-page data-lang>` 로 컨텍스트만 주면 헤더/푸터가 일관되게 렌더됩니다.

## 디자인 원칙

- 화이트/오프화이트 배경, 브랜드 컬러 `#921230`, 얇은 라인(`--line` / `--line-strong`), 넓은 여백
- 절제된 그림자·라운드(`--radius-xl: 16px`), 호버는 들어올림 대신 라인/색 변화 중심
- 과한 그라데이션·애니메이션·흔한 SaaS 랜딩 느낌 배제
- 홈 히어로 우측 **운영 아키텍처 다이어그램**(데이터 경계 → 운영 지능 코어 → 제품 계층)
- 제품 카드: 제품군별 상단 액센트(단색 명도 변주)로 은근한 차이
- 파트너 섹션은 **로고 only**(중복 텍스트 없음), 로고별 무게 보정 클래스(`.logo-wide/.logo-tall/.logo-mark`)

## 최근 고도화 반영 (2026-06-16)

- 파트너 섹션 로고 광학 밸런스 및 모바일 2열 정렬 안정화
- 제품 상세 우측 히어로 이미지 높이 최적화(과도한 세로 길이 완화)
- 모바일 내비게이션 UX 강화(외부 클릭 닫기, body 스크롤 잠금, 리사이즈 시 상태 정리)
- UI 픽셀 폴리시: 버튼 터치 영역, 카드 타이포 리듬, 비교표/폼 입력 가독성 개선
- 2차 QA 패스: 모바일 내비 스크롤/닫힘 안정화, 비교표 모바일 패딩·가로스크롤 최적화, CTA/문의/리드 텍스트 가독성 개선
- 3차 QA 패스: 전역 터치 타깃 확장(nav/text-link/button), 모바일 타이포 리듬 보정, 문의 입력 영역 가독성 보강
- KR 페이지는 KNAL 한국어 로고 사용, EN 페이지는 영문 KNAL 로고 유지
- 검색 노출 강화: `robots.txt`에 검색/AI 크롤러 허용 정책 명시, `sitemap.xml`에 KR/EN 쌍별 `hreflang` 확장, `public/llms.txt` 추가
- 전환율 우선 1차 고도화: 제품 상세 페이지 공통 전환 블록(도입 적합성 진단 + 신뢰 기준 + CTA) 및 FAQ 아코디언 자동 주입
- 구조화 데이터 강화: 전 페이지 `WebSite`, 제품 상세 `BreadcrumbList`/`FAQPage` JSON-LD 런타임 생성
- 성능 미세 튜닝: 비핵심 이미지 `loading=lazy`, `decoding=async`, `fetchpriority=low` 자동 최적화
- 문의 전환율 2차 고도화: Contact 페이지 헤드라인/버튼 A/B 카피 테스트, 선택 입력(연락처·보유데이터) 접기/열기 도입
- 문의 완료 UX 개선: 제출 후 다음 단계 안내 패널(접수 후 프로세스) 추가
- 전환 측정 이벤트 추가(GA4/gtag 및 dataLayer 병행): `contact_cta_click`, `contact_form_start`, `contact_form_submit_attempt`, `contact_form_submit_success`, `contact_form_submit_failure`, `contact_form_mailto_fallback`, `contact_form_validation_error`
- 홈 레이아웃 고도화: KR/EN 홈에 `Rollout Roadmap`(4단계) 및 `Use Case Preview`(3개 시나리오) 섹션 추가
- 디자인 1차 고도화: 텍스트 변경 없이 패널·카드 레이아웃 밀도/가독 폭/줄바꿈 규칙 정리, 반응형 브레이크포인트(1200/1024/900/760) 미세 조정
- 패널 톤 2안 지원: URL 쿼리 `?tone=minimal` / `?tone=premium` 로 패널 라운드·보더·그림자 스타일 전환
- IA 중복 축소(2026-06-21): KR/EN 홈·제품허브의 대형 FAQ 반복 블록을 전용 FAQ 페이지 유도 섹션으로 정리
- EN Company 페이지에서 Products 허브와 중복되던 대형 Product Portfolio 섹션을 축소하고 탐색 링크로 정돈
- EN Privacy 페이지의 초안성 문구 제거 및 정식 안내 톤으로 교체
- IA 재정렬(2026-06-21): Company 페이지의 제품 중심 블록을 Products 허브로 이동·통합하고, Company를 신뢰/철학/운영원칙/회사정보 중심으로 재구성
- KR/EN Products 허브에 `Industry fit` 섹션을 추가해 산업별 적용 영역과 추천 제품 매핑을 한 화면에서 비교 가능하도록 개선

## 성능 / 에셋

- 주요 이미지는 1600px 리사이즈 + WebP 변환, HTML은 `<picture>`/CSS는 `image-set()`로 WebP 우선 제공(JPG fallback)
- 홈 히어로 배경(`hero-bg`)은 `<link rel="preload" imagesrcset>` 로 LCP 가속
- OG/Twitter 카드: `og-image.png`(1200×630) + width/height/alt 메타
- `npm audit` 0 vulnerabilities (esbuild/ws는 `overrides`로 고정)

## 접근성

- skip link, `word-break: keep-all`(한국어 어절 단위 줄바꿈), 페이지당 h1 1개, 정상 heading 계층
- nav `aria-expanded`/`aria-haspopup`, 제품 드롭다운 키보드/터치 대응
- `focus-visible` 브랜드 컬러 아웃라인(어두운 배경 위는 흰색), 터치 영역 ≥44px
- `prefers-reduced-motion` / `scripting: none` 안전장치

---

## ⚠️ 발행 전 확인 항목 (체크리스트)

### 1. `site.config.js`
- [ ] `EMAIL` — 현재 `beomonnuri@gmail.com`. **실제 운영 이메일 최종 확인**
- [ ] `FORM_ENDPOINT` — 비어 있으면 문의 폼이 mailto fallback. Cloudflare Pages Functions/Formspree 등 설정 시 실제 전송
- [ ] `SITE_URL` — 도메인 변경 시 (현재 `https://www.beomonnuri.com`)
- [ ] `GOOGLE_SITE_VERIFICATION` / `NAVER_SITE_VERIFICATION` — Search Console / Search Advisor 토큰 입력
- [ ] 회사 정보(`CEO_NAME`, `ADDRESS_*`) 최종값 확인

### 2. 개인정보처리방침
- [ ] `{{보유기간}}`, `{{개인정보 보호책임자}}`, `{{시행일}}` — **법무 검토 필수**

### 3. 정적 파일 (도메인 변경 시 함께 교체)
- [ ] `public/sitemap.xml` — `loc`/`lastmod` 및 KR/EN `hreflang` 페어 정합성
- [ ] `public/robots.txt` — Sitemap URL 및 크롤러 허용 정책
- [ ] `public/llms.txt` — 회사/핵심 페이지/정규 도메인 정보 최신화

### 4. 에셋
- [x] `public/assets/og-image.png` — OG/Twitter 카드 1200×630 (`og-image-b` 기반)
- [ ] `public/assets/logo.png` — 파비콘 겸용. 필요 시 전용 favicon 세트 추가

### 5. 검증 권장
- [x] `npm audit` — 0 vulnerabilities
- [ ] Lighthouse (성능/접근성/SEO 90+ 목표)
- [ ] 실제 도메인에서 hreflang/canonical, OG 미리보기 확인

---

## 제약 (준수 사항)
- 거짓 수치·가짜 후기·미검증 인증 배지를 만들지 않음
- 고객-facing 페이지에 내부 작업 설명·면책·임시 문구를 넣지 않음
- 협력기관 로고는 로고 only로 유지하고 접근성은 `alt` 로만 보장
- 기존 브랜드 컬러(#921230)와 파트너 자산 유지·정돈
