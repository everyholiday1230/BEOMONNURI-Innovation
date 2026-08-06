/**
 * KuCoin 선물 심볼 / 타임프레임 매핑.
 *
 * 내부 심볼 표기는 `BASE + QUOTE` (예: 'BTCUSDT') 이다. 디자이너 프론트엔드와
 * @quantumtrade/schemas 의 SymbolInfo.id 가 이미 이 표기를 쓰므로 유지한다.
 *
 * 실측 근거 (2026-08-04, /api/v1/contracts/active 679건 조회):
 *  - BTC 는 역사적 이유로 'XBTUSDTM'
 *  - 그 외는 '<BASE>USDTM'
 *  - MATIC 은 POL 로 리브랜딩되어 'POLUSDTM' ('MATICUSDTM' 은 존재하지 않음)
 *  - TON 은 KuCoin 선물 미상장
 */

import type { Timeframe } from '@quantumtrade/config';

/** 내부 base 가 KuCoin 에서 다른 이름을 쓰는 경우만 명시한다. */
const BASE_ALIAS: Record<string, string> = {
  BTC: 'XBT',
  MATIC: 'POL',
};

const REVERSE_ALIAS: Record<string, string> = Object.fromEntries(
  Object.entries(BASE_ALIAS).map(([internal, kucoin]) => [kucoin, internal]),
);

/**
 * KuCoin 선물에 상장되지 않아 실데이터를 제공할 수 없는 내부 심볼.
 *
 * 목록에서 지우지 않고 "미지원"으로 표시하는 이유: 디자이너 UI 의 마켓 목록에서
 * 행을 삭제하지 않는다는 계약을 지키기 위함. 호출자는 이 집합을 보고 해당 행을
 * 실데이터 없이 렌더할 수 있다.
 */
export const UNSUPPORTED_SYMBOLS: ReadonlySet<string> = new Set(['TONUSDT']);

/**
 * 내부 심볼 -> KuCoin 선물 심볼.
 * @returns 지원하지 않으면 null
 */
export function toKucoinSymbol(internalSymbol: string): string | null {
  const s = String(internalSymbol ?? '').toUpperCase();
  if (!s.endsWith('USDT')) return null;
  if (UNSUPPORTED_SYMBOLS.has(s)) return null;
  const base = s.slice(0, -4);
  if (!base) return null;
  return `${BASE_ALIAS[base] ?? base}USDTM`;
}

/** KuCoin 선물 심볼 -> 내부 심볼. */
export function toInternalSymbol(kucoinSymbol: string): string | null {
  const s = String(kucoinSymbol ?? '').toUpperCase();
  if (!s.endsWith('USDTM')) return null;
  const base = s.slice(0, -5);
  if (!base) return null;
  return `${REVERSE_ALIAS[base] ?? base}USDT`;
}

/**
 * 타임프레임 -> KuCoin granularity(분).
 *
 * KuCoin 선물이 허용하는 값: 1, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 10080.
 * '3m' 은 KuCoin 에 없다. 5m 으로 바꿔 응답하면 3분봉을 요청한 호출자에게
 * 5분봉을 3분봉이라고 주는 셈이라 조용한 데이터 오류가 된다. 그래서 null 을
 * 반환해 명시적으로 실패시킨다. (디자이너 차트 툴바는 1m/5m/15m/30m/1H/4H/1D 만 쓴다)
 */
const GRANULARITY: Partial<Record<Timeframe, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

export function toGranularity(timeframe: Timeframe): number | null {
  return GRANULARITY[timeframe] ?? null;
}

/** KuCoin 이 지원하지 않는 타임프레임. 호출자가 미리 걸러낼 수 있게 노출한다. */
export const UNSUPPORTED_TIMEFRAMES: ReadonlySet<string> = new Set(['3m']);

/** WS limitCandle 채널 접미사: /contractMarket/limitCandle:<SYMBOL>_<suffix> */
const WS_CANDLE_SUFFIX: Record<number, string> = {
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

export function toWsCandleSuffix(timeframe: Timeframe): string | null {
  const g = toGranularity(timeframe);
  return g === null ? null : (WS_CANDLE_SUFFIX[g] ?? null);
}

/** WS 접미사 -> 타임프레임 (수신 메시지 라우팅용) */
const SUFFIX_TO_TIMEFRAME: Record<string, Timeframe> = {
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '1hour': '1h',
  '2hour': '2h',
  '4hour': '4h',
  '1day': '1d',
  '1week': '1w',
};

export function fromWsCandleSuffix(suffix: string): Timeframe | null {
  return SUFFIX_TO_TIMEFRAME[suffix] ?? null;
}

/** KuCoin 이 실제로 지원하는 타임프레임 목록. */
export const SUPPORTED_TIMEFRAMES = Object.keys(GRANULARITY) as Timeframe[];
