// 매매전략 시그널 모듈
const _activeStrategies = new Set();
window._activeStrategies = _activeStrategies;

// 전략 토글
document.querySelectorAll('[data-strategy]').forEach(btn => {
  btn.addEventListener('click', function() {
    if (window.requireLogin && !window.requireLogin(this.textContent.replace(/[\s]+$/g,'').trim())) return;
    const id = this.dataset.strategy;
    // 전략별 연동 보조지표 (golden/dead/ma_support는 전략이 자체 단/장기선을 그리므로 제외)
    const indMap = {
      rsi_ob:['rsi'],rsi_os:['rsi'],
      macd_cross:['macd'],macd_dead:['macd'],
      stoch_cross:['stoch'],stoch_cross_sell:['stoch'],
      bb_lower:['bb'],bb_upper:['bb'],bb_squeeze:['bb'],
      supertrend_buy:['supertrend'],supertrend_sell:['supertrend'],
      vol_break:['vol'],
      obv_div_buy:['obv'],obv_div_sell:['obv']
    };
    if (_activeStrategies.has(id)) {
      _activeStrategies.delete(id); this.classList.remove('on');
      // 켤 때 자동으로 켰던 보조지표 끄기
      for(const ind of (indMap[id]||[])){
        const sb=document.querySelector(`.sub-ind[data-sub="${ind}"].on,.ind-tag[data-sub="${ind}"].on`)||document.querySelector(`.ind-tag[data-ind="${ind}"].on`);
        if(sb) sb.click();
      }
    }
    else {
      _activeStrategies.add(id); this.classList.add('on');
      window.showToast?.(`${this.textContent} 전략 적용`,'#921230');
      // 관련 보조지표 자동 켜기
      const inds = indMap[id]||[];
      for(const ind of inds){
        // MA 타입
        const maBtn=document.querySelector(`[data-ma-type="${ind}"]`);
        if(maBtn&&!maBtn.classList.contains('on')){maBtn.click();continue}
        // sub 지표
        const subBtn=document.querySelector(`.sub-ind[data-sub="${ind}"],.ind-tag[data-sub="${ind}"]`);
        if(subBtn&&!subBtn.classList.contains('on')){subBtn.click();continue}
        // overlay 지표
        const indBtn=document.querySelector(`.ind-tag[data-ind="${ind}"]`);
        if(indBtn&&!indBtn.classList.contains('on')){indBtn.click()}
      }
      // 설정 팝업 자동 열기
      window._openStrategySettings?.(this,true);
    }
    calcStrategySignals();
    if (window._updateActiveIndList) window._updateActiveIndList();
  });
});

function ema(arr,n){const a=2/(n+1);let r=[arr[0]];for(let i=1;i<arr.length;i++)r.push(a*arr[i]+(1-a)*r[i-1]);return r}
function sma(arr,n){const r=[];for(let i=0;i<arr.length;i++){const s=Math.max(0,i-n+1);let sum=0;for(let j=s;j<=i;j++)sum+=arr[j];r.push(sum/(i-s+1))}return r}

