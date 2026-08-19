#!/usr/bin/env node
/**
 * 런칭 준비 점검.
 *
 * 왜 필요한가
 * ---------
 * 이 서비스의 안전장치 대부분은 `NODE_ENV === 'production'` 일 때만 켜진다.
 * 배포에서 그 변수 하나를 빠뜨리면 서명키 검사·DB 준비 검사·개발계정 검사가
 * **전부 조용히 꺼진 채로** 정상 기동한다. 아무 경고도 나오지 않는다.
 *
 * 그래서 배포 전에 사람이 아니라 스크립트가 확인한다.
 *
 * 쓰는 법
 * -----
 *   node tools/launch-check.mjs                     # 현재 환경변수로 점검
 *   node tools/launch-check.mjs --env prod.env      # 파일을 읽어 점검
 *   BASE=https://api.example node tools/launch-check.mjs   # 살아 있는 서버도 함께 점검
 *
 * 종료코드
 * ------
 *   0 = 런칭 가능    1 = 차단 항목 있음
 *
 * ★ 이 도구는 "있으면 통과" 로 판단하지 않는다. 값이 있어도 개발용 기본값이면
 *   막는다 — 그것이 실제로 겪은 사고 형태다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { argv, env as processEnv, exit } from 'node:process';

// ---- 결과 수집 ----

const blockers = [];   // 이대로 런칭하면 돈·데이터·법적 문제가 생기는 것
const warnings = [];   // 런칭은 되나 곧 문제가 되는 것
const passes = [];

const block = (what, why) => blockers.push({ what, why });
const warn = (what, why) => warnings.push({ what, why });
const pass = (what) => passes.push(what);

// ---- 환경변수 읽기 ----

let env = { ...processEnv };

const fileFlag = argv.indexOf('--env');
if (fileFlag >= 0 && argv[fileFlag + 1]) {
  const path = argv[fileFlag + 1];
  if (!existsSync(path)) {
    console.error(`env 파일을 찾을 수 없습니다: ${path}`);
    exit(1);
  }
  /*
     파일 파싱.

     ★ 값을 출력하지 않는다. 이 파일에는 서명키와 API 시크릿이 있다.
       점검 결과에 키 이름만 쓴다.
  */
  const parsed = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    parsed[m[1]] = v;
  }
  // 파일 값이 우선한다 — 점검 대상은 배포에 쓸 파일이다.
  env = { ...processEnv, ...parsed };
  console.log(`env 파일: ${path} (${Object.keys(parsed).length}개 키)`);
}

const has = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
const val = (k) => (has(k) ? env[k].trim() : '');

// ---- 1. 프로덕션 표시 ----

/*
   ★★ 가장 중요한 항목.

     NODE_ENV 가 'production' 이 아니면 아래 모든 fail-closed 가드가 꺼진다:
       · assertProductionSigningKeys      (개발용 서명키로 기동)
       · assertProductionDatabaseReadiness (SQLite 로 기동)
       · assertNoDevFixtures               (개발 계정이 남아 있어도 기동)

     즉 이 한 줄이 빠지면 나머지 점검이 의미를 잃는다.
*/
if (val('NODE_ENV') === 'production') {
  pass('NODE_ENV=production — fail-closed 가드가 켜진다');
} else {
  block(
    'NODE_ENV 가 production 이 아니다',
    `현재 값: ${val('NODE_ENV') || '(없음)'}. 이 값이 아니면 서명키 검사·DB 준비 검사·` +
      '개발계정 검사가 모두 꺼진 채로 정상 기동한다. 경고도 나오지 않는다.',
  );
}

// ---- 2. 서명키 ----

/*
   세션·CSRF 서명키.

   ★ 개발용 기본값이 그대로 쓰이면 누구나 세션을 위조할 수 있다.
     길이만 보지 않고 "개발 티가 나는 값" 도 막는다.
*/
const DEV_KEY_HINTS = ['dev', 'test', 'change', 'example', 'secret', 'placeholder', 'local'];

