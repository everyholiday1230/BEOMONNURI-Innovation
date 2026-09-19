/**
 * Bitget **UTA(통합 계정) v3** 사적 REST.
 *
 * ★★★ 실키로 확인한 경로(2026-09-18):
 *     GET /api/v3/account/settings          → uid · accountMode · holdMode
 *     GET /api/v3/account/assets            → accountEquity · usdtEquity · assets[]
 *     GET /api/v3/position/current-position?category=USDT-FUTURES  → { list }
 *     GET /api/v3/trade/unfilled-orders?category=...               → { list, cursor }
 *     GET /api/v3/trade/history-orders?category=...&limit=          → { list, cursor }
 *     GET /api/v3/trade/fills?category=...&limit=                   → { list, cursor }
 *     GET /api/v3/position/history-position?category=...&limit=     → { list, cursor }
 *   ★ `/api/v3/position/all-position` 은 **없다**(40404). v2 이름을 그대로 쓰면 안 된다.
 *   ★★ `list` 가 **`null`** 로 올 수 있다(비어 있을 때). `[]` 를 기대하면 터진다.
 *
 * ★★★ **정밀도는 v3 의 문자열을 그대로 쓴다.**
 *     PEPEUSDT priceMultiplier = "0.0000000001"
 *   계산하면 `1e-10` 이 되고 `String(1e-10)` 은 `'1e-10'` — 소수점이 없다.
 *   **이것이 KuCoin 에서 손절 없는 시장가 주문을 만든 그 버그다.** 곱셈·로그를 쓰지 않는다.
 */
import { BITGET_BASE, BITGET_OK, type BitgetEnvelope, type FetchImpl } from './rest.js';
import { authHeaders, type BitgetCredentials, type HttpMethod } from './signature.js';
import { classifyError, CODE_IS_CLASSIC, type ModeDetection } from './account-mode.js';

/** v3 는 상품 구분을 `category` 로 받는다(v2 의 `productType` 과 이름이 다르다). */
export const V3_CATEGORY = 'USDT-FUTURES' as const;

export interface BitgetV3Options {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  now?: () => number;
}

/** v3 목록 응답. `list` 가 null 로 올 수 있다. */
interface V3List<T> {
  list: T[] | null;
  cursor?: string | null;
}

export interface V3Asset {
  coin: string;
  available: string;
  equity: string;
  frozen: string;
}

export interface V3Position {
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string | null;
  markPrice: string | null;
  liquidationPrice: string | null;
  unrealisedPnl: string | null;
  margin: string | null;
  leverage: number | null;
  marginMode: 'cross' | 'isolated';
}

export class BitgetV3Rest {
  private readonly base: string;

  private readonly fetchImpl: FetchImpl;

  private readonly timeoutMs: number;

  private readonly now: () => number;

