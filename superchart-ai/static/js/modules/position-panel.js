// 포지션 분석 패널 — 시장 포지셔닝 분석 대시보드
// 롱·숏 비율 / 대형 자금 흐름 / 펀딩 / 청산 히트맵 / 참고 해석 / 리스크 체크리스트
// 의존: window.curSymbol, window.symbols, window.chart, window.dedupFetch
// 주의: 매수/매도 권유·수익 보장·단정 표현 금지. 모든 문구는 참고용 설명.

(function() {
  'use strict';

  // ─────────── 상태 ───────────
  let lsData = null;          // long-short-detailed 응답
  let liqData = null;         // liquidation-heatmap 응답
  let lastHeatmapData = null; // 차트 오버레이용
  let selectedTf = '5m';      // 롱숏 기간 (백엔드 지원: 5m/15m/1h)
  let selectedLiqPeriod = '24h'; // 청산 기간 (백엔드 지원: 24h만. 12h/3d/7d는 준비중)
  const SUPPORTED_LIQ_PERIODS = ['24h'];

  function getApiSymbol() {
    const sym = window.curSymbol || 'BTCUSDT';
    if (Array.isArray(window.symbols)) {
      const s = window.symbols.find(x => x.code === sym);
      if (s && s.apiCode) return s.apiCode;
    }
    return sym;
  }
  function displaySymbol() {
    const sym = window.curSymbol || 'BTCUSDT';
    return sym.replace('USDT', '/USDT').replace('KRW-', '') ;
  }

  // ─────────── 포맷 헬퍼 ───────────
  const fmtUSD = v => {
    v = Number(v) || 0;
    return v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
  };
  const fmtPrice = p => {
    p = Number(p) || 0;
    return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(p < 1 ? 4 : 2);
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // ─────────── 헤더 상태 배지 ───────────
  const STATUS = {
    loading: { text: '불러오는 중', state: 'loading' },
    ok: { text: '정상', state: 'ok' },
    partial: { text: '일부 데이터', state: 'partial' },
    delayed: { text: '데이터 지연', state: 'delayed' },
    empty: { text: '데이터 부족', state: 'empty' },
    error: { text: '오류', state: 'error' },
  };
  function setStatus(kind) {
    const b = document.getElementById('paStatusBadge');
    if (!b) return;
    const s = STATUS[kind] || STATUS.loading;
    b.textContent = s.text;
    b.setAttribute('data-state', s.state);
  }
  function setUpdatedNow() {
    const el = document.getElementById('paUpdated');
    if (!el) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    el.textContent = `업데이트 ${hh}:${mm}:${ss}`;
  }
  function setHeaderSymbol() {
    const el = document.getElementById('paSymbol');
    if (el) el.textContent = displaySymbol();
  }

  // ─────────── 편향 분류 (대형 자금 1h ratio 기준) ───────────
  // 방향 단정이 아니라 "쏠림 정도"의 분류임.
  function biasFromRatio(ratio) {
    if (!Number.isFinite(ratio)) return { key: 'neutral', label: '중립', cls: 'pa-bias-neutral' };
    if (ratio >= 2.0) return { key: 'strong_long', label: '롱 쏠림', cls: 'pa-bias-strong-long' };
    if (ratio >= 1.3) return { key: 'long', label: '롱 우위', cls: 'pa-bias-long' };
    if (ratio <= 0.5) return { key: 'strong_short', label: '숏 쏠림', cls: 'pa-bias-strong-short' };
    if (ratio <= 0.77) return { key: 'short', label: '숏 우위', cls: 'pa-bias-short' };
    return { key: 'neutral', label: '중립', cls: 'pa-bias-neutral' };
  }
  // 요약 카드용 5단계 상태
  function summaryStateFromRatio(ratio) {
    if (!Number.isFinite(ratio)) return { label: '중립', cls: 'pa-bias-neutral' };
    if (ratio >= 2.0) return { label: '롱 우위 강함', cls: 'pa-bias-strong-long' };
    if (ratio >= 1.3) return { label: '롱 우위', cls: 'pa-bias-long' };
    if (ratio <= 0.5) return { label: '숏 우위 강함', cls: 'pa-bias-strong-short' };
    if (ratio <= 0.77) return { label: '숏 우위', cls: 'pa-bias-short' };
    return { label: '중립', cls: 'pa-bias-neutral' };
  }

  // ─────────── 롱숏 비율 로드 + 렌더 ───────────
  async function loadLongShortDetailed() {
    const sym = getApiSymbol();
    try {
      const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await requester(`/v1/charts/long-short-detailed?symbol=${sym}`, { credentials: 'include' });
      if (!r || !r.ok) { lsData = null; return false; }
      const d = await r.json().catch(() => null);
      if (!d || !d.success || !d.data) { lsData = null; return false; }
      lsData = d.data;
      return true;
    } catch (e) {
      lsData = null;
      return false;
    }
  }

  function renderConsensus() {
    const consensusMap = {
      long_heavy: { text: '롱 우위 (강)', cls: 'tag-pill-up' },
      long_lean: { text: '롱 우위', cls: 'tag-pill-up' },
      short_heavy: { text: '숏 우위 (강)', cls: 'tag-pill-down' },
      short_lean: { text: '숏 우위', cls: 'tag-pill-down' },
      neutral: { text: '중립', cls: 'tag-pill-neutral' },
    };
    const ce = document.getElementById('lsConsensus');
    if (!ce) return;
    const c = consensusMap[(lsData && lsData.consensus) || 'neutral'] || consensusMap.neutral;
    ce.className = 'tag-pill ' + c.cls;
    ce.textContent = c.text;
  }

  function renderLsRows() {
    const el = document.getElementById('lsDetailedTable');
    if (!el) return;
    if (!lsData) {
      el.innerHTML = '<div class="pa-state-msg">롱·숏 데이터를 불러오지 못했습니다. 거래소 데이터가 지연되었을 수 있습니다.</div>';
      return;
    }
    const cats = [
      { key: 'global', label: '전체 참여자', tip: '전체 선물 계정의 롱·숏 비율입니다.' },
      { key: 'top_account', label: 'TOP 계정', tip: '상위 계정 수 기준 롱·숏 비율입니다.' },
      { key: 'top_position', label: 'TOP 포지션', tip: '상위 포지션 규모(대형 자금) 기준 롱·숏 비율입니다.' },
    ];
    let html = '';
    let anyRow = false;
    cats.forEach(cat => {
      const v = lsData[cat.key] && lsData[cat.key][selectedTf];
      if (!v) {
        html += `<div class="pa-ls-row"><div class="pa-ls-row-top"><span class="pa-ls-row-label"><span class="pa-tip" title="${esc(cat.tip)}">${esc(cat.label)}</span></span><span class="pa-ls-row-pct text-muted">데이터 없음</span></div></div>`;
        return;
      }
      anyRow = true;
      const lp = Number(v.long_pct) || 0;
      const sp = Number(v.short_pct) || 0;
      const skew = Math.abs(lp - sp);
      const skewBadge = skew >= 30 ? '<span class="pa-skew-badge">쏠림 강함</span>' : '';
      html += `
        <div class="pa-ls-row">
          <div class="pa-ls-row-top">
            <span class="pa-ls-row-label"><span class="pa-tip" title="${esc(cat.tip)}">${esc(cat.label)}</span> ${skewBadge}</span>
            <span class="pa-ls-row-pct num-tabular">L ${lp}% / S ${sp}% · ${esc(v.ratio)}</span>
          </div>
          <div class="pa-ls-bar" role="img" aria-label="롱 ${lp}퍼센트 숏 ${sp}퍼센트">
            <div class="pa-ls-bar-long" style="width:${lp}%"></div>
            <div class="pa-ls-bar-short" style="width:${sp}%"></div>
          </div>
        </div>`;
    });
    el.innerHTML = anyRow ? html : '<div class="pa-state-msg">선택한 기간의 롱·숏 데이터가 아직 없습니다.</div>';
  }

  // ─────────── 대형 자금 흐름 (TOP 포지션 1h) ───────────
  function renderBigMoney() {
    const body = document.getElementById('bigMoneyBody');
    const badge = document.getElementById('bigMoneyBadge');
    if (!body || !badge) return;
    const tp = lsData && lsData.top_position && lsData.top_position['1h'];
    if (!tp) {
      badge.className = 'pa-bias-badge pa-bias-neutral';
      badge.textContent = '데이터 없음';
      body.innerHTML = '<div class="pa-state-msg">대형 자금 데이터를 불러오지 못했습니다. 거래소 데이터가 지연되었거나 해당 심볼에서 제공되지 않을 수 있습니다.</div>';
      return;
    }
    const lp = Number(tp.long_pct) || 0;
    const sp = Number(tp.short_pct) || 0;
    const ratio = Number(tp.ratio);
    const bias = biasFromRatio(ratio);
    badge.className = 'pa-bias-badge ' + bias.cls;
    badge.textContent = bias.label;

    let note;
    if (bias.key === 'strong_long') note = '대형 포지션의 롱 비중이 크게 높은 편입니다. 급격한 하방 변동 시 롱 청산 압력이 커질 수 있습니다.';
    else if (bias.key === 'long') note = '대형 포지션이 롱 쪽으로 다소 기울어 있습니다.';
    else if (bias.key === 'strong_short') note = '대형 포지션의 숏 비중이 크게 높은 편입니다. 급격한 상방 변동 시 숏 청산 압력이 커질 수 있습니다.';
    else if (bias.key === 'short') note = '대형 포지션이 숏 쪽으로 다소 기울어 있습니다.';
    else note = '대형 포지션의 롱·숏이 균형에 가깝습니다.';

    body.innerHTML = `
      <div class="pa-gauge" role="img" aria-label="롱 ${lp}퍼센트 숏 ${sp}퍼센트">
        <div class="pa-gauge-long" style="width:${lp}%">L ${lp}%</div>
        <div class="pa-gauge-short" style="width:${sp}%">${sp}% S</div>
        <div class="pa-gauge-mid"></div>
      </div>
      <div class="flex-between" style="align-items:baseline;margin-top:6px">
        <span class="pa-funding-k">롱숏 비율</span>
        <span class="pa-ratio-emph">${Number.isFinite(ratio) ? ratio : '--'}</span>
      </div>
      <p class="pa-flow-note">${esc(note)} 이는 참고용 분석이며 방향을 단정하지 않습니다.</p>`;
  }

  // ─────────── 요약 카드 ───────────
  function renderSummary() {
    const badge = document.getElementById('paSummaryBadge');
    const figs = document.getElementById('paSummaryFigures');
    const note = document.getElementById('paSummaryNote');
    if (!badge || !figs || !note) return;

    const tp = lsData && lsData.top_position && lsData.top_position['1h'];
    const gl = lsData && lsData.global && lsData.global['1h'];
    if (!tp && !gl) {
      badge.className = 'pa-bias-badge pa-bias-neutral';
      badge.textContent = '중립';
      figs.innerHTML = '<div class="pa-state-msg">시장 포지션 요약 데이터를 불러오지 못했습니다.</div>';
      note.textContent = '';
      return;
    }
    const ratio = tp ? Number(tp.ratio) : Number(gl.ratio);
    const st = summaryStateFromRatio(ratio);
    badge.className = 'pa-bias-badge ' + st.cls;
    badge.textContent = st.label;

    const parts = [];
    if (tp) parts.push(`<div class="pa-fig"><span class="pa-fig-k">대형 자금 L/S</span><span class="pa-fig-v">${tp.long_pct}% / ${tp.short_pct}%</span></div>`);
    if (tp) parts.push(`<div class="pa-fig"><span class="pa-fig-k">롱숏 비율</span><span class="pa-fig-v">${Number.isFinite(Number(tp.ratio)) ? tp.ratio : '--'}</span></div>`);
    if (gl) parts.push(`<div class="pa-fig"><span class="pa-fig-k">전체 참여자 L/S</span><span class="pa-fig-v">${gl.long_pct}% / ${gl.short_pct}%</span></div>`);
    figs.innerHTML = parts.join('');

    let txt;
    if (st.label.startsWith('롱 우위 강')) txt = '대형 자금 기준 롱 쏠림이 뚜렷합니다. 쏠림이 클수록 반대 방향 변동 시 청산 연쇄 가능성도 함께 커질 수 있어 참고가 필요합니다.';
    else if (st.label.startsWith('롱 우위')) txt = '대형 자금이 롱 쪽으로 다소 기울어 있습니다. 추세와 함께 청산 구간을 같이 확인하면 도움이 됩니다.';
    else if (st.label.startsWith('숏 우위 강')) txt = '대형 자금 기준 숏 쏠림이 뚜렷합니다. 쏠림이 클수록 반대 방향 변동 시 청산 연쇄 가능성도 함께 커질 수 있어 참고가 필요합니다.';
    else if (st.label.startsWith('숏 우위')) txt = '대형 자금이 숏 쪽으로 다소 기울어 있습니다. 추세와 함께 청산 구간을 같이 확인하면 도움이 됩니다.';
    else txt = '대형 자금의 롱·숏이 균형에 가깝습니다. 뚜렷한 쏠림은 관찰되지 않습니다.';
    note.textContent = txt + ' (참고용 설명이며 매매를 권유하지 않습니다.)';
  }

  // ─────────── 펀딩 정보 ───────────
  function renderFunding() {
    const body = document.getElementById('fundingBody');
    if (!body) return;
    if (!liqData || typeof liqData.funding_rate !== 'number') {
      body.innerHTML = '<div class="pa-state-msg">펀딩 데이터를 불러오지 못했습니다. 거래소 데이터가 지연되었거나 해당 심볼에서 제공되지 않을 수 있습니다.</div>';
      return;
    }
    const rate = liqData.funding_rate; // 퍼센트 단위
    let interp, level;
    if (rate > 0.05) { interp = '펀딩비가 높은 양수입니다. 롱 포지션이 숏에 비용을 지불하는 상태로, 롱 과열로 해석될 수 있습니다.'; level = 'high'; }
    else if (rate > 0.01) { interp = '펀딩비가 양수입니다. 롱이 숏에 비용을 지불하며 롱이 약간 우세한 편입니다.'; level = 'mid'; }
    else if (rate < -0.05) { interp = '펀딩비가 낮은 음수입니다. 숏 포지션이 롱에 비용을 지불하는 상태로, 숏 과열로 해석될 수 있습니다.'; level = 'high'; }
    else if (rate < -0.01) { interp = '펀딩비가 음수입니다. 숏이 롱에 비용을 지불하며 숏이 약간 우세한 편입니다.'; level = 'mid'; }
    else { interp = '펀딩비가 0 부근으로 롱·숏 비용 부담이 균형에 가깝습니다.'; level = 'low'; }

    const cls = rate > 0.01 ? 'label-up' : rate < -0.01 ? 'label-down' : '';
    body.innerHTML = `
      <div class="pa-funding-row">
        <span class="pa-funding-k">현재 펀딩비</span>
        <span class="pa-funding-v ${cls}">${rate >= 0 ? '+' : ''}${rate.toFixed(4)}%</span>
      </div>
      <div class="pa-funding-row">
        <span class="pa-funding-k">다음 펀딩까지</span>
        <span class="pa-funding-v text-muted">제공되지 않음</span>
      </div>
      <p class="pa-funding-note">${esc(interp)}</p>`;
  }

  // ─────────── 청산 히트맵 ───────────
  function setLiqOverlayButtonEnabled(enabled) {
    const btn = document.getElementById('liqOverlayBtn');
    if (!btn) return;
    btn.disabled = !enabled;
    if (!enabled) {
      btn.classList.remove('is-active');
      btn.textContent = '차트 표시';
      window._liqOverlayActive = false;
    }
  }

  function liqStateMessage(kind) {
    if (kind === 'insufficient') return '청산 밀집 데이터를 계산하기에 충분한 거래 정보가 아직 부족합니다. 거래량이 누적되면 주요 청산 구간이 자동으로 표시됩니다.';
    if (kind === 'unsupported') return '이 종목은 청산 데이터를 제공하지 않습니다. (선물 미상장 또는 데이터 미지원)';
    if (kind === 'error') return '청산 데이터를 불러오지 못했습니다. 거래소 데이터가 지연되었을 수 있습니다.';
    return '청산 데이터를 불러오는 중입니다…';
  }

  function renderLiqEmpty(kind) {
    const sum = document.getElementById('liqSummary');
    const clusters = document.getElementById('liqClusters');
    const list = document.getElementById('liqPriceList');
    if (clusters) clusters.innerHTML = '';
    if (list) list.innerHTML = '';
    if (sum) sum.innerHTML = `<div class="pa-state-msg">${liqStateMessage(kind)}</div>`;
    clearHeatmapCanvas();
  }

  async function loadLiquidationHeatmap() {
    const sym = getApiSymbol();
    // 백엔드는 24h만 지원. 비지원 기간 선택 시 안내(데이터 위조 금지).
    if (!SUPPORTED_LIQ_PERIODS.includes(selectedLiqPeriod)) {
      liqData = null; lastHeatmapData = null;
      removeLiqOverlay(); setLiqOverlayButtonEnabled(false);
      const sum = document.getElementById('liqSummary');
      const clusters = document.getElementById('liqClusters');
      const list = document.getElementById('liqPriceList');
      if (clusters) clusters.innerHTML = '';
      if (list) list.innerHTML = '';
      if (sum) sum.innerHTML = `<div class="pa-state-msg delayed">${esc(selectedLiqPeriod)} 기간 청산 데이터는 준비 중입니다. 현재는 24h 기준으로 제공됩니다.</div>`;
      clearHeatmapCanvas();
      renderFunding();
      return;
    }
    try {
      const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const r = await requester(`/v1/charts/liquidation-heatmap?symbol=${sym}`, { credentials: 'include' });
      if (!r || !r.ok) {
        liqData = null; lastHeatmapData = null;
        removeLiqOverlay(); setLiqOverlayButtonEnabled(false);
        renderLiqEmpty('error');
        renderFunding();
        return;
      }
      const d = await r.json().catch(() => null);
      if (!d || !d.success || !d.data) {
        liqData = null; lastHeatmapData = null;
        removeLiqOverlay(); setLiqOverlayButtonEnabled(false);
        const reason = (d && d.error) ? String(d.error).toLowerCase() : '';
        renderLiqEmpty(reason.includes('insufficient') ? 'insufficient' : 'unsupported');
        renderFunding();
        return;
      }
      liqData = d.data;
      lastHeatmapData = d.data;
      setLiqOverlayButtonEnabled(true);
      renderLiq();
      renderFunding();
      if (window._liqOverlayActive) applyLiqOverlay(d.data);
    } catch (e) {
      liqData = null; lastHeatmapData = null;
      removeLiqOverlay(); setLiqOverlayButtonEnabled(false);
      renderLiqEmpty('error');
      renderFunding();
    }
  }

  function renderLiq() {
    const data = liqData;
    if (!data) return;
    const sum = document.getElementById('liqSummary');
    if (sum) {
      sum.innerHTML = `
        <div class="flex-between">
          <span>롱 청산 24h: <b>${fmtUSD(data.total_long_liq_24h)}</b></span>
          <span>숏 청산 24h: <b>${fmtUSD(data.total_short_liq_24h)}</b></span>
        </div>`;
    }
    const clusters = document.getElementById('liqClusters');
    if (clusters) {
      const ml = data.max_long_cluster, ms = data.max_short_cluster;
      const cp = Number(data.current_price) || 0;
      const dist = p => cp > 0 ? `${(((p - cp) / cp) * 100).toFixed(2)}%` : '--';
      clusters.innerHTML = `
        ${ml ? `<div>상단/하단 롱 청산 밀집: <b>$${fmtPrice(ml.price)}</b> <span class="text-muted">(현재가 대비 ${dist(ml.price)})</span></div>` : ''}
        ${ms ? `<div>숏 청산 밀집: <b>$${fmtPrice(ms.price)}</b> <span class="text-muted">(현재가 대비 ${dist(ms.price)})</span></div>` : ''}
        <div class="text-muted">현재가: $${fmtPrice(cp)}</div>`;
    }
    renderLiqList(data);
    drawHeatmap(data);
  }

  // 미니 가격대 리스트 (상위 청산 강도 구간) — 클릭 시 차트 포커스
  function renderLiqList(data) {
    const list = document.getElementById('liqPriceList');
    if (!list) return;
    const buckets = Array.isArray(data.buckets) ? data.buckets : [];
    if (!buckets.length) { list.innerHTML = ''; return; }
    const cp = Number(data.current_price) || 0;
    const ranked = buckets
      .map(b => ({ ...b, total: (Number(b.long_liq) || 0) + (Number(b.short_liq) || 0) }))
      .filter(b => b.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    if (!ranked.length) { list.innerHTML = ''; return; }
    const maxTotal = ranked[0].total || 1;
    list.innerHTML = ranked.map(b => {
      const isLong = (Number(b.long_liq) || 0) >= (Number(b.short_liq) || 0);
      const side = isLong ? 'long' : 'short';
      const sideLabel = isLong ? 'L' : 'S';
      const dist = cp > 0 ? `${(((b.price - cp) / cp) * 100).toFixed(2)}%` : '--';
      const strengthPct = Math.max(8, Math.round((b.total / maxTotal) * 60));
      return `<div class="pa-liq-item" role="button" tabindex="0" data-price="${b.price}" title="해당 가격대로 차트 포커스 이동">
        <span class="pa-liq-side ${side}">${sideLabel}</span>
        <span class="pa-liq-price">$${fmtPrice(b.price)}</span>
        <span class="pa-liq-strength" style="width:${strengthPct}px"></span>
        <span class="pa-liq-dist">${dist}</span>
      </div>`;
    }).join('');
  }

  function clearHeatmapCanvas() {
    const cv = document.getElementById('liqHeatmapCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }

  function drawHeatmap(data) {
    const cv = document.getElementById('liqHeatmapCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const buckets = data.buckets;
    if (!Array.isArray(buckets) || !buckets.length) return;
    const maxAmt = Math.max(...buckets.map(b => Math.max(b.long_liq, b.short_liq)));
    if (!Number.isFinite(maxAmt) || maxAmt <= 0) return;
    const sortedByPrice = [...buckets].sort((a, b) => b.price - a.price);
    const rowH = H / sortedByPrice.length;
    const centerX = W / 2;
    const priceMin = Math.min(...buckets.map(b => b.price));
    const priceMax = Math.max(...buckets.map(b => b.price));
    const priceRange = priceMax - priceMin;
    if (!Number.isFinite(priceRange) || priceRange <= 0) return;
    const curPriceY = H - ((data.current_price - priceMin) / priceRange) * H;
    // 롱 청산: 브랜드 프라이머리 / 숏 청산: 브랜드 딥(파란색 미사용)
    sortedByPrice.forEach((b, i) => {
      const y = i * rowH;
      const longW = (b.long_liq / maxAmt) * (W * 0.45);
      const longAlpha = Math.min(1, 0.3 + b.long_liq / maxAmt * 0.7);
      ctx.fillStyle = `rgba(146,18,48,${longAlpha})`;
      ctx.fillRect(centerX - longW, y + 0.5, longW, rowH - 1);
      const shortW = (b.short_liq / maxAmt) * (W * 0.45);
      const shortAlpha = Math.min(1, 0.3 + b.short_liq / maxAmt * 0.7);
      ctx.fillStyle = `rgba(74,8,23,${shortAlpha})`;
      ctx.fillRect(centerX, y + 0.5, shortW, rowH - 1);
    });
    ctx.fillStyle = '#8E7D72';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`$${priceMax.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 4, 12);
    ctx.fillText(`$${priceMin.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 4, H - 4);
    ctx.strokeStyle = '#921230';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, curPriceY);
    ctx.lineTo(W, curPriceY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#921230';
    ctx.textAlign = 'right';
    ctx.fillText('현재가 ' + data.current_price.toLocaleString('en-US', { maximumFractionDigits: 0 }), W - 4, curPriceY - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, H);
    ctx.stroke();
  }

  // ─────────── 차트 오버레이 + 포커스 ───────────
  window._liqOverlayActive = false;
  window._toggleLiqOverlay = function() {
    if (window.requireLogin && !window.requireLogin('청산 히트맵')) return;
    window._liqOverlayActive = !window._liqOverlayActive;
    const btn = document.getElementById('liqOverlayBtn');
    if (window._liqOverlayActive) {
      if (btn) { btn.classList.add('is-active'); btn.textContent = '차트 표시 중'; }
      if (lastHeatmapData) applyLiqOverlay(lastHeatmapData); else loadLiquidationHeatmap();
    } else {
      if (btn) { btn.classList.remove('is-active'); btn.textContent = '차트 표시'; }
      removeLiqOverlay();
    }
  };

  function applyLiqOverlay(data) {
    if (!window.chart || !window.chart.overlay) return;
    removeLiqOverlay();
    // 기본은 간결하게: 청산 강도 상위 5개 구간만 표시
    const top = [...data.buckets]
      .sort((a, b) => (b.long_liq + b.short_liq) - (a.long_liq + a.short_liq))
      .slice(0, 5);
    for (const b of top) {
      const isLong = b.long_liq > b.short_liq;
      const color = isLong ? 'rgba(146,18,48,0.55)' : 'rgba(74,8,23,0.55)';
      window.chart.addDrawing({
        type: 'hline', price: b.price, color, lineWidth: 1, dashed: true,
        label: `청산 ${isLong ? 'L' : 'S'} ${fmtUSD(Math.max(b.long_liq, b.short_liq)).replace('$','')}`,
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

  // 가격대 클릭 → 차트 해당 구간으로 포커스(가능한 API 탐색, 없으면 임시 강조선)
  function focusChartOnPrice(price) {
    price = Number(price);
    if (!Number.isFinite(price) || !window.chart) return;
    try {
      if (typeof window.chart.focusPrice === 'function') { window.chart.focusPrice(price); return; }
      if (typeof window.chart.scrollToPrice === 'function') { window.chart.scrollToPrice(price); return; }
      if (window.chart.overlay && typeof window.chart.addDrawing === 'function') {
        window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d._calcOwner !== 'liq_focus');
        window.chart.addDrawing({ type: 'hline', price, color: '#921230', lineWidth: 2, dashed: false, label: `포커스 $${fmtPrice(price)}`, _calcOwner: 'liq_focus' });
        window.chart._dirty = true;
        if (window.showToast) window.showToast(`$${fmtPrice(price)} 구간을 차트에 표시했습니다`, '#921230');
        setTimeout(() => {
          if (!window.chart || !window.chart.overlay) return;
          window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d._calcOwner !== 'liq_focus');
          window.chart._dirty = true;
        }, 6000);
      }
    } catch (e) {}
  }

  // ─────────── AI 포지션 해석 (참고용, 단정·권유 금지) ───────────
  function renderAiInterpretation() {
    const el = document.getElementById('paAiText');
    if (!el) return;
    const tp = lsData && lsData.top_position && lsData.top_position['1h'];
    const gl = lsData && lsData.global && lsData.global['1h'];
    if (!tp && !gl && !liqData) {
      el.textContent = '데이터를 불러오면 참고 해석이 표시됩니다.';
      return;
    }
    const sentences = [];
    if (tp) {
      const bias = biasFromRatio(Number(tp.ratio));
      if (bias.key === 'strong_long') sentences.push('현재 대형 포지션은 롱 비중이 높은 편입니다. 다만 롱 쏠림이 강해 하방 변동성 발생 시 롱 청산 압력이 커질 수 있습니다.');
      else if (bias.key === 'long') sentences.push('대형 포지션이 롱 쪽으로 다소 기울어 있습니다.');
      else if (bias.key === 'strong_short') sentences.push('현재 대형 포지션은 숏 비중이 높은 편입니다. 다만 숏 쏠림이 강해 상방 변동성 발생 시 숏 청산 압력이 커질 수 있습니다.');
      else if (bias.key === 'short') sentences.push('대형 포지션이 숏 쪽으로 다소 기울어 있습니다.');
      else sentences.push('대형 포지션의 롱·숏은 균형에 가깝습니다.');
    }
    if (tp && gl) {
      const tpLong = Number(tp.long_pct), glLong = Number(gl.long_pct);
      if (Number.isFinite(tpLong) && Number.isFinite(glLong) && Math.abs(tpLong - glLong) >= 12) {
        sentences.push('TOP 포지션과 전체 참여자의 방향이 다소 엇갈려, 대형 자금과 일반 참여자의 시각 차이가 관찰됩니다.');
      }
    }
    if (liqData && typeof liqData.funding_rate === 'number') {
      const fr = liqData.funding_rate;
      if (fr > 0.05) sentences.push('펀딩비가 높은 양수로 롱 비용 부담이 큰 편입니다.');
      else if (fr < -0.05) sentences.push('펀딩비가 낮은 음수로 숏 비용 부담이 큰 편입니다.');
    }
    if (liqData && liqData.max_long_cluster && liqData.current_price) {
      sentences.push('청산 밀집 구간이 가까울수록 변동성 확대 시 가격이 해당 구간에 반응할 수 있어 함께 보는 것이 좋습니다.');
    }
    sentences.push('위 내용은 시장 데이터 기반 참고 해석이며 매매를 권유하지 않습니다.');
    el.textContent = sentences.join(' ');
  }

  // ─────────── 리스크 체크리스트 ───────────
  function setRisk(key, level, label) {
    const el = document.querySelector(`#paRiskGrid .pa-risk-badge[data-key="${key}"]`);
    if (!el) return;
    el.setAttribute('data-level', level);
    const b = el.querySelector('b');
    if (b) b.textContent = label;
  }
  function renderRiskChecklist() {
    // 롱·숏 쏠림 (전체 1h skew)
    const gl = lsData && lsData.global && lsData.global['1h'];
    if (gl) {
      const skew = Math.abs(Number(gl.long_pct) - Number(gl.short_pct));
      setRisk('ls', skew >= 30 ? 'high' : skew >= 15 ? 'mid' : 'low', skew >= 30 ? '강함' : skew >= 15 ? '보통' : '낮음');
    } else setRisk('ls', 'low', '데이터 없음');

    // 대형 자금 편향 (TOP 포지션 1h)
    const tp = lsData && lsData.top_position && lsData.top_position['1h'];
    if (tp) {
      const bias = biasFromRatio(Number(tp.ratio));
      const lvl = (bias.key === 'strong_long' || bias.key === 'strong_short') ? 'high' : (bias.key === 'long' || bias.key === 'short') ? 'mid' : 'low';
      setRisk('bigmoney', lvl, lvl === 'high' ? '강함' : lvl === 'mid' ? '보통' : '낮음');
    } else setRisk('bigmoney', 'low', '데이터 없음');

    // 펀딩 부담
    if (liqData && typeof liqData.funding_rate === 'number') {
      const fr = Math.abs(liqData.funding_rate);
      setRisk('funding', fr > 0.05 ? 'high' : fr > 0.01 ? 'mid' : 'low', fr > 0.05 ? '높음' : fr > 0.01 ? '보통' : '낮음');
    } else setRisk('funding', 'low', '데이터 없음');

    // 청산 밀집 구간 (현재가 근접도)
    if (liqData && liqData.max_long_cluster && liqData.current_price) {
      const cp = Number(liqData.current_price);
      const near = Math.min(
        liqData.max_long_cluster ? Math.abs((liqData.max_long_cluster.price - cp) / cp) : 1,
        liqData.max_short_cluster ? Math.abs((liqData.max_short_cluster.price - cp) / cp) : 1
      );
      setRisk('liq', near <= 0.01 ? 'high' : near <= 0.03 ? 'mid' : 'low', near <= 0.01 ? '근접' : near <= 0.03 ? '주의' : '여유');
    } else setRisk('liq', 'low', '데이터 없음');

    // 변동성 주의 (24h 총 청산 규모 기반 간이 판단)
    if (liqData) {
      const tot = (Number(liqData.total_long_liq_24h) || 0) + (Number(liqData.total_short_liq_24h) || 0);
      setRisk('vol', tot > 5e7 ? 'high' : tot > 1e7 ? 'mid' : 'low', tot > 5e7 ? '높음' : tot > 1e7 ? '보통' : '낮음');
    } else setRisk('vol', 'low', '데이터 없음');
  }

  // ─────────── 전체 렌더 오케스트레이션 ───────────
  function renderAll() {
    setHeaderSymbol();
    renderConsensus();
    renderLsRows();
    renderBigMoney();
    renderSummary();
    renderLiq();        // liqData 있으면 렌더
    renderAiInterpretation();
    // 펀딩 정보 / 리스크 체크리스트 섹션은 index.html에서 제거됨(사용자 요청).

    // 상태 배지 판정
    const hasLs = !!lsData;
    const hasLiq = !!liqData;
    if (hasLs && hasLiq) setStatus('ok');
    else if (hasLs || hasLiq) setStatus('partial');
    else setStatus('error');
    setUpdatedNow();
  }

  window._loadPositionData = async function() {
    setStatus('loading');
    const [ls, ] = await Promise.all([loadLongShortDetailed(), loadLiquidationHeatmap()]);
    renderAll();
  };

  // ─────────── 이벤트 바인딩 ───────────
  // 롱숏 기간 탭
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('#lsTfTabs .pa-tab');
    if (!tab) return;
    const tf = tab.dataset.tf;
    if (!tf || tf === selectedTf) return;
    selectedTf = tf;
    document.querySelectorAll('#lsTfTabs .pa-tab').forEach(t => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    renderLsRows();
  });

  // 청산 기간 탭
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('#liqPeriodTabs .pa-tab');
    if (!tab) return;
    const p = tab.dataset.period;
    if (!p || p === selectedLiqPeriod) return;
    selectedLiqPeriod = p;
    document.querySelectorAll('#liqPeriodTabs .pa-tab').forEach(t => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    loadLiquidationHeatmap();
  });

  // 청산 가격대 리스트 클릭/키보드 → 차트 포커스
  document.addEventListener('click', (e) => {
    const item = e.target.closest('#liqPriceList .pa-liq-item');
    if (!item) return;
    focusChartOnPrice(item.dataset.price);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest && e.target.closest('#liqPriceList .pa-liq-item');
    if (!item) return;
    e.preventDefault();
    focusChartOnPrice(item.dataset.price);
  });

  // 포지션 탭 열릴 때 로드
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.p === 'position') window._loadPositionData();
  });

  // 30초 주기 갱신 (탭 활성 + 문서 표시 중)
  setInterval(() => {
    if (document.hidden) return;
    const active = document.querySelector('.right-tab.active');
    if (active && active.dataset.p === 'position') window._loadPositionData();
  }, 30000);

  // 종목 변경 시 갱신
  document.addEventListener('symbolChanged', () => {
    const active = document.querySelector('.right-tab.active');
    if (active && active.dataset.p === 'position') window._loadPositionData();
  });

  window._retryLiquidationHeatmap = loadLiquidationHeatmap;

  // _selectSym 래핑(기존 함수 보존) → 종목 변경 후 symbolChanged 발생
  // 미지원(가격/캔들 없음) 종목 선택 시 1회 안내 토스트(차단하지 않음).
  let _unsupNotified = {};
  function _showSymToast(msg) {
    let t = document.getElementById('_symToast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_symToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;'
        + 'background:var(--color-surface-raised,#1a1a1a);color:var(--color-text,#fff);'
        + 'border:1px solid var(--color-primary,#921230);border-radius:8px;padding:10px 16px;'
        + 'font-size:13px;max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,0.25);opacity:0;transition:opacity .2s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
  }
  function _notifyIfUnsupported(sym) {
    if (!sym || _unsupNotified[sym]) return;
    // 가격 검증 결과는 비동기로 채워지므로 약간 지연 후 확인.
    setTimeout(() => {
      try {
        const valid = window._wlPriceValid || {};
        if (valid[sym] === false) {
          _unsupNotified[sym] = true;
          _showSymToast('이 종목은 현재 가격·차트 데이터를 제공하지 않습니다. 참고용 정보가 제한될 수 있습니다.');
        }
      } catch (e) {}
    }, 1200);
  }

  function _hookSelectSym() {
    const orig = window._selectSym;
    if (typeof orig !== 'function' || orig._symEvtHooked) return;
    const wrapped = async function(sym) {
      const r = await orig.apply(this, arguments);
      try { document.dispatchEvent(new CustomEvent('symbolChanged', { detail: { symbol: sym } })); } catch (e) {}
      // 선택한 종목이 가격/캔들 미지원으로 확인된 경우 안내(차단하지 않음).
      try { _notifyIfUnsupported(sym); } catch (e) {}
      return r;
    };
    wrapped._symEvtHooked = true;
    window._selectSym = wrapped;
  }
  _hookSelectSym();
  setTimeout(_hookSelectSym, 1500);

  // 타임프레임 변경 시 청산 오버레이 재적용 (차트 재로딩으로 hline 제거됨)
  function reapplyLiqOverlay() {
    if (!window._liqOverlayActive) return;
    if (lastHeatmapData) applyLiqOverlay(lastHeatmapData); else loadLiquidationHeatmap();
  }
  function _hookSetTimeframe() {
    const orig = window.setTimeframe;
    if (typeof orig !== 'function' || orig._liqTfHooked) return;
    const wrapped = function() {
      const r = orig.apply(this, arguments);
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
