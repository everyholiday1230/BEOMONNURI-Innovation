/**
 * Bitget 주문 어댑터 — **UTA(v3) 전용.**
 *
 * ★★★ Classic 계정은 **주문을 거부한다.** v2 주문 경로를 배선하지 않았고, 모드를
 *   추측해 v3 로 보내면 `40084` 로 거부되거나 **단위가 어긋난 주문**이 나간다.
 *   거부가 맞다 — 고객 돈이 걸린 경로에서 "아마 될 것" 으로 보내지 않는다.
 *
 * ★★ 실키로 확인한 것(2026-09-18, 체결 불가 조건으로):
 *   · 인자가 전부 맞으면 `25203 Insufficient margin` 까지 간다 = **경로가 끝까지 통한다**
 *   · `qty`(not `size`) · `posSide` 필수(헤지 모드) · 최소 5 USDT
 */
import type {
  ExchangeContext,
  IExchangeTradingAdapter,
  SubmitOrderRequest,
  SubmitOutcome,
} from '@quantumtrade/exchange-core';
import {
  BitgetV2Trading,
  BitgetV3Rest,
  BitgetV3Trading,
  type BitgetCredentials,
} from '@quantumtrade/exchange-bitget';

function toBitgetCredential(c: { accessKey: string; secretKey: string; memo: string }): BitgetCredentials {
  return { apiKey: c.accessKey, apiSecret: c.secretKey, passphrase: c.memo };
}

export class BitgetTradingAdapter implements IExchangeTradingAdapter {
  readonly canPlaceRealOrders = true;

  constructor(
    private readonly trading: BitgetV3Trading = new BitgetV3Trading(),
    private readonly v3: BitgetV3Rest = new BitgetV3Rest(),
    private readonly classic: BitgetV2Trading = new BitgetV2Trading(),
  ) {}

  /**
   * 이 자격증명으로 주문을 보낼 경로를 고른다.
   *
   * ★★★ **모드 판정이 실패하면 주문을 보내지 않는다.** 모르는 채로 보내면 한쪽은
   *   `40084`/`40085` 로 거부되거나 — 더 나쁘게 — **단위가 어긋난 주문**이 나간다.
   *   판정 실패를 "아마 통합계정일 것" 으로 메우지 않는다.
   *
   * ★ 이제 둘 다 배선했으므로 Classic 도 거부하지 않는다. 다만 v2 인자는 실키로
   *   검증하지 못했다 — 기본 주문 인자는 **필수**라서 이름이 틀리면 거래소가 거절한다
   *   (시끄러운 실패). 그래서 감수할 수 있는 위험이다.
   */
  private async pick(cred: BitgetCredentials): Promise<
    { ok: true; impl: BitgetV3Trading | BitgetV2Trading } | { ok: false; reason: string }
  > {
    const r = await this.v3.detectMode(cred);
    if (!r.ok) {
      return { ok: false, reason: `bitget 계정 모드를 판정할 수 없다 (${r.reason}): ${r.detail}` };
    }
    return { ok: true, impl: r.mode === 'unified' ? this.trading : this.classic };
  }

  async submitOrder(ctx: ExchangeContext, req: SubmitOrderRequest): Promise<SubmitOutcome> {
    const cred = toBitgetCredential(ctx.credential);
    const picked = await this.pick(cred);
    if (!picked.ok) return { status: 'REJECTED', reason: picked.reason };

    const r = await picked.impl.submitOrder(cred, {
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      ...(req.price ? { price: req.price } : {}),
      quantity: req.quantity,
      ...(req.reduceOnly ? { reduceOnly: true } : {}),
      ...(req.postOnly ? { postOnly: true } : {}),
      ...(req.timeInForce ? { timeInForce: req.timeInForce } : {}),
      /*
         ★★★ 보호 주문을 **그대로 넘긴다.** 아래 어댑터가 지원하지 않으면 거부한다 —
           여기서 지우면 이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다.
      */
      ...(req.stopPrice ? { stopPrice: req.stopPrice } : {}),
      ...(req.takeProfitPrice ? { takeProfitPrice: req.takeProfitPrice } : {}),
      ...(req.stopLossPrice ? { stopLossPrice: req.stopLossPrice } : {}),
    });

    if (r.status === 'ACCEPTED') {
      /*
         ★★ 거래소가 받았다. 주문 상태를 여기서 조회하지 않는다 — 대조는 호출자가
           `getOrderByClientId` 로 한다. 여기서 한 번 더 부르면 지연이 늘고, 그 사이
           체결되면 상태가 또 달라진다.
      */
      return {
        status: 'ACCEPTED',
        order: {
          clientOrderId: r.clientOrderId,
          exchangeOrderId: r.exchangeOrderId,
          symbol: req.symbol,
          side: req.side,
          type: req.type,
          ...(req.price ? { price: req.price } : {}),
          quantity: req.quantity,
          filledQuantity: '0',
          /* ★ 접수됐을 뿐 체결이 아니다. `filled` 로 두면 화면이 체결로 읽는다. */
          status: 'open',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      } as SubmitOutcome;
    }
    if (r.status === 'SUBMIT_UNKNOWN') {
      /*
         ★★★ **거절이 아니다.** 주문이 들어갔을 수 있다. 거절로 보고 다시 보내면
           두 번 들어간다 — 호출자가 대조해야 한다.
      */
      return { status: 'SUBMIT_UNKNOWN', clientOrderId: r.clientOrderId, reason: r.reason };
    }
    return { status: 'REJECTED', reason: r.reason };
  }

  async cancelOrder(ctx: ExchangeContext, symbol: string, clientOrderId: string): Promise<{ ok: boolean }> {
    const cred = toBitgetCredential(ctx.credential);
    const picked = await this.pick(cred);
    /* ★ 실패를 성공으로 만들지 않는다 — 취소된 줄 알고 포지션을 방치하게 된다. */
    if (!picked.ok) return { ok: false };
    const r = await picked.impl.cancelOrder(cred, symbol, clientOrderId);
    return { ok: r.ok };
  }

  async modifyOrder(
    ctx: ExchangeContext,
    symbol: string,
    clientOrderId: string,
    changes: { price?: string; quantity?: string },
  ): Promise<{ ok: boolean }> {
    const cred = toBitgetCredential(ctx.credential);
    const picked = await this.pick(cred);
    if (!picked.ok) return { ok: false };
    const r = await picked.impl.modifyOrder(cred, symbol, clientOrderId, changes);
    return { ok: r.ok };
  }
}
