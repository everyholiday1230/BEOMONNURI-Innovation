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
import { BitgetAccountAdapter } from './bitget-account-adapter.js';
import {
  BitgetPrivateRest,
  BitgetV2Trading,
  BitgetV3Rest,
  BitgetV3Trading,
  type BitgetCredentials,
} from '@quantumtrade/exchange-bitget';

/*
   ★★★ 브로커 채널 코드. **주문 경로에 특히 중요하다** — 리베이트는 거래에서 나온다.
     읽기에 붙고 주문에 안 붙으면 수익이 0 이다. 두 어댑터가 같은 값을 쓴다.
   ★ 한 곳에서만 정의하면 좋겠지만, 두 파일이 서로를 import 하면 순환이 된다.
     그래서 같은 환경변수를 읽는다 — 시험이 두 곳 모두를 확인한다.
*/
const CHANNEL_CODE = (process.env.BITGET_CHANNEL_CODE ?? process.env.BITGET_OAUTH_CHANNEL_CODE ?? '').trim();

function toBitgetCredential(c: { accessKey: string; secretKey: string; memo: string }): BitgetCredentials {
  return {
    apiKey: c.accessKey,
    apiSecret: c.secretKey,
    passphrase: c.memo,
    ...(CHANNEL_CODE ? { channelCode: CHANNEL_CODE } : {}),
  };
}

export class BitgetTradingAdapter implements IExchangeTradingAdapter {
  readonly canPlaceRealOrders = true;

