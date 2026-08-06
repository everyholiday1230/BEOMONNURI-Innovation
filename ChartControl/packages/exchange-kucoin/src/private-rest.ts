/**
 * KuCoin 선물 개인 API — 잔고·포지션·주문.
 *
 * 공개 시세(rest.ts)와 분리한 이유
 * ------------------------------
 * 개인 API 는 사용자 자격증명으로 서명한다. 서명 실패·권한 부족은 공개 API 와
 * 완전히 다른 실패 모드이고, 레이트리밋도 계정 단위로 따로 걸린다.
 * 섞어두면 한 사용자의 키 오류가 전체 시세를 멈추게 만들 수 있다.
 *
 * 브로커 리베이트
 * -------------
 * 모든 요청에 브로커 파트너 헤더를 붙인다. 이 헤더가 없으면 거래량이 우리
 * 앞으로 집계되지 않아 리베이트가 0 이다 — 즉 수익이 발생하지 않는다.
 * 자격증명이 완전하지 않으면(3종 중 하나라도 비면) 헤더를 생략한다.
 * 부분 설정은 KuCoin 이 400201 로 거부하므로, 붙였다 실패하는 것보다 낫다.
 *
 * ★ 출금 권한
 * 우리는 절대 출금을 요청하지 않는다. 사용자에게도 출금 권한 없는 키만
 * 발급하도록 안내한다. 이 파일에 출금 엔드포인트를 추가하지 말 것.
 */

import { toDecimalString } from './decimal.js';
import { KucoinApiError, DEFAULT_KUCOIN_FUTURES_REST } from './rest.js';
import { buildAuthHeaders, type BrokerCredentials, type UserCredentials } from './signature.js';
import { toKucoinSymbol, toInternalSymbol } from './symbols.js';

export interface KucoinPrivateConfig {
  restBase?: string;
  /** 브로커 파트너 자격증명. 없으면 헤더를 붙이지 않는다(리베이트 미집계). */
  broker?: Partial<BrokerCredentials> | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 계정 잔고. 통화별 1행. */
export interface KucoinBalance {
  currency: string;
  /** 총 잔고 */
  total: string;
  /** 주문에 묶이지 않은 사용 가능 잔고 */
  available: string;
  /** 미실현 손익 */
  unrealisedPnl: string;
  /** 포지션 증거금 */
  positionMargin: string;
  /** 주문 증거금 */
  orderMargin: string;
}

/** 보유 포지션. */
export interface KucoinPosition {
  symbol: string;
  /** 계약 수량. 양수=롱, 음수=숏 */
  contracts: string;
  /** 기초자산 수량 (계약수 × multiplier) */
  quantity: string;
  side: 'long' | 'short' | 'flat';
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unrealisedPnl: string;
  realisedPnl: string;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  positionMargin: string;
}

/** 자금 이동 1건. */
export interface KucoinLedgerEntry {
  id: string;
  /** KuCoin 원시 type. 매핑되지 않은 종류도 읽을 수 있게 그대로 보존한다. */
  rawType: string;
  symbol: string | null;
  /** 부호 있는 십진 문자열. 수수료·손실은 음수. */
  amount: string;
  currency: string;
  /** epoch 밀리초 */
  time: number;
  /** 이동 후 잔고 */
  balanceAfter: string;
  remark: string;
}

interface KucoinEnvelope<T> {
  code?: string;
  msg?: string;
  data?: T;
}

/**
 * 개인 API 클라이언트.
 *
 * 인스턴스는 **자격증명을 보관하지 않는다.** 매 호출에 넘겨받는다 —
 * 여러 사용자의 요청을 한 프로세스가 처리하므로, 인스턴스에 키를 들고 있으면
 * 다른 사용자의 키로 요청이 나가는 사고가 가능해진다.
 */
export class KucoinFuturesPrivate {
  private readonly restBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly broker: Partial<BrokerCredentials> | null;

  constructor(cfg: KucoinPrivateConfig = {}) {
    this.restBase = cfg.restBase?.trim() || DEFAULT_KUCOIN_FUTURES_REST;
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
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
    this.broker = cfg.broker ?? null;
  }

  /** 브로커 헤더가 실제로 붙는지. 리베이트 집계 여부를 운영에서 확인하는 근거다. */
  get brokerAttached(): boolean {
    const b = this.broker;
    return Boolean(b && b.partner && b.key && b.name);
  }

