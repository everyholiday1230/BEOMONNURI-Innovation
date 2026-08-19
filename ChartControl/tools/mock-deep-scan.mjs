/**
 * 목업 심층 탐지.
 *
 * 이전 탐지가 놓친 것
 * -----------------
 * `mock_scan` 은 목업 파일의 **이름·이메일·ID** 만 찾았다. 그래서 이런 것들이
 * 통과했다:
 *
 *   · `/analytics` 의 'TOTAL PNL +$661.87' · 'WIN RATE 80%'  (숫자만 있어서)
 *   · 차트에 그려진 'Position Entry · Long 0.185'            (캔버스 글자)
 *   · KPI 부제의 '+3.18% vs entry' · 'Healthy · Liq. at 82%' (추정 증감률)
 *
 * 이 도구는 세 가지를 더 본다:
 *   1. **목업 소스의 숫자 리터럴**을 화면 텍스트에서 찾는다
 *   2. **여러 라우트에 같은 값이 반복**되는지 (고정값의 특징)
 *   3. **SVG·캔버스 안의 글자**까지 읽는다
 *
 * 쓰는 법
 *   node tools/mock-deep-scan.mjs
 *   ROLE=user node tools/mock-deep-scan.mjs
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
/*
   ★ playwright 는 이 저장소의 의존성이 아니다(브라우저 바이너리가 크다).
     ESM import 는 **스크립트 파일 위치** 를 기준으로 해석하므로, 설치된
     디렉터리에서 실행해도 cwd 의 node_modules 를 보지 않는다.
     그래서 cwd 쪽을 명시적으로 먼저 시도한다.
   ★ 없을 때 스택트레이스로 죽으면 다음 사람이 "도구가 깨졌다" 고 오해한다.
     원인과 해결법을 한 줄로 알려주고 끝낸다.
*/
let chromium;
{
  const tried = [];
  for (const spec of [
    pathToFileURL(join(process.cwd(), 'node_modules', 'playwright', 'index.js')).href,
    'playwright',
  ]) {
    try {
      /* ★ file:// 로 직접 가리키면 CJS 로 로드돼 named export 가 잡히지 않는다.
           playwright 는 CJS 이므로 default 안에 들어온다. 양쪽을 본다. */
      const m = await import(spec);
      chromium = m.chromium ?? m.default?.chromium;
      if (chromium) break;
      tried.push(`${spec} (로드됐으나 chromium 없음)`);
    } catch {
      tried.push(spec.startsWith('file:') ? `${process.cwd()}/node_modules/playwright` : spec);
    }
  }
  if (!chromium) {
    console.error(
      `\n  playwright 를 찾을 수 없습니다. 찾아본 곳:\n    ${tried.join('\n    ')}\n\n` +
        '  설치된 디렉터리에서 실행하십시오. 예:\n' +
        `    cd /tmp/qt_verify && node ${JSON.stringify(process.argv[1])}\n` +
        '  또는 설치:  npm i -D playwright && npx playwright install chromium\n',
    );
    process.exit(2);
  }
}
import { readFileSync } from 'node:fs';
import { env, exit } from 'node:process';

const BASE = env.BASE ?? 'http://127.0.0.1:8795';
const ROOT = env.ROOT ?? '/home/test1/차트 컨트롤';
const ROLE = env.ROLE ?? 'super';

const ACCOUNTS = {
  super: { email: 'test@test.local', password: 'test' },
  user: { email: 'noticetest@x.local', password: 'Passw0rd!x9' },
};

const ROUTES = [
  '/', '/trade', '/markets', '/portfolio', '/analytics',
  '/wallet', '/wallet/deposit', '/wallet/withdraw', '/wallet/transactions',
  '/referral', '/points', '/fees', '/help', '/settings', '/notifications',
  '/order-history', '/ai-strategies', '/ai-strategies/my', '/ai-strategies/detail',
  '/kyc', '/terms', '/privacy',
  '/admin', '/admin/users', '/admin/trades', '/admin/risk', '/admin/assets',
  '/admin/fees', '/admin/cs', '/admin/notices', '/admin/system', '/admin/audit',
  '/admin/ai-ops', '/admin/design-ops', '/admin/broadcast', '/admin/kyc',
  '/admin/deposits', '/admin/withdrawals', '/admin/referral', '/admin/points',
  '/admin/legal',
];

// ---- 목업 소스에서 숫자·문구 추출 ----

/**
 * 목업 파일의 **특징적인 숫자**를 모은다.
 *
 * ★ 아무 숫자나 모으면 안 된다. `0`·`1`·`100` 같은 값은 실데이터에도 나온다.
 *   소수점이 있거나 자릿수가 큰 값만 쓴다 — 우연히 일치할 확률이 낮다.
 */
function mockNumbers() {
  const out = new Set();
  for (const f of ['src/mock-data.js', 'src/mock-app-data.js']) {
    let src = '';
    try { src = readFileSync(`${ROOT}/${f}`, 'utf8'); } catch { continue; }
    // 숫자 리터럴 (자릿수 구분 밑줄 포함)
    for (const m of src.matchAll(/\b\d[\d_]*\.\d+\b|\b\d[\d_]{3,}\b/g)) {
      const raw = m[0].replace(/_/g, '');
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      // 소수 2자리 이상이거나 1000 이상인 값만. 그 아래는 실데이터와 겹친다.
      const decimals = (raw.split('.')[1] ?? '').length;
      if (decimals >= 2 || Math.abs(n) >= 1000) out.add(raw);
    }
  }
  return [...out];
}

