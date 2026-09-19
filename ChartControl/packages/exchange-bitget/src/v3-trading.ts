/**
 * Bitget **UTA(v3) 주문** — 전송·취소·수정.
 *
 * ★★★ 실키로 확인한 스펙(2026-09-18, 체결되지 않는 지정가로 인자만 확인):
 *
 *     POST /api/v3/trade/place-order
 *       category  'USDT-FUTURES'     ← v2 의 productType 과 이름이 다르다
 *       symbol    'BTCUSDT'
 *       side      'buy' | 'sell'
 *       orderType 'limit' | 'market'
 *       qty       '0.0001'           ★★ `size` 가 아니다. 실측 오류: "Parameter qty cannot be empty"
 *       price     지정가일 때만
 *       posSide   'long' | 'short'   ★★★ **헤지 모드에서 필수.** 없으면
 *                                     `25156 In one-way position mode...` 로 거절된다
 *
 *   ★ 최소 주문 금액 **5 USDT**(`45110`). 그보다 작으면 거래소가 거절한다.
 *   ★ `holdSide` 는 v2 이름이다 — v3 에 쓰면 25156 이 난다. 실측으로 확인했다.
 *
 * ★★★ **지원하지 않는 것은 조용히 무시하지 않고 거부한다.** 손절·익절을 무시하면
 *   이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다. 그것이 이 파일에서 가장
 *   중요한 규칙이다.
 */
import { BITGET_OK } from './rest.js';
import { BitgetV3Rest, V3_CATEGORY, type BitgetV3Options } from './v3-rest.js';
import type { BitgetCredentials } from './signature.js';

export interface V3SubmitRequest {
  clientOrderId: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  price?: string;
  quantity: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  timeInForce?: string;
  /* 아래 셋은 **아직 지원하지 않는다.** 들어오면 거부한다 — 무시하면 무방비가 된다. */
  stopPrice?: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
}

export type V3SubmitOutcome =
  | { status: 'ACCEPTED'; exchangeOrderId: string; clientOrderId: string }
  | { status: 'REJECTED'; reason: string }
  /*
     ★★★ 응답을 못 받은 경우. **거절로 다루지 않는다** — 주문이 들어갔을 수 있다.
       거절이라고 보고 다시 보내면 **두 번 들어간다.** 호출자가 대조해야 한다.
  */
  | { status: 'SUBMIT_UNKNOWN'; clientOrderId: string; reason: string };

export class BitgetV3Trading {
  readonly canPlaceRealOrders = true;

  private readonly rest: BitgetV3Rest;

  constructor(opts: BitgetV3Options = {}) {
    this.rest = new BitgetV3Rest(opts);
  }

