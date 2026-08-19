/*
   현물 거래 어댑터 — 잠금과 결과 판정
   ------------------------------------------------------------
   ★★ 이 검사가 막으려는 사고

     1) 잠금이 풀린 채 주문이 나가는 것
        canPlaceRealOrders 가 false 면 어떤 요청도 거래소로 가지 않아야 한다.
        그리고 그 값은 **호출 시점마다** 다시 확인해야 한다 — 부팅 시점 값을
        캐시하면 킬스위치를 눌러도 이미 만들어진 어댑터가 계속 주문을 낸다.

     2) 타임아웃을 REJECTED 로 보고하는 것
        나갔는지 알 수 없는 상태다. 실패로 말하면 이용자가 다시 주문해
        중복 매수가 된다. SUBMIT_UNKNOWN 이어야 한다.

     3) 현물에 없는 조건(reduceOnly)을 조용히 버리는 것
        이용자는 감소전용이 적용됐다고 믿는다. 거부하고 이유를 말해야 한다.
*/

import { describe, it, expect, vi } from 'vitest';
import { KucoinSpotTradingAdapter } from '../trading/kucoin-spot-trading-adapter';

const CTX = {
  mode: 'BITMART_LIVE_READ_ONLY',
  credential: { accessKey: 'k', secretKey: 'cw==', memo: 'p' },
} as never;

const REQ = {
  clientOrderId: 'c1',
  symbol: 'BTCUSDT',
  side: 'long' as const,
  type: 'market' as const,
  quantity: '0.001',
};

