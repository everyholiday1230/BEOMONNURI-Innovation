/**
 * 입금 주소 안전 검사.
 *
 * 왜 필요한가
 * ---------
 * 우리는 비수탁이라 **우리 입금 주소가 존재하지 않는다**. 화면에 주소처럼
 * 보이는 문자열이 복사 버튼과 함께 있으면, 고객이 그것으로 송금해 자금이
 * 영구히 사라진다. 되돌릴 방법이 없다.
 *
 * 원래 이 화면에는 예시 주소 4개가 QR·복사 버튼과 함께 있었다(실제로 발견).
 * 실서비스 경로에서 그 주소가 다시 렌더되지 않도록 소스 수준에서 고정한다.
 *
 * 함께 검사하는 것: 예시 추천 코드. 예시 코드가 박힌 링크는 가입은 되지만
 * 귀속이 안 돼 수익이 0 이 된다 — 조용히 새기 때문에 알아채기 어렵다.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1; };
const pass = (msg) => console.log('  ✓ ' + msg);

// ---- 1. 입금 주소는 실서비스 경로에서 렌더되지 않아야 한다 ----
const more = read('src/pages-more.jsx');

if (/const address = isRealService \? '' :/.test(more)) {
  pass('입금 주소가 실서비스에서 빈 값이다');
} else {
  fail('입금 주소가 실서비스에서도 값을 갖는다 — 고객이 복사해 송금할 수 있다');
}

if (/isRealService \? \(/.test(more)) {
  pass('주소·QR·복사 버튼이 실서비스에서 렌더되지 않는다');
} else {
  fail('주소 카드가 조건 없이 렌더된다');
}

// 예시 주소가 상수 하나에만 모여 있는지 (여러 곳에 흩어지면 다시 새어나간다)
const addrLiterals = more.match(/'(?:T[A-Za-z0-9]{25,}|0x[0-9a-fA-F]{30,}|[1-9A-HJ-NP-Za-km-z]{40,})'/g) || [];
if (addrLiterals.length <= 4) {
  pass(`주소 리터럴 ${addrLiterals.length}개 — MOCK_ADDRESSES 안에만 있다`);
} else {
  fail(`주소 리터럴이 ${addrLiterals.length}개 있다 — 흩어진 값은 다시 노출된다`);
}

// ---- 1b. 출금은 실서비스에서 실행 불가여야 한다 ----
// 우리는 비수탁이라 출금을 처리할 수 없다. 접수되는 것처럼 보이면 고객이
// 오지 않는 돈을 기다린다.
if (/disabled=\{isRealService \|\| !address/.test(more)) {
  pass('출금 제출 버튼이 실서비스에서 비활성이다');
} else {
  fail('출금 제출 버튼이 실서비스에서 눌린다 — 처리할 수 없는 요청을 접수한다');
}

/*
   출금 잔고.

   ★ 코드 모양이 아니라 **조건이 걸려 있는지**를 본다. 전에는 특정 표현식을
     정규식으로 찍어 비교했는데, 조건을 더 정확하게 고치자(미리보기 판정 추가)
     검사가 실패했다 — 개선을 회귀로 잡는 검사는 쓸모가 없다.

   확인하는 것: 예시 잔고 숫자가 **조건 없이** 쓰이지 않는가.
*/
{
  const mockBalance = '9840.22';
  const usesMock = more.includes(mockBalance);
  // 예시 값이 있어도 실서비스 판정(allowMockData / isRealService)이 함께 있으면 통과.
  const gated = /allowMockData\(\)|isRealService/.test(more);
  if (!usesMock) {
    pass('출금 화면에 예시 잔고가 없다');
  } else if (gated) {
    pass('예시 잔고가 미리보기 전용으로 제한된다');
  } else {
    fail('출금 화면이 예시 잔고를 조건 없이 보여준다 — 없는 돈을 있다고 말한다');
  }
}

/*
   ★ 목업 표시 정책이 단일 출처를 쓰는지 확인한다.

     화면마다 다른 조건으로 목업/실데이터를 고르면, 어느 한 곳이 빠져
     실서비스에서 예시 데이터가 노출된다. 실제로 그렇게 됐다:
     거래 기록이 없는 계정이 목업 포지션 3개를 자기 것으로 봤다.
*/
{
  const policy = read('src/mock-policy.js');
  if (policy.includes('allowMockData') && policy.includes('isBackendPresent')) {
    pass('목업 표시 판정이 단일 출처(QTMockPolicy)에 있다');
  } else {
    fail('목업 표시 판정 모듈이 없다 — 화면마다 다른 조건을 쓰면 한 곳이 빠진다');
  }

  // 주요 화면이 그 정책을 실제로 쓰는지.
  for (const [file, label] of [
    ['src/pages-user.jsx', '포트폴리오·분석·주문이력'],
    ['src/pages-more.jsx', '지갑·원장'],
    ['src/app.jsx', '거래 화면(주문 패널·포지션)'],
  ]) {
    const src = read(file);
    if (src.includes('QTMockPolicy')) pass(`${label} — 목업 정책 적용됨`);
    else fail(`${label} — 목업 정책을 쓰지 않는다 (${file})`);
  }
}

