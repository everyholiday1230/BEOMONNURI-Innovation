/**
 * data-actions.js — data-action 이벤트 위임 (main-app.js에서 분리)
 * 의존: window.* 전역 함수들 (모두 optional chaining)
 */

document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const param = el.dataset.param;
  const chart = window.chart;
  const actions = {
    createAlert: ()=>window.createAlert?.(),
    _closePanel: ()=>{const t=el.dataset?.target||el.closest('[data-target]')?.dataset?.target;if(t){const p=document.getElementById(t);if(p)p.style.display='none';}},
    toggleAutobot: ()=>window.toggleAutobot?.(),
    _autobotSetMode: ()=>window._autobotSetMode?.(param),
    _autobotRun: ()=>window._autobotRun?.(),
    _autobotClear: ()=>window._autobotClear?.(),
    loadHeatmap: ()=>window.loadHeatmap?.(),
    showAuth: ()=>window.showAuth?.(),
    captureChart: ()=>window.captureChart?.(),
    shareChart: ()=>window._shareChart?.(),
    startForecast: ()=>window.startForecast?.(),
    startProjection: ()=>window.startProjection?.(),
    clearForecast: ()=>window.clearForecast?.(),
    startReplayMode: ()=>window.startReplayMode?.(),
    stopReplayMode: ()=>window.stopReplayMode?.(),
    toggleFullscreen: ()=>window.toggleFullscreen?.(),
    _showFeedback: ()=>window._showFeedback?.(),
    _showSettings: ()=>window._showSettings?.(),
    _logout: ()=>window._logout?.(),
    _manualAiRefresh: ()=>window._manualAiRefresh?.(),
    _demoLong: ()=>window._demoLong?.(),
    _demoShort: ()=>window._demoShort?.(),
    _demoClose: ()=>window._demoClose?.(),
    _demoClear: ()=>window._demoClear?.(),
    replayFwd1: ()=>chart?.replayForward?.(1),
    replayFwd10: ()=>chart?.replayForward?.(10),
    replayBack1: ()=>chart?.replayBack?.(1),
    replayBack10: ()=>chart?.replayBack?.(10),
    applyPreset: ()=>window.applyPreset?.(param),
    toggleMobilePanel: ()=>window.toggleMobilePanel?.(param),
    openHelp: ()=>{const hp=document.getElementById('helpPanel');if(hp)hp.style.display='flex'},
    closeHelp: ()=>{const hp=el.closest('#helpPanel');if(hp)hp.style.display='none'},
    toggleDemo: ()=>{const p=document.getElementById('mdPanel');if(p)p.style.display=p.style.display==='none'?'block':'none'},
    toggleLang: ()=>{const lp=document.getElementById('langPanel');if(lp)lp.style.display=lp.style.display==='block'?'none':'block'},
    closeProTip: ()=>{el.parentElement.style.display='none';localStorage.setItem('chartOS_proTipHide',Date.now()+86400000)},
    closePublicTip: ()=>{el.parentElement.style.display='none';localStorage.setItem('chartOS_publicTipHide',Date.now()+604800000)},
    goLatest: ()=>{
      if(chart){
        const ts=chart.timeScale;
        const len=chart.buffer?.length||0;
        if(ts&&len>0){
          const range=Math.max(40, Math.round((ts.visibleTo-ts.visibleFrom)||120));
          const rightPad=2;
          ts.visibleTo=len+rightPad;
          ts.visibleFrom=ts.visibleTo-range;
        }else{
          chart.timeScale.fitContent(chart.buffer.length);
        }
        chart._priceScaleLocked=false;
        chart._updatePriceRange?.();
        chart._dirty=true;
        el.style.display='none';
      }
    },
    userBadgeClick: ()=>{if(typeof isLoggedIn==='function'&&isLoggedIn())window._showSettings?.();else window.showAuth?.()},
    saveSettings: ()=>{if(typeof isLoggedIn==='function'&&isLoggedIn()){window._saveChartSettingsToServer?.();window.showToast?.('차트 설정 저장됨','#C4384B')}else window.showToast?.('로그인 필요','#D8B66A')},
    exchangeVerify: ()=>{if(typeof isLoggedIn==='function'&&isLoggedIn())window.showExchangeVerify?.();else window.showAuth?.()},
    closeOverlay: ()=>{document.querySelector('.left')?.classList.remove('open');document.querySelector('.right')?.classList.remove('open');el.classList.remove('open');document.querySelectorAll('.mobile-nav button').forEach(b=>b.classList.remove('active'));document.getElementById('mnChart')?.classList.add('active')},
    toggleLeft: ()=>{
      const isMobileLike = window.matchMedia('(max-width: 980px)').matches;
      const left = document.querySelector('.left');
      const right = document.querySelector('.right');
      const overlay = document.getElementById('mobileOverlay');
      if (!left || !right || !overlay) return;
      if (!isMobileLike) {
        left.classList.toggle('open');
        return;
      }
      const willOpen = !left.classList.contains('open');
      right.classList.remove('open');
      left.classList.toggle('open', willOpen);
      overlay.classList.toggle('open', willOpen);
      document.querySelectorAll('.mobile-nav button').forEach((b)=>b.classList.remove('active'));
      document.getElementById(willOpen ? 'mnLeft' : 'mnChart')?.classList.add('active');
    },
    toggleRight: ()=>{
      const isMobileLike = window.matchMedia('(max-width: 980px)').matches;
      const left = document.querySelector('.left');
      const right = document.querySelector('.right');
      const overlay = document.getElementById('mobileOverlay');
      if (!left || !right || !overlay) return;
      if (!isMobileLike) {
        right.classList.toggle('open');
        return;
      }
      const willOpen = !right.classList.contains('open');
      left.classList.remove('open');
      right.classList.toggle('open', willOpen);
      overlay.classList.toggle('open', willOpen);
      document.querySelectorAll('.mobile-nav button').forEach((b)=>b.classList.remove('active'));
      document.getElementById(willOpen ? 'mnRight' : 'mnChart')?.classList.add('active');
    },
    replaySpeedUp: ()=>{const s=document.getElementById('replaySpeed');if(s&&s.selectedIndex<s.options.length-1){s.selectedIndex++;s.onchange?.()}},
    replaySpeedDown: ()=>{const s=document.getElementById('replaySpeed');if(s&&s.selectedIndex>0){s.selectedIndex--;s.onchange?.()}},
    openFaqFromHelp: ()=>{window.showFaqCenter?.();el.closest('#helpPanel').style.display='none'},
    startTourFromHelp: ()=>{window._startTour?.();el.closest('#helpPanel').style.display='none'},
    loadBeomSignals: ()=>window.loadBeomSignals?.(),
    createBeomAlert: ()=>window.createBeomAlert?.(),
    createBeomAlertBatch: ()=>window.createBeomAlertBatch?.(),
    toggleLogScale: ()=>{
      if(!chart||typeof chart.togglePriceScaleMode!=='function'){window.showToast?.('차트 준비 중','#D8B66A');return;}
      const mode=chart.togglePriceScaleMode();
      // 보조 차트(비교/분할)도 함께 전환
      try{
        if(window._subCharts)Object.values(window._subCharts).forEach(c=>c&&c.setPriceScaleMode&&c.setPriceScaleMode(mode));
        if(window.chart2&&window.chart2.setPriceScaleMode)window.chart2.setPriceScaleMode(mode);
      }catch(_){}
      try{localStorage.setItem('chartOS_logScale',mode==='log'?'1':'0');}catch(_){}
      window._syncLogScaleBtn?.();
    },
    toggleMagnet: ()=>{
      if(!chart||typeof chart.toggleMagnet!=='function'){window.showToast?.('차트 준비 중','#D8B66A');return;}
      const on=chart.toggleMagnet();
      try{
        if(window._subCharts)Object.values(window._subCharts).forEach(c=>c&&c.setMagnet&&c.setMagnet(on));
        if(window.chart2&&window.chart2.setMagnet)window.chart2.setMagnet(on);
      }catch(_){}
      try{localStorage.setItem('chartOS_magnet',on?'1':'0');}catch(_){}
      window._syncMagnetBtn?.();
    },
  };
  const fn = actions[action];
  if (fn) fn();
});

