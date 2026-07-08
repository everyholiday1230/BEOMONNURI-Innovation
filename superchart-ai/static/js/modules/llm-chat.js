// ═══════════════════════════════════════════════
// llm-chat.js — 나만의 AI 신호 (LLM 대화형 신호 생성)
//
// 고객이 자연어로 대화하면 백엔드(/v1/llm-signal/chat)가 표준 지표 기반
// 신호 규칙으로 변환하고, 그 결과를 차트에 드로잉으로 표시한다.
// ⚠️ 범온 고유 지표와 무관 — 백엔드가 표준 지표(RSI/MACD/EMA 등)만 사용.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const API = window.API || '';
  const OWNER = 'llm';           // 차트 드로잉 소유자 태그 (정리용)
  const LS_KEY = 'chartOS_llmChatHistory';

  function _el(id) { return document.getElementById(id); }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── 대화 로그 (세션 유지) ──
  function _loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (_) { return []; }
  }
  function _saveHistory(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(-50))); } catch (_) {}
  }

  function _appendMsg(role, text, meta) {
    const box = _el('llmChatLog');
    if (!box) return;
    const wrap = document.createElement('div');
    wrap.className = 'llm-msg llm-msg-' + role;
    let metaHtml = '';
    if (meta) metaHtml = `<div class="llm-msg-meta">${_esc(meta)}</div>`;
    wrap.innerHTML = `<div class="llm-msg-body">${_esc(text)}</div>${metaHtml}`;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  // ── 차트에 신호 렌더 ──
  function _clearChartSignals() {
    const chart = window.chart;
    if (chart && chart.overlay && Array.isArray(chart.overlay.drawings)) {
      chart.overlay.drawings = chart.overlay.drawings.filter(d => d._calcOwner !== OWNER);
      chart._dirty = true;
    }
  }

  function _renderDrawings(drawings) {
    const chart = window.chart;
    if (!chart || typeof chart.addDrawing !== 'function') return 0;
    _clearChartSignals();
    let n = 0;
    for (const d of (drawings || [])) {
      try {
        const obj = Object.assign({}, d, { _calcOwner: OWNER });
        chart.addDrawing(obj);
        n++;
      } catch (_) { /* skip bad drawing */ }
    }
    chart._dirty = true;
    if (typeof window._refreshOverlays === 'function') {
      try { window._refreshOverlays(); } catch (_) {}
    }
    return n;
  }

  function _setStatus(state, text) {
    const b = _el('llmStatusBadge');
    if (!b) return;
    b.dataset.state = state;
    b.textContent = text;
  }

  function _setUsage(text) {
    const u = _el('llmUsage');
    if (u) u.textContent = text || '';
  }

  function _syncMeta() {
    const sym = window.curSymbol || 'BTCUSDT';
    const tf = window.curTf || '1h';
    const s = _el('llmMetaSym');
    const t = _el('llmMetaTf');
    if (s) s.textContent = sym.replace('USDT', '/USDT');
    if (t) t.textContent = tf;
  }

  // ── 전송 ──
  let _sending = false;
  async function sendMessage() {
    if (_sending) return;
    const input = _el('llmChatInput');
    if (!input) return;
    const message = (input.value || '').trim();
    if (!message) return;

    _sending = true;
    const sendBtn = _el('llmChatSend');
    if (sendBtn) sendBtn.disabled = true;
    _syncMeta();
    _setStatus('loading', '생성 중');
    input.value = '';
    _appendMsg('user', message);
    _appendMsg('bot', '신호를 만드는 중입니다…', '');

    const symbol = window.curSymbol || 'BTCUSDT';
    const timeframe = window.curTf || '1h';

    let resp, data;
    try {
      const body = { message, symbol, timeframe };
      if (window.api && window.api.raw) {
        // api.raw 는 객체 body를 자동으로 JSON 직렬화 + CSRF/인증 첨부
        resp = await window.api.raw(API + '/v1/llm-signal/chat', { method: 'POST', body });
      } else {
        resp = await fetch(API + '/v1/llm-signal/chat', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      data = await resp.json().catch(() => null);
    } catch (e) {
      _replaceLastBot('네트워크 오류로 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
      _setStatus('error', '오류');
      _finish(sendBtn);
      return;
    }

    // 결제 필요 (402)
    if (resp && resp.status === 402) {
      const err = (data && data.error) || {};
      _replaceLastBot(err.message || '무료 횟수를 모두 사용했습니다. 포인트가 필요합니다.');
      _setStatus('error', '포인트 부족');
      if (typeof window._ai2OpenPlans === 'function') {
        try { window._ai2OpenPlans(); } catch (_) {}
      } else if (typeof window.showToast === 'function') {
        window.showToast('포인트가 부족합니다. 충전 후 이용해주세요.', '#921230');
      }
      _finish(sendBtn);
      return;
    }

    // 인증 필요
    if (resp && (resp.status === 401)) {
      _replaceLastBot('로그인이 필요합니다.');
      _setStatus('error', '로그인 필요');
      if (typeof window.showAuthModal === 'function') window.showAuthModal();
      _finish(sendBtn);
      return;
    }

    const payload = (data && data.data) ? data.data : data;
    if (!payload) {
      _replaceLastBot('응답을 이해하지 못했습니다. 다시 시도해주세요.');
      _setStatus('error', '오류');
      _finish(sendBtn);
      return;
    }

    const drawn = _renderDrawings(payload.drawings);
    const parts = [];
    if (typeof payload.tokens === 'number' && payload.tokens > 0) parts.push(`토큰 ${payload.tokens}`);
    if (payload.charged) parts.push(`${payload.charged}P 차감`);
    else if (payload.free_used === false) parts.push('무료');
    const meta = parts.join(' · ');
    _replaceLastBot(payload.reply || '완료했습니다.', meta);
    _setStatus('ready', drawn > 0 ? `신호 ${drawn}개` : '준비됨');
    _setUsage(meta);

    // 히스토리 저장
    const hist = _loadHistory();
    hist.push({ role: 'user', text: message });
    hist.push({ role: 'bot', text: payload.reply || '', signals: payload.signals || [] });
    _saveHistory(hist);

    _finish(sendBtn);
  }

  function _finish(sendBtn) {
    _sending = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  function _replaceLastBot(text, meta) {
    const box = _el('llmChatLog');
    if (!box) return;
    const bots = box.querySelectorAll('.llm-msg-bot');
    const last = bots[bots.length - 1];
    if (last) {
      let metaHtml = meta ? `<div class="llm-msg-meta">${_esc(meta)}</div>` : '';
      last.innerHTML = `<div class="llm-msg-body">${_esc(text)}</div>${metaHtml}`;
    } else {
      _appendMsg('bot', text, meta);
    }
    box.scrollTop = box.scrollHeight;
  }

  // ── 신호 지우기 ──
  function clearSignals() {
    _clearChartSignals();
    if (typeof window._refreshOverlays === 'function') {
      try { window._refreshOverlays(); } catch (_) {}
    }
    if (typeof window.showToast === 'function') window.showToast('AI 신호를 지웠습니다.', '#8E7D72');
  }

  // ── 예시 프롬프트 클릭 ──
  function useExample(text) {
    const input = _el('llmChatInput');
    if (input) { input.value = text; input.focus(); }
  }

  // ── 초기화: 이벤트 바인딩 ──
  function init() {
    const sendBtn = _el('llmChatSend');
    const input = _el('llmChatInput');
    const clearBtn = _el('llmChatClear');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (clearBtn) clearBtn.addEventListener('click', clearSignals);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
    }
    // 예시 버튼
    document.querySelectorAll('#llm .llm-example').forEach(btn => {
      btn.addEventListener('click', () => useExample(btn.dataset.ex || btn.textContent));
    });
    _syncMeta();
  }

  // 전역 노출 (다른 모듈/HTML에서 호출용)
  window.llmChat = { send: sendMessage, clear: clearSignals, useExample };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
