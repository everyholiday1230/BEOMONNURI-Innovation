/**
 * 저장 전수 점검 — 화면의 입력값을 바꾸고 새로고침해서 남는지 확인한다.
 *
 * ★ 왜: 버튼 클릭 점검은 "눌러도 반응 없음" 을 잡지만, "저장했다고 나오는데
 *   새로고침하면 사라짐"(uncontrolled input, 서버 미전송, 잘못된 스토리지 키)은
 *   잡지 못한다. 실제 이용자가 가장 자주 겪는 결함이 이쪽이다.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8803';
const EMAIL = process.env.EMAIL || `save${Date.now()}@example.com`;
const PASSWORD = process.env.PASSWORD || 'Test1234!aA';
const log = (...a) => console.log(...a);
const results = [];

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 150)));

if (process.env.REGISTER !== '0') {
  await p.request.post(`${BASE}/api/auth/register`, { data: { email: EMAIL, password: PASSWORD } });
}
await p.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
await p.locator('input[type="email"]').first().fill(EMAIL);
await p.locator('input[type="password"]').first().fill(PASSWORD);
await p.locator('button[type="submit"]').first().click();
await p.waitForTimeout(5000);
log('login:', await p.evaluate(() => !!(window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn())));

/** 한 화면에서 입력/체크박스/셀렉트를 바꾸고, 새로고침 후 유지되는지 본다. */
async function checkRoute(route, label) {
  await p.evaluate((h) => { window.location.hash = h; }, route);
  await p.waitForTimeout(4000);

  // 조작 가능한 폼 요소를 훑는다(비밀번호·검색은 제외 — 저장 대상이 아니다).
  const before = await p.evaluate(() => {
    const items = [];
    document.querySelectorAll('input, select, textarea').forEach((el, i) => {
      const t = (el.type || '').toLowerCase();
      if (['password', 'file', 'submit', 'button', 'hidden'].includes(t)) return;
      const ph = (el.placeholder || '').toLowerCase();
      if (/search|검색/.test(ph)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      items.push({ i, tag: el.tagName, type: t, checked: el.checked, value: el.value, disabled: el.disabled });
    });
    return items;
  });

  // 체크박스/셀렉트만 토글한다(텍스트 입력은 값 규칙을 모르면 저장이 거부될 수 있다).
  const changed = await p.evaluate(() => {
    const out = [];
    const els = Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => {
      const t = (el.type || '').toLowerCase();
      if (['password', 'file', 'submit', 'button', 'hidden'].includes(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && !el.disabled;
    });
    els.forEach((el, idx) => {
      const t = (el.type || '').toLowerCase();
      if (t === 'checkbox') {
        const was = el.checked;
        el.click();
        out.push({ idx, kind: 'checkbox', from: was, to: el.checked });
      } else if (el.tagName === 'SELECT' && el.options.length > 1) {
        const was = el.value;
        el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        out.push({ idx, kind: 'select', from: was, to: el.value });
      }
    });
    return out;
  });

  await p.waitForTimeout(2500);
  const afterChange = await p.evaluate(() => Array.from(document.querySelectorAll('input[type=checkbox], select'))
    .map((el) => (el.type === 'checkbox' ? String(el.checked) : el.value)));

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.evaluate((h) => { window.location.hash = h; }, route);
  await p.waitForTimeout(4500);
  const afterReload = await p.evaluate(() => Array.from(document.querySelectorAll('input[type=checkbox], select'))
    .map((el) => (el.type === 'checkbox' ? String(el.checked) : el.value)));

  const same = JSON.stringify(afterChange) === JSON.stringify(afterReload);
  results.push({ route, label, fields: before.length, changed: changed.length, persisted: same });
  log(`${route.padEnd(22)} 필드 ${String(before.length).padStart(2)}개 · 변경 ${String(changed.length).padStart(2)}개 · 새로고침 후 ${same ? '유지 OK' : '⚠ 사라짐'}`);
}

await checkRoute('/settings', '설정');
await checkRoute('/trade', '트레이드');
await checkRoute('/markets', '마켓');
await checkRoute('/points', '포인트');
await checkRoute('/referral', '리퍼럴');
await checkRoute('/notifications', '알림');

log('\n=== 저장 결함 후보 ===');
const bad = results.filter((r) => r.changed > 0 && !r.persisted);
if (!bad.length) log('  없음 — 바꾼 값이 모두 새로고침 후에도 유지됨');
bad.forEach((r) => log(`  ⚠ ${r.route} (${r.label}) — ${r.changed}개 변경했으나 새로고침 후 되돌아감`));
if (errs.length) { log('\nJS 예외:', errs.length); errs.slice(0, 5).forEach((e) => log('  -', e)); }
await b.close();
