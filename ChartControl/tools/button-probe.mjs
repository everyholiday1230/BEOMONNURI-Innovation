/**
 * 버튼 전수 탐사.
 *
 * 무엇을 찾는가
 * -----------
 * 화면의 모든 버튼을 실제로 눌러보고, 아무 일도 일어나지 않는 것을 찾는다.
 *
 * 왜 필요한가
 * ---------
 * 목업 탐지와 라우트 검증을 다 통과한 화면에서도 결함이 나왔다:
 *
 *   · 매수 버튼이 `t is not defined` 로 죽어 있었다 (확인창이 렌더 도중 예외)
 *   · 차트에 목업 포지션 선이 그려졌다 (캔버스 글자는 innerText 로 안 읽힌다)
 *
 * 둘 다 "눌러보지 않아서" 놓쳤다. 화면이 뜨는 것과 버튼이 동작하는 것은 다르다.
 *
 * 판정 방법
 * -------
 * 버튼을 누른 뒤 이 중 하나라도 바뀌면 '반응 있음' 으로 본다:
 *   · DOM 이 변했다 (본문 길이·해시·모달·토스트)
 *   · 네트워크 요청이 나갔다
 *   · 콘솔 오류가 났다 (반응이지만 나쁜 반응 — 따로 보고한다)
 *
 * 아무것도 바뀌지 않으면 죽은 버튼 후보다.
 *
 * ★ 후보라고만 한다. 이미 켜진 토글을 다시 누르거나, 같은 값으로 정렬하거나,
 *   빈 목록을 새로고침하면 실제로 아무 변화가 없을 수 있다. 사람이 확인해야
 *   하는 목록을 좁혀주는 것이 이 도구의 목적이다.
 *
 * 쓰는 법
 *   node tools/button-probe.mjs                 # 전 라우트
 *   ROUTES=/analytics,/portfolio node tools/button-probe.mjs
 *   ROLE=user node tools/button-probe.mjs
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
import { env, exit } from 'node:process';

const BASE = env.BASE ?? 'http://127.0.0.1:8795';
const ROLE = env.ROLE ?? 'super';

const ACCOUNTS = {
  super: { email: 'test@test.local', password: 'test' },
  user: { email: 'noticetest@x.local', password: 'Passw0rd!x9' },
  ops: { email: 'opstest@x.local', password: 'Passw0rd!x9' },
};

/*
   ★ 계정은 환경마다 다르다.

     이 표는 개발자의 로컬 계정을 담고 있어서, 새로 만든 데이터베이스
     (`pnpm --filter @quantumtrade/api seed:dev` 로 시드한 것)에서는 로그인이
     실패한다. 그러면 도구가 "로그인 실패" 로 즉시 끝나고 **버튼을 하나도
     눌러보지 못한다** — 검증을 못 했는데 검증한 것처럼 넘어가기 쉬운 지점이다.

     그래서 EMAIL/PASSWORD 로 덮어쓸 수 있게 한다. 시드 계정 예:
       EMAIL=admin@qt.local PASSWORD=adminpass1234 node tools/button-probe.mjs
*/
if (env.EMAIL && env.PASSWORD) {
  ACCOUNTS[ROLE] = { email: env.EMAIL, password: env.PASSWORD };
}

const ALL_ROUTES = [
  // 아직 버튼을 눌러보지 않은 화면을 앞에 둔다.
  '/analytics', '/ai-strategies', '/ai-strategies/my',
  '/admin/design-ops', '/admin/ai-ops', '/admin/broadcast', '/admin/system',
  '/admin/risk', '/admin/assets', '/admin/fees', '/admin/trades',
  '/admin/users', '/admin/audit', '/admin/notices',
  // 이미 점검한 화면도 회귀 확인용으로 포함한다.
  '/markets', '/portfolio', '/wallet', '/wallet/transactions',
  '/points', '/referral', '/fees', '/help', '/settings',
  '/notifications', '/order-history', '/admin', '/admin/points', '/admin/legal',
];

const ROUTES = env.ROUTES ? env.ROUTES.split(',').map((s) => s.trim()) : ALL_ROUTES;

/*
   누르지 않을 버튼.

   ★ 로그아웃·삭제·게시처럼 되돌릴 수 없거나 세션을 끊는 것은 제외한다.
     세션이 끊기면 그 뒤 검사가 전부 무의미해지고, 게시는 취소할 수 없다.
*/
const SKIP_LABEL = /로그아웃|logout|sign\s?out|signed\s?in|로그인됨|삭제|delete|remove|게시|publish|정지|suspend|초기화|reset|취소|cancel|전량|close all|킬\s?스위치|kill/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
const page = await ctx.newPage();

