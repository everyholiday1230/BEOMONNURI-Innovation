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
  (`index.html`, `products.html`, 전 페이지 푸터 소개문, `manifest.webmanifest` description)
  ※ AI 위젯/터미널 프롬프트는 9-2에서 코드째 제거되어 해당 없음
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

## 9) 코드 점검 후속 정리 (2026-08-04)

전 페이지 자동 점검에서 확인된 항목 중 **코드 변경만으로 끝나는 것**들을 처리했습니다.
(결제 서버 승인 연동·법정 표기·약관은 사업 정보가 필요해 별도 진행)

### 9-1) 카메라 접근 코드 제거
`v5-nextgen.js`의 `CAMERA FACE TRACKING` 모듈(`navigator.mediaDevices.getUserMedia`)을
삭제했습니다. 가드 요소 `#camera-toggle`이 어떤 페이지에도 없어 실행되지 않는 상태였지만,
방문자에게 전송되는 스크립트에 카메라 접근 코드가 포함될 이유가 없고 마크업이 추가되면
즉시 활성화되므로 제거했습니다.

### 9-2) 실행되지 않는 모듈 일괄 제거 (약 47KB)
`4260f3c`(홈을 풀스크린 히어로 단일 페이지로 복원)에서 본문 섹션 마크업이 제거된 뒤
JS/CSS만 남아 있던 코드입니다. 가드 셀렉터가 HTML·타 JS 어디에도 없음을 확인 후 삭제했습니다.

| 파일 | 제거 모듈 | 변화 |
|---|---|---|
| `assets/js/ai-frontier.js` | CUSTOM CURSOR, LIVE HUD, DATA TICKER, PIPELINE CANVAS, INTEL BOARD CHARTS, LIVE LOG, AI WIDGET | 30.0KB → 14.0KB |
| `assets/js/v5-nextgen.js` | MOUSE TRAIL, CAMERA, LLM TERMINAL, SOUND, STATUS ORB | 43.3KB → 30.4KB |
| `assets/js/v5-anchor.js` | 파일 전체 (`[data-anchor]` 요소가 없어 전량 미실행) | 12.5KB → 삭제 |
| `assets/css/v5-anchor.css` | 파일 전체 (`.info-popover`는 위 JS만 생성) | 6.2KB → 삭제 |

- 미사용이 된 헬퍼 `pausableInterval`(ai-frontier)도 함께 제거했습니다.
- 복구가 필요하면 삭제 직전 커밋(`1b75196`)에 원본이 그대로 있습니다.
- **AI 위젯/히어로 터미널 프롬프트도 이때 함께 사라졌습니다.** 8-2에 적어둔 프롬프트 관련
  복구 항목은 더 이상 해당되지 않습니다.

### 9-3) 문의 폼 스팸 차단
`contact.html`에 허니포트 필드(`name="botcheck"`)를 추가했습니다.
- 화면·스크린리더·탭 이동에서 제외(`.cf-botcheck` 오프스크린 + `aria-hidden` + `tabindex="-1"`)
- 값이 채워지면 전송을 조용히 중단하고, 전송 payload에도 값을 실어 Web3Forms 서버 측
  스팸 필터가 함께 동작하도록 했습니다.
- Web3Forms access key는 공개키(설계상 클라이언트 노출)라 그대로 두었습니다.

### 9-4) 외부 스크립트 무결성(SRI)
버전이 고정되어 내용이 바뀌지 않는 자산에만 적용했습니다.

| 자산 | 처리 |
|---|---|
| three.js r128 (cdnjs) | `integrity` 추가. cdnjs가 공개한 SHA-512와 직접 계산한 값이 일치함을 확인 |
| Pretendard v1.3.9 (jsDelivr) | jsDelivr이 실시간 생성하는 `.min.css`는 파일 주석에 *"Do NOT use SRI with dynamically generated files"* 경고가 있어, **저장소 원본 정적 파일**(`...subset.css`)로 URL을 바꾸고 SHA-384 적용 (+6KB) |
| Google Fonts `css2` | **적용하지 않음.** User-Agent에 따라 응답 CSS가 달라져 SRI를 걸면 일부 브라우저에서 폰트가 깨짐 |
| 토스페이먼츠 `v2/standard` | **적용하지 않음.** 버전 미고정 URL로 토스 측 업데이트 시 결제가 전면 중단됨 |

### 9-5) 그 외
- `console.log` 3건 제거(`v5-anchor.js` 파일째 삭제, `v5-webgpu.js` 2건). 예외 로깅용
  `console.error`/`console.warn`은 유지.
- `v5-webgpu.js`: `canvas.getContext('2d')` 결과 null 검사 추가(장식 레이어이므로 실패 시 조용히 종료).
- **`404.html` 신설.** 404는 임의 경로(`/a/b/c`)에서 렌더되므로 모든 자원·링크를 루트
  절대경로로 작성했습니다. 이에 맞춰 `v5-mobile.js`의 모바일 메뉴 링크도 루트 절대경로로
  바꾸고, active 판정은 선행 슬래시를 정규화해 비교합니다.
  (정적 호스팅은 `500.html`을 사용하지 않아 만들지 않았습니다.)
