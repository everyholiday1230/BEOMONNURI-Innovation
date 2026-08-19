/*
   i18n 미번역 실측 도구
   ------------------------------------------------------------
   목적: 특정 언어로 화면을 열었을 때 **실제로 눈에 보이는** 미번역 문구를
         라우트별로 뽑아낸다.

   왜 사전 키 비교(en 대비 ja 누락)로는 부족한가
     ja 는 en 대비 1,100키 이상 비어 있지만, 그 대부분은 화면에 나오지 않는
     경로(특정 오류 상태·미개발 관리자 화면 등)의 문구다. 키 개수를 기준으로
     삼으면 "1,100개 남았다"는 숫자에 매달려 정작 고객이 보는 4개를 놓친다.
     그래서 실제 렌더 결과에서 찾는다.

   판정 방법
     대상 언어가 ja/en 일 때 화면에 한글(가-힣)이 남아 있으면 미번역이다.
     ko 로 볼 때는 반대로 판정할 수 없다(고유명사·영문 용어가 정상이므로).

   제외
     - 사용자가 입력한 값(법적 문서 본문은 DB 콘텐츠이므로 언어별 문서로 관리)
     - 코드 폰트로 표시되는 식별자
*/

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/*
   ★ playwright 는 이 저장소의 의존성이 아니다(브라우저 바이너리가 크다).
     ESM import 는 스크립트 위치 기준으로 해석되므로 cwd 쪽을 먼저 시도한다.
     tools/mobile-clip-check.mjs 와 같은 방식.
*/
let chromium;
{
  for (const spec of [
    pathToFileURL(join(process.cwd(), 'node_modules', 'playwright', 'index.js')).href,
    'playwright',
  ]) {
    try {
      const m = await import(spec);
      chromium = m.chromium ?? m.default?.chromium;
      if (chromium) break;
    } catch { /* 다음 후보 */ }
  }
  if (!chromium) {
    console.error('playwright 를 찾지 못했다. 설치된 디렉터리에서 실행하라 (예: cd /tmp/qt_verify).');
    process.exit(2);
  }
}

const BASE = process.env.BASE || 'http://127.0.0.1:8795';
const EMAIL = process.env.EMAIL || 'test@test.local';
const PASSWORD = process.env.PASSWORD || 'test';
const LOCALE = process.env.LOCALE || 'ja';

const ROUTES = [
  '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
  '/trade', '/markets', '/ai-strategies', '/ai-strategies/detail?id=s1', '/ai-strategies/my',
  '/portfolio', '/analytics', '/wallet', '/wallet/deposit',
  '/wallet/withdraw', '/wallet/transactions', '/referral', '/points', '/fees', '/help',
  '/settings', '/notifications', '/order-history',
  '/admin', '/admin/users', '/admin/users/detail?id=u1', '/admin/kyc', '/admin/trades',
  '/admin/risk', '/admin/deposits', '/admin/withdrawals', '/admin/assets', '/admin/ai-ops',
  '/admin/fees', '/admin/notices', '/admin/notices/new', '/admin/cs?id=t1', '/admin/broadcast',
  '/admin/system', '/admin/audit', '/admin/design-ops', '/admin/referral', '/admin/points',
  '/admin/legal',
];

/*
   법적 문서 라우트는 DB 콘텐츠라 사전 대상이 아니다.
   ja 문서가 게시되어 있으므로 본문은 일본어지만, 검사에서는 제외해 혼동을 막는다.
*/
const CONTENT_ROUTES = new Set(['/terms', '/privacy', '/risk', '/security']);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);
await page.fill('input[type=email]', EMAIL).catch(() => {});
await page.fill('input[type=password]', PASSWORD).catch(() => {});
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

const session = await page.evaluate(async () => {
  const r = await fetch('/api/auth/session');
  const d = await r.json();
  return d.authenticated ? (d.user || {}).email : null;
});
if (!session) {
  console.error(`로그인 실패 (${EMAIL}). 검사를 진행하면 모든 라우트가 "권한 없음" 화면이 되어`);
  console.error('미번역 0건으로 잘못 통과한다. 중단한다.');
  process.exit(2);
}
console.log(`로그인: ${session} · locale=${LOCALE} · ${ROUTES.length}라우트\n`);

const found = new Map(); // 문구 -> [라우트]
let checked = 0;

for (const route of ROUTES) {
  if (CONTENT_ROUTES.has(route)) continue;
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.evaluate((l) => window.QTI18n && window.QTI18n.setLocale(l), LOCALE);
  await page.waitForTimeout(1500);

  const hits = await page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const txt = (n.nodeValue || '').trim();
      if (!txt || !/[가-힣]/.test(txt)) continue;
      const el = n.parentElement;
      if (!el) continue;
      // 화면에 실제로 보이는 것만
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push(txt.slice(0, 60));
    }
    return [...new Set(out)];
  });

  checked += 1;
  for (const h of hits) {
    if (!found.has(h)) found.set(h, []);
    found.get(h).push(route);
  }
  if (hits.length) {
    console.log(`  ⚠ ${route}`);
    for (const h of hits.slice(0, 8)) console.log(`      ${h}`);
    if (hits.length > 8) console.log(`      … 외 ${hits.length - 8}건`);
  }
}

await browser.close();

console.log(`\n검사 ${checked}라우트 · 미번역 문구 ${found.size}종`);
if (found.size) {
  console.log('\n=== 문구별 등장 라우트 ===');
  for (const [txt, routes] of [...found.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${routes.length}곳  ${txt}   ${routes.slice(0, 4).join(' ')}`);
  }
}
process.exit(found.size ? 1 : 0);
