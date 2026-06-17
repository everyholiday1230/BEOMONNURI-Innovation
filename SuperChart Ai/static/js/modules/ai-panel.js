/**
 * ai-panel.js — AI 분석 카드 실시간 요약 (main-app.js에서 분리)
 * 의존: window.API, window.curSymbol, window.chart, window.t
 */

async function _safeJsonFetch(url, opts) {
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

window._updateBeomSummary = async function(){
  if(!window.curSymbol) return;
  try{
    const d = await _safeJsonFetch(`${window.API}/v1/charts/candles?symbolId=${encodeURIComponent(window.curSymbol)}&timeframe=1m&limit=200`);
    if(!d?.success || !d.data?.candles?.length) return;
    const candles = d.data.candles.map(c=>({o:parseFloat(c.open),h:parseFloat(c.high),l:parseFloat(c.low),c:parseFloat(c.close),v:parseFloat(c.volume||0)}));
    const n = candles.length;
    if(n < 30) return;
    const closes = candles.map(c=>c.c);
    const last = closes[n-1];
    const chart = window.chart;
    const _t = window.t || (s => s);

    // 1. 범온캔들 강도
    const elV = document.getElementById('aiBeomV');
    const elLabel = document.getElementById('aiBeomLabel');
    if(elV && chart?._uc?.length){
      const lastBar = chart._uc[chart._uc.length-1];
      const v = lastBar?.v || 0;
      elV.textContent = (v>=0?'+':'') + v;
      elV.style.color = v>=7?'#3B82F6':v<=-7?'#2563EB':'#8E7D72';
      if(elLabel){
        if(v>=10) elLabel.textContent=(window.t||(s=>s))('매수 매우 강함');
        else if(v>=7) elLabel.textContent=(window.t||(s=>s))('매수 강함');
        else if(v>=4) elLabel.textContent=(window.t||(s=>s))('매수 약함');
        else if(v<=-10) elLabel.textContent=(window.t||(s=>s))('매도 매우 강함');
        else if(v<=-7) elLabel.textContent=(window.t||(s=>s))('매도 강함');
        else if(v<=-4) elLabel.textContent=(window.t||(s=>s))('매도 약함');
        else elLabel.textContent='중립';
      }
    }

    // 2. 추세 방향
    const elTrend = document.getElementById('aiTrendDir');
    if(elTrend && n>=60){
      let e20=closes[n-20],e60=closes[n-60];
      for(let i=n-19;i<n;i++) e20=2/21*closes[i]+(1-2/21)*e20;
      for(let i=n-59;i<n;i++) e60=2/61*closes[i]+(1-2/61)*e60;
      if(last>e20&&e20>e60){elTrend.textContent=_t('▲ 상승');elTrend.style.color='#C4384B';}
      else if(last<e20&&e20<e60){elTrend.textContent=_t('▼ 하락');elTrend.style.color='#3B82F6';}
      else{elTrend.textContent=_t('◆ 횡보');elTrend.style.color='#D8B66A';}
    }

    // 3. RSI
    const elRsi = document.getElementById('aiRsi');
    if(elRsi && n>=15){
      let gains=0,losses=0;
      for(let i=n-14;i<n;i++){const d2=closes[i]-closes[i-1];if(d2>0)gains+=d2;else losses-=d2;}
      const rsi=losses>0?Math.round(100-100/(1+gains/losses)):100;
      elRsi.textContent=rsi;
      elRsi.style.color=rsi>70?'#3B82F6':rsi<30?'#C4384B':'#8E7D72';
    }

    // 4. IMACD
    const elImacd = document.getElementById('aiImacd');
    if(elImacd && n>=30){
      let e12=closes[0],e26=closes[0];
      for(let i=1;i<n;i++){e12=2/13*closes[i]+(1-2/13)*e12;e26=2/27*closes[i]+(1-2/27)*e26;}
      let macd=e12-e26,sig=macd;
      for(let i=Math.max(1,n-9);i<n;i++){
        e12=2/13*closes[i]+(1-2/13)*e12;e26=2/27*closes[i]+(1-2/27)*e26;
        macd=e12-e26;sig=2/10*macd+(1-2/10)*sig;
      }
      const hist=macd-sig;
      elImacd.textContent=hist>0?_t('▲ 매수'):_t('▼ 매도');
      elImacd.style.color=hist>0?'#C4384B':'#3B82F6';
    }

    // 5. KVO
    const elKvo = document.getElementById('aiKvo');
    if(elKvo && n>=60){
      let buyVol=0,sellVol=0;
      for(let i=n-20;i<n;i++){
        if(closes[i]>closes[i-1]) buyVol+=candles[i].v;
        else sellVol+=candles[i].v;
      }
      const ratio=buyVol/(buyVol+sellVol+1e-10);
      elKvo.textContent=ratio>0.6?_t('매수세 강'):ratio<0.4?_t('매도세 강'):_t('균형');
      elKvo.style.color=ratio>0.6?'#C4384B':ratio<0.4?'#3B82F6':'#8E7D72';
    }

    // 6. 매수 체결강도
    const elBuy = document.getElementById('aiBuyRatio');
    if(elBuy && n>=10){
      let up=0,dn=0;
      for(let i=n-10;i<n;i++){
        if(closes[i]>=candles[i].o) up+=candles[i].v; else dn+=candles[i].v;
      }
      const pct=Math.round(up/(up+dn+1e-10)*100);
      elBuy.textContent=pct+'%';
      elBuy.style.color=pct>60?'#C4384B':pct<40?'#3B82F6':'#8E7D72';
    }

    // 7. 자금흐름
    const elFund = document.getElementById('aiFunding');
    if(elFund && n>=20){
      let pvi=0;
      const avgVol=candles.slice(n-20,n).reduce((s,c2)=>s+c2.v,0)/20;
      for(let i=n-10;i<n;i++){
        if(candles[i].v>avgVol) pvi+=(closes[i]-closes[i-1])/closes[i-1]*100;
      }
      elFund.textContent=pvi>0.1?_t('유입'):pvi<-0.1?_t('유출'):_t('중립');
      elFund.style.color=pvi>0.1?'#C4384B':pvi<-0.1?'#3B82F6':'#8E7D72';
    }

    // 8. AI 진입 시그널
    const elOb = document.getElementById('aiObSignal');
    if(elOb && chart?.overlay?.drawings){
      const obSigs=(chart.overlay.drawings||[]).filter(d=>d.type==='signal'&&(d.signalType==='ku'||d.signalType==='kd'));
      if(obSigs.length){
        const lastOb=obSigs[obSigs.length-1];
        const dir=lastOb.signalType==='ku'?_t('매수'):_t('매도');
        const color=lastOb.signalType==='ku'?'#C4384B':'#3B82F6';
        const idx=lastOb.index||0;
        const barsAgo=chart.buffer?chart.buffer.length-1-idx:0;
        let timeStr='';
        if(chart.buffer&&chart.buffer.time&&idx>=0&&idx<chart.buffer.length){
          const ts=chart.buffer.time[idx];
          if(ts){const dd=new Date(ts*1000);timeStr=`${String(dd.getMonth()+1).padStart(2,'0')}/${String(dd.getDate()).padStart(2,'0')} ${String(dd.getHours()).padStart(2,'0')}:${String(dd.getMinutes()).padStart(2,'0')}`;}
        }
        elOb.innerHTML=`<span style="color:${color};font-weight:700">${dir} ${_t('시그널')}</span><div style="color:#8E7D72;font-size:12px;margin-top:2px">${timeStr} (${barsAgo}${_t('봉 전')})</div>`;
      } else {
        elOb.textContent=_t('시그널 대기 중');
        elOb.style.color='#8E7D72';
      }
    }
  }catch(e){}
};

// 5초마다 갱신 (탭 비가시 시 스킵)
setInterval(()=>{ if(document.hidden) return; window._updateBeomSummary(); }, 5000);
setTimeout(window._updateBeomSummary, 3000);

// ─── 사용자 선택 지표 분석 ───
window._runIndAnalysis = async function(){
  const res = document.getElementById('aiIndResult');
  if(!res) return;
  const inds = [...document.querySelectorAll('#aiIndPicker input:checked')].map(c=>c.value);
  if(!inds.length){ res.innerHTML='<span style="color:#8E7D72">지표를 1개 이상 선택하세요</span>'; return; }
  res.innerHTML='<span style="color:#8E7D72">분석 중...</span>';
  try{
    const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
    const resp = await requester(`${window.API}/v1/analysis/indicators`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({symbol_id: window.curSymbol, timeframe: window.curTf, include_indicators: inds})
    });
    if (!resp || !resp.ok) throw new Error('analysis request failed');
    const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
    if (ct && !/application\/json/i.test(ct)) throw new Error('invalid content-type');
    const payload = await resp.json().catch(() => null);
    const d = payload?.data;
    if(!d || !d.items || !d.items.length){ res.innerHTML='<span style="color:var(--color-text-muted)">'+(d?.summary||'데이터 없음')+'</span>'; return; }
    const _T = window.t || (s=>s);
    const col = s => s==='buy'?'#C4384B':s==='sell'?'#3B82F6':'#8E7D72';
    const txt = s => s==='buy'?_T('매수'):s==='sell'?_T('매도'):_T('중립');
    const tot = (d.buy||0)+(d.sell||0)+ (d.items.length-(d.buy||0)-(d.sell||0));
    const buyPct = tot? Math.round((d.buy||0)/d.items.length*100):0;
    const sellPct = tot? Math.round((d.sell||0)/d.items.length*100):0;
    const vcol = d.buy>d.sell?'#C4384B':d.sell>d.buy?'#3B82F6':'#8E7D72';
    let html = '';
    // 종합 판정 카드 + 매수/매도 비율 바
    html += `<div style="background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;color:var(--color-text-muted)">${_T('종합 판정')}</span>
        <span style="font-size:15px;font-weight:800;color:${vcol}">${_T(d.verdict)}</span>
      </div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:#8E7D7222">
        <div style="width:${buyPct}%;background:#C4384B"></div>
        <div style="margin-left:auto;width:${sellPct}%;background:#3B82F6"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px">
        <span style="color:#C4384B;font-weight:600">${_T('매수')} ${d.buy||0}</span>
        <span style="color:#3B82F6;font-weight:600">${_T('매도')} ${d.sell||0}</span>
      </div>
    </div>`;
    // 코멘터리
    if(d.commentary) html += `<div style="background:rgba(216,182,106,0.08);border:1px solid rgba(216,182,106,0.25);border-radius:8px;padding:9px;margin-bottom:8px;font-size:12px;line-height:1.6;color:var(--color-text-primary)">${d.commentary.replace(/\n/g,'<br>')}</div>`;
    // 지표별 행 (신호 점 + 이름 + 근거 + 배지)
    html += d.items.map(it=>`<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(216,182,106,0.1)">
      <span style="width:8px;height:8px;border-radius:50%;background:${col(it.signal)};flex-shrink:0"></span>
      <span style="font-size:13px;font-weight:600;color:var(--color-text-primary)">${it.name}</span>
      <span style="font-size:11px;color:var(--color-text-muted);flex:1">${it.note}</span>
      <span style="font-size:11px;font-weight:700;color:${col(it.signal)};background:${col(it.signal)}1a;padding:2px 8px;border-radius:10px;white-space:nowrap">${txt(it.signal)}</span></div>`).join('');
    res.innerHTML = html;
  }catch(e){ res.innerHTML='<span style="color:#3B82F6">분석 실패</span>'; }
};
