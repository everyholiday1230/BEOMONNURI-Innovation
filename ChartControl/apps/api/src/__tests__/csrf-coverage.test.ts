/**
 * 상태를 바꾸는 라우트에 **CSRF 검증이 빠진 곳이 없는지** 파일 단위로 확인한다.
 *
 * ★★★ 왜 이 시험이 필요한가 — 구독 라우터 4개가 무방비였고 아무도 몰랐다.
 *
 *   payment·trading·ai·mfa·admin 은 전부 verifyCsrf·originAllowed 를 쓰고 있었는데
 *   `subscription-routes.ts` 만 **0건**이었다. 돈이 나가는 네 경로가 그대로 열려
 *   있었다 — checkout·confirm·change·cancel.
 *
 *   검증이 없으면 다른 사이트가 고객 브라우저로 우리 API 를 부를 수 있다(쿠키가 함께
 *   나간다). 화면은 이미 x-csrf-token 을 보내고 있었으므로 서버만 빠진 상태였다.
 *
 * ★ 라우터를 하나씩 눈으로 보는 방식은 새 라우터가 생기면 또 놓친다. 그래서 **파일을
 *   열거해** 검사한다. 새 라우터를 추가하면 이 목록에 넣어야 하고, 넣지 않으면
 *   마지막 시험이 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.dirname(fileURLToPath(new URL('../index.ts', import.meta.url)));

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf-8');

/** 주석을 걷어낸 코드만 본다. */
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 상태를 바꾸는(POST/PUT/PATCH/DELETE) 라우트를 가진 라우터 파일들.
 *
 * ★ 여기 없는 라우터 파일이 생기면 마지막 시험이 알려준다.
 */
const GUARDED_ROUTERS = [
  'subscriptions/subscription-routes.ts',
  'payment-routes.ts',
  'trading-routes.ts',
  'ai-routes.ts',
  /*
     ★ 아래 다섯은 이 시험을 처음 돌렸을 때 "목록에 없다" 고 걸린 것이다. 확인해 보니
       **이미 CSRF 가 적용돼 있었다**(auth 6건 · kucoin-oauth 4건 · saved 5건 ·
       strategy 3건 · user-strategy 3건). 내 목록이 불완전했던 것이다.
     ★ 그래서 목록을 채운다 — 목록이 실제 라우터 집합과 같아야 마지막 시험이 의미가 있다.
  */
  'auth-routes.ts',
  'kucoin-oauth-routes.ts',
  'saved-routes.ts',
  'strategy-routes.ts',
  'user-strategy-routes.ts',
];

describe('CSRF 커버리지 — 상태를 바꾸는 라우터에 검증이 있다', () => {
  for (const rel of GUARDED_ROUTERS) {
    it(`${rel} 이 CSRF 를 검증한다`, () => {
      const code = codeOnly(read(rel));
      /*
         ★ 두 가지가 함께 있어야 한다:
             originAllowed — 어느 사이트에서 온 요청인가
             verifyCsrf    — 토큰이 이 세션의 것인가
           하나만 있으면 우회 경로가 남는다.
      */
      expect(code, 'originAllowed 를 쓰지 않는다').toContain('originAllowed');
      expect(code, 'verifyCsrf 를 쓰지 않는다').toContain('verifyCsrf');
      expect(code, 'CSRF 실패를 거부하지 않는다').toContain('CSRF_FAILED');
    });
  }

  it('★ 구독 라우터의 상태변경 POST 4개가 모두 막혀 있다', () => {
    /*
       ★★ 이 네 개가 감사에서 지적된 그 경로다. 개수까지 못 박는다 — 새 POST 를
         추가하면서 검증을 빠뜨리면 개수가 어긋나 걸린다.
    */
    const code = codeOnly(read('subscriptions/subscription-routes.ts'));
    const posts = [...code.matchAll(/app\.post\('([^']+)'/g)].map((m) => m[1]);
    expect(posts.sort(), '상태변경 POST 목록이 달라졌다 — CSRF 적용을 확인할 것').toEqual([
      '/me/subscription/cancel',
      '/me/subscription/change',
      '/me/subscription/checkout',
      '/me/subscription/confirm',
    ]);
    /* 각 POST 뒤에 csrfOk 검사가 있는가 */
    const guards = (code.match(/if \(!csrfOk\(/g) || []).length;
    expect(guards, `POST ${posts.length}개인데 CSRF 검사는 ${guards}개다`).toBe(posts.length);
  });

  it('★ CSRF 의존이 선택이 아니라 필수로 선언돼 있다', () => {
    /*
       ★★★ 선택(`verifyCsrf?:`)이면 배선을 빠뜨렸을 때 **조용히 무방비**가 된다.
         구독 라우터가 그렇게 됐을 가장 그럴듯한 경로다. 필수로 두면 배선을 빠뜨리는
         순간 typecheck 가 막는다.
    */
    const code = read('subscriptions/subscription-routes.ts');
    expect(code).toMatch(/\n\s*verifyCsrf: typeof verifyCsrf;/);
    expect(code, '선택으로 되돌아갔다').not.toMatch(/verifyCsrf\?:/);
    expect(code).toMatch(/\n\s*csrfKey: string;/);
  });

  it('★★ 목록에 없는 라우터 파일이 생기면 알려준다', () => {
    /*
       ★ 새 라우터를 추가하고 이 목록에 넣지 않으면, CSRF 가 빠져도 위 시험들이
         모른다. 그래서 파일 목록 자체를 확인한다.
    */
    const top = readdirSync(SRC).filter((f) => /-routes\.ts$/.test(f));
    const sub = readdirSync(path.join(SRC, 'subscriptions')).filter((f) => /-routes\.ts$/.test(f));
    const found = [...top, ...sub.map((f) => `subscriptions/${f}`)];
    const unlisted = found.filter((f) => {
      if (GUARDED_ROUTERS.includes(f)) return false;
      const code = codeOnly(read(f));
      /* 상태를 바꾸는 라우트가 있는데 목록에 없으면 문제다. */
      return /app\.(post|put|patch|delete)\(/.test(code);
    });
    expect(
      unlisted,
      `상태를 바꾸는 라우터가 CSRF 검사 목록에 없다: ${unlisted.join(', ')}\n`
      + 'GUARDED_ROUTERS 에 추가하고 CSRF 를 적용할 것.',
    ).toEqual([]);
  });
});
