/**
 * 브래킷 TP/SL (익절·손절 동시 등록) 검증.
 *
 * 왜 이 테스트가 중요한가
 * ----------------------
 * 이 기능이 **조용히 실패하는 방식**이 치명적이다:
 *
 *   1) 일반 /api/v1/orders 로 보내면 거래소가 triggerStop*Price 를 무시한다.
 *      진입은 되고 보호는 없는데 화면은 "TP/SL 설정됨" 으로 보인다.
 *   2) long/short 에 따라 위(Up)/아래(Down) 대응이 뒤바뀐다. 한 번 뒤집히면
 *      **손절 자리에 익절이 걸린다** — 손실이 무한히 열린다.
 *
 * 두 경로 모두 코드로 고정한다.
 */

import { describe, expect, it, vi } from 'vitest';

import { KucoinFuturesPrivate } from '../private-rest.js';

const USER = { apiKey: 'k', apiSecret: 'cw==', passphrase: 'p' };

function captureFetch(response: unknown = { orderId: 'oid-1', clientOid: 'c-1' }) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(JSON.stringify({ code: '200000', data: response }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

/** BTC 승수. 1계약 = 0.001 BTC. */
const MULT = 0.001;

const BASE = {
  clientOid: 'c-1',
  symbol: 'BTCUSDT',
  type: 'limit' as const,
  quantity: '0.01',
  leverage: 5,
};

describe('엔드포인트 선택', () => {
  it('TP/SL 이 없으면 일반 주문 경로를 쓴다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    const r = await c.submitOrder(USER, { ...BASE, side: 'long', price: '64000' }, MULT);
    expect(calls[0]!.url).toContain('/api/v1/orders');
    expect(calls[0]!.url).not.toContain('st-orders');
    expect(r.endpoint).toBe('orders');
    // 등록하지 않았음이 결과에 드러나야 한다.
    expect(r.takeProfitPrice).toBeNull();
    expect(r.stopLossPrice).toBeNull();
  });

  it('TP 만 있어도 st-orders 로 보낸다 — 일반 경로는 이 필드를 무시한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    const r = await c.submitOrder(
      USER,
      { ...BASE, side: 'long', price: '64000', takeProfitPrice: '68000' },
      MULT,
    );
    expect(calls[0]!.url).toContain('/api/v1/st-orders');
    expect(r.endpoint).toBe('st-orders');
    expect(r.takeProfitPrice).toBe('68000');
    expect(r.stopLossPrice).toBeNull();
  });

  it('SL 만 있어도 st-orders 로 보낸다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { ...BASE, side: 'long', price: '64000', stopLossPrice: '60000' }, MULT);
    expect(calls[0]!.url).toContain('/api/v1/st-orders');
  });

  it('빈 문자열은 "설정하지 않음" 으로 본다 — 일반 주문이 된다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    const r = await c.submitOrder(
      USER,
      { ...BASE, side: 'long', price: '64000', takeProfitPrice: '', stopLossPrice: '' },
      MULT,
    );
    expect(calls[0]!.url).not.toContain('st-orders');
    expect(r.endpoint).toBe('orders');
  });
});

describe('방향 매핑 — 뒤집히면 손절 자리에 익절이 걸린다', () => {
  it('long: 익절은 Up, 손절은 Down 이다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { ...BASE, side: 'long', price: '64000', takeProfitPrice: '68000', stopLossPrice: '60000' },
      MULT,
    );
    expect(calls[0]!.body.triggerStopUpPrice).toBe('68000');
    expect(calls[0]!.body.triggerStopDownPrice).toBe('60000');
  });

  it('short: 익절은 Down, 손절은 Up 이다 (long 과 반대)', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { ...BASE, side: 'short', price: '64000', takeProfitPrice: '60000', stopLossPrice: '68000' },
      MULT,
    );
    // 익절(60000)이 아래, 손절(68000)이 위다.
    expect(calls[0]!.body.triggerStopDownPrice).toBe('60000');
    expect(calls[0]!.body.triggerStopUpPrice).toBe('68000');
  });

  it('발동 기준가는 기본이 마크가(MP)다 — 최종거래가는 순간 이상치에 발동한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(USER, { ...BASE, side: 'long', price: '64000', stopLossPrice: '60000' }, MULT);
    expect(calls[0]!.body.stopPriceType).toBe('MP');
  });

  it('기준가를 지정하면 그것을 쓴다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { ...BASE, side: 'long', price: '64000', stopLossPrice: '60000', stopPriceType: 'TP' },
      MULT,
    );
    expect(calls[0]!.body.stopPriceType).toBe('TP');
  });

  it('가격 문자열을 그대로 보낸다 — 숫자 왕복은 정밀도를 잃는다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { ...BASE, symbol: 'XRPUSDT', quantity: '10', side: 'long', price: '2.1234', takeProfitPrice: '2.4500', stopLossPrice: '1.9000' },
      1,
    );
    expect(calls[0]!.body.triggerStopUpPrice).toBe('2.4500');
    expect(calls[0]!.body.triggerStopDownPrice).toBe('1.9000');
  });
});

