/**
 * IR 자료용 화면 캡처.
 *
 * 무엇을 만드는가
 * -------------
 * 투자 자료(피치덱)에 넣을 제품 화면을 실제 브라우저로 촬영한다. 슬라이드에
 * 넣으면 확대되므로 **2배 해상도**로 찍는다(1600×1000 → 3200×2000 픽셀).
 *
 * 왜 도구로 만드는가
 * ---------------
 * 손으로 찍으면 창 크기·테마·로그인 상태가 매번 달라져 덱 안에서 화면들이
 * 서로 안 맞는다. 그리고 덱을 고칠 때마다 다시 찍어야 한다. 같은 조건으로
 * 다시 찍을 수 있어야 한다.
 *
 * 쓰는 법
 *   BASE=http://127.0.0.1:8787 EMAIL=admin@qt.local PASSWORD=adminpass1234 \
 *     node tools/ir-screenshots.mjs
 *
 *   OUT=/tmp/shots          저장 폴더 (기본 docs/ir-screenshots)
 *   ROUTES=/trade,/markets  일부만 다시 찍기
 *   SCALE=2                 해상도 배수
 *   MOBILE=0                모바일 캡처 끄기
 *   CLEAN=1                 구현상태 배지·테두리를 끈 화면 (일반 고객이 보는 화면)
 *
 * ★ 기본값(CLEAN 미지정)은 화면에 보이는 것을 그대로 찍는다.
 *   투자자에게 보여줄 화면에서 상태 표시를 숨기면, 실사에서 실제 화면을 봤을 때
 *   다른 제품처럼 보인다. 어떤 배지가 찍혔는지는 실행 끝에 보고한다.
 *
 * ★ CLEAN=1 은 **숨김이 아니다.** 그 배지(LIVE/PARTIAL/MOCK)는 제품에서 원래
 *   관리자에게만 보이는 개발용 표시이며(provenance.js 의 등급 제한), 일반
 *   고객 화면에는 나오지 않는다. 즉 CLEAN 이 실제 고객이 보는 화면이다.
 *   다만 그 화면의 데이터가 목업인 사실은 그대로이므로, 덱에는 각주로 밝혀야 한다.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let chromium;
{
  const tried = [];
  for (const spec of [
    pathToFileURL(join(process.cwd(), 'node_modules', 'playwright', 'index.js')).href,
    'playwright',
  ]) {
    try {
      const mod = await import(spec);
      chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) break;
    } catch (e) {
      tried.push(`${spec}: ${e.message.slice(0, 60)}`);
    }
  }
  if (!chromium) {
    console.error('playwright 를 찾을 수 없습니다. 설치: pnpm add -w -D playwright@1.46.1');
    console.error(tried.join('\n'));
    process.exit(1);
  }
}

const env = process.env;
const BASE = env.BASE ?? 'http://127.0.0.1:8787';
const OUT = env.OUT ?? 'docs/ir-screenshots';
const SCALE = Number(env.SCALE ?? 2);
const WIDTH = Number(env.WIDTH ?? 1600);
const HEIGHT = Number(env.HEIGHT ?? 1000);
const WANT_MOBILE = env.MOBILE !== '0';

const EMAIL = env.EMAIL ?? 'admin@qt.local';
const PASSWORD = env.PASSWORD ?? 'adminpass1234';
const CLEAN = env.CLEAN === '1';

/*
   구현상태 표시를 끄는 초기 스크립트.

   ★ 페이지 스크립트보다 **먼저** 실행되어야 한다(addInitScript). provenance.js
     는 로드 시점에 localStorage 를 한 번 읽으므로, 그 뒤에 값을 넣으면 이미
     배지를 그린 상태다.
*/
const CLEAN_INIT = `try {
  localStorage.setItem('qt.provenance', JSON.stringify({ enabled: false, mode: 'badge' }));
} catch (e) {}`;

/*
   찍을 화면과 파일 이름.

   순서는 덱에 넣는 순서다 — 파일 이름 앞의 번호가 그대로 정렬 순서가 되므로
   폴더를 열면 덱 순서대로 보인다.

   ★ 로그인 없이 보이는 화면(랜딩·로그인)을 먼저 찍고 로그인한다.
*/
const PUBLIC_SHOTS = [
  { file: '01-landing', route: '/', wait: 4000, label: '랜딩' },
  { file: '02-login', route: '/login', wait: 3000, label: '로그인 (2FA 지원)' },
];

const SHOTS = [
  /* 제품의 핵심. 차트 엔진이 그려질 시간을 넉넉히 준다. */
  { file: '03-trade-terminal', route: '/trade', wait: 11000, label: '트레이딩 터미널 (핵심 화면)' },
  { file: '04-markets', route: '/markets', wait: 5000, label: '시장 목록 · 필터' },
  { file: '05-portfolio', route: '/portfolio', wait: 4500, label: '포트폴리오' },
  { file: '06-analytics', route: '/analytics', wait: 4500, label: '거래 저널 · 손익 분석' },
  { file: '07-ai-strategies', route: '/ai-strategies', wait: 4500, label: 'AI 전략 카탈로그' },
  { file: '08-wallet', route: '/wallet', wait: 4500, label: '거래소 API 키 연결 (비수탁 구조)' },
  { file: '09-order-history', route: '/order-history', wait: 4000, label: '주문 이력' },
  { file: '10-settings-security', route: '/settings', wait: 4000, label: '설정 · 보안' },
  { file: '11-admin-dashboard', route: '/admin', wait: 4500, label: '관리자 대시보드' },
  { file: '12-admin-users', route: '/admin/users', wait: 4500, label: '관리자 · 회원 관리 (RBAC)' },
  { file: '13-admin-system', route: '/admin/system', wait: 4500, label: '관리자 · 시스템 상태' },
  { file: '14-admin-audit', route: '/admin/audit', wait: 4500, label: '관리자 · 감사 로그' },
  { file: '15-admin-risk', route: '/admin/risk', wait: 4500, label: '관리자 · 리스크 큐' },
];

