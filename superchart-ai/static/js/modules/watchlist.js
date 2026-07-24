/**
 * watchlist.js — 종목 리스트 모듈
 * 종목 로드, 렌더링, 가격 업데이트, 정렬
 */

import { dedupFetch as _df } from './fetch.js';

let symbols = [];
const coinImgUrl = {};
const _apiMap = {};
const _apiToFront = {};

const WL_SYMBOLS_CACHE_KEY = 'chartOS_wlSymbolsCache_bm1';
const WL_PRICE_CACHE_KEY = 'chartOS_wlPriceCache_bm1';
const WL_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

function _safeParse(raw, fallback = null) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function _hydrateSymbolsCache() {
  let raw = null;
  try { raw = localStorage.getItem(WL_SYMBOLS_CACHE_KEY); } catch (_) { raw = null; }
  const cached = _safeParse(raw, null);
  if (!cached || !Array.isArray(cached.items) || !cached.items.length) return false;
  symbols.length = 0;
  cached.items.forEach(s => {
    if (!s || !s.code) return;
    symbols.push({
      code: s.code,
      name: s.name || s.code,
      kr: s.kr || '',
      apiCode: s.apiCode || null,
      exchangeCode: s.exchangeCode || null,
      asset: s.asset || 'crypto'
    });
    if (s.apiCode) {
      _apiMap[s.code] = s.apiCode;
      _apiToFront[s.apiCode] = s.code;
    }
    if (s.imgUrl) coinImgUrl[s.code] = s.imgUrl;
  });
  window.symbols = symbols;
  return true;
}

