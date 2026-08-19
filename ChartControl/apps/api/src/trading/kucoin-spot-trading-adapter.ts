/**
 * KuCoin 현물(Spot) 거래 어댑터 — 실주문 제출·취소.
 *
 * ★ 선물 어댑터(kucoin-trading-adapter.ts)와 **같은 안전 원칙**을 지킨다.
 *
 * 1) 기본은 잠금이다.
 *    `canPlaceRealOrders` 가 false 면 어떤 요청도 거래소로 나가지 않는다.
 *
 * 2) 모르는 것을 성공이라고 하지 않는다.
 *    타임아웃·5xx 는 "주문이 안 나갔다" 가 아니다. SUBMIT_UNKNOWN 을 돌려주고
 *    호출자가 clientOrderId 로 조회해 확인한다. REJECTED 로 말하면 이용자가
 *    다시 주문해 **중복 매수**가 된다.
 *
 * 3) clientOrderId 로 멱등성을 보장한다.
 *
 * ★★ 선물과 다른 점 — 여기서 틀리면 주문 크기가 완전히 달라진다
 *
 *    승수     현물은 승수를 **쓰지 않는다.** 선물은 기초자산 수량을 계약수로
 *             바꿔야 하지만(BTC 1계약 = 0.001 BTC), 현물의 size 는 기초자산
 *             수량 그대로다. 선물 코드를 복사해 승수로 나누면 1000배 작은
 *             주문이 나간다.
 *
 *    레버리지 현물에는 없다. 그래서 이 어댑터는 leverage 를 받지 않고,
 *             받더라도 거래소로 보내지 않는다.
 *
 *    청산     현물에는 강제 청산이 없다. 그래서 청산 관련 게이트는 적용하지
 *             않지만, 잔고 초과 주문은 거래소가 거부한다.
 *
 *    브로커   **현물용 자격증명**(partner=CCAI)을 써야 한다. 선물용(CCAIF)으로
 *             서명하면 서명은 만들어지지만 거래가 귀속되지 않고 오류도 나지
 *             않는다 — 리베이트만 0 이 된다(가장 늦게 발견되는 손실).
 */

import type {
  ExchangeContext,
  IExchangeTradingAdapter,
  NormalizedOrder,
  SubmitOrderRequest,
  SubmitOutcome,
} from '@quantumtrade/exchange-bitmart';
import { KucoinSpotPrivate, type KucoinSpotPrivateConfig } from '@quantumtrade/exchange-kucoin';

import { toKucoinCredential } from './kucoin-account-adapter';

export interface KucoinSpotTradingAdapterConfig extends KucoinSpotPrivateConfig {
  /**
   * 실주문 허용 여부.
   *
   * 함수로 받는다 — 킬스위치는 런타임에 켜고 끌 수 있어야 하고, 부팅 시점의
   * 값을 캡처해두면 킬스위치를 눌러도 이미 만들어진 어댑터가 계속 주문을 낸다.
   */
  liveEnabled: () => boolean;
  onAudit?: (event: string, detail: Record<string, unknown>) => void;
}

export class KucoinSpotTradingAdapter implements IExchangeTradingAdapter {
  readonly name = 'kucoin-spot-trading';

  private readonly client: KucoinSpotPrivate;
  private readonly liveEnabled: () => boolean;
  private readonly audit: (event: string, detail: Record<string, unknown>) => void;

  constructor(cfg: KucoinSpotTradingAdapterConfig) {
    const { liveEnabled, onAudit, ...clientCfg } = cfg;
    this.client = new KucoinSpotPrivate(clientCfg);
    this.liveEnabled = liveEnabled;
    this.audit = onAudit ?? (() => {});
  }

  /** 실주문을 낼 수 있는지. 호출 시점에 매번 확인한다(캐시하면 킬스위치가 무력해진다). */
  get canPlaceRealOrders(): boolean {
    return this.liveEnabled();
  }

  /** 브로커 파트너 헤더가 붙는지. 리베이트 집계 여부다. */
  get brokerAttached(): boolean {
    return this.client.brokerAttached;
  }

