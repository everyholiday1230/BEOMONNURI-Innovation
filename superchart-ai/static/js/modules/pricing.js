/**
 * pricing.js — 요금제 페이지 (구독 플랜 / 지표 개별구매 / 포인트 충전)
 *
 * - 지표 개별가: 기본 50,000원 (서버 /v1/purchases/products 값이 있으면 우선)
 * - 묶음 할인: 3개 15% · 5개 25% · 전체 40%
 * - 구독: VIP/VVIP 월·연 (연간 = 2개월 무료)
 * - 포인트 충전: 패키지형 (많이 살수록 보너스)
 * - 실제 결제(토스)는 연동 전 → '결제 준비 중(사전 등록)' 안내
 * - 나만의 신호는 포인트 토큰 차감 방식이라 구독에 포함하지 않음
 */
(function () {
  'use strict';
  const API = window.API || '';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => '₩' + (Number(n) || 0).toLocaleString('ko-KR');

  // ── 지표 개별구매 카탈로그 (기본가 50,000). 서버 상품가가 있으면 덮어씀 ──
  const IND_BASE_PRICE = 50000;
  const INDICATORS = [
    { code: 'ultra', name: '범온 캔들', desc: '추세 방향·강도 AI 캔들' },
    { code: 'bimaco2', name: '범온 캔들 PRO', desc: '정밀 추세 분석·시그널' },
    { code: 'ob', name: '거래밀집구간', desc: '지지·저항 자동 감지' },
    { code: 'obsig', name: '범온 추세시작', desc: '추세 시작 진입 시그널' },
    { code: 'bimaco_tp', name: 'AI 목표', desc: '진입·손절·익절 자동 표시' },
    { code: 'ttr', name: '단타 익절', desc: '단기 익절 타이밍 감지' },
    { code: '_u', name: '강도측정', desc: '추세 강도 수치화' },
    { code: 'udstoch', name: '과열분석', desc: '과열·침체 구간 감지' },
    { code: 'kvo', name: '거래량분석', desc: '거래량 흐름 기반 추세' },
    { code: 'master', name: '종합매매', desc: '복합 지표 종합 시그널' },
  ];

  // ── 구독 플랜 (월/연). 연간 = 2개월 무료 ──
  const PLANS = [
    {
      code: 'vip', name: 'VIP', monthly: 29000, yearly: 290000, accent: '#921230',
      highlight: '전 지표 + AI 무제한',
      features: [
        '범온 독자 지표 <b>전체</b> (범온캔들·거래밀집·AI목표·강도측정·과열분석·종합매매 등)',
        '회원 지표 전체 (범온MA·자동추세선·매매압력·자금흐름 등)',
        'AI 분석·예측·챗 <b>무제한</b>',
        '모의주문·알림·차트설정 저장',
      ],
    },
    {
      code: 'vvip', name: 'VVIP', monthly: 49000, yearly: 490000, accent: '#6A1E33',
      highlight: 'VIP 전체 + 우선 혜택',
      features: [
        '<b>VIP 플랜 전체 기능 포함</b>',
        '자동매매 시그널 (Paper Trading)',
        '우선 고객 지원',
        '향후 프리미엄 신규 기능 우선 제공',
      ],
    },
  ];

  // ── 포인트 충전 패키지 (많이 살수록 보너스 P) ──
  const POINT_PACKAGES = [
    { price: 10000, base: 10000, bonus: 0 },
    { price: 30000, base: 30000, bonus: 1500 },
    { price: 50000, base: 50000, bonus: 4000 },
    { price: 100000, base: 100000, bonus: 12000 },
    { price: 300000, base: 300000, bonus: 45000 },
  ];

  // 묶음 할인율
  function bundleRate(n) {
    if (n >= 10) return 0.40; // 전체(10개)
    if (n >= 5) return 0.25;
    if (n >= 3) return 0.15;
    return 0;
  }

  const state = { tab: 'sub', cycle: 'monthly', selected: new Set(), prices: {} };

  function open() {
    const el = document.getElementById('pricingPopup');
    if (!el) return;
    el.classList.add('open');
    _loadPrices().then(render);
  }
  function close() {
    document.getElementById('pricingPopup')?.classList.remove('open');
  }

  async function _loadPrices() {
    try {
      const r = await (window.dedupFetch ? window.dedupFetch(API + '/v1/purchases/products') : fetch(API + '/v1/purchases/products', { credentials: 'include' }));
      const d = (await r.json())?.data || [];
      const m = {};
      d.forEach(p => { if (p.indicator_code) m[p.indicator_code] = p.price; });
      state.prices = m;
    } catch (_) { state.prices = {}; }
  }
  function indPrice(code) {
    const p = state.prices[code];
    return (typeof p === 'number' && p > 0) ? p : IND_BASE_PRICE;
  }

  function render() {
    const body = document.getElementById('pricingBody');
    if (!body) return;
    const tabBtn = (k, label) => `<button type="button" class="pr-tab ${state.tab === k ? 'active' : ''}" data-pr-tab="${k}">${label}</button>`;
    let inner = '';
    if (state.tab === 'sub') inner = renderSub();
    else if (state.tab === 'ind') inner = renderInd();
    else inner = renderPoints();
    body.innerHTML = `
      <div class="pr-tabs">
        ${tabBtn('sub', '구독 플랜')}
        ${tabBtn('ind', '지표 개별구매')}
        ${tabBtn('points', '포인트 충전')}
      </div>
      <div class="pr-tabbody">${inner}</div>
      <p class="pr-disclaimer">표시 가격은 부가세 포함 예정가이며 정식 결제 오픈 시 확정됩니다. 결제 시스템 준비 중 — 사전 등록하시면 오픈 시 안내드립니다. 나만의 신호는 포인트(토큰) 차감 방식으로 별도 이용합니다.</p>`;
  }

  function renderSub() {
    const cy = state.cycle;
    const toggle = `
      <div class="pr-cycle">
        <button type="button" class="pr-cycle-btn ${cy === 'monthly' ? 'active' : ''}" data-pr-cycle="monthly">월간</button>
        <button type="button" class="pr-cycle-btn ${cy === 'yearly' ? 'active' : ''}" data-pr-cycle="yearly">연간 <span class="pr-save">2개월 무료</span></button>
      </div>`;
    const cards = PLANS.map(p => {
      const price = cy === 'yearly' ? p.yearly : p.monthly;
      const per = cy === 'yearly' ? '/년' : '/월';
      const monthlyEq = cy === 'yearly' ? `<div class="pr-monthly-eq">월 ${won(Math.round(p.yearly / 12))} 상당</div>` : '';
      return `
        <div class="pr-plan" style="--accent:${p.accent}">
          <div class="pr-plan-name">${esc(p.name)}</div>
          <div class="pr-plan-tag">${esc(p.highlight)}</div>
          <div class="pr-plan-price">${won(price)}<span class="pr-per">${per}</span></div>
          ${monthlyEq}
          <ul class="pr-feat">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
          <button type="button" class="pr-buy" data-pr-plan="${p.code}" data-pr-cycle-sel="${cy}">${esc(p.name)} 구독하기</button>
        </div>`;
    }).join('');
    return toggle + `<div class="pr-plans">${cards}</div>`;
  }

  function renderInd() {
    const sel = state.selected;
    const rows = INDICATORS.map(it => {
      const checked = sel.has(it.code) ? 'checked' : '';
      return `
        <label class="pr-ind ${checked ? 'sel' : ''}">
          <input type="checkbox" data-pr-ind="${it.code}" ${checked}>
          <span class="pr-ind-info"><b>${esc(it.name)}</b><span class="pr-ind-desc">${esc(it.desc)}</span></span>
          <span class="pr-ind-price">${won(indPrice(it.code))}</span>
        </label>`;
    }).join('');
    const n = sel.size;
    let subtotal = 0; sel.forEach(c => subtotal += indPrice(c));
    const rate = bundleRate(n);
    const discount = Math.round(subtotal * rate);
    const total = subtotal - discount;
    const nextTier = n < 3 ? `3개 선택 시 <b>15% 할인</b>` : n < 5 ? `5개 선택 시 <b>25% 할인</b>` : n < 10 ? `전체(10개) 선택 시 <b>40% 할인</b>` : '';
    return `
      <div class="pr-bundle-note">여러 지표를 함께 구매하면 <b>묶음 할인</b>: 3개 15% · 5개 25% · 전체 40%</div>
      <div class="pr-ind-list">${rows}</div>
      <div class="pr-summary">
        <div class="pr-sum-row"><span>선택</span><span>${n}개</span></div>
        <div class="pr-sum-row"><span>합계</span><span>${won(subtotal)}</span></div>
        <div class="pr-sum-row ${discount > 0 ? 'on' : ''}"><span>묶음 할인 ${rate ? '(' + Math.round(rate * 100) + '%)' : ''}</span><span>- ${won(discount)}</span></div>
        <div class="pr-sum-total"><span>결제 금액</span><span>${won(total)}</span></div>
        ${nextTier ? `<div class="pr-next-tier">💡 ${nextTier}</div>` : ''}
        <button type="button" class="pr-buy" data-pr-buy-ind ${n === 0 ? 'disabled' : ''}>${n === 0 ? '지표를 선택하세요' : n + '개 구매하기 · ' + won(total)}</button>
      </div>`;
  }

  function renderPoints() {
    const cards = POINT_PACKAGES.map(p => {
      const totalP = p.base + p.bonus;
      const bonusPct = p.base > 0 ? Math.round(p.bonus / p.base * 100) : 0;
      return `
        <div class="pr-pt-card ${p.bonus > 0 ? 'has-bonus' : ''}">
          <div class="pr-pt-amount">${(totalP).toLocaleString('ko-KR')} P</div>
          ${p.bonus > 0 ? `<div class="pr-pt-bonus">+${p.bonus.toLocaleString('ko-KR')}P 보너스 (${bonusPct}%)</div>` : '<div class="pr-pt-bonus muted">기본 적립</div>'}
          <div class="pr-pt-price">${won(p.price)}</div>
          <button type="button" class="pr-buy pr-buy-sm" data-pr-point="${p.price}">충전하기</button>
        </div>`;
    }).join('');
    return `
      <div class="pr-bundle-note">포인트는 <b>나만의 신호</b> 등 토큰 차감 기능에 사용됩니다. 많이 충전할수록 보너스 포인트가 늘어납니다.</div>
      <div class="pr-pt-grid">${cards}</div>`;
  }

  function comingSoon(label) {
    if (typeof window.showComingSoonNotice === 'function') window.showComingSoonNotice(label);
    else if (typeof window.showToast === 'function') window.showToast('결제 시스템이 곧 오픈됩니다. 사전 등록하시면 오픈 시 안내드립니다.', '#D8B66A');
  }

  document.addEventListener('click', function (e) {
    const t = e.target;
    if (t.closest('[data-pr-close]')) { close(); return; }
    const tab = t.closest('[data-pr-tab]'); if (tab) { state.tab = tab.dataset.prTab; render(); return; }
    const cyc = t.closest('[data-pr-cycle]'); if (cyc) { state.cycle = cyc.dataset.prCycle; render(); return; }
    const plan = t.closest('[data-pr-plan]'); if (plan) { comingSoon(plan.dataset.prPlan.toUpperCase() + ' 구독'); return; }
    const buyInd = t.closest('[data-pr-buy-ind]'); if (buyInd) { if (state.selected.size) comingSoon('지표 구매'); return; }
    const pt = t.closest('[data-pr-point]'); if (pt) { comingSoon('포인트 충전'); return; }
    // 오버레이 바깥 클릭 닫기
    if (t.classList && t.classList.contains('nav-popup-overlay') && t.id === 'pricingPopup') { close(); return; }
  });
  document.addEventListener('change', function (e) {
    const cb = e.target.closest('[data-pr-ind]');
    if (cb) {
      const code = cb.dataset.prInd;
      if (cb.checked) state.selected.add(code); else state.selected.delete(code);
      render();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  window.openPricing = open;
})();
