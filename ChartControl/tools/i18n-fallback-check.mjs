#!/usr/bin/env node
/* ============================================================
   i18n 폴백 검사 — 화면에 **영어가 그대로 보이는** 곳을 찾는다
   ------------------------------------------------------------
   왜 이 도구가 따로 필요한가

   ★★ 기존 `i18n-visible-check.mjs` 는 **한글만** 검출한다.

     그 도구는 "서버가 한국어 문장을 응답에 담는" 문제를 잡기 위해 만든 것이라
     대상 언어 화면에서 한글(가-힣)을 찾는다. 그래서 사전에 키가 없어 **영어로
     폴백된 문장은 하나도 잡지 못한다.**

     실제로 그 도구가 ja/zh 에서 "미번역 7종" 이라고 보고하는 동안, 거래소 연결
     마법사 1단계는 영어와 중국어가 한 문장 안에 섞여 있었다:

       "… sign up through the referral link注册。大约需要一分钟。"

     en 사전은 2,055키인데 zh 는 1,050키다. 차이만큼은 영어로 나온다. 그중 어느
     것이 실제로 화면에 나타나는지는 열어봐야만 알 수 있다.

   ★★ 모달·다단계 화면 안쪽까지 본다.

     처음에는 라우트만 열고 검사했다. 그 결과 "0건" 이라고 보고하는 동안 마법사
     모달은 영어였다 — 버튼을 눌러야 열리기 때문이다. 사용자가 반드시 지나가는
     화면이 검사 범위 밖에 있으면, 그 검사는 통과해도 아무 의미가 없다.

   어떻게 판정하는가 — 오탐을 만들지 않는 방법

   ★ 화면의 텍스트가 **en 사전의 값과 정확히 일치**하고, 그 키가 대상 언어 사전에
     없을 때만 미번역으로 본다.

     "라틴 문자가 보이면 미번역" 같은 판정은 쓸 수 없다. BTC·USDT·KuCoin·API Key
     처럼 번역하지 않는 것이 정상인 문자열이 많다. 사전 값과의 일치를 요구하면
     그런 고유명사는 애초에 후보에 오르지 않는다(사전에 없으므로).

   ★ 값이 같은 키가 여러 개면 버린다. 어느 키를 고쳐야 하는지 말할 수 없는 보고는
     쓸모가 없다.

   사용법
     cd /tmp/qt_verify   # playwright 가 설치된 곳
     LOCALE=zh BASE=http://127.0.0.1:8795 node "…/tools/i18n-fallback-check.mjs"
     MIN_LEN=12          # 이보다 짧은 문자열은 키를 특정하기 어려워 제외
     DEEP=0              # 1 이면 모달·단계까지 (기본 1)
   ============================================================ */

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
const LOCALE = process.env.LOCALE || 'zh';
const MIN_LEN = Number(process.env.MIN_LEN || 12);
const DEEP = process.env.DEEP !== '0';

/* 사용자 동선을 우선한다 — 여기서 막히면 그 사용자는 아무것도 하지 못한다. */
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : [
  '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
  '/terms', '/privacy', '/risk',
  '/trade', '/markets', '/portfolio', '/wallet', '/order-history',
  '/ai', '/ai-strategies', '/ai-strategies/detail?id=s1', '/my-strategies',
  '/analytics', '/notifications', '/referral', '/points', '/fees', '/help',
  '/settings', '/deposit', '/withdraw', '/transactions',
];
/* 진단: 어느 상태에서 발견했는지 보고 싶을 때 VERBOSE=1 */
const VERBOSE = process.env.VERBOSE === '1';

