/**
 * KuCoin 선물 공개 REST 클라이언트.
 *
 * 책임: HTTP 호출, 레이트리밋, 재시도, KuCoin 응답 봉투(code/data) 해제.
 * 정규화는 normalize.ts 가 담당한다. 여기서는 원형에 가깝게 유지한다.
 *
 * 레이트리밋은 @quantumtrade/exchange-adapters 의 TokenBucket + CircuitBreaker 를
 * 재사용한다. 새로 만들지 않는 이유: 이미 테스트된 구현이 있고, 거래소마다
 * 다른 리미터를 두면 운영 시 동작을 예측하기 어려워진다.
 *
 * KuCoin 공개 엔드포인트 제한 (문서): IP 기준. contracts/active·kline·depth 는
 * 12회/2초. 우리 기본값(maxRps 5)은 그 안에 넉넉히 들어간다.
 */

import { DEFAULT_BITMART_RATE_LIMIT, type RateLimitConfig } from '@quantumtrade/config';
import { CircuitBreaker, TokenBucket, backoffMs, retryAfterMs } from '@quantumtrade/exchange-adapters';

const OK_CODE = '200000';

/** KuCoin 공개 엔드포인트에 맞춘 기본 레이트리밋. */
export const DEFAULT_KUCOIN_RATE_LIMIT: RateLimitConfig = {
  ...DEFAULT_BITMART_RATE_LIMIT,
  // 문서상 12회/2초 = 6rps. 여유를 두어 5rps.
  maxRps: 5,
  burst: 10,
};

export class KucoinApiError extends Error {
  constructor(
    message: string,
    readonly detail: {
      code?: string;
      httpStatus?: number;
      path?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'KucoinApiError';
  }
}

/**
 * 선물 REST 기본 호스트.
 *
 * 기본값을 두는 이유: 생략하면 `new URL(path, undefined)` 가 되어 'Invalid URL' 로
 * 터진다. 원인 추적이 어려운 실패라 실제로 겪었다 (scripts/subscribed-freshness.ts).
 * 운영에서는 env 로 넘기고, 스크립트·테스트에서는 이 기본값을 쓴다.
 */
export const DEFAULT_KUCOIN_FUTURES_REST = 'https://api-futures.kucoin.com';

export interface KucoinRestConfig {
  /** 예: https://api-futures.kucoin.com. 생략하면 DEFAULT_KUCOIN_FUTURES_REST. */
  restBase?: string;
  rateLimit?: RateLimitConfig;
  /** 테스트에서 주입 가능. 기본은 global fetch. */
  fetchImpl?: typeof fetch;
  /** 요청 타임아웃(ms) */
  timeoutMs?: number;
  /** 재시도 횟수 (429/5xx/네트워크 오류에 대해서만) */
  retries?: number;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export class KucoinFuturesRest {
  private readonly bucket: TokenBucket;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  private readonly restBase: string;

  constructor(private readonly cfg: KucoinRestConfig) {
    // 빈 문자열도 걸러낸다. env 가 비어 있을 때 조용히 통과하면 안 된다.
    this.restBase = cfg.restBase?.trim() || DEFAULT_KUCOIN_FUTURES_REST;
    let parsed: URL;
    try {
      parsed = new URL(this.restBase);
    } catch {
      throw new Error(`restBase 가 올바른 URL 이 아니다: ${JSON.stringify(cfg.restBase)}`);
    }
    // 스킴까지 본다. 'httpx://host' 는 URL 로는 유효하지만 fetch 에서 실패한다.
    // 부팅 때 거부하면 배포 즉시 드러나고, 첫 주문 때 터지는 것보다 안전하다.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(
        `restBase 는 http(s) 여야 한다: ${JSON.stringify(cfg.restBase)} (스킴=${parsed.protocol})`,
      );
    }

