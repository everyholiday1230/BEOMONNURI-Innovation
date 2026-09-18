/**
 * Bitget 응답 → 우리 스키마.
 *
 * ★★★ **검증을 통과하지 못한 행은 버리고 나머지는 살린다.** 한 종목의 값이 깨졌다고
 *   전체를 거부하면 화면이 빈다 — 거래소가 새 필드를 넣거나 상장 직전 종목이
 *   빈 값을 줄 때 실제로 그런 일이 생긴다.
 */
import { CandleSchema, TickerSchema, type Candle, type Ticker } from '@quantumtrade/schemas';

/**
 * 봉 한 줄.
 *
 * ★★ 실측 형식(2026-09-18):
 *   `['1789758000000', '80906.8', '81386.4', '80875.4', '81169.3', '1648.9872', '133878384.8306']`
 *   → [시각, 시가, 고가, 저가, 종가, **기준통화 거래량**, 견적통화 거래량]
 *
 * ★★★ 거래량은 **6번째(기준통화)** 를 쓴다. 7번째는 USDT 금액이다. 둘을 섞으면
 *   거래량이 수천 배로 보이고, 거래량 지표가 전부 어긋난다.
 */
export function rowToCandle(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [t, o, h, l, c, baseVol] = row as unknown[];
  const time = Number(t);
  if (!Number.isFinite(time) || time <= 0) return null;
  const parsed = CandleSchema.safeParse({
    time,
    open: String(o),
    high: String(h),
    low: String(l),
    close: String(c),
    volume: String(baseVol),
    /*
       ★ 마지막 봉은 아직 닫히지 않았을 수 있다. 여기서는 판단하지 않는다 —
         호출자가 시각과 현재 시각을 비교해 정한다. 여기서 `false` 로 박으면
         과거 봉까지 미완성으로 표시된다.
    */
    closed: true,
  });
  return parsed.success ? parsed.data : null;
}

/** 봉 배열. 시각 오름차순으로 정렬하고 중복을 없앤다. */
export function normalizeCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<number, Candle>();
  for (const row of raw) {
    const c = rowToCandle(row);
    if (c) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * 시세 한 줄.
 *
 * ★★ 실측 필드: `symbol · lastPr · high24h · low24h · baseVolume · change24h ·
 *   indexPrice · fundingRate · markPrice(있을 때) · ts`
 * ★★★ `change24h` 는 **비율**이다(`0.06104` = +6.104%). 그대로 쓰면 0.06% 로 보인다 —
 *   100 을 곱한다. KuCoin 과 단위가 다르므로 어댑터마다 확인해야 한다.
 */
export function rowToTicker(raw: unknown): Ticker | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const symbol = String(r.symbol ?? '');
  if (!symbol) return null;
  const pct = Number(r.change24h);
  const num = (v: unknown): string | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? String(v) : undefined;
  };
  const parsed = TickerSchema.safeParse({
    symbol,
    last: String(r.lastPr ?? ''),
    /* ★ 비율 → 퍼센트. 값이 없으면 0 이 아니라 거부한다(아래 스키마가 잡는다). */
    changePct: Number.isFinite(pct) ? pct * 100 : Number.NaN,
    markPrice: num(r.markPrice),
    indexPrice: num(r.indexPrice),
    fundingRate: Number.isFinite(Number(r.fundingRate)) ? Number(r.fundingRate) : undefined,
    high24h: num(r.high24h),
    low24h: num(r.low24h),
    /* ★ 기준통화 거래량. `usdtVolume` 은 금액이라 다른 뜻이다. */
    vol24h: num(r.baseVolume),
  });
  return parsed.success ? parsed.data : null;
}

export function normalizeTickers(raw: unknown): Ticker[] {
  if (!Array.isArray(raw)) return [];
  const out: Ticker[] = [];
  for (const row of raw) {
    const t = rowToTicker(row);
    if (t) out.push(t);
  }
  return out;
}
