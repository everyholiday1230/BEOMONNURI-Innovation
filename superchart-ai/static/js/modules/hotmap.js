/**
 * hotmap.js — 히트맵 시장 흐름 분석 대시보드 + 인기종목(#hot) 리스트
 * 의존: window.symbols, window.coinImgUrl, window._selectSym, window._favSymbols
 *
 * 히트맵은 매수/매도 추천이 아니라 시장 강도·거래 집중·변동성·자금 흐름·
 * AI 관심도를 시각화하는 참고용 분석 패널. 브랜드 컬러만, 파란색/네온/이모지 금지.
 * 모든 지표는 /v1/charts/ticker-24hr(24h 기준)에서 파생. 5m~4h는 데이터 부재로
 * 안내 처리(데이터 위조 금지).
 */

/* ─────────── 공통: 티커 맵 캐시 ─────────── */
let _tickerCache = { ts: 0, map: null };
const _TICKER_CACHE_TTL = 8000;

function _hmFormatParts(code) {
  code = code || '';
  if (code.includes('KRW-')) return { base: code.replace('KRW-', ''), quote: '/KRW', market: 'KRW' };
  if (code.endsWith('USDT')) return { base: code.replace('USDT', ''), quote: '/USDT', market: 'USDT' };
  if (code.endsWith('BTC')) return { base: code.replace('BTC', ''), quote: '/BTC', market: 'BTC' };
  return { base: code, quote: '/USD', market: 'USDT' };
}

async function _getTickerMap() {
  if (_tickerCache.map && Date.now() - _tickerCache.ts < _TICKER_CACHE_TTL) return _tickerCache.map;
  const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
  const r = await requester('/v1/charts/ticker-24hr', { credentials: 'include' }).catch(() => null);
  if (!r || !r.ok) return _tickerCache.map || {};
  const all = await r.json().catch(() => []);
  const map = {};
  if (Array.isArray(all)) all.forEach(t => { if (t && t.symbol) map[t.symbol] = t; });
  _tickerCache = { ts: Date.now(), map };
  return map;
}

/* ─────────── 카테고리 분류 (간이) ─────────── */
const _HM_CAT = {
  major: ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','TRX'],
  defi: ['UNI','AAVE','MKR','CRV','COMP','SNX','LDO','DYDX','PENDLE','CAKE','SUSHI','GMX','JUP'],
  ai: ['FET','RENDER','TAO','AGIX','WLD','AI','ARKM','KAITO','VIRTUAL','GRASS'],
  layer1: ['ETH','SOL','ADA','AVAX','NEAR','APT','SUI','TON','ICP','ATOM','DOT','SEI','TIA','INJ','KAS'],
  meme: ['DOGE','SHIB','PEPE','BONK','FLOKI','WIF','TRUMP','PENGU','BOME','MEME','FARTCOIN','TURBO'],
};
function _hmCategory(base) {
  base = (base || '').toUpperCase();
  const cats = [];
  for (const [k, arr] of Object.entries(_HM_CAT)) if (arr.includes(base)) cats.push(k);
  if (!cats.includes('major') && !cats.includes('layer1')) cats.push('alt');
  return cats;
}

/* ─────────── 상태 ─────────── */
const HM = {
  mode: 'change',       // change|turnover|volume|volatility|ai|liquidation|flow|strength
  tf: '24h',            // 5m|15m|1h|4h|24h (24h만 실제)
  market: 'all',        // all|USDT|BTC|KRW
  category: 'all',      // all|major|alt|defi|ai|layer1|meme|watch
  turnoverTop: 'all',   // all|100|50|20
  changeFilter: 'all',  // all|up|down|spike
  watchOnly: false,
  search: '',
  size: 'turnover',     // mktcap|turnover|volume|equal
  color: 'change',      // change|volatility|ai
  density: 'standard',  // simple|standard|detail
  group: 'all',         // all|market|category|watch
  topTab: 'gainers',    // gainers|losers|turnover|volatility|ai
  selected: null,
  rows: [],
  status: 'loading',
};
const _SUPPORTED_TF = ['24h'];

function favSet() { try { return new Set(window._favSymbols || []); } catch { return new Set(); } }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const fmtNum = v => { v = Number(v) || 0; return v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); };
const fmtPrice = p => { if (window.PriceStatus) { const n = window.PriceStatus.formatNumber(p); if (n != null) return n.replace(/^₩/, ''); } p = Number(p) || 0; return p >= 1000 ? p.toLocaleString('en-US',{maximumFractionDigits:2}) : (p < 1 ? p.toFixed(6) : p.toFixed(2)); };

/* ─────────── 행 빌드 + AI 관심도 ─────────── */
function buildRows() {
  return _getTickerMap().then(map => {
    const syms = (window.symbols || []);
    const imgs = window.coinImgUrl || {};
    const favs = favSet();
    const rows = [];
    for (const s of syms) {
      const t = map[s.apiCode || s.code] || map[s.code];
      if (!t) continue;
      const pct = parseFloat(t.priceChangePercent || 0);
      const last = parseFloat(t.lastPrice || 0);
      const high = parseFloat(t.highPrice || 0);
      const low = parseFloat(t.lowPrice || 0);
      const vol = parseFloat(t.volume || 0);
      const qv = parseFloat(t.quoteVolume || 0);
      const turnover = qv > 0 ? qv : (last > 0 && vol > 0 ? last * vol : 0);
      const volatility = (high > 0 && low > 0 && last > 0) ? ((high - low) / last) * 100 : 0;
      const { base, quote, market } = _hmFormatParts(s.code);
      // 가격 유효성 (data-status.js)
      const pv = window.PriceStatus ? window.PriceStatus.validate(last) : { valid: (Number.isFinite(last) && last > 0), status: 'NO_PRICE' };
      rows.push({
        code: s.code, base, quote, market,
        kr: s.kr || s.display_name_ko || '',
        asset: s.asset || 'crypto',
        cats: _hmCategory(base),
        img: imgs[s.code] || '',
        pct, last, high, low, vol, turnover, volatility,
        priceValid: pv.valid, priceStatus: pv.status,
        isFav: favs.has(s.code),
      });
    }
    // 유효 가격 종목만 랭킹/색상 계산에 사용. 제외 수 집계.
    const valid = rows.filter(r => r.priceValid && Number.isFinite(r.pct));
    rows._excluded = rows.length - valid.length;
    rows._total = rows.length;
    // 상대강도 + AI 관심도 (참고 지표) — 시장 평균 대비 정규화
    if (rows.length) {
      const avgPct = rows.reduce((a, r) => a + r.pct, 0) / rows.length;
      const maxTurn = Math.max(...rows.map(r => r.turnover), 1);
      const maxVol = Math.max(...rows.map(r => r.volatility), 1);
      for (const r of rows) {
        r.relStrength = r.pct - avgPct;               // 시장 대비 상대 강도
        const nMove = Math.min(1, Math.abs(r.pct) / 10);
        const nTurn = r.turnover > 0 ? Math.log10(r.turnover) / Math.log10(maxTurn) : 0;
        const nVol = Math.min(1, r.volatility / (maxVol || 1));
        const nRel = Math.min(1, Math.abs(r.relStrength) / 10);
        // 가중 합 → 0~100 참고 점수
        r.aiScore = Math.round((nMove * 0.30 + nTurn * 0.30 + nVol * 0.20 + nRel * 0.20) * 100);
        r.strengthScore = Math.round((Math.max(0, (r.pct + 10) / 20) * 0.6 + nTurn * 0.4) * 100);
      }
    }
    return rows;
  });
}

/* ─────────── 필터/정렬 ─────────── */
function applyFilters(rows) {
  let list = rows.slice();
  // 가격 데이터 없는 종목은 랭킹/색상 계산에서 제외
  list = list.filter(r => r.priceValid && Number.isFinite(r.pct));
  if (HM.market !== 'all') list = list.filter(r => r.market === HM.market);
  if (HM.watchOnly || HM.category === 'watch' || HM.group === 'watch') list = list.filter(r => r.isFav);
  else if (HM.category !== 'all') list = list.filter(r => r.cats.includes(HM.category));
  if (HM.changeFilter === 'up') list = list.filter(r => r.pct > 0);
  else if (HM.changeFilter === 'down') list = list.filter(r => r.pct < 0);
  else if (HM.changeFilter === 'spike') list = list.filter(r => Math.abs(r.pct) >= 10);
  if (HM.search) { const q = HM.search.toLowerCase(); list = list.filter(r => r.base.toLowerCase().includes(q) || (r.kr || '').includes(HM.search) || r.code.toLowerCase().includes(q)); }
  // 거래대금 상위 N
  if (HM.turnoverTop !== 'all') { const n = parseInt(HM.turnoverTop); list = list.slice().sort((a, b) => b.turnover - a.turnover).slice(0, n); }
  return list;
}
function sortForMode(list) {
  const m = HM.mode;
  const s = list.slice();
  if (m === 'turnover' || m === 'flow') s.sort((a, b) => b.turnover - a.turnover);
  else if (m === 'volume') s.sort((a, b) => b.vol - a.vol);
  else if (m === 'volatility') s.sort((a, b) => b.volatility - a.volatility);
  else if (m === 'ai') s.sort((a, b) => b.aiScore - a.aiScore);
  else if (m === 'strength') s.sort((a, b) => b.strengthScore - a.strengthScore);
  else s.sort((a, b) => b.pct - a.pct); // change
  return s;
}

