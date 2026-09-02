import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import { ORDER_BLOCKING_KILL_SCOPES } from '@quantumtrade/admin-domain';
import type { BitMartMode, IExchangeAccountAdapter, IExchangeTradingAdapter, ExchangeContext } from '@quantumtrade/exchange-bitmart';
import { CredentialVault } from './trading/credential-vault';
// 학습 결과 수집 — 순수 함수(DB·네트워크를 만지지 않는다).
import { attributeRealizedPnl, buildOrderOutcomes } from './learning/outcome-collector';
import { evaluateTier } from './tiers/tier-engine';
import { runRiskEngine, type TradingPolicy } from './trading/risk-engine';
import { IdempotencyService, MemoryIdempotencyStore } from './trading/idempotency';
import type { CredentialStore } from './db/trading-repos';
import { ExchangeTransactionQuerySchema, type SymbolInfo } from '@quantumtrade/schemas';
import {
  TRANSACTION_HISTORY_LIMITS,
  summarizeTransactions,
  type ExchangeTransaction,
  type ExchangeTransactionQuery,
} from '@quantumtrade/exchange-bitmart';

const CSRF = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

export interface TradingRouterDeps {
  service: AuthService;
  vault: CredentialVault;
  /*
     ★ 구현이 아니라 계약(CredentialStore)에 의존한다. 배포에 따라 SQLite 판과
       PostgreSQL 판이 바뀌어도 라우트 코드는 같아야 한다.
  */
  credRepo: CredentialStore;
  accountAdapter: IExchangeAccountAdapter;
  /**
   * 이 배포가 연결하는 거래소 식별자. 저장되는 자격증명에 기록된다.
   * 기본값을 두지 않는다 — 잘못된 거래소 이름이 조용히 저장되면 안 된다.
   */
  exchangeId: string;
  /**
   * 일별 자산 스냅샷 저장소.
   *
   * ★ 자산곡선의 근거다. 잔고 조회가 **성공했을 때만** 기록한다 — 실패를 0 으로
   *   남기면 곡선에 없던 급락이 그려진다.
   */
  equitySnapshots?: import('./db/equity-snapshot-repo').PgEquitySnapshotRepo;
  /*
     거래 학습 데이터 수집기.

     ★★ 선택 항목이다(`?`). 없으면 수집하지 않고 주문은 그대로 나간다.

       필수로 만들면 Postgres 가 없는 배포(개발·테스트)에서 **주문 경로 전체가
       죽는다.** 학습 데이터는 부수 목적이고 주문은 본래 목적이다.

     ★ 반대 위험: 없으면 조용히 안 모인다. 그래서 `/api/admin/learning/stats`
       에서 수집 여부를 볼 수 있게 하고, 미설정이면 그 사실을 밝힌다.
  */
  learning?: import('./db/learning-repo').PgLearningRepo;
  /*
     고객 등급 저장소 (선택).

     ★ 없으면 등급 라우트가 `configured:false` 를 준다 — 기본 등급을 만들어
       주지 않는다. 없는 제도를 있는 것처럼 보여주면 이용자가 혜택을 기대한다.
  */
  tiers?: import('./db/pg-tier-repo').PgTierRepo;
  /*
     학습 기록에 넣을 시장 스냅샷을 읽는다.

     ★★ 화면이 보낸 가격을 쓰지 않기 위해 존재한다. 조작된 요청이 학습
       데이터를 오염시키면, 나중에 그 데이터로 학습한 모델이 실제로 없었던
       시장 상황을 배운다.

     ★ 없으면 스냅샷 없이 기록한다 — 판단 문맥(지표·주문 조건)은 그래도 남는다.
  */
  marketSnapshot?: (symbol: string, market: 'futures' | 'spot') => Promise<Record<string, unknown> | null>;
  /**
   * 실주문 어댑터. **주지 않으면 실주문 경로가 존재하지 않는다.**
   *
   * 선택 의존성으로 둔 이유: 기본 배포는 실주문을 하지 않으므로 어댑터를
   * 주입하지 않는 것이 가장 안전한 상태다. 실수로 열리는 것보다 실수로
   * 닫히는 편이 낫다.
   */
  tradingAdapter?: IExchangeTradingAdapter;
  /**
   * 현물 거래 어댑터.
   *
   * ★★ 선물과 별도로 받는다. 수량 의미(계약수 vs 기초자산)와 레버리지 유무가
   *   달라서 하나로 합치면 주문 크기가 1000배 틀린다. 어느 어댑터가 쓰였는지
   *   코드에서 분명해야 한다.
   *
   * ★ 주입하지 않으면 현물 주문 경로가 존재하지 않는다(가장 안전한 기본값).
   */
  spotTradingAdapter?: IExchangeTradingAdapter;
  policy: TradingPolicy;
  symbolInfo: Record<string, SymbolInfo>;
  /*
     ★★ 현물 심볼 메타데이터. 선물과 **반드시 분리**해야 한다.

       symbolInfo 는 선물 카탈로그로 채워진다. 현물 주문을 그 값으로 검증하면
       규격이 틀린다(실측):
         · 현물에만 있는 심볼 559개 → "symbol metadata unavailable" 로 주문 차단
         · 겹치는 심볼도 최소수량이 다르다. ACEUSDT 선물 minQty=0.1 / 현물 10,
           AAVEUSDT 선물 0.01 / 현물 0.001. 선물 기준으로 통과시키면 거래소가
           거부하고, 반대로 멀쩡한 주문을 우리가 막는다.
       선물 수량은 '계약 수', 현물은 '코인 수' 라 애초에 단위가 다르다.
  */
  spotSymbolInfo?: Record<string, SymbolInfo>;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  mode: BitMartMode; // deployment mode (default READ_ONLY)
  liveTradingEnabled: boolean; // BITMART_LIVE_TRADING_ENABLED (default false)
  /*
     실주문을 열기 위해 실제로 필요한 환경변수들.

     ★★ 안내 문구가 **틀린 변수**를 말하고 있었다.

       화면은 `TRADING_MODE must be KUCOIN_LIVE` 와
       `FEATURE_LIVE_ORDERS_ENABLED is false` 를 알려줬다. 그런데 이 라우터가
       실제로 보는 값은 `BITMART_MODE` 와 `BITMART_LIVE_TRADING_ENABLED` 다.
       운영자가 안내대로 두 변수를 켜도 **주문은 계속 막힌다** — 실측으로
       확인했다. 그 상태에서 운영자는 아무 변수나 켜보게 되고, 무엇이 열렸는지
       알 수 없게 된다.

     ★ 그래서 어떤 조건이 실제로 막고 있는지 그대로 알려준다. 두 겹 플래그는
       유지한다(하나만 실수로 켜져도 실주문이 열리면 안 된다).
  */
  liveGateEnv?: {
    /** 이 배포의 거래 모드 변수 이름과 요구값. */
    modeVar: string;
    modeRequired: string;
    modeActual: string;
    /** 실주문 플래그들 — 모두 true 여야 한다. */
    flags: Array<{ name: string; value: boolean }>;
  };
  killSwitch: boolean; // BITMART_EMERGENCY_KILL_SWITCH (default true)
  /**
   * 런타임 운영 컨트롤 — 관리자 콘솔의 킬스위치를 실제로 강제한다.
   *
   * ★★ 없으면 관리자 콘솔의 '비상정지'가 실주문 경로에 아무 영향이 없다. 전에는
   *   이 라우터가 부팅 시점 env(killSwitch)만 봐서, 관리자가 콘솔에서 끄더라도
   *   재배포 전까지 실주문이 계속 나갔다. DB 기반 스코프(global_live_trading /
   *   new_positions)를 OR 로 합쳐, 하나라도 active 면 막는다(fail-safe).
   *
   * ★ 구조적 타입만 요구한다 — OperationalControls 구현에 결합하지 않는다.
   */
  controls?: { killActive(scope: string): boolean };
  /**
   * 실주문 멱등성 저장소. 없으면 프로세스 메모리로 떨어진다.
   *
   * ★★ 프로덕션에서는 반드시 주입한다. 메모리 저장소는 재시작하면 비고, 인스턴스
   *   사이에 공유되지 않는다 — 같은 키의 재시도가 거래소로 다시 나가 **중복
   *   주문**이 된다.
   */
  idempotencyStore?: import('./trading/idempotency').IdempotencyStore;
  /**
   * Futures transaction history reader (gap G5).
   *
   * A narrow optional dependency rather than a widening of `IExchangeAccountAdapter`: only the BitMart
   * futures adapter can serve this, and every other implementation of that interface would otherwise have
   * to grow a method it cannot honour.
   */
  transactionSource?: {
    getTransactionHistory(ctx: ExchangeContext, query: ExchangeTransactionQuery): Promise<ExchangeTransaction[]>;
  };
  /**
   * Real state for the risk engine.
   *
   * Eight risk inputs were hardcoded literals (`credentialStatus:'VERIFIED'`, `dailyOrderCount:0`,
   * `openPositions:0`, `marketDataStatus:'LIVE'`, …). The gates that depend on them therefore ALWAYS
   * passed: a user with no verified key passed the credential gate, and the daily-order and daily-loss
   * limits could never trigger because their inputs were constants. `countOrdersSince()` already existed
   * for exactly this purpose — its own comment says "used by the daily-order-count risk gate" — and was
   * simply never called.
   *
   * Optional so a deployment without these sources degrades to a STATED unknown rather than to a
   * fabricated pass (see `resolveRiskState`).
   */
  riskState?: {
    countOrdersSince(userId: string, since: number): number | Promise<number>;
    /** Open position count for this user, or null when it cannot be determined. */
    openPositions?(ctx: ExchangeContext): Promise<number | null>;
    /** Market data freshness for the symbol. */
    marketDataStatus?(symbol: string): 'LIVE' | 'STALE' | 'UNAVAILABLE';
  };
}

