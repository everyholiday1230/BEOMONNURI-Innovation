import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkPlanFeature, gateErrorBody } from '../subscriptions/plan-gate';
import { FEATURE_SAVES, FEATURE_TOPUP } from '../subscriptions/plans';
import type { PgSubscriptionRepo } from '../subscriptions/subscription-repo';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   요금제 권한 게이트.

   ★★ 이 검사가 막는 것

     가격표와 서버가 갈라지는 것. "저장 가능" 을 유료 항목으로 팔면서 서버가 무료
     이용자에게도 열어 두면 구독할 이유가 없고, 반대로 유료 고객을 막으면 돈을 받고
     기능을 주지 않는 것이 된다.

   ★★ 그리고 **모르는 것을 열어 주지 않는 것.**

     구독을 확인할 수 없을 때(저장소 없음·조회 실패) 유료 기능을 열면 돈을 받지 않고
     원가를 쓴다. 다만 '요금제에 없음' 과 '확인 불가' 는 고객이 할 일이 다르므로
     구별해 말해야 한다 — 확인 실패인데 업그레이드하라고 하면 안 된다.
*/

/** 조회 결과를 흉내내는 저장소. 실제 DB 없이 판단 로직만 검사한다. */
const fakeRepo = (row: Partial<{ planCode: string; entitled: boolean }>, ok = true): PgSubscriptionRepo =>
  ({
    get: async () => (ok
      ? {
        ok: true as const,
        row: {
          planCode: (row.planCode ?? 'free') as never,
          status: 'active' as const,
          currentPeriodStart: 0,
          currentPeriodEnd: 0,
          provider: null,
          entitled: Boolean(row.entitled),
        },
      }
      : { ok: false as const, reason: 'boom', row: {
        planCode: 'free' as never, status: 'expired' as const,
        currentPeriodStart: 0, currentPeriodEnd: 0, provider: null, entitled: false,
      } }),
  } as unknown as PgSubscriptionRepo);