  constructor(opts: BitgetV3Options = {}) {
    this.base = (opts.baseUrl ?? BITGET_BASE).replace(/\/+$/u, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * 서명된 요청.
   *
   * ★ 쿼리를 한 곳에서 만들어 **서명과 URL 에 똑같이** 쓴다. 순서가 달라지면 서명이 틀린다.
   */
  async signed<T>(
    cred: BitgetCredentials,
    method: HttpMethod,
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: unknown,
  ): Promise<BitgetEnvelope<T>> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const requestPath = `${path}${qs ? `?${qs}` : ''}`;
    /* ★ POST 본문은 서명에 **그대로** 들어간다. 다시 직렬화하면 공백이 달라져 틀린다. */
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const headers = authHeaders(cred, method, requestPath, bodyText, this.now);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}${requestPath}`, {
        method,
        headers,
        ...(bodyText ? { body: bodyText } : {}),
        signal: ac.signal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as BitgetEnvelope<T>;
      } catch {
        return { code: `HTTP_${res.status}`, msg: text.slice(0, 200), requestTime: this.now(), data: null };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 계정 모드 감지 — **v3 를 먼저 부른다.**
   *
   * ★★ `40084` 면 Classic 이다(호출자가 v2 로 내려간다). 그 밖의 오류에서는
   *   **모드를 정하지 않는다** — 추측하면 단위가 어긋난 주문이 나간다.
   */
  async detectMode(cred: BitgetCredentials): Promise<ModeDetection> {
    let env: BitgetEnvelope<{ accountMode?: string; holdMode?: string }>;
    try {
      env = await this.signed<{ accountMode?: string; holdMode?: string }>(cred, 'GET', '/api/v3/account/settings');
    } catch (e) {
      return { ok: false, reason: 'UPSTREAM', detail: (e as Error).message.slice(0, 200) };
    }
    if (env.code === BITGET_OK) {
      /*
         ★★★ **포지션 보유 모드를 함께 읽는다.** 주문 인자가 이것에 따라 달라진다 —
           헤지 모드에서 `reduceOnly` 는 무시되고, 그러면 **청산 주문이 반대 포지션을
           새로 연다**(공식 문서 확인).
         ★ 실측: 운영자 계정은 `holdMode: 'hedge_mode'`.
         ★★ 모르는 값이면 `undefined` 로 둔다 — 추측하지 않는다.
      */
      const hm = String(env.data?.holdMode ?? '').toLowerCase();
      const holdMode = hm.includes('hedge') ? ('hedge' as const)
        : (hm.includes('one') ? ('one_way' as const) : undefined);
      return { ok: true, mode: 'unified', ...(holdMode ? { holdMode } : {}) };
    }
    if (String(env.code) === CODE_IS_CLASSIC) {
      /*
         ★ Classic 은 이 경로로 보유 모드를 알 수 없다. 호출자가 v2 계정 조회로
           따로 읽어야 한다 — 여기서 짐작해 채우지 않는다.
      */
      return { ok: true, mode: 'classic' };
    }
    return {
      ok: false,
      reason: classifyError(String(env.code)),
      detail: `${env.code}: ${env.msg || '(no message)'}`,
    };
  }

  /**
   * 자산.
   *
   * ★★★ 조회 실패를 **0 으로 바꾸지 않는다.** 0 은 "잔고가 없다" 는 뜻이고, 그것을 보면
   *   고객은 돈이 사라졌다고 생각한다.
   * ★ 실측: 잔고가 없는 계정은 `assets: []` 와 `usdtEquity: '0'` 을 준다 —
   *   **그것은 정상 응답이고 0 이 사실이다.** 실패와 구분된다.
   */
  async getAssets(cred: BitgetCredentials): Promise<{ usdtEquity: string; accountEquity: string; assets: V3Asset[] }> {
    const env = await this.signed<Record<string, unknown>>(cred, 'GET', '/api/v3/account/assets');
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget v3 자산 조회 실패 — ${env.code}: ${env.msg}`);
    }
    const d = env.data;
    const rows = Array.isArray(d.assets) ? (d.assets as Array<Record<string, unknown>>) : [];
    return {
      usdtEquity: String(d.usdtEquity ?? '0'),
      accountEquity: String(d.accountEquity ?? '0'),
      assets: rows.map((r) => ({
        coin: String(r.coin ?? ''),
        available: String(r.available ?? '0'),
        equity: String(r.equity ?? r.available ?? '0'),
        frozen: String(r.frozen ?? r.locked ?? '0'),
      })),
    };
  }

  /**
   * 보유 포지션.
   *
   * ★★★ `list` 가 **`null`** 로 온다(실측). `[]` 를 기대하면 터진다.
   * ★ 레버리지를 모르면 `null` 이다 — 1 로 두면 청산 위험을 작게 보이게 한다.
   */
  async getPositions(cred: BitgetCredentials): Promise<V3Position[]> {
    const env = await this.signed<V3List<Record<string, unknown>>>(
      cred, 'GET', '/api/v3/position/current-position', { category: V3_CATEGORY },
    );
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget v3 포지션 조회 실패 — ${env.code}: ${env.msg}`);
    }
    const rows = Array.isArray(env.data.list) ? env.data.list : [];
    const out: V3Position[] = [];
    for (const r of rows) {
      const size = Number(r.total ?? r.size ?? r.available ?? 0);
      /* ★ 수량 0 은 닫힌 포지션이다. 거래소가 그대로 돌려줄 수 있다. */
      if (!Number.isFinite(size) || size === 0) continue;
      const lev = Number(r.leverage);
      const str = (v: unknown): string | null => {
        if (v === null || v === undefined || v === '') return null;
        return Number.isFinite(Number(v)) ? String(v) : null;
      };
      out.push({
        symbol: String(r.symbol ?? ''),
        side: String(r.holdSide ?? r.side ?? '').toLowerCase() === 'short' ? 'short' : 'long',
        size: String(Math.abs(size)),
        entryPrice: str(r.openPriceAvg ?? r.averageOpenPrice ?? r.entryPrice),
        markPrice: str(r.markPrice),
        liquidationPrice: str(r.liquidationPrice),
        unrealisedPnl: str(r.unrealisedPnl ?? r.unrealizedPL),
        margin: str(r.marginSize ?? r.margin ?? r.im),
        leverage: Number.isFinite(lev) && lev > 0 ? lev : null,
        marginMode: String(r.marginMode ?? r.posMode ?? '').toLowerCase() === 'isolated' ? 'isolated' : 'cross',
      });
    }
    return out;
  }

  /** 미체결 주문 원본. 정규화는 어댑터가 한다. */
  async getUnfilledOrders(cred: BitgetCredentials, symbol?: string): Promise<Array<Record<string, unknown>>> {
    const env = await this.signed<V3List<Record<string, unknown>>>(
      cred, 'GET', '/api/v3/trade/unfilled-orders',
      { category: V3_CATEGORY, ...(symbol ? { symbol } : {}) },
    );
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget v3 미체결 조회 실패 — ${env.code}: ${env.msg}`);
    }
    return Array.isArray(env.data.list) ? env.data.list : [];
  }

  /** 주문 이력(체결·취소 포함). 주문 한 건을 찾을 때도 쓴다. */
  async getHistoryOrders(cred: BitgetCredentials, limit = 100): Promise<Array<Record<string, unknown>>> {
    const env = await this.signed<V3List<Record<string, unknown>>>(
      cred, 'GET', '/api/v3/trade/history-orders',
      { category: V3_CATEGORY, limit: Math.min(100, Math.max(1, limit)) },
    );
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget v3 주문 이력 조회 실패 — ${env.code}: ${env.msg}`);
    }
    return Array.isArray(env.data.list) ? env.data.list : [];
  }
}
