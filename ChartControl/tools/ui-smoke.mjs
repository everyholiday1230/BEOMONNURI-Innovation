/**
 * 프론트엔드 스모크 점검 — 실제 브라우저로 모든 화면을 열어 본다.
 *
 * ★ 왜 필요한가: 이 저장소의 기존 E2E 스위트(tests/e2e)는 지금 UI 와 세대가
 *   다르다(164 개 data-testid 를 기대하는데 현재 코드에는 0 개). 그래서 프론트엔드가
 *   테스트 사각지대였고, stepSize·tickSize·2FA 같은 실사용 버그가 그대로 통과했다.
 *
 * ★ 이 스크립트가 잡는 것: 페이지 자바스크립트 예외, 콘솔 에러, 실패한 네트워크
 *   요청(4xx/5xx), 내용이 거의 없는(=렌더 실패) 화면.
 *
 * 사용법:
 *   node tools/ui-smoke.mjs                       # 기본: 라이브 사이트
 *   BASE=http://127.0.0.1:8799 node tools/ui-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://chartcontrol.onrender.com';

/* 로그인 없이 접근 가능한 화면 + 앱 라우트(비로그인은 로그인 화면으로 유도되는지 확인). */
const ROUTES = [
  '/', '/#/login', '/#/signup', '/#/trade', '/#/markets', '/#/portfolio',
  '/#/analytics', '/#/wallet', '/#/orders', '/#/notifications', '/#/referral',
  '/#/points', '/#/settings', '/#/help', '/#/ai-strategies', '/#/my-strategies',
  '/#/terms', '/#/privacy', '/#/risk', '/#/refund',
];

/* 무해한 노이즈는 실패로 세지 않는다 — 실제 결함만 남긴다. */
const IGNORE = [
  /favicon/i,
  /Failed to load resource: net::ERR_/i,     // 네트워크 순간 단절
  /ResizeObserver loop/i,
  /\[HMR\]/i,
  /status of 401/i,                          // 비로그인 상태의 정상 거부
  /status of 403/i,
];
const ignorable = (t) => IGNORE.some((re) => re.test(t));

const browser = await chromium.launch();
let failures = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  const errors = [];
  const badRequests = [];

  page.on('pageerror', (e) => errors.push('JS 예외: ' + String(e).split('\n')[0].slice(0, 180)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 180);
    if (!ignorable(t)) errors.push('콘솔: ' + t);
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400 && !ignorable(r.url())) badRequests.push(`${s} ${r.url().replace(BASE, '').slice(0, 90)}`);
  });

  let text = '';
  try {
    /*
       ★ 해시 라우트를 URL 로 직접 열면 첫 렌더 시점에 아직 라우터가 해시를 읽지 못해
         빈 화면으로 관측될 수 있다(오탐). 실제 사용 경로대로 홈을 먼저 띄우고 해시를
         바꿔 전환한다.
    */
    const hash = route.startsWith('/#') ? route.slice(1) : null;
    await page.goto(BASE + (hash ? '/' : route), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    if (hash) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(4000);
    } else {
      await page.waitForTimeout(1500);
    }
    text = await page.evaluate(() => document.body.innerText || '');
  } catch (e) {
    errors.push('이동 실패: ' + String(e).split('\n')[0].slice(0, 160));
  }

  /* 401 은 비로그인 상태의 정상 응답이다(보호된 데이터). 결함으로 세지 않는다. */
  const realBad = badRequests.filter((b) => !b.startsWith('401') && !b.startsWith('403'));
  const tooEmpty = text.trim().length < 120;
  const ok = errors.length === 0 && realBad.length === 0 && !tooEmpty;
  if (!ok) failures++;

  console.log(`${ok ? 'OK  ' : 'FAIL'} ${route}  (본문 ${text.trim().length}자)`);
  errors.slice(0, 4).forEach((e) => console.log('       ' + e));
  realBad.slice(0, 4).forEach((b) => console.log('       요청실패 ' + b));
  if (tooEmpty) console.log('       화면이 거의 비어 있다 — 렌더 실패 가능');

  await page.close();
}

await browser.close();
console.log(`\n합계: ${ROUTES.length}개 화면 중 ${failures}개 문제`);
process.exit(failures > 0 ? 1 : 0);
