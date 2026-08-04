# BEOMONNURI Homepage v2

작업일: 2026-07-04  
상태: 진행 중(핵심 요청 반영 완료 + 공식 로고 원본 확인 대기)

## 1) 프로젝트 개요
- 목적: 범온누리 홈페이지의 사실 기반 정보 정리 및 UI 정비
- 핵심 원칙: **사실이 아닌 확정형 문구 최소화**, 연락처/주소 최신화, 불필요한 시각 효과 제거
- 구조: 정적 멀티페이지 사이트

## 2) 현재 완료된 작업

### A. 페이지/네비게이션
- `cases.html` 페이지 삭제 완료
- 전 페이지에서 `cases.html` 링크 제거 완료
- 모바일 메뉴에서도 `CASES` 항목 제거 완료

### B. 연락처 정보 최신화
- 이메일 전면 통일: `beomonnuri@gmail.com`
- 주소 전면 반영: `경기도 구리시 /갈매중앙로 190 (구리갈매휴밸 나인지식산업센터) D존 4층 15`
- Cloudflare 이메일 난독화 링크(`/cdn-cgi/l/email-protection`, `__cf_email__`) 제거

### C. 마우스 따라다니는 점/링/트레일 효과 제거
- JS 런타임 비활성화(`return`) 적용
  - `assets/js/ai-frontier.js`
  - `assets/js/core.js`
  - `assets/js/v5-nextgen.js`(mouse-trail 파트)
- CSS 강제 비표시 적용
  - `assets/css/ai-frontier.css`
  - `assets/css/v5-nextgen.css`
- 기본 커서 복구 적용

### D. 사실성 점검 및 문구 완화
- 확정형 KPI/성과 표현을 예시/협의형 문구로 1차~2차 완화
- 인덱스 인텔 섹션 문구를 “예시 지표” 중심으로 조정
- 틱커 수치를 실제 수치처럼 보이지 않도록 `SAMPLE/예시 데이터`로 변경

### E. 마케팅/검색(SEO) 강화 — 제품 성능 중심
- 홈/제품/슈퍼차트 페이지 메타 태그를 `제품 성능` 검색 의도 기준으로 고도화
  - 핵심 키워드: 처리시간, 정확도, 자동화율, 운영 안정성, 성능 진단
- 제품 허브(`products.html`)에 성능 기준 안내 섹션 신설
  - 검색 유입 사용자가 바로 비교할 수 있도록 내부 링크 구조 강화
- 슈퍼차트 상세(`products-superchart.html`)에 성능 진단 프레임 섹션 신설
  - 신호 정확도/지연시간/운영 안정성 중심 카피 및 CTA 추가
- JSON-LD 구조화데이터 강화
  - `products.html`: `CollectionPage + ItemList + FAQPage` 그래프
  - `products-superchart.html`: `Service + BreadcrumbList + FAQPage` 그래프

### F. Products 확장 — 외주·MVP 서비스 라인 반영
- `products.html`에 **외주·MVP 통합 섹션** 신설 (`#build-services-hub`)
- 반영 키워드:
  - 홈페이지 제작
  - 웹사이트 제작
  - 광고 이미지 제작
  - MVP 제작
  - 스타트업 MVP
  - 예비창업자 MVP
  - 외주 개발
- SEO 확장:
  - `products.html` 메타 description/keywords에 서비스 키워드 추가
  - `FAQPage` JSON-LD에 외주·MVP 가능 여부 Q&A 추가

### G. 파트너 표기 반영
- 파트너 배열에 아래 항목 반영:
  - 청년재단
  - (주)로컬모티브
- 현재 파일:
  - `assets/img/logos/partners/youth-foundation.jpg`
  - `assets/img/logos/partners/localmotive.jpg`

## 3) 기능 진입 URI(현재)
- 홈: `index.html`
- 제품 인덱스: `products.html`
- 상세:
  - `products-private.html`
  - `products-agent.html`
  - `products-superchart.html`
- Why: `why.html`
- Contact: `contact.html`

## 4) 아직 미완료(사용자 확인 필요)
1. **청년재단 공식 CI 원본 확정**
2. **(주)로컬모티브 공식 CI 원본 확정**
3. 성능 섹션 문구의 최종 세일즈 톤(강한 카피 vs 사실 중심 카피) 확정

> 현재는 후보 이미지(JPG)를 적용해 둔 상태이며, 공식 배포본(PNG/SVG 권장) 확인 후 교체 필요.

## 5) 권장 다음 단계
1. 공식 로고 원본 파일(또는 공식 다운로드 URL) 전달
2. 로고를 PNG/SVG로 교체 및 해상도/배경(투명) 정리
3. 최종 화면 검수(데스크톱/모바일)
4. 필요 시 배포 전 최종 빌드/검증 수행

