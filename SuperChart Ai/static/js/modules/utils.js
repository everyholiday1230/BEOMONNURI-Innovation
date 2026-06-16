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
  const isRich = type && !colorOrBody.startsWith('#');
  const colors = { ai: '#A31540', entry: '#C4384B', tp: '#D8B66A' };
  const bg = isRich ? (colors[type] || '#921230') : colorOrBody;
  let tc = document.getElementById('_toastContainer');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = '_toastContainer';
    // 접근성: aria-live="polite" — 스크린리더가 토스트 자동 읽음
    tc.setAttribute('aria-live', 'polite');
    tc.setAttribute('aria-atomic', 'true');
    tc.setAttribute('role', 'status');
    tc.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none';
    document.body.appendChild(tc);
  }
  const t = document.createElement('div');
  t.style.pointerEvents = 'auto';
  const _surface = (document.body.classList.contains('dark')) ? '#0f2e38' : '#ffffff';
  const _txt = (document.body.classList.contains('dark')) ? '#E6EDF3' : '#0F172A';
  if (isRich) {
    t.style.cssText = `display:flex;align-items:flex-start;gap:10px;background:${_surface};color:${_txt};padding:11px 16px 11px 13px;border-radius:10px;border-left:4px solid ${bg};font-size:14px;box-shadow:0 8px 28px rgba(15,23,42,0.18),0 2px 6px rgba(15,23,42,0.1);animation:toastSlide 0.28s cubic-bezier(.2,.8,.2,1);min-width:220px;max-width:340px;pointer-events:auto`;
    t.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${bg};margin-top:5px;flex-shrink:0"></span><div><div style="font-weight:700;margin-bottom:2px">${escHtml(msg)}</div><div style="font-size:13px;opacity:0.75">${escHtml(colorOrBody)}</div></div>`;
  } else {
    t.style.cssText = `display:flex;align-items:center;gap:9px;background:${_surface};color:${_txt};padding:11px 16px 11px 13px;border-radius:10px;border-left:4px solid ${bg};font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(15,23,42,0.18),0 2px 6px rgba(15,23,42,0.1);animation:toastSlide 0.28s cubic-bezier(.2,.8,.2,1);white-space:pre-line;max-width:340px;pointer-events:auto`;
    t.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${bg};flex-shrink:0"></span><span>${escHtml(msg)}</span>`;
  }
  tc.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastSlideOut 0.25s ease forwards'; setTimeout(() => t.remove(), 250); }, 3500);
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
