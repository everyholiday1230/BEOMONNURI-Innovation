// signal-chat.js — 대화형(자연어) 나만의 신호 생성
// ─────────────────────────────────────────────────────────────
// 사용자가 문장으로 조건을 말하면 백엔드 /v1/llm-signal/chat 이
// 공개 표준 지표(RSI·MACD·이동평균·볼린저·스토캐스틱·거래량·가격)로만
// 계산해 매수/매도/관심 신호 드로잉을 반환한다.
// ⚠️ 범온 고유 지표는 서버 화이트리스트(signal_rules.ALLOWED_INDICATORS)로
//    격리되어 대화 경로로도 접근/계산되지 않는다.
// 렌더링은 signal-builder 의 렌더러를 재사용해 '나만의 신호'와 동일 경로로 표시.
(function () {
  'use strict';
  const API = window.API || '';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const loggedIn = () => {
    try { return typeof window.isLoggedIn === 'function' ? !!window.isLoggedIn() : true; }
    catch (_) { return true; }
  };
  let busy = false;

  // 대화가 만든 표준 신호(DSL)를 신호 빌더의 '조건' 형식으로 변환한다.
  function toCond(s) {
    const c = { indicator: s.indicator, op: s.op };
    if (s.period != null) c.period = s.period;
    if (s.op === 'cross_up' || s.op === 'cross_down') {
      const t = s.target || {};
      c.target = { indicator: t.indicator };
      if (t.period != null) c.target.period = t.period;
    } else {
      c.value = s.value;
    }
    return c;
  }

  // 신호가 정확히 1개(단일 조건)이고 매매/관심이면 '편집·저장' 버튼을 붙인다.
  // (여러 신호를 하나의 AND 그룹으로 합치면 의미가 달라지므로 단일 신호만 연결)
  function maybeOfferEdit(row, payload, msg) {
    if (!row) return;
    const sigs = Array.isArray(payload.signals) ? payload.signals : [];
    if (sigs.length !== 1) return;
    const act = sigs[0].action;
    if (!['buy', 'sell', 'zone'].includes(act)) return;
    if (!(window.signalBuilder && typeof window.signalBuilder.applySharedSignal === 'function')) return;
    const conds = sigs.map(toCond);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-btn sb-btn-secondary';
    btn.style.cssText = 'margin-top:6px;font-size:12px;padding:4px 8px';
    btn.textContent = '🖊 이 조건으로 편집·저장';
    btn.addEventListener('click', () => {
      try {
        window.signalBuilder.applySharedSignal({ conditions: conds, action: act, title: (msg || '').slice(0, 30) });
        (window.showToast || function () {})('조건을 빌더로 옮겼어요. "비공개 저장"으로 저장할 수 있습니다.', '#921230');
      } catch (_) {}
    });
    row.appendChild(document.createElement('br'));
    row.appendChild(btn);
  }

  function appendMsg(role, html) {
    const box = $('scLog');
    if (!box) return null;
    const row = document.createElement('div');
    row.className = 'sc-msg sc-' + role;
    row.style.cssText =
      'padding:6px 9px;border-radius:8px;font-size:13px;line-height:1.45;max-width:92%;word-break:break-word;' +
      (role === 'user'
        ? 'background:#921230;color:#fff;align-self:flex-end;'
        : 'background:rgba(216,182,106,0.15);color:var(--text,#2b2b2b);align-self:flex-start;');
    row.innerHTML = html;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return row;
  }

  async function send(msg) {
    msg = (msg || '').trim();
    if (!msg || busy) return;
    if (!loggedIn()) {
      (window.showMemberOnlyNotice || window.showAuth || window.showAuthModal || function () {})('대화형 신호');
      return;
    }
    const chart = window.chart;
    if (!chart || !chart.buffer || !chart.buffer.length) {
      appendMsg('ai', '차트가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    busy = true;
    const sendBtn = $('scSend');
    if (sendBtn) sendBtn.disabled = true;
    appendMsg('user', esc(msg));
    const inp = $('scInput');
    if (inp) inp.value = '';
    const thinkRow = appendMsg('ai', '…계산 중');

    const symbol = window.curSymbol || 'BTCUSDT';
    const timeframe = window.curTf || '1h';
    try {
      const body = { message: msg, symbol, timeframe };
      let resp;
      if (window.api && window.api.raw) {
        resp = await window.api.raw(API + '/v1/llm-signal/chat', { method: 'POST', body });
      } else {
        resp = await fetch(API + '/v1/llm-signal/chat', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
      const j = await resp.json().catch(() => null);
      const payload = (j && j.data) ? j.data : j;
      if (!resp.ok || !payload) {
        if (thinkRow) thinkRow.innerHTML = (payload && esc(payload.detail || payload.message)) || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
        return;
      }
      let drawn = 0;
      if (payload.drawings && window.signalBuilder && typeof window.signalBuilder.renderDrawings === 'function') {
        try { drawn = window.signalBuilder.renderDrawings(payload.drawings) || 0; } catch (_) { drawn = 0; }
      }
      let reply = esc(payload.reply || '');
      if (drawn > 0) reply += ` <b style="color:#921230">(${drawn}개 표시)</b>`;
      if (thinkRow) thinkRow.innerHTML = reply || '표시할 신호가 없습니다. 조건을 조금 더 구체적으로 말씀해주세요.';
      maybeOfferEdit(thinkRow, payload, msg);
    } catch (_) {
      if (thinkRow) thinkRow.innerHTML = '네트워크 오류로 처리하지 못했습니다.';
    } finally {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function init() {
    if (!$('scLog')) return;
    const sendBtn = $('scSend');
    if (sendBtn) sendBtn.addEventListener('click', () => { const i = $('scInput'); send(i && i.value); });
    const inp = $('scInput');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(e.target.value); } });
    document.querySelectorAll('#scExamples .sc-ex').forEach((b) => {
      b.addEventListener('click', () => { const i = $('scInput'); if (i) i.value = b.dataset.ex; send(b.dataset.ex); });
    });
  }

  window.signalChat = { send };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
