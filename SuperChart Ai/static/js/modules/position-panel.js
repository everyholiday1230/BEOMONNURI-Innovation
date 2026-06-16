// 포지션 분석 패널 - 정밀 롱숏 + 청산 히트맵
// 의존: window.curSymbol, window.chart, window.showToast

(function() {
  'use strict';

  function getApiSymbol() {
    const sym = window.curSymbol || 'BTCUSDT';
    if (Array.isArray(window.symbols)) {
      const s = window.symbols.find(x => x.code === sym);
      if (s && s.apiCode) return s.apiCode;
    }
    return sym;
  }

  // ─────────── 정밀 롱숏 로드 ───────────
  async function loadLongShortDetailed() {
    const sym = getApiSymbol();
    try {
      const r = await fetch(`/v1/charts/long-short-detailed?symbol=${sym}`);
      const d = await r.json();
      if (!d.success) return;

      const data = d.data;
      const tbl = document.getElementById('lsDetailedTable');
      if (!tbl) return;

      const consensusMap = {
        long_heavy: { text: '롱 우위 (강)', cls: 'tag-pill-up' },
        long_lean: { text: '롱 우위', cls: 'tag-pill-up' },
        short_heavy: { text: '숏 우위 (강)', cls: 'tag-pill-down' },
        short_lean: { text: '숏 우위', cls: 'tag-pill-down' },
        neutral: { text: '중립', cls: 'tag-pill-neutral' },
      };
      const c = consensusMap[data.consensus] || consensusMap.neutral;
      const ce = document.getElementById('lsConsensus');
      if (ce) {
        ce.className = 'tag-pill ' + c.cls;
        ce.textContent = c.text;
      }

      const cats = [
        { key: 'global', label: '전체' },
        { key: 'top_account', label: 'TOP 계정' },
        { key: 'top_position', label: 'TOP 포지션' },
      ];
      const tfs = ['5m', '15m', '1h'];

      let html = '<div class="ls-detail-grid">';
      html += '<div></div>';
      tfs.forEach(tf => html += `<div class="ls-tf-head">${tf}</div>`);

      cats.forEach(cat => {
        html += `<div class="ls-cat-label">${cat.label}</div>`;
        tfs.forEach(tf => {
          const v = data[cat.key]?.[tf];
          if (v) {
            const cls = v.long_pct > 55 ? 'label-up' : v.long_pct < 45 ? 'label-down' : 'label-flat';
            html += `<div class="ls-cell num-tabular ${cls}">${v.long_pct}/${v.short_pct}</div>`;
          } else {
            html += '<div class="ls-cell text-muted">--</div>';
          }
        });
      });
      html += '</div>';

      const tp1h = data.top_position?.['1h'];
      if (tp1h) {
        html += `
          <div class="ls-summary-bar">
            <div class="text-muted-sm" style="margin-bottom:4px">대형 자금 (1시간)</div>
            <div class="ls-bar-bg">
              <div class="ls-bar-up" style="width:${tp1h.long_pct}%">L ${tp1h.long_pct}%</div>
              <div class="ls-bar-down" style="width:${tp1h.short_pct}%">${tp1h.short_pct}% S</div>
            </div>
            <div class="text-muted-sm num-tabular" style="margin-top:3px;text-align:center">롱숏 비율 ${tp1h.ratio}</div>
          </div>
        `;
      }

      tbl.innerHTML = html;
    } catch (e) {
      console.warn('long-short-detailed fail', e);
    }
  }

  // ─────────── 청산 히트맵 로드 ───────────
  let lastHeatmapData = null;

  async function loadLiquidationHeatmap() {
    const sym = getApiSymbol();
    try {
      const r = await fetch(`/v1/charts/liquidation-heatmap?symbol=${sym}`);
      const d = await r.json();
      if (!d.success) {
        const sumEl = document.getElementById('liqSummary');
        if (sumEl) sumEl.innerHTML = '<span class="text-muted">이 종목은 청산 데이터를 제공하지 않습니다. (선물 미상장 종목)</span>';
        return;
      }

      lastHeatmapData = d.data;
      const data = d.data;

      const fr = document.getElementById('fundingRateVal');
      if (fr) {
        const rate = data.funding_rate;
        const cls = rate > 0.01 ? 'label-up' : rate < -0.01 ? 'label-down' : 'label-flat';
        fr.className = 'num-tabular text-bold ' + cls;
        fr.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(4) + '%';
      }
      const fh = document.getElementById('fundingHint');
      if (fh) {
        if (data.funding_rate > 0.05) fh.textContent = '롱 포지션 과열';
        else if (data.funding_rate < -0.05) fh.textContent = '숏 포지션 과열';
        else if (data.funding_rate > 0.01) fh.textContent = '롱 약간 우세';
        else if (data.funding_rate < -0.01) fh.textContent = '숏 약간 우세';
        else fh.textContent = '균형';
      }

      const sumEl = document.getElementById('liqSummary');
      if (sumEl) {
        const tl = data.total_long_liq_24h;
        const ts = data.total_short_liq_24h;
        const fmtUSD = v => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
        sumEl.innerHTML = `
          <div class="flex-between">
            <span class="label-up">롱 청산: <b>${fmtUSD(tl)}</b></span>
            <span class="label-down">숏 청산: <b>${fmtUSD(ts)}</b></span>
          </div>
        `;
      }

      const ce = document.getElementById('liqClusters');
      if (ce) {
        const ml = data.max_long_cluster;
        const ms = data.max_short_cluster;
        const fmtPrice = p => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(p < 1 ? 4 : 2);
        ce.innerHTML = `
          ${ml ? `<div>롱 청산 다발: <b class="label-up">$${fmtPrice(ml.price)}</b></div>` : ''}
          ${ms ? `<div>숏 청산 다발: <b class="label-down">$${fmtPrice(ms.price)}</b></div>` : ''}
          <div class="text-muted" style="margin-top:4px">현재가: $${fmtPrice(data.current_price)}</div>
        `;
      }

      drawHeatmap(data);

      if (window._liqOverlayActive) {
        applyLiqOverlay(data);
      }
    } catch (e) {
      console.warn('liquidation-heatmap fail', e);
    }
  }

  function drawHeatmap(data) {
    const cv = document.getElementById('liqHeatmapCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const buckets = data.buckets;
    const maxAmt = Math.max(...buckets.map(b => Math.max(b.long_liq, b.short_liq)));
    if (maxAmt <= 0) return;

    const sortedByPrice = [...buckets].sort((a, b) => b.price - a.price);
    const rowH = H / sortedByPrice.length;
    const centerX = W / 2;

    const priceMin = Math.min(...buckets.map(b => b.price));
    const priceMax = Math.max(...buckets.map(b => b.price));
    const curPriceY = H - ((data.current_price - priceMin) / (priceMax - priceMin)) * H;

    sortedByPrice.forEach((b, i) => {
      const y = i * rowH;
      const longW = (b.long_liq / maxAmt) * (W * 0.45);
      const longAlpha = Math.min(1, 0.3 + b.long_liq / maxAmt * 0.7);
      ctx.fillStyle = `rgba(196,56,75,${longAlpha})`;
      ctx.fillRect(centerX - longW, y + 0.5, longW, rowH - 1);

      const shortW = (b.short_liq / maxAmt) * (W * 0.45);
      const shortAlpha = Math.min(1, 0.3 + b.short_liq / maxAmt * 0.7);
      ctx.fillStyle = `rgba(59,130,246,${shortAlpha})`;
      ctx.fillRect(centerX, y + 0.5, shortW, rowH - 1);
    });

    ctx.fillStyle = '#8E7D72';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`$${priceMax.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 4, 12);
    ctx.fillText(`$${priceMin.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 4, H - 4);

    ctx.strokeStyle = '#D8B66A';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, curPriceY);
    ctx.lineTo(W, curPriceY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#D8B66A';
    ctx.textAlign = 'right';
    ctx.fillText('현재가 ' + data.current_price.toLocaleString('en-US', { maximumFractionDigits: 0 }), W - 4, curPriceY - 2);

    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, H);
    ctx.stroke();
  }

  window._liqOverlayActive = false;

  window._toggleLiqOverlay = function() {
    if (!window.requireLogin || !window.requireLogin('청산 히트맵')) return;
    window._liqOverlayActive = !window._liqOverlayActive;
    const btn = document.getElementById('liqOverlayBtn');
    if (window._liqOverlayActive) {
      if (btn) {
        btn.classList.remove('btn-uniform-secondary');
        btn.classList.add('btn-uniform-primary');
        btn.textContent = '차트 ON';
      }
      if (lastHeatmapData) applyLiqOverlay(lastHeatmapData);
      else loadLiquidationHeatmap();
    } else {
      if (btn) {
        btn.classList.remove('btn-uniform-primary');
        btn.classList.add('btn-uniform-secondary');
        btn.textContent = '차트 표시';
      }
      removeLiqOverlay();
    }
  };

  function applyLiqOverlay(data) {
    if (!window.chart || !window.chart.overlay) return;
    removeLiqOverlay();

    const top = [...data.buckets]
      .sort((a, b) => (b.long_liq + b.short_liq) - (a.long_liq + a.short_liq))
      .slice(0, 5);

    for (const b of top) {
      const isLong = b.long_liq > b.short_liq;
      const color = isLong ? 'rgba(196,56,75,0.5)' : 'rgba(59,130,246,0.5)';
      const fmtUSD = v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v.toFixed(0);
      window.chart.addDrawing({
        type: 'hline',
        price: b.price,
        color: color,
        lineWidth: 1,
        dashed: true,
        label: `청산 ${isLong ? 'L' : 'S'} ${fmtUSD(Math.max(b.long_liq, b.short_liq))}`,
        _calcOwner: 'liq_heatmap',
      });
    }
    window.chart._dirty = true;
  }

  function removeLiqOverlay() {
    if (!window.chart || !window.chart.overlay) return;
    window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d._calcOwner !== 'liq_heatmap');
    window.chart._dirty = true;
  }

  window._loadPositionData = async function() {
    await Promise.all([loadLongShortDetailed(), loadLiquidationHeatmap()]);
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.p === 'position') {
      window._loadPositionData();
    }
  });

  setInterval(() => {
    if (document.hidden) return;
    const active = document.querySelector('.right-tab.active');
    if (active && active.dataset.p === 'position') {
      window._loadPositionData();
    }
  }, 30000);

  document.addEventListener('symbolChanged', () => {
    const active = document.querySelector('.right-tab.active');
    if (active && active.dataset.p === 'position') {
      window._loadPositionData();
    }
  });

  // 종목 변경 시 symbolChanged 이벤트가 dispatch되지 않아 포지션 탭이 갱신 안 되던 문제 →
  // _selectSym을 래핑해(기존 함수 보존) 종목 변경 후 이벤트 발생. 다른 모듈의 래핑과 체이닝됨.
  function _hookSelectSym() {
    const orig = window._selectSym;
    if (typeof orig !== 'function' || orig._symEvtHooked) return;
    const wrapped = async function(sym) {
      const r = await orig.apply(this, arguments);
      try { document.dispatchEvent(new CustomEvent('symbolChanged', { detail: { symbol: sym } })); } catch (e) {}
      return r;
    };
    wrapped._symEvtHooked = true;
    window._selectSym = wrapped;
  }
  _hookSelectSym();
  // _selectSym이 늦게 정의될 수 있어 한 번 더 시도
  setTimeout(_hookSelectSym, 1500);

  // 타임프레임 변경 시 차트 재로딩 과정에서 hline 타입 drawing(청산 오버레이 포함)이 제거되는데,
  // 종목 변경과 달리 재적용 훅이 없어 '차트 ON'인데도 청산선이 사라지던 문제 →
  // setTimeframe(Pt)을 래핑해 변경 후 오버레이가 활성이면 다시 그린다.
  function reapplyLiqOverlay() {
    if (!window._liqOverlayActive) return;
    if (lastHeatmapData) applyLiqOverlay(lastHeatmapData);
    else loadLiquidationHeatmap();
  }
  function _hookSetTimeframe() {
    const orig = window.setTimeframe;
    if (typeof orig !== 'function' || orig._liqTfHooked) return;
    const wrapped = function() {
      const r = orig.apply(this, arguments);
      // Pt 내부의 차트 재로딩(Fe)이 끝난 뒤 hline이 정리되므로, 그 이후에 재적용
      if (window._deP && typeof window._deP.then === 'function') {
        window._deP.then(() => setTimeout(reapplyLiqOverlay, 60)).catch(() => {});
      } else {
        setTimeout(reapplyLiqOverlay, 400);
      }
      return r;
    };
    wrapped._liqTfHooked = true;
    window.setTimeframe = wrapped;
  }
  _hookSetTimeframe();
  setTimeout(_hookSetTimeframe, 1500);
})();
