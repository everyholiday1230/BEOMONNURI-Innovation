#!/usr/bin/env node
/*
  env-template-check — .env.production.example 이 실제 코드와 맞는지 검사한다.

  왜 필요한가:
    ★★ 실제로 겪은 문제 — 런칭 점검이 SESSION_SIGNING_KEY / CSRF_SIGNING_KEY 를
       요구했는데 코드에는 그런 이름이 없었다. 채워도 서버는 AUTH_CSRF_KEY 가
       없다며 기동을 거부한다. 점검을 통과했는데 뜨지 않으면 원인을 찾는 데
       시간이 걸리고, 그다음부터 점검을 믿지 않게 된다.

  두 방향을 본다:
    1. 템플릿에 있는데 코드가 읽지 않는 키  → 채워도 아무 효과가 없다 (오류)
    2. 프로덕션 필수인데 템플릿에 없는 키    → 빠뜨린 채 배포한다 (오류)

  이름만 본다. 값은 보지 않는다(템플릿에는 값이 없어야 한다).
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(root, '.env.production.example');

let errors = 0;
let warns = 0;
const bad = (m, why) => {
  errors++;
  console.log(`\n  ✗ ${m}`);
  if (why) console.log(`    ${why}`);
};
const warn = (m, why) => {
  warns++;
  console.log(`\n  ! ${m}`);
  if (why) console.log(`    ${why}`);
};

// ---- 템플릿에서 키 이름 뽑기 ----
const templateText = readFileSync(TEMPLATE, 'utf8');
const templateKeys = new Set();
const commentedKeys = new Set();
for (const line of templateText.split('\n')) {
  const active = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (active) {
    templateKeys.add(active[1]);
    // ★ 값이 들어 있으면 안 된다 — 저장소에 들어가는 파일이다.
    const v = line.slice(active[0].length).trim();
    // 엔드포인트·모드 기본값은 비밀이 아니므로 허용한다.
    const ALLOWED_DEFAULTS = /^(https:\/\/api|production|0\.0\.0\.0|8787|MOCK|false|KUCOIN_PUBLIC|ChartControl|qt_session|120000)/;
    if (v && !ALLOWED_DEFAULTS.test(v)) {
      bad(
        `템플릿에 값이 들어 있다: ${active[1]}`,
        '이 파일은 저장소에 들어간다. 실제 값은 .env.production 이나 배포 플랫폼 시크릿에 둔다.',
      );
    }
    continue;
  }
  const commented = /^#\s*([A-Z][A-Z0-9_]{3,})(=|\s{2,})/.exec(line);
  if (commented) commentedKeys.add(commented[1]);
}

// ---- 코드에서 읽는 키 이름 뽑기 ----
const codeKeys = new Set();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|mjs|js)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/(?:process\.)?env(?:ironment)?[.[]['"]?([A-Z][A-Z0-9_]{2,})['"]?\]?/g)) {
        codeKeys.add(m[1]);
      }
      // EXCHANGE_REFERRAL_URL_<ID> 처럼 접두사로 조립하는 것
      // ★ 실제 코드는 `const PREFIX = 'EXCHANGE_REFERRAL_URL_'` 를 선언하고
      //   startsWith(PREFIX) 로 순회한다. 그래서 문자열 리터럴이 `_` 로 끝나고
      //   대문자 env 이름 모양이면 접두사로 본다. 조립 표현식만 찾으면 놓친다.
      for (const m of text.matchAll(/['"`]([A-Z][A-Z0-9_]{3,}_)['"`]/g)) {
        codeKeys.add(m[1] + '*');
      }
    }
  }
};
walk(join(root, 'apps'));
walk(join(root, 'packages'));
walk(join(root, 'tools'));

const prefixes = [...codeKeys].filter((k) => k.endsWith('*')).map((k) => k.slice(0, -1));
const known = (key) => codeKeys.has(key) || prefixes.some((p) => key.startsWith(p));

console.log('배포 템플릿 검사');
console.log(`\n  템플릿 키 ${templateKeys.size}개 · 코드에서 읽는 키 ${codeKeys.size}개`);

// ---- 1. 템플릿에 있는데 코드가 읽지 않는 키 ----
const orphans = [...templateKeys].filter((k) => !known(k));
if (orphans.length > 0) {
  bad(
    `코드가 읽지 않는 키 ${orphans.length}개: ${orphans.join(', ')}`,
    '채워도 아무 효과가 없다. 이름이 틀렸거나 기능이 사라진 것이다.',
  );
} else {
  console.log('\n  ✓ 템플릿의 모든 키를 코드가 실제로 읽는다');
}

// ---- 2. 프로덕션 필수인데 템플릿에 없는 키 ----
/* env.ts 의 fail-closed 검사와 launch-check 가 요구하는 것.
   ★ 이 목록을 손으로 유지한다. 자동 추출은 조건문 안의 이름까지 정확히
     따라가기 어렵고, 틀린 자동화는 없는 것보다 나쁘다. */
