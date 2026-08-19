/*
   KuCoin 현물 비공개 REST — 주문이 나가는 경로의 계약
   ------------------------------------------------------------
   ★★ 이 검사가 막으려는 사고

     1) 수량을 계약수로 바꿔 보내기
        선물 코드를 복사해 오면 `quantity / multiplier` 가 남는다. BTC 는 승수가
        0.001 이므로 **1000배 작은 주문**이 나간다. 오류는 나지 않는다.

     2) leverage 를 함께 보내기
        현물에는 레버리지가 없다. 보내면 거래소가 거부하는데, 그 거부를
        "주문 실패" 로만 보고하면 원인을 찾기 어렵다.

     3) 타임아웃을 실패로 단정하기
        나갔는지 알 수 없는 상태다. 실패로 말하면 이용자가 다시 주문해
        **중복 매수**가 된다.

     4) 거래 계정이 아닌 잔고를 보기
        현물은 main/trade 계정이 분리돼 있다. type=trade 를 빼면 주문에 쓸 수
        없는 잔고까지 합산되어 "돈이 있는데 주문이 거부된다" 가 된다.
*/

import { describe, it, expect } from 'vitest';
import { KucoinSpotPrivate, KucoinSpotApiError } from '../spot-private-rest';

const USER = { apiKey: 'k', apiSecret: 'cw==', passphrase: 'p' };