/*
   ★★ 이름은 코드가 실제로 읽는 것과 같아야 한다.
     이전에 이 검사는 SESSION_SIGNING_KEY / CSRF_SIGNING_KEY 를 요구했는데
     둘 다 코드에 존재하지 않는 이름이었다. 그것을 채워도 서버는 여전히
     AUTH_CSRF_KEY 가 없다며 기동을 거부한다 — 점검을 통과했는데 뜨지 않으면
     원인을 찾는 데 시간이 걸리고, 점검 자체를 믿지 않게 된다.
     실제 필수 항목은 env.ts assertProductionSigningKeys() 가 정한다.

   ★ 세션 토큰에는 서명키가 없다. 무작위 토큰을 발급하고 서버에는 해시만
     저장하는 방식이다(불투명 토큰). 그래서 세션용 서명키를 요구하지 않는다.
*/
for (const key of ['AUTH_CSRF_KEY']) {
  if (!has(key)) {
    block(
      `${key} 없음`,
      'CSRF 토큰을 검증할 수 없다. 프로덕션 기동이 거부된다(env.ts fail-closed). ' +
        '인스턴스마다 임시 키를 만들면 여러 대로 늘렸을 때 CSRF 검증이 조용히 깨진다.',
    );
    continue;
  }
  const v = val(key);
  if (v.length < 32) {
    block(`${key} 가 너무 짧다 (${v.length}자)`, '32자 이상이어야 한다. 짧은 키는 추측할 수 있다.');
  } else if (DEV_KEY_HINTS.some((h) => v.toLowerCase().includes(h))) {
    // 값을 출력하지 않는다 — 어떤 단어가 걸렸는지만 알린다.
    block(
      `${key} 가 개발용 값처럼 보인다`,
      `'${DEV_KEY_HINTS.join("' '")}' 같은 낱말이 들어 있다. 무작위 값으로 새로 만들어야 한다: openssl rand -hex 32`,
    );
  } else {
    pass(`${key} 설정됨 (${v.length}자)`);
  }
}

// ---- 3. 데이터베이스 ----

if (!has('DATABASE_URL')) {
  block(
    'DATABASE_URL 없음',
    'PostgreSQL 없이는 공지·티켓·리퍼럴·포인트·법적문서가 동작하지 않는다. ' +
      '포인트는 부채이고 동의 기록은 법적 증거이므로 휘발성 저장소에 둘 수 없다.',
  );
} else {
  const u = val('DATABASE_URL');
  if (/localhost|127\.0\.0\.1/.test(u)) {
    warn('DATABASE_URL 이 로컬을 가리킨다', '컨테이너 안에서 로컬이면 정상일 수 있다. 배포 대상을 확인할 것.');
  }
  if (/dev-only|password|postgres:postgres/.test(u)) {
    block('DATABASE_URL 에 개발용 자격증명이 보인다', '운영 자격증명으로 바꿀 것.');
  } else {
    pass('DATABASE_URL 설정됨');
  }
}

// ---- 4. 오리진과 쿠키 ----

if (!has('CORS_ALLOWED_ORIGINS')) {
  block(
    'CORS_ALLOWED_ORIGINS 없음',
    '기본값이 개발 주소(localhost:5173/5174)다. 실제 도메인을 넣지 않으면 브라우저가 API 를 거부한다.',
  );
} else {
  const origins = val('CORS_ALLOWED_ORIGINS').split(',').map((x) => x.trim()).filter(Boolean);
  const local = origins.filter((o) => /localhost|127\.0\.0\.1/.test(o));
  const insecure = origins.filter((o) => o.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(o));
  if (local.length) {
    block(`CORS 허용 목록에 로컬 주소가 ${local.length}개 있다`, '운영에서는 제거할 것.');
  }
  if (insecure.length) {
    // http 로 쿠키를 보내면 중간에서 세션을 가져갈 수 있다.
    block(`CORS 허용 목록에 http:// 주소가 ${insecure.length}개 있다`, 'https 로 바꿀 것.');
  }
  if (!local.length && !insecure.length) pass(`CORS 허용 오리진 ${origins.length}개`);
}

