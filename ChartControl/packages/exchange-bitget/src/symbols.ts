/**
 * Bitget 심볼 / 타임프레임 매핑.
 *
 * ★★★ **실제 API 를 호출해 확인한 값이다**(2026-09-18). 문서만 믿지 않았다.
 *
 *   `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` → 797개 계약
 *   심볼 표기가 **우리 내부 표기와 같다**: `BTCUSDT`. KuCoin(`XBTUSDTM`)처럼 변환이
 *   필요하지 않다 — 그래서 변환 함수를 두지 않는다. 없는 변환을 만들면 나중에
 *   "왜 이게 있지" 가 된다.
 *
 *   `granularity` 는 **우리 표기와 대문자 규칙이 거의 같다**:
 *     1m 3m 5m 15m 30m · 1H 2H 4H 6H 12H · 1D 1W 1M
 *   ★ 확인 결과 **13종 전부 봉을 돌려준다.** `8H` 는 목록에 없어 확인했더니 실패한다.
 */
import type { Timeframe } from '@quantumtrade/config';

/**
 * 우리 주기 → Bitget granularity.
 *
 * ★★ 값을 **짐작해 넣지 않는다.** 없는 것은 넣지 않고 `null` 이 되게 한다 —
 *   가까운 주기로 대체하면 고객은 **맞아 보이는데 틀린 차트**를 본다.
 * ★ `8h` 가 없다: Bitget 은 6H·12H 만 주고 8H 는 주지 않는다(실측).
 */
const GRANULARITY: Partial<Record<Timeframe, string>> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6H',
  /* ★ 8h 없음 — 아래 UNSUPPORTED_TIMEFRAMES 참조 */
  '12h': '12H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
};

export function toGranularity(timeframe: Timeframe): string | null {
  return GRANULARITY[timeframe] ?? null;
}

/**
 * Bitget 이 주지 않는 주기.
 *
 * ★ 호출자가 미리 걸러낼 수 있게 노출한다. KuCoin 은 8h 를 주고 Bitget 은 안 준다 —
 *   거래소마다 다르므로 한쪽 기준으로 화면을 만들면 다른 쪽에서 빈 차트가 된다.
 */
export const UNSUPPORTED_TIMEFRAMES: ReadonlySet<string> = new Set(['8h']);

/** USDT 무기한 상품 구분자. Bitget 은 모든 요청에 이것을 요구한다. */
export const PRODUCT_TYPE = 'USDT-FUTURES' as const;
