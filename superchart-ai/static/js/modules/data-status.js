/**
 * data-status.js — 심볼 정규화 + 가격 데이터 상태 공용 유틸 (classic script)
 *
 * 목적: 일부 종목의 심볼/가격이 비거나 0·null·undefined·NaN으로 표시되는 문제를
 * 앱 전역에서 일관된 "상태" 기반으로 처리한다. 빈칸/깨진 값 대신 이해 가능한
 * 한국어 상태 문구를 보여준다. 브랜드 컬러만 사용.
 *
 * 노출:
 *   window.DataState  — 상태 상수
 *   window.SymbolData.normalize(rawSymbol, exchange) → 구조화 심볼 객체
 *   window.PriceStatus.validate(price, ts) → { valid, status, reason }
 *   window.PriceStatus.format(price, sym)  → 안전 포맷 문자열(상태 문구 포함)
 *   window.DataFmt.change/volume/lastUpdate
 *   window.DataStatusText / window.DataStatusBadgeClass
 *   window.DATA_DISCLAIMER
 */
(function() {
  'use strict';

  // ───────── 상태 상수 ─────────
  const DataState = {
    LOADING: 'LOADING',
    READY: 'READY',
    DELAYED: 'DELAYED',
    PARTIAL: 'PARTIAL',
    NO_PRICE: 'NO_PRICE',
    NO_SYMBOL: 'NO_SYMBOL',
    UNSUPPORTED: 'UNSUPPORTED',
    SUSPENDED: 'SUSPENDED',
    DELISTED: 'DELISTED',
    ERROR: 'ERROR',
    STALE: 'STALE',
  };

  // 상태별 한국어 문구 (빈칸/loading.../-- 금지)
  const STATUS_TEXT = {
    LOADING: '가격 확인 중',
    READY: '정상',
    DELAYED: '데이터 지연',
    PARTIAL: '일부 데이터',
    NO_PRICE: '가격 데이터 없음',
    NO_SYMBOL: '심볼 정보 없음',
    UNSUPPORTED: '현재 미지원',
    SUSPENDED: '거래 상태 확인 필요',
    DELISTED: '상장 상태 확인 필요',
    ERROR: '데이터를 불러오지 못했습니다',
    STALE: '오래된 데이터',
  };

  // 배지 클래스 (CSS .ds-badge-*)
  const BADGE_CLASS = {
    LOADING: 'ds-badge-loading',
    READY: 'ds-badge-ready',
    DELAYED: 'ds-badge-warn',
    PARTIAL: 'ds-badge-warn',
    NO_PRICE: 'ds-badge-muted',
    NO_SYMBOL: 'ds-badge-muted',
    UNSUPPORTED: 'ds-badge-muted',
    SUSPENDED: 'ds-badge-warn',
    DELISTED: 'ds-badge-muted',
    ERROR: 'ds-badge-muted',
    STALE: 'ds-badge-warn',
  };

  // 지연/오래됨 임계값(ms)
  const DELAY_MS = 180 * 1000;     // 180초(3분) 이상 → 지연 (한산한 종목 false alarm 완화)
  const STALE_MS = 10 * 60 * 1000; // 10분 이상 → 오래된 데이터

  // ───────── 심볼 정규화 ─────────
  // 다양한 거래소 표기를 내부 표준으로 변환.
  const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'KRW', 'BUSD', 'FDUSD', 'EUR', 'TRY'];
  function _stripSep(s) { return String(s || '').replace(/[-_/]/g, '').toUpperCase(); }

  function normalize(rawSymbol, exchange) {
    const raw = String(rawSymbol == null ? '' : rawSymbol).trim();
    const ex = String(exchange || '').toUpperCase() || 'UNKNOWN';
    if (!raw) {
      return { symbolId: '', exchange: ex, market: '', baseAsset: '', quoteAsset: '', displaySymbol: '', rawSymbol: raw, status: DataState.NO_SYMBOL };
    }
    let base = '', quote = '';
    // KRW-BTC (업비트) → base=BTC quote=KRW
    let m;
    if ((m = raw.match(/^([A-Za-z0-9]+)[-_/]([A-Za-z0-9]+)$/))) {
      const a = m[1].toUpperCase(), b = m[2].toUpperCase();
      if (QUOTES.includes(a) && !QUOTES.includes(b)) { quote = a; base = b; }    // KRW-BTC
      else { base = a; quote = b; }                                              // BTC-USDT
    } else {
      // 구분자 없는 표기 (BTCUSDT, btcusdt, XBTUSD ...)
      const up = raw.toUpperCase();
      // XBT → BTC 별칭
      const aliased = up.replace(/^XBT/, 'BTC');
      const sorted = QUOTES.slice().sort((x, y) => y.length - x.length);
      for (const q of sorted) {
        if (aliased.endsWith(q) && aliased.length > q.length) { quote = q; base = aliased.slice(0, -q.length); break; }
      }
      if (!base) { base = aliased; quote = ''; }
    }
    base = (base || '').toUpperCase();
    quote = (quote || '').toUpperCase();
    const market = quote || '';
    const displaySymbol = quote ? `${base}/${quote}` : base;
    const symbolId = _stripSep(base + quote);
    return { symbolId, exchange: ex, market, baseAsset: base, quoteAsset: quote, displaySymbol, rawSymbol: raw, status: DataState.READY };
  }

  // ───────── 가격 검증 ─────────
  function validate(price, ts) {
    if (price === null || price === undefined) return { valid: false, status: DataState.NO_PRICE, reason: 'null/undefined' };
    const v = typeof price === 'number' ? price : parseFloat(price);
    if (!Number.isFinite(v)) return { valid: false, status: DataState.NO_PRICE, reason: 'NaN/Infinity' };
    if (v <= 0) return { valid: false, status: DataState.NO_PRICE, reason: '<=0' };
    if (ts != null) {
      const age = Date.now() - Number(ts);
      if (age >= STALE_MS) return { valid: true, status: DataState.STALE, reason: 'stale', ageMs: age };
      if (age >= DELAY_MS) return { valid: true, status: DataState.DELAYED, reason: 'delayed', ageMs: age };
    }
    return { valid: true, status: DataState.READY, reason: 'ok' };
  }

  // ───────── 가격 포맷 (작은 가격을 0.00으로 표시하지 않음) ─────────
  function formatNumber(price, sym) {
    const v = typeof price === 'number' ? price : parseFloat(price);
    if (!Number.isFinite(v) || v <= 0) return null;
    const prefix = String(sym || window.curSymbol || '').includes('KRW') ? '₩' : '';
    let s;
    if (v >= 10000) return prefix + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 100) s = v.toFixed(2);
    else if (v >= 1) s = v.toFixed(4);
    else if (v >= 0.01) s = v.toFixed(4);
    else if (v >= 0.0001) s = v.toFixed(6);
    else {
      // 매우 작은 가격: 유효숫자 4자리 보장 (0.00...x 형태, 절대 0.00 아님)
      const exp = Math.floor(Math.log10(v));
      const digits = Math.min(12, Math.max(8, -exp + 3));
      s = v.toFixed(digits);
    }
    s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return prefix + s;
  }

  // 표시용: 유효하면 숫자, 아니면 상태 문구
  function format(price, sym, ts) {
    const r = validate(price, ts);
    if (!r.valid) return STATUS_TEXT[r.status] || STATUS_TEXT.NO_PRICE;
    const num = formatNumber(price, sym);
    return num == null ? STATUS_TEXT.NO_PRICE : num;
  }

  // ───────── 보조 포맷 ─────────
  function fmtChange(pct) {
    const v = typeof pct === 'number' ? pct : parseFloat(pct);
    if (!Number.isFinite(v)) return STATUS_TEXT.NO_PRICE;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtVolume(v) {
    v = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(v) || v < 0) return STATUS_TEXT.NO_PRICE;
    if (v === 0) return '0';
    return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
  }
  function lastUpdateText(ts) {
    if (!ts) return '';
    const age = Date.now() - Number(ts);
    if (age < 0) return '';
    const min = Math.floor(age / 60000), sec = Math.floor(age / 1000);
    if (age >= STALE_MS) { const d = new Date(Number(ts)); return `오래된 데이터 · 마지막 갱신 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
    if (min >= 1) return `마지막 갱신 ${min}분 전`;
    return `마지막 갱신 ${Math.max(1, sec)}초 전`;
  }

  const DISCLAIMER = '가격 및 시장 데이터는 거래소 또는 데이터 제공 상태에 따라 지연되거나 일시적으로 표시되지 않을 수 있습니다. 표시된 정보는 참고용이며, 실제 거래 판단은 사용자의 책임입니다.';

  // ───────── 노출 ─────────
  window.DataState = DataState;
  window.DataStatusText = STATUS_TEXT;
  window.DataStatusBadgeClass = BADGE_CLASS;
  window.SymbolData = { normalize };
  window.PriceStatus = { validate, format, formatNumber };
  window.DataFmt = { change: fmtChange, volume: fmtVolume, lastUpdate: lastUpdateText };
  window.DATA_DISCLAIMER = DISCLAIMER;

  // 배지 HTML 헬퍼
  window.dsStatusBadge = function(status) {
    const txt = STATUS_TEXT[status] || STATUS_TEXT.NO_PRICE;
    const cls = BADGE_CLASS[status] || 'ds-badge-muted';
    return `<span class="ds-badge ${cls}">${txt}</span>`;
  };
})();
