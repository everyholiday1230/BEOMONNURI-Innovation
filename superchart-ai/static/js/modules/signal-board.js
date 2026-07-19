// signal-board.js — PostgreSQL-backed public signal board
(function () {
  'use strict';

  const API = window.API || '';
  const state = { section: 'board', sort: 'popular', symbol: '', page: 1, hasNext: false, items: [], loading: false };
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const loggedIn = () => !!window.isLoggedIn?.();

  async function request(path, opts) {
    const url = API + path;
    const response = window.api?.raw
      ? await window.api.raw(url, opts || {})
      : await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message = body?.detail || body?.error?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body.data;
  }

  function requireLogin(feature) {
    if (loggedIn()) return true;
    window.showMemberOnlyNotice?.(feature || '이 기능');
    if (!window.showMemberOnlyNotice) window.showAuth?.();
    return false;
  }

  function actionLabel(action) {
    return action === 'buy' ? '매수' : action === 'sell' ? '매도' : '관심';
  }

  function conditionText(condition) {
    const period = condition.period ? `(${condition.period})` : '';
    const left = `${condition.indicator || '지표'}${period}`.toUpperCase();
    if (condition.op === 'cross_up' || condition.op === 'cross_down') {
      const target = condition.target || {};
      const targetPeriod = target.period ? `(${target.period})` : '';
      return `${left} → ${(target.indicator || '지표').toUpperCase()}${targetPeriod} ${condition.op === 'cross_up' ? '상향 돌파' : '하향 돌파'}`;
    }
    return `${left} ${condition.op === 'above' ? '이상' : '이하'} ${condition.value}`;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
  }

  function setStatus(text, kind) {
    const el = $('sgStatus');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.state = kind || '';
  }

  function renderCard(item) {
    const mine = state.section === 'my';
    const publicBadge = item.isPublic
      ? '<span class="sg-badge public">공개</span>'
      : '<span class="sg-badge private">비공개</span>';
    const owner = item.nickname ? `<span>${esc(item.nickname)}</span>` : '';
    let conditions;
    if (item.conditionsHidden) {
      const cnt = item.conditionCount || 0;
      conditions = `<li class="sg-cond-hidden">🔒 비공개 전략 · 조건 ${cnt}개 (제작자만 열람 가능)</li>`;
    } else {
      conditions = (item.conditions || []).slice(0, 3).map(c => `<li>${esc(conditionText(c))}</li>`).join('');
    }
    let actions = '';
    if (mine) {
      actions = `
        <button type="button" class="sg-btn sg-btn-primary" data-sg-visibility="${item.id}" data-public="${item.isPublic ? '0' : '1'}">${item.isPublic ? '공개 취소' : '게시판 공개'}</button>
        <button type="button" class="sg-btn sg-btn-danger" data-sg-delete="${item.id}">내 목록에서 삭제</button>`;
    } else {
      actions = `
        <button type="button" class="sg-btn ${item.likedByMe ? 'active' : ''}" data-sg-like="${item.id}">좋아요 ${item.likeCount || 0}</button>
        <button type="button" class="sg-btn ${item.favoritedByMe ? 'active' : ''}" data-sg-favorite="${item.id}">즐겨찾기 ${item.favoriteCount || 0}</button>`;
    }
    return `<article class="sg-card" data-signal-id="${item.id}">
      <div class="sg-card-head">
        <div><strong>${esc(item.title)}</strong><div class="sg-meta">${esc(item.symbol)} · ${esc(item.timeframe)} · ${actionLabel(item.action)}</div></div>
        ${mine ? publicBadge : `<span class="sg-action ${esc(item.action)}">${actionLabel(item.action)}</span>`}
      </div>
      ${item.description ? `<p class="sg-description">${esc(item.description)}</p>` : ''}
      <ul class="sg-conditions">${conditions}</ul>
      <div class="sg-card-foot">
        <div class="sg-stats">${owner}<span>조회 ${item.viewCount || 0}</span><span>좋아요 ${item.likeCount || 0}</span><span>즐겨찾기 ${item.favoriteCount || 0}</span><span>${formatDate(item.publishedAt || item.createdAt)}</span></div>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-ghost" data-sg-detail="${item.id}">상세 보기</button>
          ${actions}
        </div>
      </div>
    </article>`;
  }

  function renderList(append) {
    const list = $('sgList');
    if (!list) return;
    if (!append) list.innerHTML = '';
    if (!state.items.length && !append) {
      const text = state.section === 'my'
        ? '저장한 신호가 없습니다. 나만의 신호에서 조건을 만든 뒤 비공개 저장해보세요.'
        : state.section === 'favorites'
          ? '즐겨찾기한 공개 신호가 없습니다.'
          : '공개된 신호가 아직 없습니다.';
      list.innerHTML = `<div class="sg-empty">${text}</div>`;
      return;
    }
    const html = state.items.map(renderCard).join('');
    if (append) list.insertAdjacentHTML('beforeend', html); else list.innerHTML = html;
  }

  function syncToolbar() {
    const board = state.section === 'board';
    const toolbar = $('sgToolbar');
    if (toolbar) toolbar.hidden = !board;
    document.querySelectorAll('#sgSubnav .sg-subtab').forEach(btn => {
      const active = btn.dataset.section === state.section;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    const more = $('sgMore');
    if (more) more.hidden = !board || !state.hasNext;
  }

  async function load(options) {
    const append = !!options?.append;
    if (state.loading) return;
    if ((state.section === 'my' || state.section === 'favorites') && !requireLogin('내 신호 관리')) {
      state.section = 'board';
    }
    state.loading = true;
    if (!append) setStatus('신호를 불러오는 중입니다...', 'loading');
    try {
      let data;
      if (state.section === 'my') {
        data = await request('/v1/signals/my?limit=100');
        state.hasNext = false;
      } else if (state.section === 'favorites') {
        data = await request('/v1/signals/favorites?limit=100');
        state.hasNext = false;
      } else {
        const params = new URLSearchParams({ page: String(state.page), page_size: '20', sort: state.sort });
        if (state.symbol) params.set('symbol', state.symbol);
        data = await request('/v1/signals/board?' + params.toString());
        state.hasNext = !!data.hasNext;
      }
      const incoming = data?.items || [];
      if (append) {
        state.items = incoming;
        renderList(true);
      } else {
        state.items = incoming;
        renderList(false);
      }
      setStatus(`${data?.total ?? incoming.length}개의 신호`, 'ok');
    } catch (error) {
      if (!append) $('sgList').innerHTML = '<div class="sg-empty">신호를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
      setStatus(error.message || '불러오기 실패', 'error');
    } finally {
      state.loading = false;
      syncToolbar();
    }
  }

  async function openDetail(id) {
    try {
      const item = await request(`/v1/signals/${id}`);
      const root = $('sgModalRoot');
      if (!root) return;
      let conditions;
      if (item.conditionsHidden) {
        const cnt = item.conditionCount || 0;
        conditions = `<li class="sg-cond-hidden"><b>🔒 비공개 전략</b><span>조건 ${cnt}개 — 제작자(${esc(item.nickname || '익명')})만 열람할 수 있습니다.</span></li>`;
      } else {
        conditions = (item.conditions || []).map((condition, index) =>
          `<li><b>조건 ${index + 1}</b><span>${esc(conditionText(condition))}</span></li>`
        ).join('');
      }
      // 조건이 비공개인 신호는 차트 적용 시 로직이 드러나므로 제작자에게만 '적용' 제공.
      const canApply = item.isMine || !item.conditionsHidden;
      const applyBtn = canApply
        ? `<button type="button" class="sg-btn sg-btn-primary" data-sg-apply="${item.id}">현재 차트에 적용</button>`
        : '';
      root.innerHTML = `<div class="sg-modal-overlay" data-sg-close>
        <section class="sg-modal" role="dialog" aria-modal="true" aria-label="공개 신호 상세">
          <button type="button" class="sg-modal-close" data-sg-close aria-label="닫기">×</button>
          <div class="sg-card-head"><div><h3>${esc(item.title)}</h3><div class="sg-meta">${esc(item.nickname || '익명')} · ${esc(item.symbol)} · ${esc(item.timeframe)}</div></div><span class="sg-action ${esc(item.action)}">${actionLabel(item.action)}</span></div>
          ${item.description ? `<p class="sg-description">${esc(item.description)}</p>` : ''}
          <ol class="sg-detail-conditions">${conditions}</ol>
          <div class="sg-stats"><span>조회 ${item.viewCount || 0}</span><span>좋아요 ${item.likeCount || 0}</span><span>즐겨찾기 ${item.favoriteCount || 0}</span></div>
          <div class="sg-modal-actions">
            ${applyBtn}
            ${!item.isMine ? `<button type="button" class="sg-btn ${item.likedByMe ? 'active' : ''}" data-sg-like="${item.id}">좋아요</button><button type="button" class="sg-btn ${item.favoritedByMe ? 'active' : ''}" data-sg-favorite="${item.id}">즐겨찾기</button>` : ''}
          </div>
        </section>
      </div>`;
      root.dataset.item = JSON.stringify(item);
    } catch (error) {
      window.showToast?.(error.message || '신호 상세를 불러오지 못했습니다.', '#921230');
    }
  }

  function closeDetail() {
    const root = $('sgModalRoot');
    if (root) { root.innerHTML = ''; delete root.dataset.item; }
  }

  async function toggleVisibility(id, makePublic) {
    if (!requireLogin('신호 공개 설정')) return;
    try {
      await request(`/v1/signals/${id}/visibility`, { method: 'PATCH', body: { isPublic: makePublic } });
      window.showToast?.(makePublic ? '게시판에 공개했습니다.' : '공개를 취소했습니다.', '#921230');
      await load();
    } catch (error) { window.showToast?.(error.message, '#921230'); }
  }

  async function removeMine(id) {
    if (!requireLogin('신호 삭제')) return;
    if (!confirm('내 목록에서 이 신호를 숨길까요? 게시판에서도 내려가며 원본은 서비스 기록으로 보존됩니다.')) return;
    try {
      await request(`/v1/signals/${id}`, { method: 'DELETE' });
      window.showToast?.('내 목록과 게시판에서 숨겼습니다.', '#921230');
      await load();
    } catch (error) { window.showToast?.(error.message, '#921230'); }
  }

  async function toggleReaction(id, type) {
    if (!requireLogin(type === 'like' ? '좋아요' : '즐겨찾기')) return;
    try {
      await request(`/v1/signals/${id}/${type}`, { method: 'POST' });
      closeDetail();
      await load();
      if (state.section !== 'my') await openDetail(id);
    } catch (error) { window.showToast?.(error.message, '#921230'); }
  }

  async function applySignal(id) {
    if (!requireLogin('공개 신호 차트 적용')) return;
    try {
      let item;
      const root = $('sgModalRoot');
      if (root?.dataset.item) item = JSON.parse(root.dataset.item);
      if (!item || String(item.id) !== String(id)) item = await request(`/v1/signals/${id}`);
      closeDetail();
      await window.signalBuilder?.applySharedSignal?.(item);
      window.showToast?.('공개 신호를 현재 차트 데이터로 다시 계산했습니다.', '#921230');
    } catch (error) { window.showToast?.(error.message || '차트 적용 실패', '#921230'); }
  }

  function bind() {
    $('sgSubnav')?.addEventListener('click', event => {
      const button = event.target.closest('.sg-subtab');
      if (!button) return;
      const next = button.dataset.section;
      if ((next === 'my' || next === 'favorites') && !requireLogin('내 신호 관리')) return;
      state.section = next; state.page = 1; state.items = []; load();
    });
    $('sgSort')?.addEventListener('change', event => { state.sort = event.target.value; state.page = 1; load(); });
    $('sgSymbolFilter')?.addEventListener('change', event => { state.symbol = event.target.value.trim().toUpperCase(); state.page = 1; load(); });
    $('sgRefresh')?.addEventListener('click', () => { state.page = 1; load(); });
    $('sgMore')?.addEventListener('click', async () => { state.page += 1; await load({ append: true }); });
    document.addEventListener('click', event => {
      const detail = event.target.closest('[data-sg-detail]'); if (detail) { openDetail(detail.dataset.sgDetail); return; }
      const visibility = event.target.closest('[data-sg-visibility]'); if (visibility) { toggleVisibility(visibility.dataset.sgVisibility, visibility.dataset.public === '1'); return; }
      const remove = event.target.closest('[data-sg-delete]'); if (remove) { removeMine(remove.dataset.sgDelete); return; }
      const like = event.target.closest('[data-sg-like]'); if (like) { toggleReaction(like.dataset.sgLike, 'like'); return; }
      const favorite = event.target.closest('[data-sg-favorite]'); if (favorite) { toggleReaction(favorite.dataset.sgFavorite, 'favorite'); return; }
      const apply = event.target.closest('[data-sg-apply]'); if (apply) { applySignal(apply.dataset.sgApply); return; }
      const close = event.target.closest('[data-sg-close]'); if (close && (event.target === close || event.target.closest('.sg-modal-close'))) closeDetail();
      const tab = event.target.closest('.right-tab[data-p="signals"]'); if (tab) load();
    });
  }

  function init() {
    if (!$('sgList')) return;
    bind(); syncToolbar(); load();
  }

  window.SignalBoard = {
    load,
    refreshMy: () => { if (state.section === 'my') load(); },
    openDetail,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