if (val('AUTH_COOKIE_INSECURE') === 'true') {
  block(
    'AUTH_COOKIE_INSECURE=true',
    '세션 쿠키에서 Secure 플래그가 빠진다. 암호화되지 않은 연결로 쿠키가 나가면 세션을 탈취당한다.',
  );
} else {
  pass('세션 쿠키에 Secure 플래그가 붙는다');
}

// ---- 5. 메일 ----

/*
   메일 발송 수단.

   ★ 없으면 비밀번호 재설정과 이메일 인증이 **아무에게도 도달하지 않는다.**
     서버는 인메모리 큐로 폴백하고 조용히 계속 동작한다. 비밀번호를 잊은
     사용자는 영구히 잠긴다.
*/
const mailKeys = ['RESEND_API_KEY', 'MAIL_FROM', 'APP_BASE_URL'];
const missingMail = mailKeys.filter((k) => !has(k));
if (missingMail.length) {
  block(
    `메일 설정이 없다 (${missingMail.join(', ')})`,
    '비밀번호 재설정·이메일 인증 메일이 발송되지 않고 메모리에만 쌓인다. ' +
      '비밀번호를 잊은 사용자가 복구할 방법이 없다.',
  );
} else {
  pass('메일 설정 완료');
}

// ---- 6. 고객 문의 창구 ----

const supportEmail = val('SUPPORT_EMAIL');
if (!supportEmail) {
  block('SUPPORT_EMAIL 없음', '문의처가 없으면 문제가 생긴 사용자가 연락할 방법이 없다.');
} else if (/\.local$|\.test$|\.invalid$|\.localhost$|@example\./.test(supportEmail)) {
  // 예약 도메인은 메일이 도달하지 않는다 (RFC 2606 / 6761).
  block(
    'SUPPORT_EMAIL 이 메일을 받을 수 없는 도메인이다',
    '.local / .test / .invalid / example.com 은 예약된 이름이라 메일이 배달되지 않는다. 실제 주소로 바꿀 것.',
  );
} else {
  pass('SUPPORT_EMAIL 설정됨');
}

// ---- 7. 수익 경로 (KuCoin 브로커) ----

/*
   ★ 이것이 빠져도 서비스는 정상 동작한다. 그래서 놓치기 쉽다.
     빠지면 거래는 되지만 **리베이트가 0원**이다 — 수익이 조용히 새는 형태다.
*/
const brokerKeys = ['KUCOIN_BROKER_PARTNER', 'KUCOIN_BROKER_KEY', 'KUCOIN_BROKER_NAME'];
const missingBroker = brokerKeys.filter((k) => !has(k));
if (missingBroker.length === brokerKeys.length) {
  block(
    '브로커 자격증명이 전부 없다',
    '거래는 정상 동작하지만 리베이트가 0원이다. 이 서비스의 수익 경로가 닫힌 상태로 런칭하게 된다. ' +
      '세 값이 모두 있어야 서명이 붙는다. ' +
      'KuCoin 브로커 프로그램에 신청해 승인받아야 발급되며, 승인 전에는 거래량이 아무리 많아도 ' +
      '커미션이 계산되지 않는다. 승인 상태는 /admin/fees 에서 확인할 수 있다.',
  );
} else if (missingBroker.length) {
  block(
    `브로커 자격증명 일부 누락 (${missingBroker.join(', ')})`,
    '세 값이 모두 있어야 브로커 서명이 붙는다. 하나라도 없으면 리베이트가 0원이다.',
  );
} else {
  pass('브로커 자격증명 3종 설정됨 (선물)');
}

