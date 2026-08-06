/**
 * KuCoin 공개 REST 클라이언트 (선물).
 *
 * 책임 범위:
 *  - HTTP 호출, 타임아웃, 재시도, KuCoin 응답 봉투(code/data) 해제
 *  - IP 단위 레이트리밋 보호 (KuCoin 공개 엔드포인트는 IP 기준)
 * 정규화는 adapter.js 가 담당한다. 이 파일은 원형(raw)에 가깝게 유지한다.
 */

import { config } from '../../config.js';
import { log } from '../../log.js';

const OK = '200000';

/** 동시 in-flight 요청 상한. KuCoin 429 를 피하기 위한 자체 게이트. */
const MAX_CONCURRENT = 6;
let inFlight = 0;
const waiters = [];

function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) {
    inFlight += 1;
    next();
  }
}

export class KucoinApiError extends Error {
  constructor(message, { code, httpStatus, path } = {}) {
    super(message);
    this.name = 'KucoinApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.path = path;
  }
}

/**
 * 공개 엔드포인트 호출.
 *
 * @param {string} path      '/api/v1/...' 형태
 * @param {object} [opts]
 * @param {object} [opts.query]
 * @param {string} [opts.method]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]  429/5xx/네트워크 오류에 대한 재시도 횟수
 */
export async function publicRequest(path, opts = {}) {
  const {
    query = {},
    method = 'GET',
    timeoutMs = 10000,
    retries = 2,
    base = config.kucoin.futuresRest,
  } = opts;

  const url = new URL(path, base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      // 지수 백오프 + 지터. 429 대응.
      const delay = Math.min(2000, 200 * 2 ** attempt) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, delay));
    }

    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      const text = await res.text();

      if (res.status === 429 || res.status >= 500) {
        lastError = new KucoinApiError(`KuCoin HTTP ${res.status}`, {
          httpStatus: res.status,
          path,
        });
        continue;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new KucoinApiError('KuCoin 응답이 JSON 이 아님', {
          httpStatus: res.status,
          path,
        });
      }

      if (json.code !== undefined && String(json.code) !== OK) {
        throw new KucoinApiError(json.msg || `KuCoin code ${json.code}`, {
          code: String(json.code),
          httpStatus: res.status,
          path,
        });
      }

      return json.data;
    } catch (err) {
      if (err instanceof KucoinApiError && err.code) throw err; // 업무 오류는 재시도 무의미
      lastError = err;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  log.warn('KuCoin 공개 REST 실패', { path, error: String(lastError?.message || lastError) });
  throw lastError instanceof Error
    ? lastError
    : new KucoinApiError('KuCoin 요청 실패', { path });
}

// ---------------------------------------------------------------------------
// 선물 공개 엔드포인트
// ---------------------------------------------------------------------------

/** 전체 활성 계약 목록. 계약 사양(multiplier/tickSize 등)의 원천. */
export function getActiveContracts() {
  return publicRequest('/api/v1/contracts/active', { timeoutMs: 20000 });
}

/** 단일 계약 상세. */
export function getContract(kucoinSymbol) {
  return publicRequest(`/api/v1/contracts/${encodeURIComponent(kucoinSymbol)}`);
}

/** 최근 체결 1건 기반 실시간 티커 (bestBid/bestAsk 포함). */
export function getTicker(kucoinSymbol) {
  return publicRequest('/api/v1/ticker', { query: { symbol: kucoinSymbol } });
}

/** 전 심볼 최신 체결/BBO 스냅샷 (679건). 24h 통계는 포함되지 않는다. */
export function getAllTickers() {
  return publicRequest('/api/v1/allTickers', { timeoutMs: 20000 });
}

/**
 * 참고: 선물에는 /api/v1/market/stats 가 없다 (404 확인, 2026-08-04).
 * 24시간 통계(highPrice / lowPrice / priceChgPct / volumeOf24h / turnoverOf24h)는
 * contracts/active 및 contracts/{symbol} 응답에 포함되어 있으므로 그쪽을 쓴다.
 */

/** 호가 20단. 오더북 위젯용. */
export function getDepth20(kucoinSymbol) {
  return publicRequest('/api/v1/level2/depth20', { query: { symbol: kucoinSymbol } });
}

/** 호가 100단. */
export function getDepth100(kucoinSymbol) {
  return publicRequest('/api/v1/level2/depth100', { query: { symbol: kucoinSymbol } });
}

/** 최근 체결 목록 (최대 100건). */
export function getTradeHistory(kucoinSymbol) {
  return publicRequest('/api/v1/trade/history', { query: { symbol: kucoinSymbol } });
}

/**
 * 캔들 조회.
 *
 * 응답 배열 필드 순서 (2026-08-04 실측 확인):
 *   [ timeMs, open, high, low, close, volumeContracts, turnoverUSDT ]
 *
 * 주의: WebSocket limitCandle 채널은 순서가 다르다 ([t, o, c, h, l, turnover, vol]).
 * 두 경로를 섞어 쓰면 차트가 조용히 깨진다. adapter.js 에서 각각 별도 파서를 쓴다.
 *
 * @param {string} kucoinSymbol
 * @param {number} granularity 분 단위
 * @param {number} [fromMs]
 * @param {number} [toMs]
 */
export function getKlines(kucoinSymbol, granularity, fromMs, toMs) {
  return publicRequest('/api/v1/kline/query', {
    query: { symbol: kucoinSymbol, granularity, from: fromMs, to: toMs },
    timeoutMs: 15000,
  });
}

/** 현재 펀딩비율. */
export function getFundingRate(kucoinSymbol) {
  return publicRequest(`/api/v1/funding-rate/${encodeURIComponent(kucoinSymbol)}/current`);
}

/** 서버 시각 (ms). 시계 드리프트 점검용. */
export function getServerTime() {
  return publicRequest('/api/v1/timestamp');
}

/** 서비스 상태. open | close | cancelonly */
export function getServiceStatus() {
  return publicRequest('/api/v1/status');
}

/**
 * 공개 WebSocket 접속 토큰 발급. POST 여야 한다 (GET 은 405).
 * 반환: { token, instanceServers: [{ endpoint, pingInterval, pingTimeout, ... }] }
 */
export function createPublicBullet() {
  return publicRequest('/api/v1/bullet-public', { method: 'POST', retries: 3 });
}
