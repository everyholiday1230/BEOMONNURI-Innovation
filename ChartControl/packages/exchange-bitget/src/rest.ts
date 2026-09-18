/**
 * Bitget 공개 REST — 요청 한 곳.
 *
 * ★ 인증이 필요한 경로는 여기 없다(`private-rest.ts`). 공개 데이터만 다루면
 *   비밀이 흐르지 않고, 실패해도 고객 자산과 무관하다.
 */

/** 공개 API 기준 주소. */
export const BITGET_BASE = 'https://api.bitget.com';

export type FetchImpl = typeof fetch;

export interface BitgetRestOptions {
  baseUrl?: string;
  /*
     ★★ 주입 가능하게 둔다. 시험에서 실제 호출을 하지 않기 위한 것도 있지만,
       더 중요한 것은 **비트겟 요청만 프록시를 태울 수 있어야** 한다는 것이다
       (FastApi 는 고정 IP 를 요구한다 — `docs/BITGET-FASTAPI-INTEGRATION.md`).
       전역 프록시를 쓰면 잘 돌고 있는 KuCoin 경로에도 실패 지점이 생긴다.
  */
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/**
 * Bitget 응답 봉투.
 *
 * ★★★ **HTTP 200 이어도 실패일 수 있다.** Bitget 은 오류를 본문 `code` 로 준다
 *   (예: 잘못된 granularity → 200 + `code: '40034'`). `res.ok` 만 보면 오류를
 *   정상 데이터로 다루게 된다 — 실측으로 확인했다.
 */
export interface BitgetEnvelope<T> {
  code: string;
  msg: string;
  requestTime: number;
  data: T | null;
}

/** 성공 코드. Bitget 은 `'00000'` 하나만 성공이다. */
export const BITGET_OK = '00000';

export class BitgetPublicRest {
  private readonly base: string;

  private readonly fetchImpl: FetchImpl;

  private readonly timeoutMs: number;

  constructor(opts: BitgetRestOptions = {}) {
    this.base = (opts.baseUrl ?? BITGET_BASE).replace(/\/+$/u, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * GET 한 번.
   *
   * ★★ 시간 제한을 둔다. 없으면 거래소가 응답하지 않을 때 요청이 영원히 매달려
   *   화면이 로딩에서 끝나지 않는다.
   * ★ 바깥 `signal` 과 우리 시간 제한을 **둘 다** 받는다 — 화면이 취소한 요청은
   *   즉시 끊어야 한다(최신 요청만 살린다).
   */
  async get<T>(path: string, query: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    const onAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await this.fetchImpl(url, {
        signal: ac.signal,
        headers: { accept: 'application/json' },
      });
      /*
         ★ HTTP 오류도 본문을 읽어 본다 — Bitget 이 이유를 본문에 담는다. 상태 코드만
           보고 던지면 "왜" 를 잃는다.
      */
      const text = await res.text();
      let body: BitgetEnvelope<T>;
      try {
        body = JSON.parse(text) as BitgetEnvelope<T>;
      } catch {
        throw new Error(`bitget: 응답이 JSON 이 아니다 (HTTP ${res.status}): ${text.slice(0, 160)}`);
      }
      /*
         ★★★ `code` 를 본다. 200 + 오류 코드 조합이 실제로 온다(잘못된 granularity).
           `res.ok` 만 보면 오류를 정상으로 다룬다.
      */
      if (body.code !== BITGET_OK) {
        throw new Error(`bitget ${body.code}: ${body.msg || '(no message)'} [${path}]`);
      }
      if (body.data === null || body.data === undefined) {
        throw new Error(`bitget: data 가 비어 있다 [${path}]`);
      }
      return body.data;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}
