#!/usr/bin/env node
/*
  layout-clip-check — 조상이 잘라내는(clip) 조작 요소를 모든 화면에서 찾는다.

  ────────────────────────────────────────────────────────────────────────
  왜 필요한가

  ★★ 실제로 놓친 결함 (2026-08, 사장님이 발견):

     AI 코파일럿을 접으면 2칸(109px) 띠가 된다. 그런데 헤더 제목이 150px 를
     차지해서 **펼치기 버튼이 패널 밖(x=1203, 패널은 1028~1137)으로 밀려났고**,
     패널이 `overflow: hidden` 이라 잘려서 보이지 않았다.

     → 접은 뒤 다시 펼칠 방법이 화면에 없었다.

     그런데 기존 도구는 전부 통과했다:

       · button_probe    → 요소가 DOM 에 있고 rect 가 0 이 아니면 누른다.
                           **조상이 잘라내는지는 보지 않는다.** 프로그램으로
                           클릭하면 화면에 안 보여도 눌린다 — 그래서 "반응 있음"
                           으로 통과했다.
       · mobile-clip-check → 모바일 폭(375~430)만 본다. 데스크톱을 안 본다.
       · mobile_full     → `document.scrollWidth > clientWidth` 로 본다.
                           조상이 overflow:hidden 이면 문서 스크롤이 생기지 않아
                           통과한다.

  ★ 즉 "화면에 보이지 않는 버튼" 을 아무도 검사하지 않고 있었다.

  ────────────────────────────────────────────────────────────────────────
  무엇을 검사하나 (조작 요소 = button, a, input, select, textarea, [role=button])

    CLIPPED    조상 중 overflow:hidden|clip 인 것의 경계를 요소가 넘어간다.
               → 화면에 잘려 보이거나 아예 안 보인다. **누를 수 없다.**

    OFFSCREEN  뷰포트 밖에 있고, 스크롤로 닿을 수 없다.

    ZERO       크기가 0 인데 display 는 보이는 상태. 마크업은 있고 화면엔 없다.

    OVERLAP    다른 조작 요소에 완전히 덮여 있다. 위에 있는 것만 눌린다.

  ★ 오탐을 줄이는 규칙
    · overflow:auto|scroll 은 **잘라내는 것이 아니다** — 스크롤하면 닿는다.
    · display:none / visibility:hidden / opacity:0 은 의도적 숨김으로 본다.
    · 접힌 사이드바처럼 폭 0 인 컨테이너 안의 요소는 ZERO 로 세지 않는다.

  사용법
    cd /tmp/qt_verify && node "<repo>/tools/layout-clip-check.mjs"
    BASE=http://127.0.0.1:8795  ROLE=super|user  WIDTH=1600  HEIGHT=1000
    ROUTES=/trade,/wallet       (기본: 주요 화면 전체)
  ────────────────────────────────────────────────────────────────────────
*/

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* playwright 는 이 저장소의 의존성이 아니다(브라우저 바이너리가 크다). */
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
const ROLE = process.env.ROLE || 'super';
const WIDTH = Number(process.env.WIDTH || 1600);
const HEIGHT = Number(process.env.HEIGHT || 1000);

const ACCOUNTS = {
  super: { email: 'test@test.local', password: 'test' },
  user: { email: 'customer@test.local', password: 'test' },
};
/*
   ★ 계정은 환경마다 다르다.

     이 표는 개발자의 로컬 계정이라, 새로 시드한 데이터베이스에서는 로그인이
     실패한다. 그러면 이 도구가 "로그인 실패" 로 즉시 끝나고 **한 화면도
     검사하지 못한다** — 검증을 못 했는데도 넘어가기 쉬운 지점이다(실제로 겪었다).

     시드 계정 예:
       EMAIL=admin@qt.local PASSWORD=adminpass1234 node tools/layout-clip-check.mjs
*/
if (process.env.EMAIL && process.env.PASSWORD) {
  ACCOUNTS[ROLE] = { email: process.env.EMAIL, password: process.env.PASSWORD };
}
const who = ACCOUNTS[ROLE] || ACCOUNTS.super;

const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : [
  '/trade', '/markets', '/portfolio', '/wallet', '/wallet/transactions',
  '/order-history', '/analytics', '/notifications', '/referral', '/points',
  '/fees', '/help', '/settings', '/ai-strategies',
  '/admin', '/admin/users', '/admin/trades', '/admin/audit', '/admin/notices',
  '/admin/system', '/admin/risk', '/admin/broadcast', '/admin/points',
  '/admin/legal', '/admin/fees', '/admin/assets',
];