/* ─────────── 색상 (브랜드 기반, 파란색 미사용) ─────────── */
function boxColor(r) {
  if (HM.color === 'volatility') {
    const a = Math.min(1, r.volatility / 15);
    return `rgba(146,18,48,${0.06 + a * 0.30})`;
  }
  if (HM.color === 'ai') {
    const a = Math.min(1, r.aiScore / 100);
    return `rgba(146,18,48,${0.06 + a * 0.34})`;
  }
  // 등락률: 상승=primary 계열, 하락=dark accent 계열 (명도/채도로 강도)
  const abs = Math.min(Math.abs(r.pct), 10);
  const a = 0.06 + (abs / 10) * 0.30;
  return r.pct >= 0 ? `rgba(146,18,48,${a})` : `rgba(74,8,23,${a})`;
}
function pctClass(p) { return p > 0 ? 'hm-up' : p < 0 ? 'hm-down' : 'hm-flat'; }

/* ─────────── 시장 강도 판정 ─────────── */
function marketStrength(rows) {
  if (!rows.length) return { label: '중립', cls: 'hm-strength-neutral' };
  const up = rows.filter(r => r.pct > 1).length;
  const down = rows.filter(r => r.pct < -1).length;
  const volHot = rows.filter(r => r.volatility >= 8).length;
  const total = rows.length;
  const top5turn = rows.slice().sort((a, b) => b.turnover - a.turnover).slice(0, 5).reduce((s, r) => s + r.turnover, 0);
  const allTurn = rows.reduce((s, r) => s + r.turnover, 0) || 1;
  const conc = top5turn / allTurn;
  if (conc >= 0.6) return { label: '거래 집중', cls: 'hm-strength-conc' };
  if (volHot / total >= 0.25) return { label: '변동성 확대', cls: 'hm-strength-vol' };
  if (up >= down * 1.5) return { label: '강세 우위', cls: 'hm-strength-bull' };
  if (down >= up * 1.5) return { label: '약세 우위', cls: 'hm-strength-bear' };
  return { label: '중립', cls: 'hm-strength-neutral' };
}