window.calcStrategySignals = calcStrategySignals;
function SS(id,key){const d=(window._strategyDefaults[id]||{})[key];const s=window._strategySettings[id]&&window._strategySettings[id][key];const v=(s!==undefined&&s!==null&&s!=='')?parseFloat(s):d;return Number.isFinite(v)?v:d}
function SSc(id,key){const d=(window._strategyDefaults[id]||{})[key];const s=window._strategySettings[id]&&window._strategySettings[id][key];return (s!==undefined&&s!==null&&s!=='')?s:d}
function calcStrategySignals() {
  const chart = window.chart;
  if (!chart || !chart.buffer || chart.buffer.length < 30) return;
  // 기존 전략 시그널 + 전략 MA선 제거
  chart.overlay.drawings = chart.overlay.drawings.filter(d => d.type !== 'strategy_signal' && d.type !== 'strategy_ma');
  for(const k of Object.keys(chart.indicators||{})) if(k.indexOf('strat_ma_')===0) chart.removeIndicator(k);
  if (!_activeStrategies.size) { chart._dirty = true; return; }

  const buf = chart.buffer, n = buf.length;
  const closes = Array.from(buf.close.subarray(0,n));
  const highs = Array.from(buf.high.subarray(0,n));
  const lows = Array.from(buf.low.subarray(0,n));
  const volumes = Array.from(buf.volume.subarray(0,n));

  // 골든/데드크로스 — 설정의 단기/장기 기간 사용 + 단/장기선 직접 표시
  if (_activeStrategies.has('golden') || _activeStrategies.has('dead')) {
    const sid=_activeStrategies.has('golden')?'golden':'dead';
    const sp=SS(sid,'short_period')||20, lp=SS(sid,'long_period')||60;
    const s20=ema(closes,sp), s60=ema(closes,lp);
    chart.setIndicator('strat_ma_short',s20.map((v,i)=>({index:i,value:v})),SSc(sid,'color_short'),1.5);
    chart.setIndicator('strat_ma_long',s60.map((v,i)=>({index:i,value:v})),SSc(sid,'color_long'),1.5);
    for(let i=1;i<n;i++){
      if(_activeStrategies.has('golden')&&s20[i]>s60[i]&&s20[i-1]<=s60[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'골든',price:closes[i]});
      if(_activeStrategies.has('dead')&&s20[i]<s60[i]&&s20[i-1]>=s60[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'데드',price:closes[i]});
    }
  }
  // 이평선 지지 — 설정 기간 사용 + 기준 MA선 표시
  if (_activeStrategies.has('ma_support')) {
    const ma=ema(closes,SS('ma_support','period')||60);
    chart.setIndicator('strat_ma_support',ma.map((v,i)=>({index:i,value:v})),SSc('ma_support','color'),1.5);
    for(let i=2;i<n;i++){
      if(lows[i]<=ma[i]*1.005&&closes[i]>ma[i]&&closes[i]>closes[i-1]&&closes[i-1]<closes[i-2])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'지지',price:lows[i]});
    }
  }
  // 이평선 저항 — 가격이 MA에 막혀 하락 → 숏 + 기준 MA선 표시
  if (_activeStrategies.has('ma_resist')) {
    const ma=ema(closes,SS('ma_resist','period')||60);
    chart.setIndicator('strat_ma_resist',ma.map((v,i)=>({index:i,value:v})),SSc('ma_resist','color'),1.5);
    for(let i=2;i<n;i++){
      if(highs[i]>=ma[i]*0.995&&closes[i]<ma[i]&&closes[i]<closes[i-1]&&closes[i-1]>closes[i-2])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'저항',price:highs[i]});
    }
  }
  // RSI
  if (_activeStrategies.has('rsi_ob') || _activeStrategies.has('rsi_os')) {
    const p=SS('rsi_ob','period')||14,obLv=SS('rsi_ob','level')||30,osLv=SS('rsi_os','level')||70,gains=[0],losses=[0];
    for(let i=1;i<n;i++){const d=closes[i]-closes[i-1];gains.push(d>0?d:0);losses.push(d<0?-d:0)}
    const ag=[];let gSum=0,lSum=0;
    for(let i=0;i<n;i++){
      gSum+=gains[i];lSum+=losses[i];
      if(i<p){ag.push(50)}
      else if(i===p){gSum/=p;lSum/=p;ag.push(lSum===0?100:100-100/(1+gSum/lSum))}
      else{gSum=(gSum*(p-1)+gains[i])/p;lSum=(lSum*(p-1)+losses[i])/p;ag.push(lSum===0?100:100-100/(1+gSum/lSum))}
    }
    for(let i=1;i<n;i++){
      if(_activeStrategies.has('rsi_ob')&&ag[i]>obLv&&ag[i-1]<=obLv)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'RSI',price:lows[i]});
      if(_activeStrategies.has('rsi_os')&&ag[i]<osLv&&ag[i-1]>=osLv)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'RSI',price:highs[i]});
    }
  }
  // MACD 크로스
  if (_activeStrategies.has('macd_cross')) {
    const e12=ema(closes,SS('macd_cross','fast')||12),e26=ema(closes,SS('macd_cross','slow')||26),ml=e12.map((v,i)=>v-e26[i]),sl=ema(ml,SS('macd_cross','signal')||9);
    for(let i=1;i<n;i++){
      if(ml[i]>sl[i]&&ml[i-1]<=sl[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'MACD',price:lows[i]});
    }
  }
  // MACD 데드크로스 → 숏
  if (_activeStrategies.has('macd_dead')) {
    const e12=ema(closes,SS('macd_dead','fast')||12),e26=ema(closes,SS('macd_dead','slow')||26),ml=e12.map((v,i)=>v-e26[i]),sl=ema(ml,SS('macd_dead','signal')||9);
    for(let i=1;i<n;i++){
      if(ml[i]<sl[i]&&ml[i-1]>=sl[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'MACD',price:highs[i]});
    }
  }
  // 스토캐스틱 (매수/매도)
  if (_activeStrategies.has('stoch_cross') || _activeStrategies.has('stoch_cross_sell')) {
    const kp=SS('stoch_cross','period')||SS('stoch_cross_sell','period')||14,smP=SS('stoch_cross','smooth')||SS('stoch_cross_sell','smooth')||3;
    const lvB=SS('stoch_cross','level')||30,lvS=SS('stoch_cross_sell','level')||70,stK=[];
    for(let i=0;i<n;i++){const s=Math.max(0,i-kp+1);let hi=-Infinity,lo=Infinity;for(let j=s;j<=i;j++){if(highs[j]>hi)hi=highs[j];if(lows[j]<lo)lo=lows[j]}stK.push(hi===lo?50:(closes[i]-lo)/(hi-lo)*100)}
    const smK=sma(stK,smP),smD=sma(smK,smP);
    for(let i=1;i<n;i++){
      if(_activeStrategies.has('stoch_cross')&&smK[i]>smD[i]&&smK[i-1]<=smD[i-1]&&smK[i]<lvB)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'Stoch',price:lows[i]});
      if(_activeStrategies.has('stoch_cross_sell')&&smK[i]<smD[i]&&smK[i-1]>=smD[i-1]&&smK[i]>lvS)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'Stoch',price:highs[i]});
    }
  }
  // 볼린저
  if (_activeStrategies.has('bb_lower')||_activeStrategies.has('bb_upper')||_activeStrategies.has('bb_squeeze')) {
    const p=SS('bb_lower','period')||20,m=SS('bb_lower','mult')||2,ma=sma(closes,p);
    for(let i=p;i<n;i++){
      let sum=0;for(let j=i-p+1;j<=i;j++)sum+=(closes[j]-ma[i])**2;
      const std=Math.sqrt(sum/p),upper=ma[i]+m*std,lower=ma[i]-m*std;
      if(_activeStrategies.has('bb_lower')&&lows[i]<=lower&&closes[i]>lower)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'BB',price:lows[i]});
      if(_activeStrategies.has('bb_upper')&&highs[i]>=upper&&closes[i]<upper)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'BB',price:highs[i]});
    }
  }
  // 슈퍼트렌드 (매수/매도)
  if (_activeStrategies.has('supertrend_buy') || _activeStrategies.has('supertrend_sell')) {
    const p=SS('supertrend_buy','period')||SS('supertrend_sell','period')||10,mult=SS('supertrend_buy','mult')||SS('supertrend_sell','mult')||3,atr=[];
    for(let i=0;i<n;i++){if(i===0){atr.push(highs[0]-lows[0]);continue}const tr=Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1]));atr.push(i<p?tr:(atr[i-1]*(p-1)+tr)/p)}
    let dir=1, fub=(highs[0]+lows[0])/2+mult*atr[0], flb=(highs[0]+lows[0])/2-mult*atr[0];
    for(let i=1;i<n;i++){
      const mid=(highs[i]+lows[i])/2;
      const bub=mid+mult*atr[i], blb=mid-mult*atr[i];
      // 최종 밴드 carry-over
      fub=(bub<fub||closes[i-1]>fub)?bub:fub;
      flb=(blb>flb||closes[i-1]<flb)?blb:flb;
      const prev=dir;
      if(dir===1&&closes[i]<flb) dir=-1;
      else if(dir===-1&&closes[i]>fub) dir=1;
      if(_activeStrategies.has('supertrend_buy')&&dir===1&&prev===-1)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'ST',price:lows[i]});
      if(_activeStrategies.has('supertrend_sell')&&dir===-1&&prev===1)
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'ST',price:highs[i]});
    }
  }
  // 거래량 돌파
  if (_activeStrategies.has('vol_break')) {
    const avg=sma(volumes,SS('vol_break','period')||20),vm=SS('vol_break','mult')||2;
    for(let i=20;i<n;i++){
      if(volumes[i]>avg[i]*vm&&closes[i]>closes[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'VOL',price:lows[i]});
    }
  }
  // OBV 다이버전스 (매수/매도)
  if (_activeStrategies.has('obv_div_buy') || _activeStrategies.has('obv_div_sell')) {
    const lbB=SS('obv_div_buy','lookback')||5, lbS=SS('obv_div_sell','lookback')||5;
    const obv=[0];for(let i=1;i<n;i++)obv.push(obv[i-1]+(closes[i]>closes[i-1]?volumes[i]:closes[i]<closes[i-1]?-volumes[i]:0));
    for(let i=20;i<n;i++){
      if(_activeStrategies.has('obv_div_buy')&&closes[i]<closes[i-lbB]&&obv[i]>obv[i-lbB]&&closes[i]>closes[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'long',label:'OBV',price:lows[i]});
      if(_activeStrategies.has('obv_div_sell')&&closes[i]>closes[i-lbS]&&obv[i]<obv[i-lbS]&&closes[i]<closes[i-1])
        chart.addDrawing({type:'strategy_signal',bar_idx:i,direction:'short',label:'OBV',price:highs[i]});
    }
  }
  chart._dirty = true;
  
}

