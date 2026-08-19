/* ============================================================
   KuCoin 현물(Spot) 비공개 REST — 잔고 · 주문
   ------------------------------------------------------------
   ★ 이 파일은 실제로 돈이 나가는 경로다. 선물 어댑터와 같은 원칙을 지킨다.

     1) 모르는 것을 성공이라고 하지 않는다.
        타임아웃·네트워크 단절은 "주문이 안 나갔다" 가 아니다. 나갔는지 알 수
        없다. REJECTED 로 돌려주면 이용자가 다시 주문해 **중복 매수**가 된다.

     2) clientOid 로 멱등성을 보장한다.
        재시도로 주문이 두 번 나가는 것을 막는 유일한 장치다.

   ★★ 선물과 다른 점 — 여기서 틀리면 주문 크기가 완전히 달라진다

     수량      선물은 **계약수**(BTC 1계약 = 0.001 BTC)를 보내고, 현물은
               **기초자산 수량**을 그대로 보낸다. 현물에 승수를 나누면 1000배
               작은 주문이 나가고, 반대로 선물에 기초자산을 보내면 1000배 큰
               주문이 나간다. 그래서 현물 클라이언트는 승수를 아예 다루지 않는다.

     레버리지  현물에는 없다. leverage 를 보내면 KuCoin 이 거부한다.

     시장가 매수 현물 시장가는 **수량(size)이 아니라 금액(funds)** 으로 낼 수도
               있다. 우리는 size 로만 낸다 — 두 가지를 섞으면 이용자가 무엇을
               입력했는지에 따라 결과가 달라지는데, 그 차이가 화면에 드러나지 않는다.

     경로      선물 `/api/v1/orders`(api-futures) vs 현물 `/api/v1/orders`(api.kucoin.com).
               경로 문자열이 같아서 **도메인만 틀리면 조용히 실패한다.**

     조회      현물 잔고는 `/api/v1/accounts?type=trade` 다. 거래 계정(trade)과
               메인 계정(main)이 분리돼 있어서, type 을 빼면 거래에 쓸 수 없는
               잔고까지 합산되어 "돈이 있는데 주문이 안 된다" 가 된다.

   ★ 브로커 파트너 헤더는 **현물용 자격증명**(partner=CCAI)을 써야 한다.
     선물용(CCAIF)으로 서명하면 서명은 만들어지지만 거래가 귀속되지 않고
     오류도 나지 않는다 — 리베이트만 0 이 된다.
   ============================================================ */

import {
  buildAuthHeaders,
  type BrokerCredentials,
  type UserCredentials,
} from './signature.js';
import { DEFAULT_KUCOIN_SPOT_REST } from './broker-rest.js';
import { toSpotSymbol } from './spot-adapter.js';

/**
 * 현물 주문 경로.
 *
 * ★★ `/api/v1/orders` 는 폐기 목록(Add Order - Old)이다. 현재 경로는 hf 다.
 *   상수로 두는 이유: 생성·취소·조회 세 곳이 같은 접두어를 써야 하고, 한 곳만
 *   고치면 "주문은 되는데 취소가 안 되는" 상태가 된다.
 */
const SPOT_ORDER_PATH = '/api/v1/hf/orders';

/** KuCoin 응답 봉투. HTTP 200 에 code 로 실패를 알린다. */
interface Envelope<T> {
  code?: string;
  msg?: string;
  data?: T;
}

export class KucoinSpotApiError extends Error {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  /**
   * 주문이 나갔는지 **알 수 없는** 상태.
   *
   * ★ retryable 과 다르다. retryable 은 "다시 해도 안전하다", unknown 은
   *   "다시 하면 두 번 나갈 수 있다" 다. 호출자는 unknown 일 때 재주문이 아니라
   *   조회로 확인해야 한다.
   */
  readonly unknownOutcome: boolean;

  constructor(
    message: string,
    opts: { code?: string; httpStatus?: number; retryable?: boolean; unknownOutcome?: boolean } = {},
  ) {
    super(message);
    this.name = 'KucoinSpotApiError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
    this.unknownOutcome = opts.unknownOutcome ?? false;
  }
}

export interface KucoinSpotPrivateConfig {
  restBase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** 현물 브로커 자격증명. 선물 것을 넣으면 리베이트가 귀속되지 않는다. */
  broker?: Partial<BrokerCredentials> | null;
}

export interface SpotSubmitRequest {
  clientOid: string;
  /** 우리 표기(BTCUSDT). 내부에서 BTC-USDT 로 바꾼다. */
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  type: 'limit' | 'market';
  /** 기초자산 수량. **계약수가 아니다.** */
  quantity: string;
  price?: string;
  timeInForce?: string;
  postOnly?: boolean;
}

