/**
 * 주문 제출 안전성 검증.
 *
 * 왜 이 테스트가 중요한가
 * ----------------------
 * KuCoin 선물은 **계약 수**로 주문한다. 기초자산 수량을 그대로 보내면
 * multiplier 배만큼 큰 주문이 나간다 — BTC 는 1계약이 0.001 BTC 이므로
 * 0.01 BTC 를 주문하려다 10 BTC(1000배)를 주문하게 된다.
 * 실제 돈이 걸린 변환이므로 모든 경계를 고정한다.
 */

import { describe, expect, it, vi } from 'vitest';

import { KucoinFuturesPrivate } from '../private-rest.js';

const USER = { apiKey: 'k', apiSecret: 'cw==', passphrase: 'p' };

/** 요청 본문을 붙잡는 가짜 fetch. 네트워크를 타지 않는다. */
function captureFetch(response: unknown = { orderId: 'oid-1', clientOid: 'c-1' }) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ code: '200000', data: response }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('수량 → 계약수 변환', () => {
  it('BTC 0.01 은 10계약이 된다 (승수 0.001)', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { clientOid: 'c-1', symbol: 'BTCUSDT', side: 'long', type: 'limit', quantity: '0.01', price: '64000', leverage: 10 },
      0.001,
    );
    expect((calls[0]!.body as { size: number }).size).toBe(10);
  });

  it('결과에 실제로 보낸 계약 수가 담긴다', async () => {
    const { impl } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    const r = await c.submitOrder(
      USER,
      { clientOid: 'c-2', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.005', leverage: 5 },
      0.001,
    );
    // 호출자가 "의도한 수량" 과 "실제 나간 수량" 을 비교할 수 있어야 한다.
    expect(r.contractsSent).toBe('5');
  });

  it('소수 계약은 내림한다 — 많이 나가는 쪽이 더 위험하다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    // 0.0035 / 0.001 = 3.5 계약 → 3계약
    await c.submitOrder(
      USER,
      { clientOid: 'c-3', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.0035', leverage: 5 },
      0.001,
    );
    expect((calls[0]!.body as { size: number }).size).toBe(3);
  });

  it('1계약 미달은 주문하지 않고 거부한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { clientOid: 'c-4', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.0005', leverage: 5 },
        0.001,
      ),
    ).rejects.toThrow(/최소 주문 수량/);
    // 요청 자체가 나가지 않아야 한다.
    expect(calls).toHaveLength(0);
  });

  it.each([undefined, 0, -1, Number.NaN])(
    '승수가 %p 면 주문을 보내지 않는다',
    async (mult) => {
      const { impl, calls } = captureFetch();
      const c = new KucoinFuturesPrivate({ fetchImpl: impl });
      await expect(
        c.submitOrder(
          USER,
          { clientOid: 'c-5', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 },
          mult as number | undefined,
        ),
      ).rejects.toThrow(/승수/);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['0', '-0.5', 'abc', ''])('수량이 %p 면 거부한다', async (q) => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { clientOid: 'c-6', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: q, leverage: 5 },
        0.001,
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('주문 파라미터', () => {
  it('long/short 을 buy/sell 로 변환한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { clientOid: 'a', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 }, 0.001);
    await c.submitOrder(USER, { clientOid: 'b', symbol: 'BTCUSDT', side: 'short', type: 'market', quantity: '0.01', leverage: 5 }, 0.001);
    expect((calls[0]!.body as { side: string }).side).toBe('buy');
    expect((calls[1]!.body as { side: string }).side).toBe('sell');
  });

  it('시장가 주문에는 가격을 넣지 않는다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { clientOid: 'a', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', price: '64000', leverage: 5 }, 0.001);
    // 가격을 함께 보내면 "그 가격에 체결된다" 는 오해를 만든다.
    expect((calls[0]!.body as Record<string, unknown>).price).toBeUndefined();
  });

  it('지정가 주문에 가격이 없으면 거부한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { clientOid: 'a', symbol: 'BTCUSDT', side: 'long', type: 'limit', quantity: '0.01', leverage: 5 }, 0.001),
    ).rejects.toThrow(/가격/);
    expect(calls).toHaveLength(0);
  });

  it('clientOid 를 그대로 보낸다 — 멱등성의 유일한 근거다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { clientOid: 'qt-unique-123', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 }, 0.001);
    expect((calls[0]!.body as { clientOid: string }).clientOid).toBe('qt-unique-123');
  });

  it('미지원 심볼은 주문하지 않는다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { clientOid: 'a', symbol: 'TONUSDT', side: 'long', type: 'market', quantity: '1', leverage: 5 }, 1),
    ).rejects.toThrow(/심볼/);
    expect(calls).toHaveLength(0);
  });
});

