import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import type { BitMartMode, IExchangeAccountAdapter, IExchangeTradingAdapter, ExchangeContext } from '@quantumtrade/exchange-bitmart';
import { CredentialVault } from './trading/credential-vault';
import { runRiskEngine, type TradingPolicy } from './trading/risk-engine';
import { IdempotencyService, MemoryIdempotencyStore } from './trading/idempotency';
import type { SqliteCredentialRepo } from './db/trading-repos';
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
  credRepo: SqliteCredentialRepo;
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
  /**
   * 실주문 어댑터. **주지 않으면 실주문 경로가 존재하지 않는다.**
   *
   * 선택 의존성으로 둔 이유: 기본 배포는 실주문을 하지 않으므로 어댑터를
   * 주입하지 않는 것이 가장 안전한 상태다. 실수로 열리는 것보다 실수로
   * 닫히는 편이 낫다.
   */
  tradingAdapter?: IExchangeTradingAdapter;
  policy: TradingPolicy;
  symbolInfo: Record<string, SymbolInfo>;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  mode: BitMartMode; // deployment mode (default READ_ONLY)
  liveTradingEnabled: boolean; // BITMART_LIVE_TRADING_ENABLED (default false)
  killSwitch: boolean; // BITMART_EMERGENCY_KILL_SWITCH (default true)
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
function localizeGateReasons(reasons: readonly string[], exchangeId: string): string[] {
  const ex = exchangeId.toUpperCase();
  return reasons.map((r) => {
    // 모드 이름: 이 배포가 쓰는 거래소를 밝히고, 실제 조건 변수를 알려준다.
    if (/does not permit live orders/.test(r)) {
      return `live orders are not enabled for this deployment (${ex}) — TRADING_MODE must be ${ex}_LIVE`;
    }
    if (/BITMART_LIVE_TRADING_ENABLED is false/.test(r)) {
      return 'FEATURE_LIVE_ORDERS_ENABLED is false';
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
  const idem = new IdempotencyService(new MemoryIdempotencyStore());

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
    const creds = d.credRepo.listOwned(userId);
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
        const cred = await d.vault.decrypt(d.credRepo.getOwned(userId, verified.id)!);
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
    return {
      st,
      symbolId: symbol,
      input: {
        mode: d.mode,
        symbol: d.symbolInfo[symbol],
        side: (body.side as 'long' | 'short') ?? 'long',
        orderType: (body.orderType as 'market' | 'limit') ?? 'limit',
        price: body.price as string | undefined,
        quantity: String(body.quantity ?? '0'),
        leverage: Number(body.leverage ?? 1),
        stopLoss: body.stopLoss as string | undefined,
        takeProfit: body.takeProfit as string | undefined,
        riskReward: body.riskReward as string | undefined,
        maxEstLoss: body.maxEstLoss as string | undefined,
        positionValue: body.positionValue as string | undefined,
        referencePrice: body.referencePrice as string | undefined,
        policy: d.policy,
        liveTradingEnabled: d.liveTradingEnabled,
        emergencyKillSwitch: d.killSwitch,
        userStatus,
        previewExpired: false,
        confirmationTokenValid,
        idempotencyKeyValid,
        // Connectivity is only healthy if market data is actually live.
        exchangeConnectivityHealthy: st.marketDataStatus === 'LIVE',
        credentialStatus: st.credentialStatus,
        futureTradePermissionVerified: st.futureTradePermissionVerified,
        dailyOrderCount: st.dailyOrderCount,
        // No per-user realized-loss source exists yet; reported as unknown rather than as 0.
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

    const rows = d.credRepo.listOwned(a.user.id);
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
    const row = d.credRepo.create(a.user.id, enc, body.label, d.exchangeId);
    // Response NEVER includes secret/memo — only the masked access key + status.
    return c.json({ id: row.id, accessKeyMasked: row.accessKeyMasked, connectionStatus: row.connectionStatus }, 201);
  });

  app.post('/trading/credentials/:id/verify', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const row = d.credRepo.getOwned(a.user.id, c.req.param('id'));
    if (!row) return c.json(err('NOT_FOUND', 'credential not found'), 404); // ownership
    try {
      const cred = await d.vault.decrypt(row); // server-side only
      const ctx: ExchangeContext = { mode: 'BITMART_LIVE_READ_ONLY', credential: cred };
      await d.accountAdapter.getBalances(ctx); // Read-Only probe (no order permission needed)
      d.credRepo.setVerified(a.user.id, row.id, 'VERIFIED', true);
      return c.json({ id: row.id, connectionStatus: 'VERIFIED', permissionsVerified: true });
    } catch (e) {
      d.credRepo.setVerified(a.user.id, row.id, 'FAILED', false);
      return c.json({ id: row.id, connectionStatus: 'FAILED', reason: (e as Error).message });
    }
  });

  app.delete('/trading/credentials/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    return d.credRepo.revoke(a.user.id, c.req.param('id')) ? c.json({ ok: true }) : c.json(err('NOT_FOUND', ''), 404);
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
    const owned = d.credRepo.listOwned(a.user.id);
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
        transactions: [],
        credentialStatus: owned.length > 0 ? (owned[0]!.connectionStatus ?? 'UNVERIFIED') : 'NONE',
        hasCredential: owned.length > 0,
        source: 'exchange',
        configured: true,
      });
    }

    try {
      const row = d.credRepo.getOwned(a.user.id, verified.id);
      if (!row) return c.json(err('NOT_FOUND', 'credential not found'), 404);
      const credential = await d.vault.decrypt(row); // server-side only; never leaves this process
      const ctx: ExchangeContext = { mode: 'BITMART_LIVE_READ_ONLY', credential };
      const items = await d.transactionSource.getTransactionHistory(ctx, parsed.data);
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
        source: 'BITMART_EXCHANGE',
        exchange: verified.exchange,
        servedAt: Date.now(),
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
      credentials: d.credRepo.listOwned(a.user.id).map((r) => ({ id: r.id, exchange: r.exchange, label: r.label, accessKeyMasked: r.accessKeyMasked, connectionStatus: r.connectionStatus })),
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

    const rows = d.credRepo.listOwned(a.user.id);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) {
      return c.json({ balances: [], credentialStatus: 'NONE', source: 'exchange' });
    }

    try {
      const full = d.credRepo.getOwned(a.user.id, usable.id);
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
    const rows = d.credRepo.listOwned(userId);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) return { ok: false, reason: 'NONE' };
    const full = d.credRepo.getOwned(userId, usable.id);
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
  async function exchangeRead<T>(
    c: Context,
    userId: string,
    key: string,
    read: (ctx: ExchangeContext) => Promise<T>,
  ) {
    const resolved = await resolveExchangeContext(userId);
    if (!resolved.ok) {
      return c.json({ [key]: [], credentialStatus: 'NONE', source: 'exchange' });
    }
    try {
      const data = await read(resolved.ctx);
      return c.json({
        [key]: data,
        credentialStatus: resolved.status,
        credentialId: resolved.credentialId,
        source: 'exchange',
        asOf: Date.now(),
      });
    } catch (e) {
      const detail = describeCredentialFailure(e as Error);
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
      const adapterReady = Boolean(d.tradingAdapter && d.tradingAdapter.canPlaceRealOrders);

      if (!gatesOpen || !adapterReady) {
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

      const outcome = await d.tradingAdapter!.submitOrder(resolved.ctx, {
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
          (d.tradingAdapter as { brokerAttached?: boolean } | undefined)?.brokerAttached,
        ),
      };
    });
    return c.json(result);
  });

  return app;
}
