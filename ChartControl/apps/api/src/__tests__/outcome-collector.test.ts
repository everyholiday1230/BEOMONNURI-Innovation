import { describe, it, expect } from 'vitest';
import {
  outcomeKindOf, buildOrderOutcomes, attributeRealizedPnl,
  type KnownDecision, type ObservedOrder,
} from '../learning/outcome-collector';

/**
 * 거래 결과 수집 검사.
 *
 * ★★ 이 수집기가 없던 동안 판단만 쌓였다(실측: 판단 5건 / 결과 0건). 지도학습에는
 *   정답이 있어야 하므로, 그 상태의 표본은 아무리 많아도 학습에 못 쓴다.
 *   그래서 "결과가 실제로 붙는가" 와 "없는 결과를 만들지 않는가" 를 함께 고정한다.
 */

const DEC = (over: Partial<KnownDecision> = {}): KnownDecision => ({
  id: 'd1',
  clientOrderId: 'c1',
  symbol: 'BTCUSDT',
  side: 'long',
  market: 'futures',
  executionMode: 'live',
  decidedAt: 1_000_000,
  ...over,
});

const ORD = (over: Partial<ObservedOrder> = {}): ObservedOrder => ({
  clientOrderId: 'c1',
  symbol: 'BTCUSDT',
  side: 'long',
  quantity: '1',
  filledQuantity: '1',
  status: 'FILLED',
  createdAt: 1_000_000,
  updatedAt: 1_060_000,
  ...over,
});

describe('OUT-01 주문 상태 → 결과 종류', () => {
  it('[1] 진행 중인 주문은 결과가 아니다', () => {
    /*
       ★ open/new/pending 을 'filled' 로 만들면 체결되지 않은 주문이 체결로
         학습된다. null 이어야 한다.
    */
    for (const s of ['open', 'NEW', 'active', 'pending', 'partially_filled_open']) {
      expect(outcomeKindOf(s, 0, 1)).toBeNull();
    }
  });

  it('[2] 전량과 부분을 구분한다', () => {
    expect(outcomeKindOf('FILLED', 1, 1)).toBe('filled');
    // 수량이 다르면 결과가 다르다 — 합쳐 세면 체결량이 데이터에서 사라진다.
    expect(outcomeKindOf('FILLED', 0.4, 1)).toBe('partial');
  });

  it('[3] ★ 일부 체결 후 취소는 partial 이다', () => {
    /*
       'canceled' 로만 적으면 이미 체결된 수량이 없던 일이 된다 — 그 포지션은
       실제로 존재했고 손익도 났다.
    */
    expect(outcomeKindOf('CANCELED', 0.3, 1)).toBe('partial');
    expect(outcomeKindOf('CANCELED', 0, 1)).toBe('canceled');
  });

  it('[4] 만료·청산을 구분한다', () => {
    expect(outcomeKindOf('EXPIRED', 0, 1)).toBe('expired');
    expect(outcomeKindOf('LIQUIDATED', 1, 1)).toBe('liquidated');
  });
});

describe('OUT-02 판단에 결과를 잇는다', () => {
  it('[1] clientOrderId 로 정확히 맞춘다', () => {
    const out = buildOrderOutcomes({ userId: 'u1', decisions: [DEC()], orders: [ORD()] });
    expect(out).toHaveLength(1);
    expect(out[0]!.decisionId).toBe('d1');
    expect(out[0]!.outcomeKind).toBe('filled');
    // 추정이 아니라 정확한 연결임을 밝힌다.
    expect(out[0]!.observedFrom).toBe('exchange_order');
  });

  it('[2] 모의는 출처를 sim 으로 남긴다', () => {
    const out = buildOrderOutcomes({
      userId: 'u1',
      decisions: [DEC({ executionMode: 'paper' })],
      orders: [ORD()],
    });
    /*
       ★ 모의와 실거래를 섞으면 학습이 오염된다(모의는 슬리피지가 실제와 다르다).
         출처로 구분할 수 있어야 한다.
    */
    expect(out[0]!.observedFrom).toBe('sim');
    expect(out[0]!.executionMode).toBe('paper');
  });

  it('[3] ★★ 판단이 없는 주문은 잇지 않는다', () => {
    // 우리 화면을 거치지 않은 주문이다. 아무 판단에 붙이면 근거가 조작된다.
    const out = buildOrderOutcomes({
      userId: 'u1',
      decisions: [DEC({ clientOrderId: 'other' })],
      orders: [ORD({ clientOrderId: 'c1' })],
    });
    expect(out).toHaveLength(0);
  });

  it('[4] ★★ 이미 기록된 결과를 다시 만들지 않는다', () => {
    /*
       결과는 조회할 때마다 수집한다. 막지 않으면 같은 거래가 표본 10번·100번이
       되고 학습에서 그만큼 가중치를 갖는다 — 자주 화면을 여는 이용자의 거래가
       모델을 지배한다.
    */
    const out = buildOrderOutcomes({
      userId: 'u1', decisions: [DEC()], orders: [ORD()],
      already: new Set(['d1:filled']),
    });
    expect(out).toHaveLength(0);
  });

  it('[5] ★★ 체결 평균가를 진입가로 쓴다 (요청가가 아니다)', () => {
    const out = buildOrderOutcomes({
      userId: 'u1',
      decisions: [DEC()],
      orders: [ORD({ price: '100', quantity: '2', filledQuantity: '2' })],
      fills: [
        { clientOrderId: 'c1', symbol: 'BTCUSDT', price: '100', quantity: '1', fee: '0.1', at: 1 },
        { clientOrderId: 'c1', symbol: 'BTCUSDT', price: '110', quantity: '1', fee: '0.1', at: 2 },
      ],
    });
    /*
       ★ 지정가의 `price` 는 **요청한 가격**이다. 실제 체결가와 다를 수 있고
         시장가는 price 가 아예 없다. 요청가를 기록하면 슬리피지가 사라진다.
    */
    expect(Number(out[0]!.entryPrice)).toBe(105);
    expect(Number(out[0]!.fees)).toBeCloseTo(0.2, 10);
  });

  it('[6] ★★ 수수료를 모르는 체결이 섞이면 합계도 모른다', () => {
    const out = buildOrderOutcomes({
      userId: 'u1', decisions: [DEC()], orders: [ORD({ quantity: '2', filledQuantity: '2' })],
      fills: [
        { clientOrderId: 'c1', symbol: 'BTCUSDT', price: '100', quantity: '1', fee: '0.1', at: 1 },
        { clientOrderId: 'c1', symbol: 'BTCUSDT', price: '100', quantity: '1', fee: null, at: 2 },
      ],
    });
    /*
       ★ 0 으로 세면 "수수료가 없었다" 가 되고 순손익이 낙관적으로 틀어진다.
    */
    expect(out[0]!.fees).toBeNull();
  });

  it('[7] 체결만으로는 손익·청산가를 만들지 않는다', () => {
    const out = buildOrderOutcomes({ userId: 'u1', decisions: [DEC()], orders: [ORD()] });
    // 진입 체결은 손익을 말해주지 않는다. 청산이 붙어야 안다.
    expect(out[0]!.realizedPnl).toBeNull();
    expect(out[0]!.exitPrice).toBeNull();
    expect(out[0]!.roiPct).toBeNull();
    // 왜 끝났는지도 주문 상태만으로는 모른다.
    expect(out[0]!.closeReason).toBe('unknown');
  });
});

