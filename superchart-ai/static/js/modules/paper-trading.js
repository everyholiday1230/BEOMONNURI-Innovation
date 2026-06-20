// ═══════════════════════════════════════════════════════════════
// paper-trading.js — 거래소 수준 모의주문 시스템 v2
//
// 기능:
// - 잔고/마진/사용가능/미실현PnL 추적
// - 레버리지 (1x~100x) + 격리/교차 마진
// - 시장가/지정가 주문, SL/TP, 부분청산
// - 차트 마커 자동 복원 (종목/TF 변경 시에도)
// - 거래 히스토리 + DB 동기화 (로그인 시)
// ═══════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // ───────── 상수 ─────────
  const INITIAL_BALANCE = 1000;  // $1,000 시작
  const FEE_RATE = 0.0004;        // 0.04% 수수료 (Binance Futures Taker)
  const MAINTENANCE_MARGIN_RATE = 0.005;  // 청산 유지마진율 0.5%

  // ───────── 상태 ─────────
  const State = {
    balance: parseFloat(localStorage.getItem('paperBalance') || INITIAL_BALANCE),
    positions: JSON.parse(localStorage.getItem('paperPositions') || '[]'),
    history: JSON.parse(localStorage.getItem('paperHistory') || '[]'),
    pendingOrders: JSON.parse(localStorage.getItem('paperPendingOrders') || '[]'),
    settings: {
      leverage: parseInt(localStorage.getItem('paperLeverage') || '5'),
      marginMode: localStorage.getItem('paperMarginMode') || 'isolated',  // isolated|cross
    }
  };

  // 구버전 mockPos/mockHistory 마이그레이션
  (function migrate(){
    if (localStorage.getItem('paperMigrated_v2')) return;
    try {
      const oldPos = JSON.parse(localStorage.getItem('mockPos') || '[]');
      const oldHist = JSON.parse(localStorage.getItem('mockHistory') || '[]');
      const oldBal = parseFloat(localStorage.getItem('mockBalance') || '0');
      
      if (oldPos.length || oldHist.length) {
        // 포지션 변환 (구버전: side='buy'/'sell', sl/tp는 %)
        for (const p of oldPos) {
          State.positions.push({
            id: 'pos_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
            sym: p.sym,
            side: p.side === 'buy' ? 'long' : 'short',
            entry: p.price,
            qty: p.qty / p.price,  // USDT → 코인 수량
            margin: p.qty / (State.settings.leverage || 5),
            leverage: State.settings.leverage || 5,
            marginMode: 'isolated',
            sl: p.sl ? p.price * (p.side==='buy' ? (1-p.sl/100) : (1+p.sl/100)) : null,
            tp: p.tp ? p.price * (p.side==='buy' ? (1+p.tp/100) : (1-p.tp/100)) : null,
            time: p.time || Date.now(),
            timeframe: p.timeframe || null,
            barIndex: p.barIndex !== undefined ? p.barIndex : null,
          });
        }
        State.history = oldHist.map(h => ({
          ...h,
          side: h.side === 'buy' ? 'long' : (h.side === 'sell' ? 'short' : h.side),
        }));
        if (oldBal > 0) State.balance = oldBal;
        save();
      }
      localStorage.setItem('paperMigrated_v2', '1');
    } catch(e) { /* silent */ }
  })();

  // ───────── 저장 ─────────
  function save() {
    localStorage.setItem('paperBalance', String(State.balance));
    localStorage.setItem('paperPositions', JSON.stringify(State.positions));
    localStorage.setItem('paperHistory', JSON.stringify(State.history.slice(-200)));
    localStorage.setItem('paperPendingOrders', JSON.stringify(State.pendingOrders));
    localStorage.setItem('paperLeverage', String(State.settings.leverage));
    localStorage.setItem('paperMarginMode', State.settings.marginMode);
    
    // 백엔드 동기화 (로그인 시)
    syncToServer();
  }

  let _syncTimer = null;
  function syncToServer() {
    if (!window.isLoggedIn?.()) return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try {
        await fetch('/v1/paper/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            balance: State.balance,
            positions: State.positions,
            history: State.history.slice(-100),
            settings: State.settings,
          })
        });
      } catch(e) { /* silent */ }
    }, 3000);  // 3초 디바운스
  }

  // 페이지 로드 시 서버에서 가져오기
  async function loadFromServer() {
    if (!window.isLoggedIn?.()) return;
    try {
      const r = await fetch('/v1/paper/state', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      if (d.success && d.data) {
        if (typeof d.data.balance === 'number') State.balance = d.data.balance;
        if (Array.isArray(d.data.positions)) State.positions = d.data.positions;
        if (Array.isArray(d.data.history)) State.history = d.data.history;
        if (d.data.settings) Object.assign(State.settings, d.data.settings);
        renderAll();
      }
    } catch(e) { /* silent */ }
  }

  // ───────── 가격 조회 ─────────
  function getCurrentPrice(sym) {
    if (sym === window.curSymbol && window._rt?.lastPrice) return window._rt.lastPrice;
    if (window._wlPriceCache?.[sym]?.price) return window._wlPriceCache[sym].price;
    // 차트 buffer
    if (sym === window.curSymbol && window.chart?.buffer?.length) {
      return window.chart.buffer.close[window.chart.buffer.length - 1];
    }
    return null;
  }

  // 보유 포지션 종목 중 가격 캐시에 없는 것을 ticker-24hr로 보충 (다른 종목 포지션 손익 정확도)
  let _posPriceTimer = null;
  async function pollPositionPrices() {
    if (!State.positions.length) return;
    window._wlPriceCache = window._wlPriceCache || {};
    const need = [...new Set(State.positions.map(p => p.sym))]
      .filter(sym => sym !== window.curSymbol && !window._wlPriceCache[sym]?.price);
    if (!need.length) return;
    const apiOf = sym => {
      if (Array.isArray(window.symbols)) {
        const s = window.symbols.find(x => x.code === sym);
        if (s && (s.apiCode || s.code)) return s.apiCode || s.code;
      }
      return sym;
    };
    await Promise.all(need.map(async sym => {
      try {
        const r = await fetch(`/v1/charts/ticker-24hr?symbol=${encodeURIComponent(apiOf(sym))}`);
        const d = await r.json();
        const px = parseFloat(d?.lastPrice ?? 0);
        if (px > 0) window._wlPriceCache[sym] = { price: px, pct: parseFloat(d?.priceChangePercent ?? 0) };
      } catch (e) { /* silent */ }
    }));
  }

  // ───────── 계산 ─────────
  function calcPnl(pos, currentPrice) {
    if (!currentPrice) return { pnl: 0, pnlPct: 0, roe: 0 };
    const diff = pos.side === 'long' ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
    const pnl = diff * pos.qty;
    const pnlPct = (diff / pos.entry) * 100;
    const roe = (pnl / pos.margin) * 100;  // ROE = PnL / 마진
    return { pnl, pnlPct, roe };
  }

  function calcLiquidation(pos) {
    // 격리: 포지션 마진만 버퍼. 교차: 마진 + 가용잔고가 버퍼라 청산가가 더 멀어짐.
    let buffer = (1 / pos.leverage) * (1 - MAINTENANCE_MARGIN_RATE);
    if (pos.marginMode === 'cross') {
      const notional = pos.qty * pos.entry;
      if (notional > 0) {
        // 다른 격리 포지션 마진을 제외한 가용 잔고를 이 포지션의 추가 버퍼로 사용
        const otherMargin = State.positions.reduce((s, p) => s + (p.id !== pos.id ? p.margin : 0), 0);
        const extra = Math.max(0, (State.balance - otherMargin - pos.margin));
        buffer += (extra / notional);
      }
    }
    return pos.side === 'long'
      ? pos.entry * (1 - buffer)
      : pos.entry * (1 + buffer);
  }

  function calcUnrealizedPnl() {
    let total = 0;
    for (const p of State.positions) {
      const cur = getCurrentPrice(p.sym);
      if (cur) {
        const { pnl } = calcPnl(p, cur);
        total += pnl;
      }
    }
    return total;
  }

  function calcUsedMargin() {
    return State.positions.reduce((s, p) => s + p.margin, 0);
  }

  function calcAvailableBalance() {
    return State.balance - calcUsedMargin();
  }

  function calcTotalEquity() {
    return State.balance + calcUnrealizedPnl();
  }

  // ───────── 주문 ─────────
  function placeOrder(opts) {
    const { sym, side, type, price, qtyUsdt, sl, tp, leverage, marginMode } = opts;
    const lev = leverage || State.settings.leverage;
    const mode = marginMode || State.settings.marginMode;
    
    const curPrice = type === 'limit' ? price : getCurrentPrice(sym);
    if (!curPrice) {
      window.showToast?.('가격 정보 없음', '#3B82F6');
      return false;
    }
    
    const margin = qtyUsdt / lev;
    if (margin > calcAvailableBalance()) {
      window.showToast?.(`사용가능 잔고 부족 ($${calcAvailableBalance().toFixed(2)})`, '#3B82F6');
      return false;
    }
    
    const qty = qtyUsdt / curPrice;  // 코인 수량
    const fee = qtyUsdt * FEE_RATE;
    
    if (type === 'limit' && price !== getCurrentPrice(sym)) {
      // 미체결 주문
      State.pendingOrders.push({
        id: 'ord_' + Date.now(),
        sym, side, type, price, qtyUsdt, sl, tp, leverage: lev, marginMode: mode,
        time: Date.now(),
      });
      save();
      renderAll();
      window.showToast?.(`지정가 주문 등록 ${sym} ${side === 'long' ? '롱' : '숏'} @ $${price}`, '#D8B66A');
      return true;
    }
    
    // 시장가 즉시 체결
    const slPrice = sl ? curPrice * (side === 'long' ? (1 - sl/100) : (1 + sl/100)) : null;
    const tpPrice = tp ? curPrice * (side === 'long' ? (1 + tp/100) : (1 - tp/100)) : null;
    
    const pos = {
      id: 'pos_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      sym, side,
      entry: curPrice,
      qty,
      margin,
      leverage: lev,
      marginMode: mode,
      sl: slPrice,
      tp: tpPrice,
      slPct: sl,
      tpPct: tp,
      time: Date.now(),
      timeframe: window.curTf || null,
      barIndex: window.chart?.buffer?.length ? window.chart.buffer.length - 1 : null,
      fee,
    };
    
    State.balance -= fee;  // 진입 수수료
    State.positions.push(pos);
    save();
    renderAll();
    
    // 차트 마커 추가
    if (sym === window.curSymbol) {
      window.chart?.addDrawing?.({
        type: 'demo_action',
        price: curPrice,
        index: pos.barIndex,
        label: side === 'long' ? '롱' : '숏',
        action: side === 'long' ? 'long_entry' : 'short_entry',
        _posId: pos.id,
      });
    }
    
    const sideLabel = side === 'long' ? '롱' : '숏';
    window.showToast?.(`${sym.replace('USDT','')} ${sideLabel} ${lev}x ${qtyUsdt}USDT 진입 @ $${curPrice.toFixed(curPrice>1?2:6)}`, side === 'long' ? '#C4384B' : '#3B82F6');
    return true;
  }

  function closePosition(posId, ratio) {
    ratio = Math.min(1, Math.max(0.01, ratio || 1));
    const idx = State.positions.findIndex(p => p.id === posId);
    if (idx < 0) return;
    
    const pos = State.positions[idx];
    const cur = getCurrentPrice(pos.sym);
    if (!cur) {
      window.showToast?.('가격 정보 없음', '#3B82F6');
      return;
    }
    
    const closeQty = pos.qty * ratio;
    const closeMargin = pos.margin * ratio;
    const diff = pos.side === 'long' ? (cur - pos.entry) : (pos.entry - cur);
    const pnl = diff * closeQty;
    const pnlPct = (diff / pos.entry) * 100;
    const exitFee = (closeQty * cur) * FEE_RATE;
    const netPnl = pnl - exitFee;
    
    // 잔고에 마진 + 손익 반영
    State.balance += closeMargin + netPnl;
    
    // 히스토리
    State.history.push({
      sym: pos.sym,
      side: pos.side,
      entry: pos.entry,
      exit: cur,
      qty: closeQty,
      qtyUsdt: closeQty * pos.entry,
      pnl: netPnl,
      pct: pnlPct,
      leverage: pos.leverage,
      reason: ratio >= 1 ? '수동청산' : `${Math.round(ratio*100)}% 부분청산`,
      time: Date.now(),
      time_str: new Date().toLocaleTimeString('ko-KR'),
    });

    // 차트에 청산 마커 (현재 종목일 때) — 롱청산=매도, 숏청산=매수 표시
    if (pos.sym === window.curSymbol && window.chart?.addDrawing) {
      window.chart.addDrawing({
        type: 'demo_action',
        price: cur,
        index: (window.chart.buffer ? window.chart.buffer.length - 1 : 0),
        label: `청산 ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(1)}`,
        action: 'close',
        _posId: pos.id,
      });
      window.chart._dirty = true;
    }

    // 부분청산이면 포지션 축소, 아니면 제거
    if (ratio >= 1) {
      State.positions.splice(idx, 1);
    } else {
      pos.qty -= closeQty;
      pos.margin -= closeMargin;
    }
    
    save();
    renderAll();
    
    // 차트 마커
    if (pos.sym === window.curSymbol) {
      const barIdx = window.chart?.buffer?.length ? window.chart.buffer.length - 1 : 0;
      window.chart?.addDrawing?.({
        type: 'demo_action',
        price: cur,
        index: barIdx,
        label: `청산 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`,
        action: 'close',
        _posId: pos.id,
      });
    }
    
    const color = netPnl >= 0 ? '#C4384B' : '#3B82F6';
    window.showToast?.(`${pos.sym.replace('USDT','')} 청산 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`, color);
  }

  function modifyTPSL(posId, slPct, tpPct) {
    const pos = State.positions.find(p => p.id === posId);
    if (!pos) return;
    pos.slPct = slPct;
    pos.tpPct = tpPct;
    pos.sl = slPct ? pos.entry * (pos.side === 'long' ? (1 - slPct/100) : (1 + slPct/100)) : null;
    pos.tp = tpPct ? pos.entry * (pos.side === 'long' ? (1 + tpPct/100) : (1 - tpPct/100)) : null;
    save();
    renderAll();
    window.showToast?.(`${pos.sym.replace('USDT','')} TP/SL 변경 SL ${slPct||0}% / TP ${tpPct||0}%`, '#D8B66A');
  }

  // ───────── 자동 청산 (SL/TP/청산가) ─────────
  function checkAutoClose() {
    for (let i = State.positions.length - 1; i >= 0; i--) {
      const pos = State.positions[i];
      const cur = getCurrentPrice(pos.sym);
      if (!cur) continue;
      
      const liqPrice = calcLiquidation(pos);
      const isLiquidated = pos.side === 'long' ? cur <= liqPrice : cur >= liqPrice;
      
      if (isLiquidated) {
        // 청산 (마진 손실)
        State.history.push({
          sym: pos.sym, side: pos.side,
          entry: pos.entry, exit: cur, qty: pos.qty,
          qtyUsdt: pos.qty * pos.entry,
          pnl: -pos.margin,
          pct: pos.side === 'long' ? -100 : -100,
          leverage: pos.leverage,
          reason: '강제청산',
          time: Date.now(),
          time_str: new Date().toLocaleTimeString('ko-KR'),
        });
        State.positions.splice(i, 1);
        window.showToast?.(`⚠ ${pos.sym.replace('USDT','')} 강제청산 -$${pos.margin.toFixed(2)}`, '#3B82F6');
        save();
        continue;
      }
      
      // SL/TP 체크
      if (pos.sl && (pos.side === 'long' ? cur <= pos.sl : cur >= pos.sl)) {
        closePosition(pos.id, 1);
        continue;
      }
      if (pos.tp && (pos.side === 'long' ? cur >= pos.tp : cur <= pos.tp)) {
        closePosition(pos.id, 1);
      }
    }
    
    // 미체결 지정가 체크
    for (let i = State.pendingOrders.length - 1; i >= 0; i--) {
      const ord = State.pendingOrders[i];
      const cur = getCurrentPrice(ord.sym);
      if (!cur) continue;
      
      // 지정가 도달 체크
      const triggered = ord.side === 'long' ? cur <= ord.price : cur >= ord.price;
      if (triggered) {
        State.pendingOrders.splice(i, 1);
        save();
        placeOrder({
          sym: ord.sym, side: ord.side, type: 'market',
          qtyUsdt: ord.qtyUsdt, sl: ord.sl, tp: ord.tp,
          leverage: ord.leverage, marginMode: ord.marginMode,
        });
      }
    }
  }

  // ───────── 차트 마커 복원 ─────────
  function restoreChartMarkers() {
    if (!window.chart || !window.chart.buffer || !window.chart.buffer.length) return;
    if (!window.curSymbol) return;
    
    // 기존 demo_action 제거 (이 종목/TF 마커만)
    if (window.chart.overlay) {
      window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d.type !== 'demo_action');
    }
    
    // 현재 종목의 활성 포지션 + 최근 히스토리를 마커로
    const curSym = window.curSymbol;
    const buf = window.chart.buffer;
    const bufLen = buf.length;
    
    function timeToBarIndex(time_ms) {
      // 차트 buffer의 time 배열에서 해당 timestamp의 인덱스 찾기
      const time_sec = Math.floor(time_ms / 1000);
      // 가장 가까운 시간 찾기 (이진검색은 오버킬, 선형 OK)
      for (let i = bufLen - 1; i >= 0; i--) {
        if (buf.time[i] <= time_sec) return i;
      }
      return 0;
    }
    
    // 활성 포지션 마커
    for (const pos of State.positions) {
      if (pos.sym !== curSym) continue;
      const idx = pos.time ? timeToBarIndex(pos.time) : (pos.barIndex || 0);
      if (idx < 0 || idx >= bufLen) continue;
      window.chart.addDrawing({
        type: 'demo_action',
        price: pos.entry,
        index: idx,
        label: (pos.side === 'long' ? '롱 ' : '숏 ') + pos.leverage + 'x',
        action: pos.side === 'long' ? 'long_entry' : 'short_entry',
        _posId: pos.id,
      });
    }
    
    // 최근 30개 히스토리 마커
    const recent = State.history.filter(h => h.sym === curSym).slice(-30);
    for (const h of recent) {
      const idx = timeToBarIndex(h.time);
      if (idx < 0 || idx >= bufLen) continue;
      window.chart.addDrawing({
        type: 'demo_action',
        price: h.exit,
        index: idx,
        label: `청산 ${h.pnl >= 0 ? '+' : ''}$${h.pnl.toFixed(2)}`,
        action: 'close',
        _color: h.pnl >= 0 ? '#C4384B' : '#3B82F6',
      });
    }
    
    window.chart._dirty = true;
  }

  // ───────── UI 렌더링 ─────────
  function renderAll() {
    renderBalanceCard();
    renderOrderForm();
    renderPositionCards();
    renderHistory();
    renderPendingOrders();
    if (window.chart) window.chart._dirty = true;  // 차트 갱신 트리거
  }

  function renderBalanceCard() {
    const el = document.getElementById('paperBalanceCard');
    if (!el) return;
    
    const total = calcTotalEquity();
    const used = calcUsedMargin();
    const available = calcAvailableBalance();
    const unrealized = calcUnrealizedPnl();
    const unrealizedPct = State.balance > 0 ? (unrealized / State.balance * 100) : 0;
    const totalPct = ((total - INITIAL_BALANCE) / INITIAL_BALANCE * 100);
    
    const upColor = '#C4384B', dnColor = '#3B82F6';
    const uColor = unrealized >= 0 ? upColor : dnColor;
    const tColor = totalPct >= 0 ? upColor : dnColor;
    
    el.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(146,18,48,0.08),rgba(216,182,106,0.05));padding:14px;border-radius:10px;border:1px solid rgba(146,18,48,0.15);box-shadow:var(--shadow-sm)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <span style="font-size:11px;color:var(--color-text-muted)">총 자산</span>
          <span style="font-size:24px;font-weight:800;color:#921230;font-variant-numeric:tabular-nums;letter-spacing:-.5px">$${total.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:var(--color-text-muted)">미실현 PnL</span>
          <span style="color:${uColor};font-weight:600">${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)} (${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%)</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:var(--color-text-muted)">사용 가능</span>
          <span style="font-weight:600">$${available.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:var(--color-text-muted)">포지션 마진</span>
          <span>$${used.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;padding-top:6px;border-top:1px solid rgba(0,0,0,0.06);margin-top:6px">
          <span style="color:var(--color-text-muted)">전체 수익률</span>
          <span style="color:${tColor};font-weight:600">${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-muted);margin-top:4px">
          <span>거래 ${State.history.length}건</span>
          <span>승률 ${calcWinRate()}%</span>
          <button onclick="window.PaperTrading.resetAll()" style="background:none;border:none;color:#3B82F6;cursor:pointer;font-size:10px">초기화</button>
        </div>
        ${(() => { const st = calcStats(); return st.n ? `
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-muted);margin-top:2px">
          <span>실현손익 <b style="color:${st.realized >= 0 ? upColor : dnColor}">${st.realized >= 0 ? '+' : ''}$${st.realized.toFixed(2)}</b></span>
          <span>손익비 <b style="color:var(--color-text)">${st.pf === null ? '-' : (st.pf === Infinity ? '∞' : st.pf.toFixed(2))}</b></span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-muted);margin-top:2px">
          <span>평균이익 <b style="color:${upColor}">+$${st.avgWin.toFixed(2)}</b></span>
          <span>평균손실 <b style="color:${dnColor}">-$${st.avgLoss.toFixed(2)}</b></span>
        </div>` : ''; })()}
      </div>
    `;
  }

  function calcWinRate() {
    if (!State.history.length) return 0;
    const wins = State.history.filter(h => h.pnl > 0).length;
    return Math.round(wins / State.history.length * 100);
  }

  function calcStats() {
    const h = State.history.filter(x => typeof x.pnl === 'number');
    const n = h.length;
    if (!n) return { n: 0, winRate: 0, realized: 0, pf: null, avgWin: 0, avgLoss: 0 };
    const winsArr = h.filter(x => x.pnl > 0).map(x => x.pnl);
    const lossArr = h.filter(x => x.pnl < 0).map(x => x.pnl);
    const grossWin = winsArr.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(lossArr.reduce((a, b) => a + b, 0));
    return {
      n,
      winRate: Math.round(winsArr.length / n * 100),
      realized: h.reduce((a, x) => a + x.pnl, 0),
      pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
      avgWin: winsArr.length ? grossWin / winsArr.length : 0,
      avgLoss: lossArr.length ? grossLoss / lossArr.length : 0,
    };
  }

  function renderOrderForm() {
    const el = document.getElementById('paperOrderForm');
    if (!el) return;
    
    const sym = window.curSymbol || 'BTCUSDT';
    const symShort = sym.replace('USDT', '');
    const cur = getCurrentPrice(sym) || 0;
    const lev = State.settings.leverage;
    const available = calcAvailableBalance();
    
    el.innerHTML = `
      <div style="background:rgba(0,0,0,0.02);padding:10px;border-radius:8px">
        <!-- 종목 + 현재가 -->
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span style="font-weight:700">${symShort}/USDT</span>
          <span style="font-size:14px;color:var(--color-secondary-light);font-weight:600">$${cur ? cur.toFixed(cur>1?2:6) : '-'}</span>
        </div>
        
        <!-- 레버리지 + 마진 모드 -->
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <div style="flex:1;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,0.04);padding:6px 8px;border-radius:6px">
            <span style="font-size:10px;color:var(--color-text-muted)">레버리지</span>
            <input id="paperLevSlider" type="range" min="1" max="100" step="1" value="${lev}" class="lev-slider" style="flex:1" oninput="window.PaperTrading.setLeverage(parseInt(this.value))">
            <span style="font-weight:700;color:#921230;min-width:32px;text-align:right">${lev}x</span>
          </div>
          <div style="display:flex;background:rgba(0,0,0,0.04);border-radius:6px;overflow:hidden">
            <button onclick="window.PaperTrading.setMarginMode('isolated')" style="padding:4px 8px;border:none;background:${State.settings.marginMode==='isolated'?'#921230':'transparent'};color:${State.settings.marginMode==='isolated'?'#fff':'var(--color-text)'};cursor:pointer;font-size:10px;font-weight:600">격리</button>
            <button onclick="window.PaperTrading.setMarginMode('cross')" style="padding:4px 8px;border:none;background:${State.settings.marginMode==='cross'?'#921230':'transparent'};color:${State.settings.marginMode==='cross'?'#fff':'var(--color-text)'};cursor:pointer;font-size:10px;font-weight:600">교차</button>
          </div>
        </div>
        
        <!-- 매수/매도 토글 -->
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button id="paperBuyBtn" onclick="window.PaperTrading.setSide('long')" style="flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-weight:700;background:#C4384B;color:#fff;font-size:13px;transition:opacity .15s,box-shadow .15s,transform .1s;box-shadow:0 2px 8px rgba(196,56,75,.3)">매수 / 롱</button>
          <button id="paperSellBtn" onclick="window.PaperTrading.setSide('short')" style="flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-weight:700;background:#3B82F6;color:#fff;opacity:0.5;font-size:13px;transition:opacity .15s,box-shadow .15s,transform .1s">매도 / 숏</button>
        </div>
        
        <!-- 주문 유형 -->
        <div style="display:flex;gap:4px;margin-bottom:8px">
          <button onclick="window.PaperTrading.setOrderType('market')" id="paperTypeMarket" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:5px;background:#921230;color:#fff;cursor:pointer;font-size:11px;font-weight:600">시장가</button>
          <button onclick="window.PaperTrading.setOrderType('limit')" id="paperTypeLimit" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--color-text);cursor:pointer;font-size:11px">지정가</button>
        </div>
        
        <!-- 지정가 입력 (limit일 때만) -->
        <div id="paperLimitRow" style="display:none;margin-bottom:8px">
          <label style="font-size:10px;color:var(--color-text-muted);display:block;margin-bottom:2px">지정가</label>
          <input id="paperLimitPrice" type="number" step="any" placeholder="${cur ? cur.toFixed(2) : '가격'}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:13px;font-weight:600">
        </div>
        
        <!-- 수량 -->
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-muted);margin-bottom:2px">
            <span>주문 금액 (USDT)</span>
            <span>사용가능 $${available.toFixed(2)}</span>
          </div>
          <input id="paperQty" type="number" value="50" min="1" step="10" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:13px;font-weight:600" oninput="window.PaperTrading.updateOrderSummary()">
          <div style="display:flex;gap:3px;margin-top:4px">
            ${[25,50,75,100].map(p => `<button onclick="window.PaperTrading.setQtyPercent(${p})" style="flex:1;padding:6px 0;border:1px solid var(--border);background:transparent;color:var(--color-text);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .12s" onmouseover="this.style.borderColor='#921230';this.style.background='rgba(146,18,48,0.06)'" onmouseout="this.style.borderColor='';this.style.background='transparent'">${p}%</button>`).join('')}
          </div>
        </div>
        
        <!-- SL/TP -->
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <div style="flex:1">
            <label style="font-size:10px;color:#3B82F6;display:block;margin-bottom:2px">손절 % (SL)</label>
            <input id="paperSL" type="number" value="2" step="0.1" min="0" style="width:100%;padding:5px 6px;border:1px solid rgba(59,130,246,0.3);border-radius:5px;font-size:12px" oninput="window.PaperTrading.updateOrderSummary()">
          </div>
          <div style="flex:1">
            <label style="font-size:10px;color:#C4384B;display:block;margin-bottom:2px">익절 % (TP)</label>
            <input id="paperTP" type="number" value="4" step="0.1" min="0" style="width:100%;padding:5px 6px;border:1px solid rgba(196,56,75,0.3);border-radius:5px;font-size:12px" oninput="window.PaperTrading.updateOrderSummary()">
          </div>
        </div>
        
        <!-- 주문 요약 -->
        <div id="paperOrderSummary" style="background:rgba(0,0,0,0.04);padding:6px 8px;border-radius:5px;font-size:10px;line-height:1.6;margin-bottom:8px"></div>
        
        <!-- 주문 버튼 -->
        <button onclick="window.PaperTrading.submit()" id="paperSubmitBtn" style="width:100%;padding:10px;background:#C4384B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px">매수 주문 (롱)</button>
      </div>
    `;
    
    // 초기 요약 갱신
    updateOrderSummary();
  }

  // 주문 폼 상태
  let _formSide = 'long';
  let _formType = 'market';

  function setSide(side) {
    _formSide = side;
    const buyBtn = document.getElementById('paperBuyBtn');
    const sellBtn = document.getElementById('paperSellBtn');
    const submit = document.getElementById('paperSubmitBtn');
    if (buyBtn) { buyBtn.style.opacity = side === 'long' ? '1' : '0.5'; buyBtn.style.boxShadow = side === 'long' ? '0 2px 10px rgba(196,56,75,.4)' : 'none'; }
    if (sellBtn) { sellBtn.style.opacity = side === 'short' ? '1' : '0.5'; sellBtn.style.boxShadow = side === 'short' ? '0 2px 10px rgba(59,130,246,.4)' : 'none'; }
    if (submit) {
      submit.textContent = side === 'long' ? '매수 주문 (롱)' : '매도 주문 (숏)';
      submit.style.background = side === 'long' ? '#C4384B' : '#3B82F6';
    }
    updateOrderSummary();
  }

  function setOrderType(type) {
    _formType = type;
    document.getElementById('paperTypeMarket').style.background = type === 'market' ? '#921230' : 'transparent';
    document.getElementById('paperTypeMarket').style.color = type === 'market' ? '#fff' : 'var(--color-text)';
    document.getElementById('paperTypeLimit').style.background = type === 'limit' ? '#921230' : 'transparent';
    document.getElementById('paperTypeLimit').style.color = type === 'limit' ? '#fff' : 'var(--color-text)';
    document.getElementById('paperLimitRow').style.display = type === 'limit' ? 'block' : 'none';
  }

  function setLeverage(lev) {
    State.settings.leverage = lev;
    save();
    renderOrderForm();  // 레버리지 변경 시 폼 재렌더 (현재 표시 갱신)
    setSide(_formSide);  // 사이드 복원
    setOrderType(_formType);
  }

  function setMarginMode(mode) {
    State.settings.marginMode = mode;
    save();
    renderOrderForm();
    setSide(_formSide);
    setOrderType(_formType);
  }

  function setQtyPercent(pct) {
    const available = calcAvailableBalance();
    const qty = Math.floor(available * pct / 100 * State.settings.leverage);
    document.getElementById('paperQty').value = qty;
    updateOrderSummary();
  }

  function updateOrderSummary() {
    const el = document.getElementById('paperOrderSummary');
    if (!el) return;
    
    const qty = +(document.getElementById('paperQty')?.value || 0);
    const sl = +(document.getElementById('paperSL')?.value || 0);
    const tp = +(document.getElementById('paperTP')?.value || 0);
    const cur = getCurrentPrice(window.curSymbol) || 0;
    const lev = State.settings.leverage;
    const margin = qty / lev;
    
    if (!cur || !qty) {
      el.innerHTML = '<span style="color:var(--color-text-muted)">금액과 가격을 입력하세요</span>';
      return;
    }
    
    const liqPrice = cur * (_formSide === 'long' 
      ? (1 - (1/lev) * (1 - MAINTENANCE_MARGIN_RATE))
      : (1 + (1/lev) * (1 - MAINTENANCE_MARGIN_RATE)));
    
    const slLoss = qty * sl / 100;
    const tpGain = qty * tp / 100;
    const fee = qty * FEE_RATE * 2;  // 진입 + 청산
    
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between"><span>마진:</span><span style="font-weight:600">$${margin.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>예상 청산가:</span><span style="color:#3B82F6;font-weight:600">$${liqPrice.toFixed(liqPrice>1?2:6)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>예상 손절:</span><span style="color:#3B82F6">-$${slLoss.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>예상 익절:</span><span style="color:#C4384B">+$${tpGain.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--color-text-muted);padding-top:2px;border-top:1px solid rgba(0,0,0,0.05);margin-top:2px"><span>수수료(왕복):</span><span>-$${fee.toFixed(3)}</span></div>
    `;
  }

  function submit() {
    const sym = window.curSymbol || 'BTCUSDT';
    const qtyUsdt = +(document.getElementById('paperQty')?.value || 0);
    const sl = +(document.getElementById('paperSL')?.value || 0);
    const tp = +(document.getElementById('paperTP')?.value || 0);
    const limitPrice = _formType === 'limit' ? +(document.getElementById('paperLimitPrice')?.value || 0) : null;
    
    if (qtyUsdt <= 0) {
      window.showToast?.('주문 금액을 입력하세요', '#3B82F6');
      return;
    }
    if (_formType === 'limit' && (!limitPrice || limitPrice <= 0)) {
      window.showToast?.('지정가를 입력하세요', '#3B82F6');
      return;
    }
    
    placeOrder({
      sym,
      side: _formSide,
      type: _formType,
      price: limitPrice,
      qtyUsdt,
      sl: sl > 0 ? sl : null,
      tp: tp > 0 ? tp : null,
    });
  }

  function renderPositionCards() {
    const el = document.getElementById('paperPositions');
    if (!el) return;
    
    if (!State.positions.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-muted);font-size:11px">활성 포지션 없음</div>';
      return;
    }
    
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:var(--color-text-muted)">활성 포지션 (' + State.positions.length + ')</span>' + (State.positions.length >= 2 ? '<button onclick="window.PaperTrading.closeAll()" style="background:rgba(196,56,75,0.12);border:1px solid rgba(196,56,75,0.3);color:#921230;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;padding:2px 8px">전체 청산</button>' : '') + '</div>' + State.positions.map(pos => {
      const cur = getCurrentPrice(pos.sym) || pos.entry;
      const { pnl, pnlPct, roe } = calcPnl(pos, cur);
      const liqPrice = calcLiquidation(pos);
      const sideColor = pos.side === 'long' ? '#C4384B' : '#3B82F6';
      const pnlColor = pnl >= 0 ? '#C4384B' : '#3B82F6';
      const isCurSym = pos.sym === window.curSymbol;
      
      return `
        <div style="background:var(--color-surface-raised);border:1px solid var(--color-border);border-left:3px solid ${sideColor};padding:9px;border-radius:8px;margin-bottom:7px;font-size:11px;box-shadow:0 1px 4px rgba(15,23,42,0.06)${isCurSym?';box-shadow:0 0 0 2px '+sideColor+'33':''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div>
              <span style="font-weight:700;font-size:12px;cursor:pointer;color:var(--color-primary)" onclick="window._selectSym?.('${pos.sym}')">${pos.sym.replace('USDT','')}</span>
              <span style="background:${sideColor};color:#fff;padding:1px 5px;border-radius:3px;font-size:9px;margin-left:4px;font-weight:700">${pos.side === 'long' ? '롱' : '숏'} ${pos.leverage}x</span>
              <span style="background:rgba(0,0,0,0.05);padding:1px 5px;border-radius:3px;font-size:9px;margin-left:2px">${pos.marginMode === 'isolated' ? '격리' : '교차'}</span>
            </div>
            <div style="text-align:right">
              <div style="color:${pnlColor};font-weight:700;font-size:12px">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
              <div style="color:${pnlColor};font-size:10px">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% (ROE ${roe >= 0 ? '+' : ''}${roe.toFixed(1)}%)</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;color:var(--color-text-muted);margin-bottom:4px">
            <div>진입가 <span style="color:var(--color-text);font-weight:600">$${pos.entry.toFixed(pos.entry>1?2:6)}</span></div>
            <div>현재가 <span style="color:var(--color-text);font-weight:600">$${cur.toFixed(cur>1?2:6)}</span></div>
            <div>수량 <span style="color:var(--color-text)">${(pos.qty * pos.entry).toFixed(2)} USDT</span></div>
            <div>마진 <span style="color:var(--color-text)">$${pos.margin.toFixed(2)}</span></div>
            <div>청산가 <span style="color:#3B82F6;font-weight:600">${liqPrice > 0 ? '$' + liqPrice.toFixed(liqPrice>1?2:6) : '—'}</span></div>
            <div>TP/SL <span style="color:var(--color-text)">${pos.tpPct||0}% / ${pos.slPct||0}%</span></div>
          </div>
          <div style="display:flex;gap:3px">
            <button onclick="window.PaperTrading.close('${pos.id}', 0.5)" style="flex:1;padding:4px;background:rgba(216,182,106,0.2);border:1px solid rgba(216,182,106,0.4);color:#B8942E;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">50% 청산</button>
            <button onclick="window.PaperTrading.close('${pos.id}', 1)" style="flex:1;padding:4px;background:rgba(196,56,75,0.15);border:1px solid rgba(196,56,75,0.3);color:#921230;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">전체 청산</button>
            <button onclick="window.PaperTrading.editTPSL('${pos.id}')" style="padding:4px 6px;background:transparent;border:1px solid var(--border);color:var(--color-text);border-radius:4px;cursor:pointer;font-size:10px">TP/SL</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function editTPSL(posId) {
    const pos = State.positions.find(p => p.id === posId);
    if (!pos) return;
    const newSL = prompt(`손절 % (현재: ${pos.slPct || '없음'})`, pos.slPct || '');
    if (newSL === null) return;
    const newTP = prompt(`익절 % (현재: ${pos.tpPct || '없음'})`, pos.tpPct || '');
    if (newTP === null) return;
    modifyTPSL(posId, parseFloat(newSL) || null, parseFloat(newTP) || null);
  }

  function renderHistory() {
    const el = document.getElementById('paperHistory');
    if (!el) return;
    
    const recent = State.history.slice(-15).reverse();
    if (!recent.length) {
      el.innerHTML = '<div class="state-empty" style="font-size:12px;min-height:60px">아직 거래 내역이 없습니다<br>첫 모의주문을 체결해보세요</div>';
      return;
    }
    
    el.innerHTML = '<div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--color-text-muted)">최근 거래 (' + State.history.length + '건)</div>' + recent.map(h => {
      const color = h.pnl >= 0 ? '#C4384B' : '#3B82F6';
      const sideLabel = h.side === 'long' ? '롱' : '숏';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px solid var(--color-divider);font-size:10px;border-radius:4px;transition:background .12s" onmouseover="this.style.background='var(--color-primary-soft)'" onmouseout="this.style.background='transparent'">
          <div>
            <div style="font-weight:600;cursor:pointer" onclick="window._selectSym?.('${h.sym}')" title="차트로 이동"><span style="color:var(--color-primary)">${h.sym.replace('USDT','')}</span> <span style="color:${color}">${sideLabel}</span> ${h.leverage||1}x</div>
            <div style="color:var(--color-text-muted);font-size:9px">${h.time_str || new Date(h.time).toLocaleTimeString('ko-KR')} · ${h.reason || ''}</div>
          </div>
          <div style="text-align:right">
            <div style="color:${color};font-weight:700">${h.pnl >= 0 ? '+' : ''}$${h.pnl.toFixed(2)}</div>
            <div style="color:${color};font-size:9px">${h.pct >= 0 ? '+' : ''}${(h.pct||0).toFixed(2)}%</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPendingOrders() {
    const el = document.getElementById('paperPendingOrders');
    if (!el) return;
    
    if (!State.pendingOrders.length) {
      el.innerHTML = '';
      return;
    }
    
    el.innerHTML = '<div style="font-size:11px;font-weight:700;margin:8px 0 4px;color:var(--color-text-muted)">미체결 주문 (' + State.pendingOrders.length + ')</div>' + State.pendingOrders.map(o => {
      const sideColor = o.side === 'long' ? '#C4384B' : '#3B82F6';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(216,182,106,0.08);border:1px solid rgba(216,182,106,0.2);border-radius:5px;margin-bottom:3px;font-size:10px">
          <div>
            <span style="font-weight:600">${o.sym.replace('USDT','')}</span>
            <span style="color:${sideColor};font-weight:600">${o.side === 'long' ? '롱' : '숏'}</span>
            <span> @ $${o.price}</span>
            <span style="color:var(--color-text-muted)">·${o.qtyUsdt}USDT·${o.leverage}x</span>
          </div>
          <button onclick="window.PaperTrading.cancelPending('${o.id}')" style="background:none;border:none;color:#3B82F6;cursor:pointer;font-size:14px;padding:0 4px">×</button>
        </div>
      `;
    }).join('');
  }

  function cancelPending(orderId) {
    State.pendingOrders = State.pendingOrders.filter(o => o.id !== orderId);
    save();
    renderAll();
  }

  function resetAll() {
    if (!confirm('모의주문 전체 초기화 (예수금 $1,000으로 리셋)?')) return;
    State.balance = INITIAL_BALANCE;
    State.positions = [];
    State.history = [];
    State.pendingOrders = [];
    save();
    // 구버전 localStorage 키도 정리
    localStorage.removeItem('mockPos');
    localStorage.removeItem('mockHistory');
    renderAll();
    if (window.chart?.overlay) {
      window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d =>
        d.type !== 'demo_action'
      );
      window.chart._dirty = true;
    }
    window.showToast?.('모의주문 초기화 완료', '#8E7D72');
  }

  // ───────── 외부 노출 ─────────
  function closeAll() {
    const ids = State.positions.map(p => p.id);
    if (!ids.length) return;
    ids.forEach(id => closePosition(id, 1));
    window.showToast?.(`전체 포지션 ${ids.length}건 청산`, '#921230');
  }

  window.PaperTrading = {
    submit, close: closePosition, closeAll, modifyTPSL, editTPSL,
    setSide, setOrderType, setLeverage, setMarginMode, setQtyPercent,
    updateOrderSummary, cancelPending, resetAll,
    restoreChartMarkers, renderAll,
    getState: () => State,
    getCurrentPrice,
  };

  // ───────── 초기화 ─────────
  function init() {
    renderAll();
    
    // 1초마다 가격 업데이트 → 포지션/잔고 카드 + 자동청산 체크
    setInterval(() => {
      checkAutoClose();
      renderBalanceCard();
      renderPositionCards();
    }, 1000);

    // 보유 포지션 종목 가격 보충 (다른 종목 포지션 손익 정확도) — 즉시 + 5초 주기
    pollPositionPrices();
    _posPriceTimer = setInterval(() => { if (!document.hidden) pollPositionPrices(); }, 5000);
    
    // 차트 종목/TF 변경 시 마커 복원 후크
    if (window.chart) {
      const _origLoadBars = window.chart.loadBars?.bind(window.chart);
      if (_origLoadBars) {
        window.chart.loadBars = function(bars) {
          _origLoadBars(bars);
          setTimeout(restoreChartMarkers, 100);
        };
      }
    }
    
    // 종목 변경 이벤트 후크
    const _origSelectSym = window._selectSym;
    if (_origSelectSym) {
      window._selectSym = async function(sym) {
        await _origSelectSym(sym);
        setTimeout(restoreChartMarkers, 500);
      };
    }
    
    // 차트 TF 변경 후
    document.querySelectorAll('[data-tf]').forEach(btn => {
      const oldClick = btn.onclick;
      btn.onclick = function(e) {
        if (oldClick) oldClick.call(this, e);
        setTimeout(restoreChartMarkers, 800);
      };
    });
    
    // 서버 상태 로드
    setTimeout(loadFromServer, 1500);
  }

  // 차트 준비 완료 후 init
  if (window.chart) {
    init();
  } else {
    const checkInterval = setInterval(() => {
      if (window.chart) {
        clearInterval(checkInterval);
        init();
      }
    }, 200);
    setTimeout(() => clearInterval(checkInterval), 30000);  // 30초 안전망
  }

})();
