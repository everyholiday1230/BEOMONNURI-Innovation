/* ============================================================
   운영자 리베이트(수익) 조회 — KuCoin
   ------------------------------------------------------------
   ★★ 왜 이 테스트가 중요한가

     수익은 KuCoin 이 주는데 조회는 BitMart 를 호출하고 있었다. BitMart 는
     2026-08-26 로 거래를 종료했고 프로덕션에 키도 없어서, 관리자 수익 화면은
     늘 NOT_CONFIGURED 였다 — **얼마 벌었는지 알 수 없는 상태**였다.

     여기서 고정하는 것은 "돈이 조용히 틀리지 않는다" 다:
       · 금액을 문자열로 그대로 옮긴다(부동소수 반올림 금지)
       · 날짜가 없는 행을 오늘로 채우지 않는다(없는 날의 수익을 만들지 않는다)
       · 초/밀리초 단위를 바꿔 보낸다(안 바꾸면 1970년을 조회해 늘 0원)
       · 페이지를 끝까지 읽는다(첫 페이지만 읽으면 수익이 적게 보인다)
   ============================================================ */

import { describe, it, expect } from 'vitest';

import { createKucoinRebateReader, commissionRowsToRebates } from '../trading/kucoin-rebate-source';
import type { BrokerCommissionRow } from '@quantumtrade/exchange-kucoin';

const row = (over: Partial<BrokerCommissionRow> = {}): BrokerCommissionRow => ({
  siteType: 'global',
  rebateType: 0,
  payoutTime: null,
  periodStartTime: 1_756_000_000_000,
  periodEndTime: 1_756_080_000_000, // 2025-08-25 (UTC)
  status: 1,
  totalTradeUser: '3',
  tagUser: '2',
  tagTradeVolume: '1000',
  tagCommission: '7.5',
  invitedUser: '2',
  noTagTradeVolume: '0',
  noTagCommission: '0',
  totalCommission: '7.5',
  currency: 'USDT',
  ...over,
});

const OPERATOR = { apiKey: 'k', apiSecret: 'cw==', passphrase: 'p' };
const BROKER = { partner: 'P', key: 'K', name: 'CCAIF' };

describe('REBATE-MAP 커미션 행 → 리베이트 기록', () => {
  it('[1] 금액을 문자열 그대로 옮긴다 (부동소수로 바꾸지 않는다)', () => {
    const out = commissionRowsToRebates([row({ totalCommission: '0.10000000000000001' })], 'spot');
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe('0.10000000000000001');
  });

  it('[2] 정산 기간 끝을 날짜로 쓴다 (UTC, YYYY-MM-DD)', () => {
    const out = commissionRowsToRebates([row({ periodEndTime: Date.UTC(2026, 0, 15, 9, 30) })], 'spot');
    expect(out[0]!.date).toBe('2026-01-15');
  });

  it('[3] ★★ 미지급(payoutTime=null) 실적도 버리지 않는다', () => {
    // payoutTime 을 기준으로 하면 아직 지급되지 않은 수익이 통째로 사라진다.
    const out = commissionRowsToRebates([row({ payoutTime: null })], 'spot');
    expect(out).toHaveLength(1);
  });

  it('[4] ★★ 날짜가 없는 행은 버린다 (오늘로 채우지 않는다)', () => {
    const out = commissionRowsToRebates([row({ periodEndTime: null, payoutTime: null })], 'spot');
    expect(out).toHaveLength(0);
  });

  it('[5] 금액이 없거나 숫자가 아니면 버린다 (0 으로 위장하지 않는다)', () => {
    expect(commissionRowsToRebates([row({ totalCommission: null })], 'spot')).toHaveLength(0);
    expect(commissionRowsToRebates([row({ totalCommission: '' })], 'spot')).toHaveLength(0);
    expect(commissionRowsToRebates([row({ totalCommission: 'abc' })], 'spot')).toHaveLength(0);
  });

  it('[6] 통화가 비어 있으면 USDT 로 본다', () => {
    expect(commissionRowsToRebates([row({ currency: null })], 'spot')[0]!.currency).toBe('USDT');
  });
});

describe('REBATE-READER KuCoin 리더', () => {
  /** getCommission 호출을 붙잡는 가짜 fetch. */
  function capture(pages: BrokerCommissionRow[][]) {
    const calls: { url: string }[] = [];
    let i = 0;
    const impl = (async (url: URL | string) => {
      calls.push({ url: String(url) });
      const items = pages[i] ?? [];
      const totalPage = pages.length;
      i += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          code: '200000',
          data: { currentPage: i, pageSize: 100, totalNum: 1, totalPage, items },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('[7] 자격이 없으면 undefined — 기동을 막지 않는다', () => {
    expect(createKucoinRebateReader({
      brokerId: 'b', operator: { apiKey: '', apiSecret: '', passphrase: '' }, broker: BROKER,
    })).toBeUndefined();
    expect(createKucoinRebateReader({
      brokerId: 'b', operator: OPERATOR, broker: { partner: '', key: '', name: '' },
    })).toBeUndefined();
  });

  it('[8] 자격이 있으면 리더를 만든다', () => {
    const r = createKucoinRebateReader({ brokerId: 'CCAIF', operator: OPERATOR, broker: BROKER, fetchImpl: capture([[]]).impl });
    expect(r).toBeTruthy();
    expect(r!.brokerId).toBe('CCAIF');
  });

  it('[9] ★★ 초 단위 입력을 밀리초로 바꿔 보낸다 (안 바꾸면 1970년을 조회한다)', async () => {
    const { impl, calls } = capture([[row()]]);
    const r = createKucoinRebateReader({ brokerId: 'b', operator: OPERATOR, broker: BROKER, fetchImpl: impl })!;
    await r.fetchSpot({ startTime: 1_756_000_000, endTime: 1_756_080_000 });
    expect(calls[0]!.url).toContain('startAt=1756000000000');
    expect(calls[0]!.url).toContain('endAt=1756080000000');
  });

  it('[10] ★★ 페이지를 끝까지 읽는다 (첫 페이지만 읽으면 수익이 적게 보인다)', async () => {
    const { impl } = capture([[row({ totalCommission: '1' })], [row({ totalCommission: '2' })]]);
    const r = createKucoinRebateReader({ brokerId: 'b', operator: OPERATOR, broker: BROKER, fetchImpl: impl })!;
    const out = await r.fetchSpot({});
    expect(out.map((x) => x.amount)).toEqual(['1', '2']);
  });

  it('[11] 기간을 주지 않으면 시간 파라미터를 보내지 않는다', async () => {
    const { impl, calls } = capture([[row()]]);
    const r = createKucoinRebateReader({ brokerId: 'b', operator: OPERATOR, broker: BROKER, fetchImpl: impl })!;
    await r.fetchSpot({});
    expect(calls[0]!.url).not.toContain('startAt=');
  });
});
