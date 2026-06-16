/**
 * watchlist.js — 종목 리스트 모듈
 * 종목 로드, 렌더링, 가격 업데이트, 정렬
 */

let symbols = [];
const coinImgUrl = {};
const _apiMap = {};
const _apiToFront = {};

// window에 노출 (다른 모듈 호환)
window.symbols = symbols;
window.coinImgUrl = coinImgUrl;

window._updateSymIcon = function(code) {
  const el = document.getElementById('symIcon');
  if (!el || !code) return;
  const url = coinImgUrl[code] || '';
  if (url) { el.src = url; el.style.display = ''; el.alt = code.replace('USDT', '').replace('KRW-', ''); }
  else { el.style.display = 'none'; }
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
    const r = await fetch('/v1/symbols?page_size=1000');
    const j = await r.json();
    if (j.success && j.data && j.data.items) {
      symbols.length = 0;
      j.data.items.forEach(s => {
        symbols.push({
          code: s.symbol_code,
          name: s.display_name_en || s.symbol_code,
          kr: s.display_name_ko || '',
          apiCode: s.api_code || null,
          exchangeCode: s.exchange_code || null,
          asset: s.asset_class || 'crypto'
        });
        if (s.img_url) coinImgUrl[s.symbol_code] = s.img_url;
        if (s.api_code) { _apiMap[s.symbol_code] = s.api_code; _apiToFront[s.api_code] = s.symbol_code; }
      });
      window.symbols = symbols;
    }
  } catch (e) { }
}

export function renderWL(f = '') {
  const el = document.getElementById('watchlist');
  if (!el) return;
  const fl = f.toLowerCase();
  const assetFilter = window._wlAssetFilter || 'crypto';
  let list = symbols;
  if (assetFilter !== 'all') list = list.filter(s => s.asset === assetFilter);
  if (f) list = list.filter(s => s.code.toLowerCase().includes(fl) || s.name.toLowerCase().includes(fl) || s.kr.includes(f));
  list = _sortSymbols(list);
  if (!list.length) {
    el.innerHTML = '<div class="' + (!f ? 'state-loading compact' : 'state-empty compact') + '">' + (!f ? '심볼을 로딩 중...' : '검색 결과가 없습니다') + '</div>';
    return;
  }
  const curSymbol = window.curSymbol || '';
  el.innerHTML = list.map(s => {
    const imgUrl = coinImgUrl[s.code] || '';
    const sym = s.code.replace('USDT', '');
    return `<div class="wl-item ${s.code === curSymbol ? 'active' : ''}" data-symbol="${s.code}" onclick="window._selectSym('${s.code}')">
    <div style="display:flex;align-items:center;gap:8px">
      <img src="${imgUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22><rect width=%2224%22 height=%2224%22 rx=%2212%22 fill=%22%236A1E33%22/><text x=%2212%22 y=%2216%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%228%22>' + sym.slice(0,4) + '</text></svg>'}" loading="lazy" decoding="async" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22><rect width=%2224%22 height=%2224%22 rx=%2212%22 fill=%22%236A1E33%22/><text x=%2212%22 y=%2216%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%228%22>${sym.slice(0,4)}</text></svg>'" style="width:20px;height:20px;border-radius:50%;flex-shrink:0">
      <div style="min-width:0;overflow:hidden"><div style="font-weight:600;font-size:14px;color:var(--wl-gold);white-space:nowrap">${sym}<span style="color:var(--muted);font-weight:400;font-size:14px;margin-left:2px">/USDT</span></div>
      <div style="color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(localStorage.getItem('chartOS_lang')||'ko')==='ko'?(s.kr||s.name||sym):(s.name||s.kr||sym)}</div></div>
    </div>
    <div style="text-align:right;min-width:60px;flex-shrink:0" id="wp_${s.code}"><span style="color:var(--muted);font-size:14px">···</span></div></div>`;
  }).join('');
  loadWLPrices();
}

function _sortSymbols(list) {
  const mode = document.getElementById('wlSort')?.value || 'default';
  if (mode === 'default') return list;
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

export async function loadWLPrices() {
  try {
    const r = await fetch('/v1/charts/ticker-24hr');
    const data = await r.json();
    if (!Array.isArray(data)) return;
    const map = {};
    for (const t of data) map[t.symbol] = { price: parseFloat(t.lastPrice), pct: parseFloat(t.priceChangePercent) };
    window._wlPriceCache = window._wlPriceCache || {};
    // 전체 ticker에 없는 종목은 개별 호출 (Bitget 미지원 → Binance fallback)
    const missing = symbols.filter(s => !map[s.apiCode || s.code] && !map[s.code]);
    if (missing.length) {
      const fills = await Promise.allSettled(missing.map(s =>
        fetch(`/v1/charts/ticker-24hr?symbol=${s.apiCode || s.code}`).then(r2 => r2.json()).then(d2 => {
          if (d2 && d2.lastPrice) map[d2.symbol || s.code] = { price: parseFloat(d2.lastPrice), pct: parseFloat(d2.priceChangePercent || 0) };
        }).catch(() => {})
      ));
    }
    for (const s of symbols) {
      const d = map[s.apiCode || s.code] || map[s.code];
      if (d) window._wlPriceCache[s.code] = d;
    }
    const fmtPrice = window.fmtPrice || (v => String(v));
    for (const s of symbols) {
      const el = document.getElementById('wp_' + s.code);
      if (!el) continue;
      const d = map[s.apiCode || s.code] || map[s.code];
      if (!d) continue;
      const color = d.pct >= 0 ? '#C4384B' : '#3B82F6';
      const sign = d.pct >= 0 ? '+' : '';
      const fmt = fmtPrice(d.price);
      el.innerHTML = `<div style="font-weight:600;font-size:14px;color:var(--wl-gold)">${fmt}</div><div style="color:${color};font-size:14px;font-weight:600;margin-top:1px">${sign}${d.pct.toFixed(2)}%</div>`;
    }
  } catch (e) { /* ticker load fail — silent */ }
}

// window 노출
window.renderWL = renderWL;
window.loadWLPrices = loadWLPrices;
window._wlPriceCache = window._wlPriceCache || {};

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
