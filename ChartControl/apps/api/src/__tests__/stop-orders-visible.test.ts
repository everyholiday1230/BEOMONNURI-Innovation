/*
   ★★★ 거래소 앱에서 걸어 둔 손절·익절이 우리 화면에 보여야 한다.

   운영자 보고(2026-09-19): "내가 쿠코인 어플에서 sl 설정해둔 건 왜 우리 페이지에선
   안 보여?"

   원인 둘:
     ① KuCoin 은 **미발동** 손절·익절을 `/api/v1/orders` 에 넣지 않는다.
        `/api/v1/stopOrders` 에 따로 있다. 우리는 앞의 것만 읽었다.
        실측: 같은 계정에서 stopOrders 4건 · orders(active) 0건.
     ② 그 주문들은 `closeOrder: true` · `reduceOnly: false` 로 온다.
        화면의 보호주문 판정이 `reduceOnly === true` 만 봐서 전부 걸러냈다.

   ★★ 보호주문이 안 보이면 고객은 손절이 없다고 믿고 다시 건다 → 이중 손절이 되어
     하나가 체결된 뒤 남은 하나가 반대 포지션을 열 수 있다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KucoinAccountAdapter } from '../trading/kucoin-account-adapter';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('손절 주문을 별도 경로에서 읽는다', () => {
  const rest = read('packages/exchange-kucoin/src/private-rest.ts');
  const adapter = read('apps/api/src/trading/kucoin-account-adapter.ts');

  it('stopOrders 경로를 부른다', () => {
    expect(rest, 'stopOrders 를 조회하지 않는다').toMatch(/'\/api\/v1\/stopOrders'/u);
    expect(rest, 'getStopOrders 가 없다').toMatch(/async getStopOrders\(/u);
  });

  /*
     ★★★ **소스 글자 검사로는 부족하다.** 처음에 `getStopOrders(cred` 가 있는지만
       봤는데, 호출을 `Promise.resolve([]) ||` 로 무력화해도 글자는 남아서
       역검증이 통과했다(내 시험 결함). **동작으로 확인한다** — 가짜 거래소를
       붙여서 두 목록이 실제로 합쳐 나오는지 본다.
  */
  it('손절 조회 실패가 일반 주문까지 막지 않는다', () => {
    const i = adapter.indexOf('async getOpenOrders(');
    expect(i, 'getOpenOrders 가 없다').toBeGreaterThan(-1);
    const block = adapter.slice(i, i + 2200);
    expect(block, '손절 조회 실패가 전체를 죽인다').toMatch(/\.catch\(/u);
    expect(block, '중복을 걸러내지 않는다').toMatch(/seen\.has\(key\)/u);
  });

  /*
     ★★★ **가장 위험한 함정.** KuCoin 의 `stopPriceType` 은 값이 `TP`/`MP`/`IP` 인데
       각각 Trade Price · Mark Price · Index Price 다. **익절이 아니다.**
       실측 4건 모두 `stopPriceType: 'TP'` 였지만 전부 **손절**이었다.
       이 값으로 분류하면 고객의 손절을 익절로 표시한다 — 위험을 정반대로 읽힌다.
  */
  it('stopPriceType 을 익절/손절 구분에 쓰지 않는다', () => {
    /*
       ★ 주문을 **낼 때** 는 이 필드가 필요하다 — 어느 가격(체결가/표시가/지수)으로
         발동할지 거래소에 알려야 한다. 위험한 것은 **읽어서 분류할 때** 뿐이다.
         그래서 정규화 함수(`toOrder`) 안쪽만 본다.
    */
    const i = rest.indexOf('private toOrder(');
    expect(i, 'toOrder 가 없다').toBeGreaterThan(-1);
    let depth = 0; let end = i;
    for (let j = rest.indexOf('{', i); j < rest.length; j += 1) {
      if (rest[j] === '{') depth += 1;
      else if (rest[j] === '}') { depth -= 1; if (depth === 0) { end = j + 1; break; } }
    }
    const body = rest.slice(i, end).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    expect(body, 'stopPriceType 으로 분류한다 — 손절을 익절로 표시할 수 있다')
      .not.toMatch(/stopPriceType/u);
  });

  it('방향은 stop(up/down) 으로 판별한다', () => {
    expect(rest, '발동 방향을 담지 않는다').toMatch(/stopDirection: stopRaw === 'up' \|\| stopRaw === 'down'/u);
    expect(rest, '발동가를 담지 않는다').toMatch(/trigger: Number\(r\.stopPrice\) > 0/u);
  });

  /*
     ★★ 발동 대기 주문은 `isActive` 없이 `status: 'open'` 으로 온다(실측).
       그걸 'done' 으로 접으면 이미 끝난 주문처럼 보여 화면에서 사라진다.
  */
  it('발동 대기 상태를 open 으로 유지한다', () => {
    expect(rest, "status: 'open' 을 살리지 않는다")
      .toMatch(/String\(r\.status \?\? ''\) === 'open' \? 'open'/u);
  });
});

