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
  var DEFAULT_BRAND = 'ChartControl';

  function brandName() {
    try {
      var cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
      if (cfg && typeof cfg.brandName === 'string' && cfg.brandName.trim()) return cfg.brandName.trim();
    } catch (e) { /* 설정을 못 읽어도 이름은 나와야 한다 */ }
    return DEFAULT_BRAND;
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
    const next = String(locale || '');
    if (!next || next === current) return current;
    current = next;
    try {
      document.documentElement.setAttribute('lang', bcp47Of(next));
    } catch (e) { /* noop */ }
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

    formatRebate,
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
