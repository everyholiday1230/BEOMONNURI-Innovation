import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_BASE_POINTS, AI_MIN_BALANCE } from '../points/ai-metering';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   가입 축하 포인트 — 신규 고객이 AI 를 쓸 수 있어야 한다.

   ★★ 왜 필요했는가 (운영 데이터로 확인한 사실)

     사용자 20명 중 포인트를 가진 사람이 2명(둘 다 운영자 계정)이었고 나머지 18명은
     전원 0 이었다. AI 실행에는 최소 300pt 가 필요하다. 즉 **모든 실제 고객이 AI
     코파일럿을 한 번도 쓸 수 없었다** — 이 제품의 핵심 기능이다.

     지급 경로는 운영자 수동(admin_grant) 하나뿐이었고, 포인트 주문 22건 중 결제 완료는
     0건(created 20 · failed 2), 가입 지급은 코드에 없었다. 신규 고객이 가입 직후 만나는
     것이 402 INSUFFICIENT_POINTS 였다.

   ★ 이 검사들은 그 상태로 되돌아가는 것을 막는다.
*/

describe('SIGNUP-GRANT — 신규 고객이 AI 를 실행할 수 있다', () => {
  it('[1] 기본 지급액이 최소 요구 잔액 이상이다', () => {
    /*
       ★★ 지급액이 최소치보다 작으면 지급해도 AI 가 돌지 않는다. 그것은 지급하지 않는
         것과 결과가 같으면서 원장만 더럽힌다.
    */
    const envSrc = read('apps/api/src/env.ts');
    const m = envSrc.match(/SIGNUP_GRANT_POINTS \?\? (\d+)/);
    expect(m, 'SIGNUP_GRANT_POINTS 기본값을 찾지 못했다').not.toBeNull();
    const def = Number(m![1]);
    expect(def).toBeGreaterThanOrEqual(AI_MIN_BALANCE);
    /* ★ 최소 1회는 확실히 돌아야 하고, 체험이 되려면 한 번보다는 많아야 한다. */
    expect(def).toBeGreaterThanOrEqual(AI_BASE_POINTS * 2);
  });

  it('[2] 잘못된 환경변수 값이 과다 지급으로 이어지지 않는다', () => {
    /*
       ★ 음수·NaN 은 0 으로 떨어뜨린다. 지급이 안 되는 쪽이 과다 지급보다 안전하다
         — 포인트는 원가가 걸린 재화다.
    */
    const envSrc = read('apps/api/src/env.ts');
    /* ★ 첫 번째 등장은 인터페이스 선언이다. 실제 값을 만드는 대입부를 봐야 한다. */
    const at = envSrc.lastIndexOf('signupGrantPoints:');
    const seg = envSrc.slice(at, at + 160);
    expect(seg, '음수를 막지 않는다').toMatch(/Math\.max\(0,/);
    expect(seg, '소수를 막지 않는다').toMatch(/Math\.trunc/);
    expect(seg, 'NaN 을 막지 않는다').toMatch(/\|\| 0/);
  });

  it('[3] 초대 코드와 무관하게 지급한다', () => {
    /*
       ★★ 기존 리퍼럴 보상은 `if (!referralRepo || !referralCode) return;` 뒤에 있었다.
         가입 지급을 그 뒤에 두면 초대 코드로 온 사람만 받는다 — 대부분의 고객은
         코드 없이 가입한다.
    */
    const idx = read('apps/api/src/index.ts');
    const start = idx.indexOf('onRegistered: async (userId, referralCode)');
    expect(start, 'onRegistered 를 찾지 못했다').toBeGreaterThan(0);
    const grantAt = idx.indexOf('signupGrantPoints', start);
    const earlyReturnAt = idx.indexOf('if (!referralRepo || !referralCode) return;', start);
    expect(grantAt).toBeGreaterThan(0);
    expect(earlyReturnAt).toBeGreaterThan(0);
    expect(grantAt, '가입 지급이 초대 코드 조기 반환 뒤에 있다').toBeLessThan(earlyReturnAt);
  });

  it('[4] 두 번 지급되지 않는다 — 멱등 키를 쓴다', () => {
    /*
       ★ (user_id, reason, ref_type, ref_id) UNIQUE 인덱스가 막는다. 실제로 두 번째
         삽입을 시도해 제약 위반을 확인했다.
    */
    const idx = read('apps/api/src/index.ts');
    const seg = idx.slice(idx.indexOf('signupGrantPoints > 0'), idx.indexOf('if (!referralRepo || !referralCode) return;'));
    expect(seg.length).toBeGreaterThan(200);
    expect(seg, '멱등 키가 없다').toMatch(/refType: 'signup_grant'/);
    expect(seg, '멱등 키에 사용자가 없다').toMatch(/refId: userId/);
  });

  it('[5] 지급 실패가 회원가입을 막지 않는다 — 그리고 조용히 넘기지 않는다', () => {
    /*
       ★★ 지급이 실패하면 그 고객은 AI 를 쓸 수 없다. 실패를 삼키면 아무도 그 사실을
         모른다 — 그 상태가 바로 이 문제의 원인이었다(지급 경로가 없다는 것을 아무도
         몰랐다). 그래서 가입은 유지하되 반드시 로그를 남긴다.
    */
    const idx = read('apps/api/src/index.ts');
    const seg = idx.slice(idx.indexOf('signupGrantPoints > 0'), idx.indexOf('if (!referralRepo || !referralCode) return;'));
    expect(seg, 'try/catch 가 없다 — 가입이 실패할 수 있다').toMatch(/catch/);
    expect(seg, '실패를 조용히 넘긴다').toMatch(/console\.error/);
    /* ★ 포인트 제도가 꺼져 있을 때도 알린다 — 지급이 안 되는 또 다른 경로다. */
    expect(seg, '제도가 꺼진 경우를 알리지 않는다').toMatch(/console\.warn/);
  });

  it('[6] 사유는 DB CHECK 제약이 허용하는 값이다', () => {
    /*
       ★★ point_ledger.reason 에 CHECK 제약이 있다(운영 DB 확인). 'signup_grant' 를
         reason 으로 쓰면 삽입이 거부되고, 그 실패는 삼켜지므로 **아무 일도 없었던 것처럼
         보인다.** 그래서 허용 목록에 있는 값을 쓰고 구분은 ref_type 으로 한다.
    */
    const idx = read('apps/api/src/index.ts');
    const seg = idx.slice(idx.indexOf('signupGrantPoints > 0'), idx.indexOf('if (!referralRepo || !referralCode) return;'));
    const reason = seg.match(/reason: '([a-z_]+)'/);
    expect(reason).not.toBeNull();

    const repoSrc = read('apps/api/src/db/points-repo.ts');
    const allowed = [...repoSrc.slice(repoSrc.indexOf('export type PointReason'), repoSrc.indexOf('export type CatalogKind'))
      .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.length, 'PointReason 목록을 읽지 못했다').toBeGreaterThan(5);
    expect(allowed, `사유 '${reason![1]}' 가 허용 목록에 없다`).toContain(reason![1]);
  });
});
