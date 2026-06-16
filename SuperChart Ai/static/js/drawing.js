// ═══ 드로잉 모듈: 마우스 핸들러 + 키보드 단축키 + 툴바 버튼 ═══
// Shift+클릭=수평선, Shift+드래그=추세선, 피보나치 모드=드래그만, ESC=삭제

// ─── 드로잉 핸들러를 임의 차트에 바인딩 (메인 + 분할 서브패널 공용) ───
function _bindDrawing(chart){
  if(!chart || !chart.overlayCanvas || chart._drawBound) return;
  chart._drawBound = true;
  // 마우스 이벤트 핸들러
  chart.overlayCanvas.addEventListener('mousedown', e=>{
  // 드로잉 모드 활성 또는 Shift일 때 팬(pan) 방지
  const inDrawMode = window._drawMode && ['fib','trendline','hline','text'].includes(window._drawMode);
  if(e.shiftKey || inDrawMode){
    e.stopPropagation();
    e.stopImmediatePropagation(); // 동일 요소의 버블 핸들러도 차단
  }
  // 드로잉 모드 중에는 shift 플래그 무시 (모드 의도 우선)
  const shiftFlag = inDrawMode ? false : e.shiftKey;
  window._drawStart={x:e.offsetX,y:e.offsetY,barIdx:chart.timeScale.xToBar(e.offsetX),price:chart.priceScale.yToPrice(e.offsetY),time:Date.now(),shift:shiftFlag};
  window._isDrawDrag=false;
}, true);

chart.overlayCanvas.addEventListener('mousemove', e=>{
  // 추세선 2-click 모드: 첫 클릭 후 마우스 따라 미리보기
  if(window._drawMode==='trendline' && window._trendlineFirstPoint){
    chart.setPreview({
      points:[
        window._trendlineFirstPoint,
        {index:chart.timeScale.xToBar(e.offsetX), price:chart.priceScale.yToPrice(e.offsetY)}
      ]
    });
  }
  if(!window._drawStart) return;
  if(Math.abs(e.offsetX-window._drawStart.x)>5 || Math.abs(e.offsetY-window._drawStart.y)>5) window._isDrawDrag=true;
  // 실시간 미리보기: 피보나치/추세선 모드 또는 Shift 드래그
  if(window._isDrawDrag && (window._drawMode==='fib' || window._drawMode==='trendline' || window._drawStart.shift)){
    chart.setPreview({
      points:[
        {index:window._drawStart.barIdx, price:window._drawStart.price},
        {index:chart.timeScale.xToBar(e.offsetX), price:chart.priceScale.yToPrice(e.offsetY)}
      ]
    });
  }
}, true);

chart.overlayCanvas.addEventListener('mouseup', e=>{
  const ds=window._drawStart;
  if(!ds) return;
  chart.clearPreview();
  const endPrice=chart.priceScale.yToPrice(e.offsetY);
  const endBarIdx=chart.timeScale.xToBar(e.offsetX);
  const dragged=window._isDrawDrag;

  if(dragged && window._drawMode==='fib'){
    // ── 피보나치: {type:'fib', high, low} — overlay.js _renderFib()와 일치 ──
    const hi=Math.max(ds.price, endPrice), lo=Math.min(ds.price, endPrice);
    chart.addDrawing({type:'fib', high:hi, low:lo});
    _exitDrawMode();
    showToast('피보나치 되돌림이 그려졌습니다','#f59e0b');

  } else if(dragged && window._drawMode==='trendline'){
    // ── 추세선 모드: 드래그로 추세선 (연장도 실선) ──
    chart.addDrawing({type:'trendline',points:[{index:ds.barIdx,price:ds.price},{index:endBarIdx,price:endPrice}],color:'#C4384B',lineWidth:2,dashed:false});
    _exitDrawMode();
    window._trendlineFirstPoint=null;

  } else if(!dragged && window._drawMode==='trendline'){
    // ── 추세선 2-click 방식: 첫 클릭 = 시작점, 두 번째 클릭 = 끝점 ──
    if(!window._trendlineFirstPoint){
      window._trendlineFirstPoint={index:endBarIdx, price:endPrice};
      showToast('다시 클릭하여 끝점 지정 (ESC로 취소)','#C4384B');
      // 모드 유지 — _exitDrawMode 호출 안 함
    } else {
      // 두 번째 클릭: 추세선 완성 (연장도 실선)
      const first=window._trendlineFirstPoint;
      chart.addDrawing({type:'trendline',points:[{index:first.index,price:first.price},{index:endBarIdx,price:endPrice}],color:'#C4384B',lineWidth:2,dashed:false});
      window._trendlineFirstPoint=null;
      _exitDrawMode();
      showToast('추세선 그려짐','#C4384B');
    }

  } else if(!dragged && window._drawMode==='hline'){
    // ── hline 모드: 클릭 한 번으로 수평선 ──
    chart.addDrawing({type:'hline',price:endPrice,color:'#921230'});
    _exitDrawMode();
    showToast('수평선 그려짐 (' + endPrice.toFixed(2) + ')','#C4384B');

  } else if(!dragged && window._drawMode==='vline'){
    // ── vline 모드: 클릭 한 번으로 수직선 ──
    chart.addDrawing({type:'vline',index:endBarIdx,color:'#8E7D72'});
    _exitDrawMode();
    showToast('수직선 그려짐','#8E7D72');

  } else if(!dragged && window._drawMode==='text'){
    // ── text 모드: 클릭 위치에 텍스트 ──
    (async()=>{
      const txt = await (window._modal?window._modal({title:'텍스트 입력',input:'',placeholder:'예: 지지선'}):Promise.resolve(prompt('텍스트:')));
      if(txt) {
        chart.addDrawing({type:'text',price:endPrice,text:txt,color:'#D8B66A',index:endBarIdx});
        showToast('텍스트 추가됨','#C4384B');
      }
      _exitDrawMode();
    })();

  } else if(dragged && ds.shift){
    // ── Shift+드래그: 추세선 (단, 피보나치/추세선 모드가 아닐 때, 연장도 실선) ──
    chart.addDrawing({type:'trendline',points:[{index:ds.barIdx,price:ds.price},{index:endBarIdx,price:endPrice}],color:'#C4384B',lineWidth:2,dashed:false});

  } else if(!dragged && Date.now()-ds.time<500){
    if(ds.shift){
      // Shift+클릭: 수평선
      chart.addDrawing({type:'hline',price:endPrice,color:'#921230'});
    } else {
      // 일반 클릭: 드로잉 선택
      chart.selectDrawingAt(e.offsetX, e.offsetY);
    }
  }
  window._drawStart=null; window._isDrawDrag=false;
}, true);
} // ── _bindDrawing 끝 ──