  constructor(
    private readonly trading: BitgetV3Trading = new BitgetV3Trading(),
    private readonly v3: BitgetV3Rest = new BitgetV3Rest(),
    private readonly classic: BitgetV2Trading = new BitgetV2Trading(),
    /* ★ Classic 의 포지션 보유 모드를 읽기 위해 필요하다. */
    private readonly v2: BitgetPrivateRest = new BitgetPrivateRest(),
    /*
       ★★ 보호 주문 되읽기에 필요하다. 읽기 어댑터를 재사용한다 — 조회 로직을 두 벌
         만들면 한쪽만 고치게 된다(이 저장소에서 반복된 실패다).
    */
    private readonly account: BitgetAccountAdapter = new BitgetAccountAdapter(),
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
    | { ok: true; kind: 'unified'; impl: BitgetV3Trading }
    | { ok: true; kind: 'classic'; impl: BitgetV2Trading; holdMode: 'hedge' | 'one_way' | null }
    | { ok: false; reason: string }
  > {
    const r = await this.v3.detectMode(cred);
    if (!r.ok) {
      return { ok: false, reason: `bitget 계정 모드를 판정할 수 없다 (${r.reason}): ${r.detail}` };
    }
    if (r.mode === 'unified') return { ok: true, kind: 'unified', impl: this.trading };
    /*
       ★★★ Classic 은 **포지션 보유 모드를 따로 읽는다.** 주문 인자가 그것에 따라
         완전히 달라진다 — 헤지 모드에서 `reduceOnly` 는 무시되고, 그러면 청산 주문이
         **반대 포지션을 새로 연다**(공식 문서 확인).
       ★ 읽기가 실패하면 `null` 이고, 아래 구현이 **주문을 거부한다.** 기본값을 정해
         주지 않는다 — 그 기본값이 틀렸을 때 정확히 위 사고가 난다.
    */
    let holdMode: 'hedge' | 'one_way' | null = null;
    try { holdMode = await this.v2.getHoldMode(cred); }
    catch { holdMode = null; }
    return { ok: true, kind: 'classic', impl: this.classic, holdMode };
  }

  async submitOrder(ctx: ExchangeContext, req: SubmitOrderRequest): Promise<SubmitOutcome> {
    const cred = toBitgetCredential(ctx.credential);
    const picked = await this.pick(cred);
    if (!picked.ok) return { status: 'REJECTED', reason: picked.reason };

    const payload = {
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
    };
    /*
       ★ Classic 은 보유 모드를 함께 넘긴다. 통합계정(v3)은 `posSide` 로 방향을 명시하므로
         보유 모드가 필요 없다.
    */
    const r = picked.kind === 'unified'
      ? await picked.impl.submitOrder(cred, payload)
      : await picked.impl.submitOrder(cred, payload, picked.holdMode);

    /*
       ★★★ **보호 주문은 걸렸는지 되읽어 확인한다.**

         Bitget 은 **모르는 필드를 조용히 무시한다**(실측). 필드 이름을 문서로 확인했지만
         (`presetStopSurplusPrice`·`presetStopLossPrice`), 문서가 최신인지 우리가 보증할
         수 없다. 무시되면 **주문은 성공하고 손절만 없다** — 고객은 보호가 걸렸다고
         믿은 채 무방비로 남는다.

       ★★ 그래서 접수 뒤 주문을 되읽어 그 값이 실제로 붙었는지 본다. 없으면
         **주문을 취소하고 실패로 알린다.** 무방비 포지션을 남기는 것보다 낫다.
       ★ 되읽기 자체가 실패해도 취소한다 — "확인할 수 없다" 는 "걸렸다" 가 아니다.
    */
    if (r.status === 'ACCEPTED' && (req.stopLossPrice || req.takeProfitPrice)) {
      const verified = await this.verifyProtection(ctx, req);
      if (!verified.ok) {
        /*
           ★★ 취소도 실패할 수 있다. 그때는 **포지션이 남았다는 사실을 그대로 알린다** —
             성공으로 위장하면 고객이 보호를 믿는다.
        */
        let canceled = false;
        try { canceled = (await this.cancelOrder(ctx, req.symbol, req.clientOrderId)).ok; }
        catch { canceled = false; }
        return {
          status: 'REJECTED',
          reason: canceled
            ? `bitget: 손절·익절이 실제로 걸리지 않아 주문을 취소했다 (${verified.reason})`
            : `bitget: ★ 손절·익절이 걸리지 않았고 취소도 실패했다 — 즉시 거래소에서 확인할 것 (${verified.reason})`,
        };
      }
    }
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

  /**
   * 보호 주문이 실제로 붙었는지 되읽어 확인한다.
   *
   * ★★★ 이 함수가 존재하는 이유: Bitget 이 모르는 필드를 조용히 무시하기 때문이다.
   *   "보냈다" 와 "걸렸다" 는 다르다 — 고객 돈이 걸린 차이다.
   * ★ 주문 조회는 계정 어댑터가 한다(읽기와 쓰기를 섞지 않는다). 여기서는 그 결과만 본다.
   */
  private async verifyProtection(
    ctx: ExchangeContext,
    req: SubmitOrderRequest,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let order: Record<string, unknown> | null = null;
    try {
      const found = await this.account.getOrderByClientId(ctx, req.clientOrderId);
      order = found as unknown as Record<string, unknown> | null;
    } catch (e) {
      return { ok: false, reason: `주문을 되읽지 못했다: ${(e as Error).message.slice(0, 120)}` };
    }
    if (!order) return { ok: false, reason: '접수된 주문을 찾을 수 없다' };
    /*
       ★ 정규화된 주문에는 보호가격 칸이 없다. 그래서 원본 필드를 함께 본다 —
         `normalizeOrder` 가 원본을 보존하도록 `raw` 를 담는다.
       ★★ 필드 이름은 v2·v3 가 다를 수 있으므로 둘 다 본다. 하나도 없으면 실패다.
    */
    const raw = (order.raw ?? order) as Record<string, unknown>;
    const num = (v: unknown): boolean => Number.isFinite(Number(v)) && Number(v) > 0;
    if (req.stopLossPrice) {
      const got = raw.presetStopLossPrice ?? raw.stopLossPrice ?? raw.slTriggerPrice;
      if (!num(got)) return { ok: false, reason: '손절가가 주문에 붙지 않았다' };
    }
    if (req.takeProfitPrice) {
      const got = raw.presetStopSurplusPrice ?? raw.takeProfitPrice ?? raw.tpTriggerPrice;
      if (!num(got)) return { ok: false, reason: '익절가가 주문에 붙지 않았다' };
    }
    return { ok: true };
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