const REQUIRED_IN_PRODUCTION = [
  'NODE_ENV',
  'AUTH_CSRF_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'CORS_ALLOWED_ORIGINS',
  'SUPPORT_EMAIL',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'APP_BASE_URL',
];
const missing = REQUIRED_IN_PRODUCTION.filter((k) => !templateKeys.has(k));
if (missing.length > 0) {
  bad(
    `프로덕션 필수인데 템플릿에 없다: ${missing.join(', ')}`,
    '템플릿만 보고 배포하면 빠뜨린다.',
  );
} else {
  console.log(`  ✓ 프로덕션 필수 ${REQUIRED_IN_PRODUCTION.length}개가 모두 템플릿에 있다`);
}

// ---- 3. 수익에 직결되는 키가 설명과 함께 있는지 ----
const REVENUE_KEYS = ['KUCOIN_BROKER_PARTNER', 'KUCOIN_BROKER_KEY', 'KUCOIN_BROKER_NAME'];
const missingRevenue = REVENUE_KEYS.filter((k) => !templateKeys.has(k));
if (missingRevenue.length > 0) {
  bad(
    `브로커 자격증명이 템플릿에 없다: ${missingRevenue.join(', ')}`,
    '이것이 없으면 거래는 되지만 리베이트가 0원이다. 템플릿에서 빠지면 아무도 채우지 않는다.',
  );
} else {
  console.log('  ✓ 브로커 자격증명 3종이 템플릿에 있다');
}

// ---- 4. 위험한 것이 활성 상태로 들어 있지 않은지 ----
const MUST_NOT_BE_ACTIVE = ['ADMIN_SEED', 'QT_DEV_SEED_EXT', 'AUTH_COOKIE_INSECURE', 'SQLITE_PATH'];
const dangerous = MUST_NOT_BE_ACTIVE.filter((k) => templateKeys.has(k));
if (dangerous.length > 0) {
  bad(
    `프로덕션에서 위험한 키가 활성 상태다: ${dangerous.join(', ')}`,
    '주석 처리하거나 "비어 있어야 하는 것" 목록으로 옮겨야 한다. ' +
      'AUTH_COOKIE_INSECURE 는 세션 쿠키에서 Secure 를 빼고, ADMIN_SEED 는 개발 계정을 만든다.',
  );
} else {
  console.log(`  ✓ 위험한 키 ${MUST_NOT_BE_ACTIVE.length}개가 활성 상태로 들어 있지 않다`);
}

// ---- 5. 실주문 스위치가 꺼진 채로 있는지 ----
const liveOrders = /^FEATURE_LIVE_ORDERS_ENABLED=(.*)$/m.exec(templateText);
const tradingMode = /^TRADING_MODE=(.*)$/m.exec(templateText);
if (liveOrders && liveOrders[1].trim() === 'true') {
  bad('템플릿이 실주문을 켜 둔 상태다', '복사해서 그대로 쓰면 검증 없이 실주문이 열린다.');
} else if (tradingMode && /LIVE/.test(tradingMode[1])) {
  bad('템플릿의 TRADING_MODE 가 LIVE 다', '기본값은 MOCK 이어야 한다.');
} else {
  console.log('  ✓ 실주문 스위치가 꺼진 기본값이다');
}

// ---- 6. 청산 감시 기본값 ----
const riskWatch = /^RISK_WATCH_ENABLED=(.*)$/m.exec(templateText);
if (!riskWatch) {
  warn('RISK_WATCH_ENABLED 가 템플릿에 없다', '실주문을 열 때 함께 켜야 하는 것이므로 함께 보여야 한다.');
} else {
  console.log('  ✓ 청산 감시 스위치가 템플릿에 있다');
}

console.log(`\n${'─'.repeat(60)}`);
if (errors > 0) {
  console.log(`  오류 ${errors}개${warns > 0 ? ` · 경고 ${warns}개` : ''}`);
  process.exit(1);
}
console.log(`  통과${warns > 0 ? ` · 경고 ${warns}개` : ''}`);
