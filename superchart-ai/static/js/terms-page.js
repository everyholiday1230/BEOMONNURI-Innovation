// Terms 페이지 - 탭 전환
function showTab(id){
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.remove('active');
    t.setAttribute('aria-selected','false');
  });
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  const clicked = document.querySelector(`[data-tab="${id}"]`);
  if (clicked) {
    clicked.classList.add('active');
    clicked.setAttribute('aria-selected','true');
  }
}
// 탭 클릭 위임
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  showTab(t.dataset.tab);
});
// 탭 키보드
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  e.preventDefault();
  showTab(t.dataset.tab);
});