if (/\(isRealService \? \[\] : \[/.test(more)) {
  pass('예시 출금 주소가 실서비스에서 렌더되지 않는다');
} else {
  fail('예시 출금 주소가 실서비스에서 보인다 — 내 주소로 오인한다');
}

// ---- 2. 예시 추천 코드가 남아 있지 않아야 한다 ----
const FAKE_CODES = ['QUANTUM-KURI', 'QUANTUMKURI'];
for (const f of ['src/mock-app-data.js', 'src/pages-more.jsx', 'src/pages-user.jsx', 'src/mock-data.js']) {
  const src = read(f);
  const hit = FAKE_CODES.filter((c) => src.includes(c) && !src.includes("'" + c) === false);
  // 주석 안의 설명은 허용한다 — 링크 값으로 쓰인 경우만 문제다.
  const asValue = FAKE_CODES.filter((c) => new RegExp(`(referral|href)\\s*[:=]\\s*['"\`][^'"\`]*${c}`).test(src));
  if (asValue.length === 0) pass(`${f} — 예시 추천 코드가 링크 값으로 쓰이지 않는다`);
  else fail(`${f} — 예시 추천 코드 ${asValue.join(', ')} 가 링크 값이다 (수익 귀속 안 됨)`);
  void hit;
}

// ---- 2b. 리퍼럴은 지킬 수 있는 약속만 해야 한다 ----
/*
   제도가 실제로 구축됐다(마이그레이션 0015 · referral-repo · 라우트).
   그래서 기준이 바뀐다: "코드를 주지 마라" 가 아니라
   "코드는 서버가 발급하고, 지킬 수 없는 약속을 하지 마라" 다.

   지켜야 하는 것
   ------------
   · 코드를 화면에서 만들지 않는다 (서버가 제도 조건을 확인한 뒤 발급한다)
   · 적립 예정액을 계산해 보여주지 않는다 (거래소가 산정하고 우리 DB 에 없다)
   · 자동 지급이라고 말하지 않는다 (비수탁이라 적립할 지갑이 없다)
*/
if (/const referralCode = refOn \? ref\.code : null;/.test(more)) {
  pass('리퍼럴 코드를 서버에서 받는다 (화면이 만들지 않는다)');
} else {
  fail('리퍼럴 코드를 화면에서 만든다 — 제도 조건과 무관하게 발급될 수 있다');
}

// 적립 예정액을 계산하는 흔적이 없어야 한다.
{
  const suspect = /(pendingAmount|accruedAmount|estimatedEarnings|예상\s*적립)/.test(more);
  if (!suspect) pass('적립 예정액을 계산하지 않는다');
  else fail('적립 예정액을 계산해 보여준다 — 거래소 산정액과 어긋나 분쟁이 된다');
}

// 자동 지급 고지가 있어야 한다(서버 disclosures 를 화면이 표시).
{
  const en = read('src/locales/en.js');
  if (/ref_how_paid_1/.test(en) && /Payouts are sent to you directly by the operator/.test(en)) {
    pass('자동 지급이 아니라는 사실을 표시한다');
  } else {
    fail('지급 방식 고지가 없다 — 사용자가 자동 입금을 기대한다');
  }
}

{
  const access = read('src/access.js');
  // 배선이 끝난 화면은 숨기지 않아야 한다.
  for (const r of ['/wallet/deposit', '/wallet/withdraw', '/referral']) {
    if (new RegExp(`^\\s*'${r.replace(/\//g, '\\/')}',\\s*$`, 'm').test(access)) {
      fail(`${r} 이 아직 미개발로 숨겨져 있다 — 배선이 끝났는데 사용자가 볼 수 없다`);
    } else {
      pass(`${r} 이 사용자에게 공개된다`);
    }
  }
}

// ---- 3. 추천 링크는 설정에서 와야 한다 ----
if (/getReferralUrl/.test(more) && /getReferralUrl/.test(read('src/pages-user.jsx'))) {
  pass('추천 링크를 설정에서 읽는다 (getReferralUrl)');
} else {
  fail('추천 링크가 설정 기반이 아니다');
}

// ---- 4. 외부 링크에 rel=noopener 가 붙어야 한다 ----
// target=_blank 만 있으면 열린 페이지가 window.opener 로 우리 탭을 조작할 수 있다.
for (const f of ['src/pages-more.jsx', 'src/pages-user.jsx']) {
  const src = read(f);
  // 추천 링크 앵커만 검사한다.
  const anchors = src.match(/<a[^>]*getReferralUrl[^>]*>|<a[^>]*referralUrl[^>]*>|<a[^>]*signupUrl[^>]*>/gs) || [];
  const bad = anchors.filter((a) => /target=["{]?_?["']?_blank/.test(a) && !/noopener/.test(a));
  if (bad.length === 0) pass(`${f} — 추천 링크 ${anchors.length}개에 noopener 적용`);
  else fail(`${f} — noopener 없는 외부 링크 ${bad.length}개`);
}

// ---- 4. 포인트가 현금처럼 취급되지 않는지 ----
//
// ★ 포인트를 현금으로 바꿔주면 자금 이동업이고 우리는 그 자격이 없다.
//   환전·출금 경로가 생기면 여기서 잡는다.
//
// ★ 결제 대행사 없이 판매를 열면 "결제했는데 포인트가 안 들어옴" 이 된다.
{
  const routes = read('apps/api/src/points/points-routes.ts');
  const repo = read('apps/api/src/db/points-repo.ts');
  const admin = read('apps/api/src/admin/admin-routes.ts');

  // 출금·환전 경로가 없어야 한다.
  for (const bad of ['/points/withdraw', '/points/cashout', '/points/transfer', '/points/convert']) {
    if (!routes.includes(bad)) pass(`포인트에 현금화 경로가 없다 (${bad})`);
    else fail(`포인트에 현금화 경로 ${bad} 가 있다 — 자금 이동업이 된다`);
  }

  // 화면과 서버가 같은 사실을 말해야 한다.
  if (routes.includes('cashConvertible: false')) pass('포인트 응답이 현금 전환 불가를 밝힌다');
  else fail('포인트 응답이 현금 전환 불가를 밝힌다');
  if (routes.includes('withdrawable: false')) pass('포인트 응답이 출금 불가를 밝힌다');
  else fail('포인트 응답이 출금 불가를 밝힌다');

  // 결제 대행사 없이 판매를 켤 수 없어야 한다.
  if (admin.includes('no payment provider is connected')) pass('결제 대행사 없이 포인트 판매를 켜면 서버가 거부한다');
  else fail('결제 대행사 없이 포인트 판매를 켜면 서버가 거부한다');
  if (/purchaseEnabled:\s*false/.test(admin)) pass('설정 저장 시 구매 스위치를 강제로 끈다');
  else fail('설정 저장 시 구매 스위치를 강제로 끈다');

  // 원장은 추가만 한다 — 수정·삭제 경로가 없어야 한다.
  if (!/UPDATE\s+point_ledger/i.test(repo)) pass('원장에 UPDATE 가 없다 (추가만)');
  else fail('원장에 UPDATE 가 없다 (추가만)');
  if (!/DELETE\s+FROM\s+point_ledger/i.test(repo)) pass('원장에 DELETE 가 없다 (추가만)');
  else fail('원장에 DELETE 가 없다 (추가만)');

  // 차감은 행 잠금 안에서 해야 한다 — 없으면 동시 요청이 이중 사용한다.
  if (repo.includes('FOR UPDATE')) pass('포인트 차감이 행 잠금 안에서 이뤄진다');
  else fail('포인트 차감이 행 잠금 안에서 이뤄진다');
}

/* ============================================================
   상태 표시가 서버의 사실을 말하는가

   ★★ 실제로 겪은 문제 두 가지를 여기에 고정한다.

   1) 최상단 띠에 "Mock data · No real funds at risk · Prototype demo" 가
      **하드코딩**돼 있었다. 실주문을 열면 실제 돈이 걸린 화면에 "위험 없음"
      이라고 적힌다 — 그 표시를 믿은 사용자가 손실을 본다.

   2) 판정을 `QTMode`(사용자가 고른 UI 모드, 기본값 futures)로 하면 서버가
      MOCK 인데도 "실거래" 라고 띄운다. 주문 경로는 **서버**가 정한다.
   ============================================================ */
{
  /* ★ 주석을 제거하고 본다. 이 파일의 주석에는 "원래 이렇게 하드코딩돼 있었다" 는
       설명이 들어 있고, 그 인용을 잡으면 설명을 지워야 검사가 통과한다 —
       기록을 지우게 만드는 검사는 잘못됐다. */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = stripComments(read('src/app.jsx'));

  for (const phrase of ['No real funds at risk', 'Prototype demo', 'Data seed · deterministic']) {
    if (!app.includes(phrase)) pass(`상단 띠에 '${phrase}' 하드코딩이 없다`);
    else fail(`상단 띠에 '${phrase}' 가 하드코딩돼 있다 — 실주문을 열면 거짓이 된다`);
  }

  // 띠가 서버 설정을 근거로 판정해야 한다.
  const at = app.indexOf('sim-stripe');
  const stripe = at === -1 ? '' : app.slice(Math.max(0, at - 1800), at + 1800);
  if (/liveOrdersEnabled/.test(stripe) && /tradingMode/.test(stripe)) {
    pass('상단 띠가 서버의 liveOrdersEnabled·tradingMode 로 판정한다');
  } else {
    fail('상단 띠가 서버 설정으로 판정하지 않는다 — 클라이언트 모드로 판정하면 거짓을 말한다');
  }

  // 판정 전에 단정하지 않아야 한다.
  if (/stripe_checking/.test(stripe)) {
    pass('서버 설정을 받기 전에는 단정하지 않는다');
  } else {
    fail('서버 설정을 받기 전 상태를 구분하지 않는다 — 잠깐 잘못된 문구가 보인다');
  }
}

/* ============================================================
   거래소 미상장 심볼

   ★★ 실시세가 덮어쓰지 못하는 심볼(예: TON)은 목업 가격이 남는다.
     그 상태로 주문 패널이 열리면 존재하지 않는 종목에 가짜 가격으로
     주문하게 된다.
   ============================================================ */
{
  const widgets = read('src/widgets.jsx');
  const user = read('src/pages-user.jsx');

  if (/symbolUnlisted/.test(widgets)) pass('주문 패널이 미상장 심볼을 판정한다');
  else fail('주문 패널이 미상장 심볼을 판정하지 않는다');

  // 판정만 하고 버튼을 열어 두면 의미가 없다.
  if (/disabled=\{symbolUnlisted\}/.test(widgets)) pass('미상장이면 주문 버튼이 막힌다');
  else fail('미상장인데 주문 버튼이 열려 있다');

  if (/unlisted\(r\)\s*\?\s*'—'/.test(user) || /unlisted\(r\)\s*\?/.test(user)) {
    pass('마켓 목록이 미상장 심볼의 목업 값을 숨긴다');
  } else {
    fail('마켓 목록이 미상장 심볼의 목업 가격을 그대로 보여준다');
  }

  // 집계에 목업이 섞이면 시장 전체 지표가 부풀려진다.
  if (/markets\.filter\(m\s*=>\s*!unlisted\(m\)\)/.test(user)) {
    pass('마켓 집계가 미상장을 제외한다');
  } else {
    fail('마켓 집계에 미상장 목업 값이 섞인다 — 거래량·상승률 1위가 왜곡된다');
  }
}

/* ============================================================
   라우트의 심볼 파라미터

   ★ `#/trade?symbol=ETHUSDT` 가 무시되어 항상 BTC 가 열렸다.
     목록에서 SUI 를 눌렀는데 BTC 주문 패널이 열리면 잘못된 종목에 주문한다.
   ============================================================ */
{
  const app = read('src/app.jsx');
  if (/marketFromQuery/.test(app) && /route\.query\.symbol/.test(app)) {
    pass('/trade 가 URL 의 symbol 파라미터를 존중한다');
  } else {
    fail('/trade 가 symbol 파라미터를 무시한다 — 목록에서 고른 종목과 다른 화면이 열린다');
  }
}

/* ============================================================
   훅을 조건부로 호출하지 않는가

   ★★ 실제로 겪은 문제. 상단 띠 안에서
        `window.QTApi && window.QTApi.useConfig ? useConfig() : null`
      로 호출했더니 "Rendered more hooks than during the previous render" 가
      나고 **화면 전체가 렌더되지 않았다**(버튼 52개 → 1개). 스크립트가 첫
      렌더보다 늦게 준비되면 훅 개수가 바뀐다.
      콘솔 에러는 났지만 화면은 조용히 비어 있어서, 눈으로 보지 않으면 놓친다.
   ============================================================ */
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /*
     ★ 컴포넌트 **최상단**에서 `window.QTLive ? window.QTLive.useLiveVersion() : 0`
       처럼 쓰는 것은 24곳 있고 잘 동작한다. 매 렌더에서 같은 순서로 호출되기
       때문이다. 그것까지 실패로 만들면 소음만 남고 검사를 끄게 된다.

     ★★ 문제가 된 형태는 **JSX 반환문 안의 즉시실행 함수에서 훅을 부르는 것**이다.
       그 앞에 early return 이 있으면 경로마다 훅 개수가 달라진다.
       실제로 화면 전체가 비었다(버튼 52개 → 1개).
  */
  let offenders = [];
  for (const f of ['src/app.jsx', 'src/widgets.jsx', 'src/pages-user.jsx', 'src/pages-admin.jsx', 'src/page-shell.jsx']) {
    const src = stripComments(read(f));
    // JSX 안의 IIFE: `{(() => {` ... `})()}`
    for (const mm of src.matchAll(/\{\(\(\)\s*=>\s*\{([\s\S]{0,3000}?)\}\)\(\)\}/g)) {
      if (/(?:^|[^.\w])use[A-Z]\w*\s*\(|\.\s*use[A-Z]\w*\s*\(/.test(mm[1])) {
        offenders.push(`${f}: ${mm[1].trim().slice(0, 46).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  if (offenders.length === 0) pass('JSX 안의 즉시실행 함수에서 훅을 호출하지 않는다');
  else fail(`JSX 안의 즉시실행 함수가 훅을 호출한다 — 렌더 경로마다 훅 개수가 바뀌어 화면이 비어 버린다:\n      ${offenders.join('\n      ')}`);
}

/* ============================================================
   백엔드 확인 실패를 "백엔드 없음" 으로 단정하지 않는가

   ★★ 이전에는 확인 요청이 **한 번** 실패하면 곧바로 목업으로 되돌렸다.
      서버 재시작 중이거나 네트워크가 잠깐 끊긴 순간 접속한 사용자는 목업
      잔고·포지션을 **자기 것으로** 보고, 그 상태가 새로고침 전까지 굳는다.

   ★ 구분해야 하는 두 경우:
       · HTTP 404/501 → 정적 프리뷰(파일 서버는 있고 API 가 없다). 목업이 맞다.
       · 네트워크 실패·타임아웃 → 백엔드는 있으나 지금 문제. 목업으로 가지 않는다.
   ============================================================ */
{
  const live = read('src/live-market.js');

  if (/status === 404 \|\| status === 501/.test(live)) {
    pass('API 부재(404/501)와 일시적 장애를 구분한다');
  } else {
    fail('백엔드 확인 실패를 종류 구분 없이 처리한다 — 일시 장애에 목업을 보여준다');
  }

  if (/probeAttempt\s*<\s*PROBE_MAX/.test(live)) {
    pass('백엔드 확인을 재시도한다');
  } else {
    fail('백엔드 확인을 한 번만 시도한다 — 서버 재시작 중 접속하면 목업이 보인다');
  }

  /* 재시도까지 실패했을 때 목업으로 넘어가면 안 된다.
     ★ 마지막 실패 경로(경고 로그 이후)에 목업 전환이 없어야 한다. */
  const warnAt = live.indexOf('백엔드에 연결할 수 없습니다');
  const tail = warnAt === -1 ? '' : live.slice(warnAt, warnAt + 400);
  if (warnAt !== -1 && !/startMockFallback/.test(tail)) {
    pass('재시도 실패 후에도 목업으로 대체하지 않는다');
  } else {
    fail('재시도 실패 후 목업으로 대체한다 — 남의 숫자를 자기 것으로 기억하게 된다');
  }
}

/* ============================================================
   개발 상태 표시(provenance)가 정확하고, 고객에게 새지 않는가

   ★★ 실제로 겪은 문제 3개:
     1) 등급 제한이 없어 **일반 고객에게** "일부실제 · 주문 집행은 시뮬레이션"
        같은 내부 문구가 보였다. 고객은 완성된 서비스를 보러 왔는데 개발 용어를
        읽으면 미완성 제품이라고 느낀다.
     2) `renderBadge` 가 `resolveDynamic` 을 거치지 않아 `dynamic:account` 가
        클래스명에 그대로 들어갔다(`qt-prov-badge--dynamic:account`).
        CSS 에 없는 이름이라 **색이 붙지 않았다**.
     3) `dynamic:account`(=거래소 키 연결 여부)를 키와 무관한 화면
        (/help /referral /points /ai-strategies)에 써서, 키 없는 계정에는
        실제로 동작하는 화면이 'MOCK' 으로 표시됐다.
   ============================================================ */
{
  const prov = read('src/provenance.js');
  const css = read('src/provenance.css');

  if (/isVisibleToViewer/.test(prov) && /RANK\.admin/.test(prov)) {
    pass('개발 상태 표시가 관리자 등급으로 제한된다');
  } else {
    fail('개발 상태 표시에 등급 제한이 없다 — 고객이 내부 개발 문구를 읽는다');
  }

  // 미리보기(백엔드 없음)에서는 보여야 한다 — 디자이너가 자기 화면을 확인한다.
  if (/isBackendPresent\(\) === false/.test(prov)) {
    pass('백엔드 없는 미리보기에서는 표시를 유지한다');
  } else {
    fail('미리보기에서도 표시가 사라진다 — 디자이너가 목업 여부를 확인할 수 없다');
  }

  // 로그인 상태가 바뀌면 다시 판정해야 한다.
  if (/QTAuth\.subscribe/.test(prov)) {
    pass('로그인 상태 변경 시 표시를 다시 판정한다');
  } else {
    fail('로그인해도 표시가 갱신되지 않는다 — 관리자가 로그인해도 나타나지 않는다');
  }

  if (/var status = resolveDynamic\(info\.status\)/.test(prov)) {
    pass('뱃지가 동적 상태를 실제 값으로 해석한다');
  } else {
    fail("뱃지가 'dynamic:*' 문자열을 그대로 쓴다 — CSS 에 없는 클래스라 색이 붙지 않는다");
  }

  /* 미확정은 노란색이어야 한다 — 회색은 "중요하지 않음" 으로 읽힌다.
     관리자 등급 뱃지(ADMIN)와 같은 색으로 통일한다. */
  if (/--qt-prov-mock:\s*var\(--color-warning/.test(css)) {
    pass('아직 확정되지 않은 부분이 노란색으로 표시된다');
  } else {
    fail('미확정 표시가 노란색이 아니다 — 회색은 "중요하지 않음" 으로 읽힌다');
  }
  if (/qt-prov-badge--mock \.qt-prov-badge__label/.test(css)) {
    pass('목업 라벨에 색 규칙이 있다');
  } else {
    fail('목업 라벨에 색 규칙이 없다 — 점만 색이 있고 글자는 평범해 눈에 띄지 않는다');
  }

  /* 거래소 키와 무관한 화면에 `dynamic:account` 를 쓰면 안 된다. */
  const misuse = ['/help', '/referral', '/points', '/ai-strategies'].filter((r) =>
    new RegExp(`ROUTES\\['${r}'\\]\\s*=\\s*\\{\\s*status:\\s*'dynamic:account'`).test(prov),
  );
  if (misuse.length === 0) {
    pass('거래소 키와 무관한 화면에 키 기반 판정을 쓰지 않는다');
  } else {
    fail(`키와 무관한 화면이 키 기반으로 판정된다: ${misuse.join(', ')} — 키 없는 계정에 목업으로 보인다`);
  }

  /* 관리자 화면 상태는 access.js 의 배선 목록과 같은 출처를 봐야 한다. */
  if (/adminRouteStatus/.test(prov) && /isUndeveloped/.test(prov)) {
    pass('관리자 화면 상태를 access.js 배선 목록으로 판정한다');
  } else {
    fail('관리자 화면을 접두사로 일괄 목업 처리한다 — 완성된 화면에 거짓 표시가 남는다');
  }
}

/* ============================================================
   미협약 거래소를 연결 가능한 것처럼 보여주지 않는가

   ★★ 화면이 서버를 호출하지 않고 `window.QTApp.EXCHANGES`(디자이너 예시 9개)를
      직접 읽고 있었다. 실제 어댑터는 2개(KuCoin·BitMart)뿐인데 9개 모두
      "Connect API" 버튼이 있었다. 사용자가 거래소에서 키를 만들어 등록하고
      아무것도 조회되지 않는 이유를 알 수 없다.
   ============================================================ */
{
  const catalog = read('apps/api/src/exchanges/exchange-catalog.ts');
  const routes = read('apps/api/src/exchanges/exchange-routes.ts');
  const user = read('src/pages-user.jsx');
  const auth = read('src/pages-auth.jsx');
  const client = read('src/api-client.js');

  if (/CONNECTABLE_EXCHANGE_IDS/.test(catalog) && /isConnectable/.test(catalog)) {
    pass('연결 가능한 거래소가 서버 단일 출처로 정의된다');
  } else {
    fail('연결 가능 여부의 단일 출처가 없다');
  }

  /* env 로 열면 어댑터 없는 거래소를 켜서 사용자가 동작하지 않는 키를 등록한다. */
  if (!/process\.env\.[A-Z_]*EXCHANGE[A-Z_]*(?![\s\S]{0,40}REFERRAL)/.test(catalog)) {
    pass('연결 가능 목록을 환경변수로 열지 않는다');
  } else {
    fail('연결 가능 목록이 환경변수로 바뀐다 — 어댑터 없는 거래소를 켤 수 있다');
  }

  // 오타로 조용히 0개가 노출되는 것을 기동 시 잡아야 한다.
  if (/unknown exchange id/.test(catalog)) {
    pass('연결 목록의 오타를 기동 시 잡는다');
  } else {
    fail('연결 목록에 오타가 있으면 조용히 0개가 노출된다');
  }

  if (/connectable: isConnectable/.test(routes)) {
    pass('응답이 거래소별 연결 가능 여부를 밝힌다');
  } else {
    fail('응답에 연결 가능 여부가 없다 — 화면이 자기 목록을 들고 있으면 어긋난다');
  }

  /* 화면이 예시 상수를 직접 읽지 않아야 한다.
     ★ 랜딩의 미리보기 분기는 예외다 — 백엔드 없는 디자이너 화면 보존. */
  if (!/const EX = window\.QTApp\.EXCHANGES/.test(user)) {
    pass('지갑 화면이 예시 거래소 목록을 직접 읽지 않는다');
  } else {
    fail('지갑 화면이 예시 거래소 목록을 직접 읽는다 — 미협약 거래소에 연결 버튼이 생긴다');
  }
  if (/useExchanges/.test(client) && /useExchanges/.test(user) && /useExchanges/.test(auth)) {
    pass('거래소 목록을 서버에서 받는다 (지갑·랜딩)');
  } else {
    fail('거래소 목록을 서버에서 받지 않는다');
  }

  // 미협약이면 연결 버튼이 막혀야 한다.
  if (/disabled=\{ex\.status === 'coming-soon' \|\| notReady\}/.test(user)) {
    pass('미협약 거래소는 연결 버튼이 막힌다');
  } else {
    fail('미협약 거래소에 연결 버튼이 열려 있다');
  }
  // 귀속받지 못하는 거래소로 사용자를 보내면 우리 수익이 되지 않는다.
  if (/!notReady && \(window\.QTApi && window\.QTApi\.getReferralUrl/.test(user)) {
    pass('미협약 거래소의 가입 링크를 내보내지 않는다');
  } else {
    fail('미협약 거래소로 가입 링크를 보낸다 — 귀속되지 않아 수익이 0이 된다');
  }
}

/* ============================================================
   AI 미연결 상태에서 가격 수치를 만들지 않는가

   ★★ 실측으로 확인한 가장 위험한 결함이었다. AI provider 가 `unavailable`
      인데도 코파일럿이 사전에 박힌 예시 문구를 분석 결과처럼 답했다:
        "저항: 69,120 (07-16 이후 미검증). 지지: 67,200 (2회 터치, 거래량 많음)"
        "손절: 67,480 이탈 시 즉시 청산 · 목표가 68,980 / 69,640 / 70,420"
      당시 BTC 실제가는 65,000 대였다. 게다가 그 값으로 **차트에 실제 선을
      그렸다**(addOverlay price: 69120 / 67200).

   ★ 사용자는 이 숫자로 진입가와 손절가를 정한다. 근거 없는 가격을 분석으로
     내보내는 것은 이 서비스에서 가장 위험한 거짓이다.
   ============================================================ */
{
  const copilot = read('src/ai-copilot.jsx');

  // 서버가 AI 사용 가능 여부를 알려주어야 화면이 판단할 수 있다.
  const idx = read('apps/api/src/index.ts');
  if (/aiAvailable:/.test(idx)) {
    pass('서버가 AI 사용 가능 여부를 공개 설정으로 알린다');
  } else {
    fail('서버가 AI 상태를 알려주지 않는다 — 화면이 연결 여부를 알 수 없다');
  }

  if (/const aiReady = /.test(copilot)) {
    pass('코파일럿이 AI 연결 여부를 판정한다');
  } else {
    fail('코파일럿이 AI 연결 여부를 판정하지 않는다');
  }

  /* 입력·퀵버튼 경로(handleSubmit)가 막혀야 한다.
     ★ 아래 requestAnalysis 가드와 헷갈리지 않도록 **그 함수 범위 안에서만** 본다.
       전체 파일을 정규식으로 훑으면 다른 경로의 가드에 걸려 통과해 버린다
       (실제로 이 검사를 처음 만들 때 그렇게 새어 나갔다). */
  const submitAt = copilot.indexOf('const handleSubmit');
  const submitBody = submitAt === -1 ? '' : copilot.slice(submitAt, submitAt + 2200);
  if (/if \(!aiReady\)/.test(submitBody) && /ai_unavailable_reply/.test(submitBody)) {
    pass('입력·퀵버튼 경로가 AI 미연결이면 분석을 시작하지 않는다');
  } else {
    fail('AI 미연결인데 입력·퀵버튼이 분석 흐름을 실행한다 — 예시 가격이 분석 결과로 나간다');
  }

  /* 가드가 분류(classify)보다 먼저 있어야 한다 — 뒤에 있으면 오버레이가 이미 그려진다. */
  const guardIdx = submitBody.indexOf('!aiReady');
  const classifyIdx = submitBody.indexOf('classify(');
  if (guardIdx !== -1 && classifyIdx !== -1 && guardIdx < classifyIdx) {
    pass('가드가 분석 분기보다 먼저 실행된다');
  } else {
    fail('가드가 분석 분기 뒤에 있다 — 차트에 예시 가격 선이 먼저 그려진다');
  }

  /* 차트 툴바의 'AI 분석' 경로도 막아야 한다.
     ★ 이용권 차감보다 먼저 막아야 한다 — 실행 못 할 것에 대가를 받으면 안 된다. */
  const bridgeAt = copilot.indexOf('requestAnalysis:');
  const bridge = bridgeAt === -1 ? '' : copilot.slice(bridgeAt, bridgeAt + 1400);
  const guardAt = bridge.indexOf('!aiReady');
  const consumeAt = bridge.indexOf('consumeEntitlement');
  if (guardAt !== -1 && (consumeAt === -1 || guardAt < consumeAt)) {
    pass("'AI 분석' 버튼도 막히고, 이용권 차감보다 먼저 막힌다");
  } else {
    fail("'AI 분석' 버튼이 AI 미연결 상태에서 실행되거나, 이용권을 먼저 차감한다");
  }

  // 상태 뱃지가 'READY' 라고 거짓말하지 않아야 한다.
  if (/else if \(!aiReady\)/.test(copilot) && /ai_state_beta/.test(copilot)) {
    pass('AI 미연결이면 상태 뱃지가 READY 라고 말하지 않는다');
  } else {
    fail("AI 미연결인데 상태 뱃지가 'READY' 로 표시된다 — 뒤이은 문구를 실제 분석으로 믿는다");
  }
}


/* ============================================================
   다국어 — 언어를 추가하면 UI 에서 고를 수 있는가

   ★★ 실제로 겪은 문제: 일본어 사전을 등록했는데 **UI 에서 고를 수 없었다.**
      헤더 버튼이 `lang === 'ko' ? 'en' : 'ko'` 로, Tweaks 패널이 버튼 2개로
      하드코딩돼 있었다. 사전만 추가하고 이 두 곳을 잊으면 새 언어가 죽는다.
   ============================================================ */
{
  const app = read('src/app.jsx');
  const tweaks = read('src/tweaks.jsx');

  if (/QTI18n\.available\(\)/.test(app)) {
    pass('헤더 언어 버튼이 i18n 레지스트리를 순환한다');
  } else {
    fail("헤더 언어 버튼이 언어를 하드코딩한다 — 사전을 추가해도 고를 수 없다");
  }
  if (/QTI18n\.available\(\)/.test(tweaks)) {
    pass('Tweaks 언어 목록이 i18n 레지스트리로 렌더된다');
  } else {
    fail('Tweaks 언어 목록이 하드코딩이다 — 새 언어가 나타나지 않는다');
  }

  /* 등록된 사전이 index.html 에서 로드되는지. 파일만 만들고 넣지 않으면 죽는다. */
  const html = read('index.html');
  const locales = ['en', 'ko', 'ja'];
  const missing = locales.filter((c) => !new RegExp(`src/locales/${c}\\.js`).test(html));
  if (missing.length === 0) {
    pass(`사전 ${locales.length}개가 모두 index.html 에서 로드된다`);
  } else {
    fail(`사전이 로드되지 않는다: ${missing.join(', ')} — 파일만 만들어도 동작하지 않는다`);
  }
}

console.log(failures === 0 ? '\n입금·출금·추천 안전 검사 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