/* ─────────── 상태 배지 ─────────── */
const HM_STATUS = { loading: ['불러오는 중','loading'], ok: ['정상','ok'], partial: ['일부 데이터','partial'], delayed: ['데이터 지연','delayed'], empty: ['데이터 부족','empty'], error: ['오류','error'] };
function setStatus(kind) { HM.status = kind; const b = document.getElementById('hmStatusBadge'); if (!b) return; const s = HM_STATUS[kind] || HM_STATUS.loading; b.textContent = s[0]; b.setAttribute('data-state', s[1]); }
function setUpdated() { const el = document.getElementById('hmUpdated'); if (!el) return; const d = new Date(); el.textContent = `업데이트 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }

/* ─────────── 렌더: 컨트롤/필터 (1회) ─────────── */
function renderControlsOnce() {
  const fEl = document.getElementById('hmFilters');
  if (fEl && !fEl.dataset.built) {
    fEl.dataset.built = '1';
    const row = (label, key, opts) => `<div class="hm-filter-row"><span class="flabel">${label}</span>${opts.map(([v, t]) => `<button class="hm-chip" data-fkey="${key}" data-fval="${v}">${t}</button>`).join('')}</div>`;
    fEl.innerHTML =
      row('마켓', 'market', [['all','전체'],['USDT','USDT'],['BTC','BTC'],['KRW','KRW']]) +
      row('카테고리', 'category', [['all','전체'],['major','메이저'],['alt','알트'],['defi','DeFi'],['ai','AI'],['layer1','Layer1'],['meme','Meme'],['watch','관심종목']]) +
      row('거래대금', 'turnoverTop', [['all','전체'],['100','상위 100'],['50','상위 50'],['20','상위 20']]) +
      row('변동률', 'changeFilter', [['all','전체'],['up','상승만'],['down','하락만'],['spike','급등락']]) +
      row('관심', 'watchOnly', [['false','전체'],['true','내 관심 종목만']]);
  }
  const cEl = document.getElementById('hmControls');
  if (cEl && !cEl.dataset.built) {
    cEl.dataset.built = '1';
    const sel = (label, key, opts, cur) => `<div class="hm-control"><label>${label}</label><select class="hm-select" data-ckey="${key}">${opts.map(([v, t]) => `<option value="${v}" ${v===cur?'selected':''}>${t}</option>`).join('')}</select></div>`;
    cEl.innerHTML =
      sel('박스 크기', 'size', [['mktcap','시가총액'],['turnover','거래대금'],['volume','거래량'],['equal','동일 크기']], HM.size) +
      sel('색상 기준', 'color', [['change','등락률'],['volatility','변동성'],['ai','AI 관심도']], HM.color) +
      sel('보기 밀도', 'density', [['simple','간단히'],['standard','표준'],['detail','상세']], HM.density) +
      sel('그룹화', 'group', [['all','전체'],['market','마켓별'],['category','카테고리별'],['watch','관심 종목']], HM.group);
  }
  syncFilterChips();
}
function syncFilterChips() {
  document.querySelectorAll('#hmFilters .hm-chip').forEach(c => {
    const k = c.dataset.fkey, v = c.dataset.fval;
    let on = false;
    if (k === 'watchOnly') on = String(HM.watchOnly) === v;
    else on = String(HM[k]) === v;
    c.classList.toggle('active', on);
  });
}

/* ─────────── 렌더: 요약 + 통계바 ─────────── */
function renderSummary(rows) {
  const up = rows.filter(r => r.pct > 1).length;
  const down = rows.filter(r => r.pct < -1).length;
  const flat = rows.length - up - down;
  const byTurn = rows.slice().sort((a, b) => b.turnover - a.turnover);
  const byVol = rows.slice().sort((a, b) => b.volatility - a.volatility);
  const byAi = rows.slice().sort((a, b) => b.aiScore - a.aiScore);
  const st = marketStrength(rows);

  const el = document.getElementById('hmSummary');
  if (el) {
    el.innerHTML = `
      <div class="hm-summary">
        <div class="hm-summary-top"><span class="k">시장 강도</span><span class="hm-strength-badge ${st.cls}">${st.label}</span></div>
        <div class="hm-summary-grid">
          <div class="row"><span class="k">상승 종목</span><span class="v hm-up">${up}개</span></div>
          <div class="row"><span class="k">하락 종목</span><span class="v hm-down">${down}개</span></div>
          <div class="row"><span class="k">보합 종목</span><span class="v">${flat}개</span></div>
          <div class="row"><span class="k">거래대금 1위</span><span class="v">${byTurn[0]?esc(byTurn[0].base):'-'}</span></div>
          <div class="row"><span class="k">변동성 1위</span><span class="v">${byVol[0]?esc(byVol[0].base):'-'}</span></div>
          <div class="row"><span class="k">AI 관심도 높은 종목</span><span class="v">${byAi[0]?esc(byAi[0].base):'-'}</span></div>
        </div>
      </div>`;
  }
  const sb = document.getElementById('hmStatBar');
  if (sb) {
    const tot = rows.length || 1;
    const top5 = byTurn.slice(0, 5).reduce((s, r) => s + r.turnover, 0);
    const allT = rows.reduce((s, r) => s + r.turnover, 0) || 1;
    const volHot = rows.filter(r => r.volatility >= 8).length;
    sb.innerHTML = `
      <span class="hm-stat-pill">상승 비중 <b>${Math.round(up/tot*100)}%</b></span>
      <span class="hm-stat-pill">하락 비중 <b>${Math.round(down/tot*100)}%</b></span>
      <span class="hm-stat-pill">보합 비중 <b>${Math.round(flat/tot*100)}%</b></span>
      <span class="hm-stat-pill">상위5 거래 집중 <b>${Math.round(top5/allT*100)}%</b></span>
      <span class="hm-stat-pill">변동성 확대 <b>${volHot}개</b></span>`;
  }
}

/* ─────────── 렌더: 범례 ─────────── */
function renderLegend() {
  const el = document.getElementById('hmLegendBody');
  if (!el) return;
  let items;
  if (HM.color === 'volatility') {
    items = [['rgba(146,18,48,0.36)','매우 큼: 12% 이상'],['rgba(146,18,48,0.24)','큼: 6% ~ 12%'],['rgba(146,18,48,0.12)','보통: 2% ~ 6%'],['rgba(146,18,48,0.06)','작음: 2% 미만']];
  } else if (HM.color === 'ai') {
    items = [['rgba(146,18,48,0.40)','관심 매우 높음: 70 이상'],['rgba(146,18,48,0.26)','관심 높음: 50 ~ 70'],['rgba(146,18,48,0.14)','보통: 30 ~ 50'],['rgba(146,18,48,0.06)','낮음: 30 미만']];
  } else {
    items = [['rgba(146,18,48,0.36)','강한 상승: +5% 이상'],['rgba(146,18,48,0.16)','상승: +1% ~ +5%'],['rgba(146,18,48,0.06)','보합: -1% ~ +1%'],['rgba(74,8,23,0.16)','하락: -1% ~ -5%'],['rgba(74,8,23,0.36)','강한 하락: -5% 이하']];
  }
  el.innerHTML = items.map(([c, t]) => `<div class="hm-legend-item"><span class="hm-legend-swatch" style="background:${c}"></span>${t}</div>`).join('')
    + '<div class="hm-mini-note">색상만으로 판단하지 마세요. 각 종목의 숫자 값을 함께 확인해 주세요.</div>';
}

/* ─────────── 렌더: 메인 박스 ─────────── */
function metaForMode(r) {
  if (HM.mode === 'turnover' || HM.mode === 'flow') return `거래대금 ${fmtNum(r.turnover)}`;
  if (HM.mode === 'volume') return `거래량 ${fmtNum(r.vol)}`;
  if (HM.mode === 'volatility') return `변동성 ${r.volatility.toFixed(2)}%`;
  if (HM.mode === 'ai') return `AI 관심도 ${r.aiScore}`;
  if (HM.mode === 'strength') return `강도 ${r.strengthScore}`;
  return `거래대금 ${fmtNum(r.turnover)}`;
}
function renderBoxes(list) {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const cur = window.curSymbol;
  // 동적 박스 크기: size 기준 값으로 정렬 후 상단 큰 비중 → 컬럼 스팬으로 표현(간단)
  let arr = list.slice(0, 120);
  // 너무 작은 박스 많으면 리스트 폴백(상세 밀도 + 좁은 화면)
  const listFallback = (HM.density === 'detail' && window.matchMedia && window.matchMedia('(max-width: 520px)').matches);
  grid.classList.toggle('list-fallback', listFallback);

  // size 가중치(시각적): 거래대금/거래량/변동성 상위에 grid-column span 2 부여
  let sizeKey = HM.size;
  let spanThreshold = Infinity;
  if (sizeKey !== 'equal') {
    const key = sizeKey === 'volume' ? 'vol' : sizeKey === 'mktcap' ? 'turnover' : 'turnover'; // 시총 데이터 없음 → 거래대금 근사
    const sorted = arr.map(r => r[key]).sort((a, b) => b - a);
    spanThreshold = sorted[Math.min(3, sorted.length - 1)] || Infinity; // 상위 4개 크게
    arr._sizeKey = key;
  }

  grid.innerHTML = arr.map(r => {
    const big = sizeKey !== 'equal' && !listFallback && r[arr._sizeKey] >= spanThreshold;
    const bg = boxColor(r);
    const isCur = r.code === cur;
    const badges = [];
    if (r.isFav) badges.push('<span class="hm-mini-badge">관심</span>');
    if (r.aiScore >= 70) badges.push('<span class="hm-mini-badge">AI</span>');
    const aria = `${r.base} ${r.quote}, 등락률 ${r.pct.toFixed(2)}퍼센트, 거래대금 ${fmtNum(r.turnover)}, 변동성 ${r.volatility.toFixed(2)}퍼센트, AI 관심도 ${r.aiScore}`;
    const dens = HM.density;
    let metaLine = '';
    if (dens !== 'simple') metaLine = `<div class="hm-box-meta">${metaForMode(r)}</div>`;
    if (dens === 'detail') metaLine = `<div class="hm-box-meta">${esc(metaForMode(r))} · 변동성 ${r.volatility.toFixed(1)}% · AI ${r.aiScore}</div>`;
    return `<div class="hm-box ${isCur?'current':''}" role="listitem" tabindex="0" data-code="${esc(r.code)}" aria-label="${esc(aria)}" style="background:${bg};${big?'grid-column:span 2;':''}">
      <div class="hm-box-top"><span class="hm-box-name">${esc(r.base)}</span><span class="hm-box-badges">${badges.join('')}</span></div>
      <div class="hm-box-pct ${pctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</div>
      ${metaLine}
    </div>`;
  }).join('');
}

/* ─────────── 렌더: 상세 카드 ─────────── */
function renderDetail() {
  const el = document.getElementById('hmDetail');
  if (!el) return;
  const r = HM.selected;
  if (!r) { el.innerHTML = ''; return; }
  const isFav = favSet().has(r.code);
  el.innerHTML = `
    <div class="hm-detail">
      <div class="hm-detail-top"><span class="hm-detail-sym">${esc(r.base)}${esc(r.quote)}${isFav?' <span class="hm-mini-badge">관심</span>':''}</span><span class="hm-detail-price">$${fmtPrice(r.last)}</span></div>
      <div class="hm-detail-grid">
        <div class="row"><span class="k">기준(${HM.tf}) 변동률</span><span class="v ${pctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</span></div>
        <div class="row"><span class="k">24시간 변동률</span><span class="v ${pctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</span></div>
        <div class="row"><span class="k">거래대금</span><span class="v">${fmtNum(r.turnover)}</span></div>
        <div class="row"><span class="k">거래량</span><span class="v">${fmtNum(r.vol)}</span></div>
        <div class="row"><span class="k">고가</span><span class="v">$${fmtPrice(r.high)}</span></div>
        <div class="row"><span class="k">저가</span><span class="v">$${fmtPrice(r.low)}</span></div>
        <div class="row"><span class="k">변동성</span><span class="v">${r.volatility.toFixed(2)}%</span></div>
        <div class="row"><span class="k">AI 관심도</span><span class="v">${r.aiScore}</span></div>
        <div class="row"><span class="k">적용 모드</span><span class="v">${modeLabel(HM.mode)}</span></div>
        <div class="row"><span class="k">관심 종목</span><span class="v">${isFav?'추가됨':'미추가'}</span></div>
      </div>
      <div class="hm-detail-actions">
        <button class="hm-btn hm-btn-primary hm-btn-xs" type="button" onclick="window._selectSym&&window._selectSym('${esc(r.code)}')">차트로 보기</button>
        <button class="hm-btn hm-btn-secondary hm-btn-xs" type="button" onclick="window._hmAddFav('${esc(r.code)}')">${isFav?'관심 종목 해제':'관심 종목 추가'}</button>
        <button class="hm-btn hm-btn-ghost hm-btn-xs" type="button" onclick="window._hmOpenAi('${esc(r.code)}')">AI 분석 보기</button>
      </div>
    </div>`;
}
function modeLabel(m) { return ({change:'등락률',turnover:'거래대금',volume:'거래량',volatility:'변동성',ai:'AI 관심도',liquidation:'청산 밀집',flow:'자금 흐름',strength:'강도 점수'})[m] || m; }

/* ─────────── 렌더: 상위 리스트 ─────────── */
function renderTopLists(rows) {
  const el = document.getElementById('hmTopLists');
  if (!el) return;
  const tabs = [['gainers','상승 상위'],['losers','하락 상위'],['turnover','거래대금 상위'],['volatility','변동성 상위'],['ai','AI 관심']];
  let list;
  if (HM.topTab === 'gainers') list = rows.slice().sort((a, b) => b.pct - a.pct);
  else if (HM.topTab === 'losers') list = rows.slice().sort((a, b) => a.pct - b.pct);
  else if (HM.topTab === 'turnover') list = rows.slice().sort((a, b) => b.turnover - a.turnover);
  else if (HM.topTab === 'volatility') list = rows.slice().sort((a, b) => b.volatility - a.volatility);
  else list = rows.slice().sort((a, b) => b.aiScore - a.aiScore);
  list = list.slice(0, 10);
  const valOf = r => {
    if (HM.topTab === 'turnover') return fmtNum(r.turnover);
    if (HM.topTab === 'volatility') return r.volatility.toFixed(2) + '%';
    if (HM.topTab === 'ai') return 'AI ' + r.aiScore;
    return `<span class="${pctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</span>`;
  };
  el.innerHTML = `
    <div class="hm-card-title">상위 종목</div>
    <div class="hm-top-tabs">${tabs.map(([k, t]) => `<button class="hm-chip ${HM.topTab===k?'active':''}" data-toptab="${k}">${t}</button>`).join('')}</div>
    ${list.length ? list.map((r, i) => `
      <div class="hm-top-row" data-code="${esc(r.code)}" role="button" tabindex="0">
        <span class="hm-top-rank">${i+1}</span>
        <span class="hm-top-name">${esc(r.base)} <span class="text-muted" style="font-weight:400">${esc(r.quote)}</span></span>
        <span class="hm-top-val">$${fmtPrice(r.last)}<div style="font-size:10px">${valOf(r)}</div></span>
      </div>`).join('') : '<div class="hm-state-msg">표시할 종목이 없습니다.</div>'}`;
}

