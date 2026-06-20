// ═══ favorites.js — 종목+지표 즐겨찾기 ═══
// 의존: window.showToast, window.isLoggedIn, window.curSymbol, window.loadCandles

// ═══ 지표 즐겨찾기 (상단 도구바) ═══
window._favInds=JSON.parse(localStorage.getItem('chartOS_favInds')||'[]');
window._renderFavInds=function(){
  const el=document.getElementById('favInds');if(!el)return;
  if(!window._favInds.length){el.innerHTML='<span style="color:var(--color-text-muted);font-size:11px;opacity:0.7">'+(window.t?window.t('지표를 우클릭해 추가'):'지표를 우클릭해 추가')+'</span>';return;}
  el.innerHTML=window._favInds.map(id=>{
    const tag=document.querySelector('[data-ind="'+id+'"]')||document.querySelector('[data-sub="'+id+'"]');
    const name=tag?tag.textContent.replace(/[\s]+$/g,'').trim():id;
    const isOn=tag?.classList.contains('on');
    const isPro=tag?.classList.contains('pro-ind')||tag?.classList.contains('member-ind');
    const activeColor=isPro?'#D8B66A':'#C4384B';
    const activeBg=isPro?'rgba(216,182,106,0.15)':'rgba(196,56,75,0.12)';
    return `<div class="sym-chip ${isOn?'active':''}" data-favind="${id}" title="${name} · 클릭: 켜기/끄기 · 우클릭: 제거" onclick="window._clickFavInd(this.dataset.favind)" oncontextmenu="event.preventDefault();window._removeFav(this.dataset.favind)" style="${isOn?'background:'+activeBg+';border-color:'+activeColor+';color:'+activeColor:''}">
      <span class="sym-chip-code">${name}</span>
    </div>`;
  }).join('');
};
window._addFav=function(id){
  if(!window.isLoggedIn||!window.isLoggedIn()){window.showToast('이 기능을 사용하려면 로그인이 필요해요','#921230');if(window.showAuthModal)window.showAuthModal();return;}
  if(!window._favInds.includes(id)){
    window._favInds.push(id);
    localStorage.setItem('chartOS_favInds',JSON.stringify(window._favInds));
    window._renderFavInds();
    window.showToast('즐겨찾기 추가','#C4384B');
    if(typeof window._debounceSaveChartSettings==='function') window._debounceSaveChartSettings();
  }
};
window._removeFav=function(id){
  window._favInds=window._favInds.filter(x=>x!==id);
  localStorage.setItem('chartOS_favInds',JSON.stringify(window._favInds));
  window._renderFavInds();
  window.showToast('즐겨찾기 제거','#8E7D72');
  if(typeof window._debounceSaveChartSettings==='function') window._debounceSaveChartSettings();
};
// 지표 태그 우클릭 → 즐겨찾기 추가
document.querySelectorAll('.ind-tag[data-ind],.sub-ind[data-sub]').forEach(t=>{
  t.addEventListener('contextmenu',e=>{
    e.preventDefault();
    const id=t.dataset.ind||t.dataset.sub;
    if(id) window._addFav(id);
  });
});
setTimeout(window._renderFavInds,500);

