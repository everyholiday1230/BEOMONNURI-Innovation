/**
 * Bitget **Classic(v2) 주문** — 전송·취소·수정.
 *
 * ★★★ **이 파일의 인자 이름은 실키로 검증하지 못했다.** 운영자 계정이 UTA 라서 v2 를
 *   부르면 계정 모드 검사(`40085`)가 인자 검증보다 **먼저** 막는다.
 *
 * ★★ 그래도 붙이는 판단 근거 — 실패 방향이 안전하다:
 *
 *     · 기본 주문 인자는 전부 **필수**다. 이름이 틀리면 거래소가
 *       "Parameter X cannot be empty" 로 **거절한다.** 주문이 안 나갈 뿐이고
 *       고객 돈이 잘못 움직이지 않는다 — **시끄러운 실패**다.
 *     · 위험한 것은 **선택 인자**다. v3 실측으로 확인했듯 Bitget 은 모르는 필드를
 *       조용히 무시한다. 그래서 **손절·익절은 v2 에서도 거부한다.**
 *
 * ★ Classic 은 유지보수 모드다(공식 문서: "The Classic Account is in maintenance mode").
 *   그래도 고객이 Classic 계정을 쓸 수 있으므로 지원한다 — 우리가 고를 수 없다.
 *
 * ★★ v2 와 v3 의 이름 차이(실측·문서):
 *     productType(v2) ↔ category(v3)
 *     size(v2)        ↔ qty(v3)
 *     marginCoin·marginMode 는 v2 에만 있다(UTA 는 계정이 통합돼 필요 없다)
 */
import { BITGET_OK } from './rest.js';
import { BitgetV3Rest, type BitgetV3Options } from './v3-rest.js';
import type { BitgetCredentials } from './signature.js';
import type { V3SubmitOutcome, V3SubmitRequest } from './v3-trading.js';

/** v2 는 상품 구분을 `productType` 으로 받는다(v3 의 `category` 와 이름이 다르다). */
export const V2_PRODUCT_TYPE = 'USDT-FUTURES' as const;

export class BitgetV2Trading {
  readonly canPlaceRealOrders = true;

  /*
     ★ 서명·요청 방식이 v3 와 같으므로 같은 클라이언트를 쓴다. 서명은 실키로 검증됐다
       (v3 호출이 전부 `00000` 이었다) — 경로만 다르다.
  */
  private readonly rest: BitgetV3Rest;

  constructor(opts: BitgetV3Options = {}) {
    this.rest = new BitgetV3Rest(opts);
  }

