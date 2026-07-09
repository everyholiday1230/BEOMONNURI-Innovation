// ═══════════════════════════════════════════════
// signal-builder.js — 나만의 신호 (버튼식 빌더 v2)
//
// 지표탭 표준 지표를 칩으로 고르고, 기간/조건/값을 정해 조건을 만들고,
// 여러 조건을 AND로 묶어 매수/매도/관심 신호를 차트에 표시한다.
// (AI/대화 아님 · 완전 무료 · LLM 미사용)
// 백엔드: GET /v1/llm-signal/indicators, POST /v1/llm-signal/build
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const API = window.API || '';
  const OWNER = 'llm';

  let CATALOG = null;
  let CAT_MAP = {};
  const OP_LABEL = {
    above: '이상 / 위로 돌파',
    below: '이하 / 아래로 돌파',
    cross_up: '상향 돌파 (골든크로스)',
    cross_down: '하향 돌파 (데드크로스)',
  };

  let conditions = [];
  let action = 'buy';
  let curKey = null;   // 현재 선택한 지표 key
  let curOp = null;    // 현재 선택한 op

  function _el(id) { return document.getElementById(id); }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── 차트 렌더 (time→버퍼 index 매핑) ──
  function _clearChartSignals() {
    const chart = window.chart;
    if (chart && chart.overlay && Array.isArray(chart.overlay.drawings)) {
      chart.overlay.drawings = chart.overlay.drawings.filter(d => d._calcOwner !== OWNER);
      chart._dirty = true;
    }
  }
  function _timeToIndex(chart, timeMs) {
    const buf = chart && chart.buffer;
    if (!buf || !buf.length || timeMs == null) return -1;
    const target = timeMs > 1e12 ? Math.floor(timeMs / 1000) : timeMs;
    const times = buf.time, len = buf.length;
    if (len < 1) return -1;
    // 버퍼 시간 범위 밖이면 매핑하지 않음 (화면에 없는 봉)
    const first = Math.floor(times[0]);
    const last = Math.floor(times[len - 1]);
    // 봉 간격(초) 추정 — 범위 밖 여유 판단용
    const step = len > 1 ? Math.abs(Math.floor(times[1]) - first) || 60 : 60;
    if (target < first - step || target > last + step) return -1;
    let lo = 0, hi = len - 1, best = -1, bestDiff = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const tv = Math.floor(times[mid]);
      const diff = Math.abs(tv - target);
      if (diff < bestDiff) { bestDiff = diff; best = mid; }
      if (tv === target) return mid;
      if (tv < target) lo = mid + 1; else hi = mid - 1;
    }
    // 근접 매핑은 봉 간격 이내일 때만 인정
    return bestDiff <= step ? best : -1;
  }
  function _renderDrawings(drawings) {
    const chart = window.chart;
    if (!chart || typeof chart.addDrawing !== 'function') return 0;
    _clearChartSignals();
    const bufLen = (chart.buffer && chart.buffer.length) || 0;
    let n = 0;
    for (const d of (drawings || [])) {
      try {
        const obj = Object.assign({}, d, { _calcOwner: OWNER });
        if (typeof d.time === 'number') {
          const idx = _timeToIndex(chart, d.time);
          if (idx >= 0) obj.index = idx;
        }
        if (typeof d.endTime === 'number') {
          const eidx = _timeToIndex(chart, d.endTime);
          if (eidx >= 0) obj.endIndex = eidx;
        }
        if (obj.type !== 'hline') {
          if (typeof obj.index !== 'number' || obj.index < 0 || obj.index >= bufLen) continue;
        }
        chart.addDrawing(obj);
        n++;
      } catch (_) {}
    }
    // 주의: window._refreshOverlays() 는 지표 기반으로 drawings 를 재구성하며
    // _calcOwner="llm" 이 아닌 것을 필터로 제거한다(우리 신호도 삭제됨).
    // 따라서 여기서는 호출하지 않고, 차트 자체 렌더만 트리거한다.
    _requestRender(chart);
    return n;
  }

  // 차트 자체 렌더 트리거 (_refreshOverlays 를 우회 — 우리 신호 보존)
  // 차트는 requestAnimationFrame 렌더 루프에서 _dirty 를 소비하므로
  // _dirty=true 만 설정하면 다음 프레임에 자동으로 다시 그려진다.
  // (기존 entrySignal 등 다른 신호도 동일한 방식을 사용)
  function _requestRender(chart) {
    chart._dirty = true;
  }

  // ── 메타/상태 ──
  function _syncMeta() {
    const sym = window.curSymbol || 'BTCUSDT';
    const tf = window.curTf || '1h';
    const s = _el('sbMetaSym'), t = _el('sbMetaTf');
    if (s) s.textContent = sym.replace('USDT', '/USDT');
    if (t) t.textContent = tf;
  }
  function _setStatus(state, text) { const b = _el('sbStatus'); if (b) { b.dataset.state = state; b.textContent = text; } }
  function _setResult(cls, text) { const r = _el('sbResult'); if (r) { r.className = 'sb-result' + (cls ? ' ' + cls : ''); r.textContent = text || ''; } }

  // ── 카탈로그 로드 ──
  async function _loadCatalog() {
    try {
      const resp = await fetch(API + '/v1/llm-signal/indicators', { credentials: 'include' });
      const j = await resp.json();
      CATALOG = (j && j.data) ? j.data : null;
    } catch (_) { CATALOG = null; }
    if (!CATALOG) { _setResult('error', '지표 목록을 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    CAT_MAP = {};
    (CATALOG.groups || []).forEach(g => (g.indicators || []).forEach(ind => { CAT_MAP[ind.key] = ind; }));
    _renderGroupTabs();
    _fillTargetSelect();
  }

  // 그룹 탭
  let curGroup = 0;
  function _renderGroupTabs() {
    const tabs = _el('sbGroupTabs');
    if (!tabs || !CATALOG) return;
    tabs.innerHTML = '';
    (CATALOG.groups || []).forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-group-tab' + (i === curGroup ? ' active' : '');
      b.textContent = g.name;
      b.addEventListener('click', () => { curGroup = i; _renderGroupTabs(); _renderIndChips(); });
      tabs.appendChild(b);
    });
    _renderIndChips();
  }

  // 지표 칩
  function _renderIndChips() {
    const box = _el('sbIndChips');
    if (!box || !CATALOG) return;
    box.innerHTML = '';
    const g = CATALOG.groups[curGroup];
    if (!g) return;
    (g.indicators || []).forEach(ind => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-ind-chip' + (ind.key === curKey ? ' active' : '');
      b.textContent = ind.label.replace(/\s*\(.*\)/, '');  // 괄호 설명 제거해 짧게
      b.title = ind.label;
      b.addEventListener('click', () => _selectIndicator(ind.key));
      box.appendChild(b);
    });
  }

  function _selectIndicator(key) {
    curKey = key;
    const meta = CAT_MAP[key];
    _renderIndChips();
    if (!meta) return;
    _el('sbValue').dataset.set = '';   // 새 지표 → 값 자동채움 재개
    _el('sbDetail').style.display = '';
    _el('sbDetailName').textContent = meta.label;
    _renderParamsInline(_el('sbParams'), meta, 'sbP');
    // op 칩
    curOp = (meta.ops && meta.ops[0]) || 'above';
    _renderOpChips(meta);
    _onOpChange();
    _updatePreview();
  }

  function _renderParamsInline(container, meta, prefix) {
    container.innerHTML = '';
    if (!meta || !meta.params || !meta.params.length) return;
    meta.params.forEach(p => {
      const wrap = document.createElement('span');
      wrap.className = 'sb-mini';
      wrap.innerHTML = `<span>${_esc(p.label)}</span>`;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = p.default;
      if (p.min != null) inp.min = p.min;
      if (p.max != null) inp.max = p.max;
      inp.dataset.pkey = p.key;
      inp.addEventListener('input', _updatePreview);
      wrap.appendChild(inp);
      container.appendChild(wrap);
    });
  }

  function _renderOpChips(meta) {
    const box = _el('sbOpChips');
    box.innerHTML = '';
    (meta.ops || ['above', 'below']).forEach(op => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-op-chip' + (op === curOp ? ' active' : '');
      b.textContent = OP_LABEL[op] || op;
      b.addEventListener('click', () => { curOp = op; _renderOpChips(meta); _el('sbValue').dataset.set = ''; _onOpChange(); _updatePreview(); });
      box.appendChild(b);
    });
  }

  function _onOpChange() {
    const meta = CAT_MAP[curKey] || {};
    const isCross = (curOp === 'cross_up' || curOp === 'cross_down');
    _el('sbValueWrap').style.display = isCross ? 'none' : '';
    _el('sbTargetWrap').style.display = isCross ? '' : 'none';
    if (isCross) {
      const tmeta = CAT_MAP[_el('sbTargetIndicator').value];
      _renderParamsInline(_el('sbTargetParams'), tmeta, 'sbT');
    } else {
      const vLabel = _el('sbValueLabel'), vHint = _el('sbValueHint'), vInput = _el('sbValue');
      if (meta.value_kind === 'level' && meta.range) {
        vLabel.textContent = '값'; vHint.textContent = `범위 ${meta.range[0]} ~ ${meta.range[1]}`;
      } else if (meta.value_kind === 'zero') {
        vLabel.textContent = '기준값'; vHint.textContent = '0 기준선 권장';
      } else if (meta.value_kind === 'price') {
        vLabel.textContent = '가격'; vHint.textContent = '가격 값 입력';
      } else { vLabel.textContent = '값'; vHint.textContent = ''; }
      // 조건(op)에 따라 적절한 기본값 자동 설정 (사용자가 직접 수정하기 전까지)
      let dv = null;
      if (meta.default_by_op && meta.default_by_op[curOp] != null) dv = meta.default_by_op[curOp];
      else if (meta.default_value != null) dv = meta.default_value;
      if (dv != null && vInput.dataset.set !== '1') { vInput.value = dv; }
    }
  }

  function _fillTargetSelect() {
    const sel = _el('sbTargetIndicator');
    if (!sel || !CATALOG) return;
    sel.innerHTML = '';
    // 교차 대상은 가격 스케일 지표만 (이동평균·밴드 중심선·VWAP·가격).
    // RSI 같은 오실레이터를 가격과 교차시키는 것은 의미가 없으므로 제외.
    (CATALOG.groups || []).forEach(g => {
      const items = (g.indicators || []).filter(ind => ind.value_kind === 'price');
      if (!items.length) return;
      const og = document.createElement('optgroup'); og.label = g.name;
      items.forEach(ind => {
        const o = document.createElement('option'); o.value = ind.key; o.textContent = ind.label;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = 'ema';
    sel.addEventListener('change', () => {
      _renderParamsInline(_el('sbTargetParams'), CAT_MAP[sel.value], 'sbT');
      _updatePreview();
    });
  }

  function _readParams(container) {
    const out = {};
    container.querySelectorAll('input[data-pkey]').forEach(inp => { out[inp.dataset.pkey] = parseInt(inp.value, 10); });
    return out;
  }

  // 현재 폼 → 조건 객체 (없으면 null)
  function _currentCond() {
    if (!curKey) return null;
    const meta = CAT_MAP[curKey];
    const isCross = (curOp === 'cross_up' || curOp === 'cross_down');
    const cond = { indicator: curKey, op: curOp };
    const params = _readParams(_el('sbParams'));
    if (params.period != null && !isNaN(params.period)) cond.period = params.period;
    if (isCross) {
      const tkey = _el('sbTargetIndicator').value;
      const tparams = _readParams(_el('sbTargetParams'));
      cond.target = { indicator: tkey };
      if (tparams.period != null && !isNaN(tparams.period)) cond.target.period = tparams.period;
    } else {
      const v = parseFloat(_el('sbValue').value);
      if (isNaN(v)) return null;
      cond.value = v;
    }
    return cond;
  }

  function _condText(c) {
    const meta = CAT_MAP[c.indicator] || { label: c.indicator };
    const name = meta.label.replace(/\s*\(.*\)/, '') + (c.period ? ` <b>${c.period}</b>` : '');
    if (c.op === 'cross_up' || c.op === 'cross_down') {
      const tmeta = CAT_MAP[c.target.indicator] || { label: c.target.indicator };
      const tname = tmeta.label.replace(/\s*\(.*\)/, '') + (c.target.period ? ` <b>${c.target.period}</b>` : '');
      return `${name} 이(가) ${tname} 을(를) <b>${c.op === 'cross_up' ? '상향 돌파' : '하향 돌파'}</b>`;
    }
    return `${name} 이(가) <b>${c.value}</b> ${c.op === 'above' ? '이상' : '이하'}`;
  }

  function _updatePreview() {
    const c = _currentCond();
    const box = _el('sbCondPreview');
    if (!box) return;
    box.innerHTML = c ? '조건: ' + _condText(c) : '';
  }

  function _addCondition() {
    const c = _currentCond();
    if (!c) { _setResult('warn', '값을 입력해주세요.'); return; }
    conditions.push(c);
    _renderConditions();
    _setResult('', '조건을 추가했습니다. 더 추가하거나 "차트에 표시"를 누르세요.');
  }

  function _renderConditions() {
    const list = _el('sbCondList'), empty = _el('sbCondEmpty'), count = _el('sbCondCount');
    if (!list) return;
    list.querySelectorAll('.sb-cond-card').forEach(n => n.remove());
    if (count) count.textContent = conditions.length + '개';
    if (!conditions.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    conditions.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'sb-cond-card';
      const lead = i > 0 ? '<span class="sb-cond-and">AND</span>' : `<span class="sb-cond-num">${i + 1}</span>`;
      card.innerHTML = `${lead}<span class="sb-cond-text">${_condText(c)}</span>` +
                       `<button type="button" class="sb-cond-del" data-i="${i}" title="삭제">×</button>`;
      list.appendChild(card);
    });
    list.querySelectorAll('.sb-cond-del').forEach(btn => {
      btn.addEventListener('click', () => { conditions.splice(parseInt(btn.dataset.i, 10), 1); _renderConditions(); });
    });
  }

  // ── 실행 ──
  let _running = false;
  async function _run() {
    if (_running) return;
    if (!conditions.length) {
      // 조건을 안 넣고 눌렀으면, 현재 폼의 조건이라도 있으면 자동 추가
      const c = _currentCond();
      if (c) { conditions.push(c); _renderConditions(); }
      else { _setResult('warn', '조건을 1개 이상 추가해주세요.'); return; }
    }
    _running = true;
    const runBtn = _el('sbRun'); if (runBtn) runBtn.disabled = true;
    _syncMeta();
    _setStatus('loading', '계산 중'); _setResult('', '');

    const symbol = window.curSymbol || 'BTCUSDT';
    const timeframe = window.curTf || '1h';
    const label = (_el('sbLabel').value || '').trim();
    const bufLen = (window.chart && window.chart.buffer && window.chart.buffer.length) || 0;

    try {
      const body = { conditions, action, combine: 'and', symbol, timeframe, label };
      if (bufLen > 0) body.limit = bufLen;
      let resp;
      if (window.api && window.api.raw) {
        resp = await window.api.raw(API + '/v1/llm-signal/build', { method: 'POST', body });
      } else {
        resp = await fetch(API + '/v1/llm-signal/build', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
      const j = await resp.json().catch(() => null);
      const payload = (j && j.data) ? j.data : j;
      if (!resp.ok || !payload) { _setStatus('error', '오류'); _setResult('error', (payload && payload.detail) || '조건을 확인해주세요.'); return; }
      const drawn = _renderDrawings(payload.drawings);
      if (drawn > 0) { _setStatus('ok', `신호 ${drawn}개`); _setResult('ok', payload.reply || `${drawn}개 표시했습니다.`); }
      else { _setStatus('ready', '표시할 신호 없음'); _setResult('warn', payload.reply || '최근 구간에 조건을 만족하는 지점이 없습니다. 값이나 기간을 조정해보세요.'); }
    } catch (e) {
      _setStatus('error', '오류'); _setResult('error', '네트워크 오류로 처리하지 못했습니다.');
    } finally {
      _running = false; if (runBtn) runBtn.disabled = false;
    }
  }

  function _clear() {
    _clearChartSignals();
    const chart = window.chart;
    if (chart) _requestRender(chart);
    _setResult('', '차트의 신호를 지웠습니다.'); _setStatus('ready', '준비됨');
    if (typeof window.showToast === 'function') window.showToast('내 신호를 지웠습니다.', '#8E7D72');
  }

  function _bindActions() {
    document.querySelectorAll('#sbActionRow .sb-action').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#sbActionRow .sb-action').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); action = btn.dataset.action || 'buy';
      });
    });
  }

  // 프리셋
  const PRESETS = {
    rsi_os: { action: 'buy', label: 'RSI 과매도 매수', conditions: [{ indicator: 'rsi', period: 14, op: 'below', value: 30 }] },
    rsi_ob: { action: 'sell', label: 'RSI 과매수 매도', conditions: [{ indicator: 'rsi', period: 14, op: 'above', value: 70 }] },
    golden: { action: 'buy', label: '골든크로스 매수', conditions: [{ indicator: 'ema', period: 20, op: 'cross_up', target: { indicator: 'ema', period: 50 } }] },
    rsi_trend: { action: 'buy', label: 'RSI+추세 매수', conditions: [
      { indicator: 'rsi', period: 14, op: 'below', value: 45 },
      { indicator: 'price', op: 'cross_up', target: { indicator: 'ema', period: 20 } }] },
  };
  function _applyPreset(name) {
    const p = PRESETS[name]; if (!p) return;
    conditions = JSON.parse(JSON.stringify(p.conditions));
    action = p.action;
    document.querySelectorAll('#sbActionRow .sb-action').forEach(b => b.classList.toggle('active', b.dataset.action === action));
    const lbl = _el('sbLabel'); if (lbl) lbl.value = p.label;
    _renderConditions();
    _setResult('', '빠른 시작을 불러왔어요. "차트에 표시"를 누르세요.');
  }

  function init() {
    if (!_el('sbIndChips')) return;
    _loadCatalog();
    _bindActions();
    _el('sbValue').addEventListener('input', () => { _el('sbValue').dataset.set = '1'; _updatePreview(); });
    _el('sbAddCond').addEventListener('click', _addCondition);
    _el('sbRun').addEventListener('click', _run);
    _el('sbClear').addEventListener('click', _clear);
    document.querySelectorAll('.sb-preset').forEach(btn => btn.addEventListener('click', () => _applyPreset(btn.dataset.preset)));
    _syncMeta();
  }

  window.addEventListener('symbolChanged', _syncMeta);
  window.signalBuilder = { run: _run, clear: _clear, applyPreset: _applyPreset };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