// ═══ 종목 즐겨찾기 ═══
window._favSymbols=JSON.parse(localStorage.getItem('chartOS_favSymbols')||'[]');
window._renderFavSymbols=function(){
  const el=document.getElementById('favSymbols');if(!el)return;
  if(!window.isLoggedIn()){el.innerHTML='';return;}
  // 데이터 무결성: USDT 접미사 없으면 자동 보정 (구버전 잘못 저장된 즐겨찾기 복구)
  let changed = false;
  window._favSymbols = window._favSymbols.map(s => {
    if(!s) { changed = true; return null; }
    if(!s.includes('USDT') && !s.includes('KRW-')) {
      changed = true;
      return s + 'USDT';
    }
    return s;
  }).filter(Boolean);
  if(changed) localStorage.setItem('chartOS_favSymbols', JSON.stringify(window._favSymbols));

  if(!window._favSymbols.length){el.innerHTML='<span style="color:var(--color-text-muted);font-size:11px;opacity:0.7">'+(window.t?window.t('종목을 우클릭해 추가'):'종목을 우클릭해 추가')+'</span>';return;}
  const imgMap = window.coinImgUrl || {};
  el.innerHTML=window._favSymbols.map(sym=>{
    const isActive=sym===window.curSymbol;
    const base=sym.replace('USDT','').replace('KRW-','');
    const quote=sym.includes('KRW-') ? '/KRW' : '/USDT';
    const imgUrl=imgMap[sym]||'';
    const _token=base.toUpperCase().replace(/[^A-Z0-9]/g,'');
    const _coin=_token?`/static/coin-logos/${_token}.png`:'';
    const _stock=_token?`/static/stock-logos/${_token}.png`:'';
    // db → coin-logos → stock-logos 순으로 시도, 모두 없으면 숨김(첫 글자 배지 미사용 — 기존 정책 유지)
    const _start=imgUrl||_coin||'';
    const _onerr=`var s=this.getAttribute('data-step')||'0';if(s==='0'){this.setAttribute('data-step','1');this.src='${_coin}';}else if(s==='1'){this.setAttribute('data-step','2');this.src='${_stock}';}else{this.onerror=null;this.style.display='none';}`;
    const imgHtml = _start
      ? `<img src="${_start}" data-step="${imgUrl?'0':'1'}" alt="" loading="lazy" onerror="${_onerr}">`
      : '';
    return `<div class="sym-chip ${isActive?'active':''}" data-favsym="${sym}" onclick="window._selectSym(this.dataset.favsym)" oncontextmenu="event.preventDefault();window._removeFavSym(this.dataset.favsym)" title="${base}${quote} — 우클릭으로 제거">
      ${imgHtml}
      <span class="sym-chip-code">${base}<span class="sym-chip-quote">${quote}</span></span>
    </div>`;
  }).join('');
};
window._addFavSym=function(sym){
  if(!window.isLoggedIn||!window.isLoggedIn()){window.showToast('이 기능을 사용하려면 로그인이 필요해요','#921230');if(window.showAuthModal)window.showAuthModal();return;}
  if(!window._favSymbols.includes(sym)){
    window._favSymbols.push(sym);
    localStorage.setItem('chartOS_favSymbols',JSON.stringify(window._favSymbols));
    window._renderFavSymbols();
    window.showToast(sym+' 즐겨찾기 추가','#C4384B');
    if(typeof window._debounceSaveChartSettings==='function') window._debounceSaveChartSettings();
  }
};
window._removeFavSym=function(sym){
  window._favSymbols=window._favSymbols.filter(x=>x!==sym);
  localStorage.setItem('chartOS_favSymbols',JSON.stringify(window._favSymbols));
  window._renderFavSymbols();
  window.showToast(sym+' 즐겨찾기 제거','#8E7D72');
  if(typeof window._debounceSaveChartSettings==='function') window._debounceSaveChartSettings();
};
// 워치리스트 항목 우클릭 → 종목 즐겨찾기
document.getElementById('watchlist')?.addEventListener('contextmenu',function(e){
  const item=e.target.closest('.wl-item');
  if(item){
    e.preventDefault();
    const sym=item.dataset.symbol||item.textContent.trim().split(' ')[0];
    if(sym) window._addFavSym(sym);
  }
});
setTimeout(window._renderFavSymbols,600);



// 지표 즐겨찾기 클릭 — 해당 지표 토글
window._clickFavInd=function(id){
  const el=document.querySelector(`[data-ind="${id}"]`)||document.querySelector(`[data-sub="${id}"]`);
  if(el) el.click();
};