export interface SpotStopSubmitRequest extends SpotSubmitRequest {
  /**
   * 발동 가격. 이 가격에 닿으면 주문이 시장에 나간다.
   *
   * ★ 발동 가격과 지정가는 다른 값이다. 같은 값으로 두면 발동 직후 체결되지 않고
   *   호가에 남을 수 있다 — 이용자는 손절이 걸렸다고 믿는다.
   */
  stopPrice: string;
}

export interface SpotSubmitResult {
  orderId: string;
  clientOid: string;
  /** 실제로 보낸 수량. 화면이 입력값과 대조할 수 있어야 한다. */
  sizeSent: string;
  brokerAttached: boolean;
}

export interface SpotBalance {
  currency: string;
  /** 주문에 쓸 수 있는 금액. */
  available: string;
  /** 미체결 주문에 묶인 금액. */
  holds: string;
  total: string;
}

export class KucoinSpotPrivate {
  private readonly restBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly broker: Partial<BrokerCredentials> | null;

  constructor(cfg: KucoinSpotPrivateConfig = {}) {
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
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
    this.broker = cfg.broker ?? null;
  }

  /** 브로커 헤더가 실제로 붙는지. 리베이트 집계 여부를 확인하는 근거다. */
  get brokerAttached(): boolean {
    const b = this.broker;
    return Boolean(b && b.partner && b.key && b.name);
  }

  private async request<T>(
    user: UserCredentials,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; mutating?: boolean } = {},
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
      let json: Envelope<T> | null = null;
      try {
        json = JSON.parse(text) as Envelope<T>;
      } catch {
        throw new KucoinSpotApiError(`응답이 JSON 이 아니다 (HTTP ${res.status})`, {
          httpStatus: res.status,
          retryable: !opts.mutating && res.status >= 500,
          /*
             주문 요청에서 응답을 해석할 수 없으면 결과를 모른다. 조회 요청은
             다시 해도 안전하므로 unknown 이 아니다.
          */
          unknownOutcome: Boolean(opts.mutating),
        });
      }

      if (!res.ok || (json.code && json.code !== '200000')) {
        const authFailure =
          res.status === 401 ||
          json.code === '400003' ||   // 잘못된 키
          json.code === '400004' ||   // 잘못된 passphrase
          json.code === '400005' ||   // 잘못된 서명
          json.code === '400007' ||   // 권한 없음
          json.code === '400100';
        /*
           ★ 5xx 는 주문이 접수됐는지 알 수 없다.

             거래소가 받아서 처리하다 실패했는지, 받지도 못했는지 구분할 방법이
             없다. 그 상태에서 "거부됨" 이라고 말하면 이용자가 다시 주문한다.
        */
        const serverSide = res.status >= 500;
        throw new KucoinSpotApiError(json.msg || `KuCoin 오류 (HTTP ${res.status})`, {
          code: json.code,
          httpStatus: res.status,
          retryable: !authFailure && serverSide && !opts.mutating,
          unknownOutcome: Boolean(opts.mutating) && serverSide,
        });
      }