/**
 * 요청한 시장에 맞는 거래 어댑터를 고른다.
 *
 * ★★ 이 선택을 틀리면 오류가 나지 않고 **주문 수량이 틀린다.**
 *
 *   선물은 수량을 계약수로 바꿔 보낸다(BTC 1계약 = 0.001 BTC). 현물은 기초자산
 *   수량 그대로다. 그래서 현물 요청을 선물 어댑터로 보내면 1000배 큰 주문이,
 *   반대면 1000배 작은 주문이 나간다. 거래소도 화면도 정상으로 보인다.
 *
 * ★ 요청한 시장의 어댑터가 없으면 **다른 시장으로 대신 보내지 않는다.**
 *   그것은 이용자가 요청하지 않은 상품에 주문을 내는 것이다. undefined 를
 *   돌려주면 호출자가 전송을 막는다.
 *
 * ★ 판정을 한 곳에 모아 둔 이유: 라우트 안에 인라인으로 두었을 때는 이 규칙을
 *   검사로 고정할 수 없었다(주문 경로에 게이트가 여러 겹 있어 단위 검사가
 *   어렵다). 순수 함수로 빼면 규칙 자체를 직접 검사할 수 있다.
 */
export function selectTradingAdapter(
  market: unknown,
  adapters: { futures?: IExchangeTradingAdapter; spot?: IExchangeTradingAdapter },
): IExchangeTradingAdapter | undefined {
  const wanted = String(market ?? '').trim().toLowerCase();
  if (wanted === 'spot') return adapters.spot;
  /*
     'futures'·'paper'·빈 값은 모두 선물 어댑터다. 모의(paper)는 애초에 이 경로로
     오지 않지만, 온다면 선물 규칙으로 검증되는 것이 맞다.
  */
  return adapters.futures;
}

/**
 * 조회 실패가 "키 문제" 인지 "거래소 장애" 인지 가른다.
 *
 * 둘을 같은 상태코드로 주면 안 된다:
 *   · 키 문제는 사용자가 고칠 수 있는 예상된 상태다. 화면에 안내를 띄우면 된다.
 *     여기에 502 를 주면 정상 사용 중에도 브라우저 콘솔에 오류가 계속 찍히고,
 *     실제 장애를 그 소음 속에서 놓치게 된다.
 *   · 거래소 장애는 우리가 고칠 수 없고 재시도 대상이다. 502 가 맞다.
 *
 * KuCoin 오류코드: 400003 잘못된 키 / 400004 잘못된 passphrase /
 * 400005 서명 오류 / 400007 권한 없음 / 400100 파라미터 오류
 */
function describeCredentialFailure(e: Error): { message: string; isCredentialProblem: boolean } {
  const message = e.message || 'unknown error';
  const code = (e as Error & { detail?: { code?: string } }).detail?.code ?? '';

  const credentialCodes = new Set(['400003', '400004', '400005', '400007', '400100']);
  const looksLikeKeyProblem =
    credentialCodes.has(code) ||
    // 코드가 없는 경우를 대비한 문구 검사. 거래소가 문구만 바꿔도 동작해야 한다.
    /api key|apikey|signature|passphrase|permission|does not exist|invalid key/i.test(message);

  return { message, isCredentialProblem: looksLikeKeyProblem };
}


/**
 * 차단 이유를 **이 배포에서 실제로 존재하는 이름**으로 바꾼다.
 *
 * ★★ 왜 필요한가
 *
 *   게이트 로직은 `packages/exchange-bitmart/src/modes.ts` 에 있고, 그 문구가
 *   BitMart 전용이다. KuCoin 으로 전환한 뒤에도 사용자와 운영자는 이런 문구를
 *   받고 있었다:
 *
 *     "mode BITMART_LIVE_READ_ONLY does not permit live orders"
 *     "BITMART_LIVE_TRADING_ENABLED is false"
 *
 *   둘 다 거짓이다. 사용자는 BitMart 를 쓰지 않고, 두 번째 환경변수는 이
 *   배포에 존재하지 않는다 — 실주문을 여는 조건은 `FEATURE_LIVE_ORDERS_ENABLED`
 *   와 `TRADING_MODE` 다.
 *
 *   그 결과가 나쁘다: 운영자가 실주문을 열려고 없는 변수를 찾는다. 못 찾으면
 *   아무 변수나 켜보게 되고, 그 과정에서 무엇이 열렸는지 알 수 없게 된다.
 *
 * ★ 게이트 로직 자체는 건드리지 않는다. BitMart 패키지의 테스트 123개가 그
 *   문구를 고정하고 있고, 로직은 옳다 — 잘못된 것은 **표시**뿐이다.
 */
function localizeGateReasons(
  reasons: readonly string[],
  exchangeId: string,
  env?: TradingRouterDeps['liveGateEnv'],
): string[] {
  const ex = exchangeId.toUpperCase();
  return reasons.map((r) => {
    /*
       모드 조건. **실제로 검사하는 변수 이름**을 말한다.

       ★ 주입되지 않았으면 변수 이름을 추측하지 않는다 — 틀린 이름을 알려주는
         것이 이 자리에서 겪은 실수였다. 조건만 밝히고 이름은 생략한다.
    */
    if (/does not permit live orders/.test(r)) {
      if (!env) return `live orders are not enabled for this deployment (${ex})`;
      return `live orders are not enabled for this deployment (${ex}) — `
        + `${env.modeVar} must be ${env.modeRequired} (currently ${env.modeActual})`;
    }
    if (/BITMART_LIVE_TRADING_ENABLED is false/.test(r)) {
      if (!env) return 'the live-order flag is off';
      // 실제로 꺼져 있는 플래그만 나열한다. 켜져 있는 것을 켜라고 말하지 않는다.
      const off = env.flags.filter((f) => !f.value).map((f) => f.name);
      return off.length > 0
        ? `these must be true: ${off.join(', ')}`
        : 'the live-order flag is off';
    }
    // 'Future-Trade' 는 BitMart 의 권한 이름이다. 거래소 중립 표현으로 바꾼다.
    if (/Future-Trade permission not verified/.test(r)) {
      return 'the API key has not been verified as allowing futures trading';
    }
    return r;
  });
}

