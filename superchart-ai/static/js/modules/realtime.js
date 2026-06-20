/**
 * realtime.js — 실시간 가격 표시 모듈
 */

window._rt = window._rt || { symbol: '', timeframe: '', lastPrice: 0, candleOpen: 0, lastCandleTime: 0, source: '', pct24h: null, updatedAt: 0 };

export function renderRealtimeUI() {
  const rt = window._rt;
  const curSymbol = window.curSymbol || '';
  if (!rt.lastPrice || rt.symbol !== curSymbol) return;
  const price = rt.lastPrice;
  const el = document.getElementById('curPrice');
  const badge = document.getElementById('changeBadge');
  if (!el) return;
  const fmtPrice = window.fmtPrice || (v => String(v));
  const _newTxt = fmtPrice(price);
  if (el.textContent && el.textContent !== _newTxt) {
    el.classList.remove('price-flash'); void el.offsetWidth; el.classList.add('price-flash');
  }
  el.textContent = _newTxt;
  let pct = rt.pct24h;
  if (pct === null && rt.candleOpen > 0) pct = ((price - rt.candleOpen) / rt.candleOpen * 100);
  if (pct !== null) {
    const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    el.className = 'price-big ' + cls;
    if (badge) { badge.className = 'change-badge ' + cls; badge.textContent = (window.t?window.t('24h 변동'):'24h 변동') + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'; }
  }
  document.title = `${curSymbol.replace('USDT', '')} ${fmtPrice(price)} | 범온 AI 슈퍼차트`;
  const chart = window.chart;
  if (chart && chart.buffer && chart.buffer.length > 0) {
    chart.buffer.close[chart.buffer.length - 1] = price;
    if (price > chart.buffer.high[chart.buffer.length - 1]) chart.buffer.high[chart.buffer.length - 1] = price;
    if (price < chart.buffer.low[chart.buffer.length - 1]) chart.buffer.low[chart.buffer.length - 1] = price;
    chart._dirty = true;
  }
  rt.updatedAt = Date.now();
  // OHLC + Volume 표시
  // chart already declared above
  if (chart && chart.buffer && chart.buffer.length > 0) {
    const i = chart.buffer.length - 1;
    const fp = window.fmtPrice || (v => String(v));
    const oE = document.getElementById('ohlcOpen');
    const hE = document.getElementById('ohlcHigh');
    const lE = document.getElementById('ohlcLow');
    const vE = document.getElementById('ohlcVol');
    const _t = window.t || (s => s);
    if(oE) oE.textContent = _t('시') + ' ' + fp(chart.buffer.open[i]);
    if(hE) hE.textContent = _t('고') + ' ' + fp(chart.buffer.high[i]);
    if(lE) lE.textContent = _t('저') + ' ' + fp(chart.buffer.low[i]);
    const _kmb=v=>v>=1e9?(v/1e9).toFixed(2)+"B":v>=1e6?(v/1e6).toFixed(2)+"M":v>=1e3?(v/1e3).toFixed(1)+"K":v.toFixed(2);
    if(vE){const vol=chart.buffer.volume[i];vE.textContent=_t('거래량')+" "+_kmb(vol)}
    const aE=document.getElementById("ohlcAmount");if(aE){const amt=chart.buffer.volume[i]*chart.buffer.close[i];aE.textContent=_t('거래대금')+" $"+_kmb(amt)}
  }
}

export function updatePriceDisplay(price, openPrice) {
  window._rt.lastPrice = price;
  if (openPrice && openPrice > 0) window._rt.candleOpen = openPrice;
  window._rt.symbol = window.curSymbol || '';
  window._rt.source = 'candle';
  renderRealtimeUI();
}

// window 노출
window.renderRealtimeUI = renderRealtimeUI;
window.updatePriceDisplay = updatePriceDisplay;