describe('closeOrder 도 감축 주문으로 본다', () => {
  /*
     ★★★ KuCoin 앱의 손절은 `closeOrder: true` · `reduceOnly: false` 다.
       `reduceOnly` 만 보면 **고객이 앱에서 걸어 둔 보호주문이 전부 사라진다.**
  */
  it('서버가 둘 중 하나라도 참이면 reduceOnly 로 넘긴다', () => {
    const adapter = read('apps/api/src/trading/kucoin-account-adapter.ts');
    expect(adapter, 'closeOrder 를 무시한다')
      .toMatch(/reduceOnly: o\.reduceOnly \|\| o\.closeOrder === true/u);
  });

  it('화면도 방어적으로 둘 다 본다', () => {
    const w = read('src/widgets.jsx');
    const i = w.indexOf('const hasGuard =');
    expect(i, 'hasGuard 가 없다').toBeGreaterThan(-1);
    const block = w.slice(i, i + 1600);
    expect(block, 'closeOrder 를 보지 않는다')
      .toMatch(/o\.reduceOnly !== true && o\.closeOrder !== true/u);
  });
});

/* ============================================================
   동작 검사 — 가짜 거래소를 붙여 실제로 합쳐 나오는지 본다.
   ============================================================ */
describe('getOpenOrders 가 두 목록을 실제로 합친다', () => {
  const PLAIN = {
    id: 'plain-1', clientOid: 'c1', symbol: 'BTCUSDTM', side: 'buy', type: 'limit',
    price: '80000', size: 1, dealSize: 0, isActive: true, cancelExist: false,
    reduceOnly: false, leverage: 10, timeInForce: 'GTC', createdAt: 1, updatedAt: 1,
  };
  /* ★ 실측 형태를 그대로 쓴다: closeOrder:true · reduceOnly:false · status:'open' */
  const STOP = {
    id: 'stop-1', clientOid: 'c2', symbol: 'BTCUSDTM', side: 'sell', type: 'market',
    price: '0', size: 1, dealSize: 0, closeOrder: true, reduceOnly: false,
    stop: 'down', stopPrice: '75000', stopPriceType: 'TP', status: 'open',
    leverage: 10, timeInForce: 'GTC', createdAt: 2, updatedAt: 2,
  };

  function makeAdapter(opts: { stopFails?: boolean } = {}) {
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      const body = u.includes('/stopOrders')
        ? (opts.stopFails
          ? { code: '400100', msg: 'boom' }
          : { code: '200000', data: { items: [STOP] } })
        : { code: '200000', data: { items: [PLAIN] } };
      return new Response(JSON.stringify(body), {
        status: opts.stopFails && u.includes('/stopOrders') ? 400 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return new KucoinAccountAdapter({ fetchImpl });
  }
  /* ★ 자격 필드 이름은 `accessKey`/`secretKey`/`memo` 다 (toKucoinCredential 참고). */
  const ctx = { credential: { accessKey: 'k', secretKey: 's', memo: 'p' } } as never;

  it('손절 주문이 목록에 들어온다', async () => {
    const rows = await makeAdapter().getOpenOrders(ctx);
    const ids = rows.map((r) => r.exchangeOrderId);
    expect(ids, `합쳐지지 않았다: ${JSON.stringify(ids)}`).toContain('stop-1');
    expect(ids, '일반 주문이 사라졌다').toContain('plain-1');
  });

  /*
     ★★★ 앱에서 만든 손절은 `reduceOnly:false` · `closeOrder:true` 다.
       화면의 보호주문 판정이 `reduceOnly` 를 보므로, 서버가 참으로 바꿔 넘겨야
       고객이 걸어 둔 손절이 보인다.
  */
  it('closeOrder 주문을 감축 주문으로 표시한다', async () => {
    const rows = await makeAdapter().getOpenOrders(ctx);
    const stop = rows.find((r) => r.exchangeOrderId === 'stop-1');
    expect(stop, '손절 주문이 없다').toBeDefined();
    expect(stop!.reduceOnly, 'closeOrder 를 감축으로 보지 않는다').toBe(true);
  });

  it('발동가와 방향을 함께 준다', async () => {
    const rows = await makeAdapter().getOpenOrders(ctx);
    const stop = rows.find((r) => r.exchangeOrderId === 'stop-1');
    expect(stop!.trigger, '발동가가 없다 — 화면이 어느 가격인지 모른다').toBe('75000');
    /* ★ stopPriceType:'TP' 인데 방향은 down 이다. 그 값으로 분류하면 익절로 뒤집힌다. */
    expect(stop!.stopDirection, '발동 방향이 틀렸다').toBe('down');
  });

  it('손절 조회가 실패해도 일반 주문은 보인다', async () => {
    const rows = await makeAdapter({ stopFails: true }).getOpenOrders(ctx);
    expect(rows.map((r) => r.exchangeOrderId), '일반 주문까지 사라졌다').toContain('plain-1');
  });
});