  /**
   * 주문 전송.
   *
   * ★★★ `clientOrderId` 를 **반드시 보낸다.** 응답을 못 받았을 때 그것으로 대조해
   *   중복 주문을 막는다. 거래소가 만들어 주는 id 에만 의존하면 대조할 열쇠가 없다.
   */
  async submitOrder(cred: BitgetCredentials, req: V3SubmitRequest): Promise<V3SubmitOutcome> {
    /*
       ★★★ **지원하지 않는 보호 주문은 거부한다.**
         손절·익절을 조용히 버리면 이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다.
         그 상태에서 시장이 반대로 가면 손실이 제한되지 않는다.
       ★ 지원하게 되면 이 검사를 지우고 실제 필드를 채운다. 그 전에는 거부가 맞다.
    */
    if (req.stopPrice) {
      return { status: 'REJECTED', reason: 'bitget: 발동(스톱) 주문은 아직 지원하지 않는다 — 주문을 보내지 않았다' };
    }
    /*
       ★★★ **UTA(v3) 의 손절·익절 필드 이름을 확인하지 못했다.**

         Classic(v2) 은 공식 문서에서 확인했다(`presetStopSurplusPrice`·
         `presetStopLossPrice`). 그런데 **UTA 문서의 주문 항목은 열지 못했고**,
         v2 이름이 v3 에서도 같다는 보장이 없다.

       ★★★ 추측으로 보낼 수 없는 이유: Bitget 은 **모르는 필드를 조용히 무시한다**
         (실측 — 존재하지 않는 필드를 보내도 거절하지 않았다). 이름이 틀리면
         **주문은 성공하고 손절만 없다.** 고객은 보호가 걸렸다고 믿은 채 무방비로 남는다.

       ★ 그래서 거부한다. 이름을 확인하거나 데모로 되읽어 검증한 뒤에 연다.
    */
    if (req.takeProfitPrice || req.stopLossPrice) {
      return {
        status: 'REJECTED',
        reason: 'bitget(통합계정): 손절·익절 필드를 아직 검증하지 못했다 — 주문을 보내지 않았다',
      };
    }
    if (req.type === 'limit' && !req.price) {
      return { status: 'REJECTED', reason: 'bitget: 지정가 주문에 가격이 없다' };
    }

    const body: Record<string, string> = {
      category: V3_CATEGORY,
      symbol: req.symbol,
      /*
         ★★ 방향 변환은 **여기 한 곳에서만** 한다. 상위에서 뒤집으면 한 번 실수에
           매수가 매도로 나간다.
         ★ `posSide` 는 헤지 모드에서 필수다(실측 25156).
      */
      side: req.side === 'long' ? 'buy' : 'sell',
      posSide: req.side === 'long' ? 'long' : 'short',
      orderType: req.type,
      /* ★★ `qty` 다. `size` 로 보내면 "Parameter qty cannot be empty" 가 난다. */
      qty: req.quantity,
      clientOid: req.clientOrderId,
      ...(req.type === 'limit' && req.price ? { price: req.price } : {}),
      /*
         ★ 청산 주문은 포지션을 줄이는 것이다. 이 표시가 없으면 반대 포지션이 열릴 수 있다.
       */
      ...(req.reduceOnly ? { reduceOnly: 'YES' } : {}),
      ...(req.timeInForce ? { timeInForce: req.timeInForce.toLowerCase() } : {}),
      /* ★ postOnly 는 timeInForce 로 표현한다 — 별도 필드를 짐작해 넣지 않는다. */
      ...(req.postOnly ? { timeInForce: 'post_only' } : {}),
    };

    let env;
    try {
      env = await this.rest.signed<Record<string, unknown>>(cred, 'POST', '/api/v3/trade/place-order', {}, body);
    } catch (e) {
      /*
         ★★★ 네트워크 실패·시간 초과는 **거절이 아니다.** 주문이 들어갔을 수 있다.
           거절로 보고 다시 보내면 두 번 들어간다.
      */
      return {
        status: 'SUBMIT_UNKNOWN',
        clientOrderId: req.clientOrderId,
        reason: `전송 결과를 알 수 없다: ${(e as Error).message.slice(0, 160)}`,
      };
    }
    if (env.code !== BITGET_OK) {
      return { status: 'REJECTED', reason: `bitget ${env.code}: ${env.msg || '(no message)'}` };
    }
    const d = (env.data ?? {}) as Record<string, unknown>;
    const id = String(d.orderId ?? d.orderNo ?? '');
    if (!id) {
      /*
         ★★ 성공 코드인데 주문 id 가 없다. **성공으로 단정하지 않는다** — 들어갔는지
           확인해야 한다.
      */
      return {
        status: 'SUBMIT_UNKNOWN',
        clientOrderId: req.clientOrderId,
        reason: '거래소가 성공을 알렸으나 주문 id 가 없다 — 대조가 필요하다',
      };
    }
    return { status: 'ACCEPTED', exchangeOrderId: id, clientOrderId: String(d.clientOid ?? req.clientOrderId) };
  }

  /**
   * 취소.
   *
   * ★ `clientOid` 로 취소한다. 거래소 내부 id 를 화면이 들고 다니면 거래소를 바꿀 때
   *   전부 깨진다.
   * ★★ 실패를 성공으로 만들지 않는다. 이미 체결됐거나 없는 주문일 수 있고, 그때
   *   성공이라고 하면 이용자는 취소된 줄 알고 포지션을 방치한다.
   */
  async cancelOrder(cred: BitgetCredentials, symbol: string, clientOrderId: string): Promise<{ ok: boolean; reason?: string }> {
    const env = await this.rest.signed<Record<string, unknown>>(
      cred, 'POST', '/api/v3/trade/cancel-order', {},
      { category: V3_CATEGORY, symbol, clientOid: clientOrderId },
    );
    if (env.code === BITGET_OK) return { ok: true };
    return { ok: false, reason: `bitget ${env.code}: ${env.msg || '(no message)'}` };
  }

  /**
   * 수정.
   *
   * ★★ 가격·수량 중 **바뀌는 것만** 보낸다. 안 바뀌는 값을 다시 보내면 거래소가
   *   그 값으로 덮어쓰는데, 우리가 들고 있던 값이 낡았으면 의도와 다른 주문이 된다.
   */
  async modifyOrder(
    cred: BitgetCredentials,
    symbol: string,
    clientOrderId: string,
    changes: { price?: string; quantity?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!changes.price && !changes.quantity) {
      return { ok: false, reason: 'bitget: 바꿀 값이 없다' };
    }
    const env = await this.rest.signed<Record<string, unknown>>(
      cred, 'POST', '/api/v3/trade/modify-order', {},
      {
        category: V3_CATEGORY,
        symbol,
        clientOid: clientOrderId,
        ...(changes.price ? { newPrice: changes.price } : {}),
        ...(changes.quantity ? { newQty: changes.quantity } : {}),
      },
    );
    if (env.code === BITGET_OK) return { ok: true };
    return { ok: false, reason: `bitget ${env.code}: ${env.msg || '(no message)'}` };
  }
}