describe('잘못된 요청은 주문하지 않고 거부한다', () => {
  it('long 인데 익절이 손절보다 낮으면 거부한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { ...BASE, side: 'long', price: '64000', takeProfitPrice: '60000', stopLossPrice: '68000' },
        MULT,
      ),
    ).rejects.toThrow(/익절이 손절보다 높아야/);
    // 아무 요청도 나가지 않아야 한다.
    expect(calls).toHaveLength(0);
  });

  it('short 인데 익절이 손절보다 높으면 거부한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { ...BASE, side: 'short', price: '64000', takeProfitPrice: '68000', stopLossPrice: '60000' },
        MULT,
      ),
    ).rejects.toThrow(/익절이 손절보다 낮아야/);
    expect(calls).toHaveLength(0);
  });

  it('long 인데 익절이 진입가보다 낮으면 거부한다 — 즉시 손실로 닫힌다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { ...BASE, side: 'long', price: '64000', takeProfitPrice: '63000' },
        MULT,
      ),
    ).rejects.toThrow(/익절가가 진입가의 반대쪽/);
    expect(calls).toHaveLength(0);
  });

  it('long 인데 손절이 진입가보다 높으면 거부한다', async () => {
    const { impl } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { ...BASE, side: 'long', price: '64000', stopLossPrice: '65000' }, MULT),
    ).rejects.toThrow(/손절가가 진입가의 반대쪽/);
  });

  it('short 인데 손절이 진입가보다 낮으면 거부한다', async () => {
    const { impl } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { ...BASE, side: 'short', price: '64000', stopLossPrice: '60000' }, MULT),
    ).rejects.toThrow(/손절가가 진입가의 반대쪽/);
  });

  it('시장가는 진입가를 모르므로 상대 순서만 본다 (통과해야 한다)', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await c.submitOrder(
      USER,
      { ...BASE, type: 'market', side: 'long', takeProfitPrice: '68000', stopLossPrice: '60000' },
      MULT,
    );
    expect(calls[0]!.url).toContain('st-orders');
  });

  it('숫자가 아닌 가격은 조용히 버리지 않고 거부한다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { ...BASE, side: 'long', price: '64000', stopLossPrice: 'abc' }, MULT),
    ).rejects.toThrow(/올바르지 않다/);
    expect(calls).toHaveLength(0);
  });

  it('0 이하의 가격은 거부한다', async () => {
    const { impl } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(USER, { ...BASE, side: 'long', price: '64000', stopLossPrice: '0' }, MULT),
    ).rejects.toThrow(/올바르지 않다/);
  });

  it('발동(조건부) 진입과 브래킷을 섞으면 거부한다 — 어느 쪽이 무시될지 알 수 없다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { ...BASE, side: 'long', price: '64000', stopPrice: '63000', stopLossPrice: '60000' },
        MULT,
      ),
    ).rejects.toThrow(/함께 걸 수 없다/);
    expect(calls).toHaveLength(0);
  });

  it('브래킷 검사는 수량 검사보다 뒤다 — 1계약 미달은 여전히 먼저 막힌다', async () => {
    const { impl, calls } = captureFetch();
    const c = new KucoinFuturesPrivate({ fetchImpl: impl });
    await expect(
      c.submitOrder(
        USER,
        { ...BASE, quantity: '0.0005', side: 'long', price: '64000', stopLossPrice: '60000' },
        MULT,
      ),
    ).rejects.toThrow(/최소 주문 수량 미달/);
    expect(calls).toHaveLength(0);
  });
});