/*
   현물 브로커 자격증명.

   ★★ KuCoin 은 **현물과 선물에 서로 다른 자격증명**을 발급한다.
     (실제 승인 통보에 Spot / Futures 두 세트가 함께 온다)

     선물 값으로 현물 주문에 서명하면 서명은 만들어지지만 그 거래가 우리에게
     귀속되지 않는다. 오류도 나지 않고 화면도 정상이라 "리베이트가 0원" 으로만
     나타난다.

   ★ 지금은 현물 어댑터가 없으므로 **차단이 아니라 경고**다. 현물 거래를 열
     때 이 항목이 통과인지 먼저 확인해야 한다.
*/
const spotBrokerKeys = ['KUCOIN_BROKER_SPOT_PARTNER', 'KUCOIN_BROKER_SPOT_KEY', 'KUCOIN_BROKER_SPOT_NAME'];
const missingSpotBroker = spotBrokerKeys.filter((k) => !has(k));
if (missingSpotBroker.length === spotBrokerKeys.length) {
  warn(
    '현물 브로커 자격증명이 없다 (현물 거래를 열면 리베이트가 0원)',
    '현물은 선물과 다른 자격증명을 쓴다. 지금은 현물 어댑터가 없어 문제가 되지 않지만, ' +
      '현물을 열기 전에 KUCOIN_BROKER_SPOT_PARTNER / _KEY / _NAME 을 넣어야 한다. ' +
      '선물 값을 그대로 쓰면 거래가 귀속되지 않으면서 오류도 나지 않는다.',
  );
} else if (missingSpotBroker.length) {
  block(
    `현물 브로커 자격증명 일부 누락 (${missingSpotBroker.join(', ')})`,
    '일부만 있으면 서명이 붙지 않는다. 세 값을 모두 넣거나, 현물을 열지 않을 것이면 셋 다 비워 둘 것.',
  );
} else {
  pass('브로커 자격증명 3종 설정됨 (현물)');
}

/*
   KuCoin Fast API (OAuth) — 이용자 키 자동 연결.

   ★ 차단이 아니라 경고다. 없어도 서비스는 동작하고 리베이트도 정상이다.
     다만 이용자가 KuCoin 에서 키를 손으로 만들어야 하므로 가입 단계에서
     이탈이 생기고, 실수로 출금 권한을 켤 위험도 있다.

   ★ client_id 는 브로커 승인과 **별개 신청**이다(IP 목록 + Redirect URL 제출).
     도메인이 정해진 뒤에만 신청할 수 있으므로 런칭을 막지는 않는다.
*/
const oauthKeys = ['KUCOIN_OAUTH_CLIENT_ID', 'KUCOIN_OAUTH_REDIRECT_URI'];
const missingOauth = oauthKeys.filter((k) => !has(k));
if (missingOauth.length === oauthKeys.length) {
  warn(
    'KuCoin Fast API 가 꺼져 있다 (이용자가 API 키를 손으로 만들어야 한다)',
    '켜면 "KuCoin 으로 연결" 한 번으로 키가 자동 발급된다. client_id 는 브로커 승인과 별개 신청이며, ' +
      'KuCoin 폼에 (1) Fast API 요청용 서버 IP (2) 거래용 서버 IP (3) OAuth Redirect URL 을 제출해야 발급된다. ' +
      '도메인이 정해진 뒤에 신청할 것.',
  );
} else if (missingOauth.length) {
  block(
    `KuCoin Fast API 설정 일부 누락 (${missingOauth.join(', ')})`,
    '둘 다 있어야 기능이 등록된다. 반쯤 설정하면 이용자가 KuCoin 승인 화면까지 갔다가 콜백에서 실패하고, ' +
      '그 사이 KuCoin 계정에는 우리 이름의 키가 만들어져 남는다. 쓰지 않을 것이면 둘 다 비워 둘 것.',
  );
} else {
  pass('KuCoin Fast API 설정됨 (이용자 한 번 클릭으로 키 연결)');

  /*
     ★ Redirect URI 는 KuCoin 에 제출한 값과 정확히 같아야 한다. 흔한 실수를
       두 가지만 잡는다: http(로컬) 그대로 배포 / 경로 오타.
  */
  const uri = String(val('KUCOIN_OAUTH_REDIRECT_URI') || '');
  if (!uri.startsWith('https://')) {
    block(
      'KUCOIN_OAUTH_REDIRECT_URI 가 https 가 아니다',
      'OAuth 콜백에는 인증 코드가 담긴다. 평문으로 오가면 그 코드를 가로채 이용자 계정에 키를 붙일 수 있다.',
    );
  }
  if (!uri.includes('/api/exchanges/kucoin/oauth/callback')) {
    warn(
      'KUCOIN_OAUTH_REDIRECT_URI 경로가 예상과 다르다',
      `서버가 처리하는 경로는 /api/exchanges/kucoin/oauth/callback 이다. 현재 값: ${uri}`,
    );
  }
}

