/**
 * hotmap.js — 히트맵 + 인기종목 모듈
 * 의존: window.symbols, window.coinImgUrl, window._selectSym
 */

const _ASSET_TAB_CONFIG = [
  { key: 'crypto', heatmapBtnId: 'hmTabCrypto', hotBtnId: 'hotTabCrypto' },
  { key: 'stock', heatmapBtnId: 'hmTabStock', hotBtnId: 'hotTabStock' },
  { key: 'commodity', heatmapBtnId: 'hmTabCommodity', hotBtnId: 'hotTabCommodity' },
  { key: 'etf', heatmapBtnId: 'hmTabEtf', hotBtnId: 'hotTabEtf' }
];

let _tickerCache = { ts: 0, map: null };
const _TICKER_CACHE_TTL = 8000;

function _formatCodeParts(symbol) {
  const code = symbol?.code || '';
  if (code.includes('KRW-')) return { base: code.replace('KRW-', ''), quote: '/KRW' };
  if (code.endsWith('USDT')) return { base: code.replace('USDT', ''), quote: '/USDT' };
  return { base: code, quote: '/USD' };
}

function _setAssetButtons(activeAsset, type) {
  const idKey = type === 'hot' ? 'hotBtnId' : 'heatmapBtnId';
  _ASSET_TAB_CONFIG.forEach(cfg => {
    const btn = document.getElementById(cfg[idKey]);
    if (!btn) return;
    const active = cfg.key === activeAsset;
    btn.style.background = active ? 'var(--accent)' : 'transparent';
    btn.style.color = active ? '#fff' : 'var(--text)';
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  });
}

function _collectTickerRows(asset) {
  const symbols = (window.symbols || []).filter(s => (s?.asset || 'crypto') === asset);
  if (!symbols.length) return [];
  return symbols;
}

async function _getTickerMap() {
  if (_tickerCache.map && Date.now() - _tickerCache.ts < _TICKER_CACHE_TTL) {
    return _tickerCache.map;
  }

  const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
  const r = await requester('/v1/charts/ticker-24hr', { credentials: 'include' }).catch(() => null);
  if (!r || !r.ok) return _tickerCache.map || {};
  const allTickers = await r.json().catch(() => []);
  const tickerMap = {};
  if (Array.isArray(allTickers)) {
    allTickers.forEach(t => {
      if (t?.symbol) tickerMap[t.symbol] = t;
    });
  }
  _tickerCache = { ts: Date.now(), map: tickerMap };
  return tickerMap;
}

window._hmAsset = window._hmAsset || 'crypto';
window.loadHeatmap = async function() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;

  _setAssetButtons(window._hmAsset, 'heatmap');
  grid.innerHTML = '<div class="state-loading" style="grid-column:1/-1">로딩 중...</div>';

  try {
    const coinImgUrl = window.coinImgUrl || {};
    const filteredSymbols = _collectTickerRows(window._hmAsset);
    const tickerMap = await _getTickerMap();

    const data = [];
    for (const s of filteredSymbols) {
      const ticker = tickerMap[s.apiCode || s.code] || tickerMap[s.code];
      if (!ticker) continue;
      const pct = Number.parseFloat(ticker.priceChangePercent || 0);
      const rawPrice = ticker.lastPrice || '0';
      data.push({
        code: s.code,
        kr: s.kr || s.display_name_ko || '',
        pct,
        rawPrice,
        img: coinImgUrl[s.code] || ''
      });
    }

    data.sort((a, b) => b.pct - a.pct);
    if (!data.length) {
      grid.innerHTML = '<div class="state-empty" style="grid-column:1/-1">시세 데이터가 없습니다</div>';
      return;
    }
    const isKo = (localStorage.getItem('chartOS_lang') || 'ko') === 'ko';

    let html = '';
    for (const d of data) {
      const { base, quote } = _formatCodeParts({ code: d.code });
      const abs = Math.min(Math.abs(d.pct), 10);
      const alpha = 0.05 + abs / 10 * 0.12;
      const bg = d.pct >= 0 ? `rgba(196,56,75,${alpha})` : `rgba(59,130,246,${alpha})`;
      const color = d.pct >= 0 ? '#C4384B' : '#3B82F6';
      const imgTag = d.img ? `<img src="${d.img}" loading="lazy" decoding="async" alt="" style="width:14px;height:14px;border-radius:50%;vertical-align:middle">` : '';
      const krName = isKo ? (d.kr || base) : base;

      html += `<div onclick="this.style.borderColor='#921230';setTimeout(()=>this.style.borderColor='var(--color-border)',500);window._selectSym('${d.code}')" style="background:${bg};border-radius:8px;padding:7px 8px;cursor:pointer;border:1px solid var(--color-border);transition:border-color .2s">
        <div style="font-weight:600;font-size:14px;color:var(--gold-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${imgTag} ${base}<span style="color:var(--muted);font-weight:400;font-size:13px;margin-left:2px">${quote}</span></div>
        <div style="color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${krName}</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
          <span style="font-size:12px;color:var(--text)">${String(d.rawPrice).replace(/0+$/, '').replace(/\.$/, '')}</span>
          <span style="font-size:14px;font-weight:700;color:${color}">${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%</span>
        </div>
      </div>`;
    }

    grid.innerHTML = html || '<div class="state-empty" style="grid-column:1/-1">표시할 종목이 없습니다</div>';
  } catch (e) {
    grid.innerHTML = '<div class="state-error" style="grid-column:1/-1">로드 실패</div>';
  }
};

