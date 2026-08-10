/**
 * KuCoin 거래 어댑터 안전성 검증.
 *
 * 이 어댑터는 실제로 돈이 나가는 경로다. 검증하는 것:
 *   · 잠금이 걸려 있으면 어떤 요청도 거래소로 나가지 않는가
 *   · 킬스위치를 런타임에 눌러도 즉시 반영되는가
 *   · 승수를 모를 때 주문을 보내지 않는가
 *   · 결과를 알 수 없을 때 REJECTED 가 아니라 SUBMIT_UNKNOWN 을 주는가
 *
 * 마지막 항목이 특히 중요하다. 타임아웃에 REJECTED 를 주면 사용자가 다시
 * 주문해서 포지션이 두 배가 된다.
 */

import { describe, expect, it, vi } from 'vitest';

import { KucoinTradingAdapter } from '../trading/kucoin-trading-adapter';

const CTX = {
  mode: 'BITMART_LIVE_READ_ONLY' as never,
  credential: { accessKey: 'k', secretKey: 'cw==', memo: 'p' },
};

const REQ = {
  clientOrderId: 'qt-test-1',
  symbol: 'BTCUSDT',
  side: 'long' as const,
  type: 'market' as const,
  quantity: '0.01',
  leverage: 10,
};

/** 호출을 기록하는 가짜 fetch. */
function fakeFetch(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (handler) return handler(String(input), init);
    return new Response(JSON.stringify({ code: '200000', data: { orderId: 'oid', clientOid: REQ.clientOrderId } }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function make(opts: {
  live: boolean | (() => boolean);
  multiplier?: number | undefined;
  fetchImpl?: typeof fetch;
  audit?: (e: string, d: Record<string, unknown>) => void;
}) {
  return new KucoinTradingAdapter({
    fetchImpl: opts.fetchImpl ?? fakeFetch().impl,
    liveEnabled: typeof opts.live === 'function' ? opts.live : () => opts.live as boolean,
    multiplierOf: () => opts.multiplier,
    onAudit: opts.audit,
  });
}

describe('실주문 잠금', () => {
  it('잠겨 있으면 거래소로 요청이 나가지 않는다', async () => {
    const { impl, calls } = fakeFetch();
    const a = make({ live: false, multiplier: 0.001, fetchImpl: impl });

    const r = await a.submitOrder(CTX, REQ);

    expect(r.status).toBe('REJECTED');
    // 가장 중요한 단정: 네트워크 호출 자체가 0 이어야 한다.
    expect(calls).toHaveLength(0);
  });

  it('canPlaceRealOrders 가 잠금 상태를 반영한다', () => {
    expect(make({ live: false, multiplier: 0.001 }).canPlaceRealOrders).toBe(false);
    expect(make({ live: true, multiplier: 0.001 }).canPlaceRealOrders).toBe(true);
  });

  it('킬스위치를 런타임에 눌러도 즉시 반영된다', async () => {
    // 부팅 시점 값을 캐시하면 킬스위치가 무력해진다. 매 호출마다 확인해야 한다.
    let allowed = true;
    const { impl, calls } = fakeFetch();
    const a = make({ live: () => allowed, multiplier: 0.001, fetchImpl: impl });

    const first = await a.submitOrder(CTX, REQ);
    expect(first.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);

    allowed = false; // 킬스위치 ON
    const second = await a.submitOrder(CTX, { ...REQ, clientOrderId: 'qt-test-2' });
    expect(second.status).toBe('REJECTED');
    // 두 번째 요청은 나가지 않아야 한다.
    expect(calls).toHaveLength(1);
  });

  it('취소도 잠금을 따른다', async () => {
    const { impl, calls } = fakeFetch();
    const a = make({ live: false, multiplier: 0.001, fetchImpl: impl });
    const r = await a.cancelOrder(CTX, 'BTCUSDT', 'qt-test-1');
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('승수 없음', () => {
  it('승수를 모르면 주문하지 않는다', async () => {
    const { impl, calls } = fakeFetch();
    const a = make({ live: true, multiplier: undefined, fetchImpl: impl });

    const r = await a.submitOrder(CTX, REQ);

    expect(r.status).toBe('REJECTED');
    expect(r.status === 'REJECTED' && r.reason).toMatch(/multiplier/i);
    // 승수를 추측해서 주문하면 수량이 틀린다. 요청이 나가면 안 된다.
    expect(calls).toHaveLength(0);
  });
});

describe('결과를 알 수 없는 경우 (가장 위험한 상태)', () => {
  it.each([
    ['타임아웃', () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; }],
    ['네트워크 실패', () => { throw new Error('fetch failed'); }],
    ['연결 초기화', () => { throw new Error('socket hang up ECONNRESET'); }],
  ])('%s 는 SUBMIT_UNKNOWN 이다 — REJECTED 로 주면 중복 주문이 된다', async (_label, thrower) => {
    const impl = vi.fn(async () => { thrower(); return new Response(''); }) as unknown as typeof fetch;
    const a = make({ live: true, multiplier: 0.001, fetchImpl: impl });

    const r = await a.submitOrder(CTX, REQ);

    expect(r.status).toBe('SUBMIT_UNKNOWN');
    // 조회해서 확인할 근거(clientOrderId)가 반드시 함께 와야 한다.
    expect(r.status === 'SUBMIT_UNKNOWN' && r.clientOrderId).toBe(REQ.clientOrderId);
  });

  it('5xx 는 SUBMIT_UNKNOWN 이다 — 거래소가 받았을 수 있다', async () => {
    const impl = vi.fn(async () =>
      new Response(JSON.stringify({ code: '500000', msg: 'internal error' }), { status: 503 }),
    ) as unknown as typeof fetch;
    const a = make({ live: true, multiplier: 0.001, fetchImpl: impl });

    const r = await a.submitOrder(CTX, REQ);
    expect(r.status).toBe('SUBMIT_UNKNOWN');
  });

  it('4xx 자격증명 오류는 REJECTED 다 — 주문이 나가지 않은 것이 확실하다', async () => {
    const impl = vi.fn(async () =>
      new Response(JSON.stringify({ code: '400003', msg: 'invalid key' }), { status: 400 }),
    ) as unknown as typeof fetch;
    const a = make({ live: true, multiplier: 0.001, fetchImpl: impl });

    const r = await a.submitOrder(CTX, REQ);
    expect(r.status).toBe('REJECTED');
  });

  it('알 수 없는 상태는 감사 로그에 남고 조치를 지시한다', async () => {
    const events: { e: string; d: Record<string, unknown> }[] = [];
    const impl = vi.fn(async () => { throw new Error('fetch failed'); }) as unknown as typeof fetch;
    const a = make({
      live: true, multiplier: 0.001, fetchImpl: impl,
      audit: (e, d) => events.push({ e, d }),
    });

    await a.submitOrder(CTX, REQ);

    const unknown = events.find((x) => x.e === 'order.unknown');
    expect(unknown).toBeDefined();
    // 사람이 확인해야 하는 상태다. 조용히 지나가면 중복 포지션이 남는다.
    expect(unknown!.d.action).toBe('reconcile_by_client_order_id');
  });
});

describe('감사 로그', () => {
  it('제출 성공이 기록되고 리베이트 집계 여부가 함께 남는다', async () => {
    const events: { e: string; d: Record<string, unknown> }[] = [];
    const a = make({ live: true, multiplier: 0.001, audit: (e, d) => events.push({ e, d }) });

    await a.submitOrder(CTX, REQ);

    const accepted = events.find((x) => x.e === 'order.accepted');
    expect(accepted).toBeDefined();
    // 브로커 헤더 없이 나간 주문은 수익이 0 이다. 기록으로 확인할 수 있어야 한다.
    expect(accepted!.d).toHaveProperty('brokerAttached');
    expect(accepted!.d.contractsSent).toBe('10');
  });

  it('잠금으로 막힌 주문도 기록된다', async () => {
    const events: string[] = [];
    const a = make({ live: false, multiplier: 0.001, audit: (e) => events.push(e) });
    await a.submitOrder(CTX, REQ);
    expect(events).toContain('order.blocked');
  });
});

describe('주문 수정', () => {
  it('지원하지 않는다고 분명히 답한다', async () => {
    // KuCoin 선물에 수정 API 가 없다. 취소 후 재주문으로 흉내내면 그 사이
    // 시장이 움직여 의도하지 않은 가격에 체결된다.
    const a = make({ live: true, multiplier: 0.001 });
    const r = await a.modifyOrder();
    expect(r.ok).toBe(false);
  });
});
