import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   자격증명 "마지막 사용" 기록.

   ★★ 이 검사가 있는 이유

     지갑 화면에는 "Last used" 열이 있었고, 값이 없으면 '—' 를 찍었다. 그런데
     `last_used_at` 컬럼은 **코드 어디에서도 기록되지 않았다** — 실서비스에서
     주문 18건을 낸 키도 '—' 로 보였다.

     "마지막 사용" 은 고객이 **키가 자기도 모르게 쓰이는지** 확인하는 필드다.
     실제로 쓰이는 키를 '—' 로 보여주면 그 확인이 무의미해지고, 오히려
     "안 쓰이는 중" 이라고 말하는 셈이 된다. 그래서 이건 표시 문제가 아니라
     보안 신호가 사라진 문제다.

   ★ 실제 DB 동작(UPDATE 가 값을 쓰는가, 폐기된 키는 기록하지 않는가, 없는 id 로
     불러도 예외가 새지 않는가)은 실 Postgres 로 확인했다. 여기서는 그 배선이
     **다시 끊기지 않도록** 고정한다 — 끊긴 배선이 정확히 원래 사고였다.
*/
describe('CRED-LAST-USED — 키 사용 기록이 실제로 남는가', () => {
  it('[1] 두 저장소 구현 모두 markUsed 를 가진다 — 배포마다 다르게 동작하면 안 된다', () => {
    const sqlite = read('apps/api/src/db/trading-repos.ts');
    const pg = read('apps/api/src/db/pg-credential-repo.ts');

    // 계약에 선언돼 있어야 타입 검사가 한쪽 누락을 잡는다.
    expect(sqlite).toMatch(/markUsed\(id: string\): Promise<void>;/);

    for (const [name, src] of [['sqlite', sqlite], ['pg', pg]] as const) {
      expect(src, `${name} 구현에 markUsed 가 없다`).toMatch(/async markUsed\(/);
      expect(src, `${name} 이 last_used_at 을 쓰지 않는다`).toMatch(/SET last_used_at/);
    }
  });

  it('[2] 사용 기록은 폐기된 키에 남지 않는다', () => {
    for (const p of ['apps/api/src/db/trading-repos.ts', 'apps/api/src/db/pg-credential-repo.ts']) {
      const src = read(p);
      const stmt = src.slice(src.indexOf('async markUsed('), src.indexOf('async markUsed(') + 600);
      /*
         ★ 폐기한 키로 무언가 쓴 기록이 남으면, 고객은 "지웠는데 아직 쓰인다" 고
           읽는다. 실제로는 우리가 기록만 잘못 남긴 것이다.
      */
      expect(stmt, `${p}: revoked_at 조건이 없다`).toMatch(/revoked_at IS NULL/);
    }
  });

  it('[3] 사용 기록 실패가 주문을 실패시키지 않는다', () => {
    for (const p of ['apps/api/src/db/trading-repos.ts', 'apps/api/src/db/pg-credential-repo.ts']) {
      const src = read(p);
      const body = src.slice(src.indexOf('async markUsed('), src.indexOf('async markUsed(') + 700);
      /*
         ★★ 부작용이 목적보다 커지면 안 된다. 사용 기록은 부가 정보이고, 그것
           때문에 고객 주문이 실패하면 손해가 훨씬 크다. 그래서 삼킨다 —
           **다만 조용히 삼키지 않는다.** 로그가 없으면 "기록이 왜 비었나" 를
           나중에 알 수 없다.
      */
      expect(body, `${p}: try/catch 가 없다`).toMatch(/try\s*\{/);
      expect(body, `${p}: 삼킨 사실을 로그로 남기지 않는다`).toMatch(/console\.warn/);
    }
  });

  it('[4] 잔고·포지션·주문이 지나는 공통 경로에서 기록한다', () => {
    const routes = read('apps/api/src/trading-routes.ts');
    const fn = routes.slice(routes.indexOf('async function resolveExchangeContext'));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 5);
    /*
       ★ 라우트마다 흩어 놓으면 새 라우트가 빠뜨린다. 자격증명을 해석하는
         한 곳에서 기록해야 새 경로도 자동으로 포함된다.
    */
    expect(body, 'resolveExchangeContext 가 markUsed 를 부르지 않는다').toMatch(/markUsed\(/);
    // ★ await 하지 않는다 — 기록이 주문 지연이나 실패를 만들면 안 된다.
    expect(body).toMatch(/void d\.credRepo\.markUsed\(/);
  });

  it('[5] API 가 lastUsedAt 을 돌려준다 — 화면이 읽을 값이 없으면 열이 거짓말을 한다', () => {
    const routes = read('apps/api/src/trading-routes.ts');
    const start = routes.indexOf("app.get('/trading/credentials'");
    const block = routes.slice(start, start + 2500);
    expect(block).toMatch(/lastUsedAt: r\.lastUsedAt \?\? null/);
  });

  it('[6] 화면은 "기록 없음" 과 "쓰인 적 없음" 을 구분한다', () => {
    const page = read('src/pages-user.jsx');
    const start = page.indexOf('wal_col_last_used_none');
    expect(start, '화면이 lastUsedAt 을 쓰지 않는다').toBeGreaterThan(0);
    /*
       ★★ null 은 "쓰인 적 없음" 이 아니라 "기록이 없음" 이다. 기록은 지금부터
         시작하므로 그 전에 쓰인 키는 계속 null 이다. '—' 나 '쓰인 적 없음' 으로
         찍으면, 실제로 거래에 쓰인 키를 안 쓰인 것처럼 보여준다.
    */
    expect(page).toMatch(/k\.lastUsedAt/);
    expect(page).toMatch(/t\('wal_col_last_used_none'\)/);
  });

  it('[7] 새 문구가 남아 있는 모든 언어에 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${loc}.js`);
      expect(src, `${loc} 에 wal_col_last_used_none 이 없다`).toMatch(/wal_col_last_used_none: '/);
    }
  });
});