- 미참조 자산 3개(`assets/favicon.svg`, `localmotive.jpg`, `youth-foundation.jpg`, 합계 약 31KB)는
  **삭제하지 않았습니다.** 두 JPG는 4)에 적힌 "공식 CI 원본 확정 대기" 상태의 후보 이미지
  원본이라 임의 삭제가 위험합니다. 공식 로고가 확정되면 함께 정리하세요.

### 9-6) 캐시 무효화
- `ai-frontier.css` `20260804a` → `20260804b`
- `ai-frontier.js`, `v5-nextgen.js`, `v5-webgpu.js`, `v5-mobile.js` → `20260804b`

## 10) 이미지 최적화 · 홈 법적고지 링크 (2026-08-04)

### 10-1) 파트너 로고 최적화 — 홈 첫 화면 이미지 전송량 60% 감소
원본 로고가 실제 표시 크기보다 과도하게 컸습니다. CSS 기준 표시 크기는
실린더 46px / 마퀴 40px(일부 `scale(1.2)` 보정 포함 약 55px)인데, 원본은 최대 1280×410이었습니다.

- **리사이즈 기준**: 고해상도(DPR 2) 대응으로 height 120px, max-width 480px 상한
- **포맷**: 알파 채널이 실제로 쓰이지 않으면 RGB로 저장, 무손실/q92 중 작은 쪽 선택
- **원본 PNG는 삭제하지 않고 `<picture>` 폴백으로 유지**
- WebP가 원본보다 커지는 로고 4개(korcham, modoo-startup, posco, gangdong-kiss)는
  **PNG를 그대로 사용** (팔레트 PNG가 더 효율적인 경우)

| | 이전 | 이후 |
|---|---|---|
| 홈 첫 화면 이미지 전송량 | 347.9KB | **140.2KB** (−207.8KB, 60%) |
| gbsa (경기도경제과학진흥원) | 100.5KB (844×297) | 20.7KB (341×120) |
| youth-foundation (청년재단) | 62.1KB (1200×360) | 6.3KB (400×120) |
| dankook-university | 32.3KB (500×500) | 8.1KB (120×120) |
| 회사 로고 | 40.9KB | 33.0KB (무손실 재인코딩, 픽셀 동일·해상도 유지) |

구현 메모
- `ai-frontier.js` / `v5-nextgen.js` 모두 `<picture><source type="image/webp">` + `<img>` PNG 폴백 구조
- 3D 실린더는 평면 마퀴의 이미지를 재사용하므로 `<img data-webp="...">`로 경로를 전달
- `.pm-item picture`, `.cylinder-face picture`에 `display: contents` 적용 →
  `<picture>` 래퍼가 박스를 만들지 않아 기존 flex 레이아웃(img가 직접 자식) 그대로 유지
- 기존에 선언만 되어 있고 실제로 쓰이지 않던 `gov-gg`의 `webp:` 항목을 정상 연결했습니다.
  (이전 `gbsa.webp`는 741×261 RGB로 **알파 채널이 없어** 배경이 흰 사각형으로 보일 수
  있었고, 그래서 연결되지 않았던 것으로 보입니다. 알파를 살려 다시 생성했습니다.)
- 회사 로고는 구조화 데이터(`Organization.logo`)로도 쓰이므로 해상도를 줄이지 않고
  무손실 재인코딩만 적용했습니다. `<picture>` 적용 시 추가로 약 15KB 더 줄일 수 있으나
  nav·footer 34곳의 마크업을 바꿔야 해서 보류했습니다.

### 10-2) 홈에 개인정보처리방침 링크 복구
`4260f3c`에서 홈 footer가 제거되면서 홈에서 개인정보처리방침으로 가는 경로가 사라졌습니다.
풀스크린 히어로 단일 화면 구성을 유지하기 위해 footer를 되살리는 대신,
히어로 상단 메타 행(`.hero-top`, `justify-content: space-between`) 오른쪽에 배치했습니다.
- `개인정보처리방침 · CONTACT · © 2026 BEOMONNURI INNOVATION`
- 모바일에서는 `.hero-top`이 `flex-direction: column`으로 바뀌어 아래로 자연스럽게 쌓입니다
- 스크롤 발생 없음(레이아웃 높이 변화 없음)

### 10-3) 저대비 텍스트 수정
10px 라벨 3곳의 대비가 4.31:1로 WCAG AA(4.5:1) 미달이었습니다.
`rgba(13,13,13,0.56)` → `0.62`(본문 `--mute`와 동일)로 조정해 **5.31:1** 확보.
- `assets/css/pages.css` 2곳(`.hw-step .k`, `.hw-metrics .mk`), `products.html` 1곳(`.ht-step .k`)
- 전 CSS/인라인 스타일 재검사 결과 AA 미달 0건

### 10-4) 캐시 무효화
- `ai-frontier.css`, `ai-frontier.js`, `v5-nextgen.js` → `20260804c`
- `pages.css` `20260723a` → `20260804c`


