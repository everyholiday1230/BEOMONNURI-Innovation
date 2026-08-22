/* ============================================================
   i18n — 확장 가능한 다국어 레지스트리
   ------------------------------------------------------------
   설계 원칙

   1. 언어 추가는 "파일 추가"만으로 끝난다. 코드 수정이 없어야 한다.
        src/locales/ja.js 를 만들고 QTI18n.register('ja', {...}) 하면 끝.
        지원 언어 목록도 등록된 것에서 자동 산출한다 (하드코딩 없음).

   2. 문자열은 어디에도 하드코딩하지 않는다.
        컴포넌트는 t('key') 만 부른다. 사전에 키가 없으면 폴백 사슬을 타고,
        그래도 없으면 키를 그대로 돌려주되 개발 모드에서 경고를 남긴다.
        (조용히 빈 화면이 되는 것보다 키가 보이는 게 낫다)

   3. 폴백 사슬을 명시한다.
        요청 언어 → 지역 없는 기본형(ko-KR → ko) → 폴백 언어 → 키
        해외 우선 출시이므로 폴백 언어의 기본값은 'en' 이다.

   4. 기존 QT.I18N(디자이너가 만든 60키 ko/en)을 흡수한다.
        디자이너 파일을 고치지 않고도 그대로 동작해야 한다.

   5. 복수형/변수 치환을 지원한다.
        t('found_n', { n: 3 })  ->  "3 results"
        사전 값에 {n} 자리표시자를 쓴다. 언어마다 어순이 달라도 사전에서 해결된다.
   ============================================================ */