function _persistSymbolsCache() {
  try {
    const items = symbols.slice(0, 600).map(s => ({
      code: s.code,
      name: s.name,
      kr: s.kr,
      apiCode: s.apiCode,
      exchangeCode: s.exchangeCode,
      asset: s.asset,
      imgUrl: coinImgUrl[s.code] || ''
    }));
    localStorage.setItem(WL_SYMBOLS_CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
  } catch (_) {}
}

function _hydratePriceCache() {
  let raw = null;
  try { raw = localStorage.getItem(WL_PRICE_CACHE_KEY); } catch (_) { raw = null; }
  const cached = _safeParse(raw, null);
  if (!cached || typeof cached !== 'object') return {};
  const at = Number(cached.at || 0);
  if (!at || (Date.now() - at) > WL_PRICE_CACHE_TTL_MS) return {};
  return (cached.map && typeof cached.map === 'object') ? cached.map : {};
}

function _persistPriceCache(cacheMap) {
  if (!cacheMap || typeof cacheMap !== 'object') return;
  try {
    const now = Date.now();
    if (window._wlPriceCacheSavedAt && (now - window._wlPriceCacheSavedAt) < 3000) return;
    window._wlPriceCacheSavedAt = now;
    localStorage.setItem(WL_PRICE_CACHE_KEY, JSON.stringify({ at: now, map: cacheMap }));
  } catch (_) {}
}

function _renderPriceCellHtml(d) {
  const fmtPrice = window.fmtPrice || (v => String(v));
  const PS = window.PriceStatus;
  if (!d) return '<span style="color:var(--muted);font-size:14px">···</span>';
  const v = PS ? PS.validate(d.price) : { valid: !!(Number.isFinite(d.price) && d.price > 0), status: 'NO_PRICE' };
  if (!v.valid) {
    const status = v.status || 'NO_PRICE';
    const txt = (window.DataStatusText && window.DataStatusText[status]) || '가격 데이터 없음';
    return `<span class="ds-list-badge" title="${txt}">${txt}</span>`;
  }
  const color = d.pct >= 0 ? '#C4384B' : '#3B82F6';
  const sign = d.pct >= 0 ? '+' : '';
  const fmt = (PS && PS.formatNumber(d.price) != null) ? PS.formatNumber(d.price).replace(/^₩/, '') : fmtPrice(d.price);
  const pctTxt = Number.isFinite(d.pct) ? `${sign}${d.pct.toFixed(2)}%` : '';
  return `<div style="font-weight:600;font-size:14px;color:var(--wl-gold)">${fmt}</div>${pctTxt ? `<div style="color:${color};font-size:14px;font-weight:600;margin-top:1px">${pctTxt}</div>` : ''}`;
}

// 시총 순(market-cap) 정렬용 정적 순위 맵 (백엔드 symbol_resolver 와 동일 순서).
// "시총순"(default) 모드에서 서버 순서가 흐트러져도 BTC/ETH 가 상단에 오도록 보강.
const _MCAP_ORDER = [
  'BTCUSDT','ETHUSDT','XRPUSDT','BNBUSDT','SOLUSDT',
  'ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT',
  'TONUSDT','DOTUSDT','SUIUSDT','SHIBUSDT','LTCUSDT',
  'BCHUSDT','UNIUSDT','NEARUSDT','APTUSDT','ICPUSDT',
  'ETCUSDT','HBARUSDT','XLMUSDT','RENDERUSDT','FILUSDT',
  'ARBUSDT','OPUSDT','ATOMUSDT','INJUSDT','FETUSDT',
  'STXUSDT','IMXUSDT','GRTUSDT','ALGOUSDT','THETAUSDT',
  'VETUSDT','AAVEUSDT','TIAUSDT','JUPUSDT','SEIUSDT',
  'KASUSDT','ONDOUSDT','WLDUSDT','ENAUSDT','PEPEUSDT',
  'BONKUSDT','FLOKIUSDT','WIFUSDT','TRUMPUSDT','PENGUUSDT',
  'POLUSDT','LABUSDT',
];
const _MCAP_RANK = {};
_MCAP_ORDER.forEach((c, i) => { _MCAP_RANK[c] = i + 1; });
const _MCAP_UNRANKED = 1e9;
function _mcapRank(code) { return _MCAP_RANK[(code || '').toUpperCase()] || _MCAP_UNRANKED; }

const _ASSET_QUOTE_BY_CLASS = {
  crypto: '/USDT',
  stock: '/USD',
  commodity: '/USD',
  etf: '/USD',
  metal: '/USD',
  forex: '/USD',
  index: '',
  preipo: '/USD'
};

function _formatSymbolDisplay(s) {
  const code = s?.code || '';
  if (code.includes('KRW-')) return { base: code.replace('KRW-', ''), quote: '/KRW' };
  if (code.endsWith('USDT')) return { base: code.replace('USDT', ''), quote: '/USDT' };
  return { base: code, quote: _ASSET_QUOTE_BY_CLASS[s?.asset] || '' };
}

function _setAssetTabActive(asset) {
  const tabs = document.querySelectorAll('#assetTabs .asset-tab');
  tabs.forEach(tab => {
    const active = tab.dataset.asset === asset;
    tab.classList.toggle('active', active);
  });
}

// window에 노출 (다른 모듈 호환)
window.symbols = symbols;
window.coinImgUrl = coinImgUrl;

/**
 * 심볼 로고 다단계 fallback 헬퍼.
 * 우선순위: DB img_url → 로컬 coin-logos → 로컬 stock-logos → SVG 첫글자 배지.
 * 어떤 단계가 404/누락이어도 항상 무언가는 표시되도록 보장한다.
 * 새 종목이 로고 없이 추가돼도 자동으로 배지가 떠 "마크 누락" 재발을 예방한다.
 */
function _symbolBadgeSvg(base, px, asset) {
  const half = Math.round(px / 2);
  // 로고가 없는 자산군(금속/외환/지수/원자재)은 테마 이모지 배지로 표시
  const THEME = {
    metal:     { emo: '🥇', bg: '%23B8860B' },
    forex:     { emo: '💱', bg: '%232E7D6B' },
    index:     { emo: '📊', bg: '%233B5BA5' },
    commodity: { emo: '🛢️', bg: '%238B5E3C' },
    preipo:    { emo: '🚀', bg: '%236A1E33' },
  };
  const th = asset && THEME[asset];
  if (th) {
    const efs = Math.round(px * 0.6);
    const ey = Math.round(px * 0.72);
    return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22${px}%22 height=%22${px}%22><rect width=%22${px}%22 height=%22${px}%22 rx=%22${half}%22 fill=%22${th.bg}%22/><text x=%22${half}%22 y=%22${ey}%22 text-anchor=%22middle%22 font-size=%22${efs}%22>${th.emo}</text></svg>`;
  }
  const label = String(base || '?').slice(0, 4);
  const fs = px <= 18 ? 7 : 8;
  const ty = Math.round(px * 0.66);
  return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22${px}%22 height=%22${px}%22><rect width=%22${px}%22 height=%22${px}%22 rx=%22${half}%22 fill=%22%236A1E33%22/><text x=%22${half}%22 y=%22${ty}%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%22${fs}%22>${label}</text></svg>`;
}

/** base 자산명을 안전한 로고 파일명 토큰으로 (영숫자만). */
function _logoToken(base) {
  return String(base || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function _assetOfSymbol(code) {
  try {
    if (Array.isArray(window.symbols)) {
      const hit = window.symbols.find(x => x.code === code);
      if (hit && hit.asset) return hit.asset;
    }
  } catch (_) {}
  return null;
}

function _localLogoPaths(code, base) {
  const token = _logoToken(base);
  if (!token) return ['', ''];
  const asset = _assetOfSymbol(code);
  if (!asset) return ['', ''];
  const isStockLike = asset === 'stock' || asset === 'etf' || asset === 'commodity' || asset === 'metal' || asset === 'forex' || asset === 'index' || asset === 'preipo';
  if (isStockLike) {
    return [`/static/stock-logos/${token}.svg`, `/static/stock-logos/${token}.png`];
  }
  return [`/static/coin-logos/${token}.png`, `/static/coin-logos/${token}.svg`];
}

/**
 * <img> 마크업을 반환한다. onerror 체인으로 단계적 fallback.
 * @param {string} code  심볼 코드 (BTCUSDT 등)
 * @param {string} base  표시용 base (BTC 등)
 * @param {number} px    크기(px)
 * @param {string} extraStyle  추가 인라인 스타일
 */
window._symbolLogoImg = function(code, base, px, extraStyle) {
  px = px || 20;
  const dbUrl = (window.coinImgUrl || {})[code] || '';
  const asset = _assetOfSymbol(code);
  const badge = _symbolBadgeSvg(base, px, asset);
  const [p1, p2] = _localLogoPaths(code, base);
  // 우선순위: DB img → 로컬 로고 파일 → 테마 배지
  // coinImgUrl(백엔드가 coin-logos/stock-logos 폴더를 직접 스캔해 채움)이 비어 있으면
  // 로컬 파일도 없음이 확정이므로, png/svg 추측 요청(무조건 404) 대신 곧바로 글자 배지를 쓴다.
  const chain = dbUrl ? [dbUrl, p1, p2].filter(Boolean) : [];
  const startSrc = chain.length ? chain[0] : badge;
  const rest = chain.slice(1);
  const style = `width:${px}px;height:${px}px;border-radius:50%;flex-shrink:0;${extraStyle || ''}`;
  // 후보 목록을 &#39;(작은따옴표)로 감싼 배열로 만들어 onerror 속성(큰따옴표) 충돌 방지
  const q = rest.map(u => `&#39;${u}&#39;`).join(',');
  const onerr = `var q=[${q}];if(this._i==null){this._i=0}if(this._i&lt;q.length){this.src=q[this._i++];}else{this.onerror=null;this.src=&#39;${badge}&#39;;}`;
  return `<img src="${startSrc}" loading="lazy" decoding="async" alt="" onerror="${onerr}" style="${style}">`;
};

window._updateSymIcon = function(code) {
  const el = document.getElementById('symIcon');
  if (!el || !code) return;
  const base = code.replace('USDT', '').replace('KRW-', '');
  const badge = _symbolBadgeSvg(base, 24);
  const url = coinImgUrl[code] || badge;
  el.src = url;
  el.style.display = '';
  el.alt = base;
  el.setAttribute('data-step', coinImgUrl[code] ? '0' : '1');
  el.onerror = function() {
    const s = this.getAttribute('data-step') || '0';
    if (s === '0') { this.setAttribute('data-step', '1'); this.src = badge; }
    else { this.onerror = null; }
  };
};

window._updateSymName = function(code) {
  const el = document.getElementById('symName');
  if (!el || !code) return;
  let base, quote;
  if (code.includes('KRW-')) { base = code.replace('KRW-', ''); quote = '/KRW'; }
  else { base = code.replace('USDT', ''); quote = '/USDT'; }
  el.innerHTML = `${base}<span class="quote">${quote}</span>`;
};

export { symbols, coinImgUrl, _apiMap, _apiToFront };

export async function loadSymbolsFromDB() {
  try {
    // 네트워크가 느린 환경에서도 사용자 체감 공백을 줄이기 위해 로컬 캐시를 먼저 복구
    if (!symbols.length) _hydrateSymbolsCache();

    const collected = [];
    const collectedImg = {};
    const collectedApi = {};
    const collectedApiToFront = {};

    let page = 1;
    const pageSize = 500;          // 큰 page_size 는 서버 머지(라이브 fetch) 지연으로 간헐 502 → 작게 페이징
    const seen = new Set();

    while (true) {
      // 일시적 502/네트워크 오류로 목록이 통째로 비지 않도록 페이지별 재시도
      let j = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await _df(`/v1/symbols?page=${page}&page_size=${pageSize}`);
        if (r && r.ok) {
          j = await r.json().catch(() => null);
          if (j && j.success && j.data && Array.isArray(j.data.items)) break;
          j = null;
        }
        await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
      }
      // 첫 페이지조차 실패하면 기존 목록 유지(빈 화면 방지)하고 종료
      if (!j) break;

      const items = j.data.items;
      if (!items.length) break;

      items.forEach(s => {
        const code = s.symbol_code;
        if (!code || seen.has(code)) return;
        seen.add(code);
        collected.push({
          code,
          name: s.display_name_en || code,
          kr: s.display_name_ko || '',
          apiCode: s.api_code || null,
          exchangeCode: s.exchange_code || null,
          asset: s.asset_class || 'crypto'
        });
        if (s.img_url) collectedImg[code] = s.img_url;
        if (s.api_code) { collectedApi[code] = s.api_code; collectedApiToFront[s.api_code] = code; }
      });

      if (!(j?.data?.has_next)) break;
      page += 1;
      if (page > 50) break; // 안전장치
    }

    // 일부라도 받아온 경우에만 교체(중간 실패 시 기존 목록 보존)
    if (collected.length) {
      symbols.length = 0;
      collected.forEach(s => symbols.push(s));
      Object.assign(coinImgUrl, collectedImg);
      Object.assign(_apiMap, collectedApi);
      Object.assign(_apiToFront, collectedApiToFront);
      _persistSymbolsCache();
    }

    window.symbols = symbols;
  } catch (e) { }
}

export function renderWL(f = '', skipPrices = false) {
  const el = document.getElementById('watchlist');
  if (!el) return;
  const fl = f.toLowerCase();
  const assetFilter = window._wlAssetFilter || 'stock';
  let list = symbols;
  list = list.filter(s => s.asset === assetFilter);
  if (f) list = list.filter(s => s.code.toLowerCase().includes(fl) || s.name.toLowerCase().includes(fl) || s.kr.includes(f));
  // 가격 상태 필터
  // 기본값(all): 가격 미지원/지연 종목도 목록에 표시하고 상태 배지로 안내한다.
  // valid 필터를 선택한 경우에만 가격 확인 완료 + 유효 종목만 표시한다.
  const pf = window._wlPriceFilter || 'all';
  if (pf === 'valid' && window._wlPriceValid) {
    list = list.filter(s => window._wlPriceValid[s.code] === true);
  }
  list = _sortSymbols(list);
  if (!list.length) {
    el.innerHTML = '<div class="' + (!f ? 'state-loading compact' : 'state-empty compact') + '">' + (!f ? '종목을 불러오는 중입니다…' : '검색 결과가 없습니다') + '</div>';
    return;
  }
  const curSymbol = window.curSymbol || '';
  el.innerHTML = list.map(s => {
    const { base, quote } = _formatSymbolDisplay(s);
    const logoImg = window._symbolLogoImg(s.code, base, 20);
    const cached = (window._wlPriceCache || {})[s.code] || null;
    const priceHtml = _renderPriceCellHtml(cached);
    return `<div class="wl-item ${s.code === curSymbol ? 'active' : ''}" data-symbol="${s.code}" onclick="window._selectSym('${s.code}')">
    <div style="display:flex;align-items:center;gap:8px">
      ${logoImg}
      <div style="min-width:0;overflow:hidden"><div style="font-weight:600;font-size:14px;color:var(--wl-gold);white-space:nowrap">${base}${quote ? `<span style="color:var(--muted);font-weight:400;font-size:14px;margin-left:2px">${quote}</span>` : ''}</div>
      <div style="color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(localStorage.getItem('chartOS_lang')||'ko')==='ko'?(s.kr||s.name||base):(s.name||s.kr||base)}</div></div>
    </div>
    <div style="text-align:right;min-width:60px;flex-shrink:0" id="wp_${s.code}">${priceHtml}</div></div>`;
  }).join('');
  if (!skipPrices) loadWLPrices({ reason: 'render' });
}

function _sortSymbols(list) {
  const mode = document.getElementById('wlSort')?.value || 'default';
  if (mode === 'default') {
    // 시총순: 정적 시총 순위로 정렬. 동순위(미시드)는 서버가 준 순서 유지(안정 정렬).
    return list
      .map((s, i) => [s, i])
      .sort((a, b) => {
        const ra = _mcapRank(a[0].code), rb = _mcapRank(b[0].code);
        return ra !== rb ? ra - rb : a[1] - b[1];
      })
      .map(pair => pair[0]);
  }
  const cache = window._wlPriceCache || {};
  const sorted = [...list];
  if (mode === 'gain') sorted.sort((a, b) => (cache[b.code]?.pct || -999) - (cache[a.code]?.pct || -999));
  else if (mode === 'loss') sorted.sort((a, b) => (cache[a.code]?.pct || 999) - (cache[b.code]?.pct || 999));
  else if (mode === 'price_desc') sorted.sort((a, b) => (cache[b.code]?.price || 0) - (cache[a.code]?.price || 0));
  else if (mode === 'price_asc') sorted.sort((a, b) => (cache[a.code]?.price || Infinity) - (cache[b.code]?.price || Infinity));
  else if (mode === 'name_asc') sorted.sort((a, b) => a.code.localeCompare(b.code));
  else if (mode === 'name_desc') sorted.sort((a, b) => b.code.localeCompare(a.code));
  return sorted;
}

export async function loadWLPrices(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  const cooldown = 1200;
  if (!force && window._wlPriceLoading) return;
  if (!force && window._wlPriceLastAt && (now - window._wlPriceLastAt) < cooldown) return;
  window._wlPriceLoading = true;
  window._wlPriceLastAt = now;
  try {
    const r = await _df('/v1/charts/ticker-24hr');
    if (!r || !r.ok) return;
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data)) return;
    const map = {};
    let staleCount = 0;
    for (const t of data) {
      map[t.symbol] = { price: parseFloat(t.lastPrice), pct: parseFloat(t.priceChangePercent) };
      if (t.stale) staleCount++;
    }
    if (staleCount > 0) {
      // 서버(BitMart)가 업스트림 장애로 24시간 지난 캐시를 대신 반환한 상태
      // (charts.py _mark_stale). 가격은 그대로 표시하되 콘솔에 남겨 원인 파악을 돕는다.
      console.warn(`[watchlist] ${staleCount}개 종목이 오래된(최대 24h) 가격 데이터입니다 — 업스트림 연동 확인 필요`);
    }
    window._wlPriceCache = window._wlPriceCache || {};
    // 전체 ticker에 없는 종목은 개별 호출(우리 백엔드 /v1/charts/ticker-24hr → BitMart).
    // 개별 보강은 "현재 선택 종목" 중심의 소수(8개)로 제한해 부하를 줄인다.
    const MAX_FILL = 8;
    const curSym = window.curSymbol || '';
    const missingAll = symbols.filter(s => !map[s.apiCode || s.code] && !map[s.code]);
    // 현재 선택 종목/상단 노출 종목부터 우선 보강
    const missing = missingAll.sort((a, b) => {
      if (a.code === curSym) return -1;
      if (b.code === curSym) return 1;
      return 0;
    }).slice(0, MAX_FILL);
    if (missing.length) {
      await Promise.allSettled(missing.map(s =>
        _df(`/v1/charts/ticker-24hr?symbol=${s.apiCode || s.code}`)
          .then(r2 => (r2 && r2.ok) ? r2.json() : null)
          .then(d2 => {
            if (d2 && d2.lastPrice) {
              const norm = { price: parseFloat(d2.lastPrice), pct: parseFloat(d2.priceChangePercent || 0) };
              map[d2.symbol || s.apiCode || s.code] = norm;
              map[s.apiCode || s.code] = norm;
              map[s.code] = norm;
            }
          }).catch(() => {})
      ));
    }

    const readPrice = (s) => map[s.apiCode || s.code] || map[s.code] || window._wlPriceCache?.[s.code] || null;

    for (const s of symbols) {
      const d = readPrice(s);
      if (d) window._wlPriceCache[s.code] = d;
    }
    const PS = window.PriceStatus;
    window._wlPriceValid = window._wlPriceValid || {};
    let validCount = 0;
    for (const s of symbols) {
      const el = document.getElementById('wp_' + s.code);
      if (!el) continue;
      const d = readPrice(s);
      // 가격 유효성 검증 (data-status.js). 0/NaN/null 은 무효 처리.
      const v = (d && PS) ? PS.validate(d.price) : { valid: !!(d && Number.isFinite(d.price) && d.price > 0), status: 'NO_PRICE' };
      window._wlPriceValid[s.code] = !!(d && v.valid);
      if (window._wlPriceValid[s.code]) validCount += 1;
      el.innerHTML = _renderPriceCellHtml(d);
    }
    _persistPriceCache(window._wlPriceCache);
    const total = symbols.length || 0;
    const coverage = total ? (validCount / total) : 0;
    window._wlPriceCoverage = { validCount, total, coverage, at: Date.now() };

    // 커버리지가 낮으면(초기 네트워크 지연/일시 장애) 1회 자동 재시도
    if (total >= 20 && coverage < 0.35) {
      const now = Date.now();
      if (!window._wlLowCoverageRetryAt || (now - window._wlLowCoverageRetryAt) > 15000) {
        window._wlLowCoverageRetryAt = now;
        setTimeout(() => {
          try { loadWLPrices({ force: true, reason: 'low_coverage_retry' }); } catch (_) {}
        }, 2500);
      }
    }

    // 가격 확인 후 목록 재렌더 (정렬/표시 업데이트)
    if (!window._wlFilterReRender) {
      window._wlFilterReRender = true;
      const curSearch = document.getElementById('searchInput')?.value || '';
      renderWL(curSearch, true);
      window._wlFilterReRender = false;
    }
  } catch (e) { /* ticker load fail — silent */ }
  finally { window._wlPriceLoading = false; }
}

// window 노출
window.renderWL = renderWL;
window.loadWLPrices = loadWLPrices;
window._wlPriceCache = window._wlPriceCache || _hydratePriceCache();
window._wlPriceFilter = window._wlPriceFilter || 'all';
window._wlPriceLoading = false;
window._wlPriceLastAt = 0;

// 가격 상태 필터 (전체 / 가격 없는 종목 숨기기 / 지원 종목만 보기)
window._wlSetPriceFilter = function(v) {
  window._wlPriceFilter = v || 'all';
  const curSearch = document.getElementById('searchInput')?.value || '';
  renderWL(curSearch);
};

// 검색 + 정렬 이벤트
const _searchEl = document.getElementById('searchInput');
if (_searchEl) {
  _searchEl.oninput = e => renderWL(e.target.value);
  _searchEl.onfocus = function() { this.select(); };
}
const _sortEl = document.getElementById('wlSort');
if (_sortEl) {
  const saved = localStorage.getItem('chartOS_wlSort');
  if (saved) _sortEl.value = saved;
  _sortEl.onchange = function() {
    localStorage.setItem('chartOS_wlSort', _sortEl.value);
    const curSearch = document.getElementById('searchInput')?.value || '';
    renderWL(curSearch);
  };
}

const _assetTabs = document.querySelectorAll('#assetTabs .asset-tab');
if (_assetTabs.length) {
  const savedAsset = localStorage.getItem('chartOS_wlAssetFilter');
  // 6개 자산군: 암호화폐/주식/금속/외환/지수/원자재. 기본값은 암호화폐.
  const allowed = new Set(['crypto', 'stock', 'metal', 'forex', 'index', 'commodity', 'preipo']);
  window._wlAssetFilter = allowed.has(savedAsset) ? savedAsset : (allowed.has(window._wlAssetFilter) ? window._wlAssetFilter : 'crypto');
  if (!allowed.has(window._wlAssetFilter)) window._wlAssetFilter = 'crypto';
  _setAssetTabActive(window._wlAssetFilter);
  _assetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const nextAsset = tab.dataset.asset || 'stock';
      window._wlAssetFilter = nextAsset;
      localStorage.setItem('chartOS_wlAssetFilter', nextAsset);
      _setAssetTabActive(nextAsset);
      const curSearch = document.getElementById('searchInput')?.value || '';
      renderWL(curSearch);
    });
  });
}

// 검색어가 현재 선택 종목을 가리키는 상태로 고정되어 "선택한 종목만 보임"처럼 느껴질 때 자동 복구
// (사용자가 명시적으로 다른 검색어를 입력한 경우는 유지)
document.addEventListener('symbolChanged', () => {
  const searchEl = document.getElementById('searchInput');
  if (!searchEl) return;
  const q = (searchEl.value || '').trim();
  if (!q) return;
  const sym = String(window.curSymbol || '').toUpperCase();
  const base = sym.replace('USDT', '').replace('KRW-', '');
  const nq = q.toUpperCase().replace(/\s+/g, '');
  const mayLocked = (
    nq === sym ||
    nq === base ||
    nq === `${base}/USDT` ||
    nq === `${base}/KRW`
  );
  if (!mayLocked) return;
  searchEl.value = '';
  renderWL('');
});
