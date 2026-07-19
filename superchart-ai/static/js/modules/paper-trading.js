// ═══════════════════════════════════════════════════════════════
// paper-trading.js — 모의주문 연습 도구 (리스크 관리형 시뮬레이션)
//
// 실제 주문 기능이 아니라 가상 자금으로 진입가/목표가/손절가/수량/레버리지/
// 수수료/예상 손익/손익비를 "연습"하는 도구. 매수/매도/주문하기 등 실제 거래
// 지시 표현을 쓰지 않는다. 브랜드 컬러만 사용, 파란색/네온/이모지 금지.
// 백엔드 /v1/paper sync 재사용 (history 항목에 복기 필드 확장 저장).
// ═══════════════════════════════════════════════════════════════

(function(){
  'use strict';

  const INITIAL_BALANCE = 1000;        // 가상 잔고 시작
  const DEFAULT_FEE_RATE = 0.04;       // % (왕복 계산 시 ×2)
  const MAINT_MARGIN_RATE = 0.005;     // 유지 증거금율(참고용)
  const GUEST_MAX_POSITIONS = 3;       // 비로그인 임시 모의 포지션 허용 수

  // ───────── 상태 ─────────
  const State = {
    balance: parseFloat(localStorage.getItem('paperBalance') || INITIAL_BALANCE),
    positions: safeJSON('paperPositions', []),
    history: safeJSON('paperHistory', []),
    settings: {
      leverage: parseInt(localStorage.getItem('paperLeverage') || '3'),
      feeRate: parseFloat(localStorage.getItem('paperFeeRate') || DEFAULT_FEE_RATE),
    },
  };
  function safeJSON(key, def) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); } catch { return def; } }

  // 빌더(폼) 상태
  const Form = {
    direction: 'long',     // long | short (방향 연습)
    priceMode: 'current',  // current | limit
    leverage: State.settings.leverage,
    feeRate: State.settings.feeRate,
    slippage: 0.05,        // % 가정
    advancedOpen: localStorage.getItem('paperAdvancedOpen') === '1',
  };
  function toggleAdvanced() {
    Form.advancedOpen = !Form.advancedOpen;
    try { localStorage.setItem('paperAdvancedOpen', Form.advancedOpen ? '1' : '0'); } catch {}
    renderBuilder();
    recompute();
  }

  // 기록 필터/정렬
  let recordFilter = 'all';
  let recordSort = 'recent';

  const isLoggedIn = () => !!(window.isLoggedIn && window.isLoggedIn());

  // ───────── 저장/동기화 ─────────
  function save() {
    try {
      localStorage.setItem('paperBalance', String(State.balance));
      localStorage.setItem('paperPositions', JSON.stringify(State.positions));
      localStorage.setItem('paperHistory', JSON.stringify(State.history.slice(-200)));
      localStorage.setItem('paperLeverage', String(State.settings.leverage));
      localStorage.setItem('paperFeeRate', String(State.settings.feeRate));
    } catch {}
    syncToServer();
  }
  let _syncTimer = null;
  function syncToServer() {
    if (!isLoggedIn()) return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try {
        await fetch('/v1/paper/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ balance: State.balance, positions: State.positions, history: State.history.slice(-100), settings: State.settings }),
        });
      } catch {}
    }, 3000);
  }
  async function loadFromServer() {
    if (!isLoggedIn()) { renderAll(); return; }
    try {
      const r = await fetch('/v1/paper/state', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.success && d.data) {
        if (typeof d.data.balance === 'number') State.balance = d.data.balance;
        if (Array.isArray(d.data.positions)) State.positions = d.data.positions;
        if (Array.isArray(d.data.history)) State.history = d.data.history;
        if (d.data.settings) Object.assign(State.settings, d.data.settings);
        Form.leverage = State.settings.leverage;
        renderAll();
      }
    } catch {}
  }

  // ───────── 가격 ─────────
  function getCurrentPrice(sym) {
    sym = sym || window.curSymbol;
    if (sym === window.curSymbol && window._rt && window._rt.lastPrice) return window._rt.lastPrice;
    if (window._wlPriceCache && window._wlPriceCache[sym] && window._wlPriceCache[sym].price) return window._wlPriceCache[sym].price;
    if (sym === window.curSymbol && window.chart && window.chart.buffer && window.chart.buffer.length) {
      return window.chart.buffer.close[window.chart.buffer.length - 1];
    }
    return null;
  }

  // ───────── 포맷 ─────────
  const fmtP = p => { p = Number(p) || 0; return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toFixed(p < 1 ? 6 : 2); };
  // 숫자 input value 용: 콤마 없는 순수 숫자 문자열 (number input은 콤마를 거부함)
  const inputVal = p => { p = Number(p); if (!Number.isFinite(p) || p <= 0) return ''; return p >= 1 ? String(Math.round(p * 100) / 100) : p.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''); };
  const fmtUSD = v => { v = Number(v) || 0; return (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function symShort(sym) { return (sym || '').replace('USDT', '').replace('KRW-', ''); }

  // ───────── 계좌 계산 ─────────
  function usedMargin() { return State.positions.reduce((s, p) => s + (p.margin || 0), 0); }
  function unrealizedPnl() {
    let t = 0;
    for (const p of State.positions) { const c = getCurrentPrice(p.sym); if (c) t += pnlOf(p, c).pnl; }
    return t;
  }
  function availableBalance() { return State.balance - usedMargin(); }
  function totalEquity() { return State.balance + unrealizedPnl(); }
  function pnlOf(pos, cur) {
    const diff = pos.direction === 'long' ? (cur - pos.entry) : (pos.entry - cur);
    const pnl = diff * pos.qty;
    const pct = (diff / pos.entry) * 100;
    const roe = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
    return { pnl, pct, roe };
  }
  function stats() {
    const h = State.history.filter(x => typeof x.pnl === 'number');
    const n = h.length;
    if (!n) return { n: 0, winRate: 0, realized: 0, avgRR: 0 };
    const wins = h.filter(x => x.pnl > 0).length;
    const rrs = h.filter(x => typeof x.rr === 'number' && x.rr > 0).map(x => x.rr);
    return {
      n, winRate: Math.round(wins / n * 100),
      realized: h.reduce((a, x) => a + x.pnl, 0),
      avgRR: rrs.length ? (rrs.reduce((a, b) => a + b, 0) / rrs.length) : 0,
    };
  }

  // ───────── 레버리지 위험 등급 ─────────
  function levTier(lev) {
    if (lev >= 20) return { label: '매우 높은 위험', cls: 'mt-tier-extreme' };
    if (lev >= 10) return { label: '높은 위험', cls: 'mt-tier-high' };
    if (lev >= 5) return { label: '보통', cls: 'mt-tier-mid' };
    return { label: '낮음', cls: 'mt-tier-low' };
  }

  // ───────── 빌더 입력값 수집 ─────────
  function readForm() {
    const sym = window.curSymbol || 'BTCUSDT';
    const cur = getCurrentPrice(sym);
    const num = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) : NaN; };
    const typedRef = num('mtRefPrice');
    const cachedRef = (window._wlPriceCache && window._wlPriceCache[sym] && window._wlPriceCache[sym].price) ? window._wlPriceCache[sym].price : NaN;
    const fallbackRef = Number.isFinite(cur) && cur > 0
      ? cur
      : (Number.isFinite(typedRef) && typedRef > 0
          ? typedRef
          : (Number.isFinite(cachedRef) && cachedRef > 0 ? cachedRef : NaN));
    const refPrice = Form.priceMode === 'current'
      ? fallbackRef
      : (Number.isFinite(typedRef) && typedRef > 0 ? typedRef : fallbackRef);
    let entry = num('mtEntry');
    if (!Number.isFinite(entry) || entry <= 0) entry = refPrice; // 기본: 기준가(복구 포함)
    const amount = num('mtAmount');
    const target = num('mtTarget');
    const stop = num('mtStop');
    return {
      sym, cur, refPrice, entry, amount,
      target: Number.isFinite(target) ? target : null,
      stop: Number.isFinite(stop) ? stop : null,
      leverage: Form.leverage, feeRate: Form.feeRate, slippage: Form.slippage,
      direction: Form.direction,
    };
  }

  // ───────── 계산(예상 손익/손익비/필요승률/청산) ─────────
  function compute(f) {
    const out = { valid: false, errors: [] };
    if (!Number.isFinite(f.entry) || f.entry <= 0) out.errors.push('진입가를 확인해 주세요. 현재가를 다시 불러오는 중일 수 있습니다.');
    if (!Number.isFinite(f.amount) || f.amount <= 0) out.errors.push('투입 금액을 입력해 주세요.');
    if (f.amount > availableBalance() + 1e-9) out.errors.push(`가상 잔고가 부족합니다. 사용 가능: ${fmtUSD(availableBalance())}`);

    // 방향별 목표/손절 유효성
    if (f.target != null) {
      if (f.direction === 'long' && f.target <= f.entry) out.errors.push('매수에서는 목표가가 진입가보다 높아야 합니다.');
      if (f.direction === 'short' && f.target >= f.entry) out.errors.push('매도에서는 목표가가 진입가보다 낮아야 합니다.');
    }
    if (f.stop != null) {
      if (f.direction === 'long' && f.stop >= f.entry) out.errors.push('매수에서는 손절 기준가가 진입가보다 낮아야 합니다.');
      if (f.direction === 'short' && f.stop <= f.entry) out.errors.push('매도에서는 손절 기준가가 진입가보다 높아야 합니다.');
    }

    if (Number.isFinite(f.entry) && f.entry > 0 && Number.isFinite(f.amount) && f.amount > 0) {
      const notional = f.amount * f.leverage;     // 포지션 명목 규모
      const qty = notional / f.entry;             // 수량
      const margin = f.amount;                    // 투입 금액 = 증거금
      const feeRoundTrip = notional * (f.feeRate / 100) * 2;
      const slipCost = notional * (f.slippage / 100);

      let expGain = null, expLoss = null, rr = null;
      if (f.target != null) {
        const d = f.direction === 'long' ? (f.target - f.entry) : (f.entry - f.target);
        expGain = d * qty - feeRoundTrip - slipCost;
      }
      if (f.stop != null) {
        const d = f.direction === 'long' ? (f.entry - f.stop) : (f.stop - f.entry);
        expLoss = -(d * qty) - feeRoundTrip - slipCost; // 음수
      }
      if (expGain != null && expLoss != null && expLoss !== 0) {
        rr = Math.abs(expGain / expLoss);
      }
      const targetDist = f.target != null ? ((f.target - f.entry) / f.entry) * 100 : null;
      const stopDist = f.stop != null ? ((f.stop - f.entry) / f.entry) * 100 : null;
      // 청산가(참고): 유지증거금 반영
      const liq = f.direction === 'long'
        ? f.entry * (1 - (1 / f.leverage) * (1 - MAINT_MARGIN_RATE))
        : f.entry * (1 + (1 / f.leverage) * (1 - MAINT_MARGIN_RATE));
      const liqDist = ((liq - f.entry) / f.entry) * 100;
      const levMove = f.leverage * 1; // 1% 가격변동당 ROE ≈ leverage%

      Object.assign(out, {
        notional, qty, margin, feeRoundTrip, slipCost,
        expGain, expLoss, rr, targetDist, stopDist, liq, liqDist, levMove,
      });
    }
    out.valid = out.errors.length === 0 && Number.isFinite(f.entry) && Number.isFinite(f.amount) && f.amount > 0;
    return out;
  }

  // ═══════════════════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════════════════
  function renderAll() {
    renderAccount();
    renderLeaderboard();
    renderLoginHint();
    renderBuilder();
    recompute();           // P&L/Liq/Risk/Validation + overlay
    renderPositions();
    renderRecords();
  }

  // 2) 계좌 요약
  function renderAccount() {
    const el = document.getElementById('mtAccount');
    if (!el) return;
    const eq = totalEquity();
    const avail = availableBalance();
    const used = usedMargin();
    const unreal = unrealizedPnl();
    const cum = State.balance - INITIAL_BALANCE + unreal;
    const st = stats();
    const pc = v => v >= 0 ? 'mt-pnl-pos' : 'mt-pnl-neg';
    el.innerHTML = `
      <div class="mt-acct">
        <div class="mt-acct-top"><span class="k">가상 잔고(평가)</span><span class="v">${fmtUSD(eq)}</span></div>
        <button type="button" class="mt-acct-toggle" onclick="window.PaperTrading.toggleAcctDetail()" aria-expanded="${State._acctDetailOpen?'true':'false'}">
          계좌 상세 <span class="mt-advanced-arrow">${State._acctDetailOpen?'▲':'▼'}</span>
        </button>
        <div class="mt-acct-grid" ${State._acctDetailOpen?'':'hidden'}>
          <div class="row"><span class="k">사용 가능 잔고</span><span class="v">${fmtUSD(avail)}</span></div>
          <div class="row"><span class="k">사용 중 증거금</span><span class="v">${fmtUSD(used)}</span></div>
          <div class="row"><span class="k">평가 손익</span><span class="v ${pc(unreal)}">${unreal>=0?'+':''}${fmtUSD(unreal)}</span></div>
          <div class="row"><span class="k">누적 손익</span><span class="v ${pc(cum)}">${cum>=0?'+':''}${fmtUSD(cum)}</span></div>
          <div class="row"><span class="k">모의 거래 횟수</span><span class="v">${st.n}회</span></div>
          <div class="row"><span class="k">승률</span><span class="v">${st.winRate}%</span></div>
          <div class="row"><span class="k">평균 손익비</span><span class="v">${st.avgRR ? st.avgRR.toFixed(2) : '-'}</span></div>
        </div>
        <div class="mt-acct-foot"><button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window.PaperTrading.confirmReset()">계좌 초기화</button></div>
      </div>`;
  }

  // 대회 순위(리더보드) — 접이식(기본 접힘), 펼칠 때 서버에서 조회
  let _leaderboardOpen = false;
  let _leaderboardData = null;
  let _leaderboardLoading = false;
  function renderLeaderboard() {
    const el = document.getElementById('mtLeaderboard');
    if (!el) return;
    if (!_leaderboardOpen) {
      el.innerHTML = `
        <button type="button" class="mt-advanced-toggle" onclick="window.PaperTrading.toggleLeaderboard()">
          🏆 대회 순위 보기
          <span class="mt-advanced-arrow">▼</span>
        </button>`;
      return;
    }
    const head = `
      <button type="button" class="mt-advanced-toggle" onclick="window.PaperTrading.toggleLeaderboard()" aria-expanded="true">
        🏆 대회 순위
        <span class="mt-advanced-arrow">▲</span>
      </button>`;
    if (_leaderboardLoading) { el.innerHTML = head + '<div class="mt-state-msg">순위를 불러오는 중입니다...</div>'; return; }
    if (!_leaderboardData) { el.innerHTML = head + '<div class="mt-state-msg">순위를 불러오지 못했습니다. 다시 시도해 주세요.</div>'; return; }
    const { items, myRank } = _leaderboardData;
    if (!items || !items.length) {
      el.innerHTML = head + '<div class="mt-state-msg">아직 완료된 모의 거래가 없습니다. 매수·매도로 첫 거래를 남기면 순위에 반영됩니다.</div>';
      return;
    }
    const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r;
    const row = (it) => `
      <div class="mt-lb-row ${it.isMe ? 'me' : ''}">
        <span class="mt-lb-rank">${medal(it.rank)}</span>
        <span class="mt-lb-name">${esc(it.nickname)}${it.isMe ? ' (나)' : ''}</span>
        <span class="mt-lb-trades">${it.tradeCount}회 · 승률 ${(it.winRate || 0).toFixed(0)}%</span>
        <span class="mt-lb-pnl ${it.pnl >= 0 ? 'mt-pnl-pos' : 'mt-pnl-neg'}">${it.pnl >= 0 ? '+' : ''}${fmtUSD(it.pnl)} (${it.pnlPct >= 0 ? '+' : ''}${it.pnlPct.toFixed(1)}%)</span>
      </div>`;
    let body = items.map(row).join('');
    if (myRank && !items.some(it => it.isMe)) {
      body += `<div class="mt-lb-sep">···</div>` + row(myRank);
    }
    el.innerHTML = head + `
      <div class="mt-lb-list">
        <div class="mt-lb-row mt-lb-head"><span class="mt-lb-rank">순위</span><span class="mt-lb-name">닉네임</span><span class="mt-lb-trades">거래 · 승률</span><span class="mt-lb-pnl">누적 손익</span></div>
        ${body}
      </div>
      <p class="mt-note">상위 50명까지 표시됩니다. 진입가·종료가·수량·방향으로 서버가 재계산해 검증한 종료 거래만 불변 원장에 최초 1회 기록되고 순위에 반영됩니다. 계좌를 초기화하거나 화면 기록을 지워도 원장과 순위는 유지됩니다.</p>`;
  }
  async function toggleLeaderboard() {
    _leaderboardOpen = !_leaderboardOpen;
    if (_leaderboardOpen) await fetchLeaderboard();
    else renderLeaderboard();
  }
  async function fetchLeaderboard() {
    _leaderboardLoading = true;
    renderLeaderboard();
    try {
      const r = await fetch('/v1/paper/leaderboard?limit=50', { credentials: 'include' });
      const d = await r.json();
      _leaderboardData = (d && d.success) ? d.data : null;
    } catch { _leaderboardData = null; }
    _leaderboardLoading = false;
    renderLeaderboard();
  }

  function toggleAcctDetail() {
    State._acctDetailOpen = !State._acctDetailOpen;
    renderAccount();
  }

  // 18) 로그인 안내
  function renderLoginHint() {
    const el = document.getElementById('mtLoginHint');
    if (!el) return;
    if (isLoggedIn()) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="mt-login-hint">비로그인 상태에서는 임시 모의 포지션을 최대 ${GUEST_MAX_POSITIONS}개까지 연습할 수 있으며 저장은 제한됩니다. <button type="button" onclick="window.showAuthModal&&window.showAuthModal()">로그인</button>하면 모의 주문 기록과 복기 메모를 저장할 수 있습니다.</div>`;
  }

  // 3~7) 빌더
  function renderBuilder() {
    const el = document.getElementById('mtBuilder');
    if (!el) return;
    const sym = window.curSymbol || 'BTCUSDT';
    const curRaw = getCurrentPrice(sym);
    const cached = (window._wlPriceCache && window._wlPriceCache[sym] && window._wlPriceCache[sym].price) ? window._wlPriceCache[sym].price : null;
    const cur = (Number.isFinite(curRaw) && curRaw > 0) ? curRaw : ((Number.isFinite(cached) && cached > 0) ? cached : null);
    const lev = Form.leverage;
    const tier = levTier(lev);
    const levChips = [1, 2, 3, 5, 10].map(L =>
      `<button class="mt-lev-chip ${L === lev ? 'active' : ''}" type="button" onclick="window.PaperTrading.setLeverage(${L})">${L}x</button>`
    ).join('') + `<button class="mt-lev-chip ${![1,2,3,5,10].includes(lev) ? 'active' : ''}" type="button" onclick="window.PaperTrading.customLeverage()">직접입력</button>`;

    let levWarn = '';
    if (lev >= 20) levWarn = '<div class="mt-lev-warn extreme">매우 높은 위험: 작은 가격 변동에도 청산 위험이 큽니다. 연습 시 손실 가정을 반드시 함께 확인하세요.</div>';
    else if (lev >= 10) levWarn = '<div class="mt-lev-warn high">높은 위험: 레버리지가 높을수록 손실과 청산 위험이 커집니다.</div>';

    el.innerHTML = `
      <div class="mt-card">
        <div class="mt-card-title">모의 주문 · ${esc(symShort(sym))}/USDT</div>

        <!-- 방향(매수/매도, 클릭 즉시 체결) -->
        <div class="mt-dir mt-dir-instant">
          <button class="mt-dir-btn mt-buy-btn" type="button" onclick="window.PaperTrading.instantOrder('long')">매수</button>
          <button class="mt-dir-btn mt-sell-btn short" type="button" onclick="window.PaperTrading.instantOrder('short')">매도</button>
        </div>

        <!-- 투입 금액 -->
        <div class="mt-field">
          <label>투입 금액 (USDT, 증거금)</label>
          <input class="mt-input" id="mtAmount" type="number" inputmode="decimal" step="any" value="${inputVal(Math.min(50, Math.max(1, availableBalance())))}" oninput="window.PaperTrading.recompute()">
          <div class="mt-quick">
            ${[25,50,100].map(p => `<button class="mt-quick-btn" type="button" onclick="window.PaperTrading.setAmountPercent(${p})">${p}%</button>`).join('')}
          </div>
        </div>

        <!-- 레버리지 -->
        <div class="mt-field">
          <label>레버리지</label>
          <div class="mt-lev-chips">${levChips}</div>
        </div>
        ${levWarn}

        <div class="mt-lev-tier">예상 수량 <b id="mtQtyInline">-</b> · 위험 등급 <span class="mt-tier ${tier.cls}">${tier.label}</span></div>

        <!-- 진입 조건 -->
        <div class="mt-field">
          <label>진입 조건</label>
          <div class="mt-seg" style="margin-bottom:8px">
            <button class="mt-seg-btn ${Form.priceMode==='current'?'active':''}" type="button" onclick="window.PaperTrading.setPriceMode('current')">현재가 기준</button>
            <button class="mt-seg-btn ${Form.priceMode==='limit'?'active':''}" type="button" onclick="window.PaperTrading.setPriceMode('limit')">지정가 기준</button>
          </div>
          <input class="mt-input" id="mtRefPrice" type="number" inputmode="decimal" step="any" placeholder="기준 가격" value="${cur ? inputVal(cur) : ''}" ${Form.priceMode==='current'?'disabled':''} oninput="window.PaperTrading.recompute()">
        </div>

        <!-- 목표가 · 손절가 (선택) -->
        <div class="mt-field">
          <label>목표가 · 손절가 <span style="color:var(--color-text-muted);font-weight:400">(선택)</span></label>
          <div class="mt-grid-2">
            <input class="mt-input" id="mtTarget" type="number" inputmode="decimal" step="any" placeholder="목표가 (선택)" oninput="window.PaperTrading.recompute()">
            <input class="mt-input" id="mtStop" type="number" inputmode="decimal" step="any" placeholder="손절가 (선택)" oninput="window.PaperTrading.recompute()">
          </div>
          <div class="mt-stat-grid" id="mtTargetStats"></div>
        </div>

        <input class="mt-input" id="mtEntry" type="hidden">
        <input class="mt-input" id="mtQty" disabled hidden>
      </div>`;
  }

  // 9/10/11/8 재계산 + 차트 오버레이
  function recompute() {
    const f = readForm();
    const c = compute(f);

    // 수량 표시
    const qtyStr = c.qty ? (c.qty >= 1 ? c.qty.toFixed(4) : c.qty.toFixed(8)) : '';
    const qEl = document.getElementById('mtQty');
    if (qEl) qEl.value = qtyStr;
    const qInlineEl = document.getElementById('mtQtyInline');
    if (qInlineEl) qInlineEl.textContent = qtyStr || '-';

    // 목표/손절 거리·RR 통계
    const ts = document.getElementById('mtTargetStats');
    if (ts) {
      ts.innerHTML = `
        <div class="mt-stat"><span class="k">목표가까지 거리</span><span class="v">${c.targetDist!=null?(c.targetDist>=0?'+':'')+c.targetDist.toFixed(2)+'%':'-'}</span></div>
        <div class="mt-stat"><span class="k">손절가까지 거리</span><span class="v">${c.stopDist!=null?(c.stopDist>=0?'+':'')+c.stopDist.toFixed(2)+'%':'-'}</span></div>`;
    }

    renderValidation(c);

    // 매수/매도 버튼: 투입 금액이 유효할 때만 눌러서 즉시 체결 가능
    // (target/stop 미설정은 정상 — 목표/손절 없이도 매수/매도 가능해야 함)
    const amountOk = Number.isFinite(f.amount) && f.amount > 0 && f.amount <= availableBalance() + 1e-9 && Number.isFinite(f.entry) && f.entry > 0;
    document.querySelectorAll('.mt-buy-btn, .mt-sell-btn').forEach(b => { b.disabled = !amountOk; });

    // 진입가·목표가·손절 기준가는 항상 차트에 표시(디폴트 ON).
    drawBuilderOverlay(f, c);
    return { f, c };
  }

  // 10) 청산 위험 참고
  function renderLiqCard(f, c) {
    const el = document.getElementById('mtLiqCard');
    if (!el) return;
    if (!c.liq) { el.innerHTML = ''; return; }
    let tier;
    const ad = Math.abs(c.liqDist);
    if (ad <= 3) tier = { label: '매우 높음', cls: 'mt-tier-extreme' };
    else if (ad <= 7) tier = { label: '높음', cls: 'mt-tier-high' };
    else if (ad <= 15) tier = { label: '보통', cls: 'mt-tier-mid' };
    else tier = { label: '낮음', cls: 'mt-tier-low' };
    el.innerHTML = `
      <div class="mt-card">
        <div class="mt-card-title">청산 위험 참고</div>
        <div class="mt-liq-row"><span class="k">예상 청산가</span><span class="v">$${fmtP(c.liq)}</span></div>
        <div class="mt-liq-row"><span class="k">진입가와의 거리</span><span class="v">${c.liqDist.toFixed(2)}%</span></div>
        <div class="mt-liq-row"><span class="k">청산 위험 등급</span><span class="mt-tier ${tier.cls}">${tier.label}</span></div>
        <p class="mt-note">예상 청산가는 유지 증거금 가정에 따른 참고 값이며, 거래소별 기준·펀딩·수수료에 따라 실제와 다를 수 있습니다.</p>
      </div>`;
  }

  // 11) 리스크 체크
  function renderRiskCard(f, c) {
    const el = document.getElementById('mtRiskCard');
    if (!el) return;
    if (!c.qty) { el.innerHTML = ''; return; }
    const eq = totalEquity() || 1;
    const items = [];
    const tierBadge = (label, cls) => `<span class="mt-tier ${cls}">${label}</span>`;
    // 계좌 대비 투입 비중
    const amtPct = (f.amount / eq) * 100;
    items.push(['계좌 대비 투입 비중', `${amtPct.toFixed(1)}%`, amtPct > 50 ? ['매우 높음','mt-tier-extreme'] : amtPct > 25 ? ['높음','mt-tier-high'] : amtPct > 10 ? ['보통','mt-tier-mid'] : ['낮음','mt-tier-low']]);
    // 손절 시 손실 비중
    if (c.expLoss != null) {
      const lossPct = (Math.abs(c.expLoss) / eq) * 100;
      items.push(['손절 시 손실 비중', `${lossPct.toFixed(1)}%`, lossPct > 10 ? ['매우 높음','mt-tier-extreme'] : lossPct > 5 ? ['높음','mt-tier-high'] : lossPct > 2 ? ['보통','mt-tier-mid'] : ['낮음','mt-tier-low']]);
    } else items.push(['손절 시 손실 비중', '손절 미설정', ['매우 높음','mt-tier-extreme']]);
    // 레버리지 위험
    const lt = levTier(f.leverage);
    items.push(['레버리지 위험', `${f.leverage}x`, [lt.label, lt.cls]]);
    // 손익비
    if (c.rr != null) items.push(['손익비', c.rr.toFixed(2), c.rr >= 2 ? ['낮음','mt-tier-low'] : c.rr >= 1 ? ['보통','mt-tier-mid'] : ['높음','mt-tier-high']]);
    else items.push(['손익비', '목표·손절 필요', ['보통','mt-tier-mid']]);
    // 목표/손절 설정 여부
    const setBoth = f.target != null && f.stop != null;
    items.push(['목표·손절 설정', setBoth ? '설정됨' : '미설정', setBoth ? ['낮음','mt-tier-low'] : ['높음','mt-tier-high']]);
    // 청산가와의 거리
    if (c.liqDist != null) { const ad = Math.abs(c.liqDist); items.push(['청산가와의 거리', `${ad.toFixed(1)}%`, ad <= 3 ? ['매우 높음','mt-tier-extreme'] : ad <= 7 ? ['높음','mt-tier-high'] : ad <= 15 ? ['보통','mt-tier-mid'] : ['낮음','mt-tier-low']]); }
    el.innerHTML = `
      <div class="mt-card">
        <div class="mt-card-title">리스크 체크</div>
        <div class="mt-risk-grid">
          ${items.map(([k, v, t]) => `<div class="mt-risk-item"><span>${k} <b style="color:var(--color-text-primary)">${v}</b></span>${tierBadge(t[0], t[1])}</div>`).join('')}
        </div>
      </div>`;
  }

  // 8) 유효성/상태
  function renderValidation(c) {
    const el = document.getElementById('mtValidation');
    if (!el) return;
    if (c.errors && c.errors.length) {
      el.innerHTML = c.errors.map(e => `<span class="err">${esc(e)}</span>`).join('');
    } else if (c.valid) {
      el.innerHTML = '<span class="ok">입력값이 유효합니다. 모의 주문을 생성할 수 있습니다.</span>';
    } else {
      el.innerHTML = '<span class="ok">진입가와 투입 금액을 입력하면 예상 손익이 계산됩니다.</span>';
    }
  }

  // ───────── 폼 이벤트 ─────────
  function setDirection(d) { Form.direction = d; renderBuilder(); recompute(); }
  function setPriceMode(m) { Form.priceMode = m; renderBuilder(); recompute(); }
  function setLeverage(L) { Form.leverage = L; State.settings.leverage = L; save(); renderBuilder(); recompute(); }
  function customLeverage() {
    const v = prompt('직접 입력할 레버리지 (1~125x)', String(Form.leverage));
    if (v == null) return;
    let L = parseInt(v); if (!Number.isFinite(L)) return;
    L = Math.max(1, Math.min(125, L));
    setLeverage(L);
  }
  function setFee(v) { Form.feeRate = Math.max(0, parseFloat(v) || 0); State.settings.feeRate = Form.feeRate; recompute(); }
  function setSlippage(v) { Form.slippage = Math.max(0, parseFloat(v) || 0); recompute(); }
  function setAmountPercent(pct) {
    const avail = availableBalance();
    const amt = Math.max(0, Math.floor(avail * pct / 100 * 100) / 100);
    const el = document.getElementById('mtAmount'); if (el) el.value = amt;
    recompute();
  }

  // ───────── 13) 모의 주문 생성 ─────────
  function create() {
    const { f, c } = recompute();
    if (!c.valid) { window.showToast?.((c.errors && c.errors[0]) || '입력값을 확인해 주세요', '#921230'); return; }
    if (!isLoggedIn() && State.positions.length >= GUEST_MAX_POSITIONS) {
      window.showToast?.(`비로그인은 임시 모의 포지션 ${GUEST_MAX_POSITIONS}개까지 연습할 수 있습니다`, '#921230');
      window.showAuthModal?.();
      return;
    }
    const pos = {
      id: 'mp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      sym: f.sym, direction: f.direction,
      entry: f.entry, qty: c.qty, margin: c.margin, notional: c.notional,
      leverage: f.leverage, feeRate: f.feeRate, slippage: f.slippage,
      target: f.target, stop: f.stop, liq: c.liq,
      rrPlanned: c.rr, status: 'open',
      createdAt: Date.now(),
      review: null,
    };
    State.positions.push(pos);
    save();
    renderAll();
    window.showToast?.(`${symShort(f.sym)} ${f.direction==='long'?'매수':'매도'} 모의 주문이 체결되었습니다`, '#921230');
  }

  // 매수/매도 버튼 클릭 → 방향 설정 후 즉시 체결 (별도 생성 버튼 없이 바로 진입)
  function instantOrder(direction) {
    Form.direction = direction;
    create();
  }

  // ───────── 14) 진행 중인 모의 포지션 ─────────
  const STATUS_LABEL = { open: ['진행 중','mt-status-open'], target: ['목표 도달','mt-status-target'], stop: ['손절 도달','mt-status-stop'], manual: ['수동 종료','mt-status-manual'], expired: ['만료됨','mt-status-expired'] };

  function renderPositions() {
    const el = document.getElementById('mtPositions');
    if (!el) return;
    const open = State.positions;
    if (!open.length) { el.innerHTML = '<div class="mt-card-title">진행 중인 모의 포지션</div><div class="mt-state-msg">진행 중인 모의 포지션이 없습니다. 위에서 조건을 입력하고 모의 주문을 생성해 보세요.</div>'; return; }
    el.innerHTML = '<div class="mt-card-title">진행 중인 모의 포지션 (' + open.length + ')</div>' + open.map(p => {
      const cur = getCurrentPrice(p.sym) || p.entry;
      const { pnl, pct, roe } = pnlOf(p, cur);
      const pc = pnl >= 0 ? 'mt-pnl-pos' : 'mt-pnl-neg';
      const stt = STATUS_LABEL[p.status] || STATUS_LABEL.open;
      return `
        <div class="mt-pos ${p.direction==='short'?'short':''}">
          <div class="mt-pos-top">
            <div><span class="mt-pos-sym" onclick="window._selectSym&&window._selectSym('${p.sym}')">${symShort(p.sym)}/USDT</span><span class="mt-dir-tag ${p.direction==='short'?'short':''}">${p.direction==='long'?'매수':'매도'} ${p.leverage}x</span></div>
            <span class="mt-status ${stt[1]}">${stt[0]}</span>
          </div>
          <div class="mt-pos-grid">
            <div>진입가 <b>$${fmtP(p.entry)}</b></div><div>현재가 <b>$${fmtP(cur)}</b></div>
            <div>목표가 <b>${p.target!=null?'$'+fmtP(p.target):'-'}</b></div><div>손절가 <b>${p.stop!=null?'$'+fmtP(p.stop):'-'}</b></div>
            <div>수량 <b>${(p.qty*p.entry).toFixed(2)} USDT</b></div><div>손익비 <b>${p.rrPlanned!=null?p.rrPlanned.toFixed(2):'-'}</b></div>
            <div>평가 손익 <b class="${pc}">${pnl>=0?'+':''}${fmtUSD(pnl)}</b></div><div>수익률 <b class="${pc}">${pct>=0?'+':''}${pct.toFixed(2)}% (ROE ${roe>=0?'+':''}${roe.toFixed(1)}%)</b></div>
          </div>
          <div class="mt-pos-actions">
            <button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window._selectSym&&window._selectSym('${p.sym}')">차트에서 보기</button>
            <button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window.PaperTrading.editPosition('${p.id}')">수정</button>
            <button class="mt-btn mt-btn-secondary mt-btn-xs" type="button" onclick="window.PaperTrading.closePosition('${p.id}')">종료 처리</button>
            <button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window.PaperTrading.openReview('${p.id}','pos')">복기 작성</button>
            <button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window.PaperTrading.deletePosition('${p.id}')">삭제</button>
          </div>
        </div>`;
    }).join('');
  }

  function editPosition(id) {
    const p = State.positions.find(x => x.id === id); if (!p) return;
    const t = prompt('목표가 (비우면 제거)', p.target != null ? p.target : '');
    if (t === null) return;
    const s = prompt('손절 기준가 (비우면 제거)', p.stop != null ? p.stop : '');
    if (s === null) return;
    p.target = t === '' ? null : parseFloat(t);
    p.stop = s === '' ? null : parseFloat(s);
    if (!Number.isFinite(p.target)) p.target = null;
    if (!Number.isFinite(p.stop)) p.stop = null;
    save(); renderPositions();
    window.showToast?.('모의 포지션을 수정했습니다', '#921230');
  }

  function closePosition(id, autoStatus) {
    const idx = State.positions.findIndex(x => x.id === id); if (idx < 0) return;
    const p = State.positions[idx];
    const cur = getCurrentPrice(p.sym) || p.entry;
    const { pnl, pct } = pnlOf(p, cur);
    const status = autoStatus || 'manual';
    const rec = {
      id: p.id, sym: p.sym, direction: p.direction,
      entry: p.entry, exit: cur, qty: p.qty, qtyUsdt: p.qty * p.entry,
      leverage: p.leverage, margin: p.margin,
      target: p.target, stop: p.stop, rr: p.rrPlanned,
      pnl, pct, status,
      createdAt: p.createdAt, closedAt: Date.now(),
      holdMs: Date.now() - (p.createdAt || Date.now()),
      review: p.review || null,
    };
    State.balance += pnl; // 가상 잔고에 손익 반영 (증거금은 평가에 이미 포함)
    State.history.push(rec);
    State.positions.splice(idx, 1);
    save(); renderAll();
    window.showToast?.(`${symShort(p.sym)} 모의 포지션을 종료 처리했습니다 (${pnl>=0?'+':''}${fmtUSD(pnl)})`, '#921230');
  }

  function deletePosition(id) {
    if (!confirm('이 모의 포지션을 삭제할까요? (기록에 남기지 않습니다)')) return;
    State.positions = State.positions.filter(x => x.id !== id);
    save(); renderPositions(); renderAccount();
  }

  // 자동 상태 전이 (목표/손절 도달)
  function checkAutoStatus() {
    let changed = false;
    for (const p of State.positions) {
      if (p.status !== 'open') continue;
      const cur = getCurrentPrice(p.sym); if (!cur) continue;
      if (p.target != null && (p.direction === 'long' ? cur >= p.target : cur <= p.target)) { closePosition(p.id, 'target'); changed = true; break; }
      if (p.stop != null && (p.direction === 'long' ? cur <= p.stop : cur >= p.stop)) { closePosition(p.id, 'stop'); changed = true; break; }
    }
    if (!changed) { renderAccount(); renderPositions(); }
  }

  // ───────── 15) 모의 주문 기록 ─────────
  function filteredRecords() {
    let list = State.history.slice();
    const now = Date.now();
    const weekAgo = now - 7 * 864e5, monthAgo = now - 30 * 864e5;
    if (recordFilter === 'long') list = list.filter(h => h.direction === 'long');
    else if (recordFilter === 'short') list = list.filter(h => h.direction === 'short');
    else if (recordFilter === 'win') list = list.filter(h => h.pnl > 0);
    else if (recordFilter === 'loss') list = list.filter(h => h.pnl < 0);
    else if (recordFilter === 'week') list = list.filter(h => (h.closedAt || h.time || 0) >= weekAgo);
    else if (recordFilter === 'month') list = list.filter(h => (h.closedAt || h.time || 0) >= monthAgo);
    if (recordSort === 'recent') list.sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    else if (recordSort === 'pnl_high') list.sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
    else if (recordSort === 'loss_big') list.sort((a, b) => (a.pnl || 0) - (b.pnl || 0));
    else if (recordSort === 'hold_long') list.sort((a, b) => (b.holdMs || 0) - (a.holdMs || 0));
    else if (recordSort === 'rr_high') list.sort((a, b) => (b.rr || 0) - (a.rr || 0));
    return list;
  }
  function renderRecords() {
    const el = document.getElementById('mtRecords');
    if (!el) return;
    const filters = [['all','전체'],['long','매수'],['short','매도'],['win','수익'],['loss','손실']];
    const sorts = [['recent','최신순'],['pnl_high','손익 높은 순'],['loss_big','손실 큰 순'],['hold_long','보유 시간 긴 순'],['rr_high','손익비 높은 순']];
    const list = filteredRecords();
    let body;
    if (!State.history.length) body = '<div class="mt-state-msg">완료된 모의 주문 기록이 아직 없습니다. 모의 포지션을 종료하면 연습용 기록으로 저장됩니다.</div>';
    else if (!list.length) body = '<div class="mt-state-msg">선택한 필터에 해당하는 기록이 없습니다.</div>';
    else body = list.slice(0, 50).map(h => {
      const pc = h.pnl >= 0 ? 'mt-pnl-pos' : 'mt-pnl-neg';
      const d = new Date(h.closedAt || h.time || Date.now());
      const stt = STATUS_LABEL[h.status] || STATUS_LABEL.manual;
      return `<div class="mt-record">
        <div class="left">
          <div><span class="rsym" onclick="window._selectSym&&window._selectSym('${h.sym}')">${symShort(h.sym)}</span> · ${h.direction==='long'?'매수':'매도'} ${h.leverage||1}x · <span class="mt-status ${stt[1]}" style="height:16px;font-size:9px">${stt[0]}</span></div>
          <div class="rmeta">${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} · R:R ${h.rr!=null?h.rr.toFixed(2):'-'}${h.review?' · 복기 있음':''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="rpnl ${pc}">${h.pnl>=0?'+':''}${fmtUSD(h.pnl)}<div style="font-size:9px">${h.pct>=0?'+':''}${(h.pct||0).toFixed(2)}%</div></div>
          <button class="mt-btn mt-btn-ghost mt-btn-xs" type="button" onclick="window.PaperTrading.openReview('${h.id}','hist')">복기</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="mt-card-title">모의 주문 기록</div>
      <div class="mt-filters">${filters.map(([k,l]) => `<button class="mt-filter-chip ${recordFilter===k?'active':''}" type="button" onclick="window.PaperTrading.setFilter('${k}')">${l}</button>`).join('')}</div>
      <select class="mt-sort" onchange="window.PaperTrading.setSort(this.value)">${sorts.map(([k,l]) => `<option value="${k}" ${recordSort===k?'selected':''}>${l}</option>`).join('')}</select>
      ${body}`;
  }
  function setFilter(k) { recordFilter = k; renderRecords(); }
  function setSort(k) { recordSort = k; renderRecords(); }

  // ───────── 16) 복기 메모 모달 ─────────
  const REVIEW_TAGS = ['추세추종','역추세','돌파','눌림','과매수','과매도','변동성','계획 준수','계획 이탈'];
  let _reviewTarget = null; // {id, kind}
  function openReview(id, kind) {
    if (!isLoggedIn()) { if (typeof window.showMemberOnlyNotice === 'function') { window.showMemberOnlyNotice('복기 메모 저장'); } else { window.showToast?.('복기 메모 저장은 로그인 후 이용할 수 있습니다', '#921230'); window.showAuthModal?.(); } return; }
    const obj = kind === 'pos' ? State.positions.find(x => x.id === id) : State.history.find(x => x.id === id);
    if (!obj) return;
    _reviewTarget = { id, kind };
    const r = obj.review || {};
    const tags = Array.isArray(r.tags) ? r.tags : [];
    const root = document.getElementById('mtModalRoot');
    if (!root) return;
    const f = (label, key, ph) => `<div class="mt-field"><label>${label}</label><textarea id="mtrev_${key}" rows="2" placeholder="${ph}">${esc(r[key]||'')}</textarea></div>`;
    root.innerHTML = `
      <div class="mt-modal-overlay" onclick="if(event.target===this)window.PaperTrading.closeReview()">
        <div class="mt-modal" role="dialog" aria-label="복기 작성">
          <h3>복기 작성 — ${symShort(obj.sym)} ${obj.direction==='long'?'매수':'매도'}</h3>
          ${f('진입 이유','entryReason','어떤 근거로 진입을 연습했나요')}
          ${f('종료 이유','exitReason','왜 종료했나요')}
          ${f('잘한 점','good','계획대로 지킨 점')}
          ${f('아쉬운 점','bad','개선할 점')}
          ${f('다음에 확인할 점','next','다음 연습에서 점검할 항목')}
          <div class="mt-field"><label>사용한 지표</label><input id="mtrev_indicators" value="${esc(r.indicators||'')}" placeholder="예: 이동평균, RSI"></div>
          <div class="mt-field"><label>시장 상태</label><input id="mtrev_market" value="${esc(r.market||'')}" placeholder="예: 추세장 / 횡보장 / 변동성 확대"></div>
          <div class="mt-field"><label>감정 상태</label><input id="mtrev_emotion" value="${esc(r.emotion||'')}" placeholder="예: 차분 / 조급 / 확신"></div>
          <div class="mt-field"><label>태그</label><div class="mt-tags" id="mtrevTags">${REVIEW_TAGS.map(t => `<button type="button" class="mt-tag ${tags.includes(t)?'active':''}" data-tag="${t}" onclick="this.classList.toggle('active')">${t}</button>`).join('')}</div></div>
          <div class="mt-modal-actions">
            <button class="mt-btn mt-btn-ghost" type="button" onclick="window.PaperTrading.closeReview()">취소</button>
            <button class="mt-btn mt-btn-primary" type="button" onclick="window.PaperTrading.saveReview()">저장</button>
          </div>
        </div>
      </div>`;
  }
  function closeReview() { const root = document.getElementById('mtModalRoot'); if (root) root.innerHTML = ''; _reviewTarget = null; }
  function saveReview() {
    if (!_reviewTarget) return;
    const get = k => (document.getElementById('mtrev_' + k)?.value || '').trim();
    const tags = Array.from(document.querySelectorAll('#mtrevTags .mt-tag.active')).map(b => b.dataset.tag);
    const review = { entryReason: get('entryReason'), exitReason: get('exitReason'), good: get('good'), bad: get('bad'), next: get('next'), indicators: get('indicators'), market: get('market'), emotion: get('emotion'), tags, savedAt: Date.now() };
    const { id, kind } = _reviewTarget;
    const obj = kind === 'pos' ? State.positions.find(x => x.id === id) : State.history.find(x => x.id === id);
    if (obj) obj.review = review;
    save(); closeReview(); renderAll();
    window.showToast?.('복기 메모를 저장했습니다', '#921230');
  }

  // ───────── 17) AI 복기 요약 ─────────
  function renderAiReview() {
    const el = document.getElementById('mtAiReview');
    if (!el) return;
    const h = State.history.filter(x => typeof x.pnl === 'number');
    if (h.length < 3) { el.innerHTML = `<div class="mt-card-title">AI 복기 요약</div><div class="mt-ai"><p class="mt-ai-text">모의 주문 기록이 3건 이상 쌓이면, 반복 패턴을 바탕으로 다음 연습에서 확인할 항목을 정리해 드립니다.</p></div>`; return; }
    const recent = h.slice(-20);
    const noStop = recent.filter(x => x.stop == null).length;
    const lowRR = recent.filter(x => typeof x.rr === 'number' && x.rr < 1).length;
    const highLev = recent.filter(x => (x.leverage || 1) >= 10).length;
    const losses = recent.filter(x => x.pnl < 0).length;
    const planExit = recent.filter(x => x.status === 'stop').length;
    const points = [];
    if (noStop > 0) points.push(`최근 ${recent.length}건 중 ${noStop}건은 손절 기준가 없이 연습했습니다. 다음 연습에서는 손절 기준을 먼저 정해 보세요.`);
    if (lowRR > 0) points.push(`손익비가 1 미만인 연습이 ${lowRR}건 있었습니다. 목표가·손절가 거리를 다시 점검해 보세요.`);
    if (highLev > 0) points.push(`10x 이상 레버리지 연습이 ${highLev}건 있었습니다. 청산가와의 거리를 함께 확인하는 습관을 들여 보세요.`);
    if (planExit > 0) points.push(`손절 기준 도달로 종료된 연습이 ${planExit}건 있었습니다. 진입 근거와 손절 위치가 적절했는지 복기해 보세요.`);
    if (!points.length) points.push('최근 연습에서 손절 설정과 손익비 관리가 비교적 잘 지켜졌습니다. 같은 기준을 꾸준히 유지해 보세요.');
    el.innerHTML = `
      <div class="mt-card-title">AI 복기 요약</div>
      <div class="mt-ai">
        <p class="mt-ai-text">최근 ${recent.length}건 기준 · 손실 ${losses}건 · 손절 미설정 ${noStop}건 · 낮은 손익비 ${lowRR}건 · 높은 레버리지 ${highLev}건</p>
        <ul class="mt-ai-list">${points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        <p class="mt-ai-text" style="margin-top:6px">위 내용은 연습 기록 기반 참고 요약이며, 투자 추천이 아닙니다.</p>
      </div>`;
  }

  // ───────── 12) 차트 오버레이 (가상 진입가/목표가/손절 기준가) + 드래그 동기화 ─────────
  function clearBuilderOverlay() {
    if (!window.chart || !window.chart.overlay) return;
    window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d._calcOwner !== 'mock_builder');
    window.chart._dirty = true;
  }
  function drawBuilderOverlay(f, c) {
    if (!window.chart || !window.chart.overlay || !window.chart.addDrawing) return;
    if (f.sym !== window.curSymbol) return; // 다른 종목이면 표시 안 함
    clearBuilderOverlay();
    const add = (price, label, color, key) => {
      if (!Number.isFinite(price) || price <= 0) return;
      window.chart.addDrawing({ type: 'hline', price, color, lineWidth: 1, dashed: true, label, _calcOwner: 'mock_builder', _mockKey: key, _draggable: true });
    };
    if (Number.isFinite(f.entry)) add(f.entry, '가상 진입가 $' + fmtP(f.entry), '#921230', 'entry');
    if (f.target != null) add(f.target, '목표가 $' + fmtP(f.target), '#4A0817', 'target');
    if (f.stop != null) add(f.stop, '손절 기준가 $' + fmtP(f.stop), '#6F0E24', 'stop');
    window.chart._dirty = true;
  }
  function toggleOverlay(on) {
    if (on) { const { f, c } = recompute(); drawBuilderOverlay(f, c); }
    else clearBuilderOverlay();
  }
  // 차트에서 라인을 드래그하면 입력값 갱신 (차트 엔진이 'drawingMoved' 이벤트를 쏜다는 가정, 없으면 무시)
  function hookDrawingDrag() {
    document.addEventListener('drawingMoved', (e) => {
      const d = e.detail && e.detail.drawing;
      if (!d || d._calcOwner !== 'mock_builder') return;
      const price = e.detail.price != null ? e.detail.price : d.price;
      if (!Number.isFinite(price)) return;
      const map = { entry: 'mtEntry', target: 'mtTarget', stop: 'mtStop' };
      const id = map[d._mockKey];
      if (id) { const el = document.getElementById(id); if (el) { el.value = inputVal(price); recompute(); } }
    });
  }

  // ───────── 초기화/리셋 모달 ─────────
  function confirmReset() {
    const root = document.getElementById('mtModalRoot');
    if (!root) { if (confirm('모의 계좌를 초기화할까요? (가상 잔고 $1,000으로 리셋, 진행 중 포지션 삭제 · 거래 기록과 대회 순위는 유지됩니다)')) doReset(); return; }
    root.innerHTML = `
      <div class="mt-modal-overlay" onclick="if(event.target===this)window.PaperTrading.closeReview()">
        <div class="mt-modal" role="dialog" aria-label="계좌 초기화 확인">
          <h3>모의 계좌 초기화</h3>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);line-height:1.6">가상 잔고를 $1,000으로 되돌리고 진행 중인 모의 포지션을 모두 삭제합니다. <b style="color:var(--color-text-primary)">완료된 거래 기록과 대회 순위는 그대로 유지됩니다.</b> 계속할까요?</p>
          <div class="mt-modal-actions">
            <button class="mt-btn mt-btn-ghost" type="button" onclick="window.PaperTrading.closeReview()">취소</button>
            <button class="mt-btn mt-btn-primary" type="button" onclick="window.PaperTrading.doReset()">초기화</button>
          </div>
        </div>
      </div>`;
  }
  function doReset() {
    // history(거래 기록)는 지우지 않는다 — 대회 순위는 history 안의 실현손익
    // 합계를 기준으로 매겨지므로(백엔드 get_leaderboard), 기록을 지우면 지금까지
    // 쌓은 순위 성과가 함께 사라진다. 잔고/진행 포지션만 초기화한다.
    State.balance = INITIAL_BALANCE; State.positions = [];
    save();
    if (isLoggedIn()) { fetch('/v1/paper/reset', { method: 'POST', credentials: 'include' }).catch(() => {}); }
    closeReview(); clearBuilderOverlay(); renderAll();
    window.showToast?.('모의 계좌를 초기화했습니다', '#921230');
  }

  // ───────── 차트 마커 복원 (다른 모듈 호환용 유지) ─────────
  function restoreChartMarkers() {
    const { f, c } = recompute();
    drawBuilderOverlay(f, c);
  }

  // ───────── 외부 노출 ─────────
  window.PaperTrading = {
    create, instantOrder, recompute,
    setDirection, setPriceMode, setLeverage, customLeverage, setFee, setSlippage, setAmountPercent,
    editPosition, closePosition, deletePosition,
    setFilter, setSort,
    openReview, closeReview, saveReview,
    toggleOverlay, confirmReset, doReset,
    toggleAdvanced, toggleAcctDetail, toggleLeaderboard,
    restoreChartMarkers, renderAll,
    getState: () => State, getCurrentPrice,
  };

  // ───────── 부트스트랩 ─────────
  function init() {
    renderAll();
    hookDrawingDrag();
    // 1초 주기: 평가 손익/상태 갱신 + 자동 상태 전이
    setInterval(() => { if (document.hidden) return; checkAutoStatus(); }, 1000);
    // 현재가 변동 반영 위해 빌더 기준가 갱신(현재가 모드)
    setInterval(() => {
      if (document.hidden) return;
      if (Form.priceMode === 'current') {
        const cur = getCurrentPrice(window.curSymbol);
        const refEl = document.getElementById('mtRefPrice');
        if (Number.isFinite(cur) && cur > 0 && refEl && document.activeElement !== refEl) { refEl.value = inputVal(cur); }
      }
    }, 2000);
    // 종목 변경 시 빌더 갱신 + 오버레이 재적용
    document.addEventListener('symbolChanged', () => { renderBuilder(); recompute(); });
    const _origSel = window._selectSym;
    if (typeof _origSel === 'function' && !_origSel._mtHooked) {
      const wrapped = async function(sym) { const r = await _origSel.apply(this, arguments); setTimeout(() => { renderBuilder(); recompute(); }, 400); return r; };
      wrapped._mtHooked = true; window._selectSym = wrapped;
    }
    setTimeout(loadFromServer, 1500);
  }
  if (window.chart) init();
  else {
    const iv = setInterval(() => { if (window.chart) { clearInterval(iv); init(); } }, 200);
    setTimeout(() => clearInterval(iv), 30000);
  }
})();