/*
   페이지 안에서 실행되는 판정 함수.

   page.evaluate 에 매번 그대로 넘긴다 — window 에 심어두면 페이지를 이동할 때
   사라져서, 이동 후 첫 검사가 조용히 아무것도 못 잡는다(실제로 그렇게 만들었다가
   0건이 나왔다).
*/
const SCAN = (args) => {
  const { locale, minLen } = args;
  const I = window.QTI18n;
  if (!I || !I.dump) return { unsupported: true, items: [] };

  const en = I.dump('en') || {};
  const target = I.dump(locale) || {};

  const byValue = new Map();
  const dup = new Set();
  /*
     ★ 자리표시자가 든 문장은 문자열 비교로 잡히지 않는다.

       'Connect {exchange}' 는 화면에서 'Connect KuCoin' 이 되므로 사전 값과
       글자가 다르다. 처음에는 이것 때문에 마법사 제목·1단계 질문 같은
       **사용자가 반드시 지나가는 문장을 놓쳤다.**

       그래서 자리표시자가 있으면 정규식으로 바꿔 비교한다. 자리표시자 부분은
       한 줄 안의 임의 문자열로 본다.
  */
  const patterns = [];
  const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s.length < minLen) continue;
    if (/\{[a-zA-Z0-9_]+\}/.test(s)) {
      /*
         ★ 자리표시자를 뺀 고정 부분이 짧으면 패턴을 만들지 않는다.

           MIN_LEN 을 4 로 낮춰 짧은 라벨까지 보려 했을 때, 이 가드를 MIN_LEN 에
           연동해 두었더니 `'{n} total'` 같은 값이 거의 모든 문자열과 일치해
           보고가 3,400건으로 부풀었다. 고정 부분의 길이는 대상 언어 설정과
           무관하게 충분해야 한다.
      */
      const fixed = s.replace(/\{[a-zA-Z0-9_]+\}/gu, '');
      if (fixed.trim().length < 10) continue;
      const re = new RegExp('^' + s.split(/\{[a-zA-Z0-9_]+\}/u).map(escapeRe).join('(.{1,60}?)') + '$', 'u');
      patterns.push({ re, key: k, sample: s });
      continue;
    }
    if (byValue.has(s)) { dup.add(s); continue; }
    byValue.set(s, k);
  }
  for (const s of dup) byValue.delete(s);

  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    if (!el.getClientRects().length) continue;
    const s = (n.textContent || '').trim();
    if (s.length >= minLen) seen.add(s);
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const s = (el.getAttribute(a) || '').trim();
      if (s.length >= minLen) seen.add(s);
    }
  }

  const items = [];
  for (const s of seen) {
    let key = byValue.get(s);
    if (!key) {
      for (const p of patterns) {
        if (p.re.test(s)) { key = p.key; break; }
      }
    }
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    items.push({ key, text: s.slice(0, 90) });
  }
  return { unsupported: false, items };
};

/*
   ★★ 라우트를 여러 개 이어 돌리면 브라우저가 죽었다.

     실측: /trade(차트·캔버스 다수) 다음 /markets 를 처리하는 중에 연결이 끊기고,
     그 뒤 ctx.newPage() 가 "browser has been closed" 로 던져 **나머지 라우트를
     하나도 검사하지 못했다.** 검사 도구가 중간에 멈추면 "통과" 도 "실패" 도
     아닌 상태가 되는데, 로그만 보면 통과처럼 보인다 — 가장 위험한 형태다.

   ★ 컨테이너에서 Chromium 이 죽는 흔한 원인들을 함께 막는다.
     · --disable-dev-shm-usage : 공유메모리 대신 임시파일 사용
     · --no-sandbox           : 컨테이너에서 샌드박스가 자원을 더 먹는다
     · --disable-gpu          : 헤드리스에서 GPU 프로세스는 불필요
*/
const browser = await chromium.launch({
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
});
browser.on('disconnected', () => {
  if (process.env.FB_DEBUG) console.error('    [fb] ★ 브라우저 연결 끊김');
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });

/*
   컨텍스트 설정(세션 위조 + 초기 스크립트).

   ★ 함수로 둔다 — 브라우저를 되살릴 때 **같은 설정을 다시 적용**해야 한다.
     안 하면 재기동 이후 라우트가 로그아웃 상태로 검사되어, 화면이 달라진다.
*/
const applyCtxSetup = async (c) => {
  await c.route('**/api/auth/session', (r) => r.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: {
      id: 'i18n-check', email: 'i18n@check.local', role: 'SUPER_ADMIN',
      status: 'active', mfaEnabled: false, emailVerified: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    },
  }),
  }));

  await c.addInitScript((L) => {
    /*
       ★ about:blank 같은 불투명 출처에서는 localStorage 접근이 예외를 던진다.
         감싸지 않으면 매 문서마다 pageerror 가 쌓여 진짜 오류를 가린다.
    */
    try {
      localStorage.setItem('qt.tweaks', JSON.stringify({
        role: 'super', lang: L, theme: 'dark', brand: 'institutional-cool',
        longshort: 'teal-magenta', density: 'comfortable',
        presetId: 'standard-trader', pro: true, numFmt: 'standard',
      }));
    } catch (e) { /* 접근 불가 문서 — 무시한다 */ }
  }, LOCALE);
};

