/**
 * ai-panel.js — AI 무료 분석 (참고용 시장 상태 요약)
 *
 * 매수/매도 추천이 아니라 현재 종목의 시장 상태·추세·거래량·변동성·주요 가격
 * 구간·관찰 포인트를 무료로 요약하는 AI 참고 분석 체험 패널.
 * 데이터: /v1/charts/candles + /v1/charts/ind-mtf. 무료 횟수는 localStorage 일일 카운터.
 * 브랜드 컬러만, 파란색/네온/이모지/로봇 금지. 단정 예측·매매 권유 표현 금지.
 * window._updateBeomSummary / window._runIndAnalysis 이름 유지(호환).
 */

(function() {
  'use strict';

  const BASE_TF = '1h';
  const FREE_LIMIT_GUEST = 3;   // 비로그인 1일 무료 분석
  const FREE_LIMIT_USER = 10;   // 로그인 1일 무료 분석

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const fmtP = p => { p = Number(p) || 0; return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (p < 1 ? p.toFixed(6) : p.toFixed(2)); };
  const fmtNum = v => { v = Number(v) || 0; return v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); };
  const reqJson = async (url) => { try { const r = await ((typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch)(url, { credentials: 'include' }); if (!r || !r.ok) return null; const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || ''; if (ct && !/application\/json/i.test(ct)) return null; return await r.json().catch(() => null); } catch { return null; } };
  const isLoggedIn = () => !!(window.isLoggedIn && window.isLoggedIn());
  function apiSymbol() { const s = window.curSymbol || 'BTCUSDT'; if (Array.isArray(window.symbols)) { const f = window.symbols.find(x => x.code === s); if (f && f.apiCode) return f.apiCode; } return s; }
  function symDisp() { return (window.curSymbol || 'BTCUSDT').replace('USDT', '/USDT').replace('KRW-', ''); }

  // ───────── 무료 사용 카운터 (localStorage, 일일) ─────────
  function usageKey() { const d = new Date(); return `aiFreeUse_${d.getFullYear()}${d.getMonth()+1}${d.getDate()}`; }
  function usedCount() { try { return parseInt(localStorage.getItem(usageKey()) || '0') || 0; } catch { return 0; } }
  function limit() { return isLoggedIn() ? FREE_LIMIT_USER : FREE_LIMIT_GUEST; }
  function remaining() { return Math.max(0, limit() - usedCount()); }
  function incUsage() { try { localStorage.setItem(usageKey(), String(usedCount() + 1)); } catch {} }

  // ───────── 상태 배지 ─────────
  const ST = { loading: ['불러오는 중','loading'], ok: ['정상','ok'], partial: ['일부 데이터','partial'], delayed: ['데이터 지연','delayed'], empty: ['데이터 부족','empty'], error: ['오류','error'] };
  function setStatus(kind) { const b = document.getElementById('ai2StatusBadge'); if (!b) return; const s = ST[kind] || ST.loading; b.textContent = s[0]; b.setAttribute('data-state', s[1]); }
  function setUpdated() { const el = document.getElementById('ai2Updated'); if (!el) return; const d = new Date(); el.textContent = `업데이트 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }
  function setHeader() {
    const sy = document.getElementById('ai2Symbol'); if (sy) sy.textContent = symDisp();
    const ba = document.getElementById('ai2Basis'); if (ba) ba.textContent = `기준 ${BASE_TF}`;
  }
  function renderUsage() {
    const el = document.getElementById('aiUsageInfo');
    const rem = remaining();
    if (el) {
      if (rem > 0) el.innerHTML = `무료 분석 가능 · 오늘 <b>${rem}회</b> 남음${isLoggedIn() ? '' : ' · 로그인 시 추가 분석 가능'}`;
      else el.innerHTML = '오늘의 무료 분석 횟수를 모두 사용했습니다.';
    }
    const us = document.getElementById('ai2UsageState');
    if (us) {
      if (rem > 0) us.innerHTML = isLoggedIn() ? `오늘 무료 분석 ${rem}회 남음` : `오늘 무료 분석 ${rem}회 남음 · 로그인하면 무료 분석 횟수가 늘어납니다.`;
      else us.innerHTML = '오늘의 무료 분석 횟수를 모두 사용했습니다. 로그인하거나 요금제를 확인하면 추가 분석을 사용할 수 있습니다.';
    }
    const btn = document.getElementById('ai2RefreshBtn');
    if (btn) btn.disabled = rem <= 0;
  }

  // ───────── 캔들 분석 ─────────
  let lastAnalysis = null;
  function analyze(candles) {
    const out = { ok: false };
    if (!Array.isArray(candles) || candles.length < 30) return out;
    const c = candles.map(x => ({ o: parseFloat(x.open ?? x.o ?? 0), h: parseFloat(x.high ?? x.h ?? 0), l: parseFloat(x.low ?? x.l ?? 0), c: parseFloat(x.close ?? x.c ?? 0), v: parseFloat(x.volume ?? x.v ?? 0) })).filter(x => x.c > 0);
    if (c.length < 30) return out;
    const closes = c.map(x => x.c);
    const n = closes.length, last = closes[n - 1];
    const sma = (arr, k) => { const s = arr.slice(-k); return s.reduce((a, b) => a + b, 0) / s.length; };
    const ma20 = sma(closes, 20), ma50 = sma(closes, Math.min(50, n));
    // 추세
    let trend, trendDesc;
    if (last > ma20 && ma20 > ma50) { trend = 'up'; trendDesc = '상승 추세 참고'; }
    else if (last < ma20 && ma20 < ma50) { trend = 'down'; trendDesc = '하락 추세 참고'; }
    else if (Math.abs(last - ma20) / ma20 < 0.005) { trend = 'neutral'; trendDesc = '중립'; }
    else { trend = 'mixed'; trendDesc = '혼조'; }
    // 모멘텀(RSI)
    let g = 0, l = 0; for (let i = n - 14; i < n; i++) { if (i < 1) continue; const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
    const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    // 거래량
    const vols = c.map(x => x.v); const avgVol = sma(vols, 20), curVol = vols[n - 1];
    const volRatio = avgVol > 0 ? curVol / avgVol : 1;
    let volState, volDesc;
    if (volRatio >= 1.8) { volState = 'surge'; volDesc = '급증'; }
    else if (volRatio >= 1.2) { volState = 'good'; volDesc = '거래량 동반'; }
    else if (volRatio >= 0.7) { volState = 'normal'; volDesc = '보통'; }
    else { volState = 'low'; volDesc = '낮음'; }
    // 변동성(ATR%)
    let tr = 0; const m = Math.min(14, n - 1);
    for (let i = n - m; i < n; i++) { tr += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); }
    const atrPct = last > 0 ? (tr / m / last) * 100 : 0;
    let volaState, volaDesc;
    if (atrPct >= 8) { volaState = 'extreme'; volaDesc = '매우 높음'; }
    else if (atrPct >= 5) { volaState = 'high'; volaDesc = '높음'; }
    else if (atrPct >= 2) { volaState = 'mid'; volaDesc = '보통'; }
    else { volaState = 'low'; volaDesc = '낮음'; }
    // 가격 구조
    const recent = c.slice(-20);
    const hi = Math.max(...recent.map(x => x.h)), lo = Math.min(...recent.map(x => x.l));
    const range = hi - lo; const pos = range > 0 ? ((last - lo) / range) * 100 : 50;
    // 상단/하단 확인 구간 (최근 고저점 + 변동성 폭)
    const atrAbs = (tr / m);
    const upperZone = last + atrAbs * 1.5;
    const lowerZone = last - atrAbs * 1.5;
    // 시장 상태 종합
    let market;
    if (volaState === 'high' || volaState === 'extreme') market = 'volatile';
    else if (trend === 'up') market = 'bull';
    else if (trend === 'down') market = 'bear';
    else market = 'neutral';
    // 리스크
    let risk;
    if (volaState === 'extreme') risk = 'high';
    else if (volaState === 'high' || volState === 'low') risk = 'check';
    else if (volaState === 'mid') risk = 'normal';
    else risk = 'low';
    Object.assign(out, { ok: true, last, ma20, ma50, trend, trendDesc, rsi, volRatio, volState, volDesc, atrPct, volaState, volaDesc, hi, lo, pos, upperZone, lowerZone, market, risk });
    return out;
  }

  // ───────── 시간대 정렬 (ind-mtf) ─────────
  async function tfAlign() {
    const sym = apiSymbol();
    const tfs = ['5m', '1h', '1d'];
    const res = await Promise.all(tfs.map(tf => reqJson(`/v1/charts/ind-mtf?symbolId=${sym}&timeframe=${tf}`)));
    const dirOf = (d) => { if (!d || !d.success || !d.data || typeof d.data.v !== 'number') return null; const r = (d.data.max_signals > 0 ? d.data.v / d.data.max_signals : 0); return r >= 0.15 ? 'up' : r <= -0.15 ? 'down' : 'neutral'; };
    return { short: dirOf(res[0]), mid: dirOf(res[1]), long: dirOf(res[2]) };
  }

  // ───────── 렌더 ─────────
  const MARKET_LABEL = { bull: ['강세 우위', 'ai2-v-good'], bear: ['약세 우위', 'ai2-v-down'], neutral: ['중립', 'ai2-v-neutral'], volatile: ['변동성 확대', 'ai2-v-warn'], none: ['데이터 부족', 'ai2-v-neutral'] };
  const TREND_LABEL = { up: ['상승 추세 참고', 'ai2-v-good'], down: ['하락 추세 참고', 'ai2-v-down'], neutral: ['중립', 'ai2-v-neutral'], mixed: ['혼조', 'ai2-v-neutral'], none: ['데이터 부족', 'ai2-v-neutral'] };
  const VOL_LABEL = { good: ['거래량 동반', 'ai2-v-good'], surge: ['급증', 'ai2-v-warn'], normal: ['보통', 'ai2-v-neutral'], low: ['낮음', 'ai2-v-neutral'], none: ['데이터 부족', 'ai2-v-neutral'] };
  const VOLA_LABEL = { low: ['낮음', 'ai2-v-good'], mid: ['보통', 'ai2-v-neutral'], high: ['높음', 'ai2-v-warn'], extreme: ['매우 높음', 'ai2-v-warn'], none: ['데이터 부족', 'ai2-v-neutral'] };
  const RISK_LABEL = { low: ['낮음', 'ai2-v-good'], normal: ['보통', 'ai2-v-neutral'], check: ['확인 필요', 'ai2-v-warn'], high: ['높음', 'ai2-v-warn'], none: ['데이터 부족', 'ai2-v-neutral'] };

  function renderSummary(a, align) {
    const el = document.getElementById('ai2Summary'); if (!el) return;
    if (!a.ok) { el.innerHTML = '<div class="ai2-summary"><p class="ai2-summary-text">현재 데이터가 충분하지 않아 AI 요약이 제한적으로 제공됩니다. 거래량과 캔들 데이터가 더 쌓이면 분석 정확도가 개선될 수 있습니다.</p></div>'; return; }
    const sym = symDisp();
    const sentences = [];
    if (a.market === 'bull') sentences.push(`현재 ${sym}는 단기적으로 상승 쪽에 가까운 흐름입니다.`);
    else if (a.market === 'bear') sentences.push(`현재 ${sym}는 단기적으로 하락 쪽에 가까운 흐름입니다.`);
    else if (a.market === 'volatile') sentences.push(`현재 ${sym}는 변동성이 확대된 흐름입니다.`);
    else sentences.push(`현재 ${sym}는 단기적으로 중립에 가까운 흐름입니다.`);
    if (a.volState === 'low') sentences.push('가격 변동폭은 제한적이지만 거래량이 낮아 방향성을 단정하기 어렵습니다.');
    else if (a.volState === 'surge') sentences.push('거래량이 평균보다 크게 늘어 가격 움직임에 관심이 모이고 있습니다.');
    else sentences.push('거래량은 보통 수준입니다.');
    sentences.push('주요 가격 구간과 거래량 변화를 함께 확인하는 것이 좋습니다.');
    el.innerHTML = `<div class="ai2-card-title">현재 종목 AI 요약</div><div class="ai2-summary"><p class="ai2-summary-text">${esc(sentences.join(' '))}</p></div>`;
  }

  function renderState(a) {
    const el = document.getElementById('ai2State'); if (!el) return;
    const cell = (k, arr) => `<div class="ai2-state-cell"><div class="k">${k}</div><div class="v ${arr[1]}">${arr[0]}</div></div>`;
    const m = a.ok ? MARKET_LABEL[a.market] : MARKET_LABEL.none;
    const t = a.ok ? TREND_LABEL[a.trend] : TREND_LABEL.none;
    const v = a.ok ? VOL_LABEL[a.volState] : VOL_LABEL.none;
    const vo = a.ok ? VOLA_LABEL[a.volaState] : VOLA_LABEL.none;
    const r = a.ok ? RISK_LABEL[a.risk] : RISK_LABEL.none;
    el.innerHTML = `<div class="ai2-card"><div class="ai2-card-title">시장 상태</div><div class="ai2-state-grid">
      ${cell('시장 상태', m)}${cell('추세', t)}${cell('거래량', v)}${cell('변동성', vo)}${cell('리스크', r)}
    </div></div>`;
  }

  function renderBasic(a, align) {
    const el = document.getElementById('ai2Basic'); if (!el) return;
    if (!a.ok) { el.innerHTML = '<div class="ai2-card"><div class="ai2-card-title">기본 분석</div><div class="ai2-state-msg">AI 분석에 필요한 데이터가 충분하지 않습니다. 캔들 데이터와 거래량이 누적되면 자동으로 반영됩니다.</div></div>'; return; }
    const trendTxt = a.trend === 'up' ? '상승 쪽에 가까운 흐름입니다.' : a.trend === 'down' ? '하락 쪽에 가까운 흐름입니다.' : '중립에 가까운 흐름입니다.';
    const volTxt = a.volState === 'low' ? '현재 거래량은 평균 대비 낮은 편입니다.' : a.volState === 'surge' ? '현재 거래량은 평균보다 크게 늘었습니다.' : `현재 거래량은 평균 대비 ${(a.volRatio*100).toFixed(0)}% 수준입니다.`;
    const volaTxt = (a.volaState === 'high' || a.volaState === 'extreme') ? '단기 변동성이 커져 흐름이 빠르게 바뀔 수 있습니다.' : '단기 변동성은 크지 않지만, 거래량이 증가하면 방향성이 확대될 수 있습니다.';
    const dl = d => d === 'up' ? '상승' : d === 'down' ? '하락' : d === 'neutral' ? '중립' : '확인 필요';
    const alignTxt = align ? `단기 ${dl(align.short)}, 중기 ${dl(align.mid)}, 장기 ${dl(align.long)}` : '데이터 확인 필요';
    el.innerHTML = `<div class="ai2-card"><div class="ai2-card-title">기본 분석</div><div class="ai2-kv">
      <div class="ai2-kv-row"><span class="k">추세 방향</span><span class="v">${esc(trendTxt)}</span></div>
      <div class="ai2-kv-row"><span class="k">거래량 상태</span><span class="v">${esc(volTxt)}</span></div>
      <div class="ai2-kv-row"><span class="k">변동성 상태</span><span class="v">${esc(volaTxt)}</span></div>
      <div class="ai2-kv-row"><span class="k">시간대 정렬</span><span class="v">${esc(alignTxt)}</span></div>
    </div></div>`;
  }

  function renderZones(a) {
    const el = document.getElementById('ai2Zones'); if (!el) return;
    if (!a.ok) { el.innerHTML = '<div class="ai2-card"><div class="ai2-card-title">주요 가격 구간</div><div class="ai2-state-msg">데이터 부족으로 가격 구간을 계산하지 못했습니다.</div></div>'; return; }
    el.innerHTML = `<div class="ai2-card"><div class="ai2-card-title">주요 가격 구간</div>
      <div class="ai2-zone-row"><span class="k">현재가</span><span class="v">$${fmtP(a.last)}</span></div>
      <div class="ai2-zone-row"><span class="k">상단 확인 구간</span><span class="v">$${fmtP(a.upperZone)}</span></div>
      <div class="ai2-zone-row"><span class="k">하단 확인 구간</span><span class="v">$${fmtP(a.lowerZone)}</span></div>
      <div class="ai2-zone-row"><span class="k">최근 고점</span><span class="v">$${fmtP(a.hi)}</span></div>
      <div class="ai2-zone-row"><span class="k">최근 저점</span><span class="v">$${fmtP(a.lo)}</span></div>
      <div class="ai2-zone-row"><span class="k">변동성 기준 범위</span><span class="v">±${a.atrPct.toFixed(2)}%</span></div>
      <p class="ai2-mini-note">주요 가격 구간은 최근 가격 흐름을 기준으로 계산한 참고 영역입니다. 가격 반응과 거래량 동반 여부를 함께 확인해 주세요.</p>
    </div>`;
  }

  function renderObserve(a, align) {
    const el = document.getElementById('ai2Observe'); if (!el) return;
    const points = [];
    if (a.ok) {
      if (a.volState === 'low' || a.volState === 'normal') points.push('거래량 증가 여부 확인');
      points.push('현재가가 상단 확인 구간에 접근할 때 가격 반응 확인');
      if (a.volaState === 'low') points.push('짧은 시간대 변동성 확대 여부 확인');
      else if (a.volaState === 'high' || a.volaState === 'extreme') points.push('변동성이 큰 구간에서 리스크 확인');
      else points.push('하단 확인 구간에서의 가격 반응 확인');
    } else {
      points.push('캔들·거래량 데이터 누적 여부 확인');
    }
    const top3 = points.slice(0, 3);
    el.innerHTML = `<div class="ai2-card"><div class="ai2-card-title">관찰 포인트</div><ol class="ai2-observe-list">${top3.map(p => `<li>${esc(p)}</li>`).join('')}</ol></div>`;
  }

  function renderBasis() {
    const el = document.getElementById('ai2Basis2'); if (!el) return;
    el.innerHTML = `<div class="ai2-card"><div class="ai2-card-title">분석 기준</div>
      <div class="ai2-kv">
        <div class="ai2-kv-row"><span class="k">근거 데이터</span><span class="v">가격 흐름 · 거래량 · 변동성 · 최근 고점·저점 · 이동평균 흐름 · 시간대별 방향</span></div>
      </div>
      <p class="ai2-mini-note">이번 요약은 최근 가격 흐름, 거래량 변화, 변동성, 주요 가격 구간을 기준으로 작성되었습니다.</p>
    </div>`;
  }

  function renderQuality(a) {
    // 품질 안내는 요약 카드 하단에 보조로 추가
    const el = document.getElementById('ai2Summary'); if (!el || !a.ok) return;
    let msg = '';
    if (a.volaState === 'low') msg = '현재 변동성이 낮아 뚜렷한 방향성을 판단하기 어렵습니다. 거래량 증가와 주요 가격 구간 반응을 함께 확인해 주세요.';
    else if (a.volaState === 'high' || a.volaState === 'extreme') msg = '현재 변동성이 높아 단기 흐름이 빠르게 바뀔 수 있습니다. 짧은 시간대 분석만으로 방향을 단정하기보다 리스크를 함께 확인해 주세요.';
    else if (a.volState === 'low') msg = '거래량이 낮아 현재 가격 움직임의 신뢰도를 판단하기 어렵습니다. 거래량 증가 여부를 함께 확인해 주세요.';
    if (msg) el.insertAdjacentHTML('beforeend', `<p class="ai2-mini-note">${esc(msg)}</p>`);
  }

  function renderLoginPrompt() {
    const el = document.getElementById('ai2LoginPrompt'); if (!el) return;
    if (isLoggedIn()) {
      el.innerHTML = `<div class="ai2-login">분석 기록이 저장됩니다. 관심 종목과 함께 AI 분석을 이어서 확인할 수 있습니다.</div>`;
    } else {
      el.innerHTML = `<div class="ai2-login">로그인하면 분석 기록을 저장하고 더 많은 무료 분석을 사용할 수 있습니다.
        <div class="ai2-login-actions">
          <button class="ai2-btn ai2-btn-primary" type="button" aria-label="로그인" onclick="window.showAuthModal&&window.showAuthModal()">로그인</button>
          <button class="ai2-btn ai2-btn-secondary" type="button" aria-label="회원가입" onclick="window.showAuthModal&&window.showAuthModal('signup')">회원가입</button>
        </div></div>`;
    }
  }

  // ───────── 차트 토글 (graceful) ─────────
  function clearOverlay() { if (!window.chart || !window.chart.overlay) return; window.chart.overlay.drawings = window.chart.overlay.drawings.filter(x => x._calcOwner !== 'ai2_panel'); window.chart._dirty = true; }
  window._ai2Toggle = function() {
    const note = document.getElementById('ai2ToggleNote');
    if (!window.chart || !window.chart.addDrawing || !window.chart.overlay) { if (note) note.textContent = '차트 표시는 차트 화면이 준비되면 자동으로 반영됩니다.'; return; }
    applyToggles();
  };
  function applyToggles() {
    if (!window.chart || !window.chart.addDrawing || !window.chart.overlay || !lastAnalysis || !lastAnalysis.ok) return;
    clearOverlay();
    const a = lastAnalysis;
    const add = (price, label, color) => { if (Number.isFinite(price) && price > 0) window.chart.addDrawing({ type: 'hline', price, color, lineWidth: 1, dashed: true, label, _calcOwner: 'ai2_panel' }); };
    if (document.getElementById('ai2TogZones')?.checked) {
      add(a.upperZone, '상단 확인 구간 $' + fmtP(a.upperZone), '#4A0817');
      add(a.lowerZone, '하단 확인 구간 $' + fmtP(a.lowerZone), '#921230');
    }
    if (document.getElementById('ai2TogObserve')?.checked) {
      add(a.hi, 'AI 관찰 포인트 (고점) $' + fmtP(a.hi), '#6F0E24');
      add(a.lo, 'AI 관찰 포인트 (저점) $' + fmtP(a.lo), '#6F0E24');
    }
    window.chart._dirty = true;
  }

  window._ai2OpenPlans = function() {
    // 요금제/구독 영역으로 이동 시도 (없으면 안내 토스트)
    if (typeof window.showSubscribe === 'function') { window.showSubscribe(); return; }
    if (typeof window.openPlans === 'function') { window.openPlans(); return; }
    const el = document.querySelector('[data-action="plans"], [href*="plan"], #planBtn');
    if (el) { el.click(); return; }
    window.showToast && window.showToast('요금제 안내는 곧 제공됩니다', '#921230');
  };

  // ───────── 메인: window._updateBeomSummary (이름 유지) ─────────
  let _busy = false;
  window._updateBeomSummary = async function(manual) {
    if (!window.curSymbol) return;
    setHeader();
    renderUsage();
    renderLoginPrompt();
    renderBasis();
    // 무료 횟수 소진 시 수동 분석 차단(자동 갱신은 표시만)
    if (manual === true) {
      if (remaining() <= 0) {
        window.showToast && window.showToast('오늘의 무료 분석 횟수를 모두 사용했습니다', '#921230');
        return;
      }
      incUsage();
      renderUsage();
    }
    if (_busy) return; _busy = true;
    setStatus('loading');
    const sumEl = document.getElementById('ai2Summary');
    if (sumEl && manual) sumEl.innerHTML = '<div class="ai2-card-title">현재 종목 AI 요약</div><div class="ai2-summary"><p class="ai2-summary-text">AI가 현재 차트 데이터를 요약하는 중입니다. 잠시만 기다려 주세요.</p></div>';
    try {
      const sym = apiSymbol();
      const cd = await reqJson(`/v1/charts/candles?symbolId=${sym}&timeframe=${BASE_TF}&limit=200`);
      const candles = cd && cd.success && cd.data ? (cd.data.candles || cd.data) : null;
      const a = analyze(candles);
      lastAnalysis = a;
      let align = null;
      try { align = await tfAlign(); } catch { align = null; }
      renderSummary(a, align);
      renderState(a);
      renderBasic(a, align);
      renderZones(a);
      renderObserve(a, align);
      renderQuality(a);
      applyToggles();
      setStatus(a.ok ? 'ok' : (candles ? 'partial' : 'empty'));
      setUpdated();
    } catch (e) {
      setStatus('error');
      if (sumEl) sumEl.innerHTML = '<div class="ai2-card-title">현재 종목 AI 요약</div><div class="ai2-state-msg">AI 무료 분석을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    } finally { _busy = false; }
  };

  // 호환 유지(기존 선택 지표 분석 — 마크업 제거됨, 안전 no-op)
  window._runIndAnalysis = function() {};

  // ───────── 트리거 ─────────
  document.addEventListener('click', (e) => { const tab = e.target.closest('.right-tab'); if (tab && tab.dataset.p === 'ai') window._updateBeomSummary(); });
  document.addEventListener('symbolChanged', () => { const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'ai') window._updateBeomSummary(); });
  // 자동 갱신(횟수 차감 없음): 60초
  setInterval(() => { if (document.hidden) return; const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'ai') window._updateBeomSummary(); }, 60000);
  // 최초 진입(AI 탭이 기본 활성)
  setTimeout(() => { window._updateBeomSummary(); }, 1500);
})();
