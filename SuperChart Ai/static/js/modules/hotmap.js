/**
 * hotmap.js — 히트맵 모듈 (main-app.js에서 분리)
 * 의존: window.symbols, window.coinImgUrl, window._selectSym
 */

// ═══ 히트맵 ═══
window._hmAsset = 'crypto';
window.loadHeatmap = async function() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const cBtn = document.getElementById('hmTabCrypto'), sBtn = document.getElementById('hmTabStock');
  if (cBtn) { cBtn.style.background = window._hmAsset === 'crypto' ? 'var(--accent)' : 'transparent'; cBtn.style.color = window._hmAsset === 'crypto' ? '#fff' : 'var(--text)'; cBtn.style.borderColor = window._hmAsset === 'crypto' ? 'var(--accent)' : 'var(--border)'; }
  if (sBtn) { sBtn.style.background = window._hmAsset === 'stock' ? 'var(--accent)' : 'transparent'; sBtn.style.color = window._hmAsset === 'stock' ? '#fff' : 'var(--text)'; sBtn.style.borderColor = window._hmAsset === 'stock' ? 'var(--accent)' : 'var(--border)'; }
  grid.innerHTML = '<div class="state-loading" style="grid-column:1/-1">로딩 중...</div>';
  try {
    const symbols = window.symbols || [];
    const coinImgUrl = window.coinImgUrl || {};
    const filteredSyms = symbols.filter(s => window._hmAsset === 'crypto' ? s.asset === 'crypto' : (s.asset === 'stock' || s.asset === 'commodity'));
    const syms = filteredSyms.map(s => s.apiCode || s.code);
    // 전체 ticker 1번 호출 (개별 요청 X → rate limit 방지)
    const allTickers = await fetch('/v1/charts/ticker-24hr').then(r => r.json()).catch(() => []);
    const tickerMap = {};
    if (Array.isArray(allTickers)) allTickers.forEach(t => { tickerMap[t.symbol] = t; });
    const data = [];
    for (let i = 0; i < filteredSyms.length; i++) {
      const sym = syms[i];
      const p = tickerMap[sym];
      if (!p) continue;
      const pct = parseFloat(p.priceChangePercent || 0);
      const sn = filteredSyms[i].code.replace('USDT', '');
      const rawPrice = p.lastPrice || '0';
      data.push({ sn, pct, price: parseFloat(rawPrice), rawPrice, code: filteredSyms[i].code, kr: filteredSyms[i].kr || filteredSyms[i].display_name_ko || '' });
    }
    data.sort((a, b) => b.pct - a.pct);
    const isKo = (localStorage.getItem('chartOS_lang') || 'ko') === 'ko';
    let html = '';
    for (const d of data) {
      // 셀 배경: 등락 방향을 아주 옅게만(워치리스트처럼 가독성 우선, 히트맵 색감도 유지)
      const abs = Math.min(Math.abs(d.pct), 10);
      const alpha = 0.05 + abs / 10 * 0.12;
      const bg = d.pct >= 0 ? `rgba(196,56,75,${alpha})` : `rgba(59,130,246,${alpha})`;
      const color = d.pct >= 0 ? '#C4384B' : '#3B82F6';   // 등락률 색(빨강/파랑)
      const img = coinImgUrl[d.code] || '';
      const imgTag = img ? `<img src="${img}" loading="lazy" decoding="async" alt="" style="width:14px;height:14px;border-radius:50%;vertical-align:middle">` : '';
      const krName = isKo ? (d.kr || d.sn) : (d.sn);
      html += `<div onclick="this.style.borderColor='#921230';setTimeout(()=>this.style.borderColor='var(--color-border)',500);window._selectSym('${d.code}')" style="background:${bg};border-radius:8px;padding:7px 8px;cursor:pointer;border:1px solid var(--color-border);transition:border-color .2s">
        <div style="font-weight:600;font-size:14px;color:var(--gold-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${imgTag} ${d.sn}<span style="color:var(--muted);font-weight:400;font-size:13px;margin-left:2px">/USDT</span></div>
        <div style="color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${krName}</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
          <span style="font-size:12px;color:var(--text)">${d.rawPrice.replace(/0+$/, '').replace(/\.$/, '')}</span>
          <span style="font-size:14px;font-weight:700;color:${color}">${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%</span>
        </div>
      </div>`;
    }
    grid.innerHTML = html;
  } catch (e) { grid.innerHTML = '<div class="state-error" style="grid-column:1/-1">로드 실패</div>'; }
};