/** 요청을 가로채 본문·경로·헤더를 확인할 수 있게 하는 fetch. */
function capture(response: unknown, opts: { code?: string; status?: number } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  const impl = (async (url: URL | string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => JSON.stringify({ code: opts.code ?? '200000', data: response }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('SPOT-ORDER 주문 본문', () => {
  it('[1] ★★ 수량을 그대로 보낸다 (승수를 쓰지 않는다)', async () => {
    const { impl, calls } = capture({ orderId: 'o1', clientOid: 'c1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, {
      clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'limit',
      quantity: '0.001', price: '60000',
    });
    expect(calls[0]!.body).toMatchObject({ size: '0.001', symbol: 'BTC-USDT', side: 'buy', type: 'limit', price: '60000' });
    // 선물처럼 계약수로 바꿨다면 1 이 되어 있을 것이다.
    expect((calls[0]!.body as { size: string }).size).not.toBe('1');
  });

  it('[2] ★★ leverage 를 보내지 않는다', async () => {
    const { impl, calls } = capture({ orderId: 'o1', clientOid: 'c1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, {
      clientOid: 'c1', symbol: 'ETHUSDT', side: 'short', type: 'market', quantity: '1',
    });
    expect(calls[0]!.body).not.toHaveProperty('leverage');
    expect(calls[0]!.body).not.toHaveProperty('marginMode');
    expect((calls[0]!.body as { side: string }).side).toBe('sell');
  });

  it('[3] 현물 도메인·경로로 보낸다', async () => {
    const { impl, calls } = capture({ orderId: 'o1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    // 경로 문자열이 선물과 같아서, 도메인이 틀리면 조용히 실패한다.
    expect(calls[0]!.url).toContain('api.kucoin.com');
    expect(calls[0]!.url).toContain('/api/v1/hf/orders');
    expect(calls[0]!.url).not.toContain('api-futures');
  });

  it('[4] clientOid 가 없으면 보내지 않는다', async () => {
    const { impl, calls } = capture({});
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await expect(c.submitOrder(USER, { clientOid: '', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '1' }))
      .rejects.toThrow(/clientOid/);
    // 멱등성 키 없이 요청이 나가면 재시도가 중복 주문이 된다.
    expect(calls.length).toBe(0);
  });

  it('[5] 지정가에 가격이 없으면 보내지 않는다', async () => {
    const { impl, calls } = capture({});
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await expect(c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'limit', quantity: '1' }))
      .rejects.toThrow(/가격/);
    expect(calls.length).toBe(0);
  });

  it('[6] 브로커 헤더는 현물 자격증명으로 붙는다', async () => {
    const { impl, calls } = capture({ orderId: 'o1' });
    const c = new KucoinSpotPrivate({
      fetchImpl: impl,
      broker: { partner: 'CCAI', key: 'bk', name: 'CCAI' },
    });
    expect(c.brokerAttached).toBe(true);
    await c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    const h = calls[0]!.headers;
    /*
       선물용(CCAIF)으로 서명하면 서명 자체는 만들어지고 오류도 나지 않는다 —
       거래가 귀속되지 않아 리베이트만 0 이 된다. 그래서 값을 확인한다.
    */
    expect(h['KC-API-PARTNER']).toBe('CCAI');
    expect(h['KC-BROKER-NAME']).toBe('CCAI');
    expect(h['KC-API-PARTNER-SIGN']).toBeTruthy();
  });
});

describe('SPOT-ORDER 결과 판정', () => {
  it('[1] ★★ 타임아웃은 실패가 아니라 "알 수 없음" 이다', async () => {
    const impl = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    const c = new KucoinSpotPrivate({ fetchImpl: impl, timeoutMs: 5 });
    try {
      await c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as KucoinSpotApiError;
      // 이 신호가 없으면 호출자가 REJECTED 로 보고하고, 이용자가 다시 주문한다.
      expect(err.unknownOutcome).toBe(true);
    }
  });

  it('[2] ★ 5xx 도 주문 결과를 모른다', async () => {
    const { impl } = capture(null, { status: 502, code: '500000' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    try {
      await c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as KucoinSpotApiError).unknownOutcome).toBe(true);
    }
  });

  it('[3] 자격증명 오류는 재시도 대상이 아니다', async () => {
    const { impl } = capture(null, { status: 200, code: '400003' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    try {
      await c.getBalances(USER);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as KucoinSpotApiError;
      expect(err.code).toBe('400003');
      expect(err.retryable).toBe(false);
      // 조회는 다시 해도 안전하므로 unknown 이 아니다.
      expect(err.unknownOutcome).toBe(false);
    }
  });
});

describe('SPOT-BALANCE 잔고', () => {
  it('[1] ★ 거래 계정만 조회한다 (type=trade)', async () => {
    const { impl, calls } = capture([
      { currency: 'USDT', type: 'trade', balance: '100', available: '80', holds: '20' },
    ]);
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    const rows = await c.getBalances(USER);
    /*
       type 을 빼면 메인 계정 잔고까지 합산된다. 그러면 화면은 "잔고 100" 이라고
       하는데 주문은 거부되고, 이용자는 우리 화면이 틀렸다고 생각한다.
    */
    expect(calls[0]!.url).toContain('type=trade');
    expect(rows[0]).toMatchObject({ currency: 'USDT', available: '80', holds: '20', total: '100' });
  });
});

describe('SPOT-RECONCILE 불명확한 주문 확인', () => {
  it('[1] isActive / cancelExist 로 상태를 정한다', async () => {
    const { impl } = capture({ id: 'o9', isActive: true, size: '1', dealSize: '0.4' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    const r = await c.getOrderByClientOid(USER, 'c1', 'BTCUSDT');
    expect(r).toEqual({ orderId: 'o9', status: 'open', size: '1', dealSize: '0.4' });
  });

  it('[2] 없는 주문은 null 이다 (제출되지 않았다는 정보)', async () => {
    const { impl } = capture(null, { code: '400100' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    expect(await c.getOrderByClientOid(USER, 'nope', 'BTCUSDT')).toBeNull();
  });
});

describe('SPOT-STOP 발동 주문', () => {
  it('[1] ★★ 일반 주문과 다른 엔드포인트로 보낸다', async () => {
    const { impl, calls } = capture({ orderId: 's1', clientOid: 'c1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitStopOrder(USER, {
      clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'limit',
      quantity: '0.001', price: '60000', stopPrice: '59000',
    });
    /*
       일반 경로(/api/v1/orders)로 stopPrice 를 보내면 그 필드는 무시되고
       **즉시 체결되는 주문**이 나간다. 손절을 걸었다고 믿는 이용자가 그 자리에서
       체결되는 것이 이 실수의 결과다.
    */
    expect(calls[0]!.url).toContain('/api/v1/stop-order');
    expect(calls[0]!.url).not.toMatch(/\/api\/v1\/hf\/orders(\?|$)/);
    expect(calls[0]!.body).toMatchObject({
      symbol: 'BTC-USDT', side: 'buy', type: 'limit',
      size: '0.001', price: '60000', stopPrice: '59000',
    });
  });

  it('[2] ★ 발동 가격이 없거나 0 이면 주문하지 않는다', async () => {
    const { impl, calls } = capture({});
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    for (const bad of ['', '0', '-1', 'abc']) {
      await expect(c.submitStopOrder(USER, {
        clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market',
        quantity: '0.001', stopPrice: bad,
      })).rejects.toThrow(/발동 가격/);
    }
    // 일반 주문으로 낮춰 보내지 않는다 — 요청이 아예 나가지 않아야 한다.
    expect(calls.length).toBe(0);
  });

  it('[3] 지정가 발동 주문에 가격이 없으면 보내지 않는다', async () => {
    const { impl, calls } = capture({});
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await expect(c.submitStopOrder(USER, {
      clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'limit',
      quantity: '0.001', stopPrice: '59000',
    })).rejects.toThrow(/가격/);
    expect(calls.length).toBe(0);
  });

  it('[4] ★ 발동 방향을 우리가 추측해서 보내지 않는다', async () => {
    const { impl, calls } = capture({ orderId: 's1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitStopOrder(USER, {
      clientOid: 'c1', symbol: 'BTCUSDT', side: 'short', type: 'market',
      quantity: '0.001', stopPrice: '59000',
    });
    /*
       KuCoin 이 현재가와 stopPrice 를 비교해 방향을 정한다. 우리가 'loss'/'entry'
       를 추측해 보내면 틀렸을 때 반대 방향에 걸리고, 그 사실은 발동될 때까지
       드러나지 않는다.
    */
    expect(calls[0]!.body).not.toHaveProperty('stop');
    expect((calls[0]!.body as { side: string }).side).toBe('sell');
  });
});

describe('SPOT-PATH 폐기 경로를 쓰지 않는다', () => {
  it('[1] ★★ 주문은 /api/v1/hf/orders 로 보낸다', async () => {
    const { impl, calls } = capture({ orderId: 'o1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { clientOid: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    /*
       `/api/v1/orders` 는 KuCoin 문서의 Abandoned Endpoints(Add Order - Old)다.
       지금 동작해도 폐기 예정 경로에 실주문을 걸어 두면, 어느 날 갑자기 주문이
       나가지 않는다.
    */
    expect(calls[0]!.url).toContain('/api/v1/hf/orders');
  });

  it('[2] ★★ 취소는 symbol 을 쿼리로 함께 보낸다', async () => {
    const { impl, calls } = capture({ orderId: 'o1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.cancelOrder(USER, 'o1', 'BTCUSDT');
    // 빼면 400 이다. 선물은 orderId 만으로 되므로 복사해 오면 "취소가 안 되는" 상태가 된다.
    expect(calls[0]!.url).toContain('/api/v1/hf/orders/o1');
    expect(calls[0]!.url).toContain('symbol=BTC-USDT');
    expect(calls[0]!.method).toBe('DELETE');
  });

  it('[3] 취소 응답 두 형태를 모두 받아들인다', async () => {
    for (const [body, expected] of [
      [{ orderId: 'o1' }, ['o1']],
      [{ cancelledOrderIds: ['o1', 'o2'] }, ['o1', 'o2']],
    ] as const) {
      const { impl } = capture(body);
      const c = new KucoinSpotPrivate({ fetchImpl: impl });
      expect((await c.cancelOrder(USER, 'o1', 'BTCUSDT')).canceled).toEqual(expected);
    }
  });

  it('[4] 조회도 symbol 을 요구한다', async () => {
    const { impl, calls } = capture({ id: 'o1', isActive: true, size: '1', dealSize: '0' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.getOrderByClientOid(USER, 'c1', 'BTCUSDT');
    expect(calls[0]!.url).toContain('/api/v1/hf/orders/client-order/c1');
    expect(calls[0]!.url).toContain('symbol=BTC-USDT');
  });
});

describe('SPOT-OCO', () => {
  const OK = {
    clientOid: 'c1', symbol: 'BTCUSDT', side: 'long' as const, quantity: '0.1',
    price: '96000', stopPrice: '90000', limitPrice: '89500',
  };

  it('[1] 세 가격을 각자의 자리에 보낸다', async () => {
    const { impl, calls } = capture({ orderId: 'oco1' });
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    await c.submitOcoOrder(USER, OK);
    expect(calls[0]!.url).toContain('/api/v3/oco/order');
    expect(calls[0]!.body).toMatchObject({
      symbol: 'BTC-USDT', side: 'buy', size: '0.1',
      price: '96000', stopPrice: '90000', limitPrice: '89500', tradeType: 'TRADE',
    });
  });

  it('[2] ★★ 값이 하나라도 없으면 주문하지 않는다', async () => {
    const { impl, calls } = capture({});
    const c = new KucoinSpotPrivate({ fetchImpl: impl });
    for (const k of ['price', 'stopPrice', 'limitPrice', 'quantity'] as const) {
      await expect(c.submitOcoOrder(USER, { ...OK, [k]: '' })).rejects.toThrow(/OCO/);
    }
    /*
       빠진 값을 우리가 채우면(예: limitPrice 를 stopPrice 로) 이용자가 지정하지
       않은 조건으로 체결된다. 요청이 아예 나가지 않아야 한다.
    */
    expect(calls.length).toBe(0);
  });
});