describe('OUT-03 실현손익 연결은 추정이며 그렇게 표시한다', () => {
  const base = {
    userId: 'u1',
    market: 'futures' as const,
    executionMode: 'live' as const,
    closedDecisionIds: new Set<string>(),
    filledDecisionIds: new Set(['d1']),
  };

  it('[1] 같은 종목의 가장 최근 진입에 붙이고 추정으로 표시한다', () => {
    const out = attributeRealizedPnl({
      ...base,
      decisions: [DEC()],
      entries: [{ symbol: 'BTCUSDT', amount: '-12.5', at: 2_000_000 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.decisionId).toBe('d1');
    expect(out[0]!.realizedPnl).toBe('-12.5');
    /*
       ★★ 거래소 원장은 "이 손익이 어느 주문에서 나왔는지" 를 알려주지 않는다.
         추정임을 남겨야 학습에서 걸러낼 수 있다 — 구분하지 않으면 추정이
         사실로 섞인다.
    */
    expect(out[0]!.observedFrom).toBe('position_diff');
  });

  it('[2] ★★ 체결되지 않은 판단에는 붙이지 않는다', () => {
    const out = attributeRealizedPnl({
      ...base,
      filledDecisionIds: new Set(),   // 진입이 관측되지 않았다
      decisions: [DEC()],
      entries: [{ symbol: 'BTCUSDT', amount: '5', at: 2_000_000 }],
    });
    // 진입이 없으면 청산될 수 없다. 판단 없이 남긴다(버리지 않는다).
    expect(out[0]!.decisionId).toBeNull();
    expect(out[0]!.realizedPnl).toBe('5');
  });

  it('[3] 판단보다 앞선 손익에는 붙이지 않는다', () => {
    const out = attributeRealizedPnl({
      ...base,
      decisions: [DEC({ decidedAt: 3_000_000 })],
      entries: [{ symbol: 'BTCUSDT', amount: '5', at: 2_000_000 }],
    });
    // 주문을 내기 전에 발생한 손익은 그 주문의 결과가 아니다.
    expect(out[0]!.decisionId).toBeNull();
  });

  it('[4] 한 판단에 두 손익을 붙이지 않는다', () => {
    const out = attributeRealizedPnl({
      ...base,
      decisions: [DEC()],
      entries: [
        { symbol: 'BTCUSDT', amount: '5', at: 2_000_000 },
        { symbol: 'BTCUSDT', amount: '7', at: 2_100_000 },
      ],
    });
    expect(out[0]!.decisionId).toBe('d1');
    // 두 번째는 붙일 판단이 없다 — 임의로 같은 판단에 또 붙이면 손익이 두 배가 된다.
    expect(out[1]!.decisionId).toBeNull();
  });

  it('[5] 청산은 close_reason 을 남기고, 나머지는 추측하지 않는다', () => {
    const liq = attributeRealizedPnl({
      ...base, decisions: [DEC()],
      entries: [{ symbol: 'BTCUSDT', amount: '-99', at: 2_000_000, kind: 'LIQUIDATION' }],
    });
    expect(liq[0]!.outcomeKind).toBe('liquidated');
    expect(liq[0]!.closeReason).toBe('liquidation');

    const plain = attributeRealizedPnl({
      ...base, decisions: [DEC()],
      entries: [{ symbol: 'BTCUSDT', amount: '30', at: 2_000_000, kind: 'REALIZED_PNL' }],
    });
    /*
       ★ 이익이 났다고 'take_profit' 으로 적으면 안 된다 — 손절 주문에서도
         이익이 날 수 있다. 모르면 unknown 이다.
    */
    expect(plain[0]!.closeReason).toBe('unknown');
  });

  it('[6] 숫자가 아닌 손익은 버린다 (0 으로 만들지 않는다)', () => {
    const out = attributeRealizedPnl({
      ...base, decisions: [DEC()],
      entries: [{ symbol: 'BTCUSDT', amount: 'n/a', at: 2_000_000 }],
    });
    expect(out).toHaveLength(0);
  });
});