/* ─────────── 렌더: AI 요약 ─────────── */
function renderAiSummary(rows) {
  const el = document.getElementById('hmAiSummary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="hm-card-title">AI 히트맵 요약</div><div class="hm-ai"><p class="hm-ai-text">표시할 시장 데이터가 부족합니다.</p></div>`; return; }
  const up = rows.filter(r => r.pct > 1).length, down = rows.filter(r => r.pct < -1).length, tot = rows.length;
  const byTurn = rows.slice().sort((a, b) => b.turnover - a.turnover);
  const allT = rows.reduce((s, r) => s + r.turnover, 0) || 1;
  const conc = byTurn.slice(0, 5).reduce((s, r) => s + r.turnover, 0) / allT;
  const volHot = rows.filter(r => r.volatility >= 8);
  const st = marketStrength(rows);
  const parts = [];
  if (conc >= 0.5) parts.push(`현재 시장은 ${esc(byTurn[0].base)} 등 일부 종목 중심으로 거래대금이 집중되고 있습니다.`);
  else parts.push('거래대금이 비교적 여러 종목에 분산되어 있습니다.');
  const ratio = up / (up + down || 1);
  if (ratio >= 0.6) parts.push('상승 종목 비중이 우세한 편입니다.');
  else if (ratio <= 0.4) parts.push('하락 종목 비중이 우세한 편입니다.');
  else parts.push('상승·하락 종목 비중은 중립에 가깝습니다.');
  if (volHot.length) parts.push(`${esc(volHot[0].base)} 등 일부 종목에서 단기 변동성이 확대되고 있어 거래량과 추세 확인이 필요합니다.`);
  parts.push('위 내용은 시장 데이터 기반 참고용 분석이며, 매매를 권유하지 않습니다.');
  el.innerHTML = `<div class="hm-card-title">AI 히트맵 요약</div><div class="hm-ai"><p class="hm-ai-text">${parts.join(' ')}</p></div>`;
}

/* ─────────── 렌더: 관심 종목 비교 ─────────── */
function renderWatchCompare(rows) {
  const el = document.getElementById('hmWatchCompare');
  if (!el) return;
  const favs = rows.filter(r => r.isFav);
  if (!favs.length) {
    el.innerHTML = `<div class="hm-card-title">관심 종목 비교</div><div class="hm-state-msg">관심 종목을 추가하면 내 관심 종목의 흐름을 시장 전체와 비교할 수 있습니다.</div>`;
    return;
  }
  const avg = arr => arr.length ? arr.reduce((s, r) => s + r.pct, 0) / arr.length : 0;
  const favAvg = avg(favs), mktAvg = avg(rows);
  const favTurn = favs.reduce((s, r) => s + r.turnover, 0);
  const favVol = favs.length ? favs.reduce((s, r) => s + r.volatility, 0) / favs.length : 0;
  const strong = favs.slice().sort((a, b) => b.pct - a.pct)[0];
  const weak = favs.slice().sort((a, b) => a.pct - b.pct)[0];
  const rel = favAvg - mktAvg;
  el.innerHTML = `
    <div class="hm-card-title">관심 종목 비교</div>
    <div class="hm-card">
      <div class="hm-compare-grid">
        <div class="row"><span class="k">내 관심 평균 변동률</span><span class="v ${pctClass(favAvg)}">${favAvg>=0?'+':''}${favAvg.toFixed(2)}%</span></div>
        <div class="row"><span class="k">시장 전체 평균</span><span class="v ${pctClass(mktAvg)}">${mktAvg>=0?'+':''}${mktAvg.toFixed(2)}%</span></div>
        <div class="row"><span class="k">관심 거래대금 합</span><span class="v">${fmtNum(favTurn)}</span></div>
        <div class="row"><span class="k">관심 평균 변동성</span><span class="v">${favVol.toFixed(2)}%</span></div>
        <div class="row"><span class="k">관심 강세 상위</span><span class="v">${strong?esc(strong.base):'-'}</span></div>
        <div class="row"><span class="k">관심 약세 상위</span><span class="v">${weak?esc(weak.base):'-'}</span></div>
      </div>
      <p class="hm-mini-note">내 관심 종목 평균이 시장 평균보다 ${rel>=0?'강한':'약한'} 흐름입니다 (차이 ${rel>=0?'+':''}${rel.toFixed(2)}%p). 참고용 비교이며 매매를 권유하지 않습니다.</p>
    </div>`;
}

/* ─────────── 청산 밀집 모드 (기존 엔드포인트 재사용) ─────────── */
async function renderLiquidationMode() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const sym = (function(){ const s = window.curSymbol || 'BTCUSDT'; if (Array.isArray(window.symbols)) { const f = window.symbols.find(x => x.code === s); if (f && f.apiCode) return f.apiCode; } return s; })();
  grid.classList.remove('list-fallback');
  grid.style.gridTemplateColumns = '1fr';
  grid.innerHTML = `<div class="hm-state-msg">${esc(sym.replace('USDT','/USDT'))} 청산 밀집 데이터를 불러오는 중입니다…</div>`;
  // 비지원 기간 안내(24h만 실제)
  const periodNote = HM.tf === '24h' ? '' : `<div class="hm-mini-note delayed" style="color:var(--color-warning)">${esc(HM.tf)} 기준 청산 데이터는 준비 중입니다. 현재는 24h 기준으로 제공됩니다.</div>`;
  try {
    const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
    const r = await requester(`/v1/charts/liquidation-heatmap?symbol=${sym}`, { credentials: 'include' });
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    if (!d || !d.success || !d.data) {
      const reason = (d && d.error) ? String(d.error).toLowerCase() : '';
      grid.innerHTML = `<div class="hm-state-msg">${reason.includes('insufficient') ? '청산 밀집 데이터를 계산하기에 충분한 거래 정보가 아직 부족합니다. 거래량이 누적되면 자동으로 반영됩니다.' : '이 종목은 청산 데이터를 제공하지 않습니다. (선물 미상장 또는 데이터 미지원)'}</div>`;
      return;
    }
    const data = d.data;
    const cp = Number(data.current_price) || 0;
    const ml = data.max_long_cluster, ms = data.max_short_cluster;
    const dist = p => cp > 0 ? `${(((p - cp) / cp) * 100).toFixed(2)}%` : '-';
    grid.innerHTML = `
      ${periodNote}
      <div class="hm-card">
        <div class="hm-detail-grid">
          <div class="row"><span class="k">현재가</span><span class="v">$${fmtPrice(cp)}</span></div>
          <div class="row"><span class="k">롱 청산 24h</span><span class="v">${fmtNum(data.total_long_liq_24h)}</span></div>
          <div class="row"><span class="k">숏 청산 24h</span><span class="v">${fmtNum(data.total_short_liq_24h)}</span></div>
          ${ml?`<div class="row"><span class="k">하단 롱 청산 밀집</span><span class="v">$${fmtPrice(ml.price)} (${dist(ml.price)})</span></div>`:''}
          ${ms?`<div class="row"><span class="k">상단 숏 청산 밀집</span><span class="v">$${fmtPrice(ms.price)} (${dist(ms.price)})</span></div>`:''}
        </div>
        <p class="hm-mini-note">청산 히트맵은 시장 데이터 기반 참고 정보이며, 특정 가격 도달을 보장하지 않습니다.</p>
      </div>`;
    setStatus('ok'); setUpdated();
  } catch (e) {
    grid.innerHTML = '<div class="hm-state-msg">청산 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    setStatus('error');
  }
}

/* ─────────── 시간 기준 안내 ─────────── */
function renderTimeNote() {
  const el = document.getElementById('hmTimeNote');
  const lab = document.getElementById('hmBasisLabel');
  if (lab) lab.textContent = `기준 ${HM.tf}`;
  if (!el) return;
  el.innerHTML = _SUPPORTED_TF.includes(HM.tf) ? '' : `<span style="color:var(--color-warning)">${esc(HM.tf)} 기준 데이터는 준비 중입니다. 현재 수치는 24h 기준으로 표시됩니다.</span>`;
}

/* ─────────── 메인 진입점 ─────────── */
window._hmAsset = window._hmAsset || 'crypto';
window.loadHeatmap = async function() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  renderControlsOnce();
  renderTimeNote();
  renderLegend();
  setStatus('loading');
  if (HM.mode === 'liquidation') { await renderLiquidationMode(); return; }
  grid.style.gridTemplateColumns = '';
  grid.innerHTML = '<div class="hm-state-msg" style="grid-column:1/-1">히트맵 데이터를 불러오는 중입니다. 종목별 가격, 거래량, 변동성을 계산하고 있습니다.</div>';
  try {
    const rows = await buildRows();
    HM.rows = rows;
    if (!rows.length) { grid.innerHTML = '<div class="hm-state-msg" style="grid-column:1/-1">히트맵을 구성하기에 충분한 시장 데이터가 아직 부족합니다. 거래량이 누적되면 자동으로 반영됩니다.</div>'; setStatus('empty'); renderSummary([]); renderTopLists([]); renderAiSummary([]); renderWatchCompare([]); return; }
    const validRows = rows.filter(r => r.priceValid && Number.isFinite(r.pct));
    const filtered = applyFilters(rows);
    const sorted = sortForMode(filtered);
    renderSummary(validRows);
    renderBoxes(sorted);
    renderTopLists(validRows);
    renderAiSummary(validRows);
    renderWatchCompare(validRows);
    // 가격 데이터 없는 종목 제외 안내
    if (rows._excluded > 0) {
      const note = document.createElement('div');
      note.className = 'ds-excluded-note';
      note.style.gridColumn = '1/-1';
      note.textContent = `가격 데이터가 없는 ${rows._excluded}개 종목은 랭킹·색상 계산에서 제외되었습니다.`;
      grid.appendChild(note);
    }
    if (HM.selected) { const upd = rows.find(r => r.code === HM.selected.code); if (upd) { HM.selected = upd; renderDetail(); } }
    // 일부 종목만 매칭된 경우 partial
    const matched = rows.length, totalSyms = (window.symbols || []).filter(s => (s.asset || 'crypto') === 'crypto').length || rows.length;
    setStatus(matched >= totalSyms * 0.5 ? 'ok' : 'partial');
    setUpdated();
  } catch (e) {
    grid.innerHTML = '<div class="hm-state-msg" style="grid-column:1/-1">히트맵 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    setStatus('error');
  }
};

