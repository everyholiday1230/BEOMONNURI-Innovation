/*
   KuCoin 리베이트를 **태그별로** 조회하는 것을 잠근다.

   ★★★ 운영자 브로커 대시보드 실측 (2026-09-19):
       Broker Tag (Spot)     CCAI    Total Trading Volume 0
       Broker Tag (Futures)  CCAIF   Total Trading Volume 4.20K
       Total Commission Issued 2.72 USDT · Yesterday's Traders 1

     즉 태그가 **두 개이고 실적이 따로 집계된다.** 전에는 선물 자격으로
     `tradeType:'all'` 을 한 번 부르고 결과 전부를 `'spot'` 이라고 표시했다 —
     출처별 분해가 거짓이 되어 대시보드와 대조할 수 없었다.
*/
import { describe, it, expect } from 'vitest';
import { createKucoinRebateReader } from '../trading/kucoin-rebate-source';

const operator = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };
const fut = { partner: 'CCAIF', key: 'fk', name: 'CCAIF' };
const spt = { partner: 'CCAI', key: 'sk', name: 'CCAI' };

/** 요청된 (partner, tradeType) 를 기록하고, 지정된 행을 돌려주는 가짜 거래소. */
function fakeKucoin(byTag: Record<string, Record<string, unknown>[]>) {
  const seen: { partner: string; tradeType: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: { headers?: Record<string, string> }) => {
    const u = new URL(String(url));
    const partner = (init?.headers?.['KC-API-PARTNER'] as string) ?? '';
    const tradeType = u.searchParams.get('tradeType') ?? '';
    seen.push({ partner, tradeType });
    const items = byTag[`${partner}:${tradeType}`] ?? [];
    return new Response(
      JSON.stringify({ code: '200000', data: { currentPage: 1, totalPage: 1, totalNum: items.length, items } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const row = (start: number, end: number, amount: string) => ({
  siteType: 'global', rebateType: 1, payoutTime: null,
  periodStartTime: start, periodEndTime: end,
  totalCommission: amount, currency: 'USDT',
});

const JAN1 = Date.UTC(2026, 0, 1);
const JAN7 = Date.UTC(2026, 0, 7);

describe('태그별로 따로 조회한다', () => {
  it('선물 태그와 현물 태그를 각각 그 종류로 물어본다', async () => {
    const { fetchImpl, seen } = fakeKucoin({});
    const r = createKucoinRebateReader({ brokerId: 'CCAIF', operator, broker: fut, spotBroker: spt, fetchImpl });
    await r!.fetchSpot({});
    expect(seen, '태그별 조회가 아니다').toEqual([
      { partner: 'CCAIF', tradeType: 'FUTURES' },
      { partner: 'CCAI', tradeType: 'SPOT' },
    ]);
  });

  /*
     ★★★ 출처가 거짓이면 대시보드와 대조할 수 없다. 선물 실적은 'futures' 여야 한다.
       전에는 전부 'spot' 이었다.
  */
  it('선물 실적을 futures 로 표시한다', async () => {
    const { fetchImpl } = fakeKucoin({ 'CCAIF:FUTURES': [row(JAN1, JAN7, '2.72')] });
    const r = createKucoinRebateReader({ brokerId: 'CCAIF', operator, broker: fut, spotBroker: spt, fetchImpl });
    const out = await r!.fetchSpot({});
    expect(out).toEqual([{ date: '2026-01-07', currency: 'USDT', amount: '2.72', source: 'futures' }]);
  });

  it('현물 실적은 spot 으로 표시한다', async () => {
    const { fetchImpl } = fakeKucoin({
      'CCAIF:FUTURES': [row(JAN1, JAN7, '2.72')],
      'CCAI:SPOT': [row(JAN1, JAN7, '0.50')],
    });
    const r = createKucoinRebateReader({ brokerId: 'CCAIF', operator, broker: fut, spotBroker: spt, fetchImpl });
    const out = await r!.fetchSpot({});
    expect(out.map((x) => x.source).sort()).toEqual(['futures', 'spot']);
    expect(out.find((x) => x.source === 'spot')!.amount).toBe('0.50');
  });

  /*
     ★★★ **겹침 방어.** KuCoin 이 tradeType 을 무시하고 양쪽에 같은 행을 돌려주면
       수익이 두 배로 보인다. 많게 보이는 쪽으로 틀리는 것이 더 나쁘다 —
       없는 돈을 셈하고 정산 대조가 깨진다.
     ★ Bitget 은 모르는 필드를 조용히 무시한다는 것을 이미 확인했다. 거래소가
       우리 필터를 존중한다고 **가정하지 않는다.**
  */
  it('양쪽이 같은 값을 주면 두 배로 세지 않는다', async () => {
    const same = [row(JAN1, JAN7, '2.72')];
    const { fetchImpl } = fakeKucoin({ 'CCAIF:FUTURES': same, 'CCAI:SPOT': same });
    const r = createKucoinRebateReader({ brokerId: 'CCAIF', operator, broker: fut, spotBroker: spt, fetchImpl });
    const out = await r!.fetchSpot({});
    expect(out, 'tradeType 이 무시되면 수익이 두 배가 된다').toHaveLength(1);
    expect(out[0]!.amount).toBe('2.72');
  });

  /*
     ★ 현물 자격이 비어 있으면 조회하지 않는다. 빈 partner 로 부르면 엉뚱한 태그
       (또는 태그 없음)로 집계돼 남의 실적을 우리 것으로 볼 수 있다.
  */
  it('현물 자격이 없으면 선물만 조회한다', async () => {
    const { fetchImpl, seen } = fakeKucoin({});
    const r = createKucoinRebateReader({
      brokerId: 'CCAIF', operator, broker: fut,
      spotBroker: { partner: '', key: '', name: '' }, fetchImpl,
    });
    await r!.fetchSpot({});
    expect(seen).toEqual([{ partner: 'CCAIF', tradeType: 'FUTURES' }]);
  });

  it('운영자 자격이 없으면 리더를 만들지 않는다', async () => {
    const { fetchImpl } = fakeKucoin({});
    expect(createKucoinRebateReader({
      brokerId: 'CCAIF', operator: { apiKey: '', apiSecret: 's', passphrase: 'p' },
      broker: fut, fetchImpl,
    })).toBeUndefined();
  });
});