// ---- 8. 거래소 계정 ----

const kucoinKeys = ['KUCOIN_API_KEY', 'KUCOIN_API_SECRET', 'KUCOIN_API_PASSPHRASE'];
const missingKucoin = kucoinKeys.filter((k) => !has(k));
if (missingKucoin.length) {
  /*
     ★★ 운영자 키가 없으면 **브로커 정산을 조회할 수 없다.**

       전에는 "서버 키가 없어도 서비스는 성립한다" 고만 적었다. 시세와 사용자
       거래에는 맞는 말이지만, 이 키는 **우리 수익을 확인하는 유일한 수단**이다.
       없으면 리베이트가 들어오는지 아닌지 알 방법이 없다 — 몇 주 동안 0원인
       것을 모른 채 지날 수 있다.
  */
  block(
    `운영자 KuCoin 키 누락 (${missingKucoin.join(', ')})`,
    '브로커 정산(커미션·리베이트·거래자 목록)을 조회할 수 없다. 우리 수익이 실제로 ' +
      '들어오는지 확인할 수단이 없는 상태로 런칭하게 된다. 시세와 사용자 거래는 ' +
      '이 키 없이도 동작하지만, 수익 확인은 불가능하다.',
  );
} else {
  pass('운영자 KuCoin 키 설정됨 — 브로커 정산 조회 가능');
}

// ---- 9. 추천 링크 ----

/*
   거래소 가입 추천 링크.

   ★ 없으면 가입은 되지만 우리에게 귀속되지 않아 수익이 0 이 된다.
     조용히 새기 때문에 알아채기 어렵다.
*/
const refKeys = Object.keys(env).filter((k) => k.startsWith('EXCHANGE_REFERRAL_URL_'));
const envRefCount = refKeys.length + (has('KUCOIN_REFERRAL_URL') ? 1 : 0);

/*
   ★ 환경설정이 비어 있어도 **코드에 확인된 기본값**이 있으면 링크는 동작한다.

     전에는 환경설정만 보고 "설정되지 않았다" 고 경고했다. 카탈로그
     (apps/api/src/exchanges/exchange-catalog.ts) 의 referralConfirmed 항목이
     기본값으로 쓰이도록 바뀐 뒤에는 그 경고가 거짓이 된다. 거짓 경고가 쌓이면
     진짜 경고를 무시하게 되므로, 실제 출처를 함께 읽는다.

   ★ 확인되지 않은 항목(자리표시자)은 세지 않는다. 그것으로 가입이 일어나면
     정상 가입되고 리베이트만 0 이 된다.
*/
let catalogRefs = [];
try {
  /*
     도구는 저장소 루트에서 실행하는 것을 전제로 한다(다른 검사들과 같은 규칙).
     경로를 찾지 못하면 조용히 환경설정만으로 판단한다 — 이 검사 하나 때문에
     런칭 점검 전체가 멈추면 안 된다.
  */
  const src = readFileSync(new URL('../apps/api/src/exchanges/exchange-catalog.ts', import.meta.url), 'utf8');
  // id 와 referralConfirmed 가 같은 항목 블록에 있는지 본다.
  for (const block of src.split(/\n\s*\{\s*\n/)) {
    if (!/referralConfirmed:\s*true/.test(block)) continue;
    const id = block.match(/\bid:\s*'([a-z0-9_-]+)'/);
    const url = block.match(/\breferral:\s*'(https:\/\/[^']+)'/);
    if (id && url && !/QUANTUM/i.test(url[1])) catalogRefs.push(`${id[1]} → ${url[1]}`);
  }
} catch {
  // 카탈로그를 읽을 수 없으면 환경설정만으로 판단한다.
}