// data-track 클릭 추적
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-track]');
  if (!el) return;
  const API = window.API || '';
  fetch(API+'/v1/analysis/track-click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:el.dataset.track})}).catch(()=>{});
});

// ── 차트 공유 링크 생성 + 클립보드 복사 ──
// 현재 종목·타임프레임 기준 /chart/{symbol} URL(서버가 종목별 og:title 등을 채워줌)에
// 타임프레임 쿼리를 붙여 공유한다. 클립보드 API가 막힌 환경(권한 거부, 구형 브라우저,
// 비보안 컨텍스트)에서는 임시 textarea + execCommand('copy')로 폴백한다.
window._shareChart = function () {
  try {
    const sym = String(window.curSymbol || '').trim();
    if (!sym) { window.showToast?.('공유할 종목을 먼저 선택해 주세요', '#D8B66A'); return; }
    const base = sym.replace(/^KRW-/, '').replace(/USDT$/, '');
    const tf = window.curTf || '5m';
    const url = `${window.location.origin}/chart/${encodeURIComponent(base.toLowerCase())}?tf=${encodeURIComponent(tf)}`;

    const onCopied = () => window.showToast?.('차트 링크가 복사되었습니다', '#C4384B');
    const onFailed = () => window.showToast?.('링크 복사에 실패했습니다. 직접 복사해 주세요: ' + url, '#921230');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(onCopied).catch(() => _shareChartFallbackCopy(url, onCopied, onFailed));
    } else {
      _shareChartFallbackCopy(url, onCopied, onFailed);
    }
  } catch (e) {
    window.showToast?.('공유 링크 생성 중 오류가 발생했습니다', '#921230');
  }
};