(function () {
  'use strict';

  /** locale -> { key: string } */
  const DICTS = new Map();
  /** locale -> 표시 이름 (언어 선택 UI 용) */
  const LABELS = new Map();
  /** locale -> 숫자/날짜 서식용 BCP-47 태그 */
  const BCP47 = new Map();

  const listeners = new Set();

  let current = 'en';
  let fallback = 'en';
  let missingWarned = new Set();

  // ---------------------------------------------------------------
  // 등록
  // ---------------------------------------------------------------

  /**
   * 언어를 등록하거나 기존 사전에 병합한다.
   *
   * @param {string} locale        'en' | 'ko' | 'ja' | 'zh-CN' ...
   * @param {object} dict          { key: '문자열' }
   * @param {object} [meta]        { label, bcp47 }
   */
  function register(locale, dict, meta) {
    if (!locale || !dict) return;
    const key = String(locale);
    const existing = DICTS.get(key) || {};
    DICTS.set(key, Object.assign(existing, dict));

    if (meta && meta.label) LABELS.set(key, meta.label);
    if (meta && meta.bcp47) BCP47.set(key, meta.bcp47);
    else if (!BCP47.has(key)) BCP47.set(key, key);

    notify();
  }

  /** 등록된 언어 목록. 하드코딩하지 않고 레지스트리에서 산출한다. */
  function available() {
    return [...DICTS.keys()].map((code) => ({
      code,
      label: LABELS.get(code) || code,
      bcp47: BCP47.get(code) || code,
      keys: Object.keys(DICTS.get(code) || {}).length,
    }));
  }

  function has(locale) {
    return DICTS.has(String(locale));
  }

  // ---------------------------------------------------------------
  // 조회
  // ---------------------------------------------------------------

  /** 폴백 사슬: 요청 → 지역없는 기본형 → 폴백언어 → null */
  function chainFor(locale) {
    const out = [];
    const l = String(locale || '');
    if (l) out.push(l);
    const base = l.split('-')[0];
    if (base && base !== l) out.push(base);
    if (fallback && !out.includes(fallback)) out.push(fallback);
    const fbBase = String(fallback || '').split('-')[0];
    if (fbBase && !out.includes(fbBase)) out.push(fbBase);
    return out;
  }

  /**
   * 문자열 조회.
   * @param {string} key
   * @param {object} [vars]  {n:3} -> 사전값의 {n} 치환
   * @param {string} [locale] 특정 언어로 강제 조회
   */
  function t(key, vars, locale) {
    if (!key) return '';
    const target = locale || current;

    for (const code of chainFor(target)) {
      const dict = DICTS.get(code);
      if (dict && typeof dict[key] === 'string') return interpolate(dict[key], vars);
    }

    // 키를 찾지 못했다. 조용히 넘기지 않고 한 번만 경고한다.
    const warnKey = `${target}:${key}`;
    if (!missingWarned.has(warnKey)) {
      missingWarned.add(warnKey);
      if (isDev()) console.warn(`[i18n] 누락된 키: "${key}" (locale=${target})`);
    }
    return interpolate(key, vars);
  }

  /** 키가 사전에 있는지. 화면에서 조건부로 쓰기 위해 노출한다. */
  function exists(key, locale) {
    for (const code of chainFor(locale || current)) {
      const dict = DICTS.get(code);
      if (dict && typeof dict[key] === 'string') return true;
    }
    return false;
  }

  /*
     브랜드 이름.

     한 곳에서만 정한다. 이름은 바뀐다(실제로 QuantumTrade → ChartControl 로
     바뀌었다). 사전과 JSX 34곳에 흩어져 있으면 다음에 바뀔 때 또 34곳을
     고치고, 한 곳을 빠뜨려 옛 이름이 남는다.

     서버 설정(brandName)이 있으면 그 값을 쓴다 — 배포마다 다른 이름을
     달 수 있어야 한다(화이트라벨). 없으면 기본값.
  */
  var DEFAULT_BRAND = 'ChartControl AI';
  /*
     약어. 좁은 자리(로고 배지·모바일 머리글·공유 카드)에서 쓴다.

     ★ 풀네임과 약어를 각각 두는 이유: 좁은 곳에 풀네임을 넣으면 잘리고,
       넓은 곳에 약어만 쓰면 무슨 서비스인지 알 수 없다.
  */
  var DEFAULT_BRAND_SHORT = 'CCAI';

  function brandName() {
    try {
      var cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
      if (cfg && typeof cfg.brandName === 'string' && cfg.brandName.trim()) return cfg.brandName.trim();
    } catch (e) { /* 설정을 못 읽어도 이름은 나와야 한다 */ }
    return DEFAULT_BRAND;
  }

  /** 약어 — 서버가 BRAND_SHORT_NAME 을 주면 그것을, 없으면 기본 약어. */
  function brandShortName() {
    try {
      var cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
      if (cfg && typeof cfg.brandShortName === 'string' && cfg.brandShortName.trim()) return cfg.brandShortName.trim();
    } catch (e) { /* 설정을 못 읽어도 약어는 나와야 한다 */ }
    return DEFAULT_BRAND_SHORT;
  }

  /**
   * 사전 문자열 치환.
   *
   * `{brand}` 는 호출자가 넘기지 않아도 항상 채워진다. 브랜드 이름을 쓰는
   * 문장이 수십 개인데 매번 `{ brand: ... }` 를 넘기게 하면 빠뜨린 곳에
   * `{brand}` 라는 글자가 그대로 화면에 나온다.
   * 호출자가 명시로 넘기면 그 값이 이긴다.
   */
  function interpolate(template, vars) {
    var merged = vars || {};
    if (!Object.prototype.hasOwnProperty.call(merged, 'brand')) {
      merged = Object.assign({ brand: brandName() }, merged);
    }
    if (!Object.prototype.hasOwnProperty.call(merged, 'brandShort')) {
      merged = Object.assign({ brandShort: brandShortName() }, merged);
    }
    return String(template).replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(merged, name) ? String(merged[name]) : m,
    );
  }

  function isDev() {
    try {
      return /localhost|127\.0\.0\.1/.test(window.location.hostname);
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------
  // 현재 언어
  // ---------------------------------------------------------------

  function setLocale(locale) {
    const raw = String(locale || '');
    if (!raw) return current;

    /*
       ★★ 등록되지 않은 언어는 폴백으로 정규화한다.

         현재 언어를 요청한 값 그대로 두면, 사전이 없는데도 그것이 "현재 언어" 가
         된다. 그러면 화면 문장은 폴백(영어)으로 나오는데 언어 표시만 그 언어로
         남아 **화면과 표시가 서로 다른 말을 한다.** 헤더의 순환 버튼이
         `available()` 안에서 현재 값을 찾지 못해 동작이 어색해지기도 한다.

         실제로 문제가 되는 경로: 한국어를 서비스 언어에서 제외했지만, 이미
         `lang='ko'` 를 저장한 브라우저가 남아 있다. 그 이용자의 화면은 영어인데
         버튼에는 KO 가 찍힌다.

       ★ 지역 표기는 기본형으로 한 번 더 시도한다('zh-CN' 만 등록된 상태에서
         'zh' 를 요청하거나 그 반대인 경우가 있다).
    */
    let next = raw;
    if (!DICTS.has(next)) {
      const base = next.split('-')[0];
      if (DICTS.has(base)) {
        next = base;
      } else {
        const regional = [...DICTS.keys()].find((c) => c.split('-')[0] === base);
        next = regional || fallback;
      }
    }

    /*
       ★ lang 속성은 값이 같아도 한 번 맞춘다.

         변경이 없으면 곧바로 돌려보내던 탓에, 문서에 정적으로 적힌 lang 값이
         그대로 남았다(index.html 이 lang="ko" 였다). 화면은 영어인데 문서는
         한국어라고 선언한 상태가 되어, 스크린리더가 영어 문장을 한국어 음성으로
         읽고 브라우저 번역도 잘못 동작한다.
    */
    try {
      document.documentElement.setAttribute('lang', bcp47Of(next));
    } catch (e) { /* noop */ }

    if (next === current) return current;
    current = next;
    notify();
    return current;
  }

  function getLocale() {
    return current;
  }

  function setFallback(locale) {
    if (locale) fallback = String(locale);
  }

  function bcp47Of(locale) {
    return BCP47.get(String(locale || current)) || String(locale || current);
  }

  /**
   * 브라우저 설정에서 최적 언어를 고른다.
   * 등록된 언어와 대조하므로, 언어를 추가하면 자동으로 후보에 포함된다.
   */
  function detect(preferred) {
    const wanted = [];
    if (preferred) wanted.push(preferred);
    try {
      const navLangs = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
      for (const l of navLangs) if (l) wanted.push(l);
    } catch (e) { /* noop */ }

    for (const want of wanted) {
      if (has(want)) return want;
      const base = String(want).split('-')[0];
      if (has(base)) return base;
      // 'zh' 요청에 'zh-CN' 만 등록된 경우도 맞춰준다.
      const match = [...DICTS.keys()].find((code) => code.split('-')[0] === base);
      if (match) return match;
    }
    return fallback;
  }

  // ---------------------------------------------------------------
  // 구독 (React 재렌더용)
  // ---------------------------------------------------------------

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function notify() {
    listeners.forEach((cb) => {
      try { cb(current); } catch (e) { /* 개별 구독자 오류 전파 금지 */ }
    });
  }

  // ---------------------------------------------------------------
  // 숫자 / 날짜 서식 — 언어별 규칙을 Intl 에 위임한다
  // ---------------------------------------------------------------

  function formatNumber(value, opts) {
    if (value == null || Number.isNaN(Number(value))) return t('dash');
    try {
      return new Intl.NumberFormat(bcp47Of(), opts).format(Number(value));
    } catch (e) {
      return String(value);
    }
  }

  function formatDate(value, opts) {
    try {
      return new Intl.DateTimeFormat(bcp47Of(), opts).format(new Date(value));
    } catch (e) {
      return String(value);
    }
  }

  // ---------------------------------------------------------------
  // 기존 QT.I18N 흡수
  // ---------------------------------------------------------------

  /**
   * 디자이너가 mock-data.js 에 만든 QT.I18N(ko/en 60키)을 그대로 가져온다.
   * 디자이너 파일을 수정하지 않고도 동작하게 하는 것이 목적이다.
   * 이미 locales/*.js 로 등록된 값이 있으면 그것을 덮어쓰지 않는다.
   */
  function absorbLegacy() {
    const legacy = window.QTI18n;
    if (!legacy) return 0;
    let n = 0;
    for (const [code, dict] of Object.entries(legacy)) {
      if (!dict || typeof dict !== 'object') continue;
      const existing = DICTS.get(code) || {};
      // 기존(우리 locale 파일)이 우선. 레거시는 비어 있는 키만 채운다.
      const merged = Object.assign({}, dict, existing);
      DICTS.set(code, merged);
      if (!BCP47.has(code)) BCP47.set(code, code);
      n += Object.keys(dict).length;
    }
    notify();
    return n;
  }

  /**
   * 거래소 리베이트 안내 문구를 조립한다.
   *
   * 문구를 데이터에 박아두면(예: '수수료 20% 페이백') 언어를 추가할 때마다
   * 데이터를 복제해야 한다. 그래서 데이터는 숫자만 갖고, 문장은 사전이 만든다.
   *
   * @param {{rebatePct?:number, bonusUsd?:number, creditUsd?:number, pending?:boolean}} r
   * @returns {string}
   */
  function formatRebate(r) {
    if (!r || typeof r !== 'object') return '';
    if (r.pending) return t('rebate_pending');

    const parts = [];
    if (Number.isFinite(r.rebatePct)) parts.push(t('rebate_fee_pct', { pct: r.rebatePct }));
    if (Number.isFinite(r.bonusUsd)) parts.push(t('rebate_bonus_usd', { usd: r.bonusUsd }));
    if (Number.isFinite(r.creditUsd)) parts.push(t('rebate_credit_usd', { usd: r.creditUsd }));
    if (parts.length === 0) return '';
    return parts.join(t('rebate_join'));
  }

  window.QTI18n = {
    /** 브랜드 이름 — 화면이 직접 쓸 때. 사전 문장 안에서는 {brand} 를 쓴다. */
    brand: brandName,
    /** 약어 — 좁은 자리에서. 사전 문장 안에서는 {brandShort} 를 쓴다. */
    brandShort: brandShortName,

    formatRebate,
    /**
     * 진단용 — 한 언어의 사전을 그대로 돌려준다(복사본).
     *
     * ★ 왜 필요한가: 화면에 영어가 그대로 보이는 자리를 찾으려면 "이 문장이
     *   en 사전의 값이고 대상 언어에는 그 키가 없다" 를 확인해야 한다. 사전을
     *   볼 수 없으면 "라틴 문자가 보인다" 같은 판정밖에 못 하는데, 그러면
     *   BTC·KuCoin·API Key 처럼 번역하지 않는 것이 정상인 문자열까지 걸린다.
     *
     * 반환값을 고쳐도 사전은 바뀌지 않는다(얕은 복사).
     */
    dump: function (locale) {
      const d = DICTS.get(String(locale || current));
      return d ? Object.assign({}, d) : null;
    },
    register,
    available,
    has,
    t,
    exists,
    setLocale,
    getLocale,
    setFallback,
    detect,
    bcp47Of,
    subscribe,
    formatNumber,
    formatDate,
    absorbLegacy,

    /** 진단: 언어별 키 수와 누락 키. 콘솔에서 QTI18n.debug() */
    debug() {
      const all = new Set();
      for (const d of DICTS.values()) Object.keys(d).forEach((k) => all.add(k));
      return {
        current,
        fallback,
        locales: available(),
        totalKeys: all.size,
        missingByLocale: [...DICTS.entries()].map(([code, d]) => ({
          code,
          missing: [...all].filter((k) => typeof d[k] !== 'string'),
        })),
      };
    },
  };
})();

/* ============================================================
   클립보드 복사 — 실패를 삼키지 않는 단일 경로
   ------------------------------------------------------------
   ★★ 왜 함수로 묶는가

     `navigator.clipboard.writeText(x)` 는 **프로미스를 돌려준다.** 거부될 때
     .catch 가 없으면 처리되지 않은 거부(unhandled rejection)가 되고, 화면은
     아무 일도 없었던 것처럼 보인다. 실측에서 /referral 의 공유 버튼이 그 상태였다
     (PAGEERROR: Write permission denied).

     그리고 조용한 실패의 결과가 나쁘다: 이용자는 복사됐다고 믿고 붙여넣는다.
     추천 링크라면 **빈 값을 붙여넣어 귀속이 사라진다.** 우리 수익이 줄고,
     이용자는 이유를 모른다.

   ★ clipboard API 는 https 또는 localhost 에서만 동작한다. 권한이 거부되는
     환경도 있다. 그래서 "될 것이다" 를 가정하지 않고 결과를 알린다.
   ============================================================ */
(function () {
  'use strict';

  /**
   * 텍스트를 클립보드에 복사한다.
   *
   * @param {string} text            복사할 값
   * @param {object} [opts]
   * @param {function} [opts.onDone] 성공 시 호출 (버튼 라벨을 '복사됨' 으로 바꾸는 용도)
   * @returns {Promise<boolean>} 성공 여부. 절대 reject 하지 않는다.
   */
  function copyText(text, opts) {
    var value = String(text == null ? '' : text);
    var onDone = opts && opts.onDone;

    var fail = function () {
      /*
         실패를 알린다. 값도 함께 보여준다 — 손으로 복사할 수 있어야 한다.
         (여기서 조용히 넘기면 이용자는 붙여넣기가 왜 비어 있는지 알 수 없다)
      */
      if (window.QTToast) {
        window.QTToast({
          title: window.QTI18n ? window.QTI18n.t('copy_failed') : 'Could not copy',
          desc: value,
          variant: 'danger',
          duration: 8000,
        });
      }
      return false;
    };

    if (!value) return Promise.resolve(false);
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(fail());

    return navigator.clipboard.writeText(value).then(
      function () { if (onDone) onDone(); return true; },
      fail,
    );
  }

  window.QTCopy = copyText;
})();