const consoleErrors = [];
const requests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + (e.message || '').slice(0, 150)));
page.on('request', (r) => requests.push(r.url()));

// ---- 로그인 ----

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

const loggedIn = await page.evaluate(() => Boolean(window.QTAuth?.isLoggedIn?.()));
if (!loggedIn) {
  console.error(`로그인 실패 (${who.email}) — 계정을 확인하세요.`);
  await browser.close();
  exit(1);
}
console.log(`탐사 시작 — ${BASE} · 등급 ${ROLE}\n`);

// ---- 탐사 ----

let sessionLostBy = null;   // 세션을 끊은 버튼 (있으면 이후 결과는 무효)
const dead = [];      // 반응 없는 버튼
/*
   ★★ 화면이 비어 버린 라우트.

     실제로 겪었다: 훅을 조건부로 호출해 React 가 렌더를 중단했고, 모든 화면에
     버튼이 1개만 남았다. 그런데 "오류 0 · 무반응 0" 으로 **통과**했다 —
     누를 버튼이 없으면 실패할 것도 없기 때문이다.
     원인이 무엇이든(훅·예외·라우팅) 화면이 비면 여기서 잡는다.
*/
const emptyRoutes = [];
const MIN_BUTTONS = 3;   // 상단바·사이드바만 있어도 이보다 많다
const broken = [];    // 누르면 오류가 나는 버튼
const okCount = { pressed: 0, reacted: 0 };

/** 화면 상태 지문. 버튼을 누른 전후를 비교한다. */
const snapshot = () => page.evaluate(() => ({
  len: document.body.innerText.length,
  hash: location.hash,
  modal: document.querySelectorAll('[class*="modal"],[role="dialog"],.overlay').length,
  toast: document.querySelectorAll('[class*="toast"],[class*="notif-pop"]').length,
  inputs: [...document.querySelectorAll('input,select,textarea')].map((e) => String(e.value ?? '')).join('|').length,
  aria: [...document.querySelectorAll('[aria-expanded],[aria-selected],[aria-checked]')]
    .map((e) => e.getAttribute('aria-expanded') + e.getAttribute('aria-selected') + e.getAttribute('aria-checked')).join(','),
  /*
     ★★ 활성 요소는 **개수가 아니라 무엇이 활성인지**를 본다.

       전에는 `.is-active` 의 개수만 셌다. 그래서 필터 탭을 옮겨도 활성 개수는
       그대로 1개이므로 지문이 변하지 않았다. 같은 이유로 `len`(본문 길이)도
       결과가 1행 → 다른 1행이면 길이가 같아 구분되지 않는다.

       실측: /markets 에서 Gainers→Losers→Favorites→All 을 실제로 누르면
       표가 21행↔1행으로 바뀌고 활성 탭도 매번 바뀌는데, 이 도구는 5개 버튼을
       "무반응" 으로 보고했다. 정상 동작하는 필터를 결함으로 지목한 것이다.

       오탐은 단순한 잡음이 아니다 — 그 목록을 믿고 고치려다 정상 코드를
       건드리게 된다. 그래서 **무엇이** 활성인지와 표 내용의 서명을 함께 본다.
  */
  active: [...document.querySelectorAll('.is-active,[class*="--active"],[class*="is-selected"]')]
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20)).join(','),
  /*
     표 서명 — 필터·정렬·검색의 결과는 대부분 표의 행에 나타난다.
     행 수와 첫 행·마지막 행의 내용을 같이 본다(행 수가 같아도 정렬이 바뀌면
     첫 행이 달라진다).
  */
  rows: (() => {
    const tr = [...document.querySelectorAll('tbody tr')];
    const sig = (el) => ((el && el.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return `${tr.length}|${sig(tr[0])}|${sig(tr[tr.length - 1])}`;
  })(),
  /*
     ★ 테마·거래모드·밀도는 DOM 길이를 바꾸지 않는다.

       그래서 지문에 없으면 "테마 전환"·"모의 모드로 전환" 이 무반응으로
       잡혔다. 실제로는 정상 동작한다(data-theme 이 dark→light,
       QTMode 가 futures→paper 로 바뀌는 것을 확인했다).

       이런 전역 상태를 빠뜨리면 잘못된 결함 목록이 만들어지고, 그 목록을 믿고
       고치려다 정상 코드를 건드린다.
  */
  theme: document.documentElement.getAttribute('data-theme') || '',
  density: document.documentElement.getAttribute('data-density') || '',
  lang: (window.QTI18n && window.QTI18n.getLocale) ? window.QTI18n.getLocale() : '',
  tradeMode: (window.QTMode && window.QTMode.get) ? window.QTMode.get() : '',
  // 사이드바 접힘·고정 같은 저장 상태도 화면 길이를 바꾸지 않을 수 있다.
  navPrefs: (() => {
    try { return String(localStorage.getItem('qt.nav') || ''); } catch (e) { return ''; }
  })(),
}));

