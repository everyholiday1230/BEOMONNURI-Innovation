// 다중 차트 레이아웃 + 종목 비교 차트
// 의존: window.chart (메인), window.curSymbol, window.curTf, window.symbols, ChartEngine

(function() {
  'use strict';

  // ─────────── 상태 ───────────
  window._chartLayout = 1;      // 1, 2, 4
  window._subCharts = {};       // { panelId: ChartEngine 인스턴스 }
  window._compareMode = false;
  window._compareSymbols = [];  // [{symbol, color}]

  const COMPARE_COLORS = ['#921230', '#3B82F6', '#D8B66A', '#10B981'];

  async function _safeJsonRequest(url, opts) {
    try {
      const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await requester(url, opts || {});
      if (!r || !r.ok) return null;
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (ct && !/application\/json/i.test(ct)) return null;
      return await r.json().catch(() => null);
    } catch (_) {
      return null;
    }
  }

  // ─────────── 레이아웃 변경 ───────────
  window._setChartLayout = function(n) {
    if (window.requireLogin && !window.requireLogin('다중 차트')) return;
    if (![1, 2, 4].includes(n)) return;
    if (window._chartLayout === n) return;

    window._chartLayout = n;

    // 비교 모드는 단일 레이아웃에서만 작동
    if (n !== 1 && window._compareMode) {
      window._toggleCompareMode();
    }

    applyLayoutDOM(n);

    // 버튼 상태 업데이트
    document.querySelectorAll('.tb-layout').forEach(b => {
      const isActive = parseInt(b.dataset.layout) === n;
      b.style.background = isActive ? '#921230' : 'transparent';
      b.style.color = isActive ? '#fff' : '#921230';
      b.classList.toggle('active', isActive);
    });

    // 메인 차트 리사이즈
    if (window.chart && window.chart._resize) {
      requestAnimationFrame(() => {
        window.chart._resize();
        window.chart._dirty = true;
      });
    }

    // 추가 패널 차트 초기화
    if (n >= 2) ensureSubChart('chart2Panel', 1);
    if (n >= 4) {
      ensureSubChart('chart3Panel', 2);
      ensureSubChart('chart4Panel', 3);
    }

    // 메인 차트 클릭 시 활성 표시(분할 모드) — 1회만 등록
    const mainWrap = document.getElementById('chartWrap');
    if (mainWrap && !mainWrap._activeHooked) {
      mainWrap._activeHooked = true;
      mainWrap.addEventListener('mousedown', () => { if (window._chartLayout >= 2) window._setActiveChartPanel && window._setActiveChartPanel('main'); });
    }
    if (n === 1) {
      window._activeChartPanel = 'main';
      if (mainWrap) mainWrap.style.outline = 'none';
    } else {
      window._setActiveChartPanel && window._setActiveChartPanel('main');
    }

    if (window.showToast) window.showToast(`${n}개 차트 레이아웃`, '#921230');
  };

  function applyLayoutDOM(n) {
    const area = document.getElementById('chartsArea');
    if (!area) return;

    // 기존 추가 패널 제거 (+ ChartCore 인스턴스 정리)
    ['chart2Panel', 'chart3Panel', 'chart4Panel'].forEach(id => {
      const inst = window._subCharts && window._subCharts[id];
      if (inst) { try { inst.destroy && inst.destroy(); } catch {} delete window._subCharts[id]; }
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    // grid 설정
    if (n === 1) {
      area.style.display = 'flex';
      area.style.flexDirection = 'column';
      area.style.gridTemplate = '';
    } else if (n === 2) {
      area.style.display = 'grid';
      area.style.gridTemplateColumns = '1fr 1fr';
      area.style.gridTemplateRows = '1fr';
      area.style.gap = '4px';
    } else if (n === 4) {
      area.style.display = 'grid';
      area.style.gridTemplateColumns = '1fr 1fr';
      area.style.gridTemplateRows = '1fr 1fr';
      area.style.gap = '4px';
    }

    // 추가 패널 생성
    for (let i = 1; i < n; i++) {
      const panelId = `chart${i + 1}Panel`;
      const panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'sub-chart-panel';
      panel.style.cssText = 'position:relative;background:#FFFDF9;border:1px solid rgba(216,182,106,0.2);border-radius:6px;overflow:hidden;display:flex;flex-direction:column;min-height:0;min-width:0';
      panel.innerHTML = `
        <div class="sub-chart-toolbar" style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:rgba(216,182,106,0.08);font-size:11px;border-bottom:1px solid rgba(216,182,106,0.15)">
          <select class="sub-sym-select" data-panel="${i}" style="background:#fff;border:1px solid rgba(216,182,106,0.3);border-radius:4px;padding:2px 4px;font-size:11px;cursor:pointer;flex:1;max-width:100px"></select>
          <select class="sub-tf-select" data-panel="${i}" style="background:#fff;border:1px solid rgba(216,182,106,0.3);border-radius:4px;padding:2px 4px;font-size:11px;cursor:pointer">
            <option value="1m">1분</option><option value="5m" selected>5분</option><option value="15m">15분</option>
            <option value="1h">1시간</option><option value="4h">4시간</option><option value="1d">일봉</option>
            <option value="1w">주봉</option><option value="1M">월봉</option>
          </select>
          <span class="sub-chart-price" data-panel="${i}" style="font-size:11px;font-weight:700;color:#921230;margin-left:auto"></span>
        </div>
        <div class="sub-chart-wrap" style="flex:1;position:relative;min-height:0"></div>
      `;
      area.appendChild(panel);

      // 종목 select 채우기
      const symSel = panel.querySelector('.sub-sym-select');
      if (symSel && Array.isArray(window.symbols)) {
        for (const s of window.symbols.slice(0, 50)) {
          const opt = document.createElement('option');
          opt.value = s.code;
          const sym = s.code.replace('USDT', '');
          const nameKo = s.kr || s.name_ko || sym;
          opt.textContent = nameKo === sym ? sym : `${nameKo} (${sym})`;
          symSel.appendChild(opt);
        }
        // 기본값: 메인 종목과 겹치지 않게(같으면 같은 차트 두 개로 보임)
        const cur = window.curSymbol || 'BTCUSDT';
        const used = new Set([cur]);
        Object.values(window._subCharts || {}).forEach(c => c && c._subSymbol && used.add(c._subSymbol));
        document.querySelectorAll('.sub-sym-select').forEach(s => { if (s !== symSel && s.value) used.add(s.value); });
        const pool = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
        let pick = pool.find(s => !used.has(s) && symSel.querySelector(`option[value="${s}"]`));
        // 풀이 다 겹치면 메인/사용중 아닌 첫 옵션으로 폴백
        if (!pick) pick = Array.from(symSel.options).map(o => o.value).find(v => !used.has(v)) || pool[0];
        if (pick) symSel.value = pick;
      }
      symSel.onchange = () => loadSubChart(panelId, symSel.value, panel.querySelector('.sub-tf-select').value);
      panel.querySelector('.sub-tf-select').onchange = () => loadSubChart(panelId, symSel.value, panel.querySelector('.sub-tf-select').value);
    }
  }

  // ─────────── 서브 차트 (독립 ChartCore 인스턴스) ───────────
  window._subCharts = window._subCharts || {};

  async function ensureSubChart(panelId, idx) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const symSel = panel.querySelector('.sub-sym-select');
    const tfSel = panel.querySelector('.sub-tf-select');
    if (!symSel || !tfSel) return;
    await loadSubChart(panelId, symSel.value, tfSel.value);
  }

  function _mapCandles(raw) {
    return raw.map(c => ({
      time: parseInt(c.openTime) > 1e12 ? Math.floor(parseInt(c.openTime) / 1000) : Math.floor(new Date(c.openTime).getTime() / 1000),
      open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low),
      close: parseFloat(c.close), volume: parseFloat(c.volume || 0),
    })).filter(c => c.time > 0 && !isNaN(c.open));
  }

  async function loadSubChart(panelId, symbol, timeframe) {
    const panel = document.getElementById(panelId);
    if (!panel || !window.ChartCore) return;
    const wrap = panel.querySelector('.sub-chart-wrap');
    const priceEl = panel.querySelector('.sub-chart-price');
    if (!wrap) return;
    try {
      // 패널별 ChartCore 인스턴스 (없으면 생성, 있으면 재사용)
      let chart = window._subCharts[panelId];
      if (!chart || chart._destroyed) {
        chart = new window.ChartCore(wrap, { slider: false });
        chart.showVolume = false;
        chart.onLoadMore(async () => {
          if (!chart.buffer.length) return;
          const t0 = chart.buffer.time[0], end = Math.floor(t0 * 1000) - 1;
          try {
            const w = await _safeJsonRequest(`/v1/charts/candles?symbolId=${chart._subSymbol}&timeframe=${chart._subTf}&limit=500&endTime=${end}`);
            if (w?.success && w.data?.candles?.length) { const h = _mapCandles(w.data.candles); h.length && chart.prependBars(h); }
          } catch {}
        });
        window._subCharts[panelId] = chart;
        try { window._bindDrawing && window._bindDrawing(chart); } catch (e) {}
        try {
          if (window.chart && chart.linkTo && window.chart.linkTo) {
            chart.linkTo(window.chart);
            window.chart.linkTo(chart);
          }
        } catch (e) {}
        wrap.addEventListener('mousedown', () => _setActivePanel(panelId));
      }
      chart._subSymbol = symbol; chart._subTf = timeframe;
      chart._watermark = symbol.replace('USDT', '');
      // loadChart2가 candles 로드 + 현재 켜진 지표 전부 렌더 (대상=이 서브차트)
      await window.loadChart2(chart, symbol, timeframe);

      const last = chart.buffer.close[chart.buffer.length - 1], first = chart.buffer.close[0];
      if (priceEl && last != null && first) {
        const change = (last - first) / first * 100;
        const sign = change >= 0 ? '+' : '', color = change >= 0 ? '#C4384B' : '#3B82F6';
        priceEl.innerHTML = `${last.toLocaleString()} <span style="color:${color}">${sign}${change.toFixed(2)}%</span>`;
      }
    } catch (e) { console.warn('subchart load fail', e); }
  }

  // 활성 패널 추적 (2단계: 지표/드로잉 타깃에 사용)
  // 패널별 지표 on/off 상태 저장소 ('main' + 'chart2Panel'...)
  window._panelIndState = window._panelIndState || {};
  const _indSel = '.ind-tag.on[data-ind], .ind-tag.on[data-sub], .sub-ind.on[data-sub]';
  function _captureIndState() {
    const ids = [];
    document.querySelectorAll(_indSel).forEach(el => { const id = el.dataset.ind || el.dataset.sub; if (id) ids.push(id); });
    return ids;
  }
  function _applyIndStateToButtons(ids) {
    const want = new Set(ids || []);
    document.querySelectorAll('.ind-tag[data-ind], .ind-tag[data-sub], .sub-ind[data-sub]').forEach(el => {
      const id = el.dataset.ind || el.dataset.sub; if (!id) return;
      el.classList.toggle('on', want.has(id));
    });
    try { window._syncIndicatorVars && window._syncIndicatorVars(); } catch (e) {}
  }

  function _setActivePanel(panelId) {
    const prev = window._activeChartPanel;
    // 같은 패널 재선택이면 아무것도 안 함(상태 보존)
    if (prev === panelId) {
      document.querySelectorAll('.sub-chart-panel').forEach(p => { p.style.outline = p.id === panelId ? '2px solid #921230' : 'none'; });
      const mw0 = document.getElementById('chartWrap'); if (mw0) mw0.style.outline = panelId === 'main' ? '2px solid #921230' : 'none';
      return;
    }
    window._panelSwitching = true;
    // 1) 이전 패널의 현재 버튼 상태 저장
    if (prev) window._panelIndState[prev] = _captureIndState();
    window._activeChartPanel = panelId;
    // 2) 선택 표시
    document.querySelectorAll('.sub-chart-panel').forEach(p => {
      p.style.outline = p.id === panelId ? '2px solid #921230' : 'none';
    });
    const mainWrap = document.getElementById('chartWrap');
    if (mainWrap) mainWrap.style.outline = panelId === 'main' ? '2px solid #921230' : 'none';
    // 3) 새 패널의 저장 상태를 버튼에 복원(저장된 적 없으면 현재 버튼 유지=상속)
    const saved = window._panelIndState[panelId];
    if (saved) {
      _applyIndStateToButtons(saved);
      try {
        if (panelId === 'main') { window.calcIndicators && window.calcIndicators(); window._refreshOverlays && window._refreshOverlays(); }
        else _scheduleActiveSubReRender();
      } catch (e) {}
    } else if (panelId !== 'main') {
      // 서브 첫 진입: 현재 버튼 세트를 그 서브에 렌더
      _scheduleActiveSubReRender();
    }
    setTimeout(() => { window._panelSwitching = false; }, 250);
  }
  window._setActiveChartPanel = _setActivePanel;

  function drawSimpleCandles(canvas, candles) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300;
    const H = canvas.clientHeight || 200;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!candles.length) return;

    const padL = 4, padR = 50, padT = 6, padB = 16;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const range = max - min || 1;

    const cw = Math.max(1, plotW / candles.length * 0.7);
    const step = plotW / candles.length;

    // 캔들
    candles.forEach((c, i) => {
      const x = padL + step * i + step / 2;
      const yh = padT + (1 - (c.high - min) / range) * plotH;
      const yl = padT + (1 - (c.low - min) / range) * plotH;
      const yo = padT + (1 - (c.open - min) / range) * plotH;
      const yc = padT + (1 - (c.close - min) / range) * plotH;
      const isUp = c.close >= c.open;
      ctx.strokeStyle = isUp ? '#C4384B' : '#3B82F6';
      ctx.fillStyle = isUp ? '#C4384B' : '#3B82F6';
      ctx.lineWidth = 1;
      // 심지
      ctx.beginPath();
      ctx.moveTo(x, yh);
      ctx.lineTo(x, yl);
      ctx.stroke();
      // 몸통
      ctx.fillRect(x - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
    });

    // 가격축 라벨 (오른쪽)
    ctx.fillStyle = '#8E7D72';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(max.toLocaleString('en-US', { maximumFractionDigits: 2 }), W - padR + 4, padT + 8);
    ctx.fillText(min.toLocaleString('en-US', { maximumFractionDigits: 2 }), W - padR + 4, H - padB);
    ctx.fillText(((max + min) / 2).toLocaleString('en-US', { maximumFractionDigits: 2 }), W - padR + 4, padT + plotH / 2);
  }

  // ─────────── 종목 비교 차트 (정규화 라인) ───────────
  window._toggleCompareMode = function() {
    if (window.requireLogin && !window.requireLogin('비교 차트')) return;

    if (window._chartLayout !== 1) {
      window._setChartLayout(1);
    }

    window._compareMode = !window._compareMode;
    const btn = document.getElementById('compareBtn');

    if (window._compareMode) {
      // 기본: 현재 종목 + BTC, ETH 비교
      window._compareSymbols = [
        { symbol: window.curSymbol || 'BTCUSDT', color: COMPARE_COLORS[0] },
      ];
      const defaults = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].filter(s => s !== window.curSymbol);
      defaults.slice(0, 2).forEach((s, i) => {
        window._compareSymbols.push({ symbol: s, color: COMPARE_COLORS[i + 1] });
      });

      if (btn) {
        btn.style.background = '#921230';
        btn.style.color = '#fff';
      }
      showCompareUI();
      loadCompareData();
    } else {
      if (btn) {
        btn.style.background = '';
        btn.style.color = '';
      }
      hideCompareUI();
      // 메인 차트 복원
      if (window.loadCandles) window.loadCandles();
    }
  };

  function showCompareUI() {
    let panel = document.getElementById('comparePanel');
    if (panel) {
      panel.style.display = 'flex';
      renderCompareList();
      return;
    }
    panel = document.createElement('div');
    panel.id = 'comparePanel';
    panel.style.cssText = 'position:absolute;top:60px;left:8px;z-index:50;background:rgba(255,253,249,0.97);border:1px solid rgba(216,182,106,0.3);border-radius:8px;padding:8px 12px;display:flex;flex-direction:column;gap:6px;font-size:12px;box-shadow:0 4px 12px rgba(106,30,51,0.1);min-width:200px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="color:#921230">종목 비교</strong>
        <button onclick="window._toggleCompareMode()" style="background:none;border:none;cursor:pointer;font-size:14px;color:#8E7D72">✕</button>
      </div>
      <div id="compareList"></div>
      <div style="display:flex;gap:4px">
        <select id="compareSymAdd" style="flex:1;padding:3px;border:1px solid rgba(216,182,106,0.3);border-radius:4px;font-size:11px"></select>
        <button onclick="window._addCompareSymbol()" style="padding:3px 8px;background:#921230;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">+ 추가</button>
      </div>
      <div style="font-size:10px;color:#8E7D72">시작 시점 = 0%, 변화율로 비교</div>
    `;
    const wrap = document.getElementById('chartWrap');
    if (wrap) wrap.appendChild(panel);

    // 추가 select 채우기
    const sel = document.getElementById('compareSymAdd');
    if (sel && Array.isArray(window.symbols)) {
      const used = new Set(window._compareSymbols.map(s => s.symbol));
      window.symbols.slice(0, 100).forEach(s => {
        if (!used.has(s.code)) {
          const opt = document.createElement('option');
          opt.value = s.code;
          const sym = s.code.replace('USDT', '');
          const nameKo = s.kr || s.name_ko || sym;
          opt.textContent = nameKo === sym ? sym : `${nameKo} (${sym})`;
          sel.appendChild(opt);
        }
      });
    }

    renderCompareList();
  }

  function renderCompareList() {
    const list = document.getElementById('compareList');
    if (!list) return;
    list.innerHTML = window._compareSymbols.map((s, i) => {
      const sym = s.symbol.replace('USDT', '');
      // window.symbols에서 한글명 찾기
      const meta = (window.symbols || []).find(x => x.code === s.symbol);
      return `
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:12px;height:12px;background:${s.color};border-radius:50%;flex-shrink:0"></span>
          <img src="${(window.coinImgUrl||{})[s.symbol]||'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2218%22 height=%2218%22><rect width=%2218%22 height=%2218%22 rx=%229%22 fill=%22%236A1E33%22/><text x=%229%22 y=%2213%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%227%22>'+sym.slice(0,4)+'</text></svg>'}" loading="lazy" style="width:18px;height:18px;border-radius:50%;flex-shrink:0">
          <span style="flex:1;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer" onclick="window._selectSym?.('${s.symbol}')"><span style="color:var(--gold-text)">${sym}</span><span style="color:#8E7D72;font-weight:400;font-size:11px">/USDT</span></span>
          <span class="compare-pct" data-sym="${s.symbol}" style="font-size:11px;color:#8E7D72;flex-shrink:0">--</span>
          ${i > 0 ? `<button onclick="window._removeCompareSymbol('${s.symbol}')" style="background:none;border:none;cursor:pointer;color:#8E7D72;font-size:14px;flex-shrink:0">✕</button>` : ''}
        </div>
      `;
    }).join('');
  }

  function hideCompareUI() {
    const panel = document.getElementById('comparePanel');
    if (panel) panel.style.display = 'none';
    // 차트의 비교 라인 제거
    if (window.chart && window.chart.indicators) {
      Object.keys(window.chart.indicators).filter(k => k.startsWith('compare_')).forEach(k => {
        window.chart.removeIndicator(k);
      });
      window.chart._dirty = true;
    }
  }

  window._addCompareSymbol = function() {
    if (window._compareSymbols.length >= 4) {
      window.showToast?.('비교 차트는 최대 4개까지', '#3B82F6');
      return;
    }
    const sel = document.getElementById('compareSymAdd');
    if (!sel) return;
    const sym = sel.value;
    if (!sym || window._compareSymbols.some(s => s.symbol === sym)) return;

    const usedColors = new Set(window._compareSymbols.map(s => s.color));
    const newColor = COMPARE_COLORS.find(c => !usedColors.has(c)) || COMPARE_COLORS[0];

    window._compareSymbols.push({ symbol: sym, color: newColor });
    sel.querySelector(`option[value="${sym}"]`)?.remove();
    renderCompareList();
    loadCompareData();
  };

  window._removeCompareSymbol = function(sym) {
    window._compareSymbols = window._compareSymbols.filter(s => s.symbol !== sym);
    if (window.chart) window.chart.removeIndicator(`compare_${sym}`);
    renderCompareList();
    if (window.chart) window.chart._dirty = true;

    // 추가 가능 select에 다시 추가
    const sel = document.getElementById('compareSymAdd');
    if (sel && !sel.querySelector(`option[value="${sym}"]`)) {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = sym.replace('USDT', '');
      sel.appendChild(opt);
    }
  };

  async function loadCompareData() {
    if (!window.chart || !window._compareMode) return;
    const tf = window.curTf || '5m';
    const limit = 200;

    // 메인 차트는 현재 종목으로 유지 — 비교는 indicator로 그림
    // 모든 비교 종목 데이터 가져오기
    const promises = window._compareSymbols.map(async (s) => {
      try {
        const d = await _safeJsonRequest(`/v1/charts/candles?symbolId=${s.symbol}&timeframe=${tf}&limit=${limit}`);
        if (!d?.success || !d.data?.candles?.length) return null;
        return {
          symbol: s.symbol,
          color: s.color,
          candles: d.data.candles.map(c => parseFloat(c.close)),
        };
      } catch {
        return null;
      }
    });
    const results = (await Promise.all(promises)).filter(Boolean);
    if (!results.length) return;

    // 모든 차트의 시작가 = 0%로 정규화
    // 차트의 right axis는 가격이므로, 가짜 가격으로 변환:
    // 메인 종목 시작가 기준으로 동일한 % 변화를 주는 가격으로 변환
    const main = results.find(r => r.symbol === window.curSymbol) || results[0];
    if (!main) return;
    const mainStart = main.candles[0];

    results.forEach(r => {
      const start = r.candles[0];
      // 변화율을 메인 종목 가격대로 변환
      const data = r.candles.map((c, i) => {
        const pct = (c - start) / start;
        const equivalentPrice = mainStart * (1 + pct);
        return { index: i, value: equivalentPrice };
      });
      window.chart.setIndicator(`compare_${r.symbol}`, data, r.color, 2);
    });

    // 변화율 라벨 업데이트
    results.forEach(r => {
      const last = r.candles[r.candles.length - 1];
      const start = r.candles[0];
      const pct = (last - start) / start * 100;
      const sign = pct >= 0 ? '+' : '';
      const color = pct >= 0 ? '#C4384B' : '#3B82F6';
      const el = document.querySelector(`.compare-pct[data-sym="${r.symbol}"]`);
      if (el) {
        el.textContent = `${sign}${pct.toFixed(2)}%`;
        el.style.color = color;
      }
    });

    window.chart._dirty = true;
  }

  // 타임프레임 변경 시 비교 데이터 재로드
  document.addEventListener('click', (e) => {
    const tf = e.target.closest('[data-tf]');
    if (tf && window._compareMode) {
      setTimeout(loadCompareData, 300);
    }
  });

  // 30초마다 갱신 (서브차트는 마지막 봉만 업데이트 — 줌/스크롤 보존)
  setInterval(() => {
    if (document.hidden) return;
    if (window._compareMode) loadCompareData();
    if (window._chartLayout >= 2) {
      ['chart2Panel', 'chart3Panel', 'chart4Panel'].forEach(async (id) => {
        const chart = window._subCharts && window._subCharts[id];
        if (!chart || chart._destroyed || !chart.buffer.length) return;
        try {
          const d = await _safeJsonRequest(`/v1/charts/candles?symbolId=${chart._subSymbol}&timeframe=${chart._subTf}&limit=2`);
          if (!d?.success || !d.data?.candles?.length) return;
          const c = d.data.candles[d.data.candles.length - 1];
          const t = parseInt(c.openTime) > 1e12 ? Math.floor(parseInt(c.openTime) / 1000) : Math.floor(new Date(c.openTime).getTime() / 1000);
          chart.updateOrAppend(t, parseFloat(c.open), parseFloat(c.high), parseFloat(c.low), parseFloat(c.close), parseFloat(c.volume || 0));
          const p = document.getElementById(id);
          const priceEl = p && p.querySelector('.sub-chart-price');
          if (priceEl) { const ch = (parseFloat(c.close) - chart.buffer.close[0]) / chart.buffer.close[0] * 100; const sg = ch >= 0 ? '+' : '', cl = ch >= 0 ? '#C4384B' : '#3B82F6'; priceEl.innerHTML = `${parseFloat(c.close).toLocaleString()} <span style="color:${cl}">${sg}${ch.toFixed(2)}%</span>`; }
        } catch {}
      });
    }
  }, 30000);

  // 리사이즈는 각 ChartCore의 자체 ResizeObserver가 처리 (별도 리로드 불필요)

  // ─── 2단계: 지표 토글이 활성 서브패널에도 반영되게 calcIndicators/_refreshOverlays 래핑 ───
  function _activeSubChart() {
    const id = window._activeChartPanel;
    if (!id || id === 'main') return null;
    return (window._subCharts && window._subCharts[id]) || null;
  }
  let _subReRenderT = null;
  function _scheduleActiveSubReRender() {
    const chart = _activeSubChart();
    if (!chart || chart._destroyed) return;
    clearTimeout(_subReRenderT);
    _subReRenderT = setTimeout(() => {
      try { window.loadChart2 && window.loadChart2(chart, chart._subSymbol, chart._subTf); } catch (e) {}
    }, 150);
  }
  // 지표 버튼 .on 클래스 변화를 MutationObserver로 감지 → 어떤 경로의 토글이든 포착.
  // 활성 패널 상태 저장 + 활성 서브패널 재렌더 (클로저 Y/U 직접호출도 .on은 바뀌므로 확실)
  let _moT = null;
  function _onIndButtonsChanged() {
    if (window._panelSwitching) return; // 패널 전환 중 버튼 변경은 무시
    clearTimeout(_moT);
    _moT = setTimeout(() => {
      try {
        if (window._activeChartPanel) window._panelIndState[window._activeChartPanel] = _captureIndState();
        _scheduleActiveSubReRender();
      } catch (e) {}
    }, 100);
  }
  function _observeIndButtons() {
    const btns = document.querySelectorAll('.ind-tag[data-ind], .ind-tag[data-sub], .sub-ind[data-sub]');
    if (!btns.length) return false;
    const mo = new MutationObserver((muts) => {
      if (muts.some(m => m.attributeName === 'class')) _onIndButtonsChanged();
    });
    btns.forEach(b => mo.observe(b, { attributes: true, attributeFilter: ['class'] }));
    return true;
  }
  // 버튼이 준비된 뒤 관찰 시작
  (function _try(n) { if (_observeIndButtons() || n <= 0) return; setTimeout(() => _try(n - 1), 500); })(10);
})();
