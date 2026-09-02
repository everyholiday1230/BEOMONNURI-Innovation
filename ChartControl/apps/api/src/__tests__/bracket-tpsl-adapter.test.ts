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
  mode: 'LIVE_READ_ONLY',
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
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
    /*
       ★ 어댑터는 주문 전에 마진 모드를 조회한다(거래소 설정과 맞추기 위해).
         그래서 calls[0] 은 더 이상 주문이 아니다 — 조회에도 응답하고,
         주문 호출은 orderCall() 로 찾는다.
    */
    if (u.includes('/position/getMarginMode')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ code: '200000', data: { symbol: 'XRPUSDTM', marginMode: 'ISOLATED' } }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: '200000', data: body }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  /** 주문(또는 st-orders) 호출. 없으면 undefined. */
  const orderCall = () => calls.find((c) => /\/api\/v1\/(st-)?orders/.test(c.url));
  /** 거래소로 나간 주문 요청만 센다(마진 모드 조회는 제외). */
  const orderCalls = () => calls.filter((c) => /\/api\/v1\/(st-)?orders/.test(c.url));
  return { impl, calls, orderCall, orderCalls };
}

/** XRP 는 1계약 = 1 XRP. */
const multiplierOf = () => 1;

describe('BRACKET-FUT 선물 브래킷 TP/SL', () => {
  it('[1] ★★ TP/SL 이 있으면 st-orders 로 나간다 — 일반 경로는 이 필드를 무시한다', async () => {
    const { impl, orderCall } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    const out = await a.submitOrder(CTX, {
      ...REQ, takeProfitPrice: '2.4000', stopLossPrice: '1.8000',
    } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(orderCall()!.url).toContain('/api/v1/st-orders');
  });

  it('[2] ★★ long 의 익절은 위, 손절은 아래로 매핑된다', async () => {
    const { impl, orderCall } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    await a.submitOrder(CTX, { ...REQ, takeProfitPrice: '2.4000', stopLossPrice: '1.8000' } as never);
    expect(orderCall()!.body.triggerStopUpPrice).toBe('2.4000');
    expect(orderCall()!.body.triggerStopDownPrice).toBe('1.8000');
  });

  it('[3] ★★ short 은 반대다 — 뒤집히면 손절 자리에 익절이 걸린다', async () => {
    const { impl, orderCall } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    await a.submitOrder(CTX, {
      ...REQ, side: 'short', takeProfitPrice: '1.8000', stopLossPrice: '2.4000',
    } as never);
    expect(orderCall()!.body.triggerStopDownPrice).toBe('1.8000');
    expect(orderCall()!.body.triggerStopUpPrice).toBe('2.4000');
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
    const { impl, orderCall } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    const out = await a.submitOrder(CTX, { ...REQ } as never);
    expect(orderCall()!.url).not.toContain('st-orders');
    if (out.status !== 'ACCEPTED') throw new Error('expected ACCEPTED');
    expect(out.order.stopLossPrice).toBeNull();
  });

  it('[6] 방향이 뒤집힌 요청은 REJECTED 로 돌아온다 (주문은 나가지 않는다)', async () => {
    const { impl, orderCalls } = capture();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf });
    // long 인데 익절(1.8)이 진입가(2.0)보다 낮다 → 즉시 손실로 닫힌다.
    const out = await a.submitOrder(CTX, { ...REQ, takeProfitPrice: '1.8000' } as never);
    expect(out.status).toBe('REJECTED');
    // 거래소로 주문이 나가지 않아야 한다(마진 모드 조회는 있을 수 있다).
    expect(orderCalls()).toHaveLength(0);
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

describe('QTY-TRUTH 주문 수량은 실제로 나간 값이어야 한다', () => {
  /*
     ★★ KuCoin 선물은 계약(정수)로만 주문한다. 요청 수량은 승수 단위로 내림된다.
       전에는 NormalizedOrder.quantity 에 요청값을 그대로 반사해서, 화면과
       주문내역이 실제보다 **큰 수량**을 보여줬다. 이용자는 그 값으로 손익과
       청산가를 계산한다.
  */
  it('[1] ★★ 내림이 일어나면 실제 나간 수량을 보고한다 (요청값 반사 금지)', async () => {
    const { impl } = capture();
    // 승수 0.001 → 0.0035 요청은 3계약(0.003)만 나간다.
    const a = new KucoinTradingAdapter({
      fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 0.001,
    });
    const out = await a.submitOrder(CTX, {
      ...REQ, symbol: 'BTCUSDT', quantity: '0.0035', price: '64000',
    } as never);
    if (out.status !== 'ACCEPTED') throw new Error('expected ACCEPTED, got ' + out.status);
    expect(out.order.quantity).toBe('0.003');
    expect(out.order.quantity).not.toBe('0.0035');
  });

  it('[2] 내림이 없으면 요청 수량과 같다', async () => {
    const { impl } = capture();
    const a = new KucoinTradingAdapter({
      fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 0.001,
    });
    const out = await a.submitOrder(CTX, {
      ...REQ, symbol: 'BTCUSDT', quantity: '0.003', price: '64000',
    } as never);
    if (out.status !== 'ACCEPTED') throw new Error('expected ACCEPTED');
    expect(out.order.quantity).toBe('0.003');
  });

  it('[3] 버려진 수량을 감사기록에 남긴다', async () => {
    const { impl } = capture();
    const onAudit = vi.fn();
    const a = new KucoinTradingAdapter({
      fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 0.001, onAudit,
    });
    await a.submitOrder(CTX, { ...REQ, symbol: 'BTCUSDT', quantity: '0.0035', price: '64000' } as never);
    const accepted = onAudit.mock.calls.find((c) => c[0] === 'order.accepted');
    const detail = accepted![1] as { requestedQuantity?: string; submittedQuantity?: string; droppedQuantity?: string };
    expect(detail.requestedQuantity).toBe('0.0035');
    expect(detail.submittedQuantity).toBe('0.003');
    expect(detail.droppedQuantity).toBe('0.0005');
  });
});

describe('MARGIN-ALIGN 주문 마진 모드를 거래소 설정에 맞춘다', () => {
  /*
     ★★ 실제 장애: 이용자가 화면에서 ISOLATED 를 골랐지만 거래소의 그 심볼은
       CROSS 였다. KuCoin 은 불일치를 거부한다 —
       "The order's margin mode does not match the selected one."
       고객은 "매매가 안 된다" 고만 알 수 있었다.
  */
  function captureWithMode(mode: string | null) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = (async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
      // 마진 모드 조회 요청이면 설정값을 돌려준다.
      if (u.includes('/position/getMarginMode')) {
        if (mode === null) return { ok: false, status: 500, text: async () => '{}' } as unknown as Response;
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ code: '200000', data: { symbol: 'XRPUSDTM', marginMode: mode } }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ code: '200000', data: { orderId: 'o1', clientOid: 'c1' } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }
  const orderBody = (calls: { url: string; body: Record<string, unknown> }[]) =>
    calls.find((c) => c.url.includes('/api/v1/orders'))?.body ?? {};

  it('[1] ★★ 거래소가 CROSS 면 이용자가 ISOLATED 를 골랐어도 CROSS 로 보낸다', async () => {
    const { impl, calls } = captureWithMode('CROSS');
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 1 });
    const out = await a.submitOrder(CTX, { ...REQ, marginMode: 'isolated' } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(orderBody(calls).marginMode).toBe('CROSS');
  });

  it('[2] 거래소가 ISOLATED 면 ISOLATED 로 보낸다', async () => {
    const { impl, calls } = captureWithMode('ISOLATED');
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 1 });
    await a.submitOrder(CTX, { ...REQ, marginMode: 'cross' } as never);
    expect(orderBody(calls).marginMode).toBe('ISOLATED');
  });

  it('[3] 조회가 실패하면 이용자 선택으로 진행한다 (주문을 막지 않는다)', async () => {
    const { impl, calls } = captureWithMode(null);
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 1 });
    const out = await a.submitOrder(CTX, { ...REQ, marginMode: 'cross' } as never);
    expect(out.status).toBe('ACCEPTED');
    expect(orderBody(calls).marginMode).toBe('CROSS');
  });

  it('[4] 정렬이 일어나면 감사기록에 남는다', async () => {
    const { impl } = captureWithMode('CROSS');
    const onAudit = vi.fn();
    const a = new KucoinTradingAdapter({ fetchImpl: impl, liveEnabled: () => true, multiplierOf: () => 1, onAudit });
    await a.submitOrder(CTX, { ...REQ, marginMode: 'isolated' } as never);
    const ev = onAudit.mock.calls.find((c) => c[0] === 'order.margin_mode_aligned');
    expect(ev).toBeTruthy();
    expect(ev![1]).toMatchObject({ requested: 'isolated', exchange: 'cross' });
  });
});
