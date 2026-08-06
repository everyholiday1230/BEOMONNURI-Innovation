/* ============================================================
   i18n 부트스트랩
   ------------------------------------------------------------
   mock-data.js 가 만든 QT.I18N(디자이너의 ko/en 60키)을 i18n 레지스트리로
   흡수하고, 초기 언어를 결정한다.

   실행 순서가 중요하다:
     i18n.js -> locales/*.js -> mock-data.js -> 이 파일
   그래서 index.html 에서 mock-data.js 뒤에 놓는다.

   왜 별도 파일인가: 디자이너의 mock-data.js 를 수정하지 않고 흡수하기 위함.
   ============================================================ */

(function () {
  'use strict';

  const I18n = window.QTI18n;
  if (!I18n) {
    console.warn('[i18n] QTI18n 미로드 — 번역이 비활성화된다');
    return;
  }

  // 폴백 언어. 해외 우선 출시이므로 영어다.
  I18n.setFallback('en');

  // 디자이너가 mock-data.js 에 만든 사전을 흡수한다.
  // 우리 locales/*.js 값이 우선이고, 레거시는 빈 키만 채운다.
  const absorbed = I18n.absorbLegacy();

  // 초기 언어 결정 우선순위:
  //   1) 사용자가 저장한 선택 (qt.tweaks.lang)
  //   2) 브라우저 언어 중 등록된 것
  //   3) 폴백(en)
  let saved = null;
  try {
    const raw = localStorage.getItem('qt.tweaks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.lang) saved = parsed.lang;
    }
  } catch (e) { /* 프라이버시 모드 등 */ }

  I18n.setLocale(I18n.detect(saved));

  if (/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    const langs = I18n.available().map((l) => `${l.code}(${l.keys})`).join(' ');
    console.info(`[i18n] locale=${I18n.getLocale()} 등록언어=${langs} 레거시흡수=${absorbed}키`);
  }
})();