## 6) 수정된 주요 파일
- HTML: `index.html`, `products.html`, `products-superchart.html`, `products*.html`, `why.html`, `contact.html`
- JS: `assets/js/ai-frontier.js`, `assets/js/core.js`, `assets/js/v5-nextgen.js`, `assets/js/v5-anchor.js`, `assets/js/v5-mobile.js`
- CSS: `assets/css/ai-frontier.css`, `assets/css/v5-nextgen.css`
- 삭제: `cases.html`

## 7) 운영 메모
- 본 프로젝트는 정적 페이지 기반이며, 일부 데이터/HUD 영역은 데모 UI 성격입니다.
- 사실 확정이 필요한 수치/문구는 반드시 내부 검증 후 고정 문구로 전환하세요.

## 8) 임시 비노출 상태 (2026-08-04) — 복구 가이드

현재 사이트에는 **임시로 감춘 항목 2건**이 있습니다. 관련 코드는 삭제하지 않고
`TEMP-HIDDEN(...)` 마커 주석으로 남겨 두었으므로, 마커를 검색해 되돌리면 됩니다.

```bash
grep -rn "TEMP-HIDDEN" homepage2/
```

### 8-1) (주)로컬모티브 파트너 로고 — 마커 `TEMP-HIDDEN(LOCALMOTIVE / 2026-08-04)`
- `assets/js/ai-frontier.js`: 평면 마퀴 파트너 배열 항목 1줄 주석
- `assets/js/v5-nextgen.js`: 3D 실린더 `partnerLogos` 맵 1줄 + `partnerOrder` 1줄 주석
- 이미지(`assets/img/logos/partners/localmotive.png|jpg`)와 전용 CSS 규칙
  (`ai-frontier.css`, `v5-nextgen.css`의 `.logo-localmotive`)은 **그대로 보존**되어 있어
  주석만 해제하면 원상 복구됩니다.

### 8-2) 범온 슈퍼차트 AI — 마커 `TEMP-HIDDEN(SUPERCHART / 2026-08-04)`
페이지 파일 `products-superchart.html` 자체는 **삭제하지 않고 보존**하되, 사이트의 모든
진입 경로에서 제외하고 검색엔진 색인을 차단한 상태입니다.

주석 해제만으로 복구되는 항목
- 전 페이지 데스크톱 내비게이션 드롭다운 항목 (13곳)
- 전 페이지 푸터 Products 링크 (8곳)
- `assets/js/v5-mobile.js` 모바일 메뉴 항목
- `products.html`: 제품 카드, 비교표 행, 제품 탐색 순서 링크, 성능 빠른 이동 링크
- `contact.html`: 관심 제품 체크박스(`Superchart`)
- `sitemap.xml`: 슈퍼차트 URL 블록

수동 복구가 필요한 항목(주석에 원본 값 병기)
- `products-superchart.html`: `robots` 메타를 `noindex,nofollow` → `index,follow,...`로 되돌리기
- `robots.txt`: `Disallow: /products-superchart.html` 한 줄 삭제
- `products-agent.html` NEXT / `services-outsourcing.html` PREV 링크를 슈퍼차트 기준 원본 블록으로 교체
- `assets/js/v5-mobile.js`: 외주·MVP 번호를 `02-3` → `02-4`로 되돌리기
- `products.html`: 외주 카드 번호 `/03` → `/04`, 히어로 `TOTAL 02` → `03`,
  JSON-LD `ItemList`의 `numberOfItems` 및 3번 항목
- 제품 수 표기 `2개의 AI 제품` → `3개의 AI 제품`
  (`index.html`, `products.html`, 전 페이지 푸터 소개문, `manifest.webmanifest` description,
   `assets/js/ai-frontier.js` · `assets/js/v5-nextgen.js` AI 프롬프트)
- `products.html` 히어로 lead: `보안형 사내 AI부터 업무 자동화 AI까지`
  → `보안형 사내 AI부터 산업별 의사결정 AI까지`

### 8-3) 공식 사명 표기 통일
- 표기 기준: 한글 **범온누리 이노베이션**, 영문 **BEOMONNURI INNOVATION**
  (법인 상호는 `privacy.html`의 `(주)범온누리 이노베이션` 기준)
- 적용 범위: 전 페이지 `<title>`, `og:site_name`/`og:title`, `author` 메타, 로고 `alt`,
  푸터 저작권(`© 2026 BEOMONNURI INNOVATION.`), 모바일 메뉴 하단, `manifest.webmanifest`,
  `why.html` 본문·서명, `contact.html` 폼 안내·발신자명, AI 위젯/터미널 프롬프트
- 제품명(`범온 프라이빗 AI`, `범온 에이전트 AI`)과 서비스명(`외주·MVP 제작`)은 변경하지 않았습니다.

### 8-4) 캐시 무효화
수정한 정적 파일의 쿼리 버전을 전 페이지에서 일괄 상향했습니다.
- `ai-frontier.css` `20260723c` → `20260804a`
- `ai-frontier.js`, `v5-nextgen.js`, `v5-mobile.js` `20260723a` → `20260804a`