      return json.data as T;
    } catch (e) {
      /*
         ★★ 중단(타임아웃)은 주문이 나갔는지 알 수 없는 상태다.

           선물 어댑터에서와 같은 이유로, 여기서 실패로 단정하면 재주문이
           중복 매수가 된다.
      */
      if (e instanceof KucoinSpotApiError) throw e;
      const aborted = (e as Error)?.name === 'AbortError';
      throw new KucoinSpotApiError(
        aborted ? `요청 시간 초과 (${this.timeoutMs}ms)` : String((e as Error)?.message ?? e),
        { retryable: !opts.mutating, unknownOutcome: Boolean(opts.mutating) },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 거래 계정 잔고.
   *
   * ★ `type=trade` 를 반드시 지정한다. KuCoin 현물은 메인(main)·거래(trade)
   *   계정이 분리돼 있고, 주문에 쓸 수 있는 것은 거래 계정뿐이다. type 을
   *   빼면 메인 잔고까지 합산되어 "잔고가 있는데 주문이 거부된다" 가 된다.
   */
  async getBalances(user: UserCredentials): Promise<SpotBalance[]> {
    const rows = await this.request<Array<{
      currency?: string; type?: string; balance?: string; available?: string; holds?: string;
    }>>(user, 'GET', '/api/v1/accounts', { query: { type: 'trade' } });

    const out: SpotBalance[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const cur = String(r.currency ?? '').toUpperCase();
      if (!cur) continue;
      out.push({
        currency: cur,
        available: String(r.available ?? '0'),
        holds: String(r.holds ?? '0'),
        total: String(r.balance ?? '0'),
      });
    }
    return out;
  }

  /**
   * 주문 제출.
   *
   * ★★ 수량을 그대로 보낸다. 승수를 곱하거나 나누지 않는다.
   *   현물의 size 는 기초자산 수량이다(BTC 0.001 = 0.001 BTC).
   */
  async submitOrder(user: UserCredentials, req: SpotSubmitRequest): Promise<SpotSubmitResult> {
    const exSymbol = toSpotSymbol(req.symbol);
    if (!exSymbol.includes('-')) {
      throw new KucoinSpotApiError(`지원하지 않는 현물 심볼: ${req.symbol}`, { code: 'SYMBOL_UNSUPPORTED' });
    }
    const qty = Number(req.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new KucoinSpotApiError(`수량이 올바르지 않다: ${req.quantity}`, { code: 'INVALID_QUANTITY' });
    }
    if (!req.clientOid) {
      // 멱등성 키가 없으면 재시도가 중복 주문이 된다.
      throw new KucoinSpotApiError('clientOid 가 없다', { code: 'CLIENT_OID_REQUIRED' });
    }

    const body: Record<string, unknown> = {
      clientOid: req.clientOid,
      symbol: exSymbol,
      // 우리 표기(long/short)와 거래소 표기(buy/sell)를 여기서 한 번만 변환한다.
      side: (req.side === 'short' || req.side === 'sell') ? 'sell' : 'buy',
      type: req.type,
      size: req.quantity,
    };
    if (req.type === 'limit') {
      if (!req.price) {
        throw new KucoinSpotApiError('지정가 주문에 가격이 없다', { code: 'PRICE_REQUIRED' });
      }
      body.price = req.price;
      if (req.timeInForce) body.timeInForce = req.timeInForce.toUpperCase();
      if (req.postOnly) body.postOnly = true;
    }
    /*
       ★ leverage 를 보내지 않는다. 현물에는 레버리지가 없고, 보내면 거부된다.
         선물 코드를 복사해 오면 가장 먼저 남는 필드가 이것이다.
    */

    /*
       ★★ 현재 현물 주문 경로는 `/api/v1/hf/orders` 다.

         처음에 `/api/v1/orders` 로 구현했는데, KuCoin 문서에서 그 경로는
         **Abandoned Endpoints → Add Order - Old** 로 분류돼 있다(2026-08 확인).
         지금은 동작하더라도 폐기 예정 경로에 실주문을 걸어 두는 것이므로,
         어느 날 갑자기 주문이 나가지 않게 된다.

       ★ 'hf' 는 과거 고빈도 전용 계정을 뜻했지만 현재는 현물 거래 계정의
         표준 경로다. 잔고 조회의 `type=trade` 와 같은 계정을 가리킨다.
    */
    const d = await this.request<{ orderId?: string; clientOid?: string }>(
      user, 'POST', SPOT_ORDER_PATH, { body, mutating: true },
    );

    return {
      orderId: String(d?.orderId ?? ''),
      clientOid: String(d?.clientOid ?? req.clientOid),
      sizeSent: String(req.quantity),
      brokerAttached: this.brokerAttached,
    };
  }

  /**
   * 스톱 주문(발동 주문) 제출.
   *
   * ★★ 일반 주문과 **다른 엔드포인트**다: `/api/v1/stop-order`.
   *   일반 주문 경로로 stopPrice 를 보내면 그 필드는 무시되고 **즉시 체결되는
   *   주문이 나간다.** 손절을 걸었다고 믿는 이용자가 그 자리에서 시장가로
   *   체결되는 것이 이 실수의 결과다.
   *
   * ★ KuCoin 은 미발동 스톱 주문을 종목당 20개로 제한한다. 초과하면 거부되는데
   *   그것은 우리가 고칠 수 없는 상태이므로 이유를 그대로 전달한다.
   *
   * ★ 발동 방향(위/아래)은 KuCoin 이 현재가와 stopPrice 를 비교해 판단한다.
   *   우리가 추측해서 보내지 않는다 — 추측이 틀리면 반대 방향에 걸린다.
   */
  async submitStopOrder(user: UserCredentials, req: SpotStopSubmitRequest): Promise<SpotSubmitResult> {
    const exSymbol = toSpotSymbol(req.symbol);
    if (!exSymbol.includes('-')) {
      throw new KucoinSpotApiError(`지원하지 않는 현물 심볼: ${req.symbol}`, { code: 'SYMBOL_UNSUPPORTED' });
    }
    if (!req.clientOid) {
      throw new KucoinSpotApiError('clientOid 가 없다', { code: 'CLIENT_OID_REQUIRED' });
    }
    const qty = Number(req.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new KucoinSpotApiError(`수량이 올바르지 않다: ${req.quantity}`, { code: 'INVALID_QUANTITY' });
    }
    const stop = Number(req.stopPrice);
    if (!Number.isFinite(stop) || stop <= 0) {
      // 발동 가격이 없으면 스톱 주문이 아니다. 일반 주문으로 조용히 바꾸지 않는다.
      throw new KucoinSpotApiError(`발동 가격이 올바르지 않다: ${req.stopPrice}`, { code: 'INVALID_STOP_PRICE' });
    }

    const body: Record<string, unknown> = {
      clientOid: req.clientOid,
      symbol: exSymbol,
      side: (req.side === 'short' || req.side === 'sell') ? 'sell' : 'buy',
      type: req.type,
      size: req.quantity,
      stopPrice: req.stopPrice,
    };
    if (req.type === 'limit') {
      if (!req.price) {
        throw new KucoinSpotApiError('지정가 스톱 주문에 가격이 없다', { code: 'PRICE_REQUIRED' });
      }
      body.price = req.price;
      if (req.timeInForce) body.timeInForce = req.timeInForce.toUpperCase();
    }

    const d = await this.request<{ orderId?: string; clientOid?: string }>(
      user, 'POST', '/api/v1/stop-order', { body, mutating: true },
    );
    return {
      orderId: String(d?.orderId ?? ''),
      clientOid: String(d?.clientOid ?? req.clientOid),
      sizeSent: String(req.quantity),
      brokerAttached: this.brokerAttached,
    };
  }

  /**
   * 주문 취소. 이미 체결·취소된 주문은 실패하는데, 그것은 오류가 아니라 상태다.
   *
   * ★★ 현물 취소는 **symbol 이 필수 쿼리**다(`?symbol=BTC-USDT`).
   *   빼면 400 이 온다. 선물은 orderId 만으로 되므로, 선물 코드를 복사해 오면
   *   "취소를 눌렀는데 아무 일도 없다" 가 된다.
   */
  async cancelOrder(user: UserCredentials, orderId: string, symbol: string): Promise<{ canceled: string[] }> {
    const exSymbol = toSpotSymbol(symbol);
    if (!exSymbol.includes('-')) {
      throw new KucoinSpotApiError(`취소에 필요한 심볼이 올바르지 않다: ${symbol}`, { code: 'SYMBOL_REQUIRED' });
    }
    const d = await this.request<{ orderId?: string; cancelledOrderIds?: string[] }>(
      user, 'DELETE', `${SPOT_ORDER_PATH}/${encodeURIComponent(orderId)}`,
      { query: { symbol: exSymbol }, mutating: true },
    );
    /*
       hf 응답은 `{orderId}` 하나를 준다. 구 응답은 `cancelledOrderIds` 배열이었다.
       두 형태를 모두 받아들인다 — 응답 형태가 바뀌었을 때 "취소 실패" 로 보고하면
       이용자가 같은 주문을 계속 취소하려 한다.
    */
    if (Array.isArray(d?.cancelledOrderIds)) return { canceled: d.cancelledOrderIds.map(String) };
    return { canceled: d?.orderId ? [String(d.orderId)] : [] };
  }

  /**
   * clientOid 로 주문을 조회한다.
   *
   * ★★ 제출 결과가 불명확할 때(SUBMIT_UNKNOWN) 이 경로로 확인한다.
   *   이것이 없으면 "모른다" 를 해결할 방법이 없어서, 결국 이용자가 재주문하게 된다.
   */
  async getOrderByClientOid(
    user: UserCredentials,
    clientOid: string,
    symbol: string,
  ): Promise<{ orderId: string; status: string; size: string; dealSize: string } | null> {
    try {
      const exSymbol = toSpotSymbol(symbol);
      if (!exSymbol.includes('-')) {
        // symbol 없이는 조회할 수 없다. 추측한 심볼로 물어보면 다른 주문을 볼 수 있다.
        throw new KucoinSpotApiError(`조회에 필요한 심볼이 올바르지 않다: ${symbol}`, { code: 'SYMBOL_REQUIRED' });
      }
      const d = await this.request<{
        id?: string; isActive?: boolean; cancelExist?: boolean; size?: string; dealSize?: string;
      }>(user, 'GET', `${SPOT_ORDER_PATH}/client-order/${encodeURIComponent(clientOid)}`,
        { query: { symbol: exSymbol } });
      if (!d || !d.id) return null;
      /*
         KuCoin 현물은 상태를 문자열로 주지 않는다. isActive/cancelExist 로 판단한다.
         · isActive true            → 미체결(또는 부분체결) 상태로 살아 있다
         · cancelExist true         → 취소됨
         · 둘 다 아니면             → 체결 완료
      */
      const status = d.isActive ? 'open' : (d.cancelExist ? 'canceled' : 'filled');
      return {
        orderId: String(d.id),
        status,
        size: String(d.size ?? '0'),
        dealSize: String(d.dealSize ?? '0'),
      };
    } catch (e) {
      // 없는 주문은 404 계열로 온다 — 그건 "제출되지 않았다" 는 정보다.
      if (e instanceof KucoinSpotApiError && e.code === '400100') return null;
      throw e;
    }
  }

  /**
   * OCO 주문 (하나가 체결되면 다른 하나가 취소된다).
   *
   * ★★ 거래소가 **현물에만** 제공한다(POST /api/v3/oco/order). 선물에는 없다.
   *
   * ★ 세 가격의 뜻이 서로 다르다 — 헷갈리면 정반대로 걸린다:
   *     price       익절 쪽 지정가 (이 가격에 걸어 둔다)
   *     stopPrice   손절 쪽 **발동가** (여기에 닿으면 손절 주문이 나간다)
   *     limitPrice  손절이 발동된 뒤 실제로 내는 지정가
   *
   *   limitPrice 를 stopPrice 와 같게 두면 급락장에서 체결되지 않고 호가에 남는다.
   *   그래서 세 값을 모두 요구하고, 하나라도 없으면 주문하지 않는다.
   *
   * ★ 미발동 스톱 주문은 종목당 20개 제한을 공유한다.
   */
  async submitOcoOrder(user: UserCredentials, req: {
    clientOid: string;
    symbol: string;
    side: 'long' | 'short' | 'buy' | 'sell';
    quantity: string;
    /** 익절 쪽 지정가 */
    price: string;
    /** 손절 발동가 */
    stopPrice: string;
    /** 손절 발동 후의 지정가 */
    limitPrice: string;
  }): Promise<SpotSubmitResult> {
    const exSymbol = toSpotSymbol(req.symbol);
    if (!exSymbol.includes('-')) {
      throw new KucoinSpotApiError(`지원하지 않는 현물 심볼: ${req.symbol}`, { code: 'SYMBOL_UNSUPPORTED' });
    }
    if (!req.clientOid) throw new KucoinSpotApiError('clientOid 가 없다', { code: 'CLIENT_OID_REQUIRED' });

    const nums: Array<[string, string | undefined]> = [
      ['quantity', req.quantity], ['price', req.price],
      ['stopPrice', req.stopPrice], ['limitPrice', req.limitPrice],
    ];
    for (const [name, v] of nums) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        /*
           하나라도 없으면 주문하지 않는다. 빠진 값을 우리가 채우면(예: limitPrice 를
           stopPrice 로) 이용자가 지정하지 않은 조건으로 체결된다.
        */
        throw new KucoinSpotApiError(`OCO 값이 올바르지 않다: ${name}=${String(v)}`, { code: 'INVALID_OCO_PRICE' });
      }
    }

    const d = await this.request<{ orderId?: string }>(user, 'POST', '/api/v3/oco/order', {
      body: {
        clientOid: req.clientOid,
        symbol: exSymbol,
        side: (req.side === 'short' || req.side === 'sell') ? 'sell' : 'buy',
        size: req.quantity,
        price: req.price,
        stopPrice: req.stopPrice,
        limitPrice: req.limitPrice,
        // 현물 거래 계정을 쓴다(마진이 아니다).
        tradeType: 'TRADE',
      },
      mutating: true,
    });

    return {
      orderId: String(d?.orderId ?? ''),
      clientOid: req.clientOid,
      sizeSent: String(req.quantity),
      brokerAttached: this.brokerAttached,
    };
  }

  /**
   * 자격증명 확인.
   *
   * ★ 잔고 조회로 확인한다. 주문 권한까지 확인하려면 주문을 내야 하므로 그건 하지 않는다.
   *   그래서 "조회는 되지만 주문 권한이 없는" 키는 여기서 걸러지지 않는다 —
   *   그 사실을 호출자가 알아야 한다.
   */
  async verifyCredentials(user: UserCredentials): Promise<{ ok: true } | { ok: false; code?: string; message: string }> {
    try {
      await this.getBalances(user);
      return { ok: true };
    } catch (e) {
      const err = e as KucoinSpotApiError;
      return { ok: false, code: err.code, message: err.message };
    }
  }
}
