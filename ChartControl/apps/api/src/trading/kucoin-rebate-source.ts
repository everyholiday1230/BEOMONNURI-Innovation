import { KucoinBrokerClient, type BrokerCommissionRow } from '@quantumtrade/exchange-kucoin';
import type { RebateRecord, RebateSource } from '@quantumtrade/exchange-bitmart';

import type { BrokerRebateReader } from './broker-rebate-source';

/* ============================================================
   운영자 리베이트(수익) 조회 — KuCoin
   ------------------------------------------------------------
   왜 필요한가

   수익은 **KuCoin** 이 준다(브로커 리베이트). 그런데 조회 경로는 BitMart 를
   호출하고 있었다. BitMart 는 2026-08-26 로 거래를 종료했고 프로덕션에
   BITMART_ACCESS_KEY 도 없어서, 관리자 수익 화면은 항상 NOT_CONFIGURED 였다.
   즉 **얼마 벌었는지 확인할 방법이 없었다.**

   같은 계약(BrokerRebateReader)을 구현하므로 관리자 라우트·요약 계산·화면은
   그대로 두고 데이터 출처만 바뀐다.

   ★★ 금액은 문자열로 옮긴다. 파싱해서 숫자로 만들면 합산에서 자리수가 깨진다
     (summarizeRebates 가 십진 문자열 덧셈을 한다).

   ★ 무엇을 '수익' 으로 볼 것인가
     KuCoin 은 tagCommission(브로커 서명이 붙은 거래)과 noTagCommission(안 붙은
     거래), 그리고 totalCommission 을 함께 준다. 거래소가 우리에게 지급하는 금액은
     totalCommission 이므로 그 값을 쓴다. 서명 누락은 별개 문제이고, 그것을 수익에서
     빼면 실제 입금액과 화면이 어긋난다.

   ★ 기간이 없는 행은 버린다. 날짜를 추측해 넣으면(예: 오늘) 없는 날의 수익이
     생긴다 — 정산 대조가 불가능해진다.
   ============================================================ */

export interface KucoinRebateReaderOptions {
  brokerId: string;
  /** 운영자 KuCoin API 키 (KUCOIN_API_KEY 계열). 없으면 reader 를 만들지 않는다. */
  operator: { apiKey: string; apiSecret: string; passphrase: string };
  /** 선물 브로커 자격 (KUCOIN_BROKER_PARTNER/KEY/NAME). 없으면 만들지 않는다. */
  broker: { partner: string; key: string; name: string };
  /*
     ★★ 현물 브로커 자격 (KUCOIN_BROKER_SPOT_*). **선물과 태그가 다르다.**
       운영자 대시보드 실측(2026-09-19): Broker Tag (Spot) = CCAI,
       Broker Tag (Futures) = CCAIF. 두 태그의 실적은 따로 집계된다.
     ★ 선택이다 — 없으면 선물만 조회한다. 현물 거래를 아예 안 하면 그것이 맞다.
  */
  spotBroker?: { partner: string; key: string; name: string };
  restBase?: string;
  /** 테스트 주입용. */
  fetchImpl?: typeof fetch;
}

