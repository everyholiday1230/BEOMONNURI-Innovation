/**
 * realtime.js — 실시간 가격 표시 모듈 (상태 인식 강화)
 *
 * 가격이 null/0/NaN/미수신이거나 오래되었을 때 빈칸/0 대신 이해 가능한 상태
 * 문구를 표시한다. 종목 전환 시 이전 가격을 즉시 비우고 "새 종목 가격 확인 중"
 * 으로 바꾼다. 마지막 갱신 시간·데이터 소스·재시도 버튼을 함께 노출한다.
 * data-status.js(window.PriceStatus / DataState / DataFmt) 의존(없으면 graceful).
 */

window._rt = window._rt || { symbol: '', timeframe: '', lastPrice: 0, candleOpen: 0, lastCandleTime: 0, source: '', pct24h: null, updatedAt: 0 };

// 마지막 정상 수신 가격(심볼별) — fallback 표시용
const _lastGoodPrice = {};
// 진단 로그
const _diag = { rawSymbol: '', normalizedSymbol: '', exchange: '', marketType: '', dataSource: '', price: null, timestamp: 0, status: '', retryCount: 0, lastError: '' };
window._priceDiag = _diag;

function _PS() { return window.PriceStatus; }
function _DS() { return window.DataState || {}; }

function _setStatusUI(status, opts) {
  opts = opts || {};
  const badge = document.getElementById('priceStatusBadge');
  const upd = document.getElementById('priceUpdatedAt');
  const retry = document.getElementById('priceRetryBtn');
  const diagBtn = document.getElementById('dsDiagBtn');
  const txtMap = window.DataStatusText || {};
  const clsMap = window.DataStatusBadgeClass || {};
  if (badge) {
    if (status && status !== (_DS().READY || 'READY')) {
      badge.textContent = txtMap[status] || '가격 확인 중';
      badge.className = 'ds-badge ' + (clsMap[status] || 'ds-badge-loading');
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // '마지막 갱신 N분 전' 표시는 사용자 요청으로 노출하지 않음(항상 비움).
  if (upd) upd.textContent = '';
  if (retry) retry.style.display = opts.showRetry ? '' : 'none';
  // 진단 버튼: admin/dev 모드에서만
  if (diagBtn) {
    const isDev = (function(){ try { return localStorage.getItem('chartOS_devDiag') === '1' || /[?&]diag=1/.test(location.search) || (window.userPlan === 'admin'); } catch { return false; } })();
    diagBtn.style.display = isDev ? '' : 'none';
  }
}

export function renderRealtimeUI() {
  const rt = window._rt;
  const curSymbol = window.curSymbol || '';
  const el = document.getElementById('curPrice');
  const badge = document.getElementById('changeBadge');
  if (!el) return;
  const fmtPrice = window.fmtPrice || (v => String(v));
  const PS = _PS();
  const DS = _DS();

  // 종목 전환: _rt가 아직 새 종목 가격을 못 받았으면 이전 가격 표시 금지
  if (rt.symbol !== curSymbol) {
    el.textContent = '새 종목 가격 확인 중';
    el.className = 'price-big flat';
    if (badge) { badge.className = 'change-badge flat'; badge.textContent = '24시간 변동률 확인 중'; }
    _setStatusUI(DS.LOADING || 'LOADING', { updatedText: '' });
    _diag.status = DS.LOADING || 'LOADING';
    return;
  }

  // 가격 검증
  const price = rt.lastPrice;
  const ts = rt.updatedAt || 0;
  const v = PS ? PS.validate(price, ts || null) : { valid: !!price && isFinite(price) && price > 0, status: 'READY' };
  _diag.price = price; _diag.timestamp = ts; _diag.dataSource = rt.source || ''; _diag.normalizedSymbol = curSymbol; _diag.status = v.status;

  if (!v.valid) {
    // 마지막 정상 수신 가격 fallback
    const good = _lastGoodPrice[curSymbol];
    if (good && good.price > 0) {
      const numTxt = PS ? PS.format(good.price, curSymbol) : fmtPrice(good.price);
      el.textContent = numTxt;
      el.className = 'price-big flat';
      _setStatusUI(DS.STALE || 'STALE', { updatedText: '마지막 수신 가격 · 최신 가격이 아닐 수 있습니다.', showRetry: true });
    } else {
      el.textContent = (window.DataStatusText && window.DataStatusText[v.status]) || '가격 데이터 없음';
      el.className = 'price-big flat';
      if (badge) { badge.className = 'change-badge flat'; badge.textContent = '24시간 변동률 확인 필요'; }
      _setStatusUI(v.status, { showRetry: true });
    }
    document.title = `${curSymbol.replace('USDT', '')} · 가격 확인 중 | 범온 AI 슈퍼차트`;
    return;
  }

  // 정상 가격
  _lastGoodPrice[curSymbol] = { price, ts };
  const _newTxt = PS ? PS.format(price, curSymbol) : fmtPrice(price);
  if (el.textContent && el.textContent !== _newTxt) {
    el.classList.remove('price-flash'); void el.offsetWidth; el.classList.add('price-flash');
  }
  el.textContent = _newTxt;

  let pct = rt.pct24h;
  if (pct === null && rt.candleOpen > 0) pct = ((price - rt.candleOpen) / rt.candleOpen * 100);
  if (pct !== null && isFinite(pct)) {
    const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    el.className = 'price-big ' + cls;
    if (badge) { badge.className = 'change-badge ' + cls; badge.textContent = (window.t ? window.t('24시간 변동률') : '24시간 변동률') + ' ' + (window.DataFmt ? window.DataFmt.change(pct) : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'); }
  }

  // 상태: 지연/오래됨이면 배지, 아니면 숨김. 마지막 갱신 표시.
  const updatedText = window.DataFmt ? window.DataFmt.lastUpdate(ts) : '';
  _setStatusUI(v.status, { updatedText, showRetry: (v.status === (DS.STALE || 'STALE')) });

  document.title = `${curSymbol.replace('USDT', '')} ${_newTxt} | 범온 AI 슈퍼차트`;

  const chart = window.chart;
  if (chart && chart.buffer && chart.buffer.length > 0) {
    chart.buffer.close[chart.buffer.length - 1] = price;
    if (price > chart.buffer.high[chart.buffer.length - 1]) chart.buffer.high[chart.buffer.length - 1] = price;
    if (price < chart.buffer.low[chart.buffer.length - 1]) chart.buffer.low[chart.buffer.length - 1] = price;
    chart._dirty = true;
  }
  rt.updatedAt = rt.updatedAt || Date.now();

  // OHLC + Volume (검증된 값만 표시)
  if (chart && chart.buffer && chart.buffer.length > 0) {
    const i = chart.buffer.length - 1;
    const _t = window.t || (s => s);
    const safe = (val) => (PS ? (PS.validate(val).valid ? PS.formatNumber(val, curSymbol) : null) : (isFinite(val) && val > 0 ? fmtPrice(val) : null));
    const oE = document.getElementById('ohlcOpen'), hE = document.getElementById('ohlcHigh'), lE = document.getElementById('ohlcLow'), vE = document.getElementById('ohlcVol');
    const so = safe(chart.buffer.open[i]), sh = safe(chart.buffer.high[i]), sl = safe(chart.buffer.low[i]);
    if (oE) oE.textContent = _t('시가') + ' ' + (so == null ? '확인 중' : so);
    if (hE) hE.textContent = _t('24시간 고가') + ' ' + (sh == null ? '확인 중' : sh);
    if (lE) lE.textContent = _t('24시간 저가') + ' ' + (sl == null ? '확인 중' : sl);
    const vol = chart.buffer.volume[i];
    const volTxt = window.DataFmt ? window.DataFmt.volume(vol) : String(vol);
    if (vE) vE.textContent = _t('거래량') + ' ' + (Number.isFinite(vol) && vol >= 0 ? volTxt : '확인 중');
    const aE = document.getElementById('ohlcAmount');
    if (aE) { const amt = (Number.isFinite(vol) ? vol : 0) * price; aE.textContent = _t('거래대금') + ' $' + (window.DataFmt ? window.DataFmt.volume(amt) : amt.toFixed(2)); }
  }
}

export function updatePriceDisplay(price, openPrice) {
  window._rt.lastPrice = price;
  if (openPrice && openPrice > 0) window._rt.candleOpen = openPrice;
  window._rt.symbol = window.curSymbol || '';
  window._rt.source = 'candle';
  window._rt.updatedAt = Date.now();
  renderRealtimeUI();
}

// 종목 전환 시 이전 가격 즉시 초기화 ("새 종목 가격 확인 중")
window._clearPriceOnSymbolChange = function() {
  const el = document.getElementById('curPrice');
  const badge = document.getElementById('changeBadge');
  if (el) { el.textContent = '새 종목 가격 확인 중'; el.className = 'price-big flat'; }
  if (badge) { badge.className = 'change-badge flat'; badge.textContent = '24시간 변동률 확인 중'; }
  ['ohlcOpen','ohlcHigh','ohlcLow','ohlcVol','ohlcAmount'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = e.textContent.split(' ')[0] + ' 확인 중'; });
  _setStatusUI((window.DataState && window.DataState.LOADING) || 'LOADING', { updatedText: '' });
};

// 수동 재시도
window._retryPrice = function() {
  _diag.retryCount = (_diag.retryCount || 0) + 1; _diag.userAction = 'manual_retry';
  const badge = document.getElementById('priceStatusBadge');
  if (badge) { badge.textContent = '가격 데이터를 다시 확인하고 있습니다.'; badge.className = 'ds-badge ds-badge-loading'; badge.style.display = ''; }
  try {
    if (typeof window.loadHeatmap === 'function') { /* no-op */ }
    // 현재 종목 재선택으로 가격 재요청 트리거
    if (typeof window._selectSym === 'function' && window.curSymbol) window._selectSym(window.curSymbol);
  } catch (e) { _diag.lastError = String(e).slice(0, 120); }
  setTimeout(renderRealtimeUI, 1500);
};

// 진단 패널 토글 (admin/dev)
window._dsToggleDiag = function() {
  const p = document.getElementById('dsDiagPanel');
  if (!p) return;
  if (!p.hidden) { p.hidden = true; return; }
  const d = window._priceDiag || {};
  const row = (k, v) => `<div class="ds-diag-row"><span class="k">${k}</span><span class="v">${(v == null || v === '') ? '-' : String(v)}</span></div>`;
  p.innerHTML = `<h3>데이터 진단</h3>
    ${row('rawSymbol', d.rawSymbol || window.curSymbol)}
    ${row('normalizedSymbol', d.normalizedSymbol)}
    ${row('exchange', d.exchange)}
    ${row('marketType', d.marketType)}
    ${row('dataSource', d.dataSource)}
    ${row('price', d.price)}
    ${row('timestamp', d.timestamp ? new Date(d.timestamp).toLocaleTimeString('ko-KR') : '')}
    ${row('status', d.status)}
    ${row('priceValid', (window.PriceStatus ? window.PriceStatus.validate(d.price, d.timestamp).valid : '-'))}
    ${row('retryCount', d.retryCount || 0)}
    ${row('lastError', d.lastError)}
    <button class="ds-diag-close" type="button" onclick="document.getElementById('dsDiagPanel').hidden=true">닫기</button>`;
  p.hidden = false;
};

// window 노출
window.renderRealtimeUI = renderRealtimeUI;
window.updatePriceDisplay = updatePriceDisplay;

// 종목 변경 이벤트 → 이전 가격 즉시 초기화
document.addEventListener('symbolChanged', () => { try { window._clearPriceOnSymbolChange(); } catch (e) {} });

// 주기적 신선도 체크(지연/오래됨 배지 갱신) — 과도 알림 방지 위해 15초
setInterval(() => { if (document.hidden) return; renderRealtimeUI(); }, 15000);
