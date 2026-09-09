/**
 * 구독 결제 시작·해지의 **중복 청구 방지**.
 *
 * ★★★ 감사에서 지적된 P0 두 건을 못 박는다. 둘 다 실제로 발생하고 있었고,
 *   `checkout` 을 시험하는 코드가 **0건**이어서 아무도 몰랐다.
 *
 *   ③ 기존 구독자가 결제하면 PayPal 구독이 **2개** 만들어졌다
 *       · PayPal 은 두 건 모두 매달 청구한다
 *       · 우리 DB 의 provider_ref 는 첫 번째뿐이다(markPending 이 활성 구독을
 *         덮지 않으려고 의도적으로 no-op)
 *       · 그래서 두 번째는 대조 대상도 아니고 **해지해도 멈지 않는다**
 *       · 화면에서만 막혀 있었다(3091717) — API 직접 호출이나 낡은 화면은 통과
 *
 *   ④ 'pending' 상태 해지가 **영구히 실패**했다
 *       · 결제 완료·대조 전 상태는 'pending' 이다
 *       · cancel 이 `WHERE status='active'` 라서 0행 → 500 CANCEL_FAILED
 *       · PayPal 정지는 성공했는데 화면은 "아무것도 변경되지 않았다" 고 거짓을 말한다
 *       · 다시 눌러도 같은 결과 → 고객은 해지할 방법이 없다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../subscriptions/subscription-routes.ts', import.meta.url), 'utf-8');
const repo = readFileSync(new URL('../subscriptions/subscription-repo.ts', import.meta.url), 'utf-8');

/** 주석을 걷어낸 코드만 본다 — 설명 문구가 검사를 통과시키면 안 된다. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('③ 기존 구독자에게 두 번째 PayPal 구독을 만들지 않는다', () => {
  const checkoutAt = routes.indexOf("app.post('/me/subscription/checkout'");
  const seg = codeOnly(routes.slice(checkoutAt, checkoutAt + 6000));

  it('checkout 이 활성 구독을 서버에서 막는다', () => {
    /*
       ★★ 화면만 막는 것으로는 부족하다. API 를 직접 부르거나 화면이 낡으면 통과한다.
    */
    expect(checkoutAt, 'checkout 라우트를 찾지 못했다').toBeGreaterThan(-1);
    expect(seg, '활성 구독 검사가 없다').toContain('ALREADY_SUBSCRIBED');
    expect(seg, 'entitled 를 보지 않는다').toContain('cur.row.entitled');
  });

  it('★ 검사가 PayPal 구독 생성보다 앞에 있다', () => {
    /*
       ★★★ 뒤에 있으면 이미 PayPal 에 구독이 만들어진 뒤다 — 막아도 청구가 시작된다.
    */
    const guard = seg.indexOf('ALREADY_SUBSCRIBED');
    const create = seg.indexOf('createSubscription(');
    expect(guard).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(guard, '검사가 PayPal 구독 생성보다 뒤에 있다').toBeLessThan(create);
  });

  it('★★ 기록에 실패하면 PayPal 구독을 되돌린다 — 유령 구독 방지', () => {
    /*
       ★★★ 경합은 검사만으로 막을 수 없다(두 창에서 동시 클릭, 대조 작업이 그 사이에
         활성화). 기록 없이 넘어가면 PayPal 에는 구독이 있고 우리엔 단서가 없다 —
         대조도 해지도 안 되는 **유령 구독**이 되어 매달 청구된다.
    */
    expect(seg, '기록 여부를 보지 않는다').toContain('const recorded = await d.repo.markPending');
    expect(seg, '기록 실패 시 되돌리지 않는다').toMatch(/if \(!recorded\)/);
    expect(seg, '되돌릴 때 PayPal 취소를 부르지 않는다').toMatch(/if \(!recorded\)[\s\S]{0,800}cancelSubscription\(/);
  });

  it('markPending 이 기록 여부를 사실대로 돌려준다', () => {
    /*
       ★★ 예전에는 무조건 true 였다. `WHERE status <> 'active'` 로 아무 일도 하지
         않았을 때도 "기록했다" 고 답해서, 호출자가 되돌릴 기회를 잃었다.
    */
    const at = repo.indexOf('async markPending');
    expect(at).toBeGreaterThan(-1);
    const mp = codeOnly(repo.slice(at, at + 2200));
    expect(mp, 'rowCount 를 보지 않는다').toContain('(r.rowCount ?? 0) > 0');
  });
});

describe("④ 'pending' 구독도 해지된다", () => {
  it('cancel 이 active 와 pending 을 함께 본다', () => {
    /*
       ★★★ 'active' 만 보면 결제 직후(대조 전) 해지가 **영구히 실패**한다.
         PayPal 정지는 성공하는데 우리 기록만 0행 → 500 → 화면은
         "아무것도 변경되지 않았다" 는 거짓 응답.
    */
    const at = repo.indexOf('async cancel');
    expect(at).toBeGreaterThan(-1);
    const seg = codeOnly(repo.slice(at, at + 2000));
    expect(seg, 'pending 이 해지 대상에서 빠져 있다').toContain("status IN ('active', 'pending')");
  });

  it('해지 라우트가 pending 을 "해지할 것 없음" 으로 막지 않는다', () => {
    /*
       ★ 라우트는 planCode 가 'free' 인 경우만 막는다. pending 행의 plan_code 는
         실제 플랜('pro' 등)이므로 통과한다. 그 성질에 의존하므로 못 박는다.
    */
    const at = routes.indexOf("app.post('/me/subscription/cancel'");
    expect(at).toBeGreaterThan(-1);
    const seg = codeOnly(routes.slice(at, at + 1400));
    expect(seg).toContain("planCode === 'free'");
    expect(seg, 'entitled 로 막으면 pending 이 해지 불가가 된다').not.toContain('!read.row.entitled');
  });
});