/* ---------------- 브라우저 ---------------- */

let browser = await chromium.launch({
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
});
let ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
let page = await ctx.newPage();

const login = async (p) => {
  await p.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.fill('input[type=email]', who.email);
  await p.fill('input[type=password]', who.password);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
    if (b) b.click();
  });
  await p.waitForTimeout(4000);
};
await login(page);

const loggedIn = await page.evaluate(() => Boolean(window.QTAuth?.isLoggedIn?.()));
if (!loggedIn) {
  console.error(`로그인 실패 (${who.email}) — 계정을 확인하세요.`);
  await browser.close();
  process.exit(1);
}

console.log(`레이아웃 잘림 검사 — ${BASE} · ${WIDTH}×${HEIGHT} · 등급 ${ROLE}\n`);

/* ---------------- 브라우저에서 실행할 검사 ---------------- */

const SCAN = () => {
  const SEL = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"]';
  const out = [];

  /** 요소를 설명하는 짧은 이름. 결함을 사람이 찾을 수 있어야 한다. */
  const nameOf = (el) => {
    const t = (el.getAttribute('title') || el.getAttribute('aria-label')
      || el.getAttribute('placeholder') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return (t.slice(0, 44) || `<${el.tagName.toLowerCase()}${cls}>`);
  };

  /** 이 요소가 화면에 그려지는가(의도적 숨김 제외). */
  const isRendered = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (Number(s.opacity) === 0) return false;
      n = n.parentElement;
    }
    return true;
  };

  const els = [...document.querySelectorAll(SEL)];

  for (const el of els) {
    if (!isRendered(el)) continue;
    const r = el.getBoundingClientRect();

    /* ZERO — 마크업은 있고 화면엔 없다. */
    if (r.width < 1 || r.height < 1) {
      /*
         ★ 조상이 폭 0 이면(접힌 서랍 등) 자식이 0 인 것은 당연하다 — 세지 않는다.
      */
      let collapsedAncestor = false;
      let p = el.parentElement;
      while (p && p !== document.documentElement) {
        const pr = p.getBoundingClientRect();
        if (pr.width < 1 || pr.height < 1) { collapsedAncestor = true; break; }
        p = p.parentElement;
      }
      if (!collapsedAncestor) out.push({ kind: 'ZERO', name: nameOf(el), detail: '크기 0' });
      continue;
    }

    /*
       ★★ 화면 밖으로 밀어 숨긴 것은 잘림이 아니다.

         모바일에서 사이드바·서랍은 `transform: translateX(-100%)` 같은 방식으로
         화면 왼쪽 밖에 대기시킨다. 열면 들어온다. 이것을 잘림으로 세면
         /settings 한 화면에서 27건이 나오고(실측), 전체 100건이 넘어 목록이
         쓸모없어진다.

       ★ 판정: 요소가 **완전히** 뷰포트 왼쪽/위 밖에 있으면 '대기 중' 으로 본다.
         걸쳐 있는 것(일부만 잘림)은 진짜 결함이므로 계속 검사한다.
    */
    if (r.right <= 0 || r.bottom <= 0) continue;

    /* CLIPPED — 조상의 overflow:hidden|clip 경계를 넘어간다. */
    let clippedBy = null;
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);

      /*
         ★★ 스크롤되는 조상을 먼저 만나면 **거기서 멈춘다.**

           그 안쪽에서 요소가 보이는 영역을 벗어나 있어도 스크롤하면 닿는다 —
           잘린 것이 아니다.

           이 규칙이 없어서 사이드바 메뉴 20여 개가 전부 CLIPPED 로 나왔다
           (실측: .app-sidebar-v2 안에 스크롤 컨테이너가 있는데, 그 위의
           overflow:hidden 경계를 기준으로 재고 있었다). 오탐이 많으면 목록을
           믿지 않게 되고, 그러면 진짜 결함도 함께 묻힌다.
      */
      const scrollsX = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
      const scrollsY = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
      if (scrollsX || scrollsY) break;

      /*
         ★★ overflow:hidden 이어도 **내용이 넘치지 않으면** 자르지 않는다.

           실측: `.section-card` 가 overflow-y:hidden 이지만 scrollHeight ==
           clientHeight 였다. 상자 자체가 내용만큼 늘어나 있어 아무것도 잘리지
           않는데, 그 상자가 뷰포트 아래로 내려가 있으면(문서는 스크롤된다)
           "잘렸다" 고 보고했다 — 768px 에서 46건이 그랬다.

           자르는지 판정할 때는 상자의 **넘침 여부**를 함께 봐야 한다.
      */
      const overflowsX = n.scrollWidth > n.clientWidth + 1;
      const overflowsY = n.scrollHeight > n.clientHeight + 1;

      /*
         ★★ 문서 전체가 스크롤되면 잘린 것이 아니다.

           실측(768px /markets): 감싸개 div 가 overflow:hidden 이고
           sh=1858 ch=774 로 넘치지만, `.page-shell` 이 모바일 규칙에서
           overflow:visible 이 되어 **내용이 문서 높이를 늘린다.** 그래서
           페이지를 스크롤하면 아래 행에 닿는다 — 42건이 전부 오탐이었다.

           `clientHeight` 는 뷰포트에 보이는 만큼만이라, 자식이 넘치는 것처럼
           보이지만 실제로는 부모가 커져 문서가 스크롤된다.
      */
      const docScrollsY = document.documentElement.scrollHeight > innerHeight + 1;
      const docScrollsX = document.documentElement.scrollWidth > innerWidth + 1;
      const hidesX = /^(hidden|clip)$/.test(s.overflowX) && overflowsX && !docScrollsX;
      const hidesY = /^(hidden|clip)$/.test(s.overflowY) && overflowsY && !docScrollsY;
      if (hidesX || hidesY) {
        const nr = n.getBoundingClientRect();
        /* 2px 여유 — 테두리·반올림으로 생기는 오탐을 막는다. */
        const outX = hidesX && (r.left < nr.left - 2 || r.right > nr.right + 2);
        const outY = hidesY && (r.top < nr.top - 2 || r.bottom > nr.bottom + 2);
        if (outX || outY) {
          /*
             ★ 위반한 축의 좌표를 보여준다.

               전에는 축이 y 여도 x 좌표를 찍었다. 그러면 "요소 1384~1506 /
               상자 1371~1594" 처럼 **포함 관계로 보여서** 오탐으로 오해하고
               진짜 결함을 넘긴다. 보고가 틀리면 도구가 없는 것보다 나쁘다.
          */
          const axis = outX ? (outY ? 'x,y' : 'x') : 'y';
          const span = (a, b) => `${Math.round(a)}~${Math.round(b)}`;
          clippedBy = {
            by: (n.className && typeof n.className === 'string'
              ? '.' + n.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
              : n.tagName.toLowerCase()),
            axis,
            el: outX ? span(r.left, r.right) : span(r.top, r.bottom),
            box: outX ? span(nr.left, nr.right) : span(nr.top, nr.bottom),
            /* 진단: 상자가 실제로 넘치는가 · 무엇인가 */
            dbg: `${n.tagName}.${String(n.className || '').slice(0, 20)} ovY=${n.scrollHeight > n.clientHeight + 1} sh=${n.scrollHeight} ch=${n.clientHeight}`,
            /* 얼마나 삐져나갔는가 — 1~2px 은 실무상 무해하다. */
            over: Math.round(Math.max(
              outX ? Math.max(nr.left - r.left, r.right - nr.right) : 0,
              outY ? Math.max(nr.top - r.top, r.bottom - nr.bottom) : 0,
            )),
          };
          break;
        }
      }
      n = n.parentElement;
    }
    if (clippedBy) {
      /*
         ★★ 마지막 확인: **스크롤해서 실제로 보이게 되는가.**

           추론(조상 overflow·문서 스크롤 여부)만으로는 계속 오탐이 나왔다.
           768px 에서 42건이 전부 "스크롤하면 닿는" 요소였다. 판정 규칙을
           덧붙이는 대신 **직접 해 본다** — scrollIntoView 한 뒤 뷰포트 안에
           들어오면 잘린 것이 아니다.

         ★ 스크롤 위치를 되돌린다. 다음 요소 측정이 흐트러지면 새 오탐이 생긴다.
      */
      const sx = window.scrollX;
      const sy = window.scrollY;
      const prevScrollTops = [];
      let sp = el.parentElement;
      while (sp && sp !== document.documentElement) {
        if (sp.scrollTop || sp.scrollLeft) prevScrollTops.push([sp, sp.scrollTop, sp.scrollLeft]);
        sp = sp.parentElement;
      }
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const after = el.getBoundingClientRect();
      const reachable = after.width > 0 && after.height > 0
        && after.bottom > 0 && after.right > 0
        && after.top < innerHeight && after.left < innerWidth;
      /* 원위치 */
      for (const [node, t, l] of prevScrollTops) { node.scrollTop = t; node.scrollLeft = l; }
      window.scrollTo(sx, sy);
      if (reachable) continue;

      out.push({
        kind: 'CLIPPED', name: nameOf(el),
        detail: `${clippedBy.by} 가 ${clippedBy.axis} 축에서 ${clippedBy.over}px 자름 · 요소 ${clippedBy.el} / 상자 ${clippedBy.box} · ${clippedBy.dbg}`,
        over: clippedBy.over,
      });
      continue;
    }

    /* OFFSCREEN — 뷰포트 밖. 스크롤로 닿을 수 있으면 넘어간다. */
    const outOfView = r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight;
    if (outOfView) {
      let scrollable = false;
      let m = el.parentElement;
      while (m && m !== document.documentElement) {
        const s = getComputedStyle(m);
        if (/(auto|scroll)/.test(s.overflowX) && m.scrollWidth > m.clientWidth + 1) { scrollable = true; break; }
        if (/(auto|scroll)/.test(s.overflowY) && m.scrollHeight > m.clientHeight + 1) { scrollable = true; break; }
        m = m.parentElement;
      }
      const docScrolls = document.documentElement.scrollHeight > innerHeight + 1
        || document.documentElement.scrollWidth > innerWidth + 1;
      if (!scrollable && !docScrolls) {
        out.push({
          kind: 'OFFSCREEN', name: nameOf(el),
          detail: `x ${Math.round(r.left)}~${Math.round(r.right)} · y ${Math.round(r.top)}~${Math.round(r.bottom)} (창 ${innerWidth}×${innerHeight})`,
        });
      }
      continue;
    }

    /*
       OVERLAP — 요소 중심점에서 실제로 잡히는 것이 자기(또는 자손)가 아니다.
       ★ 다른 조작 요소가 덮고 있으면 눌러도 그쪽이 눌린다.
    */
    /*
       ★ 비활성 요소는 덮여 있어도 기능 문제가 아니다 — 눌릴 수 없다.
         잘림(CLIPPED)은 보기에 깨지므로 비활성도 검사하지만, 겹침은 제외한다.
    */
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') continue;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const hitIsInteractive = hit.closest(SEL);
        /*
           ★ 겹침은 두 요소의 사각형이 실제로 교차할 때만 문제다.

             elementFromPoint 만 믿으면, 스크롤 컨테이너 안에서 좌표가 어긋나
             교차하지 않는 요소가 잡힌다(실측: /markets 에서 y=607 버튼이
             y=925 배지에 덮였다고 나왔다 — 300px 떨어져 있다).
        */
        /*
           ★★ 클릭을 통과시키는 것에 덮여도 눌리는 데 문제가 없다.

             `pointer-events: none` 인 조상 안의 버튼(예: 미개발 표시 배지)은
             화면을 가리지만 클릭은 아래로 지나간다. 실측으로 확인했다 —
             /markets 표 마지막 행의 'Trade' 링크가 배지에 가려졌다고 나왔지만
             실제로는 눌린다.

           ★ 그래도 **시각적으로 가리는 것**은 사실이므로, 겹침이 아니라
             '가림(COVERED)' 으로 따로 표시한다. 기능 결함과 보기 문제를
             같은 이름으로 묶으면 우선순위를 정할 수 없다.
        */
        let passesClicks = false;
        {
          let n2 = hitIsInteractive;
          while (n2 && n2 !== document.documentElement) {
            if (getComputedStyle(n2).pointerEvents === 'none') { passesClicks = true; break; }
            n2 = n2.parentElement;
          }
        }
        const hr = hitIsInteractive ? hitIsInteractive.getBoundingClientRect() : null;
        const intersects = hr && !(hr.right <= r.left || hr.left >= r.right
          || hr.bottom <= r.top || hr.top >= r.bottom);
        if (hitIsInteractive && hitIsInteractive !== el && intersects) {
          out.push({
            kind: passesClicks ? 'COVERED' : 'OVERLAP', name: nameOf(el),
            detail: `가운데가 다른 조작 요소에 덮임 → ${nameOf(hitIsInteractive)}`
              + ` · 요소 ${el.tagName}@${Math.round(r.left)},${Math.round(r.top)}`
              + ` ${Math.round(r.width)}×${Math.round(r.height)}`
              + ` / 덮는 것 ${hitIsInteractive.tagName}@${Math.round(hr.left)},${Math.round(hr.top)}`
              + ` ${Math.round(hr.width)}×${Math.round(hr.height)}`,
          });
        }
      }
    }
  }

  return out;
};

