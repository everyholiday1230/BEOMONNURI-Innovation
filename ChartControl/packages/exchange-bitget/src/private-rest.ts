/**
 * Bitget 사적 REST — **읽기 전용**.
 *
 * ★★★ **주문·취소·자금 이동 경로가 이 파일에 없다.** 새 거래소를 붙이는 첫 단계에서
 *   쓰기를 넣지 않는다. 서명이나 수량 단위를 잘못 이해했을 때, 읽기는 틀린 숫자를
 *   보여주는 것으로 끝나지만 쓰기는 **고객 돈을 움직인다.**
 *   주문은 읽기가 실계정으로 검증된 뒤에 별도로 붙인다.
 *
 * ★★ 이 파일은 비밀을 **받아서 쓰기만** 한다. 저장하지 않고, 로그로 찍지 않는다.
 */
import { BITGET_BASE, BITGET_OK, type BitgetEnvelope, type FetchImpl } from './rest.js';
import { authHeaders, type BitgetCredentials, type HttpMethod } from './signature.js';
import { PRODUCT_TYPE } from './symbols.js';

export interface BitgetPrivateOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  now?: () => number;
}

/** 자격증명 검증 결과. */
export type VerifyResult =
  | { ok: true; canRead: true; accountCount: number }
  /*
     ★★ 실패를 한 덩어리로 다루지 않는다. 고객이 할 일이 다르다:
       · BAD_CREDENTIAL — 키를 다시 확인해야 한다
       · IP_BLOCKED     — 거래소에서 IP 제한을 풀거나 우리 IP 를 등록해야 한다
       · NO_PERMISSION  — 읽기 권한을 켜야 한다
       · UPSTREAM       — 우리도 고객도 할 일이 없다. 잠시 뒤 다시.
  */
  | { ok: false; reason: 'BAD_CREDENTIAL' | 'IP_BLOCKED' | 'NO_PERMISSION' | 'UPSTREAM'; detail: string };

/** 포지션 한 건 (읽기). */
export interface BitgetPosition {
  symbol: string;
  side: 'long' | 'short';
  /** 계약 수량(기준통화). */
  size: string;
  entryPrice: string | null;
  markPrice: string | null;
  liquidationPrice: string | null;
  unrealisedPnl: string | null;
  /** 포지션 증거금. */
  margin: string | null;
  /** 레버리지. 거래소가 주지 않으면 null — 1 로 두지 않는다. */
  leverage: number | null;
  marginMode: 'cross' | 'isolated';
}

export class BitgetPrivateRest {
  private readonly base: string;

  private readonly fetchImpl: FetchImpl;

  private readonly timeoutMs: number;

  private readonly now: () => number;

