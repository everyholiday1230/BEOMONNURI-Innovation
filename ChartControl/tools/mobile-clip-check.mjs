#!/usr/bin/env node
/*
  mobile-clip-check — 모바일에서 화면 밖으로 밀려난 조작 요소를 찾는다.

  왜 필요한가
  ----------
  ★★ 실제로 놓쳤던 결함: 390px 에서 헤더 실제 폭이 1134px 이었고, 버튼 16개 중
     11개(주 메뉴·알림·테마·언어·계정)가 화면 밖에 있었다. 그런데 기존 도구는
     전부 통과했다:

       · mobile_full.mjs → `document.scrollWidth > clientWidth` 로 판정한다.
         넘치는 요소의 조상이 `overflow-x: auto|hidden` 이면 문서 스크롤이
         생기지 않아 **통과해 버린다.**
       · hard_clip.mjs  → 1440·1920 만 본다. 모바일 폭을 아무도 검사하지 않았다.

  ★ 그래서 문서 스크롤이 아니라 **요소의 실제 좌표**를 본다. 조작 가능한
    요소(button/a/input/select)가 뷰포트 밖에 있고, 그것을 담은 스크롤 컨테이너에
    스크롤 단서(스크롤바 또는 페이드)가 없으면 사용자는 닿을 방법을 모른다.

  판정 기준
  --------
  1) 뷰포트 밖 (left >= innerWidth 또는 right <= 0)
  2) 조상 중 가로 스크롤 컨테이너가 있으면 → "스크롤로 닿을 수 있음"
     (경고로만. 단, 스크롤바가 숨겨져 있으면 단서 필요)
  3) 스크롤 컨테이너가 없으면 → 실패 (영구히 닿을 수 없다)

  사용법
  -----
    cd /tmp/qt_verify && node "<repo>/tools/mobile-clip-check.mjs"
    BASE=http://127.0.0.1:8795 ROLE=user node ... (기본 super)
*/
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/*
   ★ playwright 는 이 저장소의 의존성이 아니다(브라우저 바이너리가 크다).
     ESM import 는 스크립트 위치를 기준으로 해석하므로, 설치된 디렉터리에서
     실행해도 cwd 의 node_modules 를 보지 않는다. cwd 쪽을 먼저 시도한다.
   ★ playwright 는 CJS 라 file:// 로 직접 가리키면 named export 가 잡히지
     않는다. default 안도 본다.
*/
let chromium;
{
  const tried = [];
  for (const spec of [
    pathToFileURL(join(process.cwd(), 'node_modules', 'playwright', 'index.js')).href,
    'playwright',
  ]) {
    try {
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
        `    cd /tmp/qt_verify && node ${JSON.stringify(process.argv[1])}\n`,
    );
    process.exit(2);
  }
}

const BASE = process.env.BASE ?? 'http://127.0.0.1:8795';
const ROLE = process.env.ROLE ?? 'super';

const ACCOUNTS = {
  super: { email: 'test@test.local', password: 'test' },
  user: { email: 'customer@test.local', password: 'test' },
};

/* 실제 기기 폭. 가장 좁은 것(360)과 흔한 것(390), 태블릿 경계(768). */
const DEVICES = [
  { name: 'Galaxy S21', width: 360, height: 800 },
  { name: 'iPhone 14 Pro', width: 390, height: 844 },
  { name: 'iPad mini', width: 768, height: 1024 },
];

/* 로그인이 필요한 화면과 공개 화면을 섞어서 본다. */
const ROUTES = [
  '/', '/login', '/trade', '/markets', '/portfolio', '/wallet',
  '/points', '/referral', '/settings', '/help', '/order-history',
];

let failures = 0;
let warnings = 0;

const browser = await chromium.launch();

