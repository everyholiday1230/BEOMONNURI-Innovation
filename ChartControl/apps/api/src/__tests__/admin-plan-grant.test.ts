import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
   **운영자가 요금제를 직접 부여한다** — 결제 없이.

   ★★★ 왜 필요한가: 저장(전략·지표·신호)은 `plan_f_saves` 유료 기능이고 무료 플랜은
     `included: false` 라 402 로 막힌다. 실고객 6명이 전원 직원인 지금, 결제를 거치지
     않고 저장을 시험할 경로가 없었다.

   ★★★ **env 이메일 목록 같은 우회를 만들지 않았다.** 감사기록이 남지 않고 목록이
     코드·배포 설정에 흩어진다. 관리자 라우트는 권한·감사·알림이 이미 갖춰져 있다.
     이 시험이 그 선택을 지킨다 — 우회가 생기면 잡는다.
*/

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const admin = read('apps/api/src/admin/admin-routes.ts');
const idx = read('apps/api/src/index.ts');
const ui = read('src/pages-admin-more.jsx');
const client = read('src/api-client.js');

describe('관리자 요금제 부여 — 서버', () => {
  it('라우트가 있고 관리자 쓰기 권한을 요구한다', () => {
    expect(admin, '라우트가 없다').toMatch(/app\.post\('\/admin\/subscriptions\/grant'/u);
    const i = admin.indexOf("app.post('/admin/subscriptions/grant'");
    const body = admin.slice(i, admin.indexOf('\n  });', i));
    expect(body, '쓰기 가드가 없다').toMatch(/mutateGuard\(c, 'admin\.points\.write'\)/u);
  });

  /*
     ★★★ 이유 없는 부여는 감사할 수 없다. 화면이 막는 것과 별개로 **서버가** 막아야 한다 —
       API 를 직접 부르는 경로가 있기 때문이다.
  */
  it('이유를 필수로 받는다', () => {
    const i = admin.indexOf("app.post('/admin/subscriptions/grant'");
    const body = admin.slice(i, admin.indexOf('\n  });', i));
    expect(body, '이유 없이 통과시킨다').toMatch(/if \(!reason\)/u);
    expect(body, '이유가 왜 필요한지 알려주지 않는다').toMatch(/cannot be audited/u);
  });

  /*
     ★★★ 결제로 생긴 구독과 구별되어야 한다. 이것이 없으면 매출 집계에 결제 없는
       구독이 섞이고, 나중에 왜 이 계정이 유료인지 알 수 없다.
  */
  it("provider 를 'admin' 으로 남긴다 — 결제 구독과 섞이지 않게", () => {
    const i = admin.indexOf("app.post('/admin/subscriptions/grant'");
    const body = admin.slice(i, admin.indexOf('\n  });', i));
    expect(body, "provider: 'admin' 이 없다").toMatch(/provider: 'admin'/u);
    expect(body, 'providerRef 에 부여자·시각을 남기지 않는다')
      .toMatch(/providerRef: `admin:\$\{g\.a\.user\.id\}:\$\{now\}`/u);
  });

  it('감사기록과 알림을 남긴다', () => {
    const i = admin.indexOf("app.post('/admin/subscriptions/grant'");
    const body = admin.slice(i, admin.indexOf('\n  });', i));
    expect(body, '감사기록이 없다').toMatch(/action: 'subscription\.grant'/u);
    expect(body, '위험도를 높음으로 두지 않았다').toMatch(/riskLevel: 'high'/u);
    /* ★ 모르게 바뀌면 문의가 온다. 알림 실패가 부여를 되돌리지는 않는다. */
    expect(body, '사용자 알림이 없다').toMatch(/d\.notifications/u);
  });

  it('플랜 코드와 기간을 검증한다', () => {
    const i = admin.indexOf("app.post('/admin/subscriptions/grant'");
    const body = admin.slice(i, admin.indexOf('\n  });', i));
    expect(body, '플랜 코드를 검증하지 않는다').toMatch(/VALID\.includes\(planCode\)/u);
    /* ★ 무기한을 만들지 않는다 — 시험용으로 준 것이 영구히 남으면 안 된다. */
    expect(body, '기간 상한이 없다').toMatch(/days < 1 \|\| days > 3650/u);
    expect(body, '기본 기간이 없다').toMatch(/body\.days === undefined \? 30/u);
  });

  /*
     ★★ `subscriptionRepo` 는 이 라우터 등록보다 **아래에서** 선언된다(TS2448).
       getter 로 늦춰야 한다 — 값으로 넘기면 TDZ 로 부팅이 죽는다.
  */
  it('구독 저장소를 지연 접근으로 넘긴다', () => {
    /*
       ★★ **관리자 라우터 블록만 본다.** `subscriptionRepo` 는 다른 라우터에도 넘기는데
         그쪽은 선언 **뒤**라 값으로 넘겨도 안전하다. 파일 전체에서 찾으면 정상 코드를
         잡는다(실제로 처음에 그렇게 틀렸다).
    */
    const i = idx.indexOf('createAdminRouter({');
    expect(i, '관리자 라우터 등록을 찾지 못했다').toBeGreaterThan(0);
    const block = idx.slice(i, idx.indexOf('\n    );', i));
    expect(block, '관리자 라우터에 구독 저장소를 넘기지 않는다')
      .toMatch(/get subscriptions\(\) \{ return subscriptionRepo; \}/u);
    expect(block, '값으로 넘겨 TDZ 로 부팅이 죽는다')
      .not.toMatch(/\{ subscriptions: subscriptionRepo \}/u);

    /* ★ 선언이 정말 관리자 라우터보다 뒤에 있는지 확인한다 — 앞으로 옮기면 이 시험의 근거가 사라진다. */
    const declAt = idx.indexOf('const subscriptionRepo =');
    expect(declAt, '선언을 찾지 못했다').toBeGreaterThan(0);
    expect(declAt, '선언이 관리자 라우터보다 앞이면 getter 가 필요 없다 — 시험을 정리할 것')
      .toBeGreaterThan(i);
  });

  it('우회 경로(env 이메일 목록)를 만들지 않았다', () => {
    /*
       ★★★ 이 시험이 설계 선택을 지킨다. env 로 특정 이메일에 플랜을 주는 방식은
         감사기록이 없고 목록이 흩어진다.
    */
    const env = read('apps/api/src/env.ts');
    for (const bad of [/STAFF_PLAN/u, /PLAN_OVERRIDE/u, /FREE_SAVES_EMAILS/u, /BYPASS_PLAN/u]) {
      expect(env, `우회 env 가 생겼다: ${bad}`).not.toMatch(bad);
    }
    const gate = read('apps/api/src/subscriptions/plan-gate.ts');
    expect(gate, '게이트에 역할 우회가 생겼다').not.toMatch(/role === 'admin'|isStaff|bypass/u);
  });
});

describe('관리자 요금제 부여 — 화면', () => {
  it('API 함수가 있다', () => {
    expect(client, 'grantPlan 이 없다').toMatch(/grantPlan: function \(input\)/u);
    expect(client, '경로가 틀렸다').toMatch(/'\/api\/admin\/subscriptions\/grant'/u);
  });

  it('이유가 비면 버튼이 눌리지 않는다', () => {
    expect(ui, '이유 없이 누를 수 있다').toMatch(/disabled=\{planBusy \|\| !plan\.reason\.trim\(\)/u);
  });

  /*
     ★ free 로 되돌리는 것은 고객 화면의 기능이 즉시 사라지는 일이다. 포인트 회수와
       같은 기준으로 확인을 받는다.
  */
  it('free 로 회수할 때 확인을 받는다', () => {
    expect(ui, '회수 확인이 없다').toMatch(/plan\.code === 'free'[\s\S]{0,120}confirm/u);
  });

  it('기본값이 basic·30일이다 — 필요 이상으로 주지 않는다', () => {
    expect(ui, '기본값이 다르다').toMatch(/useState\(\{ code: 'basic', days: '30', reason: '' \}\)/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    const KEYS = ['apg_title', 'apg_note', 'apg_plan', 'apg_days', 'apg_reason_ph',
      'apg_apply', 'apg_applied', 'apg_failed', 'apg_revoke_confirm'];
    for (const f of readdirSync(dir)) {
      if (!/\.js$/u.test(f)) continue;
      const s = readFileSync(join(dir, f), 'utf8');
      /* 포인트 패널 문구가 있는 사전에만 요구한다 — 부분 사전을 억지로 채우지 않는다. */
      if (!s.includes('aup_title')) continue;
      for (const k of KEYS) if (!s.includes(k)) missing.push(`${f} ${k}`);
    }
    expect(missing, `문구가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });
});
