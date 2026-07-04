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

### E. 파트너 표기 반영
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
  - `products-apartment.html`
- Why: `why.html`
- Contact: `contact.html`

## 4) 아직 미완료(사용자 확인 필요)
1. **청년재단 공식 CI 원본 확정**
2. **(주)로컬모티브 공식 CI 원본 확정**

> 현재는 후보 이미지(JPG)를 적용해 둔 상태이며, 공식 배포본(PNG/SVG 권장) 확인 후 교체 필요.

## 5) 권장 다음 단계
1. 공식 로고 원본 파일(또는 공식 다운로드 URL) 전달
2. 로고를 PNG/SVG로 교체 및 해상도/배경(투명) 정리
3. 최종 화면 검수(데스크톱/모바일)
4. 필요 시 배포 전 최종 빌드/검증 수행

## 6) 수정된 주요 파일
- HTML: `index.html`, `products*.html`, `why.html`, `contact.html`
- JS: `assets/js/ai-frontier.js`, `assets/js/core.js`, `assets/js/v5-nextgen.js`, `assets/js/v5-anchor.js`, `assets/js/v5-mobile.js`
- CSS: `assets/css/ai-frontier.css`, `assets/css/v5-nextgen.css`
- 삭제: `cases.html`

## 7) 운영 메모
- 본 프로젝트는 정적 페이지 기반이며, 일부 데이터/HUD 영역은 데모 UI 성격입니다.
- 사실 확정이 필요한 수치/문구는 반드시 내부 검증 후 고정 문구로 전환하세요.