/**
 * 전수 점검 — 로그인 후 모든 화면의 모든 조작 요소를 실제로 클릭한다.
 *
 * ★ 왜: 정적 검사(코드 읽기)와 화면 로딩 점검만으로는 "눌러도 아무 일 없는 버튼",
 *   "클릭 시 콘솔 에러", "저장했는데 안 되는 입력" 을 잡지 못한다. 실제 사용자가
 *   하는 행동(클릭·입력·저장)을 그대로 재현해야 드러난다.
 *
 * 검지 항목
 *   1) 클릭 시 JS 예외 / 콘솔 에러
 *   2) 클릭 시 서버 5xx (4xx 중 401/403/404 는 문맥에 따라 정상일 수 있어 따로 표기)
 *   3) 무반응 버튼 — 클릭 전후로 DOM·URL·네트워크·토스트가 전혀 변하지 않음
 *   4) 비활성(disabled) 버튼 목록 — 의도적 '준비중' 인지 확인용
 *
 * 사용법
 *   BASE=http://127.0.0.1:8803 ROLE=admin node tools/ui-audit.mjs
 *   BASE=https://chartcontrol.onrender.com EMAIL=... PASSWORD=... node tools/ui-audit.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8803';
const EMAIL = process.env.EMAIL || `audit${Date.now()}@example.com`;
const PASSWORD = process.env.PASSWORD || 'Test1234!aA';
const REGISTER = process.env.REGISTER !== '0';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

/** 고객 화면 + 관리자 화면 전체. */
const CUSTOMER = [
  '/trade', '/markets', '/portfolio', '/analytics', '/wallet', '/wallet/transactions',
  '/orders', '/notifications', '/referral', '/points', '/settings', '/help',
  '/ai-strategies', '/my-strategies', '/fees',
];
const ADMIN = [
  '/admin', '/admin/users', '/admin/kyc', '/admin/trades', '/admin/risk',
  '/admin/deposits', '/admin/withdrawals', '/admin/assets', '/admin/ai',
  '/admin/fees', '/admin/notices', '/admin/broadcast', '/admin/referral',
  '/admin/points', '/admin/legal', '/admin/system', '/admin/audit', '/admin/design',
];

const ignorableConsole = (t) =>
  /favicon|ResizeObserver loop|\[HMR\]|status of 401|status of 403|net::ERR_/i.test(t);