await applyCtxSetup(ctx);

const found = new Map(); // "key\ttext" -> Set(where)
let unsupported = false;
/** 브라우저가 죽어 검사하지 못한 라우트. 비어 있지 않으면 실패로 끝낸다. */
const aborted = [];

const record = (hits, where) => {
  if (hits.unsupported) { unsupported = true; return false; }
  for (const h of hits.items) {
    const id = `${h.key}\t${h.text}`;
    if (!found.has(id)) found.set(id, new Set());
    found.get(id).add(where);
  }
  return true;
};

let browserRef = browser;
let ctxRef = ctx;

/*
   ★★ 브라우저가 죽으면 되살린다.

     실측: /trade(캔버스 다수) 다음 /markets 를 처리하는 중에 연결이 끊기고,
     그 뒤 newPage() 가 던져 **나머지 라우트를 하나도 검사하지 못했다.**

     원인을 하나로 특정하지 못했다(메모리·fd 상한은 넉넉하고, 라우트를 하나씩
     돌리면 모두 통과한다). 그래서 원인 추정에 기대지 않고 **죽으면 다시 세운다** —
     무엇 때문이든 검사가 끝까지 간다.

   ★ 되살린 횟수를 남긴다. 조용히 재기동하면 도구가 불안정한 사실이 묻힌다.
*/
const relaunched = [];
const ensureBrowser = async (route) => {
  if (browserRef.isConnected()) return;
  relaunched.push(route);
  browserRef = await chromium.launch({
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
  });
  ctxRef = await browserRef.newContext({ viewport: { width: 1500, height: 1050 } });
  await applyCtxSetup(ctxRef);
};

