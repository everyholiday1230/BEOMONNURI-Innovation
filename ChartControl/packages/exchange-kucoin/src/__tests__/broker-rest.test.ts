/**
 * KuCoin 브로커 정산 조회 테스트.
 *
 * 무엇을 고정하는가
 * ---------------
 * ★ 이 API 들은 **우리 수익을 확인하는 유일한 경로**다. 조용히 빈 값을 주면
 *   "수익이 0" 인지 "조회가 깨졌는지" 구분할 수 없다. 그래서 필드 매핑과
 *   페이지네이션 방식을 테스트로 못 박는다.
 *
 * 실제 문서에서 확인한 함정 3개를 각각 테스트로 남긴다:
 *   1. 리베이트는 CSV 링크를 준다 (JSON 데이터가 아니다)
 *   2. 사용자 내역은 커서 페이지네이션이고 data 가 배열 그대로다
 *   3. 응답에 `WithoutTag`/`WithNoTag`, `future`/`futures` 가 섞여 있다
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KUCOIN_SPOT_REST,
  KucoinBrokerClient,
  KucoinBrokerError,
} from '../broker-rest.js';

const OPERATOR = { apiKey: 'op-key', apiSecret: 'op-secret', passphrase: 'op-pass' };
const BROKER = { partner: 'PARTNER', key: 'broker-key', name: 'ChartControl' };

/** 요청을 기록하고 정해진 응답을 주는 fetch. */
function stubFetch(payload: unknown, opts: { status?: number; code?: string } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    return new Response(
      JSON.stringify({ code: opts.code ?? '200000', data: payload }),
      { status: opts.status ?? 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('KucoinBrokerClient', () => {
  it('스팟 도메인을 기본으로 쓴다', () => {
    /*
       ★ 브로커 경로는 api.kucoin.com 에만 있다. 선물 도메인으로 요청하면 404 다.
    */
    const { impl, calls } = stubFetch({ items: [] });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    return c.getCommission(OPERATOR, BROKER).then(() => {
      expect(calls[0]!.url.startsWith('https://api.kucoin.com/')).toBe(true);
      expect(calls[0]!.url).not.toContain('api-futures');
    });
  });

  it('운영자 키로 서명하고 브로커 헤더를 붙인다', async () => {
    const { impl, calls } = stubFetch({ items: [] });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getCommission(OPERATOR, BROKER);

    const h = calls[0]!.headers;
    expect(h['KC-API-KEY']).toBe('op-key');
    expect(h['KC-API-SIGN']).toBeTruthy();
    // 브로커 전용 경로이므로 파트너 식별을 함께 보낸다.
    expect(h['KC-API-PARTNER']).toBe('PARTNER');
    expect(h['KC-API-PARTNER-SIGN']).toBeTruthy();
  });

  it('브로커 자격증명이 없어도 조회는 시도한다', async () => {
    /*
       ★ 파트너 헤더 없이도 운영자 키로 조회는 가능하다(문서상 필수 명시 없음).
         자격증명이 없다고 조회 자체를 막으면 "브로커 신청 상태" 를 확인할 수 없다.
    */
    const { impl, calls } = stubFetch({ items: [] });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getCommission(OPERATOR, null);
    expect(calls[0]!.headers['KC-API-PARTNER']).toBeUndefined();
    expect(calls[0]!.headers['KC-API-KEY']).toBe('op-key');
  });

  // ---- 커미션 ----

  it('커미션의 태그 있음·없음을 따로 담는다', async () => {
    /*
       ★★ 이 구분이 핵심이다.

         tagCommission = 우리 서명이 붙은 거래의 커미션 → 우리 실적
         noTagCommission = 서명 없이 거래된 것 → 우리 실적이 아니다

         둘을 합쳐 하나로 보여주면 "서명이 새고 있다" 는 사실을 못 본다.
    */
    const { impl } = stubFetch({
      currentPage: 1, pageSize: 1, totalNum: 17, totalPage: 17,
      items: [{
        siteType: 'europe', rebateType: 0, payoutTime: 1758761640000,
        periodStartTime: 1758643200000, periodEndTime: 1758729599999, status: 2,
        totalTradeUser: '1', tagUser: '1',
        tagTradeVolume: '2.9530', tagCommission: '0.0007',
        invitedUser: '1',
        noTagTradeVolume: '3.0000', noTagCommission: '0.0008',
        totalCommission: '0.0015', currency: 'USDT',
      }],
    });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const page = await c.getCommission(OPERATOR, BROKER);

    expect(page.totalNum).toBe(17);
    const row = page.items[0]!;
    expect(row.tagCommission).toBe('0.0007');
    expect(row.noTagCommission).toBe('0.0008');
    expect(row.totalCommission).toBe('0.0015');
    // 금액은 문자열로 통과한다 — Number 로 바꾸면 조용히 반올림된다.
    expect(typeof row.tagCommission).toBe('string');
  });

  it('페이지 크기를 상한으로 자른다', async () => {
    const { impl, calls } = stubFetch({ items: [] });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getCommission(OPERATOR, BROKER, { pageSize: 99_999 });
    expect(calls[0]!.url).toContain('pageSize=500');
  });

  it('빈 값을 쿼리에 보내지 않는다', async () => {
    /*
       ★ 빈 문자열을 보내면 KuCoin 이 그것을 필터로 해석해 결과가 0 이 되는
         경우가 있다. 지정하지 않은 파라미터는 아예 넣지 않는다.
    */
    const { impl, calls } = stubFetch({ items: [] });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getUserList(OPERATOR, BROKER, { uid: '', rcode: undefined });
    expect(calls[0]!.url).not.toContain('uid=');
    expect(calls[0]!.url).not.toContain('rcode=');
  });

  // ---- 사용자 목록 ----

  it('사용자 목록의 단수·복수 선물 필드를 모두 읽는다', async () => {
    /*
       ★★ 같은 응답에 `futureTradingVolumeWithTag`(단수)와
         `futuresTradingVolumeWithTag`(복수)가 함께 온다. 우리는 선물 브로커이므로
         한쪽만 읽으면 실적이 0 으로 보인다.
    */
    const { impl } = stubFetch({
      items: [{
        uid: '204230645', nickName: 'kg901',
        futureTradingVolumeWithTag: '0.0000',
        futuresTradingVolumeWithTag: '123.4567',
        spotTradingVolumeWithTag: '10.0000',
        currency: 'USDT',
      }],
    });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const page = await c.getUserList(OPERATOR, BROKER);
    // 복수형에 값이 있으면 그것을 쓴다.
    expect(page.items[0]!.futuresTradingVolumeWithTag).toBe('123.4567');
  });

  it('WithoutTag 와 WithNoTag 를 모두 읽는다', async () => {
    /*
       ★★ KuCoin 이 필드명을 바꾸는 중이라 두 이름이 섞여 나온다.
         한 이름만 읽으면 값이 조용히 null 이 된다.
    */
    const { impl } = stubFetch([{
      uid: '248972427', tradeTime: 1758729060000,
      spotTradingVolumeWithNoTag: '5.5',
      tradingFeeWithNoTag: '0.01',
      commissionWithNoTag: '0.002',
      lastId: 'cursor-1',
    }]);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const out = await c.getUserTransactions(OPERATOR, BROKER, { uid: '248972427' });

    expect(out.items[0]!.spotTradingVolumeWithoutTag).toBe('5.5');
    expect(out.items[0]!.tradingFeeWithoutTag).toBe('0.01');
    expect(out.items[0]!.commissionWithoutTag).toBe('0.002');
  });

  // ---- 사용자 내역 (커서) ----

  it('사용자 내역은 배열 응답을 그대로 처리한다', async () => {
    /*
       ★★ 다른 조회와 달리 `data` 가 배열이다 (`{items}` 로 감싸져 있지 않다).
         같은 코드로 처리하려 하면 빈 목록이 된다.
    */
    const { impl } = stubFetch([
      { uid: '1', tradeTime: 1, lastId: 'a' },
      { uid: '2', tradeTime: 2, lastId: 'b' },
    ]);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const out = await c.getUserTransactions(OPERATOR, BROKER);
    expect(out.items).toHaveLength(2);
  });

  it('다음 커서는 마지막 행의 lastId 다', async () => {
    const { impl } = stubFetch([
      { uid: '1', lastId: 'first' },
      { uid: '2', lastId: 'last' },
    ]);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const out = await c.getUserTransactions(OPERATOR, BROKER);
    expect(out.nextCursor).toBe('last');
  });

  it('빈 목록이면 커서가 null 이다', async () => {
    // 커서를 만들어 넘기면 같은 자리를 무한히 다시 읽는다.
    const { impl } = stubFetch([]);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const out = await c.getUserTransactions(OPERATOR, BROKER);
    expect(out.nextCursor).toBeNull();
  });

  it('커서와 방향을 요청에 넣는다', async () => {
    const { impl, calls } = stubFetch([]);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getUserTransactions(OPERATOR, BROKER, { lastId: 'cur-9', direction: 'NEXT' });
    expect(calls[0]!.url).toContain('lastId=cur-9');
    expect(calls[0]!.url).toContain('direction=NEXT');
  });

  // ---- 리베이트 CSV ----

  it('리베이트는 CSV 다운로드 링크를 준다', async () => {
    /*
       ★★ 데이터가 아니라 서명된 S3 링크다. JSON 배열을 기대하면 실패한다.
    */
    const { impl } = stubFetch({ url: 'https://kc-v2-promotion.s3.amazonaws.com/x.csv?X-Amz-Security-Token=abc' });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const out = await c.getRebateCsvUrl(OPERATOR, BROKER, { begin: '20250101', end: '20250201' });
    expect(out.url).toContain('.csv');
  });

  it('날짜는 YYYYMMDD 만 받는다', async () => {
    /*
       ★ ISO 형식(2025-01-01)을 보내면 조용히 빈 결과가 나올 수 있다.
         조용한 실패보다 즉시 거부가 낫다.
    */
    const { impl } = stubFetch({ url: null });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await expect(
      c.getRebateCsvUrl(OPERATOR, BROKER, { begin: '2025-01-01', end: '20250201' }),
    ).rejects.toThrow(/YYYYMMDD/);
  });

  it('선물을 기본 거래 종류로 쓴다', async () => {
    // 이 서비스는 선물 브로커다. 기본값이 SPOT 이면 우리 실적이 안 나온다.
    const { impl, calls } = stubFetch({ url: null });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await c.getRebateCsvUrl(OPERATOR, BROKER, { begin: '20250101', end: '20250201' });
    expect(calls[0]!.url).toContain('tradeType=FUTURES');
  });

  // ---- 오류 ----

  it('권한 오류는 재시도하지 않는다', async () => {
    /*
       ★ 브로커로 승인되지 않은 키로 부르면 권한 오류가 온다. 그것은 장애가
         아니라 "아직 브로커가 아니다" 라는 사실이므로 재시도가 무의미하다.
    */
    const { impl } = stubFetch(null, { status: 401, code: '400007' });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await expect(c.getCommission(OPERATOR, BROKER)).rejects.toMatchObject({
      name: 'KucoinBrokerError',
      retryable: false,
    });
  });

  it('서버 오류는 재시도 가능으로 표시한다', async () => {
    const { impl } = stubFetch(null, { status: 502, code: '500000' });
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await expect(c.getCommission(OPERATOR, BROKER)).rejects.toMatchObject({ retryable: true });
  });

  it('JSON 이 아닌 응답을 오류로 만든다', async () => {
    const impl = (async () =>
      new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof fetch;
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    await expect(c.getCommission(OPERATOR, BROKER)).rejects.toThrow(KucoinBrokerError);
  });

  it('잘못된 restBase 를 거부한다', () => {
    expect(() => new KucoinBrokerClient({ restBase: 'ftp://x' })).toThrow(/http/);
    expect(() => new KucoinBrokerClient({ restBase: 'not a url' })).toThrow(/URL/);
  });

  it('응답이 비어도 빈 목록을 준다', async () => {
    // data 가 null 이어도 터지지 않아야 한다 — 조회 실패와 빈 결과는 다르다.
    const { impl } = stubFetch(null);
    const c = new KucoinBrokerClient({ fetchImpl: impl });
    const page = await c.getCommission(OPERATOR, BROKER);
    expect(page.items).toEqual([]);
    expect(page.totalNum).toBeNull();
  });
});

/*
   도메인 회귀 방지.

   ★★ 공식 문서는 "Broker REST: https://api-broker.kucoin.com" 을 안내한다.
      그래서 그 도메인으로 바꾸고 싶어지는데, **우리가 쓰는 경로는 거기에 없다.**
      두 도메인에 직접 요청해 확인했다(2026-08-10):

        경로                                  api.kucoin.com   api-broker.kucoin.com
        /api/v2/broker/queryMyCommission      400 (있음)        404
        /api/v2/broker/queryUser              400 (있음)        404
        /api/v2/broker/queryDetailByUid       400 (있음)        404
        /api/v2/broker/api/rebate/download    400 (있음)        404
        /api/v1/broker/nd/info                404              400 (있음)

      (400001 = "인증 헤더 없음" → 경로는 존재한다는 뜻)

      KuCoin 브로커는 두 종류이고 도메인이 갈린다:
        · Broker Pro (API Broker) — 사용자가 자기 키로 거래. **우리 형태.**
        · Exchange Broker — 브로커가 하위계정을 발급(`/broker/nd/*`).

      도메인을 바꾸면 정산 조회가 전부 404 가 되고 "리베이트 0원" 으로 보인다.
      그 사고를 막기 위해 기본값을 테스트로 고정한다.
*/
describe('브로커 도메인 (실측 기반 회귀 방지)', () => {
  it('기본 도메인은 스팟 도메인이다 — 브로커 전용 도메인에는 이 경로가 없다', () => {
    expect(DEFAULT_KUCOIN_SPOT_REST).toBe('https://api.kucoin.com');
    expect(DEFAULT_KUCOIN_SPOT_REST).not.toContain('api-broker');
    expect(DEFAULT_KUCOIN_SPOT_REST).not.toContain('api-futures');
  });

});