/** 지정한 응답을 돌려주는 fetch. 호출 여부도 확인할 수 있다. */
function fetchOnce(body: unknown, opts: { status?: number; code?: string } = {}) {
  const calls: string[] = [];
  const impl = (async (url: URL | string) => {
    calls.push(String(url));
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => JSON.stringify({ code: opts.code ?? '200000', data: body }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('SPOT-ADAPTER 잠금', () => {
  it('[1] ★★ 잠겨 있으면 요청이 나가지 않는다', async () => {
    const { impl, calls } = fetchOnce({ orderId: 'o1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => false });
    const out = await a.submitOrder(CTX, REQ);
    expect(out.status).toBe('REJECTED');
    // 화면에 거부라고만 표시되고 실제로는 나갔다면 최악이다. 호출 자체가 0 이어야 한다.
    expect(calls.length).toBe(0);
  });

  it('[2] ★ 잠금을 호출 시점마다 확인한다', async () => {
    const { impl } = fetchOnce({ orderId: 'o1', clientOid: 'c1' });
    let open = true;
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => open });
    expect(a.canPlaceRealOrders).toBe(true);
    /*
       킬스위치를 누르는 상황. 부팅 시점 값을 캐시했다면 여기서도 true 가 되어
       주문이 계속 나간다.
    */
    open = false;
    expect(a.canPlaceRealOrders).toBe(false);
    expect((await a.submitOrder(CTX, REQ)).status).toBe('REJECTED');
  });

  it('[3] ★ 현물에 없는 reduceOnly 는 조용히 버리지 않는다', async () => {
    const { impl, calls } = fetchOnce({ orderId: 'o1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, { ...REQ, reduceOnly: true });
    expect(out.status).toBe('REJECTED');
    if (out.status === 'REJECTED') expect(out.reason).toMatch(/reduceOnly/);
    expect(calls.length).toBe(0);
  });
});

describe('SPOT-ADAPTER 결과 판정', () => {
  it('[1] 정상 접수는 ACCEPTED 이고 체결량을 추측하지 않는다', async () => {
    const { impl } = fetchOnce({ orderId: 'o1', clientOid: 'c1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, REQ);
    expect(out.status).toBe('ACCEPTED');
    if (out.status === 'ACCEPTED') {
      expect(out.order.exchangeOrderId).toBe('o1');
      // 제출 응답에는 체결량이 없다. 추측값을 넣으면 이용자가 그것을 믿는다.
      expect(out.order.filledQuantity).toBe('0');
      expect(out.order.quantity).toBe('0.001');
    }
  });

  it('[2] ★★ 타임아웃은 SUBMIT_UNKNOWN 이다', async () => {
    const impl = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, timeoutMs: 5, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, REQ);
    /*
       REJECTED 로 보고하면 이용자가 다시 주문한다 — 그것이 중복 매수다.
       "모른다" 를 그대로 전달해야 호출자가 조회로 확인한다.
    */
    expect(out.status).toBe('SUBMIT_UNKNOWN');
    if (out.status === 'SUBMIT_UNKNOWN') expect(out.clientOrderId).toBe('c1');
  });

  it('[3] 5xx 도 SUBMIT_UNKNOWN 이다', async () => {
    const { impl } = fetchOnce(null, { status: 503, code: '500000' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    expect((await a.submitOrder(CTX, REQ)).status).toBe('SUBMIT_UNKNOWN');
  });

  it('[4] 거래소가 거부한 것은 REJECTED 다', async () => {
    // 잔고 부족 등은 다시 시도해도 같다. 모른다고 말하면 이용자가 헛되게 재주문한다.
    const { impl } = fetchOnce(null, { status: 200, code: '200004' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    expect((await a.submitOrder(CTX, REQ)).status).toBe('REJECTED');
  });

  it('[5] 감사 기록을 남긴다', async () => {
    const { impl } = fetchOnce({ orderId: 'o1', clientOid: 'c1' });
    const onAudit = vi.fn();
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, onAudit });
    await a.submitOrder(CTX, REQ);
    const events = onAudit.mock.calls.map((c) => c[0]);
    // 실주문은 "누가 언제 무엇을" 이 남아야 한다.
    expect(events).toContain('spot.order.submitting');
    expect(events).toContain('spot.order.accepted');
  });
});

describe('SPOT-ADAPTER 정정·취소', () => {
  it('[1] 정정은 흉내내지 않고 지원하지 않음을 알린다', async () => {
    const { impl } = fetchOnce({});
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const r = await a.modifyOrder();
    /*
       취소 후 재주문으로 흉내낼 수 있지만, 그 사이 시장이 움직이면 이용자가
       의도한 것과 다른 결과가 된다. 그래서 하지 않는다.
    */
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not supported/i);
  });

  it('[2] 이미 끝난 주문은 취소 요청을 보내지 않는다', async () => {
    const { impl, calls } = fetchOnce({ id: 'o1', isActive: false, cancelExist: false, size: '1', dealSize: '1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const r = await a.cancelOrder(CTX, 'BTCUSDT', 'c1');
    expect(r.ok).toBe(false);
    // 조회 1회만. 체결된 주문에 취소를 보내면 오류가 되고 운영자가 원인을 찾느라 시간을 쓴다.
    expect(calls.length).toBe(1);
  });
});

describe('SPOT-ADAPTER OCO / 스톱 분기', () => {
  const REQ_BASE = { clientOrderId: 'c1', symbol: 'BTCUSDT', side: 'long' as const, quantity: '0.1' };

  it('[1] ★★ 세 가격이 모두 있으면 OCO 경로로 보낸다', async () => {
    const { impl, calls } = fetchOnce({ orderId: 'oco1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, {
      ...REQ_BASE, type: 'limit', price: '96000',
      stopPrice: '90000', limitPrice: '89500',
    } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(calls[0]).toContain('/api/v3/oco/order');
  });

  it('[2] ★★ 일부만 있으면 OCO 로 낮추지 않는다 (스톱 주문이 된다)', async () => {
    /*
       익절과 손절이 함께 걸렸다고 믿는데 한쪽만 걸리면 반대쪽이 무방비가 된다.
       limitPrice 가 없으면 OCO 가 아니라 스톱 주문 경로로 가야 한다.
    */
    const { impl, calls } = fetchOnce({ orderId: 's1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    await a.submitOrder(CTX, { ...REQ_BASE, type: 'limit', price: '96000', stopPrice: '90000' } as never);
    expect(calls[0]).toContain('/api/v1/stop-order');
    expect(calls[0]).not.toContain('/oco/');
  });

  it('[3] 아무 발동가도 없으면 일반 주문이다', async () => {
    const { impl, calls } = fetchOnce({ orderId: 'n1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    await a.submitOrder(CTX, { ...REQ_BASE, type: 'limit', price: '96000' } as never);
    expect(calls[0]).toContain('/api/v1/hf/orders');
    expect(calls[0]).not.toContain('stop-order');
  });

  it('[4] ★ 잠겨 있으면 OCO 도 나가지 않는다', async () => {
    const { impl, calls } = fetchOnce({ orderId: 'oco1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => false });
    const out = await a.submitOrder(CTX, {
      ...REQ_BASE, type: 'limit', price: '96000', stopPrice: '90000', limitPrice: '89500',
    } as never);
    expect(out.status).toBe('REJECTED');
    expect(calls.length).toBe(0);
  });

  it('[5] ★ 심볼 없이 reconcile 하지 않는다', async () => {
    /*
       현물 조회는 심볼이 필수다. 추측한 심볼로 물어보면 다른 주문을 보게 되고,
       "주문이 없다" 로 판단하면 이용자가 재주문해 중복 매수가 된다.
    */
    const { impl } = fetchOnce({ id: 'o1', isActive: true, size: '1', dealSize: '0' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    await expect(a.reconcileByClientOrderId(CTX, 'c1')).rejects.toThrow(/symbol/i);
  });
});