/** epoch ms → YYYY-MM-DD (UTC). 정산 대조는 UTC 기준으로 한다. */
function toDateKey(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** 커미션 행 → 리베이트 기록. 날짜나 금액이 없으면 버린다(만들지 않는다). */
export function commissionRowsToRebates(
  rows: readonly BrokerCommissionRow[],
  source: RebateSource,
): RebateRecord[] {
  const out: RebateRecord[] = [];
  for (const r of rows) {
    /*
       날짜 기준: 정산 기간의 끝을 쓴다. 지급 시각(payoutTime)은 아직 지급되지
       않았으면 null 이라, 그걸 기준으로 하면 미지급 실적이 통째로 사라진다.
    */
    const date = toDateKey(Number(r.periodEndTime ?? r.payoutTime ?? NaN));
    if (!date) continue;

    const raw = r.totalCommission;
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const amount = String(raw).trim();
    // 숫자로 읽히지 않는 값은 합산을 망친다. 조용히 0 으로 바꾸지 않고 버린다.
    if (!Number.isFinite(Number(amount))) continue;

    out.push({
      date,
      currency: (r.currency && String(r.currency).trim()) || 'USDT',
      amount,
      source,
    });
  }
  return out;
}

/**
 * KuCoin 리베이트 리더. 자격이 하나라도 없으면 `undefined` — 관리자 화면이
 * NOT_CONFIGURED 로 표시하고, API 기동은 막지 않는다.
 */
export function createKucoinRebateReader(
  opts: KucoinRebateReaderOptions,
): BrokerRebateReader | undefined {
  const { operator, broker } = opts;
  /* ★ 자격이 하나라도 비면 현물은 조회하지 않는다 — 빈 값으로 부르면 엉뚱한 태그가 된다. */
  const sb = opts.spotBroker;
  const spotBroker = sb && sb.partner && sb.key && sb.name ? sb : undefined;
  if (!operator.apiKey || !operator.apiSecret || !operator.passphrase) return undefined;
  if (!broker.partner || !broker.key || !broker.name) return undefined;

  const client = new KucoinBrokerClient({
    ...(opts.restBase !== undefined ? { restBase: opts.restBase } : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  });

  /* 태그 하나를 끝까지 읽는다. 첫 페이지만 읽으면 수익이 실제보다 적게 보인다. */
  async function readTag(
    brokerCreds: { partner: string; key: string; name: string },
    tradeType: 'SPOT' | 'FUTURES',
    startAt: number | undefined,
    endAt: number | undefined,
  ): Promise<BrokerCommissionRow[]> {
    const rows: BrokerCommissionRow[] = [];
    let page = 1;
    for (;;) {
      const res = await client.getCommission(
        { apiKey: operator.apiKey, apiSecret: operator.apiSecret, passphrase: operator.passphrase },
        { partner: brokerCreds.partner, key: brokerCreds.key, name: brokerCreds.name },
        {
          tradeType,
          ...(startAt !== undefined ? { startAt } : {}),
          ...(endAt !== undefined ? { endAt } : {}),
          page,
          pageSize: 100,
        },
      );
      rows.push(...res.items);
      if (res.items.length === 0 || page >= (res.totalPage || 1) || page > 50) break;
      page += 1;
    }
    return rows;
  }

  return {
    brokerId: opts.brokerId,
    /*
       ★ 이름이 `fetchSpot` 인 것은 BitMart 시절 계약이다. 실제로는 **현물·선물을
         모두** 돌려준다 — 관리자 라우트가 이 한 번의 호출로 전체 수익을 그린다.
         이름을 바꾸면 계약과 화면까지 번지므로 여기 사실만 적어 둔다.
    */
    async fetchSpot(q) {
      /*
         ★ KuCoin 은 초 단위가 아니라 ms 를 받는다. 호출자(관리자 라우트)는
           BitMart 계약을 따라 **초** 로 준다 — 여기서 변환한다. 변환을 빠뜨리면
           1970년 근처를 조회해 결과가 늘 비어 보인다.
      */
      const toMs = (sec?: number) => (Number.isFinite(sec) && (sec as number) > 0 ? (sec as number) * 1000 : undefined);
      const startAt = toMs(q.startTime);
      const endAt = toMs(q.endTime);

      /*
         ★★★ **태그별로 따로 조회한다.**

           전에는 선물 자격으로 `tradeType:'all'` 을 한 번 부르고 결과 전부를
           `'spot'` 이라고 표시했다. 그러면 요약의 출처별 분해가 거짓이 되고,
           운영자 대시보드(현물·선물을 나눠 보여준다)와 대조할 수 없다.

         ★★ 태그가 실제로 두 개다 — 대시보드 실측: Spot=CCAI, Futures=CCAIF.
           각 태그의 자격으로 그 태그의 거래 종류만 물어보므로 겹치지 않는다.
      */
      const futures = await readTag(broker, 'FUTURES', startAt, endAt);
      const spot = spotBroker ? await readTag(spotBroker, 'SPOT', startAt, endAt) : [];

      /*
         ★★★ **겹침 방어.** KuCoin 이 `tradeType` 을 무시하고 양쪽에 같은 행을
           돌려주면 수익이 두 배로 보인다. 그러면 정산 대조가 깨지고, 많게 보이는
           쪽으로 틀리는 것은 적게 보이는 것보다 나쁘다(없는 돈을 셈한다).
           두 결과가 같으면 한쪽만 쓴다.
      */
      const same =
        spot.length > 0 &&
        spot.length === futures.length &&
        JSON.stringify(spot) === JSON.stringify(futures);
      if (same) return commissionRowsToRebates(futures, 'futures');

      return [
        ...commissionRowsToRebates(futures, 'futures'),
        ...commissionRowsToRebates(spot, 'spot'),
      ];
    },
  };
}