  constructor(opts: BitgetPrivateOptions = {}) {
    this.base = (opts.baseUrl ?? BITGET_BASE).replace(/\/+$/u, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * 서명된 GET.
   *
   * ★ 쿼리를 **서명에 쓰는 문자열과 실제 URL 에서 똑같이** 만든다. 순서가 달라지면
   *   서명이 맞지 않는다 — 한 곳에서 만들어 둘 다에 쓴다.
   */
  private async signedGet<T>(
    cred: BitgetCredentials,
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<BitgetEnvelope<T>> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const requestPath = `${path}${qs ? `?${qs}` : ''}`;
    const method: HttpMethod = 'GET';
    const headers = authHeaders(cred, method, requestPath, '', this.now);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}${requestPath}`, { method, headers, signal: ac.signal });
      const text = await res.text();
      try {
        return JSON.parse(text) as BitgetEnvelope<T>;
      } catch {
        /*
           ★ JSON 이 아니면 봉투를 만들어 돌려준다 — 던지면 호출자가 이유를 잃는다.
             HTML 오류 페이지(프록시·WAF)가 올 수 있다.
        */
        return {
          code: `HTTP_${res.status}`,
          msg: text.slice(0, 200),
          requestTime: this.now(),
          data: null,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 자격증명 검증 — **읽기만 해 본다.**
   *
   * ★★★ 계정 목록을 한 번 읽는다. 성공하면 키가 살아 있고 읽기 권한이 있다는 뜻이다.
   *   주문을 내 보는 방식으로 검증하지 않는다 — 검증이 고객 돈을 움직여서는 안 된다.
   */
  async verify(cred: BitgetCredentials): Promise<VerifyResult> {
    let env: BitgetEnvelope<unknown[]>;
    try {
      env = await this.signedGet<unknown[]>(cred, '/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    } catch (e) {
      return { ok: false, reason: 'UPSTREAM', detail: (e as Error).message.slice(0, 200) };
    }
    if (env.code === BITGET_OK) {
      const n = Array.isArray(env.data) ? env.data.length : 0;
      return { ok: true, canRead: true, accountCount: n };
    }
    /*
       ★★ 실측으로 확인한 코드들. 모르는 코드는 UPSTREAM 으로 둔다 —
         BAD_CREDENTIAL 이라고 단정하면 고객이 멀쩡한 키를 지운다.
         · 40006 Invalid ACCESS_KEY  · 40037 Apikey does not exist
         · 40009 signature error     · 40012 apikey/password is incorrect
         · 40018 illegal IP          · 40014 insufficient permissions
    */
    const code = String(env.code);
    const BAD = new Set(['40006', '40037', '40009', '40012', '40011', '40013']);
    const IP = new Set(['40018']);
    const PERM = new Set(['40014', '40016']);
    const detail = `${code}: ${env.msg || '(no message)'}`;
    if (IP.has(code)) return { ok: false, reason: 'IP_BLOCKED', detail };
    if (PERM.has(code)) return { ok: false, reason: 'NO_PERMISSION', detail };
    if (BAD.has(code)) return { ok: false, reason: 'BAD_CREDENTIAL', detail };
    return { ok: false, reason: 'UPSTREAM', detail };
  }

  /**
   * 잔고 — USDT 단일 통화.
   *
   * ★ 값을 못 구하면 **0 을 돌려주지 않는다.** 0 은 "잔고가 없다" 는 뜻이고, 조회
   *   실패와 전혀 다르다. 던져서 호출자가 '측정 불가' 로 다루게 한다.
   */
  async getAvailableUsdt(cred: BitgetCredentials): Promise<string> {
    const env = await this.signedGet<Array<Record<string, unknown>>>(
      cred,
      '/api/v2/mix/account/accounts',
      { productType: PRODUCT_TYPE },
    );
    if (env.code !== BITGET_OK || !Array.isArray(env.data)) {
      throw new Error(`bitget 잔고 조회 실패 — ${env.code}: ${env.msg}`);
    }
    const usdt = env.data.find((r) => String(r.marginCoin ?? '').toUpperCase() === 'USDT');
    if (!usdt) throw new Error('bitget: USDT 계정을 찾지 못했다');
    const v = usdt.available ?? usdt.crossedMaxAvailable ?? null;
    if (v === null || v === undefined) throw new Error('bitget: 가용 잔고 필드가 없다');
    return String(v);
  }

  /**
   * 미체결 주문 (Classic).
   *
   * ★★★ 실키로 검증하지 못했다 — 운영자 계정이 UTA 라서 v2 는 `40085` 로 막힌다.
   *   그래도 **읽기**이므로 틀리면 조회가 실패할 뿐이고 고객 돈이 움직이지 않는다.
   * ★★ 실패를 **빈 배열로 바꾸지 않는다.** 빈 배열은 "미체결 주문이 없다" 는 뜻이고,
   *   고객은 주문이 취소된 줄 안다. 던져서 호출자가 '조회 불가' 로 다루게 한다.
   */
  async getUnfilledOrders(cred: BitgetCredentials, symbol?: string): Promise<Array<Record<string, unknown>>> {
    const env = await this.signedGet<unknown>(
      cred, '/api/v2/mix/order/orders-pending',
      { productType: PRODUCT_TYPE, ...(symbol ? { symbol } : {}) },
    );
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget(classic) 미체결 조회 실패 — ${env.code}: ${env.msg}`);
    }
    /*
       ★ v2 는 `{ entrustedList }` 로 감싸 준다(v3 의 `{ list }` 와 이름이 다르다).
         둘 다 받아 둔다 — 어느 쪽이 와도 동작해야 한다.
       ★★ `null` 로 올 수 있다(v3 에서 실측). `[]` 를 기대하면 터진다.
    */
    const d = env.data as Record<string, unknown>;
    const rows = d.entrustedList ?? d.list ?? d;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  /**
   * 주문 이력 (Classic).
   *
   * ★ 주문 한 건을 `clientOid` 로 찾을 때 쓴다. 미체결에 없으면 여기서 찾는다 —
   *   이력만 보면 아직 미체결인 주문을 "없다" 고 판단한다.
   */
  async getHistoryOrders(cred: BitgetCredentials, limit = 100): Promise<Array<Record<string, unknown>>> {
    const env = await this.signedGet<unknown>(
      cred, '/api/v2/mix/order/orders-history',
      { productType: PRODUCT_TYPE, limit: Math.min(100, Math.max(1, limit)) },
    );
    if (env.code !== BITGET_OK || !env.data) {
      throw new Error(`bitget(classic) 주문 이력 조회 실패 — ${env.code}: ${env.msg}`);
    }
    const d = env.data as Record<string, unknown>;
    const rows = d.entrustedList ?? d.list ?? d;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  /**
   * 보유 포지션.
   *
   * ★★★ 레버리지를 **모르면 null** 이다. 1 로 두면 청산 위험을 실제보다 작게 보이게
   *   한다 — KuCoin 에서 실제로 그 문제를 겪었다.
   * ★ 수량 0 인 행은 버린다 — 닫힌 포지션을 거래소가 그대로 돌려줄 수 있다.
   */
  async getPositions(cred: BitgetCredentials): Promise<BitgetPosition[]> {
    const env = await this.signedGet<Array<Record<string, unknown>>>(
      cred,
      '/api/v2/mix/position/all-position',
      { productType: PRODUCT_TYPE, marginCoin: 'USDT' },
    );
    if (env.code !== BITGET_OK || !Array.isArray(env.data)) {
      throw new Error(`bitget 포지션 조회 실패 — ${env.code}: ${env.msg}`);
    }
    const out: BitgetPosition[] = [];
    for (const r of env.data) {
      const size = Number(r.total ?? r.available ?? 0);
      if (!Number.isFinite(size) || size === 0) continue;
      const lev = Number(r.leverage);
      const str = (v: unknown): string | null => {
        if (v === null || v === undefined || v === '') return null;
        return Number.isFinite(Number(v)) ? String(v) : null;
      };
      out.push({
        symbol: String(r.symbol ?? ''),
        side: String(r.holdSide ?? '').toLowerCase() === 'short' ? 'short' : 'long',
        size: String(Math.abs(size)),
        entryPrice: str(r.openPriceAvg),
        markPrice: str(r.markPrice),
        liquidationPrice: str(r.liquidationPrice),
        unrealisedPnl: str(r.unrealizedPL),
        margin: str(r.marginSize),
        leverage: Number.isFinite(lev) && lev > 0 ? lev : null,
        marginMode: String(r.marginMode ?? '').toLowerCase() === 'isolated' ? 'isolated' : 'cross',
      });
    }
    return out;
  }
}