const findings = [];   // { route, control, kind, detail }
const add = (route, control, kind, detail) => findings.push({ route, control, kind, detail });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const pageErrors = [];
const consoleErrors = [];
const serverErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0].slice(0, 180)));
page.on('console', (m) => { if (m.type() === 'error' && !ignorableConsole(m.text())) consoleErrors.push(m.text().slice(0, 180)); });
page.on('response', (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 80)}`); });

/* ---------- 로그인 ---------- */
if (REGISTER) {
  const r = await page.request.post(`${BASE}/api/auth/register`, { data: { email: EMAIL, password: PASSWORD } });
  console.log('register:', r.status());
}
await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
const loggedIn = await page.evaluate(() => !!(window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn()));
console.log('login:', loggedIn ? 'OK' : 'FAILED', '| user:', EMAIL);
if (!loggedIn) { console.log('로그인 실패 — 점검 중단'); await browser.close(); process.exit(1); }

const routes = ONLY || [...CUSTOMER, ...ADMIN];

for (const route of routes) {
  pageErrors.length = 0; consoleErrors.length = 0; serverErrors.length = 0;
  await page.evaluate((h) => { window.location.hash = h; }, route);
  await page.waitForTimeout(4500);

  const bodyLen = await page.evaluate(() => (document.body.innerText || '').trim().length);
  if (bodyLen < 150) add(route, '(page)', 'EMPTY', `본문 ${bodyLen}자 — 렌더 실패 또는 접근 불가`);
  pageErrors.forEach((e) => add(route, '(load)', 'JS_ERROR', e));
  consoleErrors.forEach((e) => add(route, '(load)', 'CONSOLE', e));
  serverErrors.forEach((e) => add(route, '(load)', 'SERVER_5XX', e));

  /* 조작 요소 수집: 화면에 보이는 버튼/탭/토글. 링크·위험 버튼은 제외한다. */
  const controls = await page.evaluate(() => {
    const DANGER = /delete|삭제|remove|제거|revoke|폐기|logout|로그아웃|sign ?out|suspend|정지|close account|withdraw|출금|kill|reset|초기화|confirm|승인|publish|게시|payout|정산|disable|비활성|buy|sell|long|short|매수|매도|order|주문|place|submit|pay|결제|purchase|충전|redeem|교환|consume|connect|연결|save|저장|apply|적용|grant|지급/i;
    const out = [];
    document.querySelectorAll('button, [role="tab"], .seg__opt, .oe-tab').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 4 && r.height > 4 && r.top < window.innerHeight && r.bottom > 0;
      const label = (el.textContent || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 40);
      out.push({
        i, label: label || `(icon:${el.className.toString().slice(0, 24)})`,
        visible, disabled: !!el.disabled, danger: DANGER.test(label),
        title: (el.title || '').slice(0, 60),
      });
    });
    return out;
  });

  const clickable = controls.filter((c) => c.visible && !c.disabled && !c.danger);
  controls.filter((c) => c.disabled).forEach((c) => add(route, c.label, 'DISABLED', c.title || '(no title)'));

  let clicked = 0;
  const CAP = Number(process.env.CAP || 120);
  for (const c of clickable.slice(0, CAP)) {   // 화면당 상한(CAP 환경변수로 조절)
    pageErrors.length = 0; consoleErrors.length = 0; serverErrors.length = 0;

    const snapshot = () => page.evaluate(() => ({
      html: document.body.innerHTML.length,
      text: (document.body.innerText || '').length,
      hash: location.hash,
      toasts: document.querySelectorAll('[class*="toast"]').length,
      active: document.querySelectorAll('.is-active,[aria-pressed="true"],[aria-expanded="true"]').length,
    })).catch(() => null);
    const before = await snapshot();
    if (!before) break;

    let reqCount = 0;
    const onReq = () => { reqCount++; };
    page.on('request', onReq);
    try {
      // 인덱스로 다시 찾아 클릭한다(DOM 이 바뀌었을 수 있어 실패는 무시).
      await page.evaluate((idx) => {
        const els = document.querySelectorAll('button, [role="tab"], .seg__opt, .oe-tab');
        const el = els[idx];
        if (el && !el.disabled) el.click();
      }, c.i);
      clicked++;
      await page.waitForTimeout(900);
    } catch (e) { /* 클릭 실패는 아래 무반응 판정으로 잡힌다 */ }
    page.off('request', onReq);

    const after = await snapshot();

    pageErrors.forEach((e) => add(route, c.label, 'JS_ERROR', e));
    consoleErrors.forEach((e) => add(route, c.label, 'CONSOLE', e));
    serverErrors.forEach((e) => add(route, c.label, 'SERVER_5XX', e));

    if (after) {
      /* 무반응 판정을 엄격히 한다 — 패널 열림·탭 활성·토스트·본문 변화도 반응이다. */
      const noDom = Math.abs(after.html - before.html) < 12 && Math.abs(after.text - before.text) < 4;
      const noNav = after.hash === before.hash;
      const noToast = after.toasts <= before.toasts;
      const noActive = after.active === before.active;
      if (noDom && noNav && noToast && noActive && reqCount === 0) {
        add(route, c.label, 'NO_RESPONSE', '클릭해도 화면·이동·요청·알림 변화 없음');
      }
      // 라우트가 바뀌면 원래 화면으로 되돌린다.
      if (!noNav) {
        await page.evaluate((h) => { window.location.hash = h; }, route);
        await page.waitForTimeout(2500);
      }
    }
  }
  const counts = findings.filter((f) => f.route === route);
  console.log(`${route}  버튼 ${clickable.length}개 중 ${clicked}개 클릭 · 문제 ${counts.filter((f) => f.kind !== 'DISABLED').length} · 비활성 ${counts.filter((f) => f.kind === 'DISABLED').length}`);
}

/* ---------- 보고 ---------- */
const byKind = {};
findings.forEach((f) => { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
console.log('\n========== 요약 ==========');
Object.entries(byKind).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

for (const kind of ['JS_ERROR', 'SERVER_5XX', 'CONSOLE', 'EMPTY', 'NO_RESPONSE', 'DISABLED']) {
  const rows = findings.filter((f) => f.kind === kind);
  if (!rows.length) continue;
  console.log(`\n--- ${kind} (${rows.length}) ---`);
  rows.slice(0, 60).forEach((f) => console.log(`  ${f.route}  [${f.control}]  ${f.detail}`));
  if (rows.length > 60) console.log(`  ... 그 외 ${rows.length - 60}건`);
}

await browser.close();
