/**
 * points-ui.js — 범온 포인트 · 지인 초대 허브 (#points)
 *
 * 서비스 기능 이용 포인트(현금 아님)와 지인 초대 보상을 관리하는 사용자 패널.
 * 실제 백엔드: /v1/referral/my-code, /v1/referral/points, /v1/referral/history,
 * /v1/referral/apply. 포인트 상점/구매·소멸 버킷·부정사용은 Phase 2(백엔드)로
 * 분리하고, 여기서는 가짜 수치를 만들지 않고 정직하게 안내한다.
 * 브랜드 컬러만, 파란색/네온/이모지/현금·도박 연출 금지.
 */

(function() {
  'use strict';

  const API = window.API || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const fmtP = n => (Number(n) || 0).toLocaleString('en-US');
  const isLoggedIn = () => !!(window.isLoggedIn && window.isLoggedIn());

  async function fetchJson(url, opts) {
    try {
      const req = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await req(url, Object.assign({ credentials: 'include' }, opts || {}));
      if (!r || !r.ok) return null;
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (!/application\/json/i.test(ct)) return null;
      return await r.json().catch(() => null);
    } catch { return null; }
  }

  // 상태
  const P = { sec: 'mine', code: '', points: 0, usable: 0, expiring: 0, soonest: null, monthEarned: 0, monthUsed: 0, referrals: 0, paid: 0, history: [], shop: [], shopCat: 'ai', loaded: false, error: false };
  let _busy = false;

  // 포인트 상점 카탈로그(운영 설정 전제, 표시용 — 실제 구매는 Phase 2)
  const SHOP = [
    { cat: 'ai', name: 'AI 심화 분석 1회', desc: '현재 종목을 더 깊이 분석하는 AI 이용권 1회', cost: 1000, period: '1회' },
    { cat: 'ai', name: 'AI 리스크 체크 1회', desc: '포지션·변동성 기반 리스크 점검 1회', cost: 800, period: '1회' },
    { cat: 'indicator', name: '범온 캔들 PRO 7일', desc: '범온 캔들 PRO 지표 7일 이용', cost: 3000, period: '7일' },
    { cat: 'preset', name: '프리미엄 프리셋 30일', desc: '고급 프리셋 구성 30일 이용', cost: 2500, period: '30일' },
    { cat: 'chart', name: '히트맵 상세 보기 24시간', desc: '히트맵 상세 모드 24시간 이용', cost: 500, period: '24시간' },
    { cat: 'paper', name: '모의주문 저장 슬롯 +10', desc: '모의 포지션 저장 슬롯 10개 확장', cost: 1500, period: '영구' },
    { cat: 'data', name: '관심 종목 슬롯 확장', desc: '관심 종목 저장 개수 확장', cost: 1200, period: '영구' },
  ];
  const SHOP_CATS = [['ai','AI 분석'],['indicator','지표'],['preset','프리셋'],['chart','차트 기능'],['paper','모의주문'],['data','데이터 기능'],['etc','기타']];

  const LEDGER_LABEL = {
    referral_signup: '레퍼럴 지급', referral_payment: '레퍼럴 지급', signup_bonus: '가입 축하 포인트',
    admin_adjust: '관리자 지급', event: '이벤트 지급', use: '사용', cancel: '취소', revoke: '회수', expire: '소멸', purchase_cancel: '구매 취소',
  };

  function setStatus(kind) {
    const b = document.getElementById('ptStatusBadge'); if (!b) return;
    const map = { loading: ['불러오는 중', 'loading'], ok: ['정상', 'ok'], guest: ['로그인 필요', 'guest'], error: ['오류', 'error'] };
    const s = map[kind] || map.loading; b.textContent = s[0]; b.setAttribute('data-state', s[1]);
  }

  // ───────── 데이터 로드 ─────────
  async function load() {
    P.error = false;
    if (!isLoggedIn()) { setStatus('guest'); render(); updateChip(); return; }
    setStatus('loading');
    try {
      const [c, sum, hist, shop] = await Promise.all([
        fetchJson(`${API}/v1/referral/my-code`),
        fetchJson(`${API}/v1/points/summary`),
        fetchJson(`${API}/v1/referral/history`),
        fetchJson(`${API}/v1/points/shop`),
      ]);
      if (c && c.success && c.data) P.code = c.data.code || '';
      if (sum && sum.success && sum.data) {
        const d = sum.data;
        P.points = d.points || 0; P.usable = d.usable || 0; P.expiring = d.expiring || 0;
        P.soonest = d.soonest_expire || null; P.monthEarned = d.month_earned || 0; P.monthUsed = d.month_used || 0;
      } else {
        // /v1/points 미배포 시 기존 /referral/points 로 폴백
        const pts = await fetchJson(`${API}/v1/referral/points`);
        if (pts && pts.success && pts.data) { P.points = pts.data.points || 0; P.usable = pts.data.points || 0; P.referrals = pts.data.referrals || 0; P.paid = pts.data.paid_referrals || 0; }
        else P.error = true;
      }
      // 레퍼럴 집계(있으면)
      const pts2 = await fetchJson(`${API}/v1/referral/points`);
      if (pts2 && pts2.success && pts2.data) { P.referrals = pts2.data.referrals || 0; P.paid = pts2.data.paid_referrals || 0; }
      if (hist && hist.success && hist.data) P.history = Array.isArray(hist.data.history) ? hist.data.history : [];
      if (shop && shop.success && shop.data && Array.isArray(shop.data.items) && shop.data.items.length) P.shop = shop.data.items;
      P.loaded = true;
      setStatus(P.error ? 'error' : 'ok');
    } catch (e) { P.error = true; setStatus('error'); }
    render();
    updateChip();
  }

  function updateChip() {
    const chip = document.getElementById('pointChip'), val = document.getElementById('pointChipVal');
    if (!chip) return;
    if (isLoggedIn()) { chip.classList.remove('d-none'); if (val) val.textContent = fmtP(P.points); }
    else chip.classList.add('d-none');
  }

  // ───────── 렌더 ─────────
  function render() {
    const el = document.getElementById('ptSection'); if (!el) return;
    // 서브탭 active 동기화
    document.querySelectorAll('#ptSubnav .pt-subtab').forEach(t => {
      const on = t.dataset.sec === P.sec; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on));
    });
    if (!isLoggedIn() && ['mine','ledger','invite','invites'].includes(P.sec)) {
      el.innerHTML = `<div class="pt-state-msg">로그인하면 보유 포인트, 적립·사용 내역, 지인 초대 현황을 확인할 수 있습니다.
        <div style="margin-top:10px"><button class="pt-btn pt-btn-primary pt-btn-xs" type="button" onclick="window.showAuthModal&&window.showAuthModal()">로그인</button></div></div>`;
      return;
    }
    if (P.error && ['mine','ledger'].includes(P.sec)) {
      el.innerHTML = `<div class="pt-state-msg">포인트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        <div style="margin-top:10px"><button class="pt-btn pt-btn-secondary pt-btn-xs" type="button" onclick="window.PointsUI.reload()">데이터 다시 확인</button></div></div>`;
      return;
    }
    const fn = { mine: secMine, usage: secUsage, shop: secShop, indicators: secIndicators, aipass: secAiPass, invite: secInvite, invites: secInvites, ledger: secLedger, policy: secPolicy };
    el.innerHTML = (fn[P.sec] || secMine)();
  }

  // 1) 내 포인트
  function secMine() {
    const earn = P.history.filter(h => h.amount > 0).slice(0, 5);
    const use = P.history.filter(h => h.amount < 0).slice(0, 5);
    const row = h => `<div class="pt-row"><div class="left"><div class="rtype">${esc(LEDGER_LABEL[h.reason] || h.reason || '포인트')}</div><div class="rnote">${esc(h.note || '')} · ${esc((h.date || '').slice(0, 10))}</div></div><div class="ramt ${h.amount >= 0 ? 'pt-amt-plus' : 'pt-amt-minus'}">${h.amount >= 0 ? '+' : ''}${fmtP(h.amount)} P</div></div>`;
    return `
      <div class="pt-balance">
        <div class="pt-balance-top"><span class="k">보유 포인트</span><span class="v">${fmtP(P.points)} P</span></div>
        <div class="pt-balance-grid">
          <div class="row"><span class="k">사용 가능 포인트</span><span class="v">${fmtP(P.usable || P.points)} P</span></div>
          <div class="row"><span class="k">소멸 예정 포인트(30일)</span><span class="v">${fmtP(P.expiring)} P</span></div>
          <div class="row"><span class="k">이번 달 적립</span><span class="v">${fmtP(P.monthEarned)} P</span></div>
          <div class="row"><span class="k">이번 달 사용</span><span class="v">${fmtP(P.monthUsed)} P</span></div>
        </div>
        ${P.expiring > 0 && P.soonest ? `<div class="pt-expire-note">${fmtP(P.expiring)} P가 ${esc((P.soonest || '').slice(0, 10))}에 소멸 예정입니다.</div>` : ''}
      </div>
      <div class="pt-card"><div class="pt-card-title">최근 적립 내역</div>${earn.length ? earn.map(row).join('') : '<div class="pt-state-msg">적립 내역이 없습니다.</div>'}</div>
      <div class="pt-card"><div class="pt-card-title">최근 사용 내역</div>${use.length ? use.map(row).join('') : '<div class="pt-state-msg">사용 내역이 없습니다.</div>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pt-btn pt-btn-secondary" type="button" onclick="window.PointsUI.go('shop')">포인트 사용하기</button>
        <button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.go('ledger')">포인트 내역 보기</button>
        <button class="pt-btn pt-btn-primary" type="button" onclick="window.PointsUI.go('invite')">지인 초대하고 포인트 받기</button>
      </div>
      <details class="pt-card pt-policy-toggle" style="margin-top:12px">
        <summary class="pt-policy-summary">보상 정책 안내 보기</summary>
        <ul class="pt-policy-list" style="margin-top:10px">
          <li>가입 축하 포인트 1,000 P (유효기간 30일)</li>
          <li>추천인 보상 1,000 P · 초대받은 사용자의 이메일 인증 완료 시 (유효기간 90일)</li>
          <li>첫 결제 추가 보상 5,000 P · 초대받은 사용자의 첫 결제 완료 시</li>
          <li>월 최대 레퍼럴 보상 50,000 P · 포인트는 유효기간이 짧은 순으로 사용</li>
        </ul>
        <p class="pt-mini-note">포인트는 현금으로 환불 또는 출금할 수 없으며, 범온 슈퍼차트 AI 서비스 내 기능 이용에만 사용할 수 있습니다.</p>
      </details>`;
  }
  function isThisMonth(dateStr) { if (!dateStr) return false; const d = new Date(dateStr), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }

  // 2) 포인트 사용처
  function secUsage() {
    const items = [
      '유료 지표 이용 (1일/7일/30일/영구)', 'AI 심화 분석 이용', '프리셋 구성 이용', '고급 히트맵 상세 보기',
      '인기 TOP 상세 보기', '추세강도 상세 분석', '포지션 분석 상세 보기', '모의주문 저장 슬롯 확장', '관심 종목 슬롯 확장', '차트 저장·공유 기능',
    ];
    return `<div class="pt-card"><div class="pt-card-title">포인트 사용처</div>
      <ul class="pt-policy-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      <p class="pt-mini-note">포인트는 범온 슈퍼차트 AI 서비스 내 기능 이용에만 사용됩니다.</p></div>`;
  }

  // 3) 포인트 상점
  function secShop() {
    const catalog = P.shop && P.shop.length ? P.shop : SHOP.map(s => ({ ...s, code: '' }));
    const list = catalog.filter(s => s.cat ? s.cat === P.shopCat : s.category === P.shopCat);
    const liveNote = (P.shop && P.shop.length) ? '' : '<p class="pt-phase2">상품 카탈로그를 불러오지 못해 기본 구성을 표시합니다.</p>';
    return `
      <div class="pt-shop-cats">${SHOP_CATS.map(([k, l]) => `<button class="pt-cat-chip ${P.shopCat === k ? 'active' : ''}" type="button" data-shopcat="${k}">${l}</button>`).join('')}</div>
      ${list.length ? list.map(prodCard).join('') : '<div class="pt-state-msg">해당 카테고리의 상품이 준비 중입니다.</div>'}
      ${liveNote}`;
  }
  function prodCard(p) {
    const name = p.name, cost = p.cost, desc = p.description || p.desc || '', period = p.period || '', code = p.code || '';
    const short = isLoggedIn() && (P.usable || P.points) < cost;
    const onclick = code
      ? `window.PointsUI.buyCode('${esc(code)}','${esc(name)}', ${cost})`
      : `window.PointsUI.buy('${esc(name)}', ${cost})`;
    return `<div class="pt-prod">
      <div class="pt-prod-info"><div class="pt-prod-name">${esc(name)}</div><div class="pt-prod-desc">${esc(desc)}</div><div class="pt-prod-meta">이용 기간 ${esc(period)}</div></div>
      <div class="pt-prod-right"><div class="pt-prod-price">${fmtP(cost)} P</div>${short ? '<div class="pt-prod-short">포인트 부족</div>' : ''}
        <button class="pt-btn pt-btn-primary pt-btn-xs" type="button" style="margin-top:6px" onclick="${onclick}">구매</button></div>
    </div>`;
  }

  // 4) 지표 구매
  function secIndicators() {
    const inds = [
      { name: '범온 캔들 PRO', cat: 'AI 캔들', desc: 'AI 기반 캔들 해석 강화', costs: [['1일', 300], ['7일', 1500], ['30일', 4500], ['영구', 20000]] },
      { name: '자동추세선', cat: '추세', desc: '주요 추세 자동 표시', costs: [['7일', 1000], ['30일', 3000]] },
      { name: '거래밀집구간', cat: '거래량', desc: '가격 밀집 구간 시각화', costs: [['7일', 1200], ['30일', 3600]] },
      { name: '범온 MACD', cat: '모멘텀', desc: '범온 보정 MACD', costs: [['7일', 800], ['30일', 2400]] },
    ];
    return `${inds.map(indCard).join('')}<p class="pt-phase2">지표 포인트 구매·이용 기간 적용은 Phase 2 연동 후 활성화됩니다. 현재는 지표 구성과 포인트 가격을 안내합니다.</p>`;
  }
  function indCard(ind) {
    return `<div class="pt-card">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="pt-prod-name">${esc(ind.name)}</div><span class="pt-badge">${esc(ind.cat)}</span></div>
      <div class="pt-prod-desc">${esc(ind.desc)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${ind.costs.map(([per, cost]) => `<button class="pt-btn pt-btn-secondary pt-btn-xs" type="button" onclick="window.PointsUI.buy('${esc(ind.name)} ${per}', ${cost})">${per} · ${fmtP(cost)} P</button>`).join('')}
      </div>
      <div class="pt-prod-meta" style="margin-top:6px">현재 이용 상태: 연동 예정</div>
    </div>`;
  }

  // 5) AI 분석 이용권
  function secAiPass() {
    return `<div class="pt-card"><div class="pt-card-title">AI 분석 이용권</div>
      <p class="pt-mini-note">무료 분석 횟수를 모두 사용했을 때 포인트로 AI 심화 분석을 이용할 수 있습니다.</p>
      <div class="pt-prod" style="margin-top:10px">
        <div class="pt-prod-info"><div class="pt-prod-name">AI 심화 분석 1회</div><div class="pt-prod-desc">현재 종목을 더 깊이 분석하는 AI 이용권</div></div>
        <div class="pt-prod-right"><div class="pt-prod-price">1,000 P</div><button class="pt-btn pt-btn-primary pt-btn-xs" type="button" style="margin-top:6px" onclick="window.PointsUI.buyCode('ai_deep_1','AI 심화 분석 1회', 1000)">이용하기</button></div>
      </div>
      <p class="pt-mini-note">분석 결과는 참고용 정보이며, 매매를 권유하지 않습니다.</p>
      <p class="pt-phase2">포인트 차감 후 AI 심화 분석 실행은 Phase 2 연동 후 활성화됩니다.</p></div>`;
  }

  // 6) 지인 초대
  function secInvite() {
    const origin = window.location.origin;
    const code = P.code || '코드 준비 중';
    const link = P.code ? `${origin}?ref=${P.code}` : '';
    return `<div class="pt-invite">
      <div class="pt-card-title">지인 초대</div>
      <p class="pt-mini-note">지인을 초대하고 함께 포인트를 받아보세요.</p>
      <div style="margin-top:10px"><div class="pt-mini-note">내 추천인 코드</div>
        <div class="pt-invite-code"><input id="ptCodeInput" value="${esc(code)}" readonly aria-label="내 추천인 코드"><button class="pt-btn pt-btn-secondary pt-btn-xs" type="button" onclick="window.PointsUI.copy('${esc(P.code)}','코드')">코드 복사</button></div>
      </div>
      <div><div class="pt-mini-note">내 초대 링크</div>
        <div class="pt-invite-code"><input id="ptLinkInput" value="${esc(link)}" readonly aria-label="내 초대 링크"><button class="pt-btn pt-btn-secondary pt-btn-xs" type="button" onclick="window.PointsUI.copy('${esc(link)}','초대 링크')">링크 복사</button></div>
      </div>
      <div class="pt-share-grid">
        <button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.share('kakao')">카카오톡으로 공유</button>
        <button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.share('sms')">문자로 공유</button>
        <button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.share('email')">이메일로 공유</button>
        <button class="pt-btn pt-btn-secondary" type="button" onclick="window.PointsUI.go('invites')">초대 현황 보기</button>
      </div>
    </div>
    <div class="pt-card">
      <div class="pt-card-title">초대 보상</div>
      <div class="pt-balance-grid">
        <div class="row"><span class="k">이번 달 초대 수</span><span class="v">연동 예정</span></div>
        <div class="row"><span class="k">누적 초대 수</span><span class="v">${fmtP(P.referrals)}</span></div>
        <div class="row"><span class="k">지급 완료 포인트</span><span class="v">연동 예정</span></div>
        <div class="row"><span class="k">지급 대기 포인트</span><span class="v">연동 예정</span></div>
      </div>
      <ul class="pt-policy-list" style="margin-top:10px">
        <li>가입 축하 포인트: 추천 코드로 가입한 사용자에게 1,000 P (유효기간 30일)</li>
        <li>추천인 보상: 초대받은 사용자의 이메일 인증 완료 시 추천인에게 1,000 P (유효기간 90일)</li>
        <li>첫 결제 추가 보상: 초대받은 사용자의 첫 결제 완료 시 추천인에게 추가 5,000 P</li>
        <li>월 최대 레퍼럴 보상: 50,000 P</li>
      </ul>
      <p class="pt-mini-note">포인트는 유효기간이 짧은 포인트부터 사용됩니다. 부정한 방법으로 포인트를 적립한 경우 포인트가 회수되거나 서비스 이용이 제한될 수 있습니다.</p>
      <p class="pt-mini-note">포인트는 현금으로 환불 또는 출금할 수 없으며, 범온 슈퍼차트 AI 서비스 내 기능 이용에만 사용할 수 있습니다.</p>
    </div>`;
  }

  // 7) 초대 현황
  function secInvites() {
    // 상세 초대 목록은 백엔드 엔드포인트(Phase 2) 필요 — 현재는 집계만 실제 표시
    return `<div class="pt-card">
      <div class="pt-card-title">초대 현황</div>
      <div class="pt-balance-grid">
        <div class="row"><span class="k">누적 초대 수</span><span class="v">${fmtP(P.referrals)}</span></div>
        <div class="row"><span class="k">유료 전환 수</span><span class="v">${fmtP(P.paid)}</span></div>
      </div>
      <p class="pt-phase2">초대일·가입자(이메일 마스킹)·가입 상태·보상 조건·지급 상태 등 상세 목록은 초대 현황 백엔드 연동(Phase 2) 후 표시됩니다. 초대받은 사용자의 이메일은 ab***@example.com 형태로 마스킹되어 표시됩니다.</p>
    </div>`;
  }

  // 8) 포인트 내역
  function secLedger() {
    if (!P.history.length) return '<div class="pt-state-msg">포인트 내역이 없습니다.</div>';
    return `<div class="pt-card"><div class="pt-card-title">포인트 내역</div>
      ${P.history.map(h => `<div class="pt-row"><div class="left"><div class="rtype">${esc(LEDGER_LABEL[h.reason] || h.reason || '포인트')}</div><div class="rnote">${esc(h.note || '')} · ${esc((h.date || '').slice(0, 16).replace('T', ' '))} · 잔여 ${fmtP(h.balance)} P</div></div><div class="ramt ${h.amount >= 0 ? 'pt-amt-plus' : 'pt-amt-minus'}">${h.amount >= 0 ? '+' : ''}${fmtP(h.amount)} P</div></div>`).join('')}
    </div>`;
  }

  // 9) 보상 정책
  function secPolicy() {
    return `<div class="pt-card"><div class="pt-card-title">보상 정책</div>
      <ul class="pt-policy-list">
        <li>가입 축하 포인트: 추천 코드로 가입하면 가입자에게 포인트가 지급됩니다.</li>
        <li>초대 보상: 초대받은 사용자가 조건을 충족하면 추천인에게 포인트가 지급됩니다.</li>
        <li>첫 결제 추가 보상: 초대받은 사용자의 첫 결제 완료 시 추천인에게 추가 포인트가 지급됩니다.</li>
        <li>포인트는 유효기간이 짧은 포인트부터 사용됩니다.</li>
        <li>부정 사용(자가 추천, 반복 가입, 동일 기기·IP 등)이 확인되면 보상이 보류·제외되거나 포인트가 회수될 수 있습니다.</li>
      </ul>
      <p class="pt-disclaimer" style="margin-top:12px;border-top:0;padding-top:0">포인트는 현금으로 환불 또는 출금할 수 없습니다. 포인트는 범온 슈퍼차트 AI 서비스 내 기능 이용에만 사용할 수 있습니다. 부정한 방법으로 적립한 포인트는 회수될 수 있습니다. 레퍼럴 보상은 운영 정책에 따라 지급, 보류, 취소될 수 있습니다.</p>
    </div>`;
  }

  // ───────── 액션 ─────────
  function go(sec) { P.sec = sec; render(); }
  function copy(text, label) {
    if (!text) { window.showToast && window.showToast(label + ' 준비 중입니다', '#921230'); return; }
    try { navigator.clipboard.writeText(text); window.showToast && window.showToast(label + '을(를) 복사했습니다', '#921230'); }
    catch { window.showToast && window.showToast('복사에 실패했습니다', '#921230'); }
  }
  function share(kind) {
    const origin = window.location.origin;
    const link = P.code ? `${origin}?ref=${P.code}` : origin;
    const msg = `범온 슈퍼차트 AI에 초대합니다. 추천 코드: ${P.code || ''}\n${link}`;
    if (kind === 'sms') { location.href = `sms:?body=${encodeURIComponent(msg)}`; return; }
    if (kind === 'email') { location.href = `mailto:?subject=${encodeURIComponent('범온 슈퍼차트 AI 초대')}&body=${encodeURIComponent(msg)}`; return; }
    if (kind === 'kakao') {
      if (window.Kakao && window.Kakao.Share) { try { window.Kakao.Share.sendDefault({ objectType: 'text', text: msg, link: { mobileWebUrl: link, webUrl: link } }); return; } catch (e) {} }
      copy(link, '초대 링크'); window.showToast && window.showToast('카카오톡 공유가 준비 중이라 링크를 복사했습니다', '#921230');
      return;
    }
  }

  // 구매/사용 확인 모달
  function buy(featureName, cost) {
    if (!isLoggedIn()) { if (typeof window.showMemberOnlyNotice === 'function') { window.showMemberOnlyNotice('포인트 기능'); } else { window.showToast && window.showToast('로그인 후 이용할 수 있습니다', '#921230'); window.showAuthModal && window.showAuthModal(); } return; }
    const root = document.getElementById('ptModalRoot'); if (!root) return;
    if (P.points < cost) {
      const need = cost - P.points;
      root.innerHTML = `<div class="pt-modal-overlay" onclick="if(event.target===this)window.PointsUI.closeModal()"><div class="pt-modal" role="dialog" aria-label="포인트 부족">
        <h3>포인트가 부족합니다</h3>
        <div class="pt-modal-rows">
          <div class="row"><span class="k">필요 포인트</span><span class="v">${fmtP(cost)} P</span></div>
          <div class="row"><span class="k">보유 포인트</span><span class="v">${fmtP(P.points)} P</span></div>
          <div class="row"><span class="k">부족 포인트</span><span class="v">${fmtP(need)} P</span></div>
        </div>
        <p class="pt-modal-note">지인 초대 또는 이벤트 참여로 포인트를 받을 수 있습니다.</p>
        <div class="pt-modal-actions"><button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.closeModal()">닫기</button><button class="pt-btn pt-btn-primary" type="button" onclick="window.PointsUI.closeModal();window.PointsUI.go('invite')">지인 초대하기</button></div>
      </div></div>`;
      return;
    }
    const after = P.points - cost;
    root.innerHTML = `<div class="pt-modal-overlay" onclick="if(event.target===this)window.PointsUI.closeModal()"><div class="pt-modal" role="dialog" aria-label="포인트 사용 확인">
      <h3>포인트를 사용하시겠습니까?</h3>
      <div class="pt-modal-rows">
        <div class="row"><span class="k">이용 기능</span><span class="v">${esc(featureName)}</span></div>
        <div class="row"><span class="k">사용 포인트</span><span class="v">${fmtP(cost)} P</span></div>
        <div class="row"><span class="k">보유 포인트</span><span class="v">${fmtP(P.points)} P</span></div>
        <div class="row"><span class="k">사용 후 포인트</span><span class="v">${fmtP(after)} P</span></div>
      </div>
      <p class="pt-modal-note">분석 결과는 참고용 정보이며, 매매를 권유하지 않습니다.</p>
      <div class="pt-modal-actions"><button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.closeModal()">취소</button><button class="pt-btn pt-btn-primary" id="ptConfirmBtn" type="button" onclick="window.PointsUI.confirmBuy('${esc(featureName)}', ${cost})">사용하기</button></div>
    </div></div>`;
  }
  function confirmBuy(featureName, cost) {
    if (_busy) return; _busy = true;
    const btn = document.getElementById('ptConfirmBtn'); if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    // 상품 코드 없는 항목(데모/안내용) — 실제 차감 안 함
    setTimeout(() => {
      _busy = false;
      closeModal();
      window.showToast && window.showToast('이 항목은 안내용입니다. 포인트 상점의 상품에서 구매할 수 있습니다.', '#921230');
    }, 300);
  }

  // 실제 상품 구매 (코드 기반) — /v1/points/buy
  function buyCode(code, name, cost) {
    if (!isLoggedIn()) { if (typeof window.showMemberOnlyNotice === 'function') { window.showMemberOnlyNotice('포인트 기능'); } else { window.showToast && window.showToast('로그인 후 이용할 수 있습니다', '#921230'); window.showAuthModal && window.showAuthModal(); } return; }
    const root = document.getElementById('ptModalRoot'); if (!root) return;
    const usable = P.usable || P.points;
    if (usable < cost) {
      const need = cost - usable;
      root.innerHTML = `<div class="pt-modal-overlay" onclick="if(event.target===this)window.PointsUI.closeModal()"><div class="pt-modal" role="dialog" aria-label="포인트 부족">
        <h3>포인트가 부족합니다</h3>
        <div class="pt-modal-rows">
          <div class="row"><span class="k">필요 포인트</span><span class="v">${fmtP(cost)} P</span></div>
          <div class="row"><span class="k">보유 포인트</span><span class="v">${fmtP(usable)} P</span></div>
          <div class="row"><span class="k">부족 포인트</span><span class="v">${fmtP(need)} P</span></div>
        </div>
        <p class="pt-modal-note">지인 초대 또는 이벤트 참여로 포인트를 받을 수 있습니다.</p>
        <div class="pt-modal-actions"><button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.closeModal()">닫기</button><button class="pt-btn pt-btn-primary" type="button" onclick="window.PointsUI.closeModal();window.PointsUI.go('invite')">지인 초대하기</button></div>
      </div></div>`;
      return;
    }
    const after = usable - cost;
    root.innerHTML = `<div class="pt-modal-overlay" onclick="if(event.target===this)window.PointsUI.closeModal()"><div class="pt-modal" role="dialog" aria-label="포인트 사용 확인">
      <h3>포인트를 사용하시겠습니까?</h3>
      <div class="pt-modal-rows">
        <div class="row"><span class="k">이용 기능</span><span class="v">${esc(name)}</span></div>
        <div class="row"><span class="k">사용 포인트</span><span class="v">${fmtP(cost)} P</span></div>
        <div class="row"><span class="k">보유 포인트</span><span class="v">${fmtP(usable)} P</span></div>
        <div class="row"><span class="k">사용 후 포인트</span><span class="v">${fmtP(after)} P</span></div>
      </div>
      <p class="pt-modal-note">분석 결과는 참고용 정보이며, 매매를 권유하지 않습니다.</p>
      <div class="pt-modal-actions"><button class="pt-btn pt-btn-ghost" type="button" onclick="window.PointsUI.closeModal()">취소</button><button class="pt-btn pt-btn-primary" id="ptConfirmBtn" type="button" onclick="window.PointsUI.confirmBuyCode('${esc(code)}')">사용하기</button></div>
    </div></div>`;
  }
  async function confirmBuyCode(code) {
    if (_busy) return; _busy = true;
    const btn = document.getElementById('ptConfirmBtn'); if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    try {
      const req = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await req(`${API}/v1/points/buy`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_code: code }) });
      const j = await r.json().catch(() => null);
      closeModal();
      if (r.ok && j && j.data && j.data.success) {
        window.showToast && window.showToast(`${j.data.product || '상품'} 구매 완료. 사용 후 ${fmtP(j.data.balance)} P`, '#921230');
        await load();
      } else if (j && j.data && j.data.success === false && j.data.reason === 'insufficient') {
        window.showToast && window.showToast(`포인트가 부족합니다. ${fmtP(j.data.need)} P 더 필요합니다.`, '#921230');
      } else {
        window.showToast && window.showToast('포인트 사용을 완료하지 못했습니다. 잔액과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.', '#921230');
      }
    } catch (e) {
      closeModal();
      window.showToast && window.showToast('포인트 사용을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', '#921230');
    } finally { _busy = false; }
  }
  function closeModal() { const root = document.getElementById('ptModalRoot'); if (root) root.innerHTML = ''; }

  function openPane() {
    const tab = document.querySelector('.right-tab[data-p="points"]');
    if (tab) tab.click();
    // 우측 패널 열기(모바일)
    document.querySelector('.right')?.classList.add('open');
    P.sec = 'mine'; render();
  }

  // ───────── 이벤트 ─────────
  document.addEventListener('click', (e) => {
    const sub = e.target.closest('#ptSubnav .pt-subtab');
    if (sub) { P.sec = sub.dataset.sec; render(); return; }
    const cat = e.target.closest('[data-shopcat]');
    if (cat) { P.shopCat = cat.dataset.shopcat; render(); return; }
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.p === 'points') load();
  });

  window.PointsUI = { reload: load, go, copy, share, buy, confirmBuy, buyCode, confirmBuyCode, closeModal, openPane, getState: () => P };

  // 로그인 상태 변동 시 칩 갱신
  const _origRefresh = window.refreshAuthState;
  if (typeof _origRefresh === 'function' && !_origRefresh._ptHooked) {
    const wrapped = async function() { const r = await _origRefresh.apply(this, arguments); setTimeout(() => { load(); }, 300); return r; };
    wrapped._ptHooked = true; window.refreshAuthState = wrapped;
  }
  // 초기 로드(칩 표시용)
  setTimeout(load, 1800);
})();
