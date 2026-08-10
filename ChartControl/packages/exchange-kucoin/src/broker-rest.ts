import { buildAuthHeaders, type BrokerCredentials, type UserCredentials } from './signature.js';

/**
 * KuCoin 브로커 정산 조회 (API Broker / Broker Pro).
 *
 * 왜 별 파일인가
 * ------------
 * ★★ **스팟 도메인을 쓴다.** 모든 브로커 조회 경로가 `api.kucoin.com` 에 있고,
 *   주문·잔고에 쓰는 선물 도메인(`api-futures.kucoin.com`)에는 없다.
 *   `KucoinFuturesPrivate` 에 넣으면 base URL 이 하나뿐이라 잘못된 도메인으로
 *   요청이 나가고 404 를 받는다.
 *
 * ★ 공식 문서(`docs-new/introduction`)는 "Broker REST: https://api-broker.kucoin.com"
 *   을 별도로 안내한다. 그래서 그 도메인이 맞아 보이지만, **우리가 쓰는 경로는
 *   거기에 없다.** 두 도메인에 직접 요청해 확인한 결과(2026-08-10):
 *
 *     경로                                  api.kucoin.com   api-broker.kucoin.com
 *     /api/v2/broker/queryMyCommission      400 (경로 있음)   404
 *     /api/v2/broker/queryUser              400 (경로 있음)   404
 *     /api/v2/broker/queryDetailByUid       400 (경로 있음)   404
 *     /api/v2/broker/api/rebate/download    400 (경로 있음)   404
 *     /api/v1/broker/nd/info                404              400 (경로 있음)
 *
 *   400 은 "인증 헤더가 없다"(400001)이므로 **경로가 존재한다는 뜻**이다.
 *   즉 KuCoin 브로커는 두 종류이고 도메인이 갈린다:
 *     · Broker Pro (API Broker) — 우리가 쓰는 `/broker/api/*`, `query*` → api.kucoin.com
 *     · Exchange Broker         — `/broker/nd/*` (하위계정 발급형) → api-broker.kucoin.com
 *   우리는 사용자가 **자기 키로** 거래하는 형태이므로 Broker Pro 가 맞다.
 *   도메인을 바꾸면 전부 404 가 되므로 이 실측 기록을 남긴다.
 *
 * 무엇을 확인할 수 있나
 * -------------------
 * 우리 수익은 "사용자가 우리를 통해 낸 주문에 브로커 서명이 붙었는가" 로 결정된다.
 * 이 API 들이 그 결과를 알려준다:
 *
 *   · getCommission()   — 정산 주기별 커미션. 실제로 우리에게 지급될 금액.
 *   · getUserList()     — 우리를 통해 거래하는 사용자와 각자의 기여
 *   · getUserTransactions() — 사용자별 일자 내역 (커서 페이지네이션)
 *   · getRebateCsvUrl() — 원장 CSV 다운로드 링크
 *
 * ★★ 응답의 `...WithTag` / `...WithoutTag` 구분이 핵심이다.
 *   **Tag 가 붙은 거래만 우리 브로커 실적으로 집계된다.** 서명이 빠진 주문은
 *   `WithoutTag` 로 들어가고 커미션이 다르다(또는 없다). 즉 이 두 값을 비교하면
 *   "서명이 실제로 붙고 있는가" 를 사후 확인할 수 있다 — 주문 응답의
 *   `brokerAttached` 는 우리 쪽 주장이고, 이 값은 거래소의 판정이다.
 *
 * ★ 출금(`POST /api/v2/broker/withdrawal`)은 **구현하지 않는다.**
 *   이 서비스는 고객 자금을 보관하지 않고 출금 기능을 제공하지 않기로 했다.
 *   그 경로를 만들어두면 권한을 가진 키가 유출될 때 자금이 나갈 수 있다.
 */

/** 브로커 조회 기본 도메인. 선물 도메인이 아니다. */
export const DEFAULT_KUCOIN_SPOT_REST = 'https://api.kucoin.com';

