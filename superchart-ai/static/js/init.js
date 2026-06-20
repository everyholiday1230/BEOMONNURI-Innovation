// 보안: 우클릭 차단 (특정 영역 제외)
document.addEventListener('contextmenu',e=>{
  // 차트, 즐겨찾기, 지표, 워치리스트, inline oncontextmenu 있는 요소 제외
  if(e.target.closest('#chartWrap,#chart2Wrap,canvas,#favInds,#favSymbols,.ind-bar,.watchlist,[oncontextmenu]')) return;
  e.preventDefault();
});

// 접근성: div 인터랙티브 요소 키보드 지원 (Enter/Space)
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  const t=e.target;
  if(!t)return;
  // 포커스된 인터랙티브 div (data-action, .tb, .ind-tag 등)
  if(t.tagName==='DIV'&&(t.hasAttribute('data-action')||t.classList.contains('tb')||t.classList.contains('ind-tag')||t.classList.contains('wl-item')||t.classList.contains('right-tab'))){
    e.preventDefault();
    t.click();
  }
});
// 인터랙티브 div에 tabindex 자동 추가
document.addEventListener('DOMContentLoaded',function(){
  const selectors='.tb,.ind-tag,.wl-item,.right-tab,[data-action]:not(button):not(a)';
  document.querySelectorAll(selectors).forEach(el=>{
    if(el.tagName==='DIV'&&!el.hasAttribute('tabindex')){
      el.setAttribute('tabindex','0');
      if(!el.hasAttribute('role'))el.setAttribute('role','button');
    }
  });
});

// 테마 복원
if(localStorage.getItem('chartOS_theme')==='dark') document.body.classList.add('dark');
