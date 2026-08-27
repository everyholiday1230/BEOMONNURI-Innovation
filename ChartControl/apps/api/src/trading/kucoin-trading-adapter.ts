/**
 * KuCoin 거래 어댑터 — 실주문 제출·취소.
 *
 * ★ 이 파일은 실제로 돈이 나가는 경로다. 아래 원칙을 지킨다.
 *
 * 1) 기본은 잠금이다.
 *    `canPlaceRealOrders` 가 false 면 어떤 요청도 거래소로 나가지 않는다.
 *    잠금 해제는 환경변수(FEATURE_LIVE_ORDERS_ENABLED) + 킬스위치 해제 +
 *    리스크 게이트 전부 통과를 모두 요구한다.
 *
 * 2) 모르는 것을 성공이라고 하지 않는다.
 *    타임아웃·네트워크 단절은 "주문이 안 나갔다" 가 아니다. 나갔는지 알 수 없다.
 *    그때 REJECTED 를 돌려주면 사용자가 다시 주문해 **중복 포지션**이 생긴다.
 *    그래서 SUBMIT_UNKNOWN 을 돌려주고 호출자가 조회로 확인하게 한다.
 *
 * 3) 멱등성 키를 반드시 쓴다.
 *    clientOrderId 를 KuCoin 이 중복 검사한다. 재시도로 주문이 두 번 나가는 것을
 *    막는 유일한 장치다.
 *
 * 4) 수량은 계약수로 변환해야 한다.
 *    기초자산 수량을 그대로 보내면 승수 배만큼 큰 주문이 나간다
 *    (BTC 1계약 = 0.001 BTC → 1000배). 승수를 모르면 주문하지 않는다.
 */

import type {
  ExchangeContext,
  IExchangeTradingAdapter,
  NormalizedOrder,
  SubmitOrderRequest,
  SubmitOutcome,
} from '@quantumtrade/exchange-bitmart';
import { KucoinFuturesPrivate, type KucoinPrivateConfig } from '@quantumtrade/exchange-kucoin';

import { toKucoinCredential, type MultiplierLookup } from './kucoin-account-adapter';

export interface KucoinTradingAdapterConfig extends KucoinPrivateConfig {
  /** 계약 승수 조회. 없으면 주문이 전부 거부된다 (안전한 기본값). */
  multiplierOf?: MultiplierLookup;
  /**
   * 실주문 허용 여부.
   *
   * 함수로 받는다 — 킬스위치는 런타임에 켜고 끌 수 있어야 하고, 부팅 시점의
   * 값을 캡처해두면 킬스위치를 눌러도 이미 만들어진 어댑터가 계속 주문을 낸다.
   */
  liveEnabled: () => boolean;
  /** 진단 로그. 실주문은 반드시 기록을 남긴다. */
  onAudit?: (event: string, detail: Record<string, unknown>) => void;
}

export class KucoinTradingAdapter implements IExchangeTradingAdapter {
  readonly name = 'kucoin-futures-trading';

  private readonly client: KucoinFuturesPrivate;
  private readonly multiplierOf?: MultiplierLookup;
  private readonly liveEnabled: () => boolean;
  private readonly audit: (event: string, detail: Record<string, unknown>) => void;

  constructor(cfg: KucoinTradingAdapterConfig) {
    const { multiplierOf, liveEnabled, onAudit, ...clientCfg } = cfg;
    this.client = new KucoinFuturesPrivate(clientCfg);
    this.multiplierOf = multiplierOf;
    this.liveEnabled = liveEnabled;
    this.audit = onAudit ?? (() => {});
  }