/* ─────────── 액션 ─────────── */
window._hmResetFilters = function() {
  HM.market = 'all'; HM.category = 'all'; HM.turnoverTop = 'all'; HM.changeFilter = 'all'; HM.watchOnly = false; HM.search = '';
  const se = document.getElementById('hmSearch'); if (se) se.value = '';
  syncFilterChips(); window.loadHeatmap();
};
window._hmOnSearch = function(v) { HM.search = (v || '').trim(); window.loadHeatmap(); };
window._hmAddFav = function(code) {
  if (window._addFavSym && !favSet().has(code)) { window._addFavSym(code); }
  else if (window._removeFavSym && favSet().has(code)) { window._removeFavSym(code); }
  setTimeout(() => window.loadHeatmap(), 200);
};
window._hmOpenAi = function(code) {
  if (window._selectSym) window._selectSym(code);
  // AI 분석 탭으로 전환 시도
  const aiTab = document.querySelector('.right-tab[data-p="ai"]');
  if (aiTab) aiTab.click();
};

/* ─────────── 이벤트 바인딩 ─────────── */
document.addEventListener('click', (e) => {
  // 모드 탭
  const mt = e.target.closest('#hmModeTabs .hm-tab');
  if (mt) { const m = mt.dataset.mode; if (m && m !== HM.mode) { HM.mode = m; document.querySelectorAll('#hmModeTabs .hm-tab').forEach(t => { const on = t === mt; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); }); renderLegend(); window.loadHeatmap(); } return; }
  // 시간 탭
  const tt = e.target.closest('#hmTimeTabs .hm-tab');
  if (tt) { const tf = tt.dataset.tf; if (tf && tf !== HM.tf) { HM.tf = tf; document.querySelectorAll('#hmTimeTabs .hm-tab').forEach(t => { const on = t === tt; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); }); renderTimeNote(); window.loadHeatmap(); } return; }
  // 필터 칩
  const fc = e.target.closest('#hmFilters .hm-chip');
  if (fc) { const k = fc.dataset.fkey, v = fc.dataset.fval; if (k === 'watchOnly') HM.watchOnly = (v === 'true'); else HM[k] = v; syncFilterChips(); window.loadHeatmap(); return; }
  // 상위 리스트 탭
  const topT = e.target.closest('[data-toptab]');
  if (topT) { HM.topTab = topT.dataset.toptab; renderTopLists(HM.rows); return; }
  // 박스 클릭 → 상세 + 선택
  const box = e.target.closest('#heatmapGrid .hm-box');
  if (box) { const code = box.dataset.code; const r = HM.rows.find(x => x.code === code); if (r) { HM.selected = r; renderDetail(); document.getElementById('hmDetail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } return; }
  // 상위 리스트 행 클릭 → 차트
  const tr = e.target.closest('.hm-top-row');
  if (tr) { const code = tr.dataset.code; if (code && window._selectSym) window._selectSym(code); return; }
});
// 컨트롤 select 변경
document.addEventListener('change', (e) => {
  const sel = e.target.closest('#hmControls .hm-select');
  if (!sel) return;
  const k = sel.dataset.ckey; HM[k] = sel.value;
  if (k === 'color') renderLegend();
  window.loadHeatmap();
});
// 박스/상위행 키보드 접근
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const box = e.target.closest && e.target.closest('#heatmapGrid .hm-box');
  if (box) { e.preventDefault(); const r = HM.rows.find(x => x.code === box.dataset.code); if (r) { HM.selected = r; renderDetail(); } return; }
  const tr = e.target.closest && e.target.closest('.hm-top-row');
  if (tr) { e.preventDefault(); if (window._selectSym) window._selectSym(tr.dataset.code); }
});

// 탭 열릴 때 로드
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.right-tab');
  if (tab && tab.dataset.p === 'heatmap') window.loadHeatmap();
});
// 30초 주기 갱신
setInterval(() => { if (document.hidden) return; const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'heatmap') window.loadHeatmap(); }, 30000);

/* ═══════════ 인기 TOP (#hot) — 시장 관심도 랭킹 대시보드 ═══════════ */
const HT = {
  basis: 'composite',  // composite|turnover|gainers|losers|volatility|views|ai|volup|fav|spike
  tf: '24h',
  market: 'all', category: 'all', turnoverTop: 'all', changeFilter: 'all', watchOnly: false, search: '',
  density: 'standard', // simple|standard|detail
  sort: 'attention',   // attention|turnover|gainers|losers|volatility|rankup
  selected: null,
  rows: [],
};
const _HT_SUPPORTED_TF = ['24h'];
const HT_BASIS_DESC = {
  composite: '종합은 거래대금, 등락률, 변동성, 조회 증가, AI 관심도를 종합해 시장 관심도를 계산합니다.',
  turnover: '거래대금이 많이 몰린 종목 순으로 정렬합니다.',
  gainers: '상승 흐름이 강한 종목 순으로 정렬합니다.',
  losers: '하락 흐름이 강한 종목 순으로 정렬합니다.',
  volatility: '단기 변동성이 확대된 종목 순으로 정렬합니다.',
  views: '조회 증가(거래대금·변동성 기반 추정) 흐름이 큰 종목 순으로 정렬합니다.',
  ai: 'AI 관심도가 높은 종목 순으로 정렬합니다. AI 관심도는 참고 지표입니다.',
  volup: '거래량 증가 흐름이 큰 종목 순으로 정렬합니다.',
  fav: '관심 등록(내 관심 종목) 중 시장 관심도가 높은 순으로 정렬합니다.',
  spike: '단기 급변동(변동성·등락률)이 큰 종목 순으로 정렬합니다.',
};

/* 관심도/조회증가/AI 점수 부여 (24h 데이터 파생 참고 지표) */
function htEnrich(rows) {
  if (!rows.length) return rows;
  const maxTurn = Math.max(...rows.map(r => r.turnover), 1);
  const maxVolu = Math.max(...rows.map(r => r.vol), 1);
  const maxVola = Math.max(...rows.map(r => r.volatility), 1);
  for (const r of rows) {
    const nMove = Math.min(1, Math.abs(r.pct) / 10);
    const nTurn = r.turnover > 0 ? Math.log10(r.turnover) / Math.log10(maxTurn) : 0;
    const nVolu = r.vol > 0 ? Math.log10(r.vol) / Math.log10(maxVolu) : 0;
    const nVola = Math.min(1, r.volatility / (maxVola || 1));
    // 조회 증가(proxy): 거래대금+변동성 결합 추정 (실제 조회 데이터 미수집)
    r.viewsScore = Math.round((nTurn * 0.6 + nVola * 0.4) * 100);
    r.volupScore = Math.round(nVolu * 100);
    // 시장 관심도(종합) 점수 0~100
    r.attention = Math.round((nTurn * 0.30 + nMove * 0.25 + nVola * 0.20 + (r.viewsScore/100) * 0.15 + (r.aiScore/100) * 0.10) * 100);
  }
  return rows;
}

/* 이전 순위 스냅샷 (localStorage) → 순위 변화 */
function htRankKey() { return `htPrevRank_${HT.basis}_${HT.tf}`; }
function htLoadPrevRank() { try { return JSON.parse(localStorage.getItem(htRankKey()) || '{}'); } catch { return {}; } }
function htSavePrevRank(orderedCodes) { try { const m = {}; orderedCodes.forEach((c, i) => { m[c] = i + 1; }); localStorage.setItem(htRankKey(), JSON.stringify(m)); } catch {} }

