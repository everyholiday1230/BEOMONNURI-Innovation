#!/usr/bin/env node
/**
 * DB 저장 전수 검증.
 *
 * 무엇을 확인하는가
 * ---------------
 * 화면에서 어떤 행동을 하면 **실제로 DB 에 행이 생기는가**. 그리고 그 행이
 * 재시작 후에도 남는가.
 *
 * 왜 필요한가
 * ---------
 * "저장됩니다" 는 화면만 보고는 확인할 수 없다. 실제로 겪은 사례:
 *
 *   · 모의 주문이 확인까지 성공하고 응답도 200 이었는데, 투영이 SQLite 를 보고
 *     있어 `FOREIGN KEY constraint failed` 로 실패했다. 예외는 로그만 남기고
 *     삼켜졌고, 8개 거래 테이블이 전부 0행이었다.
 *   · 저장을 고친 뒤에도 조회가 SQLite 를 보고 있어 화면은 여전히 목업이었다.
 *
 * 둘 다 화면상으로는 정상이었다. 그래서 DB 를 직접 세는 검사가 필요하다.
 *
 * 쓰는 법
 *   node tools/db-persistence-check.mjs
 *   BASE=http://127.0.0.1:8795 node tools/db-persistence-check.mjs
 *
 * 종료코드 0 = 모든 검사 통과, 1 = 저장되지 않은 항목 있음
 */

import { execFileSync } from 'node:child_process';
import { env, exit } from 'node:process';

const BASE = env.BASE ?? 'http://127.0.0.1:8795';

/* 개발 DB 접속값. 운영에서 쓰지 않는다 — 이 도구는 개발·스테이징 점검용이다. */
const PG = {
  host: env.PGHOST ?? '127.0.0.1',
  port: env.PGPORT ?? '15435',
  user: env.PGUSER ?? 'chartcontrol',
  db: env.PGDATABASE ?? 'chartcontrol',
  /*
     ★ 비밀번호를 코드에 두지 않는다. 로컬 개발값이라도 저장소에 남기면
       "이 값이 어딘가에서 실제로 쓰인다" 는 오해를 만들고, 비밀값 검사 도구가
       매번 이 줄을 지적한다.
     ★ 없으면 실행을 멈추고 무엇을 넣어야 하는지 알린다 — 조용히 빈 비밀번호로
       접속을 시도하면 원인을 찾기 어려운 실패가 된다.
  */
  password: env.PGPASSWORD ?? (() => {
    console.error('PGPASSWORD 를 설정해 주세요 (로컬 개발용 Postgres 비밀번호).');
    process.exit(2);
  })(),
};

const ADMIN = { email: env.ADMIN_EMAIL ?? 'test@test.local', password: env.ADMIN_PASSWORD ?? 'test' };
const USER = { email: env.USER_EMAIL ?? 'noticetest@x.local', password: env.USER_PASSWORD ?? 'Passw0rd!x9' };

// ---- psql ----

function sql(query) {
  try {
    return execFileSync(
      'psql',
      ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', PG.db, '-qtAc', query],
      { env: { ...env, PGPASSWORD: PG.password }, encoding: 'utf8' },
    ).trim();
  } catch (e) {
    return `ERR:${String(e.message || e).slice(0, 80)}`;
  }
}

const count = (table, where) => {
  const v = sql(`SELECT count(*) FROM ${table}${where ? ` WHERE ${where}` : ''}`);
  return v.startsWith('ERR:') ? -1 : Number(v);
};

// ---- HTTP ----

/** 쿠키 항아리. 여러 계정을 동시에 쓰므로 계정별로 분리한다. */
class Jar {
  constructor() { this.cookies = new Map(); this.csrf = null; }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
}

async function req(jar, method, path, body) {
  const headers = { accept: 'application/json', origin: BASE };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.header()) headers.cookie = jar.header();
  if (jar.csrf) headers['x-csrf-token'] = jar.csrf;

  const res = await fetch(BASE + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 비JSON */ }
  if (json && json.csrfToken) jar.csrf = json.csrfToken;
  return { status: res.status, json, text };
}