export interface KucoinBrokerConfig {
  /** 기본값: https://api.kucoin.com (스팟 도메인) */
  restBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 거래 종류 필터. KuCoin 이 받는 값만 둔다. */
export type BrokerTradeType = 'all' | 'SPOT' | 'FUTURES';

export interface BrokerCommissionRow {
  /** 사이트(지역). 기본 global, 예: europe */
  siteType: string | null;
  rebateType: number | null;
  /** 지급 시각 (epoch ms). 아직 지급되지 않았으면 null. */
  payoutTime: number | null;
  periodStartTime: number | null;
  periodEndTime: number | null;
  /** KuCoin 의 정산 상태 코드. 의미를 우리가 정하지 않고 그대로 전달한다. */
  status: number | null;
  totalTradeUser: string | null;
  tagUser: string | null;
  /** 브로커 서명이 붙은 거래의 거래량·커미션 — 이것이 우리 실적이다. */
  tagTradeVolume: string | null;
  tagCommission: string | null;
  invitedUser: string | null;
  /** 서명이 붙지 않은 거래. 이 값이 크면 서명이 새고 있다는 뜻이다. */
  noTagTradeVolume: string | null;
  noTagCommission: string | null;
  totalCommission: string | null;
  currency: string | null;
}

export interface BrokerUserRow {
  uid: string;
  nickName: string | null;
  registrationTime: number | null;
  rateUp: boolean | null;
  totalCommission: string | null;
  totalTradingVolume: string | null;
  totalFee: string | null;
  invitedByMe: boolean | null;
  /** 추천 코드. 브로커 태그와 별개다. */
  rcode: string | null;
  tags: string | null;
  spotTradingVolumeWithTag: string | null;
  futuresTradingVolumeWithTag: string | null;
  tradingFeeWithTag: string | null;
  commissionWithTag: string | null;
  spotTradingVolumeWithoutTag: string | null;
  futuresTradingVolumeWithoutTag: string | null;
  tradingFeeWithoutTag: string | null;
  commissionWithoutTag: string | null;
  currency: string | null;
}

export interface BrokerUserTransactionRow {
  tradeTime: number | null;
  uid: string;
  nickName: string | null;
  invitedByMe: boolean | null;
  totalCommission: string | null;
  totalVolume: string | null;
  totalFee: string | null;
  rcode: string | null;
  spotTradingVolumeWithTag: string | null;
  futuresTradingVolumeWithTag: string | null;
  tradingFeeWithTag: string | null;
  commissionWithTag: string | null;
  spotTradingVolumeWithoutTag: string | null;
  futuresTradingVolumeWithoutTag: string | null;
  tradingFeeWithoutTag: string | null;
  commissionWithoutTag: string | null;
  currency: string | null;
  /** 다음 페이지 커서. 마지막 행의 값을 다음 요청의 lastId 로 보낸다. */
  lastId: string | null;
}

export interface BrokerPage<T> {
  items: T[];
  currentPage: number | null;
  pageSize: number | null;
  totalNum: number | null;
  totalPage: number | null;
}

export class KucoinBrokerError extends Error {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  constructor(message: string, meta: { code?: string; httpStatus?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'KucoinBrokerError';
    this.code = meta.code;
    this.httpStatus = meta.httpStatus;
    this.retryable = meta.retryable ?? false;
  }
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : Boolean(v);

/**
 * `WithoutTag` 와 `WithNoTag` 를 모두 받는다.
 *
 * ★ KuCoin 응답에 두 이름이 **함께** 나온다(`spotTradingVolumeWithNoTag` 와
 *   `spotTradingVolumeWithoutTag`). 필드명을 바꾸는 중인 것으로 보이고, 값이
 *   한쪽에만 들어오는 경우가 있다. 한 이름만 읽으면 조용히 null 이 된다.
 */
const eitherTag = (row: Record<string, unknown>, base: string): string | null =>
  str(row[`${base}WithoutTag`]) ?? str(row[`${base}WithNoTag`]);

/**
 * `future...` 와 `futures...` 를 모두 받는다.
 *
 * ★ 같은 응답에 `futureTradingVolumeWithTag` 와 `futuresTradingVolumeWithTag` 가
 *   함께 있다(단수/복수). 우리는 선물 브로커이므로 이 값을 놓치면 실적이 0 으로
 *   보인다.
 */
const eitherFutures = (row: Record<string, unknown>, suffix: string): string | null =>
  str(row[`futuresTradingVolume${suffix}`]) ?? str(row[`futureTradingVolume${suffix}`]);

export class KucoinBrokerClient {
  private readonly restBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(cfg: KucoinBrokerConfig = {}) {
    this.restBase = cfg.restBase?.trim() || DEFAULT_KUCOIN_SPOT_REST;
    let parsed: URL;
    try {
      parsed = new URL(this.restBase);
    } catch {
      throw new Error(`restBase 가 올바른 URL 이 아니다: ${JSON.stringify(cfg.restBase)}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`restBase 는 http(s) 여야 한다: ${JSON.stringify(cfg.restBase)}`);
    }
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch 구현이 없다. Node 18+ 또는 fetchImpl 주입이 필요하다.');
    }
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  /**
   * 서명된 GET.
   *
   * ★ 브로커 조회는 **운영자 자신의 키**로 인증한다. 사용자 키가 아니다 —
   *   우리 브로커 실적을 우리가 조회하는 것이므로, 사용자 자격증명을 여기
   *   넘기면 그 사용자의 브로커 실적(없음)을 조회하게 된다.
   *
   * ★ 브로커 파트너 헤더도 함께 붙인다. 문서상 필수라고 명시되지는 않았지만,
   *   브로커 전용 경로이므로 파트너 식별이 있는 편이 안전하다. 자격증명이
   *   없으면 buildAuthHeaders 가 조용히 생략한다.
   */
  private async get<T>(
    operator: UserCredentials,
    broker: Partial<BrokerCredentials> | null,
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      // 빈 값을 보내지 않는다. KuCoin 이 빈 문자열을 필터로 해석하는 경우가 있다.
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const requestPath = qs.toString() ? `${path}?${qs.toString()}` : path;

    const headers = buildAuthHeaders({
      user: operator,
      method: 'GET',
      requestPath,
      body: '',
      broker,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(new URL(requestPath, this.restBase), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const text = await res.text();
      let json: { code?: string; msg?: string; data?: unknown } | null = null;
      try {
        json = JSON.parse(text) as { code?: string; msg?: string; data?: unknown };
      } catch {
        throw new KucoinBrokerError(`응답이 JSON 이 아니다 (HTTP ${res.status})`, {
          httpStatus: res.status,
          retryable: res.status >= 500,
        });
      }
      if (!res.ok || (json.code && json.code !== '200000')) {
        /*
           자격증명·권한 오류는 재시도해도 같다.

           ★ 브로커 경로는 **브로커로 승인된 계정만** 접근할 수 있다. 승인되지
             않은 키로 부르면 권한 오류가 온다 — 그것은 장애가 아니라 "아직
             브로커가 아니다" 라는 사실이므로 그대로 전달해야 한다.
        */
        const authFailure =
          res.status === 401 ||
          res.status === 403 ||
          json.code === '400003' ||
          json.code === '400004' ||
          json.code === '400005' ||
          json.code === '400007' ||
          json.code === '400100';
        throw new KucoinBrokerError(json.msg || `KuCoin 브로커 API 오류 (HTTP ${res.status})`, {
          code: json.code,
          httpStatus: res.status,
          retryable: !authFailure && res.status >= 500,
        });
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 정산 주기별 커미션.
   *
   * `GET /api/v2/broker/queryMyCommission`
   *
   * ★ 이것이 **우리에게 실제로 지급되는 금액**이다. 화면의 '수익' 은 이 값이어야
   *   하고, 우리가 거래량으로 추정한 값이 아니어야 한다.
   */
  async getCommission(
    operator: UserCredentials,
    broker: Partial<BrokerCredentials> | null,
    params: {
      siteType?: string;
      tradeType?: BrokerTradeType;
      rebateType?: number;
      startAt?: number;
      endAt?: number;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<BrokerPage<BrokerCommissionRow>> {
    const d = await this.get<{
      currentPage?: number; pageSize?: number; totalNum?: number; totalPage?: number;
      items?: Record<string, unknown>[];
    }>(operator, broker, '/api/v2/broker/queryMyCommission', {
      siteType: params.siteType ?? 'all',
      tradeType: params.tradeType ?? 'all',
      rebateType: params.rebateType ?? 0,
      startAt: params.startAt,
      endAt: params.endAt,
      page: params.page ?? 1,
      pageSize: Math.min(Math.max(1, params.pageSize ?? 50), 500),
    });

    return {
      currentPage: num(d?.currentPage),
      pageSize: num(d?.pageSize),
      totalNum: num(d?.totalNum),
      totalPage: num(d?.totalPage),
      items: (d?.items ?? []).map((r) => ({
        siteType: str(r.siteType),
        rebateType: num(r.rebateType),
        payoutTime: num(r.payoutTime),
        periodStartTime: num(r.periodStartTime),
        periodEndTime: num(r.periodEndTime),
        status: num(r.status),
        totalTradeUser: str(r.totalTradeUser),
        tagUser: str(r.tagUser),
        tagTradeVolume: str(r.tagTradeVolume),
        tagCommission: str(r.tagCommission),
        invitedUser: str(r.invitedUser),
        noTagTradeVolume: str(r.noTagTradeVolume),
        noTagCommission: str(r.noTagCommission),
        totalCommission: str(r.totalCommission),
        currency: str(r.currency),
      })),
    };
  }

  /**
   * 우리를 통해 거래하는 사용자 목록.
   *
   * `GET /api/v2/broker/queryUser`
   *
   * ★ `tags` 가 비어 있고 `...WithoutTag` 만 값이 있는 사용자는 **우리 서명 없이
   *   거래하고 있다**는 뜻이다. 그 거래는 우리 실적에 들어가지 않는다.
   */
  async getUserList(
    operator: UserCredentials,
    broker: Partial<BrokerCredentials> | null,
    params: {
      tradeType?: BrokerTradeType;
      uid?: string;
      rcode?: string;
      tag?: string;
      startAt?: number;
      endAt?: number;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<BrokerPage<BrokerUserRow>> {
    const d = await this.get<{
      currentPage?: number; pageSize?: number; totalNum?: number; totalPage?: number;
      items?: Record<string, unknown>[];
    }>(operator, broker, '/api/v2/broker/queryUser', {
      tradeType: params.tradeType ?? 'all',
      uid: params.uid,
      rcode: params.rcode,
      tag: params.tag,
      startAt: params.startAt,
      endAt: params.endAt,
      page: params.page ?? 1,
      pageSize: Math.min(Math.max(1, params.pageSize ?? 50), 500),
    });

    return {
      currentPage: num(d?.currentPage),
      pageSize: num(d?.pageSize),
      totalNum: num(d?.totalNum),
      totalPage: num(d?.totalPage),
      items: (d?.items ?? []).map((r) => ({
        uid: String(r.uid ?? ''),
        nickName: str(r.nickName),
        registrationTime: num(r.registrationTime),
        rateUp: bool(r.rateUp),
        totalCommission: str(r.totalCommission),
        totalTradingVolume: str(r.totalTradingVolume),
        totalFee: str(r.totalFee),
        invitedByMe: bool(r.invitedByMe),
        rcode: str(r.rcode),
        tags: str(r.tags),
        spotTradingVolumeWithTag: str(r.spotTradingVolumeWithTag),
        futuresTradingVolumeWithTag: eitherFutures(r, 'WithTag'),
        tradingFeeWithTag: str(r.tradingFeeWithTag),
        commissionWithTag: str(r.commissionWithTag),
        spotTradingVolumeWithoutTag: eitherTag(r, 'spotTradingVolume'),
        futuresTradingVolumeWithoutTag:
          eitherFutures(r, 'WithoutTag') ?? eitherFutures(r, 'WithNoTag'),
        tradingFeeWithoutTag: eitherTag(r, 'tradingFee'),
        commissionWithoutTag: eitherTag(r, 'commission'),
        currency: str(r.currency),
      })),
    };
  }

  /**
   * 사용자별 일자 내역.
   *
   * `GET /api/v2/broker/queryDetailByUid`
   *
   * ★★ **커서 페이지네이션이다** (page 번호가 아니다). 마지막 행의 `lastId` 를
   *   다음 요청에 넘긴다. 페이지 번호로 넘기면 같은 데이터를 반복해서 받는다.
   *
   * ★ 응답의 `data` 가 **배열 그대로**다. 다른 조회들처럼 `{items}` 로 감싸져
   *   있지 않다. 같은 코드로 처리하려 하면 빈 목록이 된다.
   */
  async getUserTransactions(
    operator: UserCredentials,
    broker: Partial<BrokerCredentials> | null,
    params: {
      tradeType?: BrokerTradeType;
      uid?: string;
      startAt?: number;
      endAt?: number;
      /** 이전 응답 마지막 행의 lastId. 첫 요청에는 생략한다. */
      lastId?: string;
      direction?: 'NEXT' | 'PREV';
      pageSize?: number;
    } = {},
  ): Promise<{ items: BrokerUserTransactionRow[]; nextCursor: string | null }> {
    const rows = await this.get<Record<string, unknown>[]>(
      operator,
      broker,
      '/api/v2/broker/queryDetailByUid',
      {
        tradeType: params.tradeType ?? 'all',
        uid: params.uid,
        startAt: params.startAt,
        endAt: params.endAt,
        lastId: params.lastId,
        direction: params.direction ?? 'NEXT',
        pageSize: Math.min(Math.max(1, params.pageSize ?? 50), 500),
      },
    );

    const items = (Array.isArray(rows) ? rows : []).map((r) => ({
      tradeTime: num(r.tradeTime),
      uid: String(r.uid ?? ''),
      nickName: str(r.nickName),
      invitedByMe: bool(r.invitedByMe),
      totalCommission: str(r.totalCommission),
      totalVolume: str(r.totalVolume),
      totalFee: str(r.totalFee),
      rcode: str(r.rcode),
      spotTradingVolumeWithTag: str(r.spotTradingVolumeWithTag),
      futuresTradingVolumeWithTag: eitherFutures(r, 'WithTag'),
      tradingFeeWithTag: str(r.tradingFeeWithTag),
      commissionWithTag: str(r.commissionWithTag),
      spotTradingVolumeWithoutTag: eitherTag(r, 'spotTradingVolume'),
      futuresTradingVolumeWithoutTag:
        eitherFutures(r, 'WithoutTag') ?? eitherFutures(r, 'WithNoTag'),
      tradingFeeWithoutTag: eitherTag(r, 'tradingFee'),
      commissionWithoutTag: eitherTag(r, 'commission'),
      currency: str(r.currency),
      lastId: str(r.lastId),
    }));

    /*
       다음 커서.

       ★ 마지막 행의 lastId 를 쓴다. 빈 목록이면 null 이고, 그때 더 요청하면
         같은 자리를 계속 읽는다.
    */
    const nextCursor = items.length > 0 ? items[items.length - 1]!.lastId : null;
    return { items, nextCursor };
  }

  /**
   * 리베이트 원장 CSV 다운로드 링크.
   *
   * `GET /api/v2/broker/api/rebate/download`
   *
   * ★★ **CSV 파일을 주지 않는다. 서명된 S3 링크를 준다.** JSON 을 기대하고
   *   파싱하면 실패한다. 링크는 유효기간이 있으므로 받아서 바로 내려받아야 한다.
   *
   * ★ 날짜 형식이 `YYYYMMDD` 다 (ISO 가 아니다). `2025-01-01` 을 보내면 조용히
   *   빈 결과가 나올 수 있다.
   *
   * ★ 링크를 우리가 대신 내려받아 화면에 보여주지 않는다. 이 CSV 에는 거래자
   *   UID 와 거래량이 들어 있다 — 운영자가 필요할 때 직접 받게 하고, 우리
   *   서버가 사본을 만들지 않는 편이 안전하다.
   */
  async getRebateCsvUrl(
    operator: UserCredentials,
    broker: Partial<BrokerCredentials> | null,
    params: { begin: string; end: string; tradeType?: 'SPOT' | 'FUTURES' },
  ): Promise<{ url: string | null }> {
    if (!/^\d{8}$/.test(params.begin) || !/^\d{8}$/.test(params.end)) {
      throw new KucoinBrokerError('begin·end 는 YYYYMMDD 형식이어야 한다');
    }
    const d = await this.get<{ url?: string }>(
      operator,
      broker,
      '/api/v2/broker/api/rebate/download',
      {
        begin: params.begin,
        end: params.end,
        tradeType: params.tradeType ?? 'FUTURES',
      },
    );
    return { url: str(d?.url) };
  }
}