function htSortRows(rows) {
  const s = rows.slice();
  const b = HT.basis;
  // 기준 우선, 그 다음 정렬 옵션
  const byBasis = {
    composite: (a, b2) => b2.attention - a.attention,
    turnover: (a, b2) => b2.turnover - a.turnover,
    gainers: (a, b2) => b2.pct - a.pct,
    losers: (a, b2) => a.pct - b2.pct,
    volatility: (a, b2) => b2.volatility - a.volatility,
    views: (a, b2) => b2.viewsScore - a.viewsScore,
    ai: (a, b2) => b2.aiScore - a.aiScore,
    volup: (a, b2) => b2.volupScore - a.volupScore,
    fav: (a, b2) => b2.attention - a.attention,
    spike: (a, b2) => (Math.abs(b2.pct) + b2.volatility) - (Math.abs(a.pct) + a.volatility),
  };
  s.sort(byBasis[b] || byBasis.composite);
  // 정렬 옵션이 기본(관심도)과 다르면 재정렬
  const bySort = {
    attention: null,
    turnover: (a, b2) => b2.turnover - a.turnover,
    gainers: (a, b2) => b2.pct - a.pct,
    losers: (a, b2) => a.pct - b2.pct,
    volatility: (a, b2) => b2.volatility - a.volatility,
    rankup: (a, b2) => (b2._rankDelta || -999) - (a._rankDelta || -999),
  };
  if (HT.sort !== 'attention' && bySort[HT.sort]) s.sort(bySort[HT.sort]);
  return s;
}

function htApplyFilters(rows) {
  let list = rows.slice();
  // 가격 데이터 없는 종목은 랭킹에서 제외
  list = list.filter(r => r.priceValid && Number.isFinite(r.pct));
  if (HT.market !== 'all') list = list.filter(r => r.market === HT.market);
  if (HT.watchOnly || HT.category === 'watch' || HT.basis === 'fav') list = list.filter(r => r.isFav);
  else if (HT.category !== 'all') list = list.filter(r => r.cats.includes(HT.category));
  if (HT.changeFilter === 'up') list = list.filter(r => r.pct > 0);
  else if (HT.changeFilter === 'down') list = list.filter(r => r.pct < 0);
  else if (HT.changeFilter === 'spike') list = list.filter(r => Math.abs(r.pct) >= 10);
  if (HT.search) { const q = HT.search.toLowerCase(); list = list.filter(r => r.base.toLowerCase().includes(q) || (r.kr || '').includes(HT.search) || r.code.toLowerCase().includes(q)); }
  if (HT.turnoverTop !== 'all') { const n = parseInt(HT.turnoverTop); list = list.slice().sort((a, b) => b.turnover - a.turnover).slice(0, n); }
  return list;
}