export function createTradingRouter(d: TradingRouterDeps): Hono {
  const app = new Hono();
  /*
     ★★ 실주문 멱등성 저장소.

       주입되면 그것을 쓴다(프로덕션 = PostgreSQL). 없으면 메모리로 떨어진다
       (개발·테스트). 메모리는 프로세스 안에서만 유효하므로 **재시작·다중
       인스턴스에서 중복 주문을 막지 못한다** — 그래서 실주문이 열려 있는데
       저장소가 메모리면 부팅 때 경고한다(index.ts).
  */
  const idem = new IdempotencyService(d.idempotencyStore ?? new MemoryIdempotencyStore());

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  /**
   * Resolves the risk-engine state from real sources.
   *
   * Where a value cannot be determined it is resolved to the SAFE side and the fact is reported, never to a
   * silent pass. An unknown open-position count must not satisfy a position limit.
   */
  async function resolveRiskState(
    userId: string,
    userStatus: string,
    symbol: string,
  ): Promise<{
    credentialStatus: 'VERIFIED' | 'FAILED' | 'NONE';
    futureTradePermissionVerified: boolean;
    dailyOrderCount: number;
    openPositions: number;
    marketDataStatus: 'LIVE' | 'STALE' | 'UNAVAILABLE';
    unknown: string[];
  }> {
    const unknown: string[] = [];

    // Credential status from the store, not assumed. A user with no key must not pass the credential gate.
    const creds = await d.credRepo.listOwned(userId);
    const verified = creds.find((r) => r.connectionStatus === 'VERIFIED');
    const credentialStatus = verified ? 'VERIFIED' : creds.length > 0 ? 'FAILED' : 'NONE';
    // The store records that a read-only probe succeeded; it does NOT prove Future-Trade permission.
    // Claiming it does would let an order through on a key that cannot place one.
    const futureTradePermissionVerified = verified?.permissionsVerified === true;
    if (verified && !futureTradePermissionVerified) unknown.push('futureTradePermission');

    let dailyOrderCount = 0;
    if (d.riskState) {
      const since = Date.now() - 86_400_000;
      dailyOrderCount = await d.riskState.countOrdersSince(userId, since);
    } else {
      unknown.push('dailyOrderCount');
    }

    let openPositions = 0;
    if (d.riskState?.openPositions && verified) {
      try {
        const cred = await d.vault.decrypt((await d.credRepo.getOwned(userId, verified.id))!);
        const n = await d.riskState.openPositions({ mode: 'BITMART_LIVE_READ_ONLY', credential: cred });
        if (n === null) unknown.push('openPositions');
        else openPositions = n;
      } catch {
        unknown.push('openPositions');
      }
    } else if (verified) {
      unknown.push('openPositions');
    }

    const marketDataStatus = d.riskState?.marketDataStatus?.(symbol) ?? 'UNAVAILABLE';
    if (!d.riskState?.marketDataStatus) unknown.push('marketDataStatus');

    /*
       ★★ 일일 실현손실은 **아직 출처가 없다.** 그 사실을 반드시 보고한다.

         아래 buildRiskInput 은 dailyLossSoFar 에 '0' 을 넣는다. 그러면
         risk-engine 의 일일손실 한도 게이트가 `0 <= 한도` 로 **항상 통과**한다.
         주석에는 "unknown 으로 보고한다" 고 적혀 있었지만 실제로는 아무 곳에도
         보고되지 않았다 — 운영자와 이용자 모두 손실 한도가 지켜지고 있다고
         믿게 되는, 사실과 다른 상태였다.

       ★ 여기서 게이트를 강제로 실패시키지는 않는다. 그러면 손실 데이터가 없는
         모든 이용자의 주문이 막힌다(지금 라이브 서비스다). 대신 unknownInputs 에
         담아 화면·감사기록·학습기록에 '모른다' 는 사실이 남게 한다.

       ★ 제대로 고치려면 trade_journal 의 dailyPnl(userId, {from,to}) 을 이
         라우터에 주입해 오늘자 실현손실을 읽어야 한다. 그건 별도 작업이다.
    */
    unknown.push('dailyLossSoFar');

    void userStatus;
    return { credentialStatus, futureTradePermissionVerified, dailyOrderCount, openPositions, marketDataStatus, unknown };
  }

  /** Builds the risk-engine input from a request body plus resolved real state. */
  async function buildRiskInput(
    userId: string,
    userStatus: string,
    body: Record<string, unknown>,
    confirmationTokenValid: boolean,
    idempotencyKeyValid: boolean,
  ) {
    const symbol = String(body.symbol ?? 'BTCUSDT');
    const st = await resolveRiskState(userId, userStatus, symbol);
    // ★ 현물 주문은 현물 규격으로 검증한다. 선물 규격을 쓰면 단위가 달라 틀린다.
    const isSpot = body.market === 'spot';
    const metaSource = isSpot && d.spotSymbolInfo ? d.spotSymbolInfo : d.symbolInfo;
    return {
      st,
      symbolId: symbol,
      input: {
        mode: d.mode,
        symbol: metaSource[symbol],
        side: (body.side as 'long' | 'short') ?? 'long',
        orderType: (body.orderType as 'market' | 'limit') ?? 'limit',
        price: body.price as string | undefined,
        quantity: String(body.quantity ?? '0'),
        leverage: Number(body.leverage ?? 1),
        /*
           ★★ 위험 게이트가 보는 손절·익절은 **브래킷 값과 같은 것**이다.

             전에는 body.stopLoss / body.takeProfit 만 읽었다. 화면은 그 이름을
             보내지 않으므로 slDir·tpDir 게이트가 항상 "설정 안 됨" 으로 남았다 —
             방향이 뒤집힌 손절도 게이트를 통과했다.

           ★ 이름을 하나로 합치지 않고 둘 다 받는다. 화면이 쓰는 이름
             (takeProfitPrice/stopLossPrice)은 어댑터로도 그대로 가야 하고,
             기존 호출자(body.stopLoss)를 깨뜨릴 이유는 없다.
        */
        stopLoss: (body.stopLoss ?? body.stopLossPrice) as string | undefined,
        takeProfit: (body.takeProfit ?? body.takeProfitPrice) as string | undefined,
        riskReward: body.riskReward as string | undefined,
        maxEstLoss: body.maxEstLoss as string | undefined,
        positionValue: body.positionValue as string | undefined,
        referencePrice: body.referencePrice as string | undefined,
        policy: d.policy,
        liveTradingEnabled: d.liveTradingEnabled,
        /*
           ★★ 비상정지 = 부팅 env(killSwitch) **또는** 관리자 콘솔의 런타임 킬스위치.

             둘 중 하나라도 켜지면 막는다(fail-safe). 전에는 이 라우터가 controls 를
             받지 못해 콘솔 스위치가 무력했다.

           ★★ 검사 대상을 이름으로 나열하지 않고 ORDER_BLOCKING_KILL_SCOPES 를 쓴다.
             나열하던 시절 'bitmart_live_trading' 이 목록에서 빠져 **켜도 주문이
             나갔다.** 목록을 한 곳에서 가져오면 스코프를 추가할 때 강제 경로가
             함께 따라온다.
        */
        emergencyKillSwitch:
          d.killSwitch
          || ORDER_BLOCKING_KILL_SCOPES.some((sc) => d.controls?.killActive(sc) ?? false),
        userStatus,
        previewExpired: false,
        confirmationTokenValid,
        idempotencyKeyValid,
        // Connectivity is only healthy if market data is actually live.
        exchangeConnectivityHealthy: st.marketDataStatus === 'LIVE',
        credentialStatus: st.credentialStatus,
        futureTradePermissionVerified: st.futureTradePermissionVerified,
        dailyOrderCount: st.dailyOrderCount,
        /*
           ★ 출처가 없다. 이 값이 '0' 이면 일일손실 게이트가 항상 통과한다는 뜻이고,
             그 사실은 resolveRiskState 에서 unknownInputs('dailyLossSoFar') 로
             보고된다. 여기서 조용히 0 을 넣고 끝내지 않는다.
        */
        dailyLossSoFar: '0',
        openPositions: st.openPositions,
        marketDataStatus: st.marketDataStatus,
      },
    };
  }

  /**
   * POST /trading/orders/validate — dry run.
   *
   * Returns the FULL gate list so the UI can show the checklist BEFORE submitting. `submit` only returns
   * pass/fail plus reasons, so without this a user learns which gate blocked them only after pressing the
   * button — and the design's pre-submit checklist could not be built from real data at all.
   *
   * Transmits nothing and writes nothing.
   */
  app.post('/trading/orders/validate', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', ''), 403);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // A dry run has no idempotency key and no confirmation token yet; both are reported as pending gates
    // rather than asserted true.
    const { st, input, symbolId } = await buildRiskInput(a.user.id, a.user.status, body, false, false);
    const risk = runRiskEngine(input);
    return c.json({
      symbol: symbolId,
      pass: risk.pass,
      failCount: risk.failCount,
      gates: risk.gates,
      liveGate: risk.liveGate,
      reasons: risk.reasons,
      // Which inputs could not be determined. A consumer must not read a passing gate whose input is
      // unknown as a real pass.
      unknownInputs: st.unknown,
      state: {
        credentialStatus: st.credentialStatus,
        futureTradePermissionVerified: st.futureTradePermissionVerified,
        dailyOrderCount: st.dailyOrderCount,
        openPositions: st.openPositions,
        marketDataStatus: st.marketDataStatus,
      },
      posture: { mode: d.mode, liveTradingEnabled: d.liveTradingEnabled, emergencyKillSwitch: d.killSwitch },
      dryRun: true,
      note: 'dry run — nothing transmitted, nothing stored',
    });
  });

  // ---- credentials ----

  /**
   * 내가 등록한 거래소 키 목록.
   *
   * ★★ 이 경로가 없었다. 저장·검증·삭제는 있는데 **목록 조회가 빠져 있었다.**
   *   그래서 설정 화면의 'API Keys' 탭이 목업 배열(`QTApp.USER.apiKeys`)을 읽었고,
   *   실계정으로 바꾼 뒤 그 필드가 사라져 `undefined.map` 으로 **화면 전체가
   *   죽었다.** 탭을 누르면 설정 화면이 통째로 하얗게 됐다.
   *
   * ★ 비밀키·메모는 절대 내보내지 않는다. 마스킹된 접근키와 상태만 준다 —
   *   화면에 필요한 것은 "어떤 키가 등록돼 있고 검증됐는가" 뿐이다.
   */
  app.get('/trading/credentials', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);

    const rows = await d.credRepo.listOwned(a.user.id);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        // 어느 거래소 키인지. 화면이 로고를 고르는 데 쓴다.
        exchange: r.exchange || d.exchangeId,
        label: r.label ?? null,
        accessKeyMasked: r.accessKeyMasked,
        connectionStatus: r.connectionStatus,
        /*
           권한 검증 여부.

           ★ 거래소가 어떤 권한을 줬는지는 알 수 없다. 우리가 아는 것은
             "잔고 조회가 성공했는가"(permissionsVerified) 뿐이다.
             그 사실만 그대로 전달한다.
        */
        permissionsVerified: Boolean(r.permissionsVerified),
        ipWhitelistConfirmed: Boolean(r.ipWhitelistConfirmed),
        /*
           권한 목록.

           ★ 우리는 거래소 키의 권한을 알 수 없다. 검증 시 잔고 조회가
             성공하는지만 확인한다. 그래서 지어내지 않고 빈 배열을 준다 —
             화면이 '확인되지 않음' 으로 표시한다.
        */
        permissions: [],
      })),
      exchange: d.exchangeId,
    });
  });

  app.post('/trading/credentials', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'account.update.self')) return c.json(err('FORBIDDEN', ''), 403);
    const body = (await c.req.json().catch(() => ({}))) as { accessKey?: string; secretKey?: string; memo?: string; label?: string };
    if (!body.accessKey || !body.secretKey || !body.memo) return c.json(err('BAD_REQUEST', 'accessKey, secretKey, memo required'), 400);
    const enc = await d.vault.encrypt({ accessKey: body.accessKey, secretKey: body.secretKey, memo: body.memo });
    // 어느 거래소 키인지 기록한다. 화면이 그 값을 그대로 보여준다.
    const row = await d.credRepo.create(a.user.id, enc, body.label, d.exchangeId);
    // Response NEVER includes secret/memo — only the masked access key + status.
    return c.json({ id: row.id, accessKeyMasked: row.accessKeyMasked, connectionStatus: row.connectionStatus }, 201);
  });

  app.post('/trading/credentials/:id/verify', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const row = await d.credRepo.getOwned(a.user.id, c.req.param('id'));
    if (!row) return c.json(err('NOT_FOUND', 'credential not found'), 404); // ownership
    try {
      const cred = await d.vault.decrypt(row); // server-side only
      const ctx: ExchangeContext = { mode: 'BITMART_LIVE_READ_ONLY', credential: cred };
      await d.accountAdapter.getBalances(ctx); // Read-Only probe (no order permission needed)
      await d.credRepo.setVerified(a.user.id, row.id, 'VERIFIED', true);
      return c.json({ id: row.id, connectionStatus: 'VERIFIED', permissionsVerified: true });
    } catch (e) {
      await d.credRepo.setVerified(a.user.id, row.id, 'FAILED', false);
      return c.json({ id: row.id, connectionStatus: 'FAILED', reason: (e as Error).message });
    }
  });

  app.delete('/trading/credentials/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    return (await d.credRepo.revoke(a.user.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(err('NOT_FOUND', ''), 404);
  });

  /**
   * GET /trading/transactions — the user's own exchange futures money movements.
   *
   * This is `/wallet/transactions` (gap G5) under the non-custodial model. We hold no funds, so there is no
   * QuantumTrade ledger to show; the real one lives on the exchange and the user's Read-only key can read
   * it. Transfers, realized PnL, funding fees, commission fees and liquidations.
   */
  app.get('/trading/transactions', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);

    const parsed = ExchangeTransactionQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    // The rejected input is never echoed back.
    if (!parsed.success) return c.json(err('BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid query'), 400);

    if (!d.transactionSource) {
      // Not configured is NOT "no transactions": an empty list would render as a genuinely empty ledger.
      return c.json({ ...err('NOT_CONFIGURED', 'transaction history reader is not configured'), configured: false }, 503);
    }

    // The first VERIFIED credential. An unverified key would fail upstream with an opaque 401.
    const owned = await d.credRepo.listOwned(a.user.id);
    const verified = owned.find((r) => r.connectionStatus === 'VERIFIED');
    if (!verified) {
      /*
         키를 연결하지 않은 것은 **정상 상태**다. 오류가 아니다.

         예전에는 409 를 돌려줬는데, 그러면 키를 연결하지 않은 모든 사용자의
         브라우저 콘솔에 오류가 계속 찍힌다(실제로 확인했다). 정상 사용 중의
         소음 속에서 진짜 장애를 놓치게 된다.

         다른 조회 라우트(balances/positions/open-orders 등)와 같은 형태로
         200 + credentialStatus 를 돌려준다.
      */
      return c.json({
        /*
           ★★ 성공 분기는 `items` 를 준다. 여기서 `transactions` 를 주면 화면이
             읽는 칸이 달라서, 키가 없을 때 **표가 아예 렌더되지 않는다.**
             같은 라우트가 두 이름을 쓰면 어느 쪽이 맞는지 알 수 없다.
        */
        items: [],
        totals: [],
        credentialStatus: owned.length > 0 ? (owned[0]!.connectionStatus ?? 'UNVERIFIED') : 'NONE',
        hasCredential: owned.length > 0,
        source: 'exchange',
        configured: true,
      });
    }

    try {
      const row = await d.credRepo.getOwned(a.user.id, verified.id);
      if (!row) return c.json(err('NOT_FOUND', 'credential not found'), 404);
      const credential = await d.vault.decrypt(row); // server-side only; never leaves this process
      const ctx: ExchangeContext = { mode: 'BITMART_LIVE_READ_ONLY', credential };
      const items = await d.transactionSource.getTransactionHistory(ctx, parsed.data);

      /*
         ★★ 학습 손익을 여기서 모은다.

           이 라우트는 `exchangeRead` 를 거치지 않는다(응답 형태가 달라 직접
           만든다). 그래서 `collectOutcomes` 가 자동으로 불리지 않아, 원장을
           손에 들고도 손익을 버리고 있었다.

         ★ 조회를 막지 않는다 — 안에서 예외를 삼킨다.
      */
      await collectOutcomes(a.user.id, 'transactions', items);

      return c.json({
        items,
        totals: summarizeTransactions(items),
        // Stated so a truncated window is not read as "no activity". Upstream returns the last 7 days when
        // no range is given, and at most `page_size` rows.
        window: {
          explicit: parsed.data.startTime !== undefined || parsed.data.endTime !== undefined,
          defaultWindowDays: TRANSACTION_HISTORY_LIMITS.defaultWindowDays,
          pageSize: parsed.data.pageSize ?? TRANSACTION_HISTORY_LIMITS.defaultPageSize,
          truncated: items.length >= (parsed.data.pageSize ?? TRANSACTION_HISTORY_LIMITS.defaultPageSize),
        },
        /*
           ★★ 'BITMART_EXCHANGE' 가 박혀 있었다.

             KuCoin 키로 조회해도 응답이 `source: "BITMART_EXCHANGE"` 였다. 우리는
             KuCoin 브로커인데 응답이 다른 거래소를 말한다 — 화면이나 로그를 보고
             원인을 찾을 때 잘못된 곳을 뒤지게 된다.

           ★ 같은 라우트의 다른 분기는 `source: 'exchange'` 를 쓴다. 같은 값으로
             통일한다(거래소 이름은 `exchange` 칸이 이미 말한다).
        */
        source: 'exchange',
        exchange: verified.exchange,
        /*
           ★★ credentialStatus 가 빠져 있었다.

             다른 조회 라우트는 모두 이 값을 준다. 화면은 이것으로 "키가 없다" 와
             "거래가 없다" 를 구분해 안내를 고른다. 없으면 키를 연결한 이용자에게도
             "거래소 키를 연결하세요" 가 뜨거나, 반대로 키가 없는 사람에게 빈 표만
             보여준다.
        */
        credentialStatus: verified.connectionStatus ?? 'VERIFIED',
        hasCredential: true,
        servedAt: Date.now(),
      });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /**
   * GET /me/tier — 내 등급.
   *
   * ★★ 계산 근거를 함께 준다. 등급만 주면 이용자는 무엇을 해야 올라가는지
   *   알 수 없고, 우리가 임의로 정한다고 느낀다.
   *
   * ★ 숫자는 **실거래만** 센다. 모의 거래는 등급에 넣지 않는다 — 우리 서버가
   *   즉시 체결시키므로 버튼 몇 번으로 최고 등급이 된다.
   *
   * ★ 문구는 번역 키로 준다(nameKey). 서버는 이용자의 언어를 모른다.
   */
  app.get('/me/tier', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.tiers) return c.json({ configured: false }, 200);

    try {
      /*
         거래소 키가 검증됐는가 — 측정 가능 여부를 정한다.

         ★★ 키가 없으면 거래 금액을 **알 수 없다**(조회 자체가 불가능하다).
           0 으로 계산하면 실제로 많이 거래한 고객이 키 재연결 중에 강등된다.
      */
      const owned = await d.credRepo.listOwned(a.user.id);
      const verified = owned.some((x) => x.connectionStatus === 'VERIFIED');

      const [defs, metrics, payoutsEnabled] = await Promise.all([
        d.tiers.definitions(),
        d.tiers.metrics(a.user.id, verified),
        d.tiers.payoutsEnabled(),
      ]);
      const result = evaluateTier(metrics, defs);

      // 계산 결과를 남긴다 — 운영자가 분포를 보고 기준을 조정한다.
      await d.tiers.saveState({
        userId: a.user.id,
        tierCode: result.tier ? result.tier.code : null,
        metrics,
        criteria: defs,
      });

      return c.json({
        configured: true,
        /*
           ★ 측정 불가면 등급이 null 이고 unknown 이 true 다. 화면은 이 값으로
             '—' 와 "키를 연결하세요" 를 고른다.
        */
        unknown: result.unknown,
        tier: result.tier
          ? { code: result.tier.code, nameKey: result.tier.nameKey, rank: result.tier.rank,
              benefitKey: result.tier.benefitKey,
              /*
                 ★ 우리 커미션 중 돌려주는 비율 (만분율). 화면이 /100 해서 % 로 쓴다.
              */
              rebateShareBps: result.tier.rebateShareBps }
          : null,
        /*
           ★★ 환급이 실제로 집행되는가.
 
             false 면 화면은 비율을 **"예정"** 으로만 보여주고 금액을 말하지 않는다.
             우리는 리베이트가 실제로 입금되는 것을 아직 확인하지 못했다 —
             확인 전에 금액을 말하면 지킬 수 없는 약속이 된다.
        */
        benefitsPayoutsEnabled: payoutsEnabled,
        next: result.next
          ? {
            code: result.next.tier.code,
            nameKey: result.next.tier.nameKey,
            missing: result.next.missing,
            /*
               ★★ 추천 가입은 **소급되지 않는다.** 이미 거래소 계정이 있던 고객은
                 이 조건을 채울 방법이 없다. 화면이 그 사실을 말해야 한다 —
                 채울 수 없는 조건을 목표로 보여주면 거짓 기대를 만든다.
            */
            referralUnreachable: result.next.missing.some((m) => m.key === 'referral'),
          }
          : null,
        metrics: {
          measurable: metrics.measurable,
          volume30d: metrics.volume30d,
          trades30d: metrics.trades30d,
          activeDays30d: metrics.activeDays30d,
          referred: metrics.referred,
          /*
             ★ 금액을 모르는 체결이 몇 건 섞였는지 밝힌다. 합계가 실제보다
               작다는 사실을 숨기면 이용자가 우리 계산을 틀렸다고 여긴다.
          */
          volumeUnknownRows: metrics.volumeUnknownRows,
        },
        /* 기준을 그대로 준다 — 화면이 "다음 등급까지 얼마" 를 계산한다. */
        criteria: defs.map((x) => ({
          code: x.code, nameKey: x.nameKey, rank: x.rank,
          minVolume30d: x.minVolume30d, minTrades30d: x.minTrades30d,
          minActiveDays30d: x.minActiveDays30d, requiresReferral: x.requiresReferral,
          /* 등급표에 "환급 O%" 를 그리려면 등급별 값이 필요하다. */
          rebateShareBps: x.rebateShareBps, benefitKey: x.benefitKey,
        })),
        computedAt: Date.now(),
      });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  app.get('/trading/connection-status', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    return c.json({
      // `mode` 는 BitMart 시절 표기를 유지한다(기존 소비자 호환).
      mode: d.mode,
      /*
         중립 표기. KuCoin 배포에서 'BITMART_LIVE_READ_ONLY' 를 그대로 보여주면
         사용자가 어느 거래소에 연결됐는지 오해한다. 접두사를 떼고 접근 수준만 남긴다.
      */
      exchange: d.exchangeId,
      accessMode: d.mode.replace(/^[A-Z]+_LIVE_/, ''),
      liveTradingEnabled: d.liveTradingEnabled,
      emergencyKillSwitch: d.killSwitch,
      // `exchange` is projected because the row carries it and the wallet UI cannot otherwise say which
      // exchange a stored key belongs to. Today the store only ever writes 'bitmart' (see
      // SqliteCredentialRepo.create), so this is a factual label, not a promise of multi-exchange support.
      credentials: (await d.credRepo.listOwned(a.user.id)).map((r) => ({ id: r.id, exchange: r.exchange, label: r.label, accessKeyMasked: r.accessKeyMasked, connectionStatus: r.connectionStatus })),
    });
  });

/**
   * GET /trading/balances — 사용자 본인의 거래소 선물 잔고.
   *
   * 우리는 자금을 보관하지 않는다(비수탁). 그래서 우리 원장에는 잔고가 없고,
   * 실제 값은 거래소에 있다. 사용자의 읽기 전용 키로 조회해 보여준다.
   *
   * 검증된 자격증명이 없으면 빈 배열이 아니라 명시적 상태를 돌려준다.
   * 빈 배열은 "잔고가 0" 으로 읽히고, 사용자는 자금이 사라진 줄 안다.
   */
  app.get('/trading/balances', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);

    const rows = await d.credRepo.listOwned(a.user.id);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) {
      return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange' });
    }

    try {
      const full = await d.credRepo.getOwned(a.user.id, usable.id);
      if (!full) return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange' });
      const credential = await d.vault.decrypt(full);
      const balances = await d.accountAdapter.getBalances({ mode: d.mode, credential });

      /*
         자산 이력 기록.

         ★★ **조회가 성공한 이 지점에서만** 남긴다. catch 블록에서 0 을 기록하면
           자산곡선에 없던 급락이 그려지고 사용자가 자산을 잃은 줄 안다.

         ★ 하루 한 행이므로 같은 날 여러 번 조회해도 행이 늘지 않는다(갱신).

         ★ 기록 실패가 잔고 조회를 되돌리면 안 된다. 사용자가 보려던 것은
           잔고이고, 이력은 부가 기능이다.

         ★ 통화를 섞지 않는다. USDT 항목만 합산한다 — 여러 통화를 그냥 더하면
           숫자가 의미를 잃는다(1 BTC + 1 USDT = 2 ?).
      */
      if (d.equitySnapshots) {
        const usdt = balances.filter((b) => String(b.asset).toUpperCase() === 'USDT');
        const num = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };
        // USDT 잔고가 없으면 기록하지 않는다 — 0 을 남기면 자산이 0 이라는 뜻이 된다.
        if (usdt.length > 0) {
          await d.equitySnapshots
            .record({
              userId: a.user.id,
              equity: usdt.reduce((acc, b) => acc + num(b.equity), 0),
              available: usdt.reduce((acc, b) => acc + num(b.available), 0),
              used: usdt.reduce((acc, b) => acc + num(b.used), 0),
              // 미실현 손익은 잔고 응답에 없다. 모르는 것을 0 으로 만들지 않는다.
              unrealizedPnl: null,
              currency: 'USDT',
              source: 'exchange',
            })
            .catch(() => { /* 이력 기록 실패가 잔고 조회를 되돌리지 않는다 */ });
        }
      }

      return c.json({
        balances,
        credentialStatus: usable.connectionStatus,
        credentialId: usable.id,
        source: 'exchange',
        asOf: Date.now(),
      });
    } catch (e) {
      /*
         조회 실패를 0 으로 위장하지 않는다. 화면이 "확인 불가" 를 보여줘야 한다.

         상태코드를 나눈다:
           200 + credentialStatus  키가 잘못됐다 — 예상 가능한 상태다.
                                   502 로 주면 브라우저가 콘솔 에러를 남기고,
                                   정상 화면에 붉은 오류가 매번 찍힌다.
           502                     거래소·네트워크 장애 — 진짜 상류 실패다.
      */
      const detail = describeCredentialFailure(e as Error);
      if (detail.isCredentialProblem) {
        return c.json({
          balances: [],
          credentialStatus: 'FAILED',
          credentialId: usable.id,
          source: 'exchange',
          reason: detail.message,
        });
      }
      return c.json(
        { error: { code: 'UPSTREAM_ERROR', message: detail.message }, credentialStatus: usable.connectionStatus },
        502,
      );
    }
  });

  /**
   * GET /trading/positions — 사용자 본인의 거래소 보유 포지션.
   *
   * 수량은 기초자산 단위다. 거래소가 주는 계약수를 그대로 쓰면 BTC 1계약
   * (0.001 BTC)을 1 BTC 로 표시한다 — 어댑터가 승수를 곱해 정규화한다.
   */
  /*
     GET /trading/balances/spot — 사용자 본인의 KuCoin **현물(Spot)** 잔고.

     선물 잔고(/trading/balances)와 **완전히 별개 계정**이다. 예전에는 선물 잔고만
     조회해서, 스팟에만 자금이 있는 이용자가 잔고를 못 보거나 "선물에 그 금액이
     있다" 고 오해했다. 여기서 스팟 trade 계정을 직접 조회해 분리해서 돌려준다.
  */
  app.get('/trading/balances/spot', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    // 스팟 어댑터가 주입된 배포에서만 지원한다. 미주입이면 미지원을 명시(빈 배열 위장 금지).
    const spot = d.spotTradingAdapter as (undefined | { getBalances?: (ctx: { mode: BitMartMode; credential: unknown }) => Promise<unknown[]> });
    if (!spot || typeof spot.getBalances !== 'function') {
      return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange', market: 'spot', supported: false });
    }
    const rows = await d.credRepo.listOwned(a.user.id);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange', market: 'spot' });
    try {
      const full = await d.credRepo.getOwned(a.user.id, usable.id);
      if (!full) return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange', market: 'spot' });
      const credential = await d.vault.decrypt(full);
      const balances = await spot.getBalances({ mode: d.mode, credential });
      return c.json({ balances, credentialStatus: usable.connectionStatus, credentialId: usable.id, source: 'exchange', market: 'spot', asOf: Date.now() });
    } catch (e) {
      // 조회 실패를 0 으로 위장하지 않는다 — 상태를 그대로 알린다.
      const detail = describeCredentialFailure(e as Error);
      return c.json({ balances: [], credentialStatus: 'FAILED', source: 'exchange', market: 'spot', detail }, 200);
    }
  });

  app.get('/trading/positions', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    return exchangeRead(c, a.user.id, 'positions', (ctx) => d.accountAdapter.getPositions(ctx));
  });

