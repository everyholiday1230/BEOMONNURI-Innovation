/**
 * 미번역 문구 전수 수집 — 사전을 거치지 않는 하드코딩까지 잡는다.
 *
 * 왜 기존 도구로는 부족한가
 * ----------------------
 * `i18n-fallback-check.mjs` 는 **en 사전의 값과 정확히 일치**하는 문자열만 후보로
 * 삼는다. 그 판정은 오탐이 없는 대신, **애초에 사전에 없는 문자열(JSX 에 직접 쓴
 * 영어)은 원리적으로 잡지 못한다.**
 *
 * 실측: 그 도구가 zh 에서 "0종" 을 보고하는 동안, 화면에는 페이지 제목 `Markets`,
 * 표 머리글 `PAIR`·`PRICE`·`SYMBOL`, 필터 탭 `All`/`Favorites`/`Gainers`,
 * 카드 라벨 `TOTAL EQUITY`·`MARGIN RATIO` 가 영어로 남아 있었다.
 *
 * 이 도구는 반대 방향으로 접근한다: **대상 언어 화면에서 라틴 문자로만 된 문구를
 * 모아** 번역 대상이 아닌 것을 걸러낸다. 오탐이 생길 수 있으므로 제외 규칙을
 * 명시적으로 관리하고, 판단이 필요한 것은 사람에게 보여준다.
 *
 * 쓰는 법
 *   LOCALE=zh BASE=http://127.0.0.1:8796 node tools/untranslated-scan.mjs
 *   ROLE=super            관리자 화면까지 (기본 user)
 *   JSON=1                기계가 읽을 형식으로 출력
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

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
    console.error('playwright 없음. pnpm add -w -D playwright@1.46.1');
    process.exit(1);
  }
}

const env = process.env;
const BASE = env.BASE ?? 'http://127.0.0.1:8796';
const LOCALE = env.LOCALE ?? 'zh';
const ROLE = env.ROLE ?? 'user';
const AS_JSON = env.JSON === '1';

const ACCOUNTS = {
  user: { email: env.EMAIL ?? 'user@qt.local', password: env.PASSWORD ?? 'userpass1234' },
  super: { email: env.EMAIL ?? 'admin@qt.local', password: env.PASSWORD ?? 'adminpass1234' },
};

const USER_ROUTES = [
  '/trade', '/markets', '/portfolio', '/analytics', '/ai-strategies', '/ai-strategies/my',
  '/wallet', '/wallet/deposit', '/wallet/withdraw', '/wallet/transactions',
  '/order-history', '/settings', '/notifications', '/points', '/referral', '/fees', '/help',
];
const ADMIN_ROUTES = [
  '/admin', '/admin/users', '/admin/trades', '/admin/risk', '/admin/system', '/admin/audit',
  '/admin/notices', '/admin/broadcast', '/admin/fees', '/admin/assets', '/admin/ai-ops',
  '/admin/design-ops', '/admin/kyc', '/admin/points', '/admin/legal', '/admin/referral',
];
const ROUTES = env.ROUTES
  ? env.ROUTES.split(',').map((s) => s.trim())
  : (ROLE === 'super' ? [...USER_ROUTES, ...ADMIN_ROUTES] : USER_ROUTES);

/*
   번역 대상이 아닌 것 — 제외 규칙.

   ★ 규칙을 넓게 잡으면 진짜 미번역이 조용히 빠진다. 좁게 유지하고, 애매한 것은
     결과에 남겨 사람이 판단하게 한다.
*/
const isNotTranslatable = (s) => {
  // 코인 티커·통화·약어 (대문자/숫자 2~6자): BTC, USDT, PERP, GTC, PNL, ROE …
  if (/^[A-Z0-9]{1,6}$/.test(s)) return true;
  // 거래쌍·복합 심볼: BTC/USDT, USDT-PERP, ETH/USDT · +17.50%
  if (/^[A-Z0-9]{2,10}[/-][A-Z0-9]{2,10}/.test(s)) return true;
  // 숫자·기호만, 또는 숫자에 단위가 붙은 것: 1.32B, 125× MAX, 30D, 1H, +17.62%
  if (/^[\d\s.,:%+\-–—/()×x]+$/.test(s)) return true;
  if (/^[\d.,]+\s*[A-Za-z%×]{1,4}$/.test(s)) return true;
  // 시간·타임프레임 표기: 1m, 5m, 15m, 4H, 1D, 30D, 90D, 1Y, 06:15
  if (/^\d{1,3}(m|h|H|D|d|W|w|Y|y|s)$/.test(s)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return true;
  // 고유명사·제품명
  if (/^(ChartControl|KuCoin|BitMart|Binance|Bybit|OKX|Bitget|Gate|Kraken|Coinbase|USDT|USDC|Playwright|Redis|PostgreSQL|Fibonacci)$/i.test(s)) return true;
  // 버전·해시·식별자
  if (/^v?\d+(\.\d+)+$/.test(s)) return true;
  if (/^[0-9a-f]{6,}$/i.test(s)) return true;
  // 이메일·URL
  if (/@.+\./.test(s) || /^https?:\/\//.test(s)) return true;
  // 알파벳이 3자 미만이면 라벨로 보기 어렵다
  if (!/[A-Za-z]{3}/.test(s)) return true;
  return false;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
/* 언어 고정 + 개발용 상태배지 끄기(배지 문구가 결과를 오염시킨다). */
await ctx.addInitScript(`try{
  var t={}; try{ t=JSON.parse(localStorage.getItem('qt.tweaks')||'{}')||{} }catch(e){}
  t.lang=${JSON.stringify(LOCALE)};
  localStorage.setItem('qt.tweaks', JSON.stringify(t));
  localStorage.setItem('qt.provenance', JSON.stringify({enabled:false, mode:'badge'}));
  localStorage.setItem('qt.ai.collapsed','0');
}catch(e){}`);
const page = await ctx.newPage();

const who = ACCOUNTS[ROLE] ?? ACCOUNTS.user;
await page.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
await page.fill('input[type=email]', who.email);
await page.fill('input[type=password]', who.password);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
  if (b) b.click();
});
await page.waitForTimeout(4500);
if (!(await page.evaluate(() => Boolean(window.QTAuth?.isLoggedIn?.())))) {
  console.error(`로그인 실패 (${who.email})`);
  await browser.close();
  process.exit(1);
}
const applied = await page.evaluate(() => window.QTI18n?.getLocale?.() ?? '');
if (applied !== LOCALE) {
  console.error(`언어 '${LOCALE}' 적용 실패 (실제 '${applied}')`);
  await browser.close();
  process.exit(1);
}

/** 문구 → 그것이 보인 라우트 집합 */
const hits = new Map();

for (const route of ROUTES) {
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(/trade/.test(route) ? 9000 : 3200);

  const found = await page.evaluate(() => {
    const out = [];
    /*
       ★ 텍스트 노드 단위로 읽는다.
         elem.innerText 를 쓰면 자식의 번역된 글자까지 함께 붙어, 라틴 문자만인지
         판단할 수 없다.
    */
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      const s = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const el = n.parentElement;
      if (!el || !el.offsetParent) continue;      // 화면에 없는 것
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      out.push(s);
    }
    /* placeholder·title·aria-label 도 사용자가 읽는 글자다. */
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el) => {
      if (!el.offsetParent) return;
      for (const a of ['placeholder', 'title', 'aria-label']) {
        const v = (el.getAttribute(a) || '').replace(/\s+/g, ' ').trim();
        if (v) out.push(v);
      }
    });
    return out;
  });

  for (const s of found) {
    if (s.length < 3 || s.length > 120) continue;
    if (!/[A-Za-z]/.test(s)) continue;
    // 이미 대상 언어 글자가 섞여 있으면 번역된 것으로 본다
    if (/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(s)) continue;
    if (isNotTranslatable(s)) continue;
    if (!hits.has(s)) hits.set(s, new Set());
    hits.get(s).add(route);
  }
}

await browser.close();

const sorted = [...hits].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));

if (AS_JSON) {
  console.log(JSON.stringify(sorted.map(([text, rs]) => ({ text, routes: [...rs] })), null, 2));
} else {
  console.log(`\nlocale=${LOCALE} · role=${ROLE} · ${ROUTES.length}라우트`);
  console.log(`사전을 거치지 않는(하드코딩) 영어 문구: ${sorted.length}종\n`);
  for (const [text, rs] of sorted) {
    console.log(`  ${String(rs.size).padStart(2)}화면 · ${JSON.stringify(text)}`);
  }
  console.log('');
}

process.exit(sorted.length ? 1 : 0);