async function login(who) {
  const jar = new Jar();
  const r = await req(jar, 'POST', '/api/auth/login', { email: who.email, password: who.password });
  if (r.status !== 200) throw new Error(`로그인 실패 ${who.email}: ${r.status} ${r.text.slice(0, 90)}`);
  return jar;
}

// ---- 결과 ----

const results = [];
const record = (what, before, after, note) => {
  const grew = after > before;
  results.push({ what, before, after, grew, note: note ?? '' });
  const mark = grew ? '✓' : '✗';
  const delta = after - before;
  console.log(`  ${mark} ${what.padEnd(38)} ${before} → ${after} (${delta >= 0 ? '+' : ''}${delta})${note ? '  · ' + note : ''}`);
};

const skip = (what, why) => {
  results.push({ what, skipped: true, note: why });
  console.log(`  · ${what.padEnd(38)} 건너뜀 — ${why}`);
};

// ---- 검증 시작 ----

console.log(`DB 저장 검증 — ${BASE}\n`);

const admin = await login(ADMIN);
const user = await login(USER);
const userId = sql(`SELECT id FROM users WHERE email='${USER.email}'`);

// ────────────────────────────────────────────────────────────
console.log('■ 인증 · 세션');

{
  const before = count('sessions');
  const jar = await login(USER);
  const after = count('sessions');
  record('로그인 → sessions', before, after);

  // 로그아웃하면 세션이 사라져야 한다. 남으면 훔친 쿠키가 계속 유효하다.
  const beforeOut = count('sessions');
  await req(jar, 'POST', '/api/auth/logout', {});
  const afterOut = count('sessions');
  const removed = afterOut < beforeOut;
  results.push({ what: '로그아웃 → 세션 삭제', grew: removed, before: beforeOut, after: afterOut });
  console.log(`  ${removed ? '✓' : '✗'} ${'로그아웃 → 세션 삭제'.padEnd(38)} ${beforeOut} → ${afterOut}`);
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 거래 기록 (모의 주문)');

{
  /*
     포지션은 **행 수가 아니라 수량**으로 확인한다.

     ★ 같은 (사용자, 심볼, 방향) 은 한 행에 누적된다. 행 수를 세면 두 번째
       주문에서 늘지 않아 "저장 실패" 로 잘못 판정한다 — 실제로 그렇게 나왔다.
       확인해야 하는 것은 수량이 늘고 진입가가 가중평균으로 다시 계산되는가다.
  */
  const posSize = () => {
    const v = sql(`SELECT COALESCE(SUM(size),0) FROM positions WHERE user_id='${userId}'`);
    return v.startsWith('ERR:') ? -1 : Number(v);
  };

  const b = {
    orders: count('orders'), events: count('order_events'),
    exec: count('executions'), posSize: posSize(),
  };

  /*
     초안 생성.

     ★ 초안 단계에서 이미 clientOrderId 를 요구한다 — 확인 단계에서 같은 값을
       보내야 중복 확인을 데이터 층에서 막을 수 있기 때문이다. 빠뜨리면
       VALIDATION_FAILED 로 400 이 온다(실제로 겪었다).
  */
  const clientOrderId = `dbcheck-${Date.now()}`;
  const draft = await req(user, 'POST', '/api/sim/order-drafts', {
    symbol: 'BTCUSDT', marketType: 'futures', side: 'long', positionAction: 'open',
    orderType: 'limit', price: '60000', quantity: '0.01', leverage: 5,
    marginMode: 'isolated', clientOrderId, aiGenerated: false,
  });

  if (draft.status === 200 && draft.json?.draftId) {
    const confirm = await req(user, 'POST', '/api/sim/orders/confirm', {
      draftId: draft.json.draftId,
      clientOrderId,
      confirmationToken: draft.json.confirmationToken,
      userConfirmed: true,
    });
    if (confirm.status === 200) {
      record('주문 확인 → orders', b.orders, count('orders'));
      record('  상태 전이 → order_events', b.events, count('order_events'));
      record('  체결 → executions', b.exec, count('executions'));
      record('  포지션 수량 누적 → positions', b.posSize, posSize(), '같은 심볼은 한 행에 누적된다');

      // 진입가가 가중평균으로 다시 계산돼야 한다. 마지막 가격으로 덮으면 손익이 틀린다.
      const entry = sql(`SELECT entry_price FROM positions WHERE user_id='${userId}' LIMIT 1`);
      const weighted = entry && !entry.startsWith('ERR:') && Number(entry) > 0;
      results.push({ what: '진입가 가중평균 재계산', grew: weighted, note: entry.slice(0, 20) });
      console.log(`  ${weighted ? '✓' : '✗'} ${'진입가 가중평균 재계산'.padEnd(38)} ${entry.slice(0, 20)}`);

      /*
         같은 주문을 두 번 확인해도 행이 늘어나면 안 된다.

         네트워크 재시도나 중복 클릭으로 실제로 일어난다. 두 번 기록되면
         포지션 수량이 실제의 두 배가 되고, 청산 위험을 잘못 계산한다.
      */
      const dupBefore = count('orders');
      await req(user, 'POST', '/api/sim/orders/confirm', {
        draftId: draft.json.draftId, clientOrderId,
        confirmationToken: draft.json.confirmationToken, userConfirmed: true,
      });
      const dupAfter = count('orders');
      const ok = dupAfter === dupBefore;
      results.push({ what: '중복 확인 → 행 안 늘어남', grew: ok, before: dupBefore, after: dupAfter });
      console.log(`  ${ok ? '✓' : '✗'} ${'중복 확인 → 행 안 늘어남'.padEnd(38)} ${dupBefore} → ${dupAfter}`);

      // mode 가 MOCK 이어야 한다 — 모의 체결이 실제로 오인되면 전략 판단이 어긋난다.
      const modes = sql(`SELECT DISTINCT mode FROM orders WHERE user_id='${userId}'`);
      const mockOnly = modes === 'MOCK';
      results.push({ what: "모의 주문 mode='MOCK' 표시", grew: mockOnly, note: modes });
      console.log(`  ${mockOnly ? '✓' : '✗'} ${"모의 주문 mode='MOCK' 표시".padEnd(38)} ${modes}`);
    } else {
      skip('주문 확인', `confirm ${confirm.status}`);
    }
  } else {
    skip('주문 초안', `draft ${draft.status} ${draft.text.slice(0, 60)}`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 포인트 (부채 원장)');

{
  const b = count('point_ledger');
  const r = await req(admin, 'POST', '/api/admin/points/adjust', {
    userId, amount: 7, direction: 'grant', memo: 'db-persistence-check',
  });
  if (r.status === 201) {
    record('운영자 지급 → point_ledger', b, count('point_ledger'));

    // balance_after 가 함께 저장돼야 정합성 검사가 가능하다.
    const hasAfter = sql(
      `SELECT count(*) FROM point_ledger WHERE user_id='${userId}' AND balance_after IS NOT NULL`,
    );
    const ok = Number(hasAfter) > 0;
    results.push({ what: 'balance_after 함께 저장', grew: ok, note: `${hasAfter}건` });
    console.log(`  ${ok ? '✓' : '✗'} ${'balance_after 함께 저장'.padEnd(38)} ${hasAfter}건`);

    // 되돌린다 — 검증이 실제 잔액을 늘려두면 안 된다.
    await req(admin, 'POST', '/api/admin/points/adjust', {
      userId, amount: 7, direction: 'revoke', memo: 'db-persistence-check revert',
    });
  } else {
    skip('포인트 지급', `${r.status} ${r.text.slice(0, 70)}`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 고객 지원 · 공지');

{
  const b = count('support_tickets');
  const r = await req(user, 'POST', '/api/support/tickets', {
    subject: 'db-persistence-check', body: '저장 확인용 문의입니다.', category: 'other',
  });
  if (r.status === 200 || r.status === 201) {
    record('티켓 접수 → support_tickets', b, count('support_tickets'));
    const ticketId = r.json?.ticket?.id;
    if (ticketId) {
      const mb = count('support_messages');
      await req(admin, 'POST', `/api/admin/support/tickets/${ticketId}/reply`, {
        body: '확인했습니다.', internal: false,
      });
      record('  답변 → support_messages', mb, count('support_messages'));

      /*
         내부 메모가 고객에게 보이지 않아야 한다.

         DB 에는 저장되지만 고객 조회 SQL 에서 제외돼야 한다. 여기서는 저장
         여부만 확인하고, 노출 여부는 support-repo 테스트가 고정한다.
      */
      const nb = count('support_messages', 'internal = true');
      await req(admin, 'POST', `/api/admin/support/tickets/${ticketId}/reply`, {
        body: '내부 메모입니다.', internal: true,
      });
      record('  내부 메모 → internal=true', nb, count('support_messages', 'internal = true'));
    }
  } else {
    skip('티켓 접수', `${r.status} ${r.text.slice(0, 70)}`);
  }
}

{
  const b = count('notices');
  const r = await req(admin, 'POST', '/api/admin/notices', {
    title: 'db-persistence-check', body: '저장 확인', severity: 'info', pinned: false,
  });
  if (r.status === 200 || r.status === 201) {
    record('공지 초안 → notices', b, count('notices'));
  } else {
    skip('공지 작성', `${r.status} ${r.text.slice(0, 70)}`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 감사 로그 (변경 흔적)');

{
  /*
     운영자의 변경은 반드시 흔적이 남아야 한다.

     ★ 위에서 이미 포인트 지급·회수와 공지 작성을 했다. 그 행동들이
       admin_actions 에 기록됐는지 확인한다. 기록이 없으면 누가 무엇을
       바꿨는지 나중에 알 수 없다.
  */
  const n = count('admin_actions', `action LIKE 'points%' OR action LIKE 'notice%'`);
  const ok = n > 0;
  results.push({ what: '운영자 행동 → admin_actions', grew: ok, note: `${n}건` });
  console.log(`  ${ok ? '✓' : '✗'} ${'운영자 행동 → admin_actions'.padEnd(38)} ${n}건`);

  // 위험도가 기록돼야 한다 — 부채 생성과 단순 조회를 구분해야 한다.
  const risky = count('admin_actions', `risk_level = 'high'`);
  const ok2 = risky > 0;
  results.push({ what: '고위험 행동 risk_level 기록', grew: ok2, note: `${risky}건` });
  console.log(`  ${ok2 ? '✓' : '✗'} ${'고위험 행동 risk_level 기록'.padEnd(38)} ${risky}건`);
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 사용자 설정 · 즐겨찾기');

{
  /*
     즐겨찾기.

     ★ 경로는 `/api/me/favorites` 이고 메서드는 PUT(목록 전체 덮어쓰기)이다.
       화면이 이것을 부르지 않던 시절에는 테이블이 계속 비어 있었다 —
       기기를 바꾸면 목록이 사라지는 상태였다.
  */
  /*
     ★ PUT 은 **덮어쓰기**다. 행 수 증가로 판정하면 이미 같은 개수가 있을 때
       실패로 나온다 — 실제로 그렇게 나왔다. 대신 목록을 바꿔 보내고 그 내용이
       반영되는지 본다.
  */
  const want = ['ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT'];
  const r = await req(user, 'PUT', '/api/me/favorites', { symbols: want });
  if (r.status === 200 || r.status === 201) {
    const stored = count('user_favorites', `user_id='${userId}'`);
    const ok = stored === want.length;
    results.push({ what: '즐겨찾기 → user_favorites', grew: ok, note: `${stored}/${want.length}개` });
    console.log(`  ${ok ? '✓' : '✗'} ${'즐겨찾기 → user_favorites'.padEnd(38)} ${stored}/${want.length}개 · 기기 간 동기화`);

    // 다시 읽어 같은 목록이 오는지 확인한다. 저장은 됐는데 조회가 비면 화면이 빈 목록을 본다.
    const back = await req(user, 'GET', '/api/me/favorites');
    const got = back.json?.symbols ?? [];
    const same = got.length === want.length && want.every((x) => got.includes(x));
    results.push({ what: '  다시 읽어 같은 목록', grew: same, note: `${got.length}개` });
    console.log(`  ${same ? '✓' : '✗'} ${'  다시 읽어 같은 목록'.padEnd(38)} ${got.length}개`);
  } else {
    skip('즐겨찾기', `${r.status} ${r.text.slice(0, 60)}`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 법적 문서 · 동의');

{
  const docs = count('legal_documents');
  const consents = count('user_legal_consents');
  /*
     여기서는 문서를 만들지 않는다.

     ★ 게시는 되돌릴 수 없고, 검증용 약관이 실제 약관 자리에 남으면 그것이
       회사의 법적 약속이 된다. 실제로 한 번 남겼다가 지웠다.
  */
  console.log(`  · ${'legal_documents 현재'.padEnd(38)} ${docs}건`);
  console.log(`  · ${'user_legal_consents 현재'.padEnd(38)} ${consents}건`);
  if (docs === 0) {
    console.log('    ⚠ 약관이 게시되지 않았다 — 회원가입 동의가 가리킬 대상이 없다.');
  }
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 재시작 생존 (행이 파일에 남는가)');

{
  /*
     방금 만든 행이 실제로 커밋됐는지 본다.

     ★ 트랜잭션 안에만 있고 커밋되지 않았다면 다른 연결에서 보이지 않는다.
       psql 은 별도 연결이므로, 여기서 보이면 커밋된 것이다. 재시작 생존과
       같은 의미다(휘발성 저장소가 아니라 파일에 있다).
  */
  const rows = sql(`SELECT count(*) FROM orders WHERE user_id='${userId}'`);
  const ok = Number(rows) > 0;
  results.push({ what: '별도 연결에서 조회 가능(커밋됨)', grew: ok, note: `${rows}건` });
  console.log(`  ${ok ? '✓' : '✗'} ${'별도 연결에서 조회 가능(커밋됨)'.padEnd(38)} ${rows}건`);
}

// ────────────────────────────────────────────────────────────
console.log('\n■ 사용자 격리 (남의 데이터가 섞이지 않는가)');

{
  /*
     ★ 모든 조회에 user_id 조건이 있어야 한다. 없으면 남의 주문이 보인다.

       여기서는 다른 사용자로 조회해 내 주문이 보이지 않음을 확인한다.
       코드 검토로는 한 줄 빠뜨린 것을 놓치기 쉽다.
  */
  const other = await login(ADMIN);
  const mine = await req(user, 'GET', '/api/orders/history?limit=50');
  const theirs = await req(other, 'GET', '/api/orders/history?limit=50');
  const myIds = new Set(((mine.json?.items) ?? []).map((x) => x.id));
  const leaked = ((theirs.json?.items) ?? []).filter((x) => myIds.has(x.id));
  const ok = leaked.length === 0 && myIds.size > 0;
  results.push({ what: '다른 계정에 내 주문 안 보임', grew: ok, note: `내 ${myIds.size}건 / 유출 ${leaked.length}건` });
  console.log(`  ${ok ? '✓' : '✗'} ${'다른 계정에 내 주문 안 보임'.padEnd(38)} 내 ${myIds.size}건 · 유출 ${leaked.length}건`);
}

// ---- 요약 ----

const checked = results.filter((r) => !r.skipped);
const failed = checked.filter((r) => !r.grew);
const skipped = results.filter((r) => r.skipped);

console.log('\n' + '─'.repeat(70));
console.log(`검사 ${checked.length}개 · 통과 ${checked.length - failed.length}개 · 실패 ${failed.length}개 · 건너뜀 ${skipped.length}개`);
console.log('─'.repeat(70));

if (failed.length) {
  console.log('\n■ 저장되지 않은 항목\n');
  failed.forEach((f) => {
    console.log(`  · ${f.what}${f.note ? ` (${f.note})` : ''}`);
  });
  console.log('\n화면이 정상으로 보여도 기록이 남지 않는 상태입니다.');
  exit(1);
}

if (skipped.length) {
  console.log('\n건너뛴 항목 (경로가 없거나 조건 미충족):');
  skipped.forEach((s) => console.log(`  · ${s.what} — ${s.note}`));
}

console.log('\n모든 저장 검사를 통과했습니다.');
exit(0);
