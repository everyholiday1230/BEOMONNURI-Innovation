/**
 * Bitget 계정 어댑터 — **읽기 전용**.
 *
 * ★★★ **주문 경로가 없다.** `IExchangeTradingAdapter` 를 구현하지 않으므로 등록소에
 *   `trading` 없이 등록되고, 그 결과 **비트겟으로는 주문이 나가지 않는다.**
 *   그 사실이 타입에 드러난다 — 실수로 주문이 나갈 길이 없다.
 *
 * ★★ 읽기부터 가는 이유: 서명이나 수량 단위를 잘못 이해했을 때 읽기는 틀린 숫자를
 *   보여주는 것으로 끝나지만 쓰기는 고객 돈을 움직인다.
 */
import type {
  AccountBalance,
  ExchangeContext,
  IExchangeAccountAdapter,
  NormalizedOrder,
  Position,
} from '@quantumtrade/exchange-core';
import { BitgetPrivateRest, type BitgetCredentials } from '@quantumtrade/exchange-bitget';

/**
 * 우리 자격증명 → Bitget 자격증명.
 *
 * ★★ 우리는 `memo` 라는 이름으로 passphrase 를 저장한다(KuCoin 용어). Bitget 도
 *   passphrase 를 쓰므로 같은 칸을 쓴다 — 고객에게는 화면이 거래소에 맞는 이름을 보여준다.
 */
function toBitgetCredential(c: { accessKey: string; secretKey: string; memo: string }): BitgetCredentials {
  return { apiKey: c.accessKey, apiSecret: c.secretKey, passphrase: c.memo };
}

export class BitgetAccountAdapter implements IExchangeAccountAdapter {
  constructor(private readonly client: BitgetPrivateRest = new BitgetPrivateRest()) {}

  /**
   * 서버 시각.
   *
   * ★ 우리 시각을 돌려준다. Bitget 은 공개 시각 엔드포인트를 주지만, 이 값은 서명
   *   타임스탬프에 쓰이고 그것은 이미 `signature.ts` 가 자기 시각으로 만든다 —
   *   두 곳에서 시각을 정하면 어긋난다.
   */
  async getServerTime(): Promise<number> {
    return Date.now();
  }

  /**
   * 잔고.
   *
   * ★★★ 조회 실패를 **0 으로 바꾸지 않는다.** 0 은 "잔고가 없다" 는 뜻이고, 그것을 보면
   *   고객은 돈이 사라졌다고 생각한다. 던져서 호출자가 '측정 불가' 로 다루게 한다.
   */
  async getBalances(ctx: ExchangeContext): Promise<AccountBalance[]> {
    const cred = toBitgetCredential(ctx.credential);
    const available = await this.client.getAvailableUsdt(cred);
    /*
       ★ Bitget 계정 응답은 `available` 을 준다. 총자산(equity)·사용중(used)을 따로
         구하려면 필드를 더 읽어야 하는데, 실계정으로 확인하기 전에는 **추측해 채우지
         않는다.** 지금은 가용 잔고만 확실하다.
       ★ `equity` 를 `available` 과 같게 두는 것은 거짓이 될 수 있다(포지션이 있으면
         다르다). 그래서 `used: '0'` 대신 그대로 두지 않고, 확인되지 않은 값은
         available 과 같게 두되 이 주석으로 한계를 남긴다.
         ★★ 실키로 검증한 뒤 정확한 필드로 바꿀 것.
    */
    return [{ asset: 'USDT', available, equity: available, used: '0' }];
  }

  /**
   * 포지션.
   *
   * ★★★ 레버리지를 모르면 **0** 이다(이 인터페이스의 관례 — KuCoin 어댑터도 같다).
   *   화면은 `> 0` 일 때만 보여준다. **1 로 두면 청산 위험을 실제보다 작게 보이게 한다.**
   */
  async getPositions(ctx: ExchangeContext): Promise<Position[]> {
    const rows = await this.client.getPositions(toBitgetCredential(ctx.credential));
    const out: Position[] = [];
    for (const r of rows) {
      /*
         ★ 진입가가 없으면 그 행을 버린다. 진입가 없는 포지션 행은 화면에서 손익·수익률
           계산이 전부 어긋난다 — 빈 값보다 없는 것이 낫다.
      */
      if (!r.entryPrice) continue;
      out.push({
        symbol: r.symbol,
        side: r.side,
        size: r.size,
        entryPrice: r.entryPrice,
        ...(r.markPrice ? { markPrice: r.markPrice } : {}),
        ...(r.liquidationPrice ? { liquidationPrice: r.liquidationPrice } : {}),
        /* ★ 0 = 모름. 지어내지 않는다. */
        leverage: r.leverage ?? 0,
        marginMode: r.marginMode,
        ...(r.unrealisedPnl ? { unrealizedPnl: r.unrealisedPnl } : {}),
        ...(r.margin ? { margin: r.margin } : {}),
      } as Position);
    }
    return out;
  }

  /**
   * 미체결 주문.
   *
   * ★★★ **아직 없다.** 빈 배열을 돌려주면 화면이 "미체결 주문이 없다" 고 단정한다 —
   *   실제로는 있을 수 있고, 고객은 주문이 취소된 줄 안다. 그래서 던진다.
   * ★ 호출자(`exchangeRead`)가 실패를 '조회 불가' 로 표시한다.
   */
  async getOpenOrders(_ctx: ExchangeContext, _symbol?: string): Promise<NormalizedOrder[]> {
    throw new Error('bitget: 미체결 주문 조회는 아직 배선되지 않았다');
  }

  /**
   * 주문 한 건 조회.
   *
   * ★★★ `null` 을 돌려주지 않는다. `null` 은 "그런 주문이 없다" 는 뜻이고, 주문 대조
   *   경로가 그것을 보고 **주문이 실패했다고 결론 내린다** — 실제로는 조회를 안 한 것이다.
   */
  async getOrderByClientId(_ctx: ExchangeContext, _clientOrderId: string): Promise<NormalizedOrder | null> {
    throw new Error('bitget: 주문 조회는 아직 배선되지 않았다');
  }
}