describe('브로커 파트너 헤더 (리베이트 집계)', () => {
  it('자격증명 3종이 모두 있으면 헤더가 붙는다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({
      fetchImpl: impl,
      broker: { partner: 'P', key: 'K', name: 'N' },
    });
    const r = await c.submitOrder(USER, { clientOid: 'a', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 }, 0.001);
    expect(calls[0]!.headers['KC-API-PARTNER']).toBe('P');
    expect(calls[0]!.headers['KC-API-PARTNER-SIGN']).toBeTruthy();
    expect(calls[0]!.headers['KC-API-PARTNER-VERIFY']).toBe('true');
    expect(r.brokerAttached).toBe(true);
  });

  const PARTIAL_BROKERS: Array<[Record<string, string>, string]> = [
    [{ partner: 'P', key: 'K' }, 'name 없음'],
    [{ partner: 'P', name: 'N' }, 'key 없음'],
    [{ key: 'K', name: 'N' }, 'partner 없음'],
    [{}, '전부 없음'],
  ];

  it.each(PARTIAL_BROKERS)('부분 설정(%o)이면 헤더를 붙이지 않는다 — 400201 을 피한다', async (broker) => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl, broker });
    const r = await c.submitOrder(USER, { clientOid: 'a', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 }, 0.001);
    expect(calls[0]!.headers['KC-API-PARTNER']).toBeUndefined();
    // 리베이트가 집계되지 않는다는 사실이 결과에 드러나야 한다.
    expect(r.brokerAttached).toBe(false);
  });
});

describe('주문 취소', () => {
  it('전체 취소는 심볼을 반드시 요구한다', async () => {
    const { impl } = captureFetch({ cancelledOrderIds: ['a', 'b'] });
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    // symbol 없이 호출하면 KuCoin 은 모든 심볼을 취소한다. 그 사고를 막는다.
    await expect(c.cancelAllForSymbol(USER, '')).rejects.toThrow();
  });

  it('취소된 주문 id 목록을 돌려준다', async () => {
    const { impl } = captureFetch({ cancelledOrderIds: ['o1', 'o2'] });
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    const r = await c.cancelAllForSymbol(USER, 'BTCUSDT');
    expect(r.canceled).toEqual(['o1', 'o2']);
  });
});

describe('마진 모드 — 주문이 거부되던 실제 원인', () => {
  /*
     ★★ 고객 주문이 이 사유로 계속 거부됐다(trade_decisions 기록):
         "The order's margin mode does not match the selected one."

       원인: ISOLATED 를 고른 이용자에게는 marginMode 를 **아예 보내지 않았다.**
       그러면 KuCoin 이 자기 기본값으로 처리하고, 그 값이 심볼 설정과 다르면
       거부한다. 보내지 않는 것은 "아무 값" 이 아니라 "거래소 기본값" 이다.
  */
  it('★★ isolated 도 명시해서 보낸다 (예전에는 아무 것도 안 보냈다)', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { clientOid: 'c-1', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5, marginMode: 'isolated' },
      0.001,
    );
    expect((calls[0]!.body as { marginMode?: string }).marginMode).toBe('ISOLATED');
  });

  it('cross 는 CROSS 로 보낸다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { clientOid: 'c-2', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5, marginMode: 'cross' },
      0.001,
    );
    expect((calls[0]!.body as { marginMode?: string }).marginMode).toBe('CROSS');
  });

  it('마진 모드를 주지 않아도 값이 비지 않는다 (기본 ISOLATED)', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { clientOid: 'c-3', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.01', leverage: 5 },
      0.001,
    );
    expect((calls[0]!.body as { marginMode?: string }).marginMode).toBe('ISOLATED');
  });

  it('getMarginMode 는 거래소 설정을 읽는다', async () => {
    const { impl } = captureFetch({ symbol: 'XBTUSDTM', marginMode: 'CROSS' });
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    expect(await c.getMarginMode(USER, 'BTCUSDT')).toBe('cross');
  });

  it('getMarginMode 는 실패해도 던지지 않는다 (주문을 막지 않는다)', async () => {
    const impl = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    expect(await c.getMarginMode(USER, 'BTCUSDT')).toBeNull();
  });
});