  /**
   * 주문 전송 (Classic).
   *
   * ★★★ 손절·익절·스톱은 **거부한다.** v3 와 같은 이유다 — 선택 인자가 조용히 무시되면
   *   고객은 보호가 걸렸다고 믿은 채 무방비로 남는다. 데모로 확인한 뒤에 붙인다.
   */
  async submitOrder(cred: BitgetCredentials, req: V3SubmitRequest): Promise<V3SubmitOutcome> {
    if (req.stopPrice) {
      return { status: 'REJECTED', reason: 'bitget(classic): 발동(스톱) 주문은 아직 지원하지 않는다 — 주문을 보내지 않았다' };
    }
    if (req.takeProfitPrice || req.stopLossPrice) {
      return { status: 'REJECTED', reason: 'bitget(classic): 손절·익절 동시 등록은 아직 지원하지 않는다 — 주문을 보내지 않았다' };
    }
    if (req.type === 'limit' && !req.price) {
      return { status: 'REJECTED', reason: 'bitget(classic): 지정가 주문에 가격이 없다' };
    }

    const body: Record<string, string> = {
      /* ★★ v2 는 `productType` 이다. `category` 를 보내면 필수 인자 누락으로 거절된다. */
      productType: V2_PRODUCT_TYPE,
      symbol: req.symbol,
      /* ★ v2 는 증거금 통화를 명시해야 한다. UTA 는 계정이 통합돼 필요 없다. */
      marginCoin: 'USDT',
      /*
         ★★ v2 의 교차 증거금 표기는 `crossed` 다(`cross` 가 아니다). 우리 내부 표기와
           다르므로 여기서 변환한다 — 한 곳에서만 한다.
      */
      marginMode: 'crossed',
      /* ★★★ v2 는 `size` 다. v3 의 `qty` 를 보내면 거절된다. */
      size: req.quantity,
      side: req.side === 'long' ? 'buy' : 'sell',
      orderType: req.type,
      clientOid: req.clientOrderId,
      ...(req.type === 'limit' && req.price ? { price: req.price } : {}),
      /*
         ★★ v2 의 청산 표시. 없으면 반대 포지션이 열릴 수 있다.
         ★ v2 는 `reduceOnly` 를 'YES'/'NO' 문자열로 받는다(v3 와 같다).
      */
      ...(req.reduceOnly ? { reduceOnly: 'YES' } : {}),
      ...(req.timeInForce ? { force: req.timeInForce.toLowerCase() } : {}),
      /* ★ v2 는 postOnly 를 `force: 'post_only'` 로 표현한다. */
      ...(req.postOnly ? { force: 'post_only' } : {}),
    };

    let env;
    try {
      env = await this.rest.signed<Record<string, unknown>>(cred, 'POST', '/api/v2/mix/order/place-order', {}, body);
    } catch (e) {
      /* ★★★ 응답을 못 받았다. **거절이 아니다** — 다시 보내면 두 번 들어간다. */
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
      return {
        status: 'SUBMIT_UNKNOWN',
        clientOrderId: req.clientOrderId,
        reason: '거래소가 성공을 알렸으나 주문 id 가 없다 — 대조가 필요하다',
      };
    }
    return { status: 'ACCEPTED', exchangeOrderId: id, clientOrderId: String(d.clientOid ?? req.clientOrderId) };
  }

  /** 취소. ★ 실패를 성공으로 만들지 않는다 — 취소된 줄 알고 포지션을 방치하게 된다. */
  async cancelOrder(cred: BitgetCredentials, symbol: string, clientOrderId: string): Promise<{ ok: boolean; reason?: string }> {
    const env = await this.rest.signed<Record<string, unknown>>(
      cred, 'POST', '/api/v2/mix/order/cancel-order', {},
      { productType: V2_PRODUCT_TYPE, symbol, marginCoin: 'USDT', clientOid: clientOrderId },
    );
    if (env.code === BITGET_OK) return { ok: true };
    return { ok: false, reason: `bitget ${env.code}: ${env.msg || '(no message)'}` };
  }

  /**
   * 수정.
   *
   * ★★ v2 의 수정은 **새 clientOid 를 요구한다**(문서). 우리는 같은 열쇠로 대조하므로
   *   그대로 보내고, 거래소가 거절하면 그 이유를 그대로 전한다 — 짐작해 새 id 를
   *   만들면 **대조할 열쇠가 바뀌어** 주문을 잃는다.
   */
  async modifyOrder(
    cred: BitgetCredentials,
    symbol: string,
    clientOrderId: string,
    changes: { price?: string; quantity?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!changes.price && !changes.quantity) {
      return { ok: false, reason: 'bitget(classic): 바꿀 값이 없다' };
    }
    const env = await this.rest.signed<Record<string, unknown>>(
      cred, 'POST', '/api/v2/mix/order/modify-order', {},
      {
        productType: V2_PRODUCT_TYPE,
        symbol,
        clientOid: clientOrderId,
        ...(changes.price ? { newPrice: changes.price } : {}),
        ...(changes.quantity ? { newSize: changes.quantity } : {}),
      },
    );
    if (env.code === BITGET_OK) return { ok: true };
    return { ok: false, reason: `bitget ${env.code}: ${env.msg || '(no message)'}` };
  }
}