function _shareChartFallbackCopy(text, onCopied, onFailed) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    ok ? onCopied() : onFailed();
  } catch (e) {
    onFailed();
  }
}

// 지표 검색
document.getElementById('indSearch')?.addEventListener('input',function(){
  const q=this.value.toLowerCase();
  document.querySelectorAll('.ind-tag').forEach(t=>t.style.display=t.textContent.toLowerCase().includes(q)?'':'none');
});

// ── 로그/선형 스케일 버튼 상태 동기화 + 저장된 설정 복원 ──
window._syncLogScaleBtn = function(){
  const btn=document.getElementById('logScaleBtn');
  if(!btn||!window.chart||typeof window.chart.getPriceScaleMode!=='function')return;
  const isLog=window.chart.getPriceScaleMode()==='log';
  btn.textContent=isLog?'로그':'선형';
  btn.classList.toggle('active',isLog);
  btn.title=isLog?'가격축: 로그 스케일 (클릭 시 선형)':'가격축: 선형 스케일 (클릭 시 로그)';
};
// ── 자석(크로스헤어 스냅) 버튼 상태 동기화 ──
window._syncMagnetBtn = function(){
  const btn=document.getElementById('magnetBtn');
  if(!btn||!window.chart)return;
  const on=!!window.chart._magnet;
  btn.classList.toggle('active',on);
  btn.title=on?'크로스헤어 자석: 켜짐 (캔들 OHLC에 스냅)':'크로스헤어 자석: 꺼짐 (자유 이동)';
};
// 차트가 준비되면 저장된 설정(자석)을 적용하고 버튼을 동기화한다.
// 가격축은 선형만 지원한다(로그 스케일 제거). 과거에 로그로 저장된 값이 있어도 선형으로 강제한다.
(function _restoreChartPrefs(tries){
  if(window.chart&&typeof window.chart.setPriceScaleMode==='function'){
    try{
      window.chart.setPriceScaleMode('linear');
      try{localStorage.removeItem('chartOS_logScale');}catch(_){}
      if(localStorage.getItem('chartOS_magnet')==='1'&&window.chart.setMagnet)window.chart.setMagnet(true);
    }catch(_){}
    window._syncMagnetBtn?.();
    return;
  }
  if(tries<=0)return;
  setTimeout(()=>_restoreChartPrefs(tries-1),400);
})(25);
