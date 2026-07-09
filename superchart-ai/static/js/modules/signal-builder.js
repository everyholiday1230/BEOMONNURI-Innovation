// ═══════════════════════════════════════════════
// signal-builder.js — 나만의 신호 (버튼식 빌더)
//
// 고객이 지표탭의 표준 지표를 골라 조건을 만들고, 여러 조건을 AND로
// 묶어 매수/매도/관심 신호를 차트에 직접 표시한다. (AI/대화 아님, 완전 무료)
// 백엔드: GET /v1/llm-signal/indicators (카탈로그), POST /v1/llm-signal/build (평가)
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const API = window.API || '';
  const OWNER = 'llm';   // 차트 드로잉 소유자 태그 (기존 신호 정리 로직과 호환)

  let CATALOG = null;        // {groups, ops, actions}
  let CAT_MAP = {};          // key -> indicator meta
  const OP_LABEL = {
    above: '위로 돌파 / 이상',
    below: '아래로 돌파 / 이하',
    cross_up: '상향 돌파(골든크로스)',
    cross_down: '하향 돌파(데드크로스)',
  };

  let conditions = [];       // 현재 조건 배열
  let action = 'buy';

  function _el(id) { return document.getElementById(id); }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── 차트 렌더 (time→버퍼 index 매핑, llm-chat.js와 동일 원리) ──
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
    const times = buf.time;
    const len = buf.length;
    let lo = 0, hi = len - 1, best = -1, bestDiff = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const tv = Math.floor(times[mid]);
      const diff = Math.abs(tv - target);
      if (diff < bestDiff) { bestDiff = diff; best = mid; }
      if (tv === target) return mid;
      if (tv < target) lo = mid + 1; else hi = mid - 1;
    }
    return best;
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
      } catch (_) { /* skip */ }
    }
    chart._dirty = true;
    if (typeof window._refreshOverlays === 'function') {
      try { window._refreshOverlays(); } catch (_) {}
    }
    return n;
  }

  // ── 메타 표시 ──
  function _syncMeta() {
    const sym = window.curSymbol || 'BTCUSDT';
    const tf = window.curTf || '1h';
    const s = _el('sbMetaSym'), t = _el('sbMetaTf');
    if (s) s.textContent = sym.replace('USDT', '/USDT');
    if (t) t.textContent = tf;
  }
  function _setStatus(state, text) {
    const b = _el('sbStatus');
    if (b) { b.dataset.state = state; b.textContent = text; }
  }
  function _setResult(cls, text) {
    const r = _el('sbResult');
    if (r) { r.className = 'sb-result' + (cls ? ' ' + cls : ''); r.textContent = text || ''; }
  }

  // ── 카탈로그 로드 + 셀렉트 채우기 ──
  async function _loadCatalog() {
    try {
      const resp = await fetch(API + '/v1/llm-signal/indicators', { credentials: 'include' });
      const j = await resp.json();
      CATALOG = (j && j.data) ? j.data : null;
    } catch (_) { CATALOG = null; }
    if (!CATALOG) return;
    CAT_MAP = {};
    (CATALOG.groups || []).forEach(g => (g.indicators || []).forEach(ind => { CAT_MAP[ind.key] = ind; }));
    _fillIndicatorSelect(_el('sbIndicator'));
    _fillIndicatorSelect(_el('sbTargetIndicator'), true);
    _onIndicatorChange();
  }

  function _fillIndicatorSelect(sel, targetOnly) {
    if (!sel || !CATALOG) return;
    sel.innerHTML = '';
    (CATALOG.groups || []).forEach(g => {
      const og = document.createElement('optgroup');
      og.label = g.name;
      (g.indicators || []).forEach(ind => {
        // 대상 지표(교차용)는 이동평균/가격/vwap 계열만 의미 있음 → 전부 노출하되 라벨 그대로
        const o = document.createElement('option');
        o.value = ind.key;
        o.textContent = ind.label;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (targetOnly) sel.value = 'ema';
  }

  // 파라미터 입력칸 생성 (기간 등)
  function _renderParams(container, meta, prefix) {
    container.innerHTML = '';
    if (!meta || !meta.params || !meta.params.length) return;
    meta.params.forEach(p => {
      const wrap = document.createElement('label');
      wrap.className = 'sb-field';
      wrap.innerHTML = `<span class="sb-label">${_esc(p.label)}</span>`;
      const inp = document.createElement('input');
      inp.className = 'sb-input';
      inp.type = 'number';
      inp.id = prefix + '_' + p.key;
      inp.value = p.default;
      if (p.min != null) inp.min = p.min;
      if (p.max != null) inp.max = p.max;
      inp.dataset.pkey = p.key;
      wrap.appendChild(inp);
      container.appendChild(wrap);
    });
  }

  // 지표 변경 → 파라미터/연산/값 UI 갱신
  function _onIndicatorChange() {
    const key = _el('sbIndicator').value;
    const meta = CAT_MAP[key];
    if (!meta) return;
    _renderParams(_el('sbParams'), meta, 'sbP');

    // 연산 셀렉트
    const opSel = _el('sbOp');
    opSel.innerHTML = '';
    (meta.ops || ['above', 'below']).forEach(op => {
      const o = document.createElement('option');
      o.value = op; o.textContent = OP_LABEL[op] || op;
      opSel.appendChild(o);
    });
    _onOpChange();
  }

  // 연산 변경 → 값 입력 vs 대상 지표 전환
  function _onOpChange() {
    const key = _el('sbIndicator').value;
    const meta = CAT_MAP[key] || {};
    const op = _el('sbOp').value;
    const isCross = (op === 'cross_up' || op === 'cross_down');
    // 교차: 대상 지표 선택 / 임계값: 숫자 입력
    _el('sbValueWrap').style.display = isCross ? 'none' : '';
    _el('sbTargetWrap').style.display = isCross ? '' : 'none';

    if (isCross) {
      const tmeta = CAT_MAP[_el('sbTargetIndicator').value];
      _renderParams(_el('sbTargetParams'), tmeta, 'sbT');
    } else {
      // 값 힌트/기본값
      const vLabel = _el('sbValueLabel');
      const vHint = _el('sbValueHint');
      const vInput = _el('sbValue');
      if (meta.value_kind === 'level' && meta.range) {
        vLabel.textContent = '값';
        vHint.textContent = `범위 ${meta.range[0]} ~ ${meta.range[1]}`;
      } else if (meta.value_kind === 'zero') {
        vLabel.textContent = '값'; vHint.textContent = '0 기준선 비교 권장';
      } else if (meta.value_kind === 'price') {
        vLabel.textContent = '가격'; vHint.textContent = '가격 값 입력';
      } else {
        vLabel.textContent = '값'; vHint.textContent = '';
      }
      if (meta.default_value != null && (vInput.value === '' || vInput.dataset.auto === '1')) {
        vInput.value = meta.default_value;
        vInput.dataset.auto = '1';
      }
    }
  }

  function _readParams(container) {
    const out = {};
    container.querySelectorAll('input[data-pkey]').forEach(inp => {
      out[inp.dataset.pkey] = parseInt(inp.value, 10);
    });
    return out;
  }

  // ── 조건 추가 ──
  function _addCondition() {
    const key = _el('sbIndicator').value;
    const meta = CAT_MAP[key];
    if (!meta) return;
    const op = _el('sbOp').value;
    const isCross = (op === 'cross_up' || op === 'cross_down');

    const cond = { indicator: key, op };
    const params = _readParams(_el('sbParams'));
    if (params.period != null && !isNaN(params.period)) cond.period = params.period;

    if (isCross) {
      const tkey = _el('sbTargetIndicator').value;
      const tparams = _readParams(_el('sbTargetParams'));
      cond.target = { indicator: tkey };
      if (tparams.period != null && !isNaN(tparams.period)) cond.target.period = tparams.period;
    } else {
      const v = parseFloat(_el('sbValue').value);
      if (isNaN(v)) { _setResult('warn', '값을 입력해주세요.'); return; }
      cond.value = v;
    }

    conditions.push(cond);
    _renderConditions();
    _setResult('', '조건을 추가했습니다. 더 추가하거나 "차트에 표시"를 누르세요.');
  }

  function _condToText(c) {
    const meta = CAT_MAP[c.indicator] || { label: c.indicator };
    const name = meta.label + (c.period ? ` (${c.period})` : '');
    if (c.op === 'cross_up' || c.op === 'cross_down') {
      const tmeta = CAT_MAP[c.target.indicator] || { label: c.target.indicator };
      const tname = tmeta.label + (c.target.period ? ` (${c.target.period})` : '');
      return `${name} 이(가) ${tname} 을(를) ${c.op === 'cross_up' ? '상향 돌파' : '하향 돌파'}`;
    }
    return `${name} 이(가) ${c.value} ${c.op === 'above' ? '위로/이상' : '아래로/이하'}`;
  }

  function _renderConditions() {
    const list = _el('sbCondList');
    const empty = _el('sbCondEmpty');
    if (!list) return;
    // 기존 카드 제거 (empty 제외)
    list.querySelectorAll('.sb-cond-card').forEach(n => n.remove());
    if (!conditions.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    conditions.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'sb-cond-card';
      const andBadge = i > 0 ? '<span class="sb-cond-and">AND</span>' : '';
      card.innerHTML = `${andBadge}<span class="sb-cond-text">${_esc(_condToText(c))}</span>` +
                       `<button type="button" class="sb-cond-del" data-i="${i}" title="삭제">×</button>`;
      list.appendChild(card);
    });
    list.querySelectorAll('.sb-cond-del').forEach(btn => {
      btn.addEventListener('click', () => {
        conditions.splice(parseInt(btn.dataset.i, 10), 1);
        _renderConditions();
      });
    });
  }

  // ── 만들기 (백엔드 평가 + 차트 표시) ──
  let _running = false;
  async function _run() {
    if (_running) return;
    if (!conditions.length) { _setResult('warn', '조건을 1개 이상 추가해주세요.'); return; }
    _running = true;
    const runBtn = _el('sbRun');
    if (runBtn) runBtn.disabled = true;
    _syncMeta();
    _setStatus('loading', '계산 중');
    _setResult('', '');

    const symbol = window.curSymbol || 'BTCUSDT';
    const timeframe = window.curTf || '1h';
    const label = (_el('sbLabel').value || '').trim();

    try {
      const body = { conditions, action, combine: 'and', symbol, timeframe, label };
      let resp;
      if (window.api && window.api.raw) {
        resp = await window.api.raw(API + '/v1/llm-signal/build', { method: 'POST', body });
      } else {
        resp = await fetch(API + '/v1/llm-signal/build', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const j = await resp.json().catch(() => null);
      const payload = (j && j.data) ? j.data : j;
      if (!resp.ok || !payload) {
        _setStatus('error', '오류');
        _setResult('error', (payload && payload.detail) || '조건을 확인해주세요.');
        return;
      }
      const drawn = _renderDrawings(payload.drawings);
      if (drawn > 0) {
        _setStatus('ok', `신호 ${drawn}개`);
        _setResult('ok', payload.reply || `${drawn}개 표시했습니다.`);
      } else {
        _setStatus('ready', '표시할 신호 없음');
        _setResult('warn', payload.reply || '최근 구간에 조건을 만족하는 지점이 없습니다.');
      }
    } catch (e) {
      _setStatus('error', '오류');
      _setResult('error', '네트워크 오류로 처리하지 못했습니다.');
    } finally {
      _running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  function _clear() {
    _clearChartSignals();
    if (typeof window._refreshOverlays === 'function') { try { window._refreshOverlays(); } catch (_) {} }
    _setResult('', '차트의 신호를 지웠습니다.');
    _setStatus('ready', '준비됨');
    if (typeof window.showToast === 'function') window.showToast('내 신호를 지웠습니다.', '#8E7D72');
  }

  // ── 액션 선택 ──
  function _bindActions() {
    document.querySelectorAll('#sbActionRow .sb-action').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#sbActionRow .sb-action').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        action = btn.dataset.action || 'buy';
      });
    });
  }

  // ── 프리셋 ──
  const PRESETS = {
    rsi_os: { action: 'buy', label: 'RSI 과매도 매수',
      conditions: [{ indicator: 'rsi', period: 14, op: 'below', value: 30 }] },
    rsi_ob: { action: 'sell', label: 'RSI 과매수 매도',
      conditions: [{ indicator: 'rsi', period: 14, op: 'above', value: 70 }] },
    golden: { action: 'buy', label: '골든크로스 매수',
      conditions: [{ indicator: 'ema', period: 20, op: 'cross_up', target: { indicator: 'ema', period: 50 } }] },
    rsi_trend: { action: 'buy', label: 'RSI+추세 동시 매수',
      conditions: [
        { indicator: 'rsi', period: 14, op: 'below', value: 45 },
        { indicator: 'price', op: 'cross_up', target: { indicator: 'ema', period: 20 } },
      ] },
  };
  function _applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    conditions = JSON.parse(JSON.stringify(p.conditions));
    action = p.action;
    document.querySelectorAll('#sbActionRow .sb-action').forEach(b =>
      b.classList.toggle('active', b.dataset.action === action));
    const lbl = _el('sbLabel'); if (lbl) lbl.value = p.label;
    _renderConditions();
    _setResult('', '빠른 시작을 불러왔습니다. "차트에 표시"를 누르세요.');
  }

  // ── 초기화 ──
  function init() {
    if (!_el('sbIndicator')) return;   // 패널이 없으면 skip
    _loadCatalog();
    _bindActions();
    _el('sbIndicator').addEventListener('change', () => {
      const v = _el('sbValue'); if (v) v.dataset.auto = '1';
      _onIndicatorChange();
    });
    _el('sbOp').addEventListener('change', _onOpChange);
    _el('sbTargetIndicator').addEventListener('change', _onOpChange);
    _el('sbAddCond').addEventListener('click', _addCondition);
    _el('sbRun').addEventListener('click', _run);
    _el('sbClear').addEventListener('click', _clear);
    document.querySelectorAll('.sb-preset').forEach(btn =>
      btn.addEventListener('click', () => _applyPreset(btn.dataset.preset)));
    _syncMeta();
  }

  // 종목/타임프레임 변경 시 메타 갱신
  window.addEventListener('symbolChanged', _syncMeta);

  window.signalBuilder = { run: _run, clear: _clear, applyPreset: _applyPreset };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
