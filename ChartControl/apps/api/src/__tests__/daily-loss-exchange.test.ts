/**
 * 일일 손실 한도를 **거래소 실현손익**으로 판정하는지 고정한다.
 *
 * ★★ 무엇을 막는 테스트인가
 *
 *   한도가 **고객이 손으로 적은 저널**로 판정되고 있었다. 적지 않은 손실은 한도에
 *   반영되지 않아, 한도를 걸어도 실제 손실을 막지 못했다. 여기서 고정하는 것은:
 *
 *     1. 거래소 값이 있으면 그것을 쓴다 (저널보다 우선).
 *     2. 조회 실패를 **0 으로 바꾸지 않는다** — 0 이 되면 한도가 사라진다.
 *     3. 이익은 음수 손실이 아니라 '0' 이다 — 음수면 한도가 헐거워진다.
 *     4. 수수료·펀딩비를 차감해 **손실을 크게 보는** 쪽으로 계산한다.
 */
import { describe, it, expect } from 'vitest';
import { KucoinAccountAdapter } from '../trading/kucoin-account-adapter.js';

type Row = {
  closeId: string; symbol: string; settleCurrency: string;
  pnl: string; tradeFee: string; fundingFee: string;
  openTime: number; closeTime: number; side: 'long' | 'short';
};

const row = (o: Partial<Row>): Row => ({
  closeId: 'c1', symbol: 'BTCUSDT', settleCurrency: 'USDT',
  pnl: '0', tradeFee: '0', fundingFee: '0',
  openTime: 1000, closeTime: 2000, side: 'long', ...o,
});

/** getPositionsHistory 만 흉내내는 최소 클라이언트. */
function adapterWith(rows: Row[] | Error) {
  const client = {
    getPositionsHistory: async () => {
      if (rows instanceof Error) throw rows;
      return rows;
    },
  };
  /*
     ★ 프로토타입만 빌려 dailyRealizedLoss 를 실제 구현으로 호출한다. 어댑터 전체를
       생성하려면 심볼 카탈로그·브로커 설정까지 필요한데, 여기서 검증하려는 것은
       **합산 규칙**뿐이다.
  */
  const a = Object.create(KucoinAccountAdapter.prototype) as {
    client: unknown;
    dailyRealizedLoss(ctx: never, from: number, to: number): Promise<string>;
  };
  a.client = client;
  return a;
}

const ctx = { credential: { apiKey: 'k', apiSecret: 's', passphrase: 'p' } } as never;

describe('일일 실현손실 — 거래소 집계', () => {
  it('손실을 양수로 합산한다', async () => {
    const a = adapterWith([
      row({ pnl: '-10.5', closeTime: 1500 }),
      row({ pnl: '-4.25', closeTime: 1600 }),
    ]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('14.75');
  });

  it('이익은 음수가 아니라 0 이다 — 음수면 한도가 헐거워진다', async () => {
    const a = adapterWith([row({ pnl: '33.3', closeTime: 1500 })]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('0');
  });

  it('수수료와 펀딩비를 차감해 손실을 크게 본다', async () => {
    /*
       pnl 0.5 인데 수수료 0.3, 펀딩비 −0.4 를 냈다 → 실제로는 0.2 손실이다.
       pnl 만 보면 이익으로 보여 한도를 통과시켜 버린다.
    */
    const a = adapterWith([
      row({ pnl: '0.5', tradeFee: '0.3', fundingFee: '-0.4', closeTime: 1500 }),
    ]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('0.2');
  });

  it('기간을 벗어난 청산은 세지 않는다', async () => {
    const a = adapterWith([
      row({ pnl: '-100', closeTime: 999 }),   // 어제
      row({ pnl: '-7', closeTime: 1500 }),    // 오늘
      row({ pnl: '-100', closeTime: 2001 }),  // 경계 밖
    ]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('7');
  });

  it('조회 실패를 0 으로 바꾸지 않고 던진다 — 0 이면 한도가 사라진다', async () => {
    const a = adapterWith(new Error('401 unauthorised'));
    await expect(a.dailyRealizedLoss(ctx, 1000, 2000)).rejects.toThrow('401');
  });

  it('청산이 없으면 손실은 0 이다 (실패와 구분된다)', async () => {
    const a = adapterWith([]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('0');
  });

  it('부동소수 오차 없이 더한다', async () => {
    /* 0.1 + 0.2 를 float 로 하면 0.30000000000000004 가 된다. */
    const a = adapterWith([
      row({ pnl: '-0.1', closeTime: 1400 }),
      row({ pnl: '-0.2', closeTime: 1500 }),
    ]);
    expect(await a.dailyRealizedLoss(ctx, 1000, 2000)).toBe('0.3');
  });
});