/* ---------------- 실행 ---------------- */

const findings = new Map();   // route -> issues[]
const aborted = [];
const relaunched = [];
let total = 0;

for (const route of ROUTES) {
  /*
     ★ 브라우저가 죽으면 되살린다. 죽은 채로 계속하면 나머지 화면을 검사하지
       못하는데 로그는 "문제 없음" 처럼 보인다.
  */
  if (!browser.isConnected()) {
    try {
      relaunched.push(route);
      browser = await chromium.launch({
        args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
      });
      ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
      page = await ctx.newPage();
      await login(page);
    } catch {
      aborted.push(route);
      continue;
    }
  }

  try {
    /* 쿼리를 붙여 문서를 새로 읽게 한다 — 해시만 바꾸면 React 상태가 남는다. */
    await page.goto(`${BASE}/index.html#${route}?clip=${Date.now()}`, {
      waitUntil: 'networkidle', timeout: 60000,
    });
    /* 차트가 있는 화면은 더 기다린다 — 렌더 전에 재면 요소가 없다. */
    await page.waitForTimeout(/trade/.test(route) ? 10000 : 4500);

    /*
       ★★ 두 번 재고 **두 번 다 걸린 것만** 문제로 본다.

         첫 측정에서만 잡히는 겹침이 있었다(실측: /markets 의 'Trade' 버튼이
         관리자 오버레이 배지에 덮였다고 나왔으나, 같은 조건을 손으로 재현하면
         0건이었다). 늦게 도착한 데이터로 표가 다시 그려지는 순간을 잡은 것이다.

         일시적 상태를 결함으로 보고하면 목록을 믿지 않게 되고, 그러면 진짜
         결함도 함께 묻힌다.
    */
    if (process.env.CLIP_DEBUG) {
      const d = await page.evaluate(() => {
        const wrap = [...document.querySelectorAll('div')].find((e) => (e.getAttribute('style') || '').includes('grid-column: 1 / -1'));
        const shell = document.querySelector('.page-shell');
        return {
          cut: wrap ? wrap.scrollHeight - wrap.clientHeight : null,
          shellOv: shell ? getComputedStyle(shell).overflowY : null,
          w: innerWidth, h: innerHeight,
        };
      });
      console.error(`    [clip] ${route} 감싸개잘림=${d.cut} shell=${d.shellOv} 창=${d.w}x${d.h}`);
    }
    const first = await page.evaluate(SCAN);
    /*
       ★ 간격을 넉넉히 둔다. 시세·표가 늦게 도착해 다시 그려지는 동안 재면
         한쪽 측정에만 겹침이 잡힌다. 두 측정 사이에 렌더가 안정될 시간을 준다.
    */
    await page.waitForTimeout(3500);

    const second = await page.evaluate(SCAN);
    /* 두 측정에 모두 있는 것만 남긴다. 같은 요소·같은 종류를 열쇠로 쓴다. */
    const keyOf = (i) => `${i.kind}\u0000${i.name}`;
    const firstKeys = new Set(first.map(keyOf));
    const issues = second.filter((i) => firstKeys.has(keyOf(i)));
    total += 1;
    if (issues.length > 0) findings.set(route, issues);
    const mark = issues.length === 0 ? '✓' : '△';
    console.log(`  ${mark} ${route.padEnd(24)} 문제 ${issues.length}`);
  } catch (e) {
    aborted.push(route);
    console.log(`  ! ${route.padEnd(24)} 검사 실패: ${String(e.message || e).slice(0, 60)}`);
  }
}

if (browser.isConnected()) await browser.close();

/* ---------------- 보고 ---------------- */

console.log('\n' + '─'.repeat(74));
let count = 0;
for (const [route, issues] of findings) {
  console.log(`\n  ${route}`);
  for (const i of issues) {
    count += 1;
    console.log(`    [${i.kind}] ${i.name}`);
    console.log(`             ${i.detail}`);
  }
}
console.log('\n' + '─'.repeat(74));
console.log(`${total}개 화면 검사 · 문제 ${count}개`);
if (relaunched.length > 0) console.log(`ⓘ 브라우저를 ${relaunched.length}회 되살렸습니다.`);

if (aborted.length > 0) {
  console.log(`\n★ ${aborted.length}개 화면을 검사하지 못했습니다: ${aborted.join(', ')}`);
  process.exit(1);
}
process.exit(count > 0 ? 1 : 0);