const MOBILE_SHOTS = [
  { file: 'm1-trade', route: '/trade', wait: 10000, label: '모바일 · 트레이딩' },
  { file: 'm2-markets', route: '/markets', wait: 4500, label: '모바일 · 시장' },
  { file: 'm3-portfolio', route: '/portfolio', wait: 4000, label: '모바일 · 포트폴리오' },
];

const only = env.ROUTES ? env.ROUTES.split(',').map((s) => s.trim()) : null;
const wanted = (list) => (only ? list.filter((s) => only.includes(s.route)) : list);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const made = [];
const failed = [];
/* 화면에 남은 상태 배지 — 덱에 그대로 들어가므로 무엇이 찍혔는지 알려준다. */
const badges = new Map();

/** 화면에 보이는 목업·준비중 표시를 수집한다. */
const collectBadges = async (page, name) => {
  const found = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('.qt-prov-badge, .qt-pending-mark, .seg__opt-pending').forEach((e) => {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) out.add(t.slice(0, 40));
    });
    return [...out];
  }).catch(() => []);
  if (found.length) badges.set(name, found);
};

const shoot = async (page, shot, suffix = '') => {
  const path = `${OUT}/${shot.file}${suffix}.png`;
  try {
    await page.goto(`${BASE}/index.html#${shot.route}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(shot.wait);
    /*
       ★ 스크롤을 맨 위로 되돌린다.
         앞 화면에서 스크롤이 남아 있으면 다음 화면이 중간부터 찍힌다.
    */
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path });
    await collectBadges(page, shot.file + suffix);
    made.push({ path, label: shot.label });
    console.log(`  ✓ ${shot.file}${suffix}  ${shot.label}`);
  } catch (e) {
    failed.push({ file: shot.file, error: e.message.slice(0, 80) });
    console.log(`  ✗ ${shot.file}${suffix}  ${e.message.slice(0, 60)}`);
  }
};

// ---- 데스크톱 ----

console.log(`\nIR 화면 캡처 — ${BASE} · ${WIDTH}×${HEIGHT} @${SCALE}x → ${OUT}`);
console.log(`모드: ${CLEAN ? 'CLEAN (일반 고객 화면 — 개발용 배지 없음)' : '있는 그대로 (개발용 상태 배지 포함)'}\n`);

const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
  locale: 'en-US',
});
if (CLEAN) await ctx.addInitScript(CLEAN_INIT);
const page = await ctx.newPage();

console.log('[공개 화면]');
for (const shot of wanted(PUBLIC_SHOTS)) await shoot(page, shot);

// 로그인
await page.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
  if (b) b.click();
});
await page.waitForTimeout(4500);
const loggedIn = await page.evaluate(() => Boolean(window.QTAuth?.isLoggedIn?.()));
if (!loggedIn) {
  console.error(`\n로그인 실패 (${EMAIL}) — 로그인 후 화면을 찍을 수 없습니다.`);
  console.error('시드: pnpm --filter @quantumtrade/api seed:dev');
  await browser.close();
  process.exit(1);
}
console.log(`\n[로그인 후 화면] ${EMAIL}`);
for (const shot of wanted(SHOTS)) await shoot(page, shot);
await ctx.close();

// ---- 모바일 ----

if (WANT_MOBILE && wanted(MOBILE_SHOTS).length) {
  console.log('\n[모바일 · 390×844]');
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  if (CLEAN) await mctx.addInitScript(CLEAN_INIT);
  const mpage = await mctx.newPage();
  await mpage.goto(`${BASE}/index.html#/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await mpage.waitForTimeout(2500);
  await mpage.fill('input[type=email]', EMAIL);
  await mpage.fill('input[type=password]', PASSWORD);
  await mpage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => e.type === 'submit');
    if (b) b.click();
  });
  await mpage.waitForTimeout(4500);
  for (const shot of wanted(MOBILE_SHOTS)) await shoot(mpage, shot);
  await mctx.close();
}

await browser.close();

// ---- 보고 ----

console.log(`\n${'─'.repeat(70)}`);
console.log(`  ${made.length}장 저장 · 실패 ${failed.length}장 → ${OUT}`);
console.log(`${'─'.repeat(70)}\n`);

if (failed.length) {
  console.log('■ 실패');
  for (const f of failed) console.log(`  · ${f.file} — ${f.error}`);
  console.log('');
}

if (badges.size) {
  console.log('■ 화면에 남아 있는 상태 표시 (덱에 그대로 찍혔습니다)');
  for (const [name, list] of badges) console.log(`  · ${name}: ${list.join(' / ')}`);
  console.log('\n  ★ 이 배지는 실데이터가 아니라는 표시입니다. 덱에 쓸 때 그 화면이');
  console.log('    목업임을 각주로 밝히거나, 실데이터를 연결한 뒤 다시 찍으십시오.\n');
}

process.exit(failed.length ? 1 : 0);