for (const dev of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
  });

  // 로그인 (실패해도 공개 라우트는 검사한다)
  const who = ACCOUNTS[ROLE] ?? ACCOUNTS.super;
  const lp = await ctx.newPage();
  try {
    await lp.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
    await lp.waitForTimeout(2500);
    await lp.fill('input[type=email]', who.email);
    await lp.fill('input[type=password]', who.password);
    await lp.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
      if (b) b.click();
    });
    await lp.waitForTimeout(4000);
  } catch {
    /* 로그인 실패는 치명적이지 않다 — 공개 라우트만 검사된다 */
  }
  await lp.close();

  const page = await ctx.newPage();
  const problems = [];

  for (const route of ROUTES) {
    await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(/trade/.test(route) ? 7000 : 3500);

    const found = await page.evaluate(() => {
      const out = [];
      const vw = window.innerWidth;

      /** 조상 중 가로로 스크롤되는 컨테이너를 찾는다. */
      const scrollParent = (el) => {
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return n;
          n = n.parentElement;
        }
        return null;
      };

      /*
         세로 방향 컨테이너인가.

         ★★ `.chart-drawtools` 는 `flex-direction: column` 이다. 세로로 넘치는
           것을 가로 기준으로 검사하면 "가로 스크롤 단서가 없다" 는 경고가 계속
           나온다 — 실제로는 세로 스크롤로 닿으므로 문제가 아니다.
           오탐이 남아 있으면 그 목록을 아무도 보지 않게 된다.
      */
      const isColumn = (el) => {
        const s = getComputedStyle(el);
        return s.display.includes('flex') && s.flexDirection.startsWith('column');
      };

      document.querySelectorAll('button, a, input, select, [role="button"]').forEach((el) => {
        if (!el.offsetParent) return; // 숨겨진 것은 대상이 아니다
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;

        /*
           ★★ 닫힌 서랍(오프캔버스) 안의 요소는 제외한다.

             서랍은 `transform: translateX(-100%)` 로 화면 밖에 두는 것이
             **정상 동작**이다. 토글 버튼을 누르면 들어온다. 이것을 결함으로
             세면 실패가 수십 건씩 나와 진짜 문제가 묻힌다(실제로 겪었다 —
             사이드바 메뉴 31개가 매 라우트마다 잡혔다).

           ★ 판정: 조상 중 transform 이 걸린 fixed/absolute 요소가 있으면
             오프캔버스로 본다. 그 조상이 화면 안으로 들어올 수 있는지는
             CSS 만으로 알 수 없으므로, 여기서는 세지 않고 넘어간다.
             (서랍 자체가 열리는지는 button-probe 가 클릭으로 확인한다)
        */
        let offcanvas = false;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.transform !== 'none' && /(fixed|absolute)/.test(s.position)) { offcanvas = true; break; }
          if (Number(s.opacity) === 0 || s.visibility === 'hidden') { offcanvas = true; break; }
        }
        if (offcanvas) return;

        // 세로로 벗어난 것은 페이지 스크롤로 닿는다 — 가로만 본다.
        const outside = b.left >= vw || b.right <= 0;
        if (!outside) return;

        const label = (el.getAttribute('title') || el.getAttribute('aria-label') || el.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 28);
        const sp = scrollParent(el);
        out.push({
          label: label || '(라벨 없음)',
          left: Math.round(b.left),
          /* 스크롤 컨테이너가 있으면 스크롤로 닿는다. 없으면 영구히 못 닿는다. */
          reachable: Boolean(sp),
          container: sp ? (sp.className || sp.tagName).toString().slice(0, 26) : null,
          /* 스크롤바를 숨겼는가 — 숨겼으면 사용자가 스크롤 가능함을 모른다.
             페이드(::after content) 같은 단서가 있으면 괜찮다.
             ★ 세로 방향 컨테이너는 가로 단서를 요구하지 않는다(오탐 방지). */
          hiddenBar: sp ? getComputedStyle(sp).scrollbarWidth === 'none' && !isColumn(sp) : false,
          hasFade: sp ? getComputedStyle(sp, '::after').content !== 'none' : false,
        });
      });
      return out;
    });

    if (found.length > 0) problems.push({ route, found });
  }

  // ---- 보고 ----
  console.log(`\n[${dev.name.padEnd(14)}] ${dev.width}×${dev.height}`);
  if (problems.length === 0) {
    console.log('  ✓ 화면 밖으로 밀려난 조작 요소 없음');
  } else {
    for (const p of problems) {
      const unreachable = p.found.filter((f) => !f.reachable);
      const noHint = p.found.filter((f) => f.reachable && f.hiddenBar && !f.hasFade);
      const ok = p.found.length - unreachable.length - noHint.length;

      if (unreachable.length > 0) {
        failures += 1;
        console.log(`  ✗ ${p.route} — 닿을 수 없는 요소 ${unreachable.length}개`);
        unreachable.slice(0, 5).forEach((f) => console.log(`      "${f.label}" left=${f.left} (스크롤 컨테이너 없음)`));
      }
      if (noHint.length > 0) {
        warnings += 1;
        console.log(`  ! ${p.route} — 스크롤로만 닿는데 단서가 없는 요소 ${noHint.length}개`);
        noHint.slice(0, 3).forEach((f) => console.log(`      "${f.label}" in .${f.container} (스크롤바 숨김 + 페이드 없음)`));
      }
      if (ok > 0) {
        console.log(`  · ${p.route} — ${ok}개는 스크롤로 닿고 단서가 있다 (정상)`);
      }
    }
  }

  await ctx.close();
}

await browser.close();

console.log(`\n${'─'.repeat(66)}`);
if (failures > 0) {
  console.log(`  실패 ${failures}건${warnings > 0 ? ` · 경고 ${warnings}건` : ''}`);
  console.log('  → 화면 밖에 있고 스크롤로도 닿을 수 없는 조작 요소가 있습니다.');
  process.exit(1);
}
console.log(warnings > 0 ? `  통과 · 경고 ${warnings}건` : '  통과');