if (!envRefCount && !catalogRefs.length) {
  warn(
    '거래소 추천 링크가 설정되지 않았다',
    '사용자가 거래소에 가입해도 우리에게 귀속되지 않아 리베이트가 발생하지 않는다.',
  );
} else if (envRefCount) {
  pass(`추천 링크 ${envRefCount}개 설정됨 (환경설정)`);
} else {
  pass(`추천 링크 ${catalogRefs.length}개 (코드의 확인된 기본값): ${catalogRefs.join(', ')}`);
}

// ---- 10. 브랜드 ----

if (!has('BRAND_NAME')) {
  warn('BRAND_NAME 없음', '기본값으로 표시된다. 상호가 정해졌으면 넣을 것.');
} else {
  pass(`BRAND_NAME=${val('BRAND_NAME')}`);
}

// ---- 11. 살아 있는 서버 점검 (선택) ----

const base = val('BASE');
if (base) {
  console.log(`\n서버 점검: ${base}`);
  try {
    const res = await fetch(base + '/index.html', { redirect: 'manual' });
    const csp = res.headers.get('content-security-policy');
    if (csp) pass('CSP 헤더 있음');
    else block('CSP 헤더 없음', '스크립트·연결 대상을 제한하지 않는다.');

    if (res.headers.get('strict-transport-security')) pass('HSTS 헤더 있음');
    else warn('HSTS 헤더 없음', 'https 를 강제하지 않는다.');

    if ((res.headers.get('x-frame-options') || '').toUpperCase() === 'DENY') {
      pass('X-Frame-Options: DENY');
    } else {
      warn('X-Frame-Options 가 DENY 가 아니다', '우리 화면을 남의 사이트에 끼워 클릭을 유도할 수 있다.');
    }

    /*
       법적 문서 게시 여부.

       ★ 회원가입에서 약관 동의를 받는다. 약관이 게시되지 않았으면 그 동의는
         아무것도 가리키지 않는다.
    */
    const legal = await fetch(base + '/api/legal').then((r) => r.json()).catch(() => null);
    if (legal && legal.available) {
      const kinds = new Set((legal.documents || []).map((d) => d.kind));
      const missing = ['terms', 'privacy'].filter((k) => !kinds.has(k));
      if (missing.length) {
        block(
          `법적 문서 미게시 (${missing.join(', ')})`,
          '회원가입에서 이 문서들에 대한 동의를 받는다. 게시되지 않으면 그 동의는 아무것도 가리키지 않는다.',
        );
      } else {
        pass('이용약관·개인정보처리방침 게시됨');
      }
    } else {
      warn('법적 문서 상태를 확인할 수 없다', 'PostgreSQL 백엔드가 필요하다.');
    }
  } catch (e) {
    warn('서버에 연결할 수 없다', String(e.message || e).slice(0, 120));
  }
}

// ---- 결과 ----

const line = (n) => '─'.repeat(n);

console.log('\n' + line(72));
console.log(`통과 ${passes.length}개 · 차단 ${blockers.length}개 · 경고 ${warnings.length}개`);
console.log(line(72));

if (blockers.length) {
  console.log('\n■ 런칭 차단 — 이대로 배포하면 안 됩니다\n');
  blockers.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.what}`);
    console.log(`     ${b.why}\n`);
  });
}

if (warnings.length) {
  console.log('\n□ 경고 — 런칭은 되지만 확인이 필요합니다\n');
  warnings.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.what}`);
    console.log(`     ${w.why}\n`);
  });
}

if (passes.length) {
  console.log('\n✓ 확인된 항목\n');
  passes.forEach((p) => console.log(`  · ${p}`));
}

console.log('');
if (blockers.length) {
  console.log(`런칭할 수 없습니다 — 차단 항목 ${blockers.length}개를 해결해야 합니다.`);
  exit(1);
}
console.log('런칭 준비 완료.');
exit(0);
