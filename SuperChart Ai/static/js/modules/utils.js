/**
 * utils.js — 공용 유틸리티 함수
 * 다른 모듈에서 import하여 사용
 */

export function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export function safeUrl(u) {
  if (!u) return '#';
  const s = String(u).trim();
  if (/^\s*(javascript|data|vbscript):/i.test(s)) return '#';
  return escHtml(s);
}

export function showToast(msg, colorOrBody = '#3B82F6', type = '') {
  const toneColor = {
    ai: '#A31540',
    entry: '#C4384B',
    tp: '#D8B66A',
    guide: '#921230',
    info: '#3B82F6'
  };
  const isColor = typeof colorOrBody === 'string' && colorOrBody.trim().startsWith('#');
  const color = isColor ? colorOrBody : (toneColor[type] || '#921230');
  const detail = isColor ? '' : String(colorOrBody || '').trim();
  const rawMsg = String(msg || '').trim();
  const guideParts = rawMsg.includes('|')
    ? rawMsg.split('|').map(x => x.trim()).filter(Boolean)
    : [];
  const isGuide = type === 'guide' || guideParts.length > 1;

  let tc = document.getElementById('_toastContainer');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = '_toastContainer';
    tc.setAttribute('aria-live', 'polite');
    tc.setAttribute('aria-atomic', 'true');
    tc.setAttribute('role', 'status');
    tc.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none';
    document.body.appendChild(tc);
  }

  const t = document.createElement('div');
  t.className = 'pro-toast';
  t.style.pointerEvents = 'auto';
  t.style.borderLeftColor = color;

  const iconMap = { ai: 'AI', entry: '⦿', tp: '◎', guide: '💡', info: 'i' };
  const titleMap = { ai: 'AI 알림', entry: '진입 알림', tp: '목표 알림', guide: '드로잉 가이드', info: '알림' };
  const icon = iconMap[type] || (isGuide ? '💡' : 'i');
  const title = titleMap[type] || (isGuide ? '드로잉 가이드' : '알림');
  const bodyText = guideParts.length ? '' : rawMsg;
  const chips = guideParts.map(part => `<span class="pro-toast-chip">${escHtml(part)}</span>`).join('');

  t.innerHTML = `
    <span class="pro-toast-icon" style="color:${escHtml(color)}">${icon}</span>
    <div style="min-width:0;flex:1">
      <div class="pro-toast-title">${escHtml(title)}</div>
      ${bodyText ? `<div class="pro-toast-body">${escHtml(bodyText)}</div>` : ''}
      ${detail ? `<div class="pro-toast-body">${escHtml(detail)}</div>` : ''}
      ${chips ? `<div class="pro-toast-guide">${chips}</div>` : ''}
    </div>
    <button type="button" class="pro-toast-close" aria-label="닫기">✕</button>
  `;

  const closeBtn = t.querySelector('.pro-toast-close');
  closeBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    t.remove();
  });

  tc.appendChild(t);
  const ttl = chips ? 5200 : 3600;
  setTimeout(() => {
    if (!t.parentElement) return;
    t.style.animation = 'toastSlideOut 0.25s ease forwards';
    setTimeout(() => t.remove(), 250);
  }, ttl);
}

export function fmtPrice(p, sym, raw) {
  if (!p || isNaN(p)) return '-';
  const curSymbol = window.curSymbol || '';
  const prefix = (sym || curSymbol).includes('KRW') ? '₩' : '';
  if (raw) return prefix + raw.replace(/0+$/, '').replace(/\.$/, '');
  const v = parseFloat(p);
  if (v >= 10000) return prefix + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  let s;
  if (v >= 100) s = v.toFixed(2);
  else if (v >= 1) s = v.toFixed(4);
  else if (v < 0.0001) s = v.toFixed(8);
  else if (v < 0.01) s = v.toFixed(6);
  else s = v.toFixed(4);
  return prefix + s.replace(/0+$/, '').replace(/\.$/, '');
}

// window에 노출 (기존 코드 호환)
window._escHtml = escHtml;
window._safeUrl = safeUrl;
window.sanitize = escHtml;
window.esc = escHtml;
window.showToast = showToast;
window.fmtPrice = fmtPrice;
window.setText = function(el, t) { if (el) el.textContent = t == null ? '' : String(t); };
