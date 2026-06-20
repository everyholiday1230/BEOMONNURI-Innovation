/**
 * chart-extras.js — 심볼 비교 오버레이 + 드로잉 목록 (main-app.js에서 분리)
 * 의존: window.chart, window.API, window.curTf, window.dedupFetch, window.showToast, window.t
 */

// ═══ 심볼 비교 오버레이 ═══
window._compareSymbols = [];
window.addCompareSymbol = async function() {
  const sym = await window._modal?.({ title: '심볼 비교 추가', input: '', placeholder: '심볼 (예: ETHUSDT)' });
  if (!sym) return;
  const code = sym.toUpperCase();
  const t = window.t || (s => s);
  try {
    const chart = window.chart;
    const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
    const r = await requester(`${window.API}/v1/charts/candles?symbolId=${code}&timeframe=${window.curTf}&limit=${chart?.buffer?.length || 2000}`);
    if (!r || !r.ok) { window.showToast?.(t('심볼을 찾을 수 없습니다')); return; }
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (ct && !/application\/json/i.test(ct)) { window.showToast?.(t('심볼 데이터 형식 오류')); return; }
    const d = await r.json().catch(() => null);
    if (!d?.success || !d.data?.candles?.length) { window.showToast?.(t('심볼을 찾을 수 없습니다')); return; }
    const bars = d.data.candles;
    const base = parseFloat(bars[0].close);
    const normalized = bars.map((c, i) => ({ index: i, value: (parseFloat(c.close) / base - 1) * 100 }));
    const colors = ['#D8B66A', '#8E7D72', '#ec4899', '#84cc16'];
    const color = colors[window._compareSymbols.length % colors.length];
    chart?.setIndicator('cmp_' + code, normalized, color, 2);
    window._compareSymbols.push(code);
    window.showToast?.(code + ' 비교 추가', '#C4384B');
  } catch (e) { window.showToast?.(t('비교 실패')); }
};

// ═══ 드로잉 목록 좌측 상단 표시 ═══
window._updateDrawingList = function() {
  const el = document.getElementById('activeIndList');
  const chart = window.chart;
  if (!el || !chart) return;
  el.querySelectorAll('[data-drawing-tag]').forEach(t => t.remove());
  const drawings = chart.overlay?.drawings?.filter(d => (d.type === 'fib' || d.type === 'hline' || d.type === 'trendline' || d.type === 'text' || d.type === 'vline') && !d._autoTrend && !d._ob && !d._calcOwner && !d._alertLine) || [];
  if (!drawings.length) return;
  const names = { fib: '피보나치', hline: '수평선', trendline: '추세선', text: '텍스트', vline: '수직선' };
  const colors = { fib: '#D8B66A', hline: '#921230', trendline: '#2563EB', text: '#8E7D72', vline: '#3B82F6' };
  const isDark = document.body.classList.contains('dark');
  const bg = isDark ? 'rgba(20,56,69,0.92)' : 'rgba(247,241,234,0.9)';
  drawings.forEach((d, i) => {
    let label = names[d.type] || d.type;
    if (d.type === 'hline' && d.price) label += ' ' + d.price.toFixed(2);
    const color = d.color || colors[d.type] || '#8E7D72';
    const tag = document.createElement('span');
    tag.dataset.drawingTag = '1';
    tag.style.cssText = `font-size:14px;color:${color};background:${bg};padding:3px 8px;border-radius:4px;pointer-events:auto;cursor:pointer;border:1px solid ${color}55;position:relative`;
    tag.setAttribute('onmouseenter', "this.querySelector('.ind-close').style.display='block'");
    tag.setAttribute('onmouseleave', "this.querySelector('.ind-close').style.display='none'");
    tag.innerHTML = `${label}<button class="ind-close" data-del-draw="${i}" title="삭제" style="display:none;position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:${color};color:#fff;border:none;font-size:9px;line-height:14px;cursor:pointer;padding:0">\u2715</button>`;
    el.appendChild(tag);
  });
};

// 드로잉 삭제 클릭 위임
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-del-draw]');
  if (!btn || !window.chart) return;
  const idx = parseInt(btn.dataset.delDraw);
  if (isNaN(idx)) return;
  const manual = window.chart.overlay.drawings.filter(d =>
    (d.type === 'fib' || d.type === 'hline' || d.type === 'trendline' || d.type === 'text' || d.type === 'vline') &&
    !d._autoTrend && !d._ob && !d._calcOwner && !d._alertLine);
  const target = manual[idx];
  if (!target) return;
  window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d !== target);
  window.chart._dirty = true;
  window._updateDrawingList();
  window.showToast?.('드로잉 삭제됨', '#C4384B');
});

setInterval(() => { if (document.hidden) return; window._updateDrawingList(); }, 2000);
