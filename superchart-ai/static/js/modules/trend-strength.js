// ═══════════════════════════════════════════════════════════════
// trend-strength.js — 추세강도 분석 대시보드 (#mtf)
//
// 매수/매도 추천이 아니라 추세 방향·강도·지속성·약화 가능성·거래량 동반·
// 변동성 리스크·시간대 정렬을 참고용으로 보여주는 분석 패널.
// 데이터: /v1/charts/ind-mtf (TF별 강도 v/max_signals) + /v1/charts/candles
// (구성 요소·가격 구조·거래량·변동성 파생). window.loadMTF 를 오버라이드한다
// (기존 minified auth.js의 loadMTF 대체). 브랜드 컬러만, 파란색/네온/이모지 금지.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const TFS = ['5m', '15m', '1h', '4h', '1d'];
  const TF_LABEL = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };
  // 종합 가중치(중기 비중 ↑)
  const TF_WEIGHT = { '5m': 0.10, '15m': 0.20, '1h': 0.30, '4h': 0.25, '1d': 0.15 };
  const BASE_TF = '1h'; // 구성 요소·구조 계산 기준 (요청: 현재 시간 기준)

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const fmtP = p => { p = Number(p) || 0; return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (p < 1 ? p.toFixed(6) : p.toFixed(2)); };
  const fmtNum = v => { v = Number(v) || 0; return v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); };
  const reqFetch = (url) => ((typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch)(url, { credentials: 'include' });
  function apiSymbol() { const s = window.curSymbol || 'BTCUSDT'; if (Array.isArray(window.symbols)) { const f = window.symbols.find(x => x.code === s); if (f && f.apiCode) return f.apiCode; } return s; }
  function symShort() { return (window.curSymbol || 'BTCUSDT').replace('USDT', '').replace('KRW-', ''); }

  // 0~100 변환: ind-mtf의 v/max_signals(-1..1 근사)를 0~100 스케일로
  function toScore100(v, max) { const r = max > 0 ? v / max : 0; return Math.round(Math.max(0, Math.min(100, (r + 1) / 2 * 100))); }
  function dirOf(score) { return score >= 60 ? 'up' : score <= 40 ? 'down' : 'neutral'; }

  // ───────── 상태 배지 ─────────
  const TS_STATUS = { loading: ['불러오는 중','loading'], ok: ['정상','ok'], partial: ['일부 데이터','partial'], delayed: ['데이터 지연','delayed'], empty: ['데이터 부족','empty'], error: ['오류','error'] };
  function setStatus(kind) { const b = document.getElementById('tsStatusBadge'); if (!b) return; const s = TS_STATUS[kind] || TS_STATUS.loading; b.textContent = s[0]; b.setAttribute('data-state', s[1]); }
  function setUpdated() { const el = document.getElementById('tsUpdated'); if (!el) return; const d = new Date(); el.textContent = `업데이트 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }
  function setHeaderSymbol() {
    const p = document.getElementById('mtfSymbol'); if (p) p.textContent = symShort();
    const s = document.getElementById('mtfSymbolKr');
    if (s) { let l = ''; if (Array.isArray(window.symbols)) { const u = window.symbols.find(x => x.code === window.curSymbol); if (u) l = u.kr || ''; } s.textContent = l || symShort(); }
    const n = document.getElementById('mtfSymbolImg');
    if (n) { const l = (window.coinImgUrl || {})[window.curSymbol] || ''; if (l) { n.src = l; n.style.display = ''; } else n.style.display = 'none'; }
    const bl = document.getElementById('tsBasisLabel'); if (bl) bl.textContent = `기준 ${TF_LABEL[BASE_TF]}`;
  }

  // ───────── 종합 추세 상태 분류 (0~100) ─────────
  function compositeState(score) {
    if (score >= 80) return { key: 'strong-up', label: '강한 상승 추세', cls: 'ts-state-strong-up' };
    if (score >= 67) return { key: 'up', label: '상승 추세', cls: 'ts-state-up' };
    if (score >= 60) return { key: 'weak-up', label: '약한 상승 추세', cls: 'ts-state-weak-up' };
    if (score > 40) return { key: 'neutral', label: '중립', cls: 'ts-state-neutral' };
    if (score > 33) return { key: 'weak-down', label: '약한 하락 추세', cls: 'ts-state-weak-down' };
    if (score > 20) return { key: 'down', label: '하락 추세', cls: 'ts-state-down' };
    return { key: 'strong-down', label: '강한 하락 추세', cls: 'ts-state-strong-down' };
  }
  function gaugeState(score) {
    if (score >= 80) return '강한 상승 추세';
    if (score >= 60) return '상승 추세';
    if (score >= 41) return '중립';
    if (score >= 21) return '하락 추세';
    return '강한 하락 추세';
  }

  // ───────── 캔들 기반 구성 요소 계산 ─────────
  function analyzeCandles(candles) {
    const out = { ok: false };
    if (!Array.isArray(candles) || candles.length < 30) return out;
    const c = candles.map(x => ({
      o: parseFloat(x.open ?? x.o ?? 0), h: parseFloat(x.high ?? x.h ?? 0),
      l: parseFloat(x.low ?? x.l ?? 0), c: parseFloat(x.close ?? x.c ?? 0),
      v: parseFloat(x.volume ?? x.v ?? 0),
    })).filter(x => x.c > 0);
    if (c.length < 30) return out;
    const closes = c.map(x => x.c);
    const last = closes[closes.length - 1];
    const sma = (arr, n) => { const s = arr.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
    const ma20 = sma(closes, 20), ma50 = sma(closes, Math.min(50, closes.length));
    // 이동평균 정렬
    let maAlign, maDesc;
    if (last > ma20 && ma20 > ma50) { maAlign = 'good'; maDesc = '정배열(상승 우위)'; }
    else if (last < ma20 && ma20 < ma50) { maAlign = 'down'; maDesc = '역배열(하락 우위)'; }
    else { maAlign = 'mixed'; maDesc = '혼조'; }
    // 가격 구조(고저점)
    const recent = c.slice(-20);
    const highs = recent.map(x => x.h), lows = recent.map(x => x.l);
    const firstHalfHigh = Math.max(...highs.slice(0, 10)), secondHalfHigh = Math.max(...highs.slice(10));
    const firstHalfLow = Math.min(...lows.slice(0, 10)), secondHalfLow = Math.min(...lows.slice(10));
    let hhll, hhllDesc;
    if (secondHalfHigh > firstHalfHigh && secondHalfLow > firstHalfLow) { hhll = 'up'; hhllDesc = '고점·저점 상승'; }
    else if (secondHalfHigh < firstHalfHigh && secondHalfLow < firstHalfLow) { hhll = 'down'; hhllDesc = '고점·저점 하락'; }
    else { hhll = 'mixed'; hhllDesc = '혼조'; }
    // 모멘텀(RSI 근사)
    let gain = 0, loss = 0;
    for (let i = closes.length - 14; i < closes.length; i++) { if (i < 1) continue; const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
    const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    let mom, momDesc;
    if (rsi >= 60) { mom = 'good'; momDesc = '상승 모멘텀'; }
    else if (rsi <= 40) { mom = 'down'; momDesc = '하락 모멘텀'; }
    else { mom = 'neutral'; momDesc = '보통'; }
    // 거래량
    const vols = c.map(x => x.v);
    const avgVol = sma(vols, 20), curVol = vols[vols.length - 1];
    const volRatio = avgVol > 0 ? curVol / avgVol : 1;
    // 상승/하락 구간 거래량
    const upVol = c.slice(-20).filter(x => x.c >= x.o).reduce((a, x) => a + x.v, 0);
    const downVol = c.slice(-20).filter(x => x.c < x.o).reduce((a, x) => a + x.v, 0);
    let volState, volDesc;
    if (volRatio >= 1.8) { volState = 'surge'; volDesc = '거래량 급증'; }
    else if (volRatio >= 1.2) { volState = 'good'; volDesc = '거래량 동반'; }
    else if (volRatio >= 0.7) { volState = 'normal'; volDesc = '거래량 보통'; }
    else { volState = 'low'; volDesc = '거래량 부족'; }
    // 변동성(ATR% 근사)
    let trSum = 0; const n = Math.min(14, c.length - 1);
    for (let i = c.length - n; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); trSum += tr; }
    const atr = trSum / n; const atrPct = last > 0 ? (atr / last) * 100 : 0;
    // 과거 변동성 대비
    let prevTrSum = 0; const pn = Math.min(14, c.length - 15);
    for (let i = c.length - 14 - pn; i < c.length - 14; i++) { if (i < 1) continue; const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); prevTrSum += tr; }
    const prevAtr = pn > 0 ? prevTrSum / pn : atr;
    const volChange = prevAtr > 0 ? (atr - prevAtr) / prevAtr * 100 : 0;
    let volaState;
    if (atrPct >= 8) volaState = 'extreme'; else if (atrPct >= 5) volaState = 'high'; else if (atrPct >= 2) volaState = 'mid'; else volaState = 'low';
    // 가격 구조 우위
    const priceStruct = hhll === 'up' ? 'good' : hhll === 'down' ? 'down' : 'mixed';
    // 최근 3/10 캔들 변화
    const chg = (n2) => { const a = closes[closes.length - 1 - n2], b = closes[closes.length - 1]; return a > 0 ? (b - a) / a * 100 : 0; };
    const chg3 = chg(3), chg10 = chg(10);
    // 지지/저항 (최근 고저점)
    const hi = Math.max(...recent.map(x => x.h)), lo = Math.min(...recent.map(x => x.l));
    const range = hi - lo;
    const pos = range > 0 ? ((last - lo) / range) * 100 : 50;
    Object.assign(out, {
      ok: true, last, ma20, ma50, maAlign, maDesc, hhll, hhllDesc, priceStruct,
      rsi, mom, momDesc, volRatio, upVol, downVol, volState, volDesc,
      atrPct, volChange, volaState, chg3, chg10, hi, lo, pos,
    });
    return out;
  }

  // ───────── 메인 로드 ─────────
  let lastData = null;
  async function load() {
    setHeaderSymbol();
    setStatus('loading');
    const grid = document.getElementById('tsSummary');
    if (grid) grid.innerHTML = '<div class="ts-state-msg">추세강도 데이터를 계산하는 중입니다. 가격 흐름, 모멘텀, 거래량, 변동성을 함께 확인하고 있습니다.</div>';
    const sym = apiSymbol();
    try {
      // TF별 강도
      const results = await Promise.all(TFS.map(tf =>
        reqFetch(`/v1/charts/ind-mtf?symbolId=${sym}&timeframe=${tf}`).then(r => r.ok ? r.json() : null).catch(() => null)
      ));
      const tfScores = {};
      let validCount = 0;
      TFS.forEach((tf, i) => {
        const d = results[i];
        if (d && d.success && d.data && typeof d.data.v === 'number') {
          const score = toScore100(d.data.v, d.data.max_signals || 12);
          tfScores[tf] = { score, raw: d.data.v };
          validCount++;
        } else {
          tfScores[tf] = null;
        }
      });
      // 기준 TF 캔들 (구성 요소)
      let comp = { ok: false };
      try {
        const cr = await reqFetch(`/v1/charts/candles?symbolId=${sym}&timeframe=${BASE_TF}&limit=200`);
        const cd = cr.ok ? await cr.json().catch(() => null) : null;
        const candles = cd && cd.success && cd.data ? (cd.data.candles || cd.data) : null;
        comp = analyzeCandles(candles);
      } catch (e) { comp = { ok: false }; }

      if (validCount === 0 && !comp.ok) {
        setStatus('empty');
        if (grid) grid.innerHTML = '<div class="ts-state-msg">추세강도를 계산하기에 충분한 캔들 데이터가 아직 부족합니다. 데이터가 누적되면 자동으로 반영됩니다.</div>';
        return;
      }

      // 종합 점수 (가중 평균)
      let wSum = 0, sSum = 0;
      TFS.forEach(tf => { if (tfScores[tf]) { wSum += TF_WEIGHT[tf]; sSum += tfScores[tf].score * TF_WEIGHT[tf]; } });
      const composite = wSum > 0 ? Math.round(sSum / wSum) : 50;

      lastData = { tfScores, comp, composite, validCount };
      render(lastData);
      setStatus(validCount >= 4 && comp.ok ? 'ok' : 'partial');
      setUpdated();
    } catch (e) {
      setStatus('error');
      if (grid) grid.innerHTML = '<div class="ts-state-msg">추세강도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    }
  }

  // ───────── 렌더 ─────────
  function render(d) {
    renderSummary(d);
    renderGauge(d);
    renderAlign(d);
    renderStructure(d);
    renderAi(d);
    applyChartToggles();
    // 중복·전문수치 상세 섹션 제거(사용자 요청): 추세 구성 요소/추세 변화 감지/
    // 거래량 확인/변동성 확인. 핵심(종합 점수·시간대별 정렬·가격 구조·AI 해석)만 유지.
    ['tsComponents', 'tsChange', 'tsVolume', 'tsVolatility'].forEach(id => {
      const el = document.getElementById(id); if (el) { el.innerHTML = ''; el.style.display = 'none'; }
    });
  }

  function recentChange(d) {
    // 단기(5m,15m) vs 장기(4h,1d) 및 3/10 캔들 변화로 강화/약화 판단
    const c = d.comp;
    if (!c.ok) return { label: '데이터 부족', cls: 'ts-b-neutral' };
    const short = avgScore(d, ['5m', '15m']);
    const longt = avgScore(d, ['4h', '1d']);
    if (c.chg3 > 0.3 && c.chg10 > 0.3) return { label: '강화 중', cls: 'ts-b-good' };
    if (c.chg3 < -0.3 && c.chg10 < -0.3) return { label: '약화 중', cls: 'ts-b-warn' };
    if (Math.abs(c.chg3) < 0.2 && Math.abs(c.chg10) < 0.2) return { label: '횡보 전환', cls: 'ts-b-neutral' };
    if ((short >= 60 && longt <= 40) || (short <= 40 && longt >= 60)) return { label: '전환 주의', cls: 'ts-b-alert' };
    return { label: '횡보 전환', cls: 'ts-b-neutral' };
  }
  function avgScore(d, tfs) { let n = 0, s = 0; tfs.forEach(tf => { if (d.tfScores[tf]) { s += d.tfScores[tf].score; n++; } }); return n ? s / n : 50; }
  function confidence(d) {
    // 신뢰도: TF 정렬 일관성 + 변동성
    const dirs = TFS.map(tf => d.tfScores[tf] ? dirOf(d.tfScores[tf].score) : null).filter(Boolean);
    if (dirs.length < 3) return { label: '데이터 부족', cls: 'ts-b-neutral' };
    const up = dirs.filter(x => x === 'up').length, down = dirs.filter(x => x === 'down').length;
    const align = Math.max(up, down) / dirs.length;
    const highVola = d.comp.ok && (d.comp.volaState === 'high' || d.comp.volaState === 'extreme');
    if (align >= 0.8 && !highVola) return { label: '높음', cls: 'ts-b-good' };
    if (align >= 0.6) return { label: highVola ? '보통' : '보통', cls: 'ts-b-neutral' };
    return { label: '낮음', cls: 'ts-b-warn' };
  }

  function renderSummary(d) {
    const el = document.getElementById('tsSummary'); if (!el) return;
    const st = compositeState(d.composite);
    const conf = confidence(d);
    const rc = recentChange(d);
    let interp;
    if (st.key.includes('up')) interp = '단기와 중기 흐름이 상승 쪽으로 기울어져 있습니다. 거래량과 주요 가격 구간을 함께 확인하면 추세 지속 여부를 판단하는 데 도움이 됩니다.';
    else if (st.key.includes('down')) interp = '단기와 중기 흐름이 하락 쪽으로 기울어져 있습니다. 반등 시 거래량 동반 여부와 저항 구간을 함께 확인하는 것이 좋습니다.';
    else interp = '뚜렷한 방향성이 약한 중립 구간입니다. 방향성 확인이 필요하며 거래량과 변동성 변화를 함께 살펴보세요.';
    el.innerHTML = `
      <div class="ts-summary">
        <div class="ts-summary-top"><span class="ts-card-title" style="margin:0">종합 추세 상태</span><span class="ts-state-badge ${st.cls}">${st.label}</span></div>
        <div class="ts-summary-grid">
          <div class="row"><span class="k">추세 강도 점수</span><span class="v">${d.composite} / 100</span></div>
          <div class="row"><span class="k">추세 신뢰도</span><span class="v"><span class="ts-badge ${conf.cls}">${conf.label}</span></span></div>
          <div class="row"><span class="k">최근 변화</span><span class="v"><span class="ts-badge ${rc.cls}">${rc.label}</span></span></div>
          <div class="row"><span class="k">유효 시간대</span><span class="v">${d.validCount} / ${TFS.length}</span></div>
        </div>
        <p class="ts-summary-text">${interp}</p>
        <p class="ts-disclaimer-line">참고용 분석이며 매매를 권유하지 않습니다.</p>
      </div>`;
  }

  function renderGauge(d) {
    const el = document.getElementById('tsGauge'); if (!el) return;
    const score = d.composite;
    const stateName = gaugeState(score);
    let note;
    if (score >= 60) note = '상승 추세 참고 구간입니다. 강도가 높을수록 추세가 우위에 있음을 의미하지만 방향을 단정하지 않습니다.';
    else if (score >= 41) note = '중립 구간입니다. 방향성 확인이 필요합니다.';
    else note = '하락 추세 참고 구간입니다. 강도가 낮을수록 하락 우위를 의미하지만 방향을 단정하지 않습니다.';
    el.innerHTML = `
      <div class="ts-gauge-card" role="img" aria-label="추세 강도 점수 ${score}점, 상태 ${stateName}">
        <div class="ts-gauge-head"><span class="ts-card-title" style="margin:0">추세 강도</span><span><span class="ts-gauge-score">${score}</span> <span class="ts-gauge-state ${score>=60?'ts-up':score<=40?'ts-down':'ts-flat'}">${stateName}</span></span></div>
        <div class="ts-gauge-track"><div class="ts-gauge-marker" style="left:${score}%"></div></div>
        <div class="ts-gauge-scale"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
        <div class="ts-gauge-legend">
          <span>0~20 강한 하락</span><span>21~40 하락</span><span>41~59 중립</span><span>60~79 상승</span><span>80~100 강한 상승</span>
        </div>
        <p class="ts-gauge-note">${note}</p>
      </div>`;
  }

  function alignmentSummary(d) {
    const dirs = TFS.map(tf => d.tfScores[tf] ? dirOf(d.tfScores[tf].score) : null);
    const valid = dirs.filter(Boolean);
    if (valid.length < 3) return { label: '데이터 부족', cls: 'ts-b-neutral' };
    const up = valid.filter(x => x === 'up').length, down = valid.filter(x => x === 'down').length;
    const short = dirs.slice(0, 2).filter(Boolean), longt = dirs.slice(3).filter(Boolean);
    const shortUp = short.every(x => x === 'up'), longUp = longt.every(x => x === 'up');
    const shortDown = short.every(x => x === 'down'), longDown = longt.every(x => x === 'down');
    if (up === valid.length) return { label: '상승 정렬', cls: 'ts-b-good' };
    if (down === valid.length) return { label: '하락 정렬', cls: 'ts-b-warn' };
    if (shortUp && longDown) return { label: '단기 반등', cls: 'ts-b-neutral' };
    if (shortDown && longUp) return { label: '단기 조정', cls: 'ts-b-neutral' };
    if (Math.abs(up - down) <= 1) return { label: '혼조', cls: 'ts-b-neutral' };
    if ((short.length && longt.length) && ((shortUp && longDown) || (shortDown && longUp))) return { label: '전환 주의', cls: 'ts-b-alert' };
    return { label: up > down ? '혼조' : '중립', cls: 'ts-b-neutral' };
  }
  function tfDesc(tf, score, dir) {
    if (dir === 'up') return score >= 75 ? '추세 우위' : score >= 65 ? '상승 유지' : '단기 반등';
    if (dir === 'down') return score <= 25 ? '장기 약세' : score <= 35 ? '하락 유지' : '단기 조정';
    return '방향 확인 필요';
  }
  function renderAlign(d) {
    const el = document.getElementById('tsAlign'); if (!el) return;
    const as = alignmentSummary(d);
    const rows = TFS.map(tf => {
      const o = d.tfScores[tf];
      if (!o) return `<div class="ts-tf-row"><span class="ts-tf-label">${TF_LABEL[tf]}</span><span class="ts-tf-dir ts-dir-neutral">데이터 없음</span><div class="ts-tf-bar"><div class="ts-tf-bar-fill" style="width:0%"></div></div><span class="ts-tf-score">-</span><span class="ts-tf-desc">-</span></div>`;
      const dir = dirOf(o.score);
      const dirLabel = dir === 'up' ? '상승' : dir === 'down' ? '하락' : '중립';
      const dirCls = dir === 'up' ? 'ts-dir-up' : dir === 'down' ? 'ts-dir-down' : 'ts-dir-neutral';
      return `<div class="ts-tf-row" role="listitem" aria-label="${TF_LABEL[tf]} ${dirLabel} 강도 ${o.score}점">
        <span class="ts-tf-label">${TF_LABEL[tf]}</span>
        <span class="ts-tf-dir ${dirCls}">${dirLabel}</span>
        <div class="ts-tf-bar"><div class="ts-tf-bar-fill" style="width:${o.score}%"></div></div>
        <span class="ts-tf-score">${o.score}</span>
        <span class="ts-tf-desc">${tfDesc(tf, o.score, dir)}</span>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-align-summary"><span class="ts-card-title" style="margin:0">시간대별 추세 정렬</span><span class="ts-badge ${as.cls}">${as.label}</span></div>
        <div role="list">${rows}</div>
      </div>`;
  }

  function compBadge(state) {
    if (state === 'good' || state === 'up') return ['양호', 'ts-b-good'];
    if (state === 'surge') return ['급증', 'ts-b-alert'];
    if (state === 'high' || state === 'extreme' || state === 'warn') return ['확대', 'ts-b-warn'];
    if (state === 'down') return ['약세', 'ts-b-warn'];
    if (state === 'low') return ['부족', 'ts-b-neutral'];
    return ['보통', 'ts-b-neutral'];
  }
  function renderComponents(d) {
    const el = document.getElementById('tsComponents'); if (!el) return;
    const c = d.comp;
    if (!c.ok) { el.innerHTML = '<div class="ts-card"><div class="ts-card-title">추세 구성 요소</div><div class="ts-state-msg">일부 추세 요소만 계산되었습니다. 거래량 또는 변동성 데이터는 추가 확인 후 반영될 수 있습니다.</div></div>'; return; }
    const items = [
      ['가격 구조', c.priceStruct === 'good' ? '상승 우위' : c.priceStruct === 'down' ? '하락 우위' : '혼조', c.priceStruct === 'good' ? 'good' : c.priceStruct === 'down' ? 'down' : 'neutral'],
      ['이동평균 정렬', c.maDesc, c.maAlign === 'good' ? 'good' : c.maAlign === 'down' ? 'down' : 'neutral'],
      ['모멘텀', c.momDesc, c.mom],
      ['거래량', c.volDesc, c.volState === 'good' || c.volState === 'surge' ? 'good' : c.volState === 'low' ? 'low' : 'neutral'],
      ['변동성', c.volaState === 'extreme' ? '매우 높음' : c.volaState === 'high' ? '확대' : c.volaState === 'mid' ? '보통' : '낮음', c.volaState === 'high' || c.volaState === 'extreme' ? 'warn' : 'neutral'],
      ['고저점 구조', c.hhllDesc, c.hhll === 'up' ? 'good' : c.hhll === 'down' ? 'down' : 'neutral'],
    ];
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-card-title">추세 구성 요소</div>
        ${items.map(([k, desc, state]) => { const b = compBadge(state); return `<div class="ts-comp-row"><span><span class="k">${k}</span> <span class="desc">${esc(desc)}</span></span><span class="ts-badge ${b[1]}">${b[0]}</span></div>`; }).join('')}
      </div>`;
  }

  function renderChange(d) {
    const el = document.getElementById('tsChange'); if (!el) return;
    const c = d.comp;
    if (!c.ok) { el.innerHTML = '<div class="ts-card"><div class="ts-card-title">추세 변화 감지</div><div class="ts-state-msg">데이터 부족으로 추세 변화를 계산하지 못했습니다.</div></div>'; return; }
    const badge3 = c.chg3 > 0.3 ? ['강화 중','ts-b-good'] : c.chg3 < -0.3 ? ['약화 중','ts-b-warn'] : ['유지 중','ts-b-neutral'];
    const badge10 = c.chg10 > 0.5 ? ['강화 중','ts-b-good'] : c.chg10 < -0.5 ? ['약화 중','ts-b-warn'] : ['유지 중','ts-b-neutral'];
    const momBadge = c.rsi >= 55 ? ['증가','ts-b-good'] : c.rsi <= 45 ? ['감소','ts-b-warn'] : ['보통','ts-b-neutral'];
    const volBadge = c.volState === 'good' || c.volState === 'surge' ? ['동반','ts-b-good'] : ['미흡','ts-b-neutral'];
    const hhllBadge = c.hhll === 'up' ? ['상승 구조','ts-b-good'] : c.hhll === 'down' ? ['하락 구조','ts-b-warn'] : ['혼조','ts-b-neutral'];
    // 추세선 이탈(근사): MA20 대비 위치
    const trendlineBadge = c.last > c.ma20 ? ['이평 위','ts-b-good'] : ['이평 아래','ts-b-warn'];
    const rows = [
      ['최근 3개 캔들', `${c.chg3>=0?'+':''}${c.chg3.toFixed(2)}%`, badge3],
      ['최근 10개 캔들', `${c.chg10>=0?'+':''}${c.chg10.toFixed(2)}%`, badge10],
      ['모멘텀', `RSI ${c.rsi.toFixed(0)}`, momBadge],
      ['거래량 동반', '', volBadge],
      ['추세선(이평) 위치', '', trendlineBadge],
      ['고저점 구조 변화', '', hhllBadge],
    ];
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-card-title">추세 변화 감지</div>
        ${rows.map(([k, v, b]) => `<div class="ts-kv-row"><span class="k">${k}${v?` <b style="color:var(--color-text-primary)">${v}</b>`:''}</span><span class="ts-badge ${b[1]}">${b[0]}</span></div>`).join('')}
      </div>`;
  }

  function renderVolume(d) {
    const el = document.getElementById('tsVolume'); if (!el) return;
    const c = d.comp;
    if (!c.ok) { el.innerHTML = '<div class="ts-card"><div class="ts-card-title">거래량 확인</div><div class="ts-state-msg">데이터 부족으로 거래량을 확인하지 못했습니다.</div></div>'; return; }
    const b = c.volState === 'surge' ? ['거래량 급증','ts-b-alert'] : c.volState === 'good' ? ['거래량 동반','ts-b-good'] : c.volState === 'low' ? ['거래량 부족','ts-b-neutral'] : ['거래량 보통','ts-b-neutral'];
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-card-title">거래량 확인</div>
        <div class="ts-kv-row"><span class="k">평균 대비 거래량</span><span class="v">${(c.volRatio*100).toFixed(0)}%</span></div>
        <div class="ts-kv-row"><span class="k">상승 구간 거래량</span><span class="v">${fmtNum(c.upVol)}</span></div>
        <div class="ts-kv-row"><span class="k">하락 구간 거래량</span><span class="v">${fmtNum(c.downVol)}</span></div>
        <div class="ts-kv-row"><span class="k">거래량 동반 여부</span><span><span class="ts-badge ${b[1]}">${b[0]}</span></span></div>
      </div>`;
  }

  function renderVolatility(d) {
    const el = document.getElementById('tsVolatility'); if (!el) return;
    const c = d.comp;
    if (!c.ok) { el.innerHTML = '<div class="ts-card"><div class="ts-card-title">변동성 확인</div><div class="ts-state-msg">데이터 부족으로 변동성을 확인하지 못했습니다.</div></div>'; return; }
    const map = { low: ['낮음','ts-b-good'], mid: ['보통','ts-b-neutral'], high: ['높음','ts-b-warn'], extreme: ['매우 높음','ts-b-alert'] };
    const b = map[c.volaState] || map.mid;
    const impact = (c.volaState === 'high' || c.volaState === 'extreme') ? '변동성이 커져 추세 신뢰도가 낮아질 수 있어 리스크 확인이 필요합니다.' : '변동성은 추세 신뢰도에 큰 부담을 주지 않는 수준입니다.';
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-card-title">변동성 확인</div>
        <div class="ts-kv-row"><span class="k">변동성(ATR%)</span><span class="v">${c.atrPct.toFixed(2)}%</span></div>
        <div class="ts-kv-row"><span class="k">최근 변동성 변화</span><span class="v">${c.volChange>=0?'+':''}${c.volChange.toFixed(0)}%</span></div>
        <div class="ts-kv-row"><span class="k">변동성 등급</span><span><span class="ts-badge ${b[1]}">${b[0]}</span></span></div>
        <p class="ts-mini-note">${impact}</p>
      </div>`;
  }

  function renderStructure(d) {
    const el = document.getElementById('tsStructure'); if (!el) return;
    const c = d.comp;
    if (!c.ok) { el.innerHTML = '<div class="ts-card"><div class="ts-card-title">주요 가격 구조</div><div class="ts-state-msg">데이터 부족으로 가격 구조를 계산하지 못했습니다.</div></div>'; return; }
    const posDesc = c.pos >= 70 ? '상단(저항 근접)' : c.pos <= 30 ? '하단(지지 근접)' : '중간';
    el.innerHTML = `
      <div class="ts-card">
        <div class="ts-card-title">주요 가격 구조</div>
        <div class="ts-kv-row"><span class="k">최근 고점</span><span class="v">$${fmtP(c.hi)}</span></div>
        <div class="ts-kv-row"><span class="k">최근 저점</span><span class="v">$${fmtP(c.lo)}</span></div>
        <div class="ts-kv-row"><span class="k">주요 저항 구간</span><span class="v">$${fmtP(c.hi)}</span></div>
        <div class="ts-kv-row"><span class="k">주요 지지 구간</span><span class="v">$${fmtP(c.lo)}</span></div>
        <div class="ts-kv-row"><span class="k">현재가</span><span class="v">$${fmtP(c.last)}</span></div>
        <div class="ts-kv-row"><span class="k">현재가 위치</span><span class="v">${c.pos.toFixed(0)}% · ${posDesc}</span></div>
        <p class="ts-mini-note">주요 가격 구간은 참고용이며, 실제 가격 반응을 보장하지 않습니다.</p>
      </div>`;
  }

  function renderAi(d) {
    const el = document.getElementById('tsAi'); if (!el) return;
    const st = compositeState(d.composite);
    const c = d.comp;
    const parts = [];
    const short = avgScore(d, ['5m', '15m']), mid = avgScore(d, ['1h', '4h']);
    if (short >= 60 && mid >= 60) parts.push('현재 단기와 중기 흐름은 상승 쪽으로 기울어져 있습니다.');
    else if (short <= 40 && mid <= 40) parts.push('현재 단기와 중기 흐름은 하락 쪽으로 기울어져 있습니다.');
    else parts.push('현재 단기와 중기 흐름이 엇갈려 방향성 확인이 필요합니다.');
    if (c.ok) {
      if (c.volState === 'low') parts.push('다만 거래량 증가가 제한적이고');
      else if (c.volState === 'surge') parts.push('거래량이 크게 늘어나고');
      else parts.push('거래량은 보통 수준이며');
      if (c.volaState === 'high' || c.volaState === 'extreme') parts.push('변동성이 일부 확대되어 있어, 추세 지속 여부는 주요 가격 구간과 거래량 반응을 함께 확인하는 것이 좋습니다.');
      else parts.push('변동성은 안정적인 편이라 주요 가격 구간과 거래량 반응을 함께 확인하면 도움이 됩니다.');
    }
    el.innerHTML = `<div class="ts-card-title">AI 추세 해석</div><div class="ts-ai"><p class="ts-ai-text">${parts.join(' ')}</p><p class="ts-disclaimer-line">참고용 분석이며 매매를 권유하지 않습니다.</p></div>`;
  }

  // ───────── 차트 토글 (graceful: 차트 API 없으면 안내만) ─────────
  function clearChartOverlay() {
    if (!window.chart || !window.chart.overlay) return;
    window.chart.overlay.drawings = window.chart.overlay.drawings.filter(x => x._calcOwner !== 'ts_panel');
    window.chart._dirty = true;
  }
  window._tsToggle = function() {
    const note = document.getElementById('tsToggleNote');
    if (!window.chart || !window.chart.addDrawing || !window.chart.overlay) {
      if (note) note.textContent = '차트 표시는 현재 차트 화면에서 이용할 수 있습니다. 차트가 준비되면 자동으로 반영됩니다.';
      return;
    }
    applyChartToggles();
  };
  function applyChartToggles() {
    if (!window.chart || !window.chart.addDrawing || !window.chart.overlay) return;
    if (!lastData || !lastData.comp.ok) return;
    if (window.curSymbol && apiSymbol() && false) {} // no-op guard
    clearChartOverlay();
    const c = lastData.comp;
    const add = (price, label, color) => { if (Number.isFinite(price) && price > 0) window.chart.addDrawing({ type: 'hline', price, color, lineWidth: 1, dashed: true, label, _calcOwner: 'ts_panel' }); };
    if (document.getElementById('tsTogStructure')?.checked) {
      add(c.hi, '저항 $' + fmtP(c.hi), '#4A0817');
      add(c.lo, '지지 $' + fmtP(c.lo), '#921230');
    }
    if (document.getElementById('tsTogStrength')?.checked) {
      add(c.ma20, '이평20 $' + fmtP(c.ma20), '#6F0E24');
    }
    window.chart._dirty = true;
  }

  // ───────── window.loadMTF 오버라이드 + 트리거 ─────────
  window.loadMTF = load;

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.p === 'mtf') load();
  });
  document.addEventListener('symbolChanged', () => {
    const a = document.querySelector('.right-tab.active');
    if (a && a.dataset.p === 'mtf') load();
  });
  setInterval(() => { if (document.hidden) return; const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'mtf') load(); }, 30000);

  // 탭이 이미 활성인 상태로 로드된 경우 1회 시도
  setTimeout(() => { const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'mtf') load(); }, 1200);
})();