const HT_STATUS = { loading: ['불러오는 중','loading'], ok: ['정상','ok'], partial: ['일부 데이터','partial'], delayed: ['데이터 지연','delayed'], empty: ['데이터 부족','empty'], error: ['오류','error'] };
function htSetStatus(kind) { const b = document.getElementById('htStatusBadge'); if (!b) return; const s = HT_STATUS[kind] || HT_STATUS.loading; b.textContent = s[0]; b.setAttribute('data-state', s[1]); }
function htSetUpdated() { const el = document.getElementById('htUpdated'); if (!el) return; const d = new Date(); el.textContent = `업데이트 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }

function htScoreClass(s) { return s >= 80 ? 'ht-score-high' : s >= 60 ? 'ht-score-mid' : s >= 40 ? 'ht-score-watch' : 'ht-score-low'; }
function htScoreLabel(s) { return s >= 80 ? '관심 높음' : s >= 60 ? '관심 보통' : s >= 40 ? '관찰' : '낮음'; }
function htPctClass(p) { return p > 0 ? 'ht-up' : p < 0 ? 'ht-down' : 'ht-flat'; }

/* 상태 배지 계산 */
function htBadges(r, rank) {
  const out = [];
  if (r.turnoverRank != null && r.turnoverRank < 10) out.push('거래 집중');
  if (r.pct >= 3) out.push('상승 흐름'); else if (r.pct <= -3) out.push('하락 흐름');
  if (r.volatility >= 8) out.push('변동성 확대');
  if (r.viewsScore >= 70) out.push('조회 증가');
  if (r.aiScore >= 70) out.push('AI 관심');
  if (r.isFav) out.push('관심 종목');
  if (r._rankDelta === 'NEW') out.push('신규 진입');
  if (r.volatility >= 12 || Math.abs(r.pct) >= 15) out.push('리스크 확인');
  return out;
}

/* 순위 변화 라벨 */
function htRankChange(r) {
  if (r._rankDelta === 'NEW') return { cls: 'ht-rc-new', txt: 'NEW' };
  if (typeof r._rankDelta === 'number') {
    if (r._rankDelta > 0) return { cls: 'ht-rc-up', txt: `▲ ${r._rankDelta}` };
    if (r._rankDelta < 0) return { cls: 'ht-rc-down', txt: `▼ ${Math.abs(r._rankDelta)}` };
  }
  return { cls: 'ht-rc-flat', txt: '-' };
}

/* 컨트롤/필터 1회 빌드 */
function htBuildControlsOnce() {
  const fEl = document.getElementById('htFilters');
  if (fEl && !fEl.dataset.built) {
    fEl.dataset.built = '1';
    const row = (label, key, opts) => `<div class="ht-filter-row"><span class="flabel">${label}</span>${opts.map(([v, t]) => `<button class="ht-chip" data-fkey="${key}" data-fval="${v}">${t}</button>`).join('')}</div>`;
    fEl.innerHTML =
      row('마켓', 'market', [['all','전체'],['USDT','USDT'],['BTC','BTC'],['KRW','KRW']]) +
      row('유형', 'category', [['all','전체'],['major','메이저'],['alt','알트'],['defi','DeFi'],['ai','AI'],['layer1','Layer1'],['meme','Meme'],['watch','관심종목']]) +
      row('거래대금', 'turnoverTop', [['all','전체'],['100','상위 100'],['50','상위 50'],['20','상위 20']]) +
      row('변동률', 'changeFilter', [['all','전체'],['up','상승만'],['down','하락만'],['spike','급등락']]) +
      row('관심', 'watchOnly', [['false','전체'],['true','내 관심 종목만']]);
  }
  const cEl = document.getElementById('htControls');
  if (cEl && !cEl.dataset.built) {
    cEl.dataset.built = '1';
    const sel = (label, key, opts, cur) => `<div class="ht-control"><label>${label}</label><select class="ht-select" data-ckey="${key}">${opts.map(([v, t]) => `<option value="${v}" ${v===cur?'selected':''}>${t}</option>`).join('')}</select></div>`;
    cEl.innerHTML =
      sel('보기 밀도', 'density', [['simple','간단히'],['standard','표준'],['detail','상세']], HT.density) +
      sel('정렬', 'sort', [['attention','관심도 높은 순'],['turnover','거래대금 높은 순'],['gainers','상승률 높은 순'],['losers','하락률 큰 순'],['volatility','변동성 높은 순'],['rankup','순위 상승 순']], HT.sort);
  }
  htSyncChips();
}
function htSyncChips() {
  document.querySelectorAll('#htFilters .ht-chip').forEach(c => {
    const k = c.dataset.fkey, v = c.dataset.fval;
    c.classList.toggle('active', k === 'watchOnly' ? (String(HT.watchOnly) === v) : (String(HT[k]) === v));
  });
}

function htRenderSummary(rows) {
  const el = document.getElementById('htSummary');
  if (!el) return;
  const byTurn = rows.slice().sort((a, b) => b.turnover - a.turnover);
  const byGain = rows.slice().sort((a, b) => b.pct - a.pct);
  const byLoss = rows.slice().sort((a, b) => a.pct - b.pct);
  const byVola = rows.slice().sort((a, b) => b.volatility - a.volatility);
  const byViews = rows.slice().sort((a, b) => b.viewsScore - a.viewsScore);
  const byAi = rows.slice().sort((a, b) => b.aiScore - a.aiScore);
  const favRows = rows.filter(r => r.isFav).sort((a, b) => b.attention - a.attention);
  const top5turn = byTurn.slice(0, 5).reduce((s, r) => s + r.turnover, 0);
  const allT = rows.reduce((s, r) => s + r.turnover, 0) || 1;
  const volHot = rows.filter(r => r.volatility >= 8).length;
  const conc = top5turn / allT;
  let text;
  if (conc >= 0.5) text = `현재 시장 관심은 ${esc(byTurn[0]?byTurn[0].base:'대형')} 등 대형 종목 중심으로 형성되고 있으며, ${volHot}개 종목에서 단기 변동성이 확대되고 있습니다.`;
  else text = `현재 시장 관심은 여러 종목에 분산되어 있으며, ${volHot}개 종목에서 단기 변동성이 확대되고 있습니다.`;
  const nm = r => r ? esc(r.base) : '-';
  el.innerHTML = `
    <div class="ht-summary">
      <div class="ht-summary-grid">
        <div class="row"><span class="k">거래대금 TOP 1</span><span class="v">${nm(byTurn[0])}</span></div>
        <div class="row"><span class="k">상승률 TOP 1</span><span class="v ht-up">${nm(byGain[0])}</span></div>
        <div class="row"><span class="k">하락률 TOP 1</span><span class="v ht-down">${nm(byLoss[0])}</span></div>
        <div class="row"><span class="k">변동성 TOP 1</span><span class="v">${nm(byVola[0])}</span></div>
        <div class="row"><span class="k">조회 증가 TOP 1</span><span class="v">${nm(byViews[0])}</span></div>
        <div class="row"><span class="k">AI 관심도 TOP 1</span><span class="v">${nm(byAi[0])}</span></div>
        <div class="row"><span class="k">내 관심 중 TOP 1</span><span class="v">${favRows.length?nm(favRows[0]):'관심 종목 없음'}</span></div>
      </div>
      <p class="ht-summary-text">${text} 참고용 분석이며 매매를 권유하지 않습니다.</p>
    </div>`;
}

function htRenderSurge(rows) {
  const el = document.getElementById('htSurge');
  if (!el) return;
  // 급상승 관심: 조회증가 proxy + 변동성 + 거래대금 결합 상위, 변동성 큰 것
  const surge = rows.filter(r => r.volatility >= 6 && r.viewsScore >= 50).sort((a, b) => (b.viewsScore + b.volatility) - (a.viewsScore + a.volatility)).slice(0, 5);
  if (!surge.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="ht-card-title">급상승 관심 종목</div>
    <div class="ht-surge">
      ${surge.map(r => `<div class="ht-top-row" data-code="${esc(r.code)}" role="button" tabindex="0" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;cursor:pointer;font-size:var(--text-xs)"><span style="font-weight:600">${esc(r.base)}<span style="color:var(--color-text-muted);font-weight:400">${esc(r.quote)}</span></span><span class="${htPctClass(r.pct)}" style="font-variant-numeric:tabular-nums">${r.pct>=0?'+':''}${r.pct.toFixed(2)}% · 변동성 ${r.volatility.toFixed(1)}%</span></div>`).join('')}
      <p class="ht-mini-note">급상승 관심 종목은 단기 변동성이 클 수 있으므로 리스크 확인이 필요합니다.</p>
    </div>`;
}

function htRenderList(rows) {
  const listEl = document.getElementById('hotList');
  if (!listEl) return;
  const cur = window.curSymbol;
  const top = rows.slice(0, 30);
  if (!top.length) { listEl.innerHTML = '<div class="ht-state-msg">선택한 조건에 해당하는 종목이 없습니다.</div>'; return; }
  const dens = HT.density;
  listEl.innerHTML = top.map((r, i) => {
    const rank = i + 1;
    const rc = htRankChange(r);
    const isCur = r.code === cur;
    const badges = htBadges(r, rank);
    if (isCur && !badges.includes('현재 차트')) badges.unshift('현재 차트');
    const shownBadges = (dens === 'simple') ? badges.slice(0, 2) : badges.slice(0, 5);
    const aria = `${rank}위 ${r.base} ${r.quote}, 등락률 ${r.pct.toFixed(2)}퍼센트, 거래대금 ${fmtNum(r.turnover)}, 관심도 ${r.attention}점, 순위변화 ${rc.txt}`;
    let metaLine = '';
    if (dens === 'standard') metaLine = `<div class="ht-row-meta">거래대금 ${fmtNum(r.turnover)} · 24h ${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</div>`;
    else if (dens === 'detail') metaLine = `<div class="ht-row-meta">거래대금 ${fmtNum(r.turnover)} · 거래량 ${fmtNum(r.vol)} · 변동성 ${r.volatility.toFixed(1)}% · AI ${r.aiScore} · 24h ${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</div>`;
    const scoreLine = (dens !== 'simple') ? `<div class="ht-row-meta"><span class="ht-score"><span class="ht-score-bar"><span class="ht-score-fill" style="width:${r.attention}%"></span></span><span class="${htScoreClass(r.attention)}">관심도 ${r.attention} · ${htScoreLabel(r.attention)}</span></span></div>` : '';
    return `<div class="ht-row ${isCur?'current':''}" role="listitem" tabindex="0" data-code="${esc(r.code)}" aria-label="${esc(aria)}">
      <div class="ht-rank"><span class="ht-rank-num">${rank}</span><span class="ht-rank-change ${rc.cls}">${rc.txt}</span></div>
      <div class="ht-body">
        <div class="ht-row-top"><span class="ht-name">${esc(r.base)}<span class="quote">${esc(r.quote)}</span></span></div>
        ${metaLine}
        ${scoreLine}
        <div class="ht-badges">${shownBadges.map(b => `<span class="ht-badge">${esc(b)}</span>`).join('')}</div>
      </div>
      <div class="ht-row-right">
        <div class="ht-price">$${fmtPrice(r.last)}</div>
        <div class="ht-pct ${htPctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</div>
        ${dens==='detail' ? `<button class="ht-btn ht-btn-ghost ht-btn-xs" type="button" data-fav="${esc(r.code)}" aria-label="관심 종목 추가" style="margin-top:4px">관심</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function htRenderDetail() {
  const el = document.getElementById('htDetail');
  if (!el) return;
  const r = HT.selected;
  if (!r) { el.innerHTML = ''; return; }
  const isFav = favSet().has(r.code);
  const rc = htRankChange(r);
  const badges = htBadges(r, r._rank || 0);
  if (r.code === window.curSymbol) badges.unshift('현재 차트');
  el.innerHTML = `
    <div class="ht-detail">
      <div class="ht-detail-top"><span class="ht-detail-sym">${esc(r.base)}${esc(r.quote)}</span><span class="ht-detail-price">$${fmtPrice(r.last)}</span></div>
      <div class="ht-badges" style="margin-bottom:8px">${badges.slice(0,6).map(b => `<span class="ht-badge">${esc(b)}</span>`).join('')}</div>
      <div class="ht-detail-grid">
        <div class="row"><span class="k">기준(${HT.tf}) 등락률</span><span class="v ${htPctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</span></div>
        <div class="row"><span class="k">24시간 등락률</span><span class="v ${htPctClass(r.pct)}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</span></div>
        <div class="row"><span class="k">거래대금</span><span class="v">${fmtNum(r.turnover)}</span></div>
        <div class="row"><span class="k">거래량</span><span class="v">${fmtNum(r.vol)}</span></div>
        <div class="row"><span class="k">고가</span><span class="v">$${fmtPrice(r.high)}</span></div>
        <div class="row"><span class="k">저가</span><span class="v">$${fmtPrice(r.low)}</span></div>
        <div class="row"><span class="k">변동성</span><span class="v">${r.volatility.toFixed(2)}%</span></div>
        <div class="row"><span class="k">시장 관심도</span><span class="v ${htScoreClass(r.attention)}">${r.attention} (${htScoreLabel(r.attention)})</span></div>
        <div class="row"><span class="k">순위 변화</span><span class="v ${rc.cls}">${rc.txt}</span></div>
        <div class="row"><span class="k">AI 관심도</span><span class="v">${r.aiScore}</span></div>
      </div>
      <div class="ht-detail-actions">
        <button class="ht-btn ht-btn-primary ht-btn-xs" type="button" onclick="window._selectSym&&window._selectSym('${esc(r.code)}')">차트로 보기</button>
        <button class="ht-btn ht-btn-secondary ht-btn-xs" type="button" onclick="window._htAddFav('${esc(r.code)}')">${isFav?'관심 종목 해제':'관심 종목 추가'}</button>
        <button class="ht-btn ht-btn-ghost ht-btn-xs" type="button" onclick="window._htOpenAi('${esc(r.code)}')">AI 분석 보기</button>
        <button class="ht-btn ht-btn-ghost ht-btn-xs" type="button" onclick="window._htOpenHeatmap('${esc(r.code)}')">히트맵에서 보기</button>
      </div>
    </div>`;
}

function htRenderAiSummary(rows) {
  const el = document.getElementById('htAiSummary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="ht-card-title">AI 인기 요약</div><div class="ht-ai"><p class="ht-ai-text">표시할 시장 데이터가 부족합니다.</p></div>`; return; }
  const byTurn = rows.slice().sort((a, b) => b.turnover - a.turnover);
  const allT = rows.reduce((s, r) => s + r.turnover, 0) || 1;
  const conc = byTurn.slice(0, 2).reduce((s, r) => s + r.turnover, 0) / allT;
  const volHot = rows.filter(r => r.volatility >= 8);
  const parts = [];
  const top2 = byTurn.slice(0, 2).map(r => `${esc(r.base)}${esc(r.quote)}`).join('와 ');
  if (conc >= 0.4) parts.push(`현재 시장 관심도는 ${top2} 같은 대형 종목에 집중되어 있습니다.`);
  else parts.push('현재 시장 관심도는 여러 종목에 비교적 분산되어 있습니다.');
  if (volHot.length) parts.push(`${esc(volHot[0].base)} 등 일부 종목은 단기 변동성과 조회 증가가 함께 나타나고 있어 추세 지속 여부와 거래량 변화를 함께 확인하는 것이 좋습니다.`);
  parts.push('위 내용은 참고용 분석이며 매매를 권유하지 않습니다.');
  el.innerHTML = `<div class="ht-card-title">AI 인기 요약</div><div class="ht-ai"><p class="ht-ai-text">${parts.join(' ')}</p></div>`;
}

function htRenderWatchTop(rows) {
  const el = document.getElementById('htWatchTop');
  if (!el) return;
  const favs = rows.filter(r => r.isFav);
  if (!favs.length) { el.innerHTML = `<div class="ht-card-title">내 관심 종목 TOP</div><div class="ht-state-msg">관심 종목을 추가하면 내 관심 종목의 시장 관심도 변화를 확인할 수 있습니다.</div>`; return; }
  const byAtt = favs.slice().sort((a, b) => b.attention - a.attention)[0];
  const byTurn = favs.slice().sort((a, b) => b.turnover - a.turnover)[0];
  const byVol = favs.slice().sort((a, b) => b.volatility - a.volatility)[0];
  const byRank = favs.slice().sort((a, b) => ((typeof b._rankDelta==='number'?b._rankDelta:-999)) - ((typeof a._rankDelta==='number'?a._rankDelta:-999)))[0];
  const nm = r => r ? esc(r.base) : '-';
  el.innerHTML = `
    <div class="ht-card-title">내 관심 종목 TOP</div>
    <div class="ht-card">
      <div class="ht-summary-grid">
        <div class="row"><span class="k">관심도 상위</span><span class="v">${nm(byAtt)} (${byAtt?byAtt.attention:'-'})</span></div>
        <div class="row"><span class="k">거래대금 상위</span><span class="v">${nm(byTurn)}</span></div>
        <div class="row"><span class="k">변동성 확대</span><span class="v">${nm(byVol)}</span></div>
        <div class="row"><span class="k">순위 상승</span><span class="v">${nm(byRank)}</span></div>
      </div>
    </div>`;
}

function htRenderBasisTime() {
  const lab = document.getElementById('htBasisLabel');
  if (lab) lab.textContent = `기준 ${({composite:'종합',turnover:'거래대금',gainers:'상승률',losers:'하락률',volatility:'변동성',views:'조회 증가',ai:'AI 관심',volup:'거래량 증가',fav:'관심 등록',spike:'급변동'})[HT.basis]} · ${HT.tf}`;
  const bd = document.getElementById('htBasisDesc');
  if (bd) bd.textContent = HT_BASIS_DESC[HT.basis] || '';
  const tn = document.getElementById('htTimeNote');
  if (tn) tn.innerHTML = _HT_SUPPORTED_TF.includes(HT.tf) ? '' : `<span style="color:var(--color-warning)">${esc(HT.tf)} 기준 데이터는 준비 중입니다. 현재 수치는 24h 기준으로 표시됩니다.</span>`;
}

window._hotAsset = window._hotAsset || 'crypto';
window._loadHotCoins = async function() {
  const listEl = document.getElementById('hotList');
  if (!listEl) return;
  htBuildControlsOnce();
  htRenderBasisTime();
  htSetStatus('loading');
  listEl.innerHTML = '<div class="ht-state-msg">인기 TOP 데이터를 불러오는 중입니다. 거래대금, 변동성, 관심도 변화를 계산하고 있습니다.</div>';
  try {
    let rows = await buildRows();
    rows = htEnrich(rows);
    // 거래대금 순위 부여(배지용)
    const byTurn = rows.slice().sort((a, b) => b.turnover - a.turnover);
    byTurn.forEach((r, i) => { r.turnoverRank = i; });
    HT.rows = rows;
    const validRowsHt = rows.filter(r => r.priceValid && Number.isFinite(r.pct));
    if (!rows.length) { listEl.innerHTML = '<div class="ht-state-msg">인기 순위를 계산하기에 충분한 데이터가 아직 부족합니다. 거래량과 조회 데이터가 누적되면 자동으로 반영됩니다.</div>'; htSetStatus('empty'); htRenderSummary([]); htRenderSurge([]); htRenderAiSummary([]); htRenderWatchTop([]); return; }

    const filtered = htApplyFilters(rows);
    let sorted = htSortRows(filtered);

    // 순위 변화 계산 (이전 스냅샷 대비)
    const prev = htLoadPrevRank();
    sorted.forEach((r, i) => {
      r._rank = i + 1;
      const pr = prev[r.code];
      if (pr == null) r._rankDelta = Object.keys(prev).length ? 'NEW' : '-';
      else r._rankDelta = pr - (i + 1); // 양수=상승
    });
    htSavePrevRank(sorted.slice(0, 30).map(r => r.code));

    htRenderSummary(validRowsHt);
    htRenderSurge(validRowsHt);
    htRenderList(sorted);
    htRenderAiSummary(validRowsHt);
    htRenderWatchTop(validRowsHt);
    // 가격 데이터 없는 종목 제외 안내
    if (rows._excluded > 0) {
      const note = document.createElement('div');
      note.className = 'ds-excluded-note';
      note.textContent = `가격 데이터가 없는 ${rows._excluded}개 종목은 랭킹 계산에서 제외되었습니다.`;
      listEl.appendChild(note);
    }
    if (HT.selected) { const upd = sorted.find(r => r.code === HT.selected.code) || rows.find(r => r.code === HT.selected.code); if (upd) { HT.selected = upd; htRenderDetail(); } }

    const totalSyms = (window.symbols || []).filter(s => (s.asset || 'crypto') === 'crypto').length || rows.length;
    htSetStatus(rows.length >= totalSyms * 0.5 ? 'ok' : 'partial');
    htSetUpdated();
  } catch (e) {
    listEl.innerHTML = '<div class="ht-state-msg">인기 TOP 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    htSetStatus('error');
  }
};

/* 인기 TOP 액션 */
window._htResetFilters = function() { HT.market='all'; HT.category='all'; HT.turnoverTop='all'; HT.changeFilter='all'; HT.watchOnly=false; HT.search=''; const s=document.getElementById('htSearch'); if(s)s.value=''; htSyncChips(); window._loadHotCoins(); };
window._htOnSearch = function(v) { HT.search = (v||'').trim(); window._loadHotCoins(); };
window._htAddFav = function(code) { if (window._addFavSym && !favSet().has(code)) window._addFavSym(code); else if (window._removeFavSym && favSet().has(code)) window._removeFavSym(code); setTimeout(() => window._loadHotCoins(), 200); };
window._htOpenAi = function(code) { if (window._selectSym) window._selectSym(code); const t = document.querySelector('.right-tab[data-p="ai"]'); if (t) t.click(); };
window._htOpenHeatmap = function(code) { if (window._selectSym) window._selectSym(code); const t = document.querySelector('.right-tab[data-p="heatmap"]'); if (t) t.click(); };

/* 인기 TOP 이벤트 */
document.addEventListener('click', (e) => {
  const bt = e.target.closest('#htBasisTabs .ht-tab');
  if (bt) { const b = bt.dataset.basis; if (b && b !== HT.basis) { HT.basis = b; document.querySelectorAll('#htBasisTabs .ht-tab').forEach(t => { const on = t === bt; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); }); htRenderBasisTime(); window._loadHotCoins(); } return; }
  const tt = e.target.closest('#htTimeTabs .ht-tab');
  if (tt) { const tf = tt.dataset.tf; if (tf && tf !== HT.tf) { HT.tf = tf; document.querySelectorAll('#htTimeTabs .ht-tab').forEach(t => { const on = t === tt; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); }); htRenderBasisTime(); window._loadHotCoins(); } return; }
  const fc = e.target.closest('#htFilters .ht-chip');
  if (fc) { const k = fc.dataset.fkey, v = fc.dataset.fval; if (k === 'watchOnly') HT.watchOnly = (v === 'true'); else HT[k] = v; htSyncChips(); window._loadHotCoins(); return; }
  // 관심 버튼(리스트 내)
  const favBtn = e.target.closest('#hotList [data-fav]');
  if (favBtn) { e.stopPropagation(); window._htAddFav(favBtn.dataset.fav); return; }
  // 리스트 행 → 상세 + 차트
  const row = e.target.closest('#hotList .ht-row');
  if (row) { const code = row.dataset.code; const r = HT.rows.find(x => x.code === code); if (r) { HT.selected = r; htRenderDetail(); if (window._selectSym) window._selectSym(code); document.getElementById('htDetail')?.scrollIntoView({ behavior:'smooth', block:'nearest' }); } return; }
  // 급상승/관심 행
  const sr = e.target.closest('#htSurge .ht-top-row');
  if (sr) { const r = HT.rows.find(x => x.code === sr.dataset.code); if (r) { HT.selected = r; htRenderDetail(); } return; }
});
document.addEventListener('change', (e) => {
  const sel = e.target.closest('#htControls .ht-select');
  if (!sel) return;
  HT[sel.dataset.ckey] = sel.value;
  window._loadHotCoins();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest && e.target.closest('#hotList .ht-row');
  if (row) { e.preventDefault(); const r = HT.rows.find(x => x.code === row.dataset.code); if (r) { HT.selected = r; htRenderDetail(); if (window._selectSym) window._selectSym(row.dataset.code); } }
});
document.addEventListener('click', (e) => { const tab = e.target.closest('.right-tab'); if (tab && tab.dataset.p === 'hot') window._loadHotCoins(); });
setInterval(() => { if (document.hidden) return; const a = document.querySelector('.right-tab.active'); if (a && a.dataset.p === 'hot') window._loadHotCoins(); }, 30000);