  private async request<T>(
    user: UserCredentials,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    // 서명 대상 경로에는 쿼리스트링이 포함된다. 순서가 달라지면 서명이 깨진다.
    const requestPath = qs.toString() ? `${path}?${qs.toString()}` : path;
    const bodyText = opts.body === undefined ? '' : JSON.stringify(opts.body);

    const headers = buildAuthHeaders({
      user,
      method,
      requestPath,
      body: bodyText,
      broker: this.broker,
    });
    if (bodyText) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(new URL(requestPath, this.restBase), {
        method,
        headers,
        body: bodyText || undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let json: KucoinEnvelope<T> | null = null;
      try {
        json = JSON.parse(text) as KucoinEnvelope<T>;
      } catch {
        throw new KucoinApiError(`응답이 JSON 이 아니다 (HTTP ${res.status})`, {
          httpStatus: res.status,
          path,
          retryable: res.status >= 500,
        });
      }

      if (!res.ok || (json.code && json.code !== '200000')) {
        // 자격증명 오류는 재시도해도 같다. 사용자에게 알려야 한다.
        const authFailure =
          res.status === 401 ||
          json.code === '400003' || // 잘못된 키
          json.code === '400004' || // 잘못된 passphrase
          json.code === '400005' || // 잘못된 서명
          json.code === '400007' || // 권한 없음
          json.code === '400100';
        throw new KucoinApiError(json.msg || `KuCoin 오류 (HTTP ${res.status})`, {
          code: json.code,
          httpStatus: res.status,
          path,
          retryable: !authFailure && res.status >= 500,
        });
      }

      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 계정 잔고.
   *
   * `currency` 를 지정하지 않으면 KuCoin 이 USDT 를 준다. 다른 통화 잔고를
   * 합산해 보여주려면 통화별로 따로 요청해야 한다.
   */
  async getBalance(user: UserCredentials, currency = 'USDT'): Promise<KucoinBalance> {
    const d = await this.request<{
      currency?: string;
      accountEquity?: number;
      availableBalance?: number;
      unrealisedPNL?: number;
      positionMargin?: number;
      orderMargin?: number;
    }>(user, 'GET', '/api/v1/account-overview', { query: { currency } });

    return {
      currency: d?.currency ?? currency,
      total: toDecimalString(d?.accountEquity ?? 0) ?? '0',
      available: toDecimalString(d?.availableBalance ?? 0) ?? '0',
      unrealisedPnl: toDecimalString(d?.unrealisedPNL ?? 0) ?? '0',
      positionMargin: toDecimalString(d?.positionMargin ?? 0) ?? '0',
      orderMargin: toDecimalString(d?.orderMargin ?? 0) ?? '0',
    };
  }

  /**
   * 보유 포지션 전체.
   *
   * `currentQty` 는 **계약 수**다. 기초자산 수량으로 바꾸려면 multiplier 를
   * 곱해야 한다 — 그러지 않으면 BTC 1계약(0.001 BTC)을 1 BTC 로 표시한다.
   * multiplier 는 심볼 사양에서 오므로 호출자가 넘겨준다.
   */
  async getPositions(
    user: UserCredentials,
    multiplierOf?: (canonicalSymbol: string) => number | undefined,
  ): Promise<KucoinPosition[]> {
    const rows = await this.request<
      Array<{
        symbol?: string;
        currentQty?: number;
        avgEntryPrice?: number;
        markPrice?: number;
        liquidationPrice?: number;
        unrealisedPnl?: number;
        realisedPnl?: number;
        realLeverage?: number;
        crossMode?: boolean;
        posMargin?: number;
      }>
    >(user, 'GET', '/api/v1/positions');

    const out: KucoinPosition[] = [];
    for (const r of rows ?? []) {
      if (!r.symbol) continue;
      const canonical = toInternalSymbol(r.symbol);
      if (!canonical) continue;

      const contracts = r.currentQty ?? 0;
      // 포지션이 0 인 행도 KuCoin 이 돌려준다. 화면에 빈 행을 만들지 않는다.
      if (contracts === 0) continue;

      const mult = multiplierOf?.(canonical);
      // multiplier 를 모르면 계약수를 그대로 두되, quantity 를 계약수로 채우지 않는다.
      // 잘못된 수량은 잘못된 주문으로 이어지므로 빈 값이 낫다.
      const quantity = mult === undefined ? '' : toDecimalString(Math.abs(contracts) * mult) ?? '';

      out.push({
        symbol: canonical,
        contracts: toDecimalString(contracts) ?? '0',
        quantity,
        side: contracts > 0 ? 'long' : 'short',
        entryPrice: toDecimalString(r.avgEntryPrice ?? 0) ?? '0',
        markPrice: toDecimalString(r.markPrice ?? 0) ?? '0',
        liquidationPrice: toDecimalString(r.liquidationPrice ?? 0) ?? '0',
        unrealisedPnl: toDecimalString(r.unrealisedPnl ?? 0) ?? '0',
        realisedPnl: toDecimalString(r.realisedPnl ?? 0) ?? '0',
        leverage: Number(r.realLeverage ?? 0),
        marginMode: r.crossMode ? 'cross' : 'isolated',
        positionMargin: toDecimalString(r.posMargin ?? 0) ?? '0',
      });
    }
    return out;
  }

/**
   * 자금 이동 내역 (실현손익·펀딩비·수수료·입출금).
   *
   * KuCoin 은 `/api/v1/transaction-history` 로 준다. 시각은 **밀리초**다.
   * `offset` 기반 커서 페이징이며, `hasMore` 가 false 일 때까지 따라간다.
   *
   * 부호 규칙: KuCoin 이 이미 부호를 넣어 준다(수수료는 음수). 절대값으로
   * 바꾸면 손실이 이익으로 보인다 — 그대로 보존한다.
   */
  async getLedger(
    user: UserCredentials,
    query: { currency?: string; type?: string; startAt?: number; endAt?: number; maxRows?: number } = {},
  ): Promise<KucoinLedgerEntry[]> {
    const maxRows = Math.min(query.maxRows ?? 200, 1000);
    const out: KucoinLedgerEntry[] = [];
    let offset: number | undefined;

    // 페이지를 무한히 따라가지 않는다. 응답이 계속 hasMore=true 를 주는
    // 상황에서 프로세스가 멈추지 않게 상한을 둔다.
    for (let page = 0; page < 20 && out.length < maxRows; page += 1) {
      const d = await this.request<{
        dataList?: Array<{
          id?: string | number;
          type?: string;
          symbol?: string;
          amount?: number | string;
          currency?: string;
          time?: number | string;
          accountEquity?: number | string;
          remark?: string;
        }>;
        hasMore?: boolean;
        offset?: number;
      }>(user, 'GET', '/api/v1/transaction-history', {
        query: {
          currency: query.currency,
          type: query.type,
          startAt: query.startAt,
          endAt: query.endAt,
          maxCount: 200,
          offset,
        },
      });

      for (const r of d?.dataList ?? []) {
        const time = Number(r.time);
        out.push({
          id: String(r.id ?? `${time}-${r.type ?? 'unknown'}`),
          rawType: String(r.type ?? 'unknown'),
          // 이체는 심볼이 없다. 빈 문자열을 null 로 정규화한다.
          symbol: r.symbol ? toInternalSymbol(r.symbol) ?? r.symbol : null,
          amount: toDecimalString(r.amount ?? 0) ?? '0',
          currency: String(r.currency ?? query.currency ?? 'USDT'),
          time: Number.isFinite(time) ? time : 0,
          balanceAfter: toDecimalString(r.accountEquity ?? 0) ?? '0',
          remark: String(r.remark ?? ''),
        });
        if (out.length >= maxRows) break;
      }

      if (!d?.hasMore) break;
      offset = d.offset;
      if (offset === undefined) break;
    }

    return out;
  }

  /**
   * 자격증명 검증 — 읽기 권한만으로 통과해야 한다.
   *
   * 잔고 조회를 프로브로 쓴다. 주문 권한이 없어도 성공하므로, 사용자가
   * 읽기 전용 키를 넣었을 때도 "연결됨"으로 확인해 줄 수 있다.
   *
   * @returns 성공하면 잔고, 실패하면 이유. 예외를 던지지 않는다 —
   *          호출자가 화면에 이유를 보여줘야 하기 때문이다.
   */
  async verifyCredentials(
    user: UserCredentials,
  ): Promise<
    | { ok: true; balance: KucoinBalance; brokerAttached: boolean }
    | { ok: false; reason: string; code?: string; retryable: boolean }
  > {
    try {
      const balance = await this.getBalance(user);
      return { ok: true, balance, brokerAttached: this.brokerAttached };
    } catch (e) {
      const err = e as KucoinApiError & { detail?: { code?: string; retryable?: boolean } };
      return {
        ok: false,
        reason: err.message,
        code: err.detail?.code,
        retryable: Boolean(err.detail?.retryable),
      };
    }
  }

  /** 심볼 표기 변환을 외부에 노출한다 (주문 경로에서 재사용). */
  static toKucoinSymbol = toKucoinSymbol;
}