// 메인 차트에 바인딩 + 다른 모듈(분할 서브패널)이 쓸 수 있게 노출
_bindDrawing(chart);
window._bindDrawing = _bindDrawing;

// ─── 드로잉 모드 종료 헬퍼 ───
function _exitDrawMode(){
  window._drawMode=null;
  window._trendlineFirstPoint=null; // 2-click 추세선 중간 상태 리셋
  if(chart && chart.clearPreview) chart.clearPreview();
  document.querySelectorAll('[data-draw]').forEach(x=>x.classList.remove('active'));
}

// ─── 키보드 단축키 ───
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;

  // ESC: 도움말 닫기 → 선택 드로잉 삭제 → 마지막 드로잉 삭제 → 드로잉 모드 해제
  if(e.key==='Escape'){
    const hp=document.getElementById('helpPanel');
    if(hp && hp.style.display!=='none'){hp.style.display='none';return}
    if(window._drawMode){_exitDrawMode();return}
    if(chart && chart.deleteSelected()) return;
    if(chart && chart.overlay.drawings.length>0){chart.overlay.drawings.pop();chart._dirty=true}
  }
  if(e.key==='Delete' && chart) chart.deleteSelected();
  if(e.key==='?' || (e.key==='/' && e.shiftKey)){
    const hp=document.getElementById('helpPanel');
    if(hp) hp.style.display=hp.style.display==='none'?'flex':'none';
  }
  // 타임프레임 단축키: 1~6
  const tfMap={'1':'1m','2':'5m','3':'15m','4':'1h','5':'4h','6':'1d'};
  if(tfMap[e.key]&&!e.ctrlKey&&!e.altKey){document.querySelector(`[data-tf="${tfMap[e.key]}"]`)?.click()}
  // 풀스크린: Alt+F
  if(e.altKey&&(e.key==='f'||e.key==='F')){e.preventDefault();if(typeof toggleFullscreen==='function')toggleFullscreen()}
  // 스크린샷: Ctrl+S
  if(e.key==='s'&&e.ctrlKey){e.preventDefault();if(typeof captureChart==='function')captureChart()}
  // Ctrl+Z: 지표 되돌리기
  if((e.key==='z'||e.key==='Z')&&e.ctrlKey&&!e.shiftKey){e.preventDefault();if(typeof _undoInd==='function')_undoInd();}
});