const same = (a, b) =>
  a.len === b.len && a.hash === b.hash && a.modal === b.modal && a.toast === b.toast &&
  a.inputs === b.inputs && a.aria === b.aria && a.active === b.active && a.rows === b.rows &&
  a.theme === b.theme && a.density === b.density && a.lang === b.lang &&
  a.tradeMode === b.tradeMode && a.navPrefs === b.navPrefs;

for (const route of ROUTES) {
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
  // 차트가 있는 화면은 더 기다린다 — 렌더 전에 누르면 버튼이 없다.
  await page.waitForTimeout(/trade/.test(route) ? 9000 : 4000);

  const buttons = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button,[role="button"]').forEach((e, i) => {
      if (!e.offsetParent || e.disabled) return;
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      // 화면 밖(스크롤 필요)은 건너뛴다 — 클릭이 엉뚱한 곳에 닿는다.
      if (b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight) return;
      const label = (e.getAttribute('title') || e.getAttribute('aria-label') || e.innerText || '')
        .replace(/\s+/g, ' ').trim();
      out.push({ idx: i, label: label.slice(0, 40) || '(라벨 없음)' });
    });
    return out;
  });

  let routeDead = 0;
  let routeBroken = 0;

  /*
     같은 라벨은 한 번만 누른다.

     라벨로 찾으므로 중복이 있으면 항상 첫 번째만 눌리게 된다. 같은 것을 여러 번
     누르며 시간을 쓸 이유가 없다.
  */
  const seen = new Set();

  for (const btn of buttons) {
    if (SKIP_LABEL.test(btn.label)) continue;
    if (seen.has(btn.label)) continue;
    seen.add(btn.label);

    const before = await snapshot();
    const reqBefore = requests.length;
    const errBefore = consoleErrors.length;

    /*
       ★ 라벨로 찾는다 — 인덱스로 찾으면 안 된다.

         버튼을 누르면 DOM 이 바뀌어 인덱스가 밀린다. 그러면 다음 회차에서
         엉뚱한 버튼(또는 라우트를 벗어나는 링크)을 누르고, 그 뒤 검사가 전부
         무의미해진다. 실제로 그랬다: 관리자 화면 7개가 "버튼 1개" 로 보고됐는데
         실제로는 81개였다 — 첫 클릭에서 화면을 벗어난 것이다.
    */
    const clicked = await page.evaluate((label) => {
      const el = [...document.querySelectorAll('button,[role="button"]')].find((e) => {
        if (!e.offsetParent || e.disabled) return false;
        const t = (e.getAttribute('title') || e.getAttribute('aria-label') || e.innerText || '')
          .replace(/\s+/g, ' ').trim().slice(0, 40);
        return t === label;
      });
      if (!el) return false;
      el.click();
      return true;
    }, btn.label);
    if (!clicked) continue;

    okCount.pressed += 1;
    await page.waitForTimeout(900);

    /*
       ★★ 세션이 끊겼는지 매 클릭마다 확인한다.

         SKIP_LABEL 로 로그아웃 버튼을 제외했는데도 세션이 끊긴 적이 있다
         (그 뒤 라우트가 전부 "버튼 0개" 로 나와 원인 찾기가 어려웠다).
         어느 버튼이 끊었는지 즉시 알아야 제외 목록에 추가할 수 있다.
    */
    const stillLoggedIn = await page.evaluate(
      () => !window.QTAuth || !window.QTAuth.isLoggedIn || window.QTAuth.isLoggedIn(),
    );
    if (!stillLoggedIn) {
      console.log(`\n  ★★ 세션이 끊겼습니다 — "${btn.label}" (${route}) 클릭 직후`);
      console.log('     이 버튼을 SKIP_LABEL 에 추가하거나, 다시 로그인해야 이후 검사가 유효합니다.');
      sessionLostBy = { route, label: btn.label };
    }

    const after = await snapshot();
    const newReqs = requests.length - reqBefore;
    const newErrs = consoleErrors.slice(errBefore);

    if (newErrs.length) {
      routeBroken += 1;
      broken.push({ route, label: btn.label, error: newErrs[0] });
    } else if (same(before, after) && newReqs === 0) {
      routeDead += 1;
      dead.push({ route, label: btn.label });
    } else {
      okCount.reacted += 1;
    }

    // 모달이 열렸으면 닫는다 — 다음 버튼을 가린다.
    await page.evaluate(() => {
      const close = document.querySelector('.modal button[class*="icon"], [role="dialog"] button[class*="close"]');
      if (close) close.click();
      else if (document.querySelector('.overlay')) document.querySelector('.overlay').click();
    });
    await page.waitForTimeout(350);

    /*
       ★ 라우트를 벗어났으면 되돌아온다.

         링크형 버튼이나 모드 전환이 화면을 옮길 수 있다. 그대로 두면 남은
         버튼들을 **다른 화면에서** 누르게 되고, 결과가 그 화면 것으로 잘못
         집계된다.
    */
    const nowHash = await page.evaluate(() => location.hash);
    if (nowHash !== `#${route}`) {
      await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(/trade/.test(route) ? 6000 : 2500);
    }
  }

  if (buttons.length < MIN_BUTTONS) {
    /*
       ★ 빈 화면일 때는 **그 시점의 콘솔 오류와 본문 일부를 함께 남긴다.**
         개수만 알려주면 원인을 찾으려고 처음부터 다시 재현해야 한다
         (실제로 그렇게 시간을 썼다 — 단독 실행에서는 재현되지 않았다).
    */
    const diag = await page.evaluate(() => ({
      len: document.body.innerText.length,
      head: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 90),
      hash: location.hash,
    }));
    emptyRoutes.push({
      route,
      count: buttons.length,
      len: diag.len,
      head: diag.head,
      hash: diag.hash,
      errors: consoleErrors.slice(-3),
    });
  }

  const mark = buttons.length < MIN_BUTTONS ? '✗' : routeBroken ? '✗' : routeDead ? '△' : '✓';
  console.log(`  ${mark} ${route.padEnd(24)} 버튼 ${String(buttons.length).padStart(3)}개 · 무반응 ${routeDead} · 오류 ${routeBroken}`);
}