for (const route of ROUTES) {
  /* FB_DEBUG=1 이면 어느 라우트에서 멈추는지 보인다(브라우저 사망 지점 추적용). */
  if (process.env.FB_DEBUG) console.error(`    [fb] ${route} 시작`);
  try {
    await ensureBrowser(route);
  } catch (e) {
    /* 재기동조차 실패하면 남은 라우트를 검사하지 못했다고 밝힌다. */
    aborted.push(route);
    continue;
  }
  const page = await ctxRef.newPage();
  const open = async () => {
    /*
       ★★ 쿼리에 값을 붙여 **문서를 새로 읽게** 한다.

         전에는 `#/wallet` 로만 이동했다. 해시만 바뀌는 이동은 같은 문서 안에서
         일어나므로 **React 상태가 그대로 남는다.** 그래서 어떤 버튼이 모달을
         열어둔 채 예외로 끝나면, 그 뒤의 이동으로도 모달이 닫히지 않고 오버레이가
         모든 클릭을 막았다. 실측에서 /wallet 의 버튼 18개 중 6개를 누른 뒤
         나머지가 전부 "없음" 이 되었고, 그 안에 마법사를 여는 'Connect API' 가
         있었다 — 검사는 그 사실을 모른 채 "문제 없음" 을 보고했다.
    */
    await page.goto(`${BASE}/index.html?probe=${Date.now()}#${route}`, {
      waitUntil: 'networkidle', timeout: 40000,
    });
    await page.evaluate((l) => window.QTI18n && window.QTI18n.setLocale(l), LOCALE);
    await page.waitForTimeout(1200);
  };
  const clickByLabel = async (label) => {
    for (const h of await page.$$('button')) {
      const t = ((await h.innerText()) || '').trim();
      if (t === label) { await h.click({ timeout: 3000 }); return true; }
    }
    return false;
  };

  try {
    await open();
    if (!record(await page.evaluate(SCAN, { locale: LOCALE, minLen: MIN_LEN }), route)) break;

    if (DEEP) {
      const labels = await page.$$eval('button', (bs) => bs
        .map((b) => (b.innerText || '').trim())
        .filter((t) => t && t.length <= 40));
      /*
         ★ 상한을 넉넉히 둔다.

           12개로 제한했더니 /wallet 의 'Connect API' 가 15번째여서 마법사 모달을
           한 번도 열지 못했고, 검사는 "문제 없음" 이라고 보고했다. 상한은 실행
           시간을 줄이기 위한 것이지 검사 범위를 줄이기 위한 것이 아니다.
      */
      const uniq = [...new Set(labels)].slice(0, Number(process.env.MAX_BUTTONS || 30));

      for (const label of uniq) {
        /*
           ★ 언어 순환 버튼은 누르지 않는다.

             누르면 **검사 대상 언어 자체가 바뀐다.** 그 뒤의 모든 검사가 다른
             언어를 보게 되므로 결과가 조용히 무의미해진다.
        */
        if (/^(EN|KO|JA|ZH)$/i.test(label)) continue;

        try {
          const clicked = await clickByLabel(label);
          if (VERBOSE) console.log(`      · click ${JSON.stringify(label)} → ${clicked ? 'ok' : '없음'}`);
          if (!clicked) continue;
          await page.waitForTimeout(650);
          record(await page.evaluate(SCAN, { locale: LOCALE, minLen: MIN_LEN }), `${route} [${label}]`);

          /* 마법사처럼 단계가 있으면 다음 단계도 본다. */
          for (let step = 1; step <= 3; step += 1) {
            let moved = false;
            for (const h of await page.$$('button')) {
              const t = ((await h.innerText()) || '').trim();
              if (/→\s*$/.test(t) && !/←/.test(t)) {
                await h.click({ timeout: 3000 }).catch(() => {});
                moved = true;
                break;
              }
            }
            if (!moved) break;
            await page.waitForTimeout(650);
            record(await page.evaluate(SCAN, { locale: LOCALE, minLen: MIN_LEN }), `${route} [${label} +${step}]`);
          }
        } catch (e) {
          if (VERBOSE) console.log(`      · ${JSON.stringify(label)} 예외: ${String(e).slice(0, 70)}`);
        } finally {
          /*
             ★★ 반드시 finally 에서 원래 상태로 돌린다.

               전에는 try 의 마지막 줄에서 복구했다. 그래서 클릭이 예외를 던지면
               **모달이 열린 채로 남고, 그 뒤의 모든 버튼이 오버레이에 막혀
               하나도 눌리지 않았다.** /wallet 에서 'Connect API' 는 15번째
               버튼이라 마법사 모달을 한 번도 열지 못했고, 검사는 "문제 없음"
               이라고 보고했다. 복구를 건너뛰는 경로가 있으면 검사 범위가
               조용히 줄어든다.
          */
          await open().catch(() => {});
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠ ${route} 실패: ${String(e).slice(0, 90)}`);
  }
  await page.close();
}

if (browserRef.isConnected()) await browserRef.close();

/*
   ★ 되살린 횟수를 밝힌다. 조용히 재기동하면 도구가 불안정한 사실이 묻히고,
     나중에 "왜 느린가" 를 설명할 수 없다.
*/
if (relaunched.length > 0) {
  console.log(`  ⓘ 브라우저를 ${relaunched.length}회 되살렸습니다 (${relaunched.join(', ')} 앞).`);
}

/*
   ★★ 검사하지 못한 라우트가 있으면 실패로 끝낸다.

     "영어 문구 0종" 만 출력하고 0 으로 끝내면, 절반만 검사한 결과가 통과로
     기록된다.
*/
if (aborted.length > 0) {
  console.log(`\n★ 브라우저가 죽어 ${aborted.length}개 라우트를 검사하지 못했습니다: ${aborted.join(', ')}`);
  process.exit(1);
}

if (unsupported) {
  console.log('QTI18n.dump 가 없어 검사할 수 없습니다. src/i18n.js 에 dump 를 노출하십시오.');
  process.exit(2);
}

const rows = [...found.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`\nlocale=${LOCALE} · ${ROUTES.length}라우트${DEEP ? ' (모달·단계 포함)' : ''} · 영어로 보이는 문구 ${rows.length}종\n`);
for (const [id, where] of rows) {
  const [key, text] = id.split('\t');
  console.log(`  ${String(where.size).padStart(2)}곳  ${key}`);
  console.log(`        ${text}`);
  if (VERBOSE) console.log(`        ↳ ${[...where].slice(0, 6).join(' · ')}`);
}
if (rows.length) {
  console.log(`\n  키 목록: ${rows.map((r) => r[0].split('\t')[0]).join(' ')}`);
}
process.exit(rows.length ? 1 : 0);