/**
   * 검증된 자격증명을 복호화해 거래소 조회 컨텍스트를 만든다.
   *
   * 잔고·포지션·주문 라우트가 같은 절차를 반복하므로 한 곳에 모은다.
   * 실수로 다른 사용자의 자격증명을 쓰는 사고를 막으려면 소유권 확인
   * (getOwned) 이 반드시 이 안에 있어야 한다.
   */
  async function resolveExchangeContext(userId: string): Promise<
    | { ok: true; ctx: ExchangeContext; credentialId: string; status: string }
    | { ok: false; reason: 'NONE' }
  > {
    const rows = await d.credRepo.listOwned(userId);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) return { ok: false, reason: 'NONE' };
    const full = await d.credRepo.getOwned(userId, usable.id);
    if (!full) return { ok: false, reason: 'NONE' };
    const credential = await d.vault.decrypt(full);
    return {
      ok: true,
      ctx: { mode: d.mode, credential },
      credentialId: usable.id,
      status: usable.connectionStatus,
    };
  }

  /**
   * 거래소 조회 라우트의 공통 처리.
   *
   * 자격증명 없음 / 키 문제 / 상류 장애를 각각 다른 응답으로 나눈다.
   * 키 문제에 502 를 주면 정상 사용 중에도 브라우저 콘솔에 오류가 계속 찍혀
   * 진짜 장애를 놓치게 된다.
   */
  /**
   * 조회 결과에서 학습 결과를 모은다.
   *
   * ★ 던지지 않는다. 여기서 예외가 나가면 이용자의 조회가 실패한다.
   */
  async function collectOutcomes(userId: string, key: string, data: unknown): Promise<void> {
    if (!d.learning) return;
    /*
       주문·체결·원장만 결과의 근거가 된다. 잔고·포지션 조회로는 결과를 만들 수 없다.

       ★★ 'transactions' 를 뒤늦게 추가했다.

         `attributeRealizedPnl` 을 만들어 두고 **부르는 곳이 없었다.** 그래서 결과가
         `filled` 까지만 쌓이고 손익이 영원히 비어 있었다 — 학습 표본으로는
         "주문이 체결됐다" 만 알고 "그래서 얼마를 벌었나" 를 모르는 상태였다.

       ★ 왜 실거래를 열기 전에 붙여야 하나
         손익은 거래소 원장에서 읽는다. 조회 창(기본 7일)을 지나면 사라지므로,
         나중에 붙여도 **그 사이 거래는 소급해서 채울 수 없다.**
    */
    if (key !== 'orders' && key !== 'fills' && key !== 'transactions') return;
    if (!Array.isArray(data) || data.length === 0) return;

    try {
      /*
         최근 30일치 판단만 본다.

         ★ 전체를 읽으면 화면을 열 때마다 표를 훑는다. 30일보다 오래된 주문이
           지금 체결되는 일은 없다(미체결 주문도 거래소가 그 전에 만료시킨다).
      */
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const decisions = await d.learning.recentDecisionsForOutcome(userId, since);
      if (decisions.length === 0) return;

      const already = await d.learning.existingOutcomeKeys(decisions.map((x) => x.id));

      /*
         ★ 주문 조회에서는 주문 상태를, 체결 조회에서는 수수료·평균가를 얻는다.
           한 번의 조회로는 둘 중 하나만 있으므로, 있는 것으로 만들 수 있는
           결과만 만든다 — 없는 값을 채우지 않는다.
      */
      const rows = data as Array<Record<string, unknown>>;
      const orders = key === 'orders'
        ? rows
          .filter((o) => typeof o.clientOrderId === 'string' && o.clientOrderId !== '')
          .map((o) => ({
            clientOrderId: String(o.clientOrderId),
            exchangeOrderId: typeof o.exchangeOrderId === 'string' ? o.exchangeOrderId : undefined,
            symbol: String(o.symbol ?? ''),
            side: (o.side === 'short' ? 'short' : 'long') as 'long' | 'short',
            price: o.price === null || o.price === undefined ? undefined : String(o.price),
            quantity: String(o.quantity ?? '0'),
            filledQuantity: String(o.filledQuantity ?? '0'),
            status: String(o.status ?? ''),
            createdAt: Number(o.createdAt ?? 0),
            updatedAt: Number(o.updatedAt ?? o.createdAt ?? 0),
          }))
        : [];

      const fills = key === 'fills'
        ? rows.map((f) => ({
          orderId: typeof f.orderId === 'string' ? f.orderId : undefined,
          clientOrderId: typeof f.clientOrderId === 'string' ? f.clientOrderId : undefined,
          symbol: String(f.symbol ?? ''),
          price: String(f.price ?? '0'),
          quantity: String(f.quantity ?? '0'),
          fee: f.fee === null || f.fee === undefined ? null : String(f.fee),
          at: Number(f.at ?? f.time ?? 0),
        }))
        : [];

      /*
         ★ 원장 조회는 손익을 붙인다 — 주문 경로와 별개다.

           원장에는 clientOid 가 없다. 그래서 정확 매칭이 불가능하고, 심볼과
           시각으로 **가장 최근 진입에 추정으로** 잇는다. 추정임을 데이터에
           남기려고 `observedFrom: 'position_diff'` 로 기록된다.
      */
      if (key === 'transactions') {
        const entries = (data as Array<Record<string, unknown>>)
          /*
             실현손익과 청산만 본다.

             ★ 수수료(COMMISSION_FEE)·펀딩비(FUNDING_FEE)·이체(TRANSFER)를 넣으면
               거래 손익이 아닌 것이 손익으로 학습된다. 특히 이체는 금액이 커서
               표본을 크게 망친다.
          */
          .filter((r) => r.kind === 'REALIZED_PNL' || r.kind === 'LIQUIDATION_CLEARANCE')
          .filter((r) => typeof r.symbol === 'string' && r.symbol !== '')
          .map((r) => ({
            symbol: String(r.symbol),
            amount: String(r.amount ?? '0'),
            at: Number(r.time ?? 0),
            kind: String(r.rawType ?? r.kind ?? ''),
          }))
          .filter((r) => Number.isFinite(r.at) && r.at > 0);

        if (entries.length === 0) return;

        /*
           `already` 는 `${decisionId}:${kind}` 형식이다. 여기서 두 집합을 만든다.

           ★ closed 는 이미 청산이 붙은 판단 — 두 번 붙이면 손익이 중복 집계된다.
           ★ filled 는 진입이 관측된 판단 — 체결되지 않은 주문에 청산을 붙이면
             일어나지 않은 거래의 손익이 된다.
        */
        const closedDecisionIds = new Set<string>();
        const filledDecisionIds = new Set<string>();
        for (const k of already) {
          const at = k.lastIndexOf(':');
          if (at <= 0) continue;
          const id = k.slice(0, at);
          const kind = k.slice(at + 1);
          if (kind === 'closed' || kind === 'liquidated') closedDecisionIds.add(id);
          if (kind === 'filled' || kind === 'partially_filled') filledDecisionIds.add(id);
        }

        if (filledDecisionIds.size === 0) return;   // 붙일 진입이 없다

        const pnlOutcomes = attributeRealizedPnl({
          decisions,
          closedDecisionIds,
          filledDecisionIds,
          entries,
          userId,
          // 원장은 KuCoin 선물 계정 하나다(어댑터가 account:'futures' 로 고정한다).
          market: 'futures',
          executionMode: 'live',
        });
        for (const o of pnlOutcomes) {
          await d.learning.recordOutcome(o);
        }
        return;
      }

      if (orders.length === 0) return;   // 체결만으로는 주문의 최종 상태를 모른다

      const outcomes = buildOrderOutcomes({ decisions, orders, fills, already, userId });
      for (const o of outcomes) {
        await d.learning.recordOutcome(o);
      }
    } catch {
      /* 학습 수집 실패가 조회를 막지 않는다. 레포가 실패 횟수를 센다. */
    }
  }

  async function exchangeRead<T>(
    c: Context,
    userId: string,
    key: string,
    read: (ctx: ExchangeContext) => Promise<T>,
  ) {
    const resolved = await resolveExchangeContext(userId);
    if (!resolved.ok) {
      console.warn(`[trading-read] ${key}: no exchange credential resolved for user ${userId} (reason=${(resolved as { reason?: string }).reason ?? 'none'})`);
      return c.json({ [key]: [], credentialStatus: 'NONE', source: 'exchange' });
    }
    try {
      const data = await read(resolved.ctx);
      console.log(`[trading-read] ${key}: ok status=${resolved.status} count=${Array.isArray(data) ? data.length : 'n/a'}`);
      /*
         ★★ 학습 결과를 여기서 모은다.

           거래소가 방금 돌려준 주문·체결이 이미 서버 손에 있다. 이 순간에
           판단(trade_decisions)과 이어 붙이면 **추가 왕복도, 배경 작업도, 상시
           키 복호화도 필요 없다.**

         ★ 실패해도 조회 응답에 영향을 주지 않는다. 학습 데이터는 부수 목적이고
           이용자가 요청한 것은 조회다.

         ★ 정직한 한계: 접속하지 않는 이용자의 결과는 모이지 않는다.
      */
      void collectOutcomes(userId, key, data);
      return c.json({
        [key]: data,
        credentialStatus: resolved.status,
        credentialId: resolved.credentialId,
        source: 'exchange',
        asOf: Date.now(),
      });
    } catch (e) {
      const detail = describeCredentialFailure(e as Error);
      console.warn(`[trading-read] ${key}: FAILED credentialProblem=${detail.isCredentialProblem} msg=${detail.message}`);
      if (detail.isCredentialProblem) {
        return c.json({
          [key]: [],
          credentialStatus: 'FAILED',
          credentialId: resolved.credentialId,
          source: 'exchange',
          reason: detail.message,
        });
      }
      return c.json(
        { error: { code: 'UPSTREAM_ERROR', message: detail.message }, credentialStatus: resolved.status },
        502,
      );
    }
  }

  /**
   * GET /trading/open-orders — 미체결 주문.
   *
   * 조회 실패를 빈 배열로 위장하지 않는다. "미체결 없음" 과 "확인 불가" 는
   * 다른 사실이고, 후자를 전자로 보여주면 사용자가 주문이 취소된 줄 안다.
   */
  app.get('/trading/open-orders', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const symbol = c.req.query('symbol') || undefined;
    return exchangeRead(c, a.user.id, 'orders', (ctx) => d.accountAdapter.getOpenOrders(ctx, symbol));
  });

  /** GET /trading/order-history — 완료·취소된 주문. */
  app.get('/trading/order-history', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const symbol = c.req.query('symbol') || undefined;
    const adapter = d.accountAdapter as {
      getOrderHistory?: (ctx: ExchangeContext, symbol?: string) => Promise<unknown[]>;
    };
    if (typeof adapter.getOrderHistory !== 'function') {
      // 어댑터가 지원하지 않으면 빈 배열이 아니라 미지원을 알린다.
      return c.json({ orders: [], credentialStatus: 'UNSUPPORTED', source: 'exchange' });
    }
    return exchangeRead(c, a.user.id, 'orders', (ctx) => adapter.getOrderHistory!(ctx, symbol));
  });

  /** GET /trading/fills — 체결 내역. 실제 수수료가 여기에 있다. */
  app.get('/trading/fills', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const symbol = c.req.query('symbol') || undefined;
    const adapter = d.accountAdapter as {
      getFills?: (ctx: ExchangeContext, symbol?: string) => Promise<unknown[]>;
    };
    if (typeof adapter.getFills !== 'function') {
      return c.json({ fills: [], credentialStatus: 'UNSUPPORTED', source: 'exchange' });
    }
    return exchangeRead(c, a.user.id, 'fills', (ctx) => adapter.getFills!(ctx, symbol));
  });