// ---- 결과 ----

console.log('\n' + '─'.repeat(74));
console.log(`누른 버튼 ${okCount.pressed}개 · 반응 ${okCount.reacted}개 · 무반응 ${dead.length}개 · 오류 ${broken.length}개`);
console.log('─'.repeat(74));

if (broken.length) {
  console.log('\n■ 누르면 오류가 나는 버튼 — 기능이 깨져 있다\n');
  broken.forEach((b) => {
    console.log(`  · ${b.route} — ${b.label}`);
    console.log(`    ${b.error}`);
  });
}

if (dead.length) {
  console.log('\n□ 반응 없는 버튼 (후보) — 사람이 확인해야 한다\n');
  const byRoute = {};
  dead.forEach((d) => { (byRoute[d.route] = byRoute[d.route] || []).push(d.label); });
  Object.keys(byRoute).forEach((r) => {
    console.log(`  ${r}`);
    byRoute[r].forEach((l) => console.log(`    · ${l}`));
  });
  console.log('\n  ★ 이미 켜진 토글·같은 값 정렬·빈 목록 새로고침은 변화가 없을 수 있다.');
  console.log('    목록을 좁혀주는 것이 목적이며, 전부 결함이라는 뜻은 아니다.');
}

await browser.close();
// 오류가 있으면 실패로 알린다. 무반응은 후보이므로 실패로 세지 않는다.
if (emptyRoutes.length > 0) {
  console.log(`\n★ 화면이 비어 있는 라우트 ${emptyRoutes.length}개 (버튼 ${MIN_BUTTONS}개 미만)`);
  for (const e of emptyRoutes) {
    console.log(`  · ${e.route} — 버튼 ${e.count}개 · 본문 ${e.len}자 · hash=${e.hash}`);
    if (e.head) console.log(`      본문: ${e.head}`);
    if (e.errors && e.errors.length > 0) e.errors.forEach((x) => console.log(`      ! ${x}`));
  }
  console.log('  렌더가 중단됐을 수 있다. 브라우저 콘솔의 React 오류를 확인하십시오.');
  console.log('  ("Rendered more hooks than during the previous render" 를 실제로 겪었다.)');
}

/*
   ★ 세션이 끊긴 뒤의 결과는 신뢰할 수 없다.
     전에는 어느 버튼이 세션을 끊었는지 기록만 하고 아무 곳에서도 쓰지 않았다 —
     그래서 로그아웃 이후의 '무반응' 이 진짜 결함인지 세션 탓인지 알 수 없었다.
*/
if (sessionLostBy) {
  console.log('');
  console.log(`★ 세션이 끊겼다 — ${sessionLostBy.route} 의 "${sessionLostBy.label}" 를 누른 뒤.`);
  console.log('  그 뒤의 결과는 신뢰할 수 없다. 그 버튼을 제외하고 다시 돌려 확인할 것.');
}

exit(broken.length || emptyRoutes.length ? 1 : 0);
