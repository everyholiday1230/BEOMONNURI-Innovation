// FAQ 페이지 - 서버에서 FAQ 목록 가져와 렌더
(async () => {
  try {
    const d = await (window.api ? window.api.get('/v1/site/faqs') : fetch('/v1/site/faqs').then(r => r.json()));
    const list = d.data || [];
    const target = document.getElementById('faqList');
    if (!target) return;
    if (!list.length) {
      target.innerHTML = '<div class="empty">등록된 FAQ가 없습니다</div>';
      return;
    }
    const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    target.innerHTML = list.map((f, i) => {
      const q = esc(f.question);
      const a = esc(f.answer).replace(/\n/g, '<br>');
      return `<div class="faq-item"><h2 class="faq-q" data-faq-toggle="${i}" tabindex="0" role="button" aria-expanded="false"><span>${q}</span><span class="arrow">▼</span></h2><div class="faq-a" id="fa${i}"><p>${a}</p></div></div>`;
    }).join('');
  } catch (e) {
    const el = document.getElementById('faqList');
    if (el) el.innerHTML = '<div class="empty">로드 실패</div>';
  }
})();

// FAQ 토글 (이벤트 위임)
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-faq-toggle]');
  if (!t) return;
  const i = t.dataset.faqToggle;
  const a = document.getElementById('fa' + i);
  if (!a) return;
  const q = a.previousElementSibling;
  const open = a.classList.contains('open');
  document.querySelectorAll('.faq-a').forEach(el => {
    el.classList.remove('open');
    if (el.previousElementSibling) el.previousElementSibling.classList.remove('open');
  });
  if (!open) {
    a.classList.add('open');
    if (q) q.classList.add('open');
  }
});