/**
   * POST /trading/orders/cancel — 미체결 주문 취소.
   *
   * 취소는 제출보다 안전하다(포지션을 늘리지 않는다). 그래도 잠금은 같이 적용한다:
   * 실주문이 금지된 배포에는 취소할 주문도 없다.
   *
   * clientOrderId 로 부른다. 거래소 orderId 는 어댑터가 조회해서 찾는다 —
   * 화면이 거래소 내부 id 를 들고 다니면 거래소를 바꿀 때 전부 깨진다.
   */
  app.post('/trading/orders/cancel', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', ''), 403);

    const body = (await c.req.json().catch(() => ({}))) as { symbol?: string; clientOrderId?: string };
    if (!body.symbol || !body.clientOrderId) {
      return c.json(err('BAD_REQUEST', 'symbol and clientOrderId required'), 400);
    }
    if (!d.tradingAdapter) {
      // 어댑터가 없으면 실주문 경로가 존재하지 않는다. 성공으로 위장하지 않는다.
      return c.json({ ...err('NOT_CONFIGURED', 'live order path is disabled'), canceled: false }, 503);
    }

    const resolved = await resolveExchangeContext(a.user.id);
    if (!resolved.ok) {
      return c.json({ ...err('NO_VERIFIED_CREDENTIAL', 'connect an exchange API key first'), canceled: false }, 409);
    }

    try {
      const r = await d.tradingAdapter.cancelOrder(resolved.ctx, body.symbol, body.clientOrderId);
      /*
         취소 실패를 성공으로 만들지 않는다.

         이미 체결됐거나 존재하지 않는 주문일 수 있다. 그때 성공이라고 하면
         사용자는 주문이 취소된 줄 알고 포지션을 방치한다.
      */
      return c.json({
        canceled: r.ok,
        clientOrderId: body.clientOrderId,
        reason: r.ok ? undefined : 'order not found in open orders (already filled or canceled)',
      });
    } catch (e) {
      return c.json({ error: { code: 'UPSTREAM_ERROR', message: (e as Error).message }, canceled: false }, 502);
    }
  });

  /**
   * POST /trading/orders/cancel-all — 한 심볼의 미체결 주문 전체 취소.
   *
   * symbol 을 반드시 요구한다. 생략을 허용하면 KuCoin 이 **모든 심볼**을 취소한다 —
   * 실수 한 번에 전 종목 주문이 사라지는 사고를 구조적으로 막는다.
   */
  app.post('/trading/orders/cancel-all', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', ''), 403);

    const body = (await c.req.json().catch(() => ({}))) as { symbol?: string; confirm?: boolean };
    if (!body.symbol) return c.json(err('BAD_REQUEST', 'symbol required'), 400);
    // 되돌릴 수 없는 작업이다. 명시적 확인 없이는 실행하지 않는다.
    if (body.confirm !== true) {
      return c.json(err('FORBIDDEN', 'explicit confirm required for cancel-all'), 403);
    }

    const adapter = d.tradingAdapter as
      | (typeof d.tradingAdapter & { cancelAllForSymbol?: (ctx: ExchangeContext, s: string) => Promise<{ canceled: string[] }> })
      | undefined;
    if (!adapter) {
      return c.json({ ...err('NOT_CONFIGURED', 'live order path is disabled'), canceled: [] }, 503);
    }

    const resolved = await resolveExchangeContext(a.user.id);
    if (!resolved.ok) {
      return c.json({ ...err('NO_VERIFIED_CREDENTIAL', 'connect an exchange API key first'), canceled: [] }, 409);
    }

    try {
      // 어댑터가 심볼 단위 전체 취소를 지원하지 않으면 개별 취소로 대체한다.
      if (typeof adapter.cancelAllForSymbol === 'function') {
        const r = await adapter.cancelAllForSymbol(resolved.ctx, body.symbol);
        return c.json({ canceled: r.canceled, count: r.canceled.length });
      }
      const open = await d.accountAdapter.getOpenOrders(resolved.ctx, body.symbol);
      const done: string[] = [];
      for (const o of open) {
        const r = await adapter.cancelOrder(resolved.ctx, body.symbol, o.clientOrderId);
        if (r.ok) done.push(o.clientOrderId);
      }
      return c.json({ canceled: done, count: done.length });
    } catch (e) {
      return c.json({ error: { code: 'UPSTREAM_ERROR', message: (e as Error).message }, canceled: [] }, 502);
    }
  });

  /**
   * 판단 문맥을 모아 학습 기록으로 남긴다.
   *
   * ★★ 여기서 예외가 나가면 주문이 실패한다. 레포지토리가 실패를 삼키지만,
   *     스냅샷을 만드는 과정에서도 던지지 않도록 전체를 감싼다.
   *
   * ★ 시세는 **서버 값**만 쓴다. 화면이 보낸 가격을 저장하면 조작된 요청으로
   *   학습 데이터를 오염시킬 수 있다(규칙: 데이터를 쓰는 쪽이 출처를 밝힌다).
   */
  async function recordDecision(args: {
    userId: string;
    body: Record<string, unknown>;
    symbol: string;
    market: 'futures' | 'spot';
    executionMode: 'live' | 'paper';
    risk?: { pass: boolean; failCount: number; gates: unknown; liveGate: { allowed: boolean } };
    riskState?: { unknown: string[] };
    submitStatus: 'ACCEPTED' | 'REJECTED' | 'SUBMIT_UNKNOWN' | 'BLOCKED';
    submitReason?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }): Promise<string | null> {
    if (!d.learning) return null;
    try {
      const b = args.body;
      /*
         화면이 보낸 판단 문맥.

         ★ 검증해서 담는다. 화면이 보낸 것을 그대로 JSONB 에 넣으면 크기 제한이
           없는 값을 계속 받게 되고(메모·도형 좌표 전체 등), 표가 부풀며 개인정보가
           섞여 들어온다. 알고 있는 항목만, 길이를 제한해 담는다.
      */
      const rawCtx = (b.uiContext ?? null) as Record<string, unknown> | null;
      let uiContext: import('./db/learning-repo').UiContext | null = null;
      if (rawCtx && typeof rawCtx === 'object') {
        const inds = Array.isArray(rawCtx.indicators) ? rawCtx.indicators : null;
        uiContext = {
          ...(typeof rawCtx.timeframe === 'string' ? { timeframe: rawCtx.timeframe.slice(0, 12) } : {}),
          ...(inds
            ? {
              // 상한 40개. 그보다 많으면 화면이 아니라 조작된 요청이다.
              indicators: inds.slice(0, 40).map((x) => {
                const o = (x ?? {}) as Record<string, unknown>;
                return {
                  id: String(o.id ?? '').slice(0, 40),
                  ...(o.params && typeof o.params === 'object'
                    ? { params: o.params as Record<string, unknown> }
                    : {}),
                };
              }).filter((x) => x.id !== ''),
            }
            : {}),
          ...(typeof rawCtx.drawings === 'number' ? { drawings: Math.trunc(rawCtx.drawings) } : {}),
          ...(typeof rawCtx.preset === 'string' ? { preset: rawCtx.preset.slice(0, 60) } : {}),
          ...(typeof rawCtx.chartType === 'string' ? { chartType: rawCtx.chartType.slice(0, 30) } : {}),
          ...(typeof rawCtx.source === 'string' ? { source: rawCtx.source.slice(0, 40) } : {}),
        };
      }

      /*
         시장 스냅샷. 우리 시세 원천에서 읽는다.

         ★ 얻지 못하면 null 이다. 0 으로 채우면 "그때 가격이 0 이었다" 가 된다.
      */
      let marketSnapshot: Record<string, unknown> | null = null;
      try {
        const tick = d.marketSnapshot ? await d.marketSnapshot(args.symbol, args.market) : null;
        if (tick) marketSnapshot = tick;
      } catch { /* 시세를 못 읽는 것이 주문을 막지 않는다 */ }

      return await d.learning.recordDecision({
        userId: args.userId,
        market: args.market,
        executionMode: args.executionMode,
        symbol: args.symbol,
        side: String(b.side ?? ''),
        orderType: String(b.orderType ?? b.type ?? ''),
        price: (b.price as string | number | undefined) ?? null,
        quantity: (b.quantity ?? b.size ?? 0) as string | number,
        leverage: (b.leverage as string | number | undefined) ?? null,
        marginMode: typeof b.marginMode === 'string' ? b.marginMode : null,
        reduceOnly: b.reduceOnly === true,
        stopPrice: (b.stopPrice as string | number | undefined) ?? null,
        takeProfitPrice: (b.takeProfitPrice as string | number | undefined) ?? null,
        /*
           ★ 브래킷 손절가는 stopPrice 와 다른 칼럼에 남긴다. stopPrice 는
             조건부 **진입**가다 — 한 칼럼에 넣으면 "손절 없이 들어갔다" 라는
             사실 판정이 뒤집힌다.
        */
        stopLossPrice: (b.stopLossPrice as string | number | undefined) ?? null,
        uiContext,
        marketSnapshot,
        accountSnapshot: args.riskState
          // 위험 엔진이 이미 모아 둔 실제 상태를 재사용한다(중복 조회를 만들지 않는다).
          ? { unknownInputs: args.riskState.unknown }
          : null,
        riskSnapshot: args.risk
          ? {
            pass: args.risk.pass,
            failCount: args.risk.failCount,
            liveGateAllowed: args.risk.liveGate.allowed,
            gates: args.risk.gates,
          }
          : null,
        submitStatus: args.submitStatus,
        submitReason: args.submitReason ?? null,
        clientOrderId: args.clientOrderId ?? null,
        exchangeOrderId: args.exchangeOrderId ?? null,
      });
    } catch {
      /*
         ★ 학습 기록 실패가 주문을 막지 않는다. 레포지토리가 감사기록을 남긴다.
      */
      return null;
    }
  }

  // ---- order submit (SHADOW by default; live is blocked unless every gate passes) ----
  app.post('/trading/orders/submit', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', ''), 403);
    const idemKey = c.req.header('idempotency-key');
    if (!idemKey) return c.json(err('BAD_REQUEST', 'Idempotency-Key header required'), 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const symbol = String(body.symbol ?? 'BTCUSDT');
    /*
       ★ 사용자·용도를 함께 넘긴다. DB 저장소가 컬럼으로 요구하고, 키에서
         파싱하면 키 형식이 바뀌는 날 엉뚱한 사용자에게 기록이 붙는다.
    */
    const { result } = await idem.run(`${a.user.id}:${idemKey}`, async () => {
      // Real state, not literals. These were hardcoded, which made every state-dependent gate pass.
      const { st, input } = await buildRiskInput(
        a.user.id,
        a.user.status,
        { ...body, symbol },
        Boolean(body.confirmationToken),
        true,
      );
      const risk = runRiskEngine(input);

      /*
         실주문 전송 조건 — 넷을 모두 만족해야 한다.

           1) 리스크 게이트 전부 통과 (risk.pass)
           2) 라이브 게이트 허용 (risk.liveGate.allowed) — 킬스위치·플래그·모드
           3) 거래 어댑터가 주입되어 있고 canPlaceRealOrders 가 true
           4) 사용자 자격증명이 있고 검증됨

         하나라도 빠지면 전송하지 않는다. 기본 배포는 전부 잠겨 있으므로
         이 경로는 열리지 않는다 — 잠금을 푸는 것은 명시적 설정 변경이다.
      */
      const gatesOpen = risk.pass && risk.liveGate.allowed;
      /*
         ★★ 시장에 맞는 어댑터를 고른다.

           요청이 현물이면 현물 어댑터를, 아니면 선물 어댑터를 쓴다. 어댑터를
           잘못 고르면 오류가 나지 않고 **주문 수량이 승수 배(BTC 는 1000배)
           틀린다.** 그래서 고르는 지점을 한 곳으로 모으고, 고르지 못하면
           전송하지 않는다.

         ★ 현물 요청인데 현물 어댑터가 없으면 선물로 대신 보내지 않는다.
           그것은 이용자가 요청하지 않은 상품에 주문을 내는 것이다.
      */
      /*
         요청한 시장. 학습 기록에도 이 값을 쓴다.

         ★ 시장을 섞으면 승수·수수료·청산 규칙이 달라 학습이 오염된다.
           어댑터를 고르는 판정과 **같은 값**을 쓴다 — 따로 계산하면 어느 날
           둘이 어긋나고, 기록은 선물인데 실제로는 현물 주문이 된다.
      */
      const reqMarket: 'futures' | 'spot' =
        String((body as { market?: unknown }).market ?? '').toLowerCase() === 'spot' ? 'spot' : 'futures';
      const activeAdapter = selectTradingAdapter(reqMarket, {
        futures: d.tradingAdapter,
        spot: d.spotTradingAdapter,
      });
      const adapterReady = Boolean(activeAdapter && activeAdapter.canPlaceRealOrders);

      if (!gatesOpen || !adapterReady) {
        /*
           ★★ 차단된 주문도 학습 기록에 남긴다.

             "이 상황에서 이런 주문은 한도에 걸린다" 는 학습 대상이다. 통과한
             주문만 남기면 모델은 위험한 주문이 존재했다는 사실 자체를 모른다.
             이용자가 명시한 요구이기도 하다 — 손실·실패도 학습한다.
        */
        await recordDecision({
          userId: a.user.id,
          body,
          symbol,
          market: reqMarket,
          executionMode: 'live',
          risk,
          riskState: st,
          submitStatus: 'BLOCKED',
          submitReason: !adapterReady ? 'ADAPTER_NOT_READY' : 'RISK_GATE',
          clientOrderId: idemKey,
        });
        return {
          transmitted: false,
          /*
             모드 표시.

             ★ d.mode 는 BitMart 시절 열거값이다. 그대로 내보내면 KuCoin 사용자가
               "BITMART_LIVE_READ_ONLY" 를 보게 된다 — 자기가 쓰지 않는 거래소다.
               실제 거래소를 함께 알려준다.
          */
          mode: d.mode,
          exchange: d.exchangeId,
          riskPass: risk.pass,
          liveGateAllowed: risk.liveGate.allowed,
          reasons: localizeGateReasons(
            risk.pass ? risk.liveGate.reasons : risk.reasons,
            d.exchangeId,
            d.liveGateEnv,
          ),
          gates: risk.gates,
          failCount: risk.failCount,
          unknownInputs: st.unknown,
          note: !adapterReady
            ? 'blocked — live order path disabled (kill switch / feature flag / no trading adapter)'
            : 'blocked — risk gates did not pass; nothing transmitted to the exchange',
        };
      }

      // --- 여기서부터 실제로 거래소에 주문이 나간다 ---
      const resolved = await resolveExchangeContext(a.user.id);
      if (!resolved.ok) {
        // 키가 없어 보내지 못한 것도 사실이다 — 남긴다.
        await recordDecision({
          userId: a.user.id,
          body,
          symbol,
          market: reqMarket,
          executionMode: 'live',
          risk,
          riskState: st,
          submitStatus: 'BLOCKED',
          submitReason: 'NO_VERIFIED_CREDENTIAL',
          clientOrderId: idemKey,
        });
        return {
          transmitted: false,
          mode: d.mode,
          riskPass: risk.pass,
          liveGateAllowed: risk.liveGate.allowed,
          reasons: ['no verified exchange credential'],
          gates: risk.gates,
          failCount: risk.failCount,
          unknownInputs: st.unknown,
          note: 'blocked — connect and verify an exchange API key first',
        };
      }

      const outcome = await activeAdapter!.submitOrder(resolved.ctx, {
        // 멱등성 키를 주문 식별자로 쓴다. 같은 키로 재시도해도 주문은 하나다.
        clientOrderId: idemKey,
        symbol,
        side: body.side === 'short' ? 'short' : 'long',
        type: body.orderType === 'market' || body.type === 'market' ? 'market' : 'limit',
        price: body.price ? String(body.price) : undefined,
        quantity: String(body.quantity ?? body.size ?? '0'),
        leverage: Number(body.leverage ?? 1),
        marginMode: body.marginMode === 'cross' ? 'cross' : 'isolated',
        reduceOnly: body.reduceOnly === true,
        postOnly: body.postOnly === true,
        ...(typeof body.timeInForce === 'string' && body.timeInForce ? { timeInForce: String(body.timeInForce) } : {}),
        /*
           ★★ 발동 가격을 어댑터로 전달한다.

             값이 있으면 어댑터가 **발동 주문 경로**로 보낸다. 전달하지 않으면
             일반 주문이 되어 즉시 체결되고, 손절을 걸었다고 믿는 이용자가 그
             자리에서 체결된다. 그래서 값을 조용히 버리지 않는다. 방향(up/down)과
             기준가 종류도 함께 넘긴다 — 방향이 없으면 어댑터가 'down' 으로 본다.

           ★ 형식 검증은 어댑터가 한다(0 이하·숫자 아님이면 주문하지 않는다).
             여기서 기본값을 넣지 않는다 — 기본 발동가라는 것은 존재하지 않는다.
        */
        ...(body.stopPrice !== undefined && body.stopPrice !== null && String(body.stopPrice) !== ''
          ? {
              stopPrice: String(body.stopPrice),
              ...(body.stopDirection === 'up' || body.stopDirection === 'down' ? { stopDirection: body.stopDirection } : {}),
              ...(body.stopPriceType === 'TP' || body.stopPriceType === 'IP' || body.stopPriceType === 'MP' ? { stopPriceType: body.stopPriceType } : {}),
            }
          : {}),
        /*
           OCO 의 손절 지정가. stopPrice·price 와 함께 있을 때만 OCO 가 된다.
           일부만 오면 어댑터가 OCO 로 보지 않는다 — 반쪽 OCO 는 한쪽이 무방비다.
        */
        ...(body.limitPrice !== undefined && body.limitPrice !== null && String(body.limitPrice) !== ''
          ? { limitPrice: String(body.limitPrice) }
          : {}),
        /*
           ★★ 브래킷 TP/SL — 진입 주문에 익절·손절을 함께 등록한다.

             선물은 거래소가 지원한다(POST /api/v1/st-orders). 값을 조용히 버리면
             이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다 — 그래서 그대로
             넘기고, 지원하지 않는 시장(현물)에서는 어댑터가 **거부**한다.

           ★ 의미(익절/손절)로만 넘긴다. 위/아래 변환은 거래소 클라이언트 한 곳에서
             한다 — 변환 지점이 둘이면 어긋나는 날 손절 자리에 익절이 걸린다.

           ★ 방향·순서 검증도 어댑터/클라이언트가 한다. 여기서 기본값을 채우지
             않는다 — "기본 손절가" 라는 것은 존재하지 않는다.
        */
        ...(body.takeProfitPrice !== undefined && body.takeProfitPrice !== null && String(body.takeProfitPrice) !== ''
          ? { takeProfitPrice: String(body.takeProfitPrice) }
          : {}),
        ...(body.stopLossPrice !== undefined && body.stopLossPrice !== null && String(body.stopLossPrice) !== ''
          ? { stopLossPrice: String(body.stopLossPrice) }
          : {}),
      } as never);

      /*
         ★★ 전송 결과를 남긴다 — ACCEPTED·REJECTED·SUBMIT_UNKNOWN 전부.

           SUBMIT_UNKNOWN 을 빼면 "주문이 나갔는지 모르는" 사례가 데이터에서
           사라진다. 실제로 가장 위험한 상태이고, 학습에서도 그 상황을 알아야 한다.
      */
      await recordDecision({
        userId: a.user.id,
        body,
        symbol,
        market: reqMarket,
        executionMode: 'live',
        risk,
        riskState: st,
        submitStatus: outcome.status,
        submitReason: outcome.status === 'ACCEPTED' ? null : String((outcome as { reason?: unknown }).reason ?? ''),
        clientOrderId: idemKey,
        exchangeOrderId: outcome.status === 'ACCEPTED'
          ? (outcome.order as { exchangeOrderId?: string } | undefined)?.exchangeOrderId ?? null
          : null,
      });

      return {
        // ACCEPTED 만 전송 성공이다. SUBMIT_UNKNOWN 은 전송 여부를 모르는 상태다.
        transmitted: outcome.status === 'ACCEPTED',
        outcome: outcome.status,
        order: outcome.status === 'ACCEPTED' ? outcome.order : undefined,
        /*
           결과를 알 수 없는 경우 호출자가 반드시 확인해야 한다.
           재시도하면 중복 주문이 되므로, 재시도가 아니라 조회를 지시한다.
        */
        reconcile:
          outcome.status === 'SUBMIT_UNKNOWN'
            ? { clientOrderId: outcome.clientOrderId, action: 'GET /trading/open-orders' }
            : undefined,
        mode: d.mode,
        riskPass: risk.pass,
        liveGateAllowed: risk.liveGate.allowed,
        reasons: outcome.status === 'ACCEPTED' ? [] : [outcome.status === 'REJECTED' ? outcome.reason : outcome.reason],
        gates: risk.gates,
        failCount: risk.failCount,
        unknownInputs: st.unknown,
        brokerAttached: Boolean(
          (activeAdapter as { brokerAttached?: boolean } | undefined)?.brokerAttached,
        ),
      };
    }, { userId: a.user.id, scope: 'trading.orders.submit' });
    return c.json(result);
  });

  return app;
}
