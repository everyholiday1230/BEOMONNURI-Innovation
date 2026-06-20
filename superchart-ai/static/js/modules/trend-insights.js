// 트렌드 인사이트 - 시장 분위기 + TOP 5 카테고리
(function() {
  'use strict';

  let currentCat = 'top_gainers';
  let cachedData = null;
  let loading = false;

  const MOOD_CLASS = {
    bullish: 'tag-pill-up',
    lean_bullish: 'tag-pill-up',
    mixed: 'tag-pill-neutral',
    lean_bearish: 'tag-pill-down',
    bearish: 'tag-pill-down',
  };

  async function loadTrendInsights() {
    if (loading) return;
    loading = true;
    try {
      const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await requester('/v1/charts/trend-insights', { credentials: 'include' });
      if (!r || !r.ok) return;
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (!/application\/json/i.test(ct)) return;
      const d = await r.json().catch(() => null);
      if (!d || !d.success || !d.data) return;
      cachedData = d.data;
      render();
    } catch (e) {
      console.warn('trend-insights load fail', e);
    } finally {
      loading = false;
    }
  }

  function render() {
    if (!cachedData) return;
    const s = cachedData.market_summary;

    const badge = document.getElementById('marketMoodBadge');
    if (badge) {
      const moodClass = MOOD_CLASS[s.market_mood] || 'tag-pill-neutral';
      badge.className = 'tag-pill ' + moodClass;
      badge.textContent = s.market_mood_label;
    }

    const stats = document.getElementById('marketSummaryStats');
    if (stats) {
      const avgClass = s.avg_change >= 0 ? 'label-up' : 'label-down';
      const btcClass = s.btc_change >= 0 ? 'label-up' : 'label-down';
      const avgSign = s.avg_change >= 0 ? '+' : '';
      const btcSign = s.btc_change >= 0 ? '+' : '';
      stats.innerHTML = `
        <div class="flex-between num-tabular">
          <span>전체 평균: <span class="${avgClass}">${avgSign}${s.avg_change}%</span></span>
          <span>BTC: <span class="${btcClass}">${btcSign}${s.btc_change}%</span></span>
        </div>
        <div class="flex-between num-tabular" style="margin-top:4px">
          <span>상승 ${s.gainers_count}</span>
          <span>하락 ${s.losers_count}</span>
          <span>보합 ${s.neutral_count}</span>
        </div>
      `;
    }

    renderList(currentCat);
  }

  function renderList(cat) {
    if (!cachedData) return;
    const list = document.getElementById('trendInsightList');
    if (!list) return;
    const items = cachedData[cat] || [];
    if (!items.length) {
      list.innerHTML = '<div class="state-empty compact">데이터 없음</div>';
      return;
    }

    const isVolume = cat === 'top_volume';
    const isVolatility = cat === 'top_volatility';

    list.innerHTML = items.map((it, i) => {
      const change = it.change_pct;
      const changeClass = change >= 0 ? 'label-up' : 'label-down';
      const sign = change >= 0 ? '+' : '';
      const sym = it.symbol.replace('USDT', '');
      const fmtPrice = p => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p < 1 ? p.toFixed(p < 0.01 ? 6 : 4) : p.toFixed(2);
      const fmtVol = v => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${(v/1e3).toFixed(0)}K`;

      let valueCol;
      if (isVolume) {
        valueCol = `<div class="list-item-uniform-value label-accent">${fmtVol(it.volume)}</div>`;
      } else if (isVolatility) {
        valueCol = `<div class="list-item-uniform-value label-gold">${it.volatility_pct.toFixed(1)}%</div>`;
      } else {
        valueCol = `<div class="list-item-uniform-value ${changeClass}">${sign}${change.toFixed(2)}%</div>`;
      }

      return `
        <div class="list-item-uniform" onclick="window._selectSym?.('${it.symbol}')">
          <div class="list-item-uniform-rank">${i + 1}</div>
          <img src="${(window.coinImgUrl||{})[it.symbol]||'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22><rect width=%2220%22 height=%2220%22 rx=%2210%22 fill=%22%236A1E33%22/><text x=%2210%22 y=%2214%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%227%22>'+sym.slice(0,4)+'</text></svg>'}" loading="lazy" style="width:20px;height:20px;border-radius:50%;flex-shrink:0;margin-right:6px">
          <div class="list-item-uniform-main">
            <div class="list-item-uniform-name"><span style="color:var(--gold-text);font-weight:600">${sym}</span><span style="color:var(--muted);font-weight:400;font-size:12px">/USDT</span></div>
            <div class="list-item-uniform-meta">$${fmtPrice(it.price)}</div>
          </div>
          ${valueCol}
        </div>
      `;
    }).join('');
  }

  window._switchTrendCat = function(cat) {
    currentCat = cat;
    document.querySelectorAll('.ti-tab').forEach(b => {
      const isActive = b.dataset.cat === cat;
      b.classList.toggle('active', isActive);
    });
    renderList(cat);
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.p === 'hot') {
      loadTrendInsights();
    }
  });

  setInterval(() => {
    if (document.hidden) return;
    const active = document.querySelector('.right-tab.active');
    if (active && active.dataset.p === 'hot') {
      loadTrendInsights();
    }
  }, 60000);

  setTimeout(loadTrendInsights, 3000);
})();