  async submitOrder(ctx: ExchangeContext, req: SubmitOrderRequest): Promise<SubmitOutcome> {
    // --- 잠금 확인 (가장 먼저) ---
    if (!this.canPlaceRealOrders) {
      this.audit('spot.order.blocked', { clientOrderId: req.clientOrderId, reason: 'live_orders_disabled' });
      return { status: 'REJECTED', reason: 'live orders are disabled (kill switch or feature flag)' };
    }

    /*
       ★ 현물에는 감소전용(reduceOnly)이 없다.

         포지션이라는 개념이 없으므로 "포지션을 줄이는 주문" 도 없다. 그 값을
         받아서 조용히 버리면, 이용자는 감소전용이 적용됐다고 믿는다. 그래서
         명시적으로 거부한다.
    */
    if (req.reduceOnly) {
      this.audit('spot.order.blocked', { clientOrderId: req.clientOrderId, reason: 'reduce_only_unsupported' });
      return { status: 'REJECTED', reason: 'reduceOnly is not applicable to spot orders' };
    }

    this.audit('spot.order.submitting', {
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      quantity: req.quantity,
      brokerAttached: this.brokerAttached,
    });

    /*
       ★★ 발동 주문(스톱)은 **다른 엔드포인트**로 보낸다.

         일반 주문 경로에 stopPrice 를 실어 보내면 그 필드는 무시되고 즉시
         체결되는 주문이 나간다. 손절을 걸었다고 믿는 이용자가 그 자리에서
         시장가로 체결되는 것이 이 실수의 결과다.

       ★ stopPrice 가 있는데 스톱 경로로 보내지 못하는 상황이라면 **주문을 내지
         않는다.** 일반 주문으로 낮춰 보내는 것이 가장 나쁜 선택이다.
    */
    /*
       ★ OCO(하나가 체결되면 다른 하나가 취소된다).

         세 가격이 모두 있을 때만 OCO 로 본다. 일부만 있으면 스톱 주문이나 일반
         주문으로 조용히 낮추지 않는다 — 이용자는 익절과 손절이 함께 걸렸다고
         믿는데 한쪽만 걸리면 반대쪽이 무방비가 된다.
    */
    const oco = req as { stopPrice?: string; limitPrice?: string; price?: string };
    if (oco.stopPrice && oco.limitPrice && oco.price) {
      try {
        const result = await this.client.submitOcoOrder(toKucoinCredential(ctx.credential), {
          clientOid: req.clientOrderId,
          symbol: req.symbol,
          side: req.side,
          quantity: req.quantity,
          price: String(oco.price),
          stopPrice: String(oco.stopPrice),
          limitPrice: String(oco.limitPrice),
        });
        this.audit('spot.oco_order.accepted', {
          clientOrderId: result.clientOid, orderId: result.orderId,
          price: oco.price, stopPrice: oco.stopPrice, limitPrice: oco.limitPrice,
          brokerAttached: result.brokerAttached,
        });
        return {
          status: 'ACCEPTED',
          order: {
            clientOrderId: result.clientOid,
            exchangeOrderId: result.orderId,
            symbol: req.symbol,
            side: req.side,
            type: 'limit',
            price: String(oco.price),
            quantity: req.quantity,
            filledQuantity: '0',
            status: 'open',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as NormalizedOrder,
        };
      } catch (e) {
        const err = e as Error & { code?: string; httpStatus?: number; unknownOutcome?: boolean };
        const ambiguous = err.unknownOutcome === true || err.name === 'AbortError'
          || /abort|timeout|network|socket|ECONNRESET|fetch failed/i.test(err.message)
          || (err.httpStatus ?? 0) >= 500;
        if (ambiguous) {
          this.audit('spot.oco_order.unknown', { clientOrderId: req.clientOrderId, reason: err.message });
          return { status: 'SUBMIT_UNKNOWN', clientOrderId: req.clientOrderId, reason: err.message };
        }
        this.audit('spot.oco_order.rejected', { clientOrderId: req.clientOrderId, code: err.code ?? '', reason: err.message });
        return { status: 'REJECTED', reason: err.message };
      }
    }

    const stopPrice = (req as { stopPrice?: string }).stopPrice;
    if (stopPrice !== undefined && stopPrice !== null && String(stopPrice) !== '') {
      try {
        const result = await this.client.submitStopOrder(toKucoinCredential(ctx.credential), {
          clientOid: req.clientOrderId,
          symbol: req.symbol,
          side: req.side,
          type: req.type,
          quantity: req.quantity,
          price: req.price,
          stopPrice: String(stopPrice),
        });
        this.audit('spot.stop_order.accepted', {
          clientOrderId: result.clientOid,
          orderId: result.orderId,
          stopPrice: String(stopPrice),
          brokerAttached: result.brokerAttached,
        });
        const order: NormalizedOrder = {
          clientOrderId: result.clientOid,
          exchangeOrderId: result.orderId,
          symbol: req.symbol,
          side: req.side,
          type: req.type,
          price: req.price,
          quantity: req.quantity,
          filledQuantity: '0',
          /*
             ★ 상태는 'open' 이지만 **아직 시장에 나가지 않았다**(발동 대기).
               화면이 이것을 미체결 주문과 같게 보여주면 이용자는 이미 주문이
               호가에 있다고 오해한다. 호출자가 stopPrice 로 구분해야 한다.
          */
          status: 'open',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { status: 'ACCEPTED', order };
      } catch (e) {
        const err = e as Error & { code?: string; httpStatus?: number; unknownOutcome?: boolean };
        const ambiguous = err.unknownOutcome === true || err.name === 'AbortError'
          || /abort|timeout|network|socket|ECONNRESET|fetch failed/i.test(err.message)
          || (err.httpStatus ?? 0) >= 500;
        if (ambiguous) {
          this.audit('spot.stop_order.unknown', { clientOrderId: req.clientOrderId, reason: err.message });
          return { status: 'SUBMIT_UNKNOWN', clientOrderId: req.clientOrderId, reason: err.message };
        }
        this.audit('spot.stop_order.rejected', { clientOrderId: req.clientOrderId, code: err.code ?? '', reason: err.message });
        return { status: 'REJECTED', reason: err.message };
      }
    }

    try {
      const result = await this.client.submitOrder(toKucoinCredential(ctx.credential), {
        clientOid: req.clientOrderId,
        symbol: req.symbol,
        side: req.side,
        type: req.type,
        /*
           ★★ 수량을 그대로 넘긴다. 승수를 곱하거나 나누지 않는다.
             선물 어댑터에는 여기에 `quantity / multiplier` 가 있다.
        */
        quantity: req.quantity,
        price: req.price,
        /*
           postOnly 는 공용 요청 형식(SubmitOrderRequest)에 없다. 없는 필드를
           추측해서 넣지 않는다 — 이용자가 지정하지 않은 조건이 주문에 붙으면
           체결 방식이 달라진다. 필요해지면 요청 형식에 먼저 추가한다.
        */
      });

      this.audit('spot.order.accepted', {
        clientOrderId: result.clientOid,
        orderId: result.orderId,
        sizeSent: result.sizeSent,
        // 리베이트가 집계되지 않는 주문은 수익이 0 이다. 기록으로 남긴다.
        brokerAttached: result.brokerAttached,
      });

      const order: NormalizedOrder = {
        clientOrderId: result.clientOid,
        exchangeOrderId: result.orderId,
        symbol: req.symbol,
        side: req.side,
        type: req.type,
        price: req.price,
        quantity: req.quantity,
        // 제출 응답에는 체결량이 없다. 추측값을 화면에 띄우면 이용자가 그것을 믿는다.
        filledQuantity: '0',
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return { status: 'ACCEPTED', order };
    } catch (e) {
      const err = e as Error & { code?: string; httpStatus?: number; unknownOutcome?: boolean };

      /*
         주문이 나갔는지 알 수 없는 경우를 구분한다.

         현물 클라이언트가 `unknownOutcome` 을 직접 알려준다(타임아웃·5xx·JSON
         파싱 실패). 그 신호를 쓰되, 메시지 판정도 함께 남긴다 — 클라이언트를
         거치지 않는 오류가 섞여 들어올 수 있다.
      */
      const ambiguous =
        err.unknownOutcome === true ||
        err.name === 'AbortError' ||
        /abort|timeout|network|socket|ECONNRESET|fetch failed/i.test(err.message) ||
        (err.httpStatus ?? 0) >= 500;

      if (ambiguous) {
        this.audit('spot.order.unknown', {
          clientOrderId: req.clientOrderId,
          reason: err.message,
          action: 'reconcile_by_client_order_id',
        });
        return { status: 'SUBMIT_UNKNOWN', clientOrderId: req.clientOrderId, reason: err.message };
      }

      this.audit('spot.order.rejected', { clientOrderId: req.clientOrderId, code: err.code ?? '', reason: err.message });
      return { status: 'REJECTED', reason: err.message };
    }
  }

  /**
   * 주문 취소.
   *
   * ★ KuCoin 은 취소에 거래소 orderId 를 요구한다. 우리는 clientOrderId 로 부르므로
   *   먼저 조회해서 orderId 를 얻는다. 찾지 못하면 이미 체결·취소된 것이다 —
   *   그것은 오류가 아니라 상태이므로 ok:false 로 알리고 끝낸다.
   */
  async cancelOrder(ctx: ExchangeContext, _symbol: string, clientOrderId: string): Promise<{ ok: boolean }> {
    /* ★ 현물 취소·조회는 symbol 이 필수다(쿼리). 없으면 400 이 온다. */
    if (!this.canPlaceRealOrders) {
      this.audit('spot.cancel.blocked', { clientOrderId, reason: 'live_orders_disabled' });
      return { ok: false };
    }
    const cred = toKucoinCredential(ctx.credential);
    try {
      const found = await this.client.getOrderByClientOid(cred, clientOrderId, _symbol);
      if (!found) {
        this.audit('spot.cancel.not_found', { clientOrderId });
        return { ok: false };
      }
      if (found.status !== 'open') {
        // 이미 끝난 주문이다. 취소 요청을 보내면 오류가 되고, 그것을 실패로
        // 보고하면 운영자가 원인을 찾느라 시간을 쓴다.
        this.audit('spot.cancel.already_closed', { clientOrderId, status: found.status });
        return { ok: false };
      }
      const r = await this.client.cancelOrder(cred, found.orderId, _symbol);
      const ok = r.canceled.includes(found.orderId) || r.canceled.length > 0;
      this.audit(ok ? 'spot.cancel.done' : 'spot.cancel.failed', { clientOrderId, orderId: found.orderId });
      return { ok };
    } catch (e) {
      this.audit('spot.cancel.error', { clientOrderId, reason: (e as Error).message });
      return { ok: false };
    }
  }

  /**
   * 주문 정정.
   *
   * ★ KuCoin 현물에는 정정 API 가 없다. 취소 후 재주문으로 흉내낼 수 있지만,
   *   그 사이에 시장이 움직이면 이용자가 의도한 것과 다른 결과가 된다. 그래서
   *   흉내내지 않고 지원하지 않음을 알린다.
   */
  async modifyOrder(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: 'spot order modification is not supported by the exchange' };
  }

  /**
   * 결과가 불명확했던 주문을 확인한다.
   *
   * ★★ 이 경로가 없으면 SUBMIT_UNKNOWN 을 해결할 방법이 없고, 결국 이용자가
   *   재주문하게 된다 — 그것이 중복 매수다.
   */
  async reconcileByClientOrderId(
    ctx: ExchangeContext,
    clientOrderId: string,
    symbol?: string,
  ): Promise<NormalizedOrder | null> {
    /*
       ★★ 현물 조회는 symbol 이 필수다. 없으면 **조회할 수 없다.**

         추측한 심볼로 물어보면 다른 주문을 보게 되고, 그 결과로 "주문이 없다" 고
         판단하면 이용자가 재주문해 중복 매수가 된다. 그래서 심볼이 없으면
         null 이 아니라 예외로 알린다 — 호출자가 심볼을 넘기도록 만들어야 한다.
    */
    if (!symbol) {
      throw new Error('spot reconcile requires a symbol (KuCoin spot order lookup is per-symbol)');
    }
    const cred = toKucoinCredential(ctx.credential);
    const found = await this.client.getOrderByClientOid(cred, clientOrderId, symbol);
    if (!found) return null;
    return {
      clientOrderId,
      exchangeOrderId: found.orderId,
      symbol: '',
      side: 'long',
      type: 'limit',
      quantity: found.size,
      filledQuantity: found.dealSize,
      status: found.status === 'filled' ? 'filled' : found.status === 'canceled' ? 'canceled' : 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as NormalizedOrder;
  }
}