  /**
   * 실주문을 낼 수 있는지. 호출 시점에 매번 확인한다.
   * 부팅 시점 값을 캐시하면 킬스위치가 무력해진다.
   */
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
      this.audit('order.blocked', { clientOrderId: req.clientOrderId, reason: 'live_orders_disabled' });
      return { status: 'REJECTED', reason: 'live orders are disabled (kill switch or feature flag)' };
    }

    const multiplier = this.multiplierOf?.(req.symbol);
    if (multiplier === undefined) {
      // 승수를 모르면 수량이 틀린다. 추측하지 않는다.
      this.audit('order.blocked', { clientOrderId: req.clientOrderId, reason: 'multiplier_unknown', symbol: req.symbol });
      return { status: 'REJECTED', reason: `contract multiplier unknown for ${req.symbol}` };
    }

    this.audit('order.submitting', {
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      quantity: req.quantity,
      brokerAttached: this.brokerAttached,
    });

    try {
      const result = await this.client.submitOrder(
        toKucoinCredential(ctx.credential),
        {
          clientOid: req.clientOrderId,
          symbol: req.symbol,
          side: req.side,
          type: req.type,
          quantity: req.quantity,
          price: req.price,
          leverage: req.leverage ?? 1,
          reduceOnly: req.reduceOnly,
          postOnly: req.postOnly,
          timeInForce: req.timeInForce,
          marginMode: req.marginMode,
          stopPrice: req.stopPrice,
          stopDirection: req.stopDirection,
          stopPriceType: req.stopPriceType,
        },
        multiplier,
      );

      this.audit('order.accepted', {
        clientOrderId: result.clientOid,
        orderId: result.orderId,
        contractsSent: result.contractsSent,
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
        // 제출 응답에는 체결량이 없다. 0 으로 두고 조회로 갱신한다 —
        // 추측한 체결량을 화면에 띄우면 사용자가 그 값을 믿는다.
        filledQuantity: '0',
        status: 'open',
        reduceOnly: req.reduceOnly,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return { status: 'ACCEPTED', order };
    } catch (e) {
      const err = e as Error & { detail?: { code?: string; httpStatus?: number; retryable?: boolean } };
      const code = err.detail?.code ?? '';

      /*
         주문이 나갔는지 알 수 없는 경우를 구분한다.

         타임아웃·연결 끊김·5xx 는 "거래소가 받았을 수도 있다" 는 뜻이다.
         이때 REJECTED 를 돌려주면 사용자가 다시 주문해 포지션이 두 배가 된다.
         SUBMIT_UNKNOWN 을 돌려주고 clientOrderId 로 조회해 확인하게 한다.
      */
      const ambiguous =
        err.name === 'AbortError' ||
        /abort|timeout|network|socket|ECONNRESET|fetch failed/i.test(err.message) ||
        (err.detail?.httpStatus ?? 0) >= 500;

      if (ambiguous) {
        this.audit('order.unknown', {
          clientOrderId: req.clientOrderId,
          reason: err.message,
          // 이 상태는 사람이 확인해야 한다. 조용히 지나가면 안 된다.
          action: 'reconcile_by_client_order_id',
        });
        return {
          status: 'SUBMIT_UNKNOWN',
          clientOrderId: req.clientOrderId,
          reason: err.message,
        };
      }

      this.audit('order.rejected', { clientOrderId: req.clientOrderId, code, reason: err.message });
      return { status: 'REJECTED', reason: err.message };
    }
  }

  /**
   * 주문 취소.
   *
   * 취소는 제출보다 안전하지만(포지션을 늘리지 않는다) 잠금은 동일하게 적용한다.
   * 실주문이 금지된 배포에서는 취소할 주문도 없기 때문이다.
   */
  async cancelOrder(
    ctx: ExchangeContext,
    symbol: string,
    clientOrderId: string,
  ): Promise<{ ok: boolean }> {
    if (!this.canPlaceRealOrders) {
      this.audit('cancel.blocked', { clientOrderId, reason: 'live_orders_disabled' });
      return { ok: false };
    }

    const cred = toKucoinCredential(ctx.credential);
    try {
      /*
         KuCoin 취소는 거래소 orderId 를 요구한다. 우리는 clientOrderId 로 부른다.
         먼저 미체결 목록에서 해당 주문을 찾아 orderId 를 얻는다.
         찾지 못하면 이미 체결·취소된 것이므로 취소할 대상이 없다.
      */
      const open = await this.client.getOrders(cred, { status: 'active', symbol });
      const hit = open.find((o) => o.clientOid === clientOrderId);
      if (!hit) {
        this.audit('cancel.not_found', { clientOrderId, symbol });
        return { ok: false };
      }

      const r = await this.client.cancelOrder(cred, hit.id);
      const ok = r.canceled.includes(hit.id) || r.canceled.length > 0;
      this.audit(ok ? 'cancel.done' : 'cancel.failed', { clientOrderId, orderId: hit.id });
      return { ok };
    } catch (e) {
      this.audit('cancel.error', { clientOrderId, reason: (e as Error).message });
      return { ok: false };
    }
  }

  /**
   * 한 심볼의 미체결 주문 전체 취소.
   *
   * 표준 인터페이스에 없는 확장이다. 개별 취소를 반복하면 요청 수가 늘어
   * 레이트리밋에 걸리고, 그 사이 일부만 취소된 어중간한 상태가 남는다.
   *
   * ★ symbol 을 반드시 받는다. KuCoin 은 생략 시 모든 심볼을 취소한다.
   */
  async cancelAllForSymbol(
    ctx: ExchangeContext,
    symbol: string,
  ): Promise<{ canceled: string[] }> {
    if (!this.canPlaceRealOrders) {
      this.audit('cancel_all.blocked', { symbol, reason: 'live_orders_disabled' });
      return { canceled: [] };
    }
    try {
      const r = await this.client.cancelAllForSymbol(toKucoinCredential(ctx.credential), symbol);
      this.audit('cancel_all.done', { symbol, count: r.canceled.length });
      return r;
    } catch (e) {
      this.audit('cancel_all.error', { symbol, reason: (e as Error).message });
      throw e;
    }
  }

  /**
   * 주문 수정.
   *
   * KuCoin 선물에는 주문 수정 API 가 없다. 취소 후 재주문으로 흉내낼 수 있지만
   * 그 사이에 시장이 움직이면 사용자가 의도하지 않은 가격에 체결된다.
   * 그래서 지원하지 않는다고 분명히 말한다 — 조용히 취소만 하면 더 위험하다.
   */
  async modifyOrder(): Promise<{ ok: boolean }> {
    this.audit('modify.unsupported', { reason: 'kucoin_futures_has_no_amend_api' });
    return { ok: false };
  }
}
