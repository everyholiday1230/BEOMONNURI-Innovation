/**
 * 내부 심볼 <-> KuCoin 선물 심볼 매핑.
 *
 * 내부 표기는 프론트엔드가 이미 쓰고 있는 `BASE + QUOTE` (예: 'BTCUSDT') 이다.
 * 이 표기를 바꾸면 디자이너 산출물을 수정해야 하므로 그대로 유지한다.
 *
 * KuCoin 선물 규칙(실측 확인):
 *  - BTC 는 역사적 이유로 'XBTUSDTM'
 *  - 그 외는 '<BASE>USDTM'
 *  - MATIC 은 POL 로 리브랜딩되어 'POLUSDTM' (MATICUSDTM 미존재)
 *  - TON 은 KuCoin 선물 미상장 (2026-08-04 contracts/active 679건 조회 기준)
 *
 * 계약 사양(multiplier/tickSize/lotSize)은 하드코딩하지 않는다.
 * contracts/active 응답에서 런타임에 읽어 캐시한다. 상장 조건은 변하기 때문.
 */

/** 내부 base 심볼이 KuCoin 에서 다른 이름을 쓰는 경우만 명시한다. */
const BASE_ALIAS = {
  BTC: 'XBT',
  MATIC: 'POL', // MATIC -> POL 리브랜딩
};

/** KuCoin 선물에 상장되지 않아 실시세를 제공할 수 없는 내부 심볼. */
export const UNSUPPORTED = new Set(['TONUSDT']);

/** 역방향 조회용. KuCoin base -> 내부 base */
const REVERSE_ALIAS = Object.fromEntries(
  Object.entries(BASE_ALIAS).map(([internal, kucoin]) => [kucoin, internal]),
);

/**
 * 내부 심볼을 KuCoin 선물 심볼로 변환.
 * @param {string} internalSymbol 예: 'BTCUSDT'
 * @returns {string|null} 예: 'XBTUSDTM'. 지원 불가 시 null.
 */
export function toKucoin(internalSymbol) {
  const s = String(internalSymbol || '').toUpperCase();
  if (!s.endsWith('USDT')) return null;
  if (UNSUPPORTED.has(s)) return null;
  const base = s.slice(0, -4);
  if (!base) return null;
  return `${BASE_ALIAS[base] || base}USDTM`;
}

/**
 * KuCoin 선물 심볼을 내부 심볼로 변환.
 * @param {string} kucoinSymbol 예: 'XBTUSDTM'
 * @returns {string|null} 예: 'BTCUSDT'
 */
export function toInternal(kucoinSymbol) {
  const s = String(kucoinSymbol || '').toUpperCase();
  if (!s.endsWith('USDTM')) return null;
  const base = s.slice(0, -5);
  if (!base) return null;
  return `${REVERSE_ALIAS[base] || base}USDT`;
}

/**
 * 프론트엔드가 쓰는 타임프레임 -> KuCoin granularity(분).
 * KuCoin 선물이 허용하는 값: 1,5,15,30,60,120,240,480,720,1440,10080
 */
const GRANULARITY = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1H': 60,
  '2H': 120,
  '4H': 240,
  '8H': 480,
  '12H': 720,
  '1D': 1440,
  '1W': 10080,
};

/** 프론트엔드에는 존재하지만 KuCoin 선물에 없는 '3m' 은 5m 으로 승격한다. */
const GRANULARITY_FALLBACK = { '3m': 5 };

export function toGranularity(timeframe) {
  const tf = String(timeframe || '');
  return GRANULARITY[tf] ?? GRANULARITY_FALLBACK[tf] ?? null;
}

/** KuCoin WS klineBin 채널 접미사 (limitCandle:<SYMBOL>_<suffix>) */
const WS_CANDLE_SUFFIX = {
  1: '1min',
  5: '5min',
  15: '15min',
  30: '30min',
  60: '1hour',
  120: '2hour',
  240: '4hour',
  480: '8hour',
  720: '12hour',
  1440: '1day',
  10080: '1week',
};

export function toWsCandleSuffix(timeframe) {
  const g = toGranularity(timeframe);
  return g === null ? null : (WS_CANDLE_SUFFIX[g] ?? null);
}

export const SUPPORTED_TIMEFRAMES = Object.keys(GRANULARITY);