    const rl = cfg.rateLimit ?? DEFAULT_KUCOIN_RATE_LIMIT;
    this.bucket = new TokenBucket(rl);
    this.breaker = new CircuitBreaker(rl);
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch 구현이 없다. Node 18+ 또는 fetchImpl 주입이 필요하다.');
    }
  }

  get breakerState(): string {
    return this.breaker.state;
  }

  /** 공개 엔드포인트 호출. 성공 시 KuCoin 응답의 `data` 를 반환한다. */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const rl = this.cfg.rateLimit ?? DEFAULT_KUCOIN_RATE_LIMIT;
    const retries = opts.retries ?? this.cfg.retries ?? 2;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs ?? 12000;

    const url = new URL(path, this.restBase);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (!this.breaker.canRequest()) {
        throw new KucoinApiError('KuCoin 회로차단기 열림 — 요청 보류', {
          path,
          retryable: true,
        });
      }

      if (attempt > 0) {
        await sleep(backoffMs(attempt - 1, rl));
      }

      // 토큰이 없으면 확보될 때까지 기다린다. 즉시 실패시키면 화면이 비어버린다.
      let waited = 0;
      while (!this.bucket.tryRemove()) {
        const wait = Math.max(10, this.bucket.msUntilAvailable());
        waited += wait;
        if (waited > 5000) {
          throw new KucoinApiError('KuCoin 레이트리밋 대기 초과', { path, retryable: true });
        }
        await sleep(wait);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const res = await this.fetchImpl(url, {
          method: opts.method ?? 'GET',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });

        const text = await res.text();

        if (res.status === 429 || res.status >= 500) {
          this.breaker.onFailure();
          const retryAfter = retryAfterMs(res.headers.get('retry-after'));
          if (retryAfter) await sleep(Math.min(retryAfter, rl.backoffMaxMs));
          lastError = new KucoinApiError(`KuCoin HTTP ${res.status}`, {
            httpStatus: res.status,
            path,
            retryable: true,
          });
          continue;
        }

        let json: { code?: string | number; data?: T; msg?: string };
        try {
          json = JSON.parse(text) as typeof json;
        } catch {
          this.breaker.onFailure();
          throw new KucoinApiError('KuCoin 응답이 JSON 이 아님', {
            httpStatus: res.status,
            path,
          });
        }

        if (json.code !== undefined && String(json.code) !== OK_CODE) {
          // 업무 오류(잘못된 심볼 등)는 재시도해도 같은 결과다.
          this.breaker.onSuccess();
          throw new KucoinApiError(json.msg ?? `KuCoin code ${String(json.code)}`, {
            code: String(json.code),
            httpStatus: res.status,
            path,
            retryable: false,
          });
        }

        this.breaker.onSuccess();
        return json.data as T;
      } catch (err) {
        if (err instanceof KucoinApiError && err.detail.retryable === false) throw err;
        this.breaker.onFailure();
        lastError = err;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new KucoinApiError('KuCoin 요청 실패', { path });
  }

  // -------------------------------------------------------------------------
  // 엔드포인트
  // -------------------------------------------------------------------------

  /**
   * 전체 활성 계약. 계약 사양(multiplier/tickSize)과 24h 통계를 한 번에 준다.
   *
   * 심볼별로 getTicker 를 664번 돌리는 대신 이 호출 하나를 쓴다. 거래소가
   * 이미 한 응답에 다 담아주는 데이터를 664번 왕복으로 받으면 레이트리밋을
   * 순식간에 소진한다.
   */
  getActiveContracts(signal?: AbortSignal) {
    return this.request<unknown[]>('/api/v1/contracts/active', { timeoutMs: 20000, signal });
  }

  getContract(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown>(`/api/v1/contracts/${encodeURIComponent(kucoinSymbol)}`, { signal });
  }

  /** 최근 체결 1건 + 최우선 호가. 24h 통계는 포함되지 않는다. */
  getTicker(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown>('/api/v1/ticker', { query: { symbol: kucoinSymbol }, signal });
  }

  getDepth20(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown>('/api/v1/level2/depth20', { query: { symbol: kucoinSymbol }, signal });
  }

  getDepth100(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown>('/api/v1/level2/depth100', { query: { symbol: kucoinSymbol }, signal });
  }

  /** 최근 체결 목록 (최대 100건). */
  getTradeHistory(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown[]>('/api/v1/trade/history', { query: { symbol: kucoinSymbol }, signal });
  }

  /**
   * 캔들. 반드시 200행 이하로 요청해야 한다 (klines.ts 주석 참조).
   * 응답 행 순서: [ timeMs, open, high, low, close, volumeContracts, turnoverUSDT ]
   */
  getKlines(
    kucoinSymbol: string,
    granularity: number,
    fromMs?: number,
    toMs?: number,
    signal?: AbortSignal,
  ) {
    return this.request<Array<Array<number | string>>>('/api/v1/kline/query', {
      query: { symbol: kucoinSymbol, granularity, from: fromMs, to: toMs },
      timeoutMs: 15000,
      signal,
    });
  }

  getFundingRate(kucoinSymbol: string, signal?: AbortSignal) {
    return this.request<unknown>(
      `/api/v1/funding-rate/${encodeURIComponent(kucoinSymbol)}/current`,
      { signal },
    );
  }

  getServerTime(signal?: AbortSignal) {
    return this.request<number>('/api/v1/timestamp', { signal });
  }

  /** 서비스 상태: open | close | cancelonly */
  getServiceStatus(signal?: AbortSignal) {
    return this.request<{ status?: string; msg?: string }>('/api/v1/status', { signal });
  }

  /**
   * 공개 WebSocket 접속 토큰. POST 여야 한다 (GET 은 405).
   * 재시도를 넉넉히 준다 — 이게 실패하면 실시간 데이터가 아예 안 온다.
   */
  createPublicBullet(signal?: AbortSignal) {
    return this.request<{
      token: string;
      instanceServers: Array<{
        endpoint: string;
        pingInterval?: number;
        pingTimeout?: number;
        encrypt?: boolean;
        protocol?: string;
      }>;
    }>('/api/v1/bullet-public', { method: 'POST', retries: 3, signal });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