// 전략 설정 기본값
const _strategyDefaults = {
  golden:{short_period:20,long_period:60,color_short:"#D8B66A",color_long:"#3B82F6"},
  dead:{short_period:20,long_period:60,color_short:"#D8B66A",color_long:"#3B82F6"},
  ma_support:{period:60,color:"#16A34A"},
  ma_resist:{period:60,color:"#C4384B"},
  rsi_ob:{period:14,level:30},
  rsi_os:{period:14,level:70},
  macd_cross:{fast:12,slow:26,signal:9},
  macd_dead:{fast:12,slow:26,signal:9},
  stoch_cross:{period:14,smooth:3,level:30},
  stoch_cross_sell:{period:14,smooth:3,level:70},
  bb_lower:{period:20,mult:2},
  bb_upper:{period:20,mult:2},
  bb_squeeze:{period:20,mult:2},
  supertrend_buy:{period:10,mult:3},
  supertrend_sell:{period:10,mult:3},
  vol_break:{period:20,mult:2},
  obv_div_buy:{lookback:5},
  obv_div_sell:{lookback:5}
};
window._strategyDefaults = _strategyDefaults;
function _stratKey(){return "chartOS_strategySettings_"+((typeof localStorage!=='undefined'&&localStorage.getItem("userName"))||"guest")}
try{window._strategySettings = JSON.parse(localStorage.getItem(_stratKey())||"{}")}catch(e){window._strategySettings = {}}
function saveStrategySettings(){try{localStorage.setItem(_stratKey(),JSON.stringify(window._strategySettings||{}))}catch(e){}}
window.saveStrategySettings = saveStrategySettings;