describe('PLAN-GATE — 가격표와 서버 권한이 같은 것을 읽는다', () => {
  it('[1] 무료 이용자는 저장과 추가 구매가 막힌다', async () => {
    const repo = fakeRepo({ planCode: 'free', entitled: false });
    for (const feature of [FEATURE_SAVES, FEATURE_TOPUP]) {
      const g = await checkPlanFeature(repo, 'u1', feature);
      expect(g.allowed, `${feature} 가 무료에서 열렸다`).toBe(false);
      if (!g.allowed) expect(g.reason).toBe('PLAN_REQUIRED');
    }
  });

  it('[2] 유료 구독자는 열린다', async () => {
    const repo = fakeRepo({ planCode: 'basic', entitled: true });
    for (const feature of [FEATURE_SAVES, FEATURE_TOPUP]) {
      const g = await checkPlanFeature(repo, 'u1', feature);
      expect(g.allowed, `${feature} 가 유료에서 막혔다`).toBe(true);
    }
  });

  it('[3] 기간이 끝난 유료 플랜은 무료로 떨어진다', async () => {
    /*
       ★★ 플랜 코드만 보고 판단하면, 결제가 끊긴 뒤에도 유료 기능이 열린 채로 남는다.
         entitled(기간 기준)를 봐야 한다.
    */
    const repo = fakeRepo({ planCode: 'elite', entitled: false });
    const g = await checkPlanFeature(repo, 'u1', FEATURE_SAVES);
    expect(g.allowed, '만료된 구독으로 저장이 열렸다').toBe(false);
    expect(g.planCode).toBe('free');
  });

  it('[4] 확인할 수 없으면 막되, 요금제 문제와 구별해 말한다', async () => {
    /* 저장소가 없는 경우 */
    const g1 = await checkPlanFeature(undefined, 'u1', FEATURE_SAVES);
    expect(g1.allowed).toBe(false);
    if (!g1.allowed) expect(g1.reason).toBe('UNVERIFIED');

    /* 조회가 실패한 경우 */
    const g2 = await checkPlanFeature(fakeRepo({}, false), 'u1', FEATURE_SAVES);
    expect(g2.allowed).toBe(false);
    if (!g2.allowed) expect(g2.reason).toBe('UNVERIFIED');

    /*
       ★ 두 응답의 코드가 달라야 한다. 같으면 확인 실패인데 고객이 결제하려 한다.
    */
    if (!g1.allowed && !g2.allowed) {
      expect(gateErrorBody(g1).error.code).toBe('PLAN_UNVERIFIED');
      const planReq = await checkPlanFeature(fakeRepo({ planCode: 'free' }), 'u1', FEATURE_SAVES);
      if (!planReq.allowed) expect(gateErrorBody(planReq).error.code).toBe('PLAN_REQUIRED');
    }
  });

  it('[5] 게이트가 포인트 차감보다 먼저 걸린다', () => {
    /*
       ★★ 차감 후 막으면 포인트는 나가고 결과가 없다. 순서가 뒤집히면 고객이 돈을 잃는다.
         저장 라우트에서 게이트가 spendMetered 보다 앞에 있어야 한다.
    */
    for (const f of ['apps/api/src/saved-routes.ts', 'apps/api/src/user-strategy-routes.ts']) {
      const src = read(f);
      const gateAt = src.indexOf('checkPlanFeature');
      const spendAt = src.indexOf('spendMetered');
      expect(gateAt, `${f}: 게이트가 없다`).toBeGreaterThan(0);
      expect(spendAt, `${f}: 차감이 없다`).toBeGreaterThan(0);
      expect(gateAt, `${f}: 차감이 게이트보다 먼저다 — 포인트만 빠진다`).toBeLessThan(spendAt);
    }
  });

  it('[6] 추가 구매 라우트 전부에 게이트가 걸려 있다', () => {
    /*
       ★ 하나라도 빠지면 그 경로로 무료 이용자가 살 수 있다. PayPal 만 막고 USDT 를
         열어 두는 식의 누락이 실제로 쉽다.
    */
    const src = read('apps/api/src/payment-routes.ts');
    const routes = ['/me/topup/paypal/create', '/me/topup/toss/create', '/me/topup/usdt/create'];
    for (const r of routes) {
      const at = src.indexOf(`app.post('${r}'`);
      expect(at, `${r} 라우트가 없다`).toBeGreaterThan(0);
      /* 라우트 시작부터 다음 라우트까지 사이에 게이트가 있어야 한다. */
      const nextAt = src.indexOf('app.post(', at + 10);
      const seg = src.slice(at, nextAt > 0 ? nextAt : src.length);
      expect(seg, `${r}: 추가 구매 게이트가 없다`).toMatch(/topupGate/);
    }
    /* ★ 화면이 섹션을 숨길 수 있게 권한을 응답에 넣어야 한다. */
    expect(src).toMatch(/topupAllowed/);
  });

  it('[7] 화면이 권한 없을 때 구매 카드를 그리지 않는다', () => {
    /*
       ★ 카드를 보여주고 누르면 402 를 주는 것은 나쁘다 — 고객은 결제하려고 카드를 꺼낸다.
    */
    const src = read('src/pages-points.jsx');
    expect(src, '권한을 보지 않는다').toMatch(/topup\.topupAllowed/);
    expect(src, '권한 없을 때 이유를 말하지 않는다').toMatch(/pt_topup_needs_plan/);
    expect(src, '확인 불가를 구별하지 않는다').toMatch(/pt_topup_unverified/);

    /* ★ 실패를 '구매 가능' 으로 바꾸지 않아야 한다. */
    const api = read('src/api-client.js');
    const at = api.indexOf('topupPackages');
    const seg = api.slice(at, at + 900);
    expect(seg, '조회 실패 시 구매를 허용한다').toMatch(/topupAllowed: false/);
  });
});
