/* ============================================================
   브래킷 TP/SL — 어댑터 계층 검증
   ------------------------------------------------------------
   ★★ 이 검사가 막으려는 사고

     1) 선물: TP/SL 을 요청했는데 일반 주문 경로로 나가는 것.
        거래소가 triggerStop*Price 를 조용히 무시한다 → 진입만 되고 보호는 없다.
        화면은 "TP/SL 설정됨" 으로 보인다.

     2) 선물: 등록되지 않았는데 주문 결과에 TP/SL 이 실려 나가는 것.
        상위(화면/기록)가 "보호됨" 으로 읽는다.

     3) 현물: TP/SL 을 조용히 버리는 것.
        KuCoin 현물에는 진입 첨부 브래킷이 없다. 버리면 이용자는 손절이 걸린 줄
        알고 화면을 떠나고, 실제로는 무방비로 남는다.
   ============================================================ */

import { describe, it, expect, vi } from 'vitest';

import { KucoinTradingAdapter } from '../trading/kucoin-trading-adapter';
import { KucoinSpotTradingAdapter } from '../trading/kucoin-spot-trading-adapter';

const CTX = {
  mode: 'BITMART_LIVE_READ_ONLY',
  credential: { accessKey: 'k', secretKey: 'cw==', memo: 'p' },
} as never;

const REQ = {
  clientOrderId: 'c1',
  symbol: 'XRPUSDT',
  side: 'long' as const,
  type: 'limit' as const,
  price: '2.0000',
  quantity: '100',
  leverage: 5,
};

/** 요청 URL 과 본문을 붙잡는 fetch. */
function capture(body: unknown = { orderId: 'o1', clientOid: 'c1' }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: URL | string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: '200000', data: body }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** XRP 는 1계약 = 1 XRP. */
const multiplierOf = () => 1;

describe('BRACKET-FUT 선물 브래킷 TP/SL', () => {
  it('[1] ★★ TP/SL 이 있으면 st-orders 로 나간다 — 일반 경로는 이 필드를 무시한다', async () => {
    const { impl, calls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    const out = await a.submitOrder(CTX, {
      ...REQ, takeProfitPrice: '2.4000', stopLossPrice: '1.8000',
    } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(calls[0]!.url).toContain('/api/v1/st-orders');
  });

  it('[2] ★★ long 의 익절은 위, 손절은 아래로 매핑된다', async () => {
    const { impl, calls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    await a.submitOrder(CTX, { ...REQ, takeProfitPrice: '2.4000', stopLossPrice: '1.8000' } as never);
    expect(calls[0]!.body.triggerStopUpPrice).toBe('2.4000');
    expect(calls[0]!.body.triggerStopDownPrice).toBe('1.8000');
  });

  it('[3] ★★ short 은 반대다 — 뒤집히면 손절 자리에 익절이 걸린다', async () => {
    const { impl, calls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    await a.submitOrder(CTX, {
      ...REQ, side: 'short', takeProfitPrice: '1.8000', stopLossPrice: '2.4000',
    } as never);
    expect(calls[0]!.body.triggerStopDownPrice).toBe('1.8000');
    expect(calls[0]!.body.triggerStopUpPrice).toBe('2.4000');
  });

  it('[4] ★★ 주문 결과에는 "등록된" 값만 실린다', async () => {
    const { impl } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    const out = await a.submitOrder(CTX, { ...REQ, stopLossPrice: '1.8000' } as never);
    expect(out.status).toBe('ACCEPTED');
    if (out.status !== 'ACCEPTED') return;
    expect(out.order.stopLossPrice).toBe('1.8000');
    // 익절은 요청하지 않았다 — null 이어야 한다. 요청을 반사하면 안 된다.
    expect(out.order.takeProfitPrice).toBeNull();
  });

  it('[5] TP/SL 이 없으면 일반 주문 경로 그대로다', async () => {
    const { impl, calls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    const out = await a.submitOrder(CTX, { ...REQ } as never);
    expect(calls[0]!.url).not.toContain('st-orders');
    if (out.status !== 'ACCEPTED') throw new Error('expected ACCEPTED');
    expect(out.order.stopLossPrice).toBeNull();
  });

  it('[6] 방향이 뒤집힌 요청은 REJECTED 로 돌아온다 (주문은 나가지 않는다)', async () => {
    const { impl, calls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    // long 인데 익절(1.8)이 진입가(2.0)보다 낮다 → 즉시 손실로 닫힌다.
    const out = await a.submitOrder(CTX, { ...REQ, takeProfitPrice: '1.8000' } as never);
    expect(out.status).toBe('REJECTED');
    expect(calls).toHaveLength(0);
  });

  it('[7] 감사기록에 어느 엔드포인트로 나갔는지 남는다', async () => {
    const { impl } = capture();
    const onAudit = vi.fn();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf, onAudit });
    await a.submitOrder(CTX, { ...REQ, stopLossPrice: '1.8000' } as never);
    const accepted = onAudit.mock.calls.find((c) => c[0] === 'order.accepted');
    expect(accepted).toBeTruthy();
    expect((accepted![1] as { endpoint?: string }).endpoint).toBe('st-orders');
  });
});

describe('BRACKET-SPOT 현물은 진입 첨부 브래킷이 없다', () => {
  const SPOT_REQ = {
    clientOrderId: 'c1',
    symbol: 'XRPUSDT',
    side: 'long' as const,
    type: 'limit' as const,
    price: '2.0000',
    quantity: '100',
  };

  it('[1] ★★ TP/SL 이 오면 조용히 버리지 않고 거부한다', async () => {
    const { impl, calls } = capture();
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, { ...SPOT_REQ, stopLossPrice: '1.8000' } as never);
    expect(out.status).toBe('REJECTED');
    // 거래소로 아무것도 나가지 않아야 한다 — 보호 없는 매수가 되면 안 된다.
    expect(calls).toHaveLength(0);
  });

  it('[2] 거부 이유가 다음 행동을 알려준다 (매수 후 OCO)', async () => {
    const { impl } = capture();
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, { ...SPOT_REQ, takeProfitPrice: '2.4000' } as never);
    if (out.status !== 'REJECTED') throw new Error('expected REJECTED');
    expect(out.reason).toMatch(/OCO/i);
  });

  it('[3] 빈 문자열은 "설정 안 함" 이다 — 일반 매수를 막지 않는다', async () => {
    const { impl, calls } = capture({ orderId: 'n1' });
    const a = new KucoinSpotTradingAdapter({ fetchImpl: impl, liveEnabled: () => true });
    const out = await a.submitOrder(CTX, {
      ...SPOT_REQ, takeProfitPrice: '', stopLossPrice: '',
    } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
  });
});
