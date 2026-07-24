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

// 세로 도구 레일(지표/범온지표/매매전략/드로잉/프리셋) — 각 버튼이 해당 그룹만 보이게
// 드로어를 열고, 같은 버튼 재클릭·닫기(✕)·바깥 클릭 시 닫는다.
// (이전엔 CSS·클릭 핸들러가 전혀 없어 스타일 없는 버튼이 그대로 노출되던 죽은 UI였음)
document.addEventListener('DOMContentLoaded', function () {
  const rail = document.getElementById('toolRail');
  const drawer = document.querySelector('.ind-bar');
  if (!rail || !drawer) return;
  const RAIL_TO_GROUP = {
    indDrawerToggle: 'public',
    beomDrawerToggle: 'beom',
    strategyDrawerToggle: 'strategy',
    drawingDrawerToggle: 'drawing',
    presetDrawerToggle: 'preset',
  };
  function showGroup(group) {
    document.querySelectorAll('[data-drawer-group]').forEach((g) => {
      g.style.display = g.dataset.drawerGroup === group ? '' : 'none';
    });
  }
  function setActiveBtn(id) {
    rail.querySelectorAll('.tool-rail-btn').forEach((b) => b.classList.toggle('active', b.id === id));
  }
  function openGroup(id, group) {
    drawer.classList.add('open');
    showGroup(group);
    setActiveBtn(id);
    drawer.dataset.activeRail = id;
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    rail.querySelectorAll('.tool-rail-btn').forEach((b) => b.classList.remove('active'));
    delete drawer.dataset.activeRail;
  }
  rail.querySelectorAll('.tool-rail-btn[id]').forEach((btn) => {
    const group = RAIL_TO_GROUP[btn.id];
    if (!group) return;
    btn.addEventListener('click', () => {
      if (drawer.classList.contains('open') && drawer.dataset.activeRail === btn.id) {
        closeDrawer();
      } else {
        openGroup(btn.id, group);
      }
    });
  });
  const closeBtn = document.getElementById('indDrawerClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  // 드로어·레일 바깥을 클릭하면 닫기(설정 팝업 등 다른 UI와 충돌 없이 최소한만 처리)
  document.addEventListener('click', (e) => {
    if (!drawer.classList.contains('open')) return;
    if (e.target.closest('.ind-bar,#toolRail')) return;
    closeDrawer();
  });
});