// 전략 설정 패널 열기 (톱니바퀴 클릭 / 전략 켤 때 공용)
function openStrategySettings(tag,forceOpen){
    const id=tag.dataset.strategy;
    const name=tag.textContent.replace(/[\s]+$/g,'').trim();
    const defs=_strategyDefaults[id]||{};
    const panel=document.getElementById('indSettingsPanel');
    if(!panel) return;
    // 드로어 열기
    const drawer=document.querySelector('.ind-bar');
    if(drawer&&!drawer.classList.contains('open')){drawer.classList.add('open');document.querySelectorAll('[data-drawer-group]').forEach(g=>g.style.display=g.dataset.drawerGroup==='strategy'?'':'none')}
    // 토글 (톱니바퀴로 같은 전략을 다시 누르면 닫기. 전략을 켤 때는 항상 열기)
    if(!forceOpen&&panel.classList.contains('open')&&panel.dataset.currentInd===id){panel.classList.remove('open');return}
    let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-weight:700;font-size:14px">${name}</span>
      <button class="_close" style="background:none;border:none;font-size:16px;color:#8E7D72;cursor:pointer">✕</button>
    </div>`;
    for(const [key,def] of Object.entries(defs)){
      const val=(window._strategySettings[id]&&window._strategySettings[id][key])!==undefined&&(window._strategySettings[id]&&window._strategySettings[id][key])!==''?window._strategySettings[id][key]:def;
      const label=key==='period'?'기간':key==='short_period'?'단기':key==='long_period'?'장기':key==='fast'?'빠른선':key==='slow'?'느린선':key==='signal'?'시그널':key==='smooth'?'스무딩':key==='mult'?'배수':key==='level'?'기준값':key==='lookback'?'비교봉수':key==='color'?'선 색상':key==='color_short'?'단기선 색상':key==='color_long'?'장기선 색상':key;
      if(key.indexOf('color')===0){
        html+=`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(216,182,106,0.1)">
        <input type="color" value="${val}" data-key="${key}" data-str="1" class="_sp" style="width:30px;height:26px;border:none;cursor:pointer;border-radius:4px;flex-shrink:0">
        <span style="font-size:14px;flex:1">${label}</span></div>`;
        continue;
      }
      const isMult=key==='mult', isLevel=key==='level';
      const mn=isMult?0.1:isLevel?-200:1, mx=isMult?20:isLevel?200:1000, st=isMult?0.1:1;
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(216,182,106,0.1)">
        <span style="font-size:14px">${label}</span>
        <input type="number" value="${val}" min="${mn}" max="${mx}" step="${st}" data-key="${key}" class="_sp" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:14px;text-align:center">
      </div>`;
    }
    html+=`<div style="display:flex;gap:6px;margin-top:10px">
      <button class="_apply" style="flex:1;padding:8px;background:#921230;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px">적용</button>
      <button class="_reset" style="flex:1;padding:8px;background:none;border:1px solid #8E7D72;border-radius:6px;color:#8E7D72;cursor:pointer;font-size:14px">기본값</button>
    </div>`;
    panel.innerHTML=html;
    panel.dataset.currentInd=id;
    panel.classList.add('open');
    panel.querySelector('._close').onclick=()=>panel.classList.remove('open');
    panel.querySelector('._reset').onclick=function(){
      delete window._strategySettings[id];
      saveStrategySettings();
      calcStrategySignals();
      openStrategySettings(tag,true);
    };
    panel.querySelector('._apply').onclick=function(){
      if(!window._strategySettings[id]) window._strategySettings[id]={};
      panel.querySelectorAll('._sp').forEach(inp=>{window._strategySettings[id][inp.dataset.key]=inp.dataset.str?inp.value:parseFloat(inp.value)});
      saveStrategySettings();
      panel.classList.remove('open');
      calcStrategySignals();
    };
}
window._openStrategySettings = openStrategySettings;

// 톱니바퀴 추가
document.querySelectorAll('[data-strategy]').forEach(tag=>{
  const gear=document.createElement('span');
  gear.className='ind-gear';
  gear.textContent='';
  gear.title='설정';
  gear.addEventListener('click',function(e){
    e.stopPropagation();
    openStrategySettings(tag);
  });
  tag.appendChild(gear);
});
