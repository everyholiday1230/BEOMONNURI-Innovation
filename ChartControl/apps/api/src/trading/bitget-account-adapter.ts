/**
 * Bitget 계정 어댑터 — **UTA(v3) 우선, Classic(v2) 대체.**
 *
 * ★★★ **계정 모드는 우리가 고를 수 없다.** 고객이 UTA 를 쓰면 v2 가 거부되고
 *   (`40085`), Classic 을 쓰면 v3 가 거부된다(`40084`). 그래서 **v3 를 먼저 부르고
 *   `40084` 일 때만 v2 로 내려간다.** 그 밖의 오류에서는 모드를 정하지 않는다 —
 *   추측해 엉뚱한 API 로 가면 가격·수량 단위가 어긋난다.
 *
 * ★★ 판정 결과를 **자격증명별로 캐시한다.** 매 요청마다 두 번 부르면 지연과 요청 수가
 *   두 배다. 키가 바뀌면 캐시도 바뀐다(열쇠가 apiKey 다).
 *
 * ★ 실측(2026-09-18, 실키): 운영자 계정은 `unified` · `multi_assets` · `hedge_mode`.
 */
import type {
  AccountBalance,
  ExchangeContext,
  IExchangeAccountAdapter,
  NormalizedOrder,
  Position,
} from '@quantumtrade/exchange-core';
import {
  BitgetPrivateRest,
  BitgetV3Rest,
  type BitgetAccountMode,
  type BitgetCredentials,
} from '@quantumtrade/exchange-bitget';

function toBitgetCredential(c: { accessKey: string; secretKey: string; memo: string }): BitgetCredentials {
  return { apiKey: c.accessKey, apiSecret: c.secretKey, passphrase: c.memo };
}

export class BitgetAccountAdapter implements IExchangeAccountAdapter {
  /*
     ★ 모드 캐시. 열쇠는 apiKey — 키가 바뀌면 다시 판정한다.
     ★★ 메모리에만 둔다. 재시작하면 한 번 더 물어볼 뿐이고, 잘못된 모드를 영구히
       들고 있는 것보다 낫다.
  */
  private readonly modeCache = new Map<string, BitgetAccountMode>();

  constructor(
    private readonly v3: BitgetV3Rest = new BitgetV3Rest(),
    private readonly v2: BitgetPrivateRest = new BitgetPrivateRest(),
  ) {}

  /**
   * 이 자격증명의 계정 모드.
   *
   * ★★★ 판정에 실패하면 **던진다.** 모드를 모르는 채로 읽기를 계속하면 매번 절반이
   *   실패하고, 화면은 "잔고 0" 과 "조회 불가" 를 구분하지 못한다.
   */
  private async modeOf(cred: BitgetCredentials): Promise<BitgetAccountMode> {
    const cached = this.modeCache.get(cred.apiKey);
    if (cached) return cached;
    const r = await this.v3.detectMode(cred);
    if (!r.ok) {
      throw new Error(`bitget 계정 모드를 판정할 수 없다 (${r.reason}): ${r.detail}`);
    }
    this.modeCache.set(cred.apiKey, r.mode);
    return r.mode;
  }

  async getServerTime(): Promise<number> {
    return Date.now();
  }

  /**
   * 잔고.
   *
   * ★★★ 조회 실패를 **0 으로 바꾸지 않는다.** 0 은 "잔고가 없다" 는 뜻이고 고객은
   *   돈이 사라졌다고 생각한다. 던져서 호출자가 '측정 불가' 로 다루게 한다.
   * ★ 잔고가 진짜 0 인 것과는 다르다 — 그때는 거래소가 `00000` 과 함께 0 을 준다.
   */
  async getBalances(ctx: ExchangeContext): Promise<AccountBalance[]> {
    const cred = toBitgetCredential(ctx.credential);
    const mode = await this.modeOf(cred);
    if (mode === 'unified') {
      const a = await this.v3.getAssets(cred);
      /*
         ★★ UTA 는 계정 전체 자산을 준다. USDT 항목이 있으면 그것을 쓰고, 없으면
           `usdtEquity` 를 쓴다 — 잔고 0 인 계정은 `assets: []` 를 준다(실측).
         ★ `used` 를 짐작해 채우지 않는다. 확인되지 않은 값을 0 으로 두면 "묶인 돈이
           없다" 는 거짓이 된다 — 그래서 frozen 이 있으면 그것을 쓴다.
      */
      const usdt = a.assets.find((x) => x.coin.toUpperCase() === 'USDT');
      return [{
        asset: 'USDT',
        available: usdt ? usdt.available : a.usdtEquity,
        equity: usdt ? usdt.equity : a.usdtEquity,
        used: usdt ? usdt.frozen : '0',
      }];
    }
    const available = await this.v2.getAvailableUsdt(cred);
    return [{ asset: 'USDT', available, equity: available, used: '0' }];
  }