window._hotAsset = window._hotAsset || 'crypto';
window._hotSort = window._hotSort || 'turnover';
window._loadHotCoins = async function() {
  const listEl = document.getElementById('hotList');
  if (!listEl) return;

  _setAssetButtons(window._hotAsset, 'hot');
  listEl.innerHTML = '<div class="state-loading">로딩 중...</div>';

  try {
    const symbols = _collectTickerRows(window._hotAsset);
    const tickerMap = await _getTickerMap();
    const fmtPrice = window.fmtPrice || (v => String(v));

    const rows = [];
    for (const s of symbols) {
      const ticker = tickerMap[s.apiCode || s.code] || tickerMap[s.code];
      if (!ticker) continue;

      const price = Number.parseFloat(ticker.lastPrice || 0);
      const pct = Number.parseFloat(ticker.priceChangePercent || 0);
      const quoteVolume = Number.parseFloat(ticker.quoteVolume || 0);
      const volume = Number.parseFloat(ticker.volume || 0);
      const turnover = Number.isFinite(quoteVolume) && quoteVolume > 0 ? quoteVolume : (Number.isFinite(price) && Number.isFinite(volume) ? price * volume : 0);
      const momentumScore = Math.abs(pct) * Math.log10(Math.max(turnover, 1));

      rows.push({ code: s.code, kr: s.kr || s.name || '', price, pct, turnover, momentumScore });
    }

    const sortMode = window._hotSort || 'turnover';
    rows.sort((a, b) => sortMode === 'momentum' ? b.momentumScore - a.momentumScore : b.turnover - a.turnover);

    const topRows = rows.slice(0, 10);
    if (!topRows.length) {
      listEl.innerHTML = '<div class="state-empty">표시할 종목이 없습니다</div>';
      return;
    }

    const isKo = (localStorage.getItem('chartOS_lang') || 'ko') === 'ko';
    listEl.innerHTML = topRows.map((row, i) => {
      const { base, quote } = _formatCodeParts({ code: row.code });
      const changeColor = row.pct >= 0 ? '#C4384B' : '#3B82F6';
      const rankBadge = `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:rgba(146,18,48,0.1);color:#921230;font-size:11px;font-weight:700">${i + 1}</span>`;
      const turnoverText = row.turnover > 0 ? row.turnover.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-';

      return `<div onclick="window._selectSym('${row.code}')" style="display:flex;align-items:center;justify-content:space-between;padding:8px 6px;border-bottom:1px solid rgba(216,182,106,0.15);cursor:pointer">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          ${rankBadge}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--gold-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${base}<span style="color:var(--muted);font-weight:400;margin-left:2px">${quote}</span></div>
            <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${isKo ? (row.kr || base) : base}</div>
          </div>
        </div>
        <div style="text-align:right;min-width:110px">
          <div style="font-size:13px;font-weight:600;color:var(--wl-gold)">${fmtPrice(row.price)}</div>
          <div style="font-size:12px;font-weight:700;color:${changeColor}">${row.pct >= 0 ? '+' : ''}${Number.isFinite(row.pct) ? row.pct.toFixed(2) : '0.00'}%</div>
          <div style="font-size:11px;color:var(--muted)">거래대금 ${turnoverText}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="state-error">로드 실패</div>';
  }
};