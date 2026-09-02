/**
 * 사이트 전역 설정 (단일 출처).
 *
 * [필수] 발행 전 확인 필요 항목은 PLACEHOLDER 로 표시했습니다.
 *    빌드 시 HTML/CSS/JS 안의 토큰({{KEY}})이 아래 값으로 치환됩니다.
 *    (치환 로직: vite.config.js 의 htmlTokenReplace 플러그인)
 */

export const siteConfig = {
  // ── 도메인 ──────────────────────────────────────────────
  // 운영 도메인 확정 시 이 값만 바꾸면 hreflang/og:url/sitemap 전체에 반영됩니다.
  SITE_URL: 'https://www.beomonnuri.com',

  // ── 연락처 ──────────────────────────────────────────────
  // [필수] 발행 전 실제 이메일 확인 필요 (기존 오타 beomonnuri@gmil.com → gmail 로 임시 통일)
  EMAIL: 'beomonnuri@gmail.com',

  // ── 문의 폼 엔드포인트 ───────────────────────────────────
  // Cloudflare Pages Functions / Formspree 등 폼 처리 엔드포인트.
  // 빈 문자열이면 폼은 mailto 기반 graceful fallback 으로 동작합니다.
  FORM_ENDPOINT: '',

  // ── 검색엔진 소유권 확인 메타 토큰 ─────────────────────────
  // Google Search Console / Naver Search Advisor 등록 후 발급값 입력.
  // 빈 문자열이면 해당 meta 태그는 빌드 산출물에 포함되지 않습니다.
  GOOGLE_SITE_VERIFICATION: '',
  NAVER_SITE_VERIFICATION: '',

  // ── 회사 정보 ([필수] 발행 전 실제 값으로 교체) ──────────────
  COMPANY_NAME_KR: '(주)범온누리 이노베이션',
  COMPANY_NAME_EN: 'Beomon Nuri Innovation Co., Ltd.',
  CEO_NAME: '권누리',
  CEO_NAME_EN: 'Nuri Kwon',
  ADDRESS_KR: '경기도 구리시 갈매중앙로 190 (구리갈매휴밸 나인지식산업센터) D존 4층 15',
  ADDRESS_EN: 'D-Zone, 4F-15, 190 Galmae-jungang-ro, Guri-si, Gyeonggi-do, Korea (Guri Galmae Hubble Nine Knowledge Industry Center)',
};

/** 토큰 치환 맵 (빌드 타임 + 런타임 공용) */
export function buildTokenMap(cfg = siteConfig) {
  const map = {};
  for (const [k, v] of Object.entries(cfg)) {
    map[`{{${k}}}`] = v;
  }
  return map;
}

export default siteConfig;