  /**
   * 포지션.
   *
   * ★★★ 레버리지를 모르면 **0** 이다(이 인터페이스의 관례 — KuCoin 어댑터도 같다).
   *   화면은 `> 0` 일 때만 보여준다. **1 로 두면 청산 위험을 작게 보이게 한다.**
   * ★ 진입가가 없는 행은 버린다 — 손익·수익률 계산이 전부 어긋난다.
   */
  async getPositions(ctx: ExchangeContext): Promise<Position[]> {
    const cred = toBitgetCredential(ctx.credential);
    const mode = await this.modeOf(cred);
    const rows = mode === 'unified'
      ? await this.v3.getPositions(cred)
      : await this.v2.getPositions(cred);
    const out: Position[] = [];
    for (const r of rows) {
      if (!r.entryPrice) continue;
      out.push({
        symbol: r.symbol,
        side: r.side,
        size: r.size,
        entryPrice: r.entryPrice,
        ...(r.markPrice ? { markPrice: r.markPrice } : {}),
        ...(r.liquidationPrice ? { liquidationPrice: r.liquidationPrice } : {}),
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
   * ★★★ **Classic 모드는 아직 배선되지 않았다 — 던진다.** 빈 배열을 돌려주면 화면이
   *   "미체결 주문이 없다" 고 단정하고, 고객은 주문이 취소된 줄 안다.
   */
  async getOpenOrders(ctx: ExchangeContext, symbol?: string): Promise<NormalizedOrder[]> {
    const cred = toBitgetCredential(ctx.credential);
    const mode = await this.modeOf(cred);
    /*
       ★ 모드에 맞는 경로로 간다. 둘 다 배선했으므로 이제 던지지 않는다.
       ★★ 실패는 여전히 던진다(빈 배열로 바꾸지 않는다) — 빈 배열은 "미체결 주문이
         없다" 는 뜻이고 고객은 주문이 취소된 줄 안다.
    */
    const rows = mode === 'unified'
      ? await this.v3.getUnfilledOrders(cred, symbol)
      : await this.v2.getUnfilledOrders(cred, symbol);
    return rows.map((r) => normalizeOrder(r));
  }

  /**
   * 주문 한 건 — `clientOid` 로 찾는다.
   *
   * ★★★ 조회를 못 했을 때 `null` 을 돌려주지 않는다. `null` 은 "그런 주문이 없다" 는
   *   뜻이고, **주문 대조가 그것을 보고 주문이 실패했다고 결론 내린다.** 실제로는
   *   조회를 안 한 것이다 — 그 차이가 중복 주문을 만든다.
   * ★ 정말 없을 때만 `null` 이다.
   */
  async getOrderByClientId(ctx: ExchangeContext, clientOrderId: string): Promise<NormalizedOrder | null> {
    const cred = toBitgetCredential(ctx.credential);
    const mode = await this.modeOf(cred);
    /*
       ★ 미체결에서 먼저 찾고, 없으면 이력에서 찾는다. 이력만 보면 아직 미체결인
         주문을 "없다" 고 판단한다.
       ★★★ 조회가 실패하면 **던진다.** `null` 은 "그런 주문이 없다" 는 뜻이고,
         주문 대조가 그것을 보고 **주문이 실패했다고 결론 내린다** — 그 차이가
         중복 주문을 만든다. 아래 호출들이 실패하면 예외가 그대로 올라간다.
    */
    const open = mode === 'unified'
      ? await this.v3.getUnfilledOrders(cred)
      : await this.v2.getUnfilledOrders(cred);
    const hitOpen = open.find((r) => String(r.clientOid ?? '') === clientOrderId);
    if (hitOpen) return normalizeOrder(hitOpen);
    const hist = mode === 'unified'
      ? await this.v3.getHistoryOrders(cred, 100)
      : await this.v2.getHistoryOrders(cred, 100);
    const hit = hist.find((r) => String(r.clientOid ?? '') === clientOrderId);
    return hit ? normalizeOrder(hit) : null;
  }
}

/**
 * Bitget 주문 → 우리 표기.
 *
 * ★★ 상태 이름이 거래소마다 다르다. 모르는 상태를 `filled` 로 두면 **체결되지 않은
 *   주문을 체결로 본다** — 가장 위험한 방향이다. 그래서 모르면 `open` 이다.
 */
function normalizeOrder(r: Record<string, unknown>): NormalizedOrder {
  const raw = String(r.status ?? r.state ?? '').toLowerCase();
  const status: NormalizedOrder['status'] =
    raw.includes('filled') && !raw.includes('partial') ? 'filled'
      : raw.includes('cancel') ? 'canceled'
        : raw.includes('partial') ? 'partially_filled'
          : 'open';
  return {
    clientOrderId: String(r.clientOid ?? ''),
    exchangeOrderId: String(r.orderId ?? ''),
    symbol: String(r.symbol ?? ''),
    side: String(r.side ?? '').toLowerCase() === 'sell' ? 'short' : 'long',
    type: String(r.orderType ?? '').toLowerCase() === 'market' ? 'market' : 'limit',
    price: r.price != null && r.price !== '' ? String(r.price) : undefined,
    quantity: String(r.qty ?? r.size ?? '0'),
    filledQuantity: String(r.filledQty ?? r.baseVolume ?? '0'),
    status,
    createdAt: Number(r.cTime ?? r.createdTime ?? 0) || Date.now(),
    updatedAt: Number(r.uTime ?? r.updatedTime ?? 0) || Date.now(),
    /*
       ★★★ **원본을 보존한다.** 정규화된 주문에는 손절·익절 칸이 없는데,
         주문 어댑터가 "보호가 실제로 걸렸는지" 를 되읽어 확인해야 한다
         (Bitget 이 모르는 필드를 조용히 무시하기 때문이다).
       ★ 버리면 그 검증이 **항상 실패**하고, 모든 보호 주문이 취소된다.
       ★★ 비밀은 들어 있지 않다 — 주문 정보일 뿐이다.
    */
    raw: r,
  } as unknown as NormalizedOrder;
}
