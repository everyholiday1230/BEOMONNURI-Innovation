// ═══════════════════════════════════════════════
// AI 자동매매 (Paper Trading) — 차트 신호 표시만
// 실제 거래소 주문 없음. VIP 전용.
// 모드: 보수적(6/9) / 절충(5/9) / 커스텀(사용자 지정 가중치)
// ═══════════════════════════════════════════════
(function(){
  'use strict';
  let _autobotMode = 'balanced';  // 'conservative' | 'balanced' | 'custom'
  let _autobotMarkers = [];

  // 지표 목록 (id, 라벨, 기본 가중치)
  const INDICATORS = [
    { id: 'ultra',   label: 'BEOM AI 캔들',  default: 2.0 },
    { id: 'master',  label: '종합매매',       default: 2.0 },
    { id: 'uprsi',   label: '강도측정',       default: 1.5 },
    { id: 'udstoch', label: '과열분석',       default: 1.5 },
    { id: 'darak',   label: '범온MA',         default: 1.0 },
    { id: 'vwap',    label: 'VWAP',           default: 1.0 },
    { id: 'imacd',   label: 'IMACD',          default: 1.0 },
    { id: 'ob',      label: '거래밀집구간',   default: 1.0 },
    { id: 'fib',     label: '피보나치',       default: 0 },  // 기본 비활성
  ];

  // localStorage 키
  const _LS_WEIGHTS = 'chartOS_autobotWeights';
  const _LS_THRESHOLD = 'chartOS_autobotThreshold';

  // 커스텀 가중치 불러오기
  function _loadCustomWeights() {
    try {
      const s = localStorage.getItem(_LS_WEIGHTS);
      if (s) return JSON.parse(s);
    } catch(e) {}
    // 기본값
    const d = {};
    for (const ind of INDICATORS) d[ind.id] = ind.default;
    return d;
  }

  function _saveCustomWeights(weights) {
    try { localStorage.setItem(_LS_WEIGHTS, JSON.stringify(weights)); } catch(e) {}
  }

  function _loadCustomThreshold() {
    const s = localStorage.getItem(_LS_THRESHOLD);
    return s ? parseFloat(s) : 4.0;
  }

  function _saveCustomThreshold(v) {
    try { localStorage.setItem(_LS_THRESHOLD, String(v)); } catch(e) {}
  }

  // 지표 목록 렌더링 (커스텀 UI)
  function _renderIndList() {
    const el = document.getElementById('autobotIndList');
    if (!el) return;
    const weights = _loadCustomWeights();
    el.innerHTML = INDICATORS.map(ind => {
      const w = weights[ind.id] != null ? weights[ind.id] : ind.default;
      const enabled = w > 0;
      return `
        <div style="display:flex;align-items:center;gap:6px;padding:2px 0">
          <input type="checkbox" id="ab_${ind.id}_ck" ${enabled ? 'checked' : ''}
            style="width:13px;height:13px;accent-color:var(--color-primary);cursor:pointer"
            data-ind="${ind.id}">
          <label for="ab_${ind.id}_ck" style="flex:1;cursor:pointer;color:var(--color-text-primary)">${ind.label}</label>
          <input type="number" id="ab_${ind.id}_w" value="${w}" step="0.5" min="0" max="5"
            style="width:46px;padding:1px 3px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;text-align:center"
            data-ind-w="${ind.id}">
        </div>
      `;
    }).join('');

    // 임계값 로드
    const thresholdEl = document.getElementById('autobotThreshold');
    if (thresholdEl) thresholdEl.value = _loadCustomThreshold();

    // 체크박스 토글 시 가중치 입력란 0/default 전환
    el.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.ind;
        const wEl = document.getElementById(`ab_${id}_w`);
        if (!wEl) return;
        if (e.target.checked) {
          const cur = parseFloat(wEl.value);
          if (!cur || cur <= 0) {
            const def = INDICATORS.find(x => x.id === id)?.default || 1.0;
            wEl.value = def;
          }
        } else {
          wEl.value = 0;
        }
        _syncCustomSettings();
      });
    });

    // 가중치 입력 변경
    el.querySelectorAll('input[type=number]').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const id = e.target.dataset.indW;
        const v = parseFloat(e.target.value) || 0;
        const ckEl = document.getElementById(`ab_${id}_ck`);
        if (ckEl) ckEl.checked = (v > 0);
        _syncCustomSettings();
      });
    });

    // 임계값 변경
    if (thresholdEl) {
      thresholdEl.addEventListener('change', _syncCustomSettings);
    }
  }

  // 현재 UI 설정을 localStorage 에 저장
  function _syncCustomSettings() {
    const weights = {};
    for (const ind of INDICATORS) {
      const wEl = document.getElementById(`ab_${ind.id}_w`);
      weights[ind.id] = wEl ? parseFloat(wEl.value) || 0 : 0;
    }
    _saveCustomWeights(weights);
    const thEl = document.getElementById('autobotThreshold');
    if (thEl) _saveCustomThreshold(parseFloat(thEl.value) || 4.0);
  }

  // 패널 토글
  window.toggleAutobot = function(){
    const panel = document.getElementById('autobotPanel');
    if(!panel) return;
    const loggedIn = (typeof window.isLoggedIn === 'function' && window.isLoggedIn())
                  || !!window.authToken
                  || !!window.userName
                  || /(?:^|;\s*)csrf_token=/.test(document.cookie || '');
    if(!loggedIn){
      window.showToast && window.showToast('로그인 후 이용 가능', '#3B82F6');
      window.showAuth && window.showAuth();
      return;
    }
    const premium = (typeof window.isPremium === 'function' && window.isPremium())
                 || window.userPlan === 'pro'
                 || window.userPlan === 'premium';
    if(!premium){
      window.showToast && window.showToast('VIP 회원 전용 기능입니다', '#D8B66A');
      return;
    }
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    // 열 때 커스텀 모드면 지표 목록 렌더링
    if (opening && _autobotMode === 'custom') {
      _renderIndList();
      document.getElementById('autobotCustomBox').style.display = 'block';
    }
  };

  // 모드 변경
  window._autobotSetMode = function(mode){
    _autobotMode = mode;
    // 버튼 active 표시
    ['conservative', 'balanced', 'custom'].forEach(m => {
      const btn = document.getElementById('autobotMode_' + m);
      if (btn) btn.classList.toggle('is-primary', m === mode);
    });
    // 커스텀 박스 표시
    const box = document.getElementById('autobotCustomBox');
    if (box) {
      if (mode === 'custom') {
        box.style.setProperty('display', 'block', 'important');
        _renderIndList();  // 지표 목록 렌더링
      } else {
        box.style.setProperty('display', 'none', 'important');
      }
    }
    const label = mode === 'conservative' ? '보수적 (6표)' :
                  mode === 'custom' ? '커스텀' : '절충 (5표)';
    window.showToast && window.showToast('자동매매 모드: ' + label, '#921230');
  };

  // 분석 실행
  window._autobotRun = async function(silent){
    if(!window.curSymbol || !window.curTf){
      if(!silent) window.showToast && window.showToast('심볼/타임프레임이 없습니다', '#3B82F6');
      return;
    }
    const btn = document.querySelector('[data-action="_autobotRun"]');
    if(btn && !silent){ btn.disabled = true; btn.textContent = '⏳ 분석 중...'; }

    try {
      const chartLimit = (window.chart && window.chart.buffer && window.chart.buffer.length)
        ? window.chart.buffer.length : 500;

      let url, opts;
      if (_autobotMode === 'custom') {
        // POST로 커스텀 설정 전송
        _syncCustomSettings();
        const body = {
          symbolId: window.curSymbol,
          timeframe: window.curTf,
          limit: chartLimit,
          weights: _loadCustomWeights(),
          threshold: _loadCustomThreshold(),
        };
        url = `${window.API || ''}/v1/charts/ind-autobot`;
        opts = {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'include',
          body: JSON.stringify(body),
        };
      } else {
        // 기본 모드 (GET)
        url = `${window.API || ''}/v1/charts/ind-autobot?symbolId=${encodeURIComponent(window.curSymbol)}&timeframe=${encodeURIComponent(window.curTf)}&limit=${chartLimit}&mode=${_autobotMode}`;
        opts = { credentials: 'include' };
      }

      const r = await fetch(url, opts);
      const d = await r.json();
      if(!d.success){
        if(!silent) window.showToast && window.showToast('분석 실패', '#3B82F6');
        return;
      }
      const data = d.data || {};
      if(data._access === 'pro_only'){
        if(!silent) window.showToast && window.showToast('VIP 회원 전용입니다', '#D8B66A');
        return;
      }
      window._autobotActive = true;
      _renderAutobotResults(data, !!silent);
    } catch(e){
      console.error('autobot error:', e);
      if(!silent) window.showToast && window.showToast('분석 중 오류', '#3B82F6');
    } finally {
      if(btn && !silent){ btn.disabled = false; btn.textContent = '분석 실행'; }
    }
  };

  function _renderAutobotResults(data, silent){
    const actions = data.actions || [];
    const summary = data.summary || {};

    const sumEl = document.getElementById('autobotSummary');
    if(sumEl){
      sumEl.style.display = 'block';
      const modeLabel = data.mode === 'conservative' ? '보수적' :
                        data.mode === 'custom' ? '커스텀' : '절충';
      sumEl.innerHTML = `
        <div><b>모드:</b> ${modeLabel} (임계값 ${data.threshold})</div>
        <div><b>총 거래:</b> ${(summary.win_count||0) + (summary.loss_count||0)}회</div>
        <div><b>승률:</b> <span style="color:${(summary.win_rate_pct||0) >= 50 ? 'var(--color-success)' : 'var(--color-error)'}">${summary.win_rate_pct != null ? summary.win_rate_pct + '%' : '-'}</span></div>
        <div><b>가상 PnL:</b> <span style="color:${(summary.total_pnl_pct||0) >= 0 ? 'var(--color-success)' : 'var(--color-error)'}">${(summary.total_pnl_pct||0) >= 0 ? '+' : ''}${summary.total_pnl_pct || 0}%</span></div>
        <div style="color:var(--color-text-muted);font-size:14px;margin-top:4px">
          자금 ${(summary.capital_fraction||0)*100}% · 레버리지 ${summary.leverage||1}x<br>
          롱 ${summary.long_entries||0}회 · 숏 ${summary.short_entries||0}회<br>
          TP ${summary.tp_hits||0}회 · 손절 ${summary.stop_losses||0}회
        </div>
      `;
    }

    const logEl = document.getElementById('autobotLog');
    if(logEl){
      const recent = actions.slice(-10).reverse();
      logEl.innerHTML = recent.map(a => {
        const act = a.action || '';
        const color = act.includes('ENTER') ? 'var(--color-primary)' :
                      act === 'STOP_LOSS' ? 'var(--color-error)' :
                      act.includes('TP') ? 'var(--color-success)' : 'var(--color-text-muted)';
        const pnl = a.pnl_pct != null ? ` (${a.pnl_pct >= 0 ? '+' : ''}${a.pnl_pct}%)` : '';
        return `<div style="padding:2px 0;color:${color}">${act}${pnl}</div>`;
      }).join('') || '<div class="state-empty compact">신호 없음</div>';
    }

    _clearAutobotMarkers();
    if(!window.chart || !window.chart.addDrawing){
      if (!silent) window.showToast && window.showToast('차트 준비 안 됨', '#3B82F6');
      return;
    }
    for(const a of actions){
      const mk = _drawActionMarker(a);
      if(mk) _autobotMarkers.push(mk);
    }
    if(window.chart){
      window.chart._dirty = true;
      if(typeof window._refreshOverlays === 'function') window._refreshOverlays();
    }

    const totalTrades = (summary.win_count||0) + (summary.loss_count||0);
    if (!silent) {
      window.showToast && window.showToast(
        `AI매매: ${totalTrades}회, 승률 ${summary.win_rate_pct||0}%, PnL ${summary.total_pnl_pct >= 0 ? '+' : ''}${summary.total_pnl_pct||0}%`,
        '#C4384B'
      );
    }
  }

  function _drawActionMarker(a){
    if(!window.chart || !window.chart.addDrawing) return null;
    const idx = a.index;
    const act = a.action || '';
    let label, color, price, renderAction;

    if(act === 'ENTER_LONG'){
      label = 'LONG';        color = '#C4384B'; price = a.entry; renderAction = 'long_entry';
    } else if(act === 'ENTER_SHORT'){
      label = 'SHORT';       color = '#3B82F6'; price = a.entry; renderAction = 'short_entry';
    } else if(act === 'STOP_LOSS'){
      const p = (a.pnl_pct != null) ? (a.pnl_pct >= 0 ? '+' : '') + a.pnl_pct + '%' : 'SL';
      label = 'SL ' + p;     color = '#3B82F6'; price = a.exit;  renderAction = 'stop_loss';
    } else if(act === 'EXIT_ALL'){
      label = 'EXIT';        color = '#D8B66A'; price = a.exit;  renderAction = 'close';
    } else if(act.endsWith('_TP1')){
      label = 'TP1 1/3';     color = '#D8B66A'; price = a.exit;  renderAction = 'tp1';
    } else if(act.endsWith('_TP2')){
      label = 'TP2 1/3';     color = '#D8B66A'; price = a.exit;  renderAction = 'tp2';
    } else if(act.endsWith('_TP3')){
      const p = (a.pnl_pct != null) ? ' +' + a.pnl_pct + '%' : '';
      label = 'TP3' + p;     color = '#B8942E'; price = a.exit;  renderAction = 'tp3';
    } else {
      return null;
    }

    const drawing = {
      type: 'autobot_marker',
      index: idx,
      price: price,
      label: label,
      action: renderAction,
      _color: color,
      _calcOwner: 'autobot',
      _origAction: act,
      _pnl_pct: a.pnl_pct,
    };
    if(window.chart.overlay && window.chart.overlay.drawings){
      window.chart.overlay.drawings.push(drawing);
    }
    return drawing;
  }

  function _clearAutobotMarkers(){
    if(!window.chart || !window.chart.overlay) return;
    if(Array.isArray(window.chart.overlay.drawings)){
      window.chart.overlay.drawings = window.chart.overlay.drawings.filter(d => d._calcOwner !== 'autobot');
    }
    _autobotMarkers = [];
  }

  window._autobotClear = function(){
    window._autobotActive = false;
    _clearAutobotMarkers();
    const sumEl = document.getElementById('autobotSummary');
    if(sumEl) sumEl.style.display = 'none';
    const logEl = document.getElementById('autobotLog');
    if(logEl) logEl.innerHTML = '<div class="state-empty compact">신호 없음</div>';
    if(window.chart){
      window.chart._dirty = true;
      if(typeof window._refreshOverlays === 'function') window._refreshOverlays();
    }
    window.showToast && window.showToast('신호 제거됨', '#8E7D72');
  };

  // 이벤트 위임 — autobot 전용 액션만
  document.addEventListener('click', function(e){
    const t = e.target.closest('[data-action]');
    if(!t) return;
    const action = t.dataset.action;
    if(action !== 'toggleAutobot' && action !== '_autobotSetMode' &&
       action !== '_autobotRun' && action !== '_autobotClear') return;
    const param = t.dataset.param;
    try {
      if(action === 'toggleAutobot') window.toggleAutobot();
      else if(action === '_autobotSetMode') window._autobotSetMode(param);
      else if(action === '_autobotRun') window._autobotRun();
      else if(action === '_autobotClear') window._autobotClear();
    } catch(err) {
      console.error('autobot handler error:', err);
    }
  });
})();