/** 숫자를 화면 표기(천단위 쉼표·통화기호)로 바꾼 변형들. */
function variants(raw) {
  const n = Number(raw);
  const v = new Set([raw]);
  if (Number.isFinite(n)) {
    v.add(n.toLocaleString('en-US'));
    v.add(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    // 정수부만 (소수 잘린 표시)
    if (raw.includes('.')) v.add(String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }
  return [...v].filter((x) => x.length >= 4);
}

const NUMBERS = mockNumbers();
const NUMBER_VARIANTS = new Map(NUMBERS.map((n) => [n, variants(n)]));

console.log(`목업 숫자 후보 ${NUMBERS.length}개 · 라우트 ${ROUTES.length}개\n`);

// ---- 탐사 ----

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'ko-KR' });
const page = await ctx.newPage();

const who = ACCOUNTS[ROLE] ?? ACCOUNTS.super;
await page.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
await page.fill('input[type=email]', who.email);
await page.fill('input[type=password]', who.password);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
  if (b) b.click();
});
await page.waitForTimeout(4000);

/** 라우트별 화면 텍스트 (SVG 글자 포함). */
const texts = new Map();

for (const route of ROUTES) {
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(/trade/.test(route) ? 9000 : 3500);

  const t = await page.evaluate(() => {
    const body = document.body.innerText || '';
    /*
       SVG 안의 글자는 innerText 에 안 들어온다.

       ★ 차트 축 라벨·범례가 SVG <text> 다. 목업 곡선의 값이 여기 남아 있으면
         innerText 만 보는 검사는 통과한다.
    */
    const svgText = [...document.querySelectorAll('svg text')].map((e) => e.textContent || '').join(' ');
    return `${body}\n${svgText}`;
  });
  texts.set(route, t);
}

// ---- ① 목업 숫자가 화면에 있나 ----

const numberHits = [];
for (const [route, text] of texts) {
  for (const [raw, forms] of NUMBER_VARIANTS) {
    for (const form of forms) {
      if (text.includes(form)) {
        numberHits.push({ route, raw, shown: form });
        break;
      }
    }
  }
}

// ---- ② 여러 라우트에 같은 값이 반복되나 ----

/*
   고정값의 특징: 라우트가 달라도 같은 숫자가 나온다.

   ★ 실데이터는 화면마다 다른 값을 보여준다. 세 개 이상의 라우트에서 같은
     특이한 숫자가 나오면 하드코딩일 가능성이 높다.

   ★ 시세(BTC 가격 등)는 여러 화면에 같이 나오는 것이 정상이므로, 목업 소스에
     있는 숫자만 대상으로 한다(①의 결과를 묶는다).
*/
const byNumber = new Map();
numberHits.forEach((h) => {
  if (!byNumber.has(h.raw)) byNumber.set(h.raw, new Set());
  byNumber.get(h.raw).add(h.route);
});
const repeated = [...byNumber.entries()].filter(([, routes]) => routes.size >= 3);

// ---- ③ 추정 증감률 문구 ----

/*
   'vs prev' · 'vs yesterday' 처럼 **비교 기준을 우리가 갖고 있지 않은** 증감률.

   ★ 이런 문구는 대개 하드코딩이다. 24시간 전 자산이나 지난 기간 실적을
     보관하지 않으면 계산할 수 없기 때문이다.
*/
const GUESS_PATTERNS = [
  /vs\s+prev(?:ious)?\b/i,
  /vs\s+yesterday/i,
  /vs\s+entry/i,
  /Liq\.\s*at\s*\d+%/i,
  /Bull\s+dominance/i,
  /Fear\s*&\s*Greed/i,
  /Signal\s+Hit\s+Rate/i,
  /Avg\s+R:R/i,
  /Uptime\s+9\d/i,
];
const guessHits = [];
for (const [route, text] of texts) {
  for (const re of GUESS_PATTERNS) {
    const m = text.match(re);
    if (m) guessHits.push({ route, phrase: m[0] });
  }
}

// ---- 결과 ----

const line = (n) => '─'.repeat(n);
console.log(line(74));
console.log(`목업 숫자 노출 ${numberHits.length}건 · 반복값 ${repeated.length}개 · 추정 문구 ${guessHits.length}건`);
console.log(line(74));

if (numberHits.length) {
  console.log('\n■ 목업 소스의 숫자가 화면에 보인다\n');
  const byRoute = new Map();
  numberHits.forEach((h) => {
    if (!byRoute.has(h.route)) byRoute.set(h.route, []);
    byRoute.get(h.route).push(`${h.shown} (목업: ${h.raw})`);
  });
  for (const [route, list] of byRoute) {
    console.log(`  ${route}`);
    [...new Set(list)].slice(0, 8).forEach((x) => console.log(`    · ${x}`));
  }
  console.log('\n  ★ 우연히 일치할 수 있다. 실데이터가 그 값일 가능성을 확인해야 한다.');
}

if (repeated.length) {
  console.log('\n■ 여러 라우트에 같은 값이 반복된다 (고정값 의심)\n');
  repeated.forEach(([raw, routes]) => {
    console.log(`  ${raw} → ${[...routes].join(', ')}`);
  });
}

if (guessHits.length) {
  console.log('\n■ 비교 기준이 없는 증감률·추정 문구\n');
  const byRoute = new Map();
  guessHits.forEach((h) => {
    if (!byRoute.has(h.route)) byRoute.set(h.route, new Set());
    byRoute.get(h.route).add(h.phrase);
  });
  for (const [route, set] of byRoute) {
    console.log(`  ${route}: ${[...set].join(' · ')}`);
  }
  console.log('\n  ★ 우리가 그 기준값을 보관하는지 확인해야 한다. 없으면 하드코딩이다.');
}

if (!numberHits.length && !repeated.length && !guessHits.length) {
  console.log('\n목업 흔적이 발견되지 않았습니다.');
}

await browser.close();
exit(0);