// ─── 드래그 vs 클릭 구분 (onClick 충돌 방지) ───
var _mdPos=null;
if(!window._mdSetup){window._mdSetup=true;document.querySelector('.chart-wrap')?.addEventListener('mousedown',e=>{_mdPos={x:e.clientX,y:e.clientY}});}

chart.onClick(async({price,barIdx})=>{
  if(_mdPos&&(Math.abs(event?.clientX-_mdPos.x)>5||Math.abs(event?.clientY-_mdPos.y)>5)){_mdPos=null;return;}
  _mdPos=null;
  // Alt+클릭: 진입 조건 체크
  if(window._lastClickAlt){
    window._lastClickAlt=false;
    try{
      const r=await window.api.raw(`${API}/v1/charts/ind-h?symbolId=${curSymbol}&timeframe=${curTf}&limit=${chart.buffer.length||2000}&barIndex=${barIdx}`);
      const d=await r.json();
      if(!d.success||!d.data) return;
      const e2=d.data;
      const b=e2.buy, s=e2.sell, dt=b.detail;
      const ok=v=>v?'O':'X';
      let pop=document.getElementById('entryCheckPop');
      if(!pop){pop=document.createElement('div');pop.id='entryCheckPop';pop.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:10px;padding:16px;z-index:9999;min-width:280px;font-size:14px;color:var(--text);box-shadow:0 8px 24px rgba(106,30,51,0.1);max-height:80vh;overflow-y:auto';document.body.appendChild(pop)}
      window._checkedBars = window._checkedBars || [];
      window._checkedBars.push({index:barIdx, price:e2.price, buy:b, sell:s, detail:dt, symbol:curSymbol, tf:curTf, time:chart.buffer.time[barIdx]});
      pop.innerHTML=`
        <div style="font-weight:700;color:var(--gold-text);margin-bottom:8px">진입 조건 체크 (봉 #${barIdx})</div>
        <div style="color:#8E7D72;margin-bottom:6px">가격: ${e2.price.toFixed(2)}</div>
        <div style="font-weight:700;color:#C4384B;margin:8px 0 4px">매수 ${b.result?'진입 가능':'불가'}</div>
        <div>${ok(b.udrsi)} 강도측정: ${dt.a>0?'0↑':'0↓'} ${dt.a.toFixed(4)} (prev ${dt.a_prev.toFixed(4)}) ${dt.a>dt.a_prev?'↑상승':'↓하락'}</div>
        <div>${ok(b.udstoch)} 과열분석: ${dt.c>0?'0↑':'0↓'} ${dt.c.toFixed(4)} (prev ${dt.c_prev.toFixed(4)}) ${dt.c>dt.c_prev?'↑상승':'↓하락'}</div>
        <div>${ok(b.stc)} STC: 얇${dt.stc_thin.toFixed(4)} 굵${dt.stc_thick.toFixed(4)} (prev ${dt.stc_thick_prev.toFixed(4)})</div>
        <div>${ok(b.rsimfi)} RSI/MFI: R${dt.rsi.toFixed(4)} M${dt.mfi.toFixed(4)} (prev R${dt.rsi_prev.toFixed(4)} M${dt.mfi_prev.toFixed(4)})</div>
        <div>${b.false_filter?'거짓필터: RSI↑ MFI↓':''}</div>
        <div style="font-weight:700;color:#3B82F6;margin:8px 0 4px">매도 ${s.result?'진입 가능':'불가'}</div>
        <div>${ok(s.udrsi)} 강도측정 ${ok(s.udstoch)} 과열분석 ${ok(s.stc)} 추세전환 ${ok(s.rsimfi)} 매매압력</div>
        <div>${s.false_filter?'거짓필터: RSI↓ MFI↑':''}</div>
        <div style="margin-top:4px;color:#8E7D72;font-size:14px">저장됨: ${window._checkedBars.length}개</div>
        <div style="display:flex;gap:4px;margin-top:6px">
        <button onclick="this.parentElement.parentElement.style.display='none'" style="flex:1;padding:4px;border:1px solid var(--border);background:none;color:var(--text);border-radius:4px;cursor:pointer;font-size:14px">닫기</button>
        <button onclick="window._analyzeChecked()" style="flex:1;padding:4px;border:1px solid #D8B66A;background:none;color:var(--gold-text);border-radius:4px;cursor:pointer;font-size:14px">분석 요청</button>
        <button onclick="window._checkedBars=[];showToast('초기화됨')" style="flex:1;padding:4px;border:1px solid #3B82F6;background:none;color:#3B82F6;border-radius:4px;cursor:pointer;font-size:14px">초기화</button>
        </div>`;
      pop.style.display='block';
    }catch(e3){console.error('check-entry error:',e3)}
  }
});
// Alt키 감지
document.addEventListener('click',e=>{window._lastClickAlt=e.altKey;});

window._analyzeChecked = async function(){
  if(!window._checkedBars || !window._checkedBars.length){showToast('체크된 봉이 없습니다');return;}
  try{
    const r = await window.api.raw(API+'/v1/charts/analyze-checked', {
      method:'POST',
      body: {bars: window._checkedBars, symbol: curSymbol, tf: curTf}
    });
    const d = await r.json();
    if(d.success){
      showToast(d.data.summary || '분석 완료');
      let pop=document.getElementById('entryCheckPop');
      if(pop){
        pop.innerHTML='<div style="font-weight:700;color:var(--gold-text);margin-bottom:8px">분석 결과 ('+window._checkedBars.length+'개 봉)</div>'+
          '<pre style="white-space:pre-wrap;font-size:14px;color:#032129">'+JSON.stringify(d.data,null,2)+'</pre>'+
          '<button onclick="this.parentElement.style.display=\'none\'" style="margin-top:8px;padding:4px 12px;border:1px solid var(--border);background:none;color:var(--text);border-radius:4px;cursor:pointer;font-size:14px;width:100%">닫기</button>';
      }
    }
  }catch(e){console.error(e);showToast('분석 실패');}
};

// ─── 툴바 드로잉 버튼 ───
// drawing.js가 먼저 실행되므로 DOMContentLoaded 이후 한 번만 등록 (중복 방지)
function _setupDrawToolbar(){
  // 활성 패널 차트(분할 시) 또는 메인
  function _dt(){
    const id = window._activeChartPanel;
    if (id && id !== 'main' && window._subCharts && window._subCharts[id]) return window._subCharts[id];
    return window.chart || chart;
  }
  document.querySelectorAll('[data-draw]').forEach(b=>{
    b.onclick=function(){
      if(window.requireLogin && !window.requireLogin('드로잉 도구')) return;
      const m=this.dataset.draw;
      if(m==='clear'){_dt().clearDrawings();_exitDrawMode();return}
      if(m==='fib'){
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode='fib';
        showToast('차트에서 드래그하여 피보나치를 그리세요','#f59e0b');
        return;
      }
      if(m==='hline'){
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode=null; // hline은 Shift+클릭으로 그림 (모드 필요 없음)
        showToast('Shift+클릭으로 수평선을 그리세요','#3b82f6');
        return;
      }
      if(m==='trendline'){
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode='trendline';
        showToast('드래그하거나 두 점을 차례로 클릭하세요','#C4384B');
        return;
      }
      if(m==='text'){
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode='text';
        showToast('차트에서 클릭하여 텍스트를 배치하세요','#D8B66A');
        return;
      }
      if(m==='vline'){
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode='vline';
        showToast('차트에서 클릭하여 수직선을 그으세요','#8E7D72');
        return;
      }
      if(m==='hline-mode'){
        // 모바일용: Shift 대신 모드 방식으로 수평선
        _exitDrawMode();
        this.classList.add('active');
        window._drawMode='hline';
        showToast('차트에서 클릭하여 수평선을 그으세요','#921230');
        return;
      }
      _exitDrawMode();
    };
  });
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_setupDrawToolbar)}
else{_setupDrawToolbar()}
