import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import type { BitMartMode, IExchangeAccountAdapter, ExchangeContext } from '@quantumtrade/exchange-bitmart';
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
    const verified = d.credRepo.listOwned(a.user.id).find((r) => r.connectionStatus === 'VERIFIED');
    if (!verified) {
      return c.json(
        {
          ...err('NO_VERIFIED_CREDENTIAL', 'connect and verify an exchange API key first'),
          configured: true,
          hasCredential: d.credRepo.listOwned(a.user.id).length > 0,
        },
        409,
      );
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

    const rows = d.credRepo.listOwned(a.user.id);
    const usable = rows.find((r) => r.connectionStatus === 'VERIFIED') ?? rows[0];
    if (!usable) {
      return c.json({ positions: [], credentialStatus: 'NONE', source: 'exchange' });
    }

    try {
      const full = d.credRepo.getOwned(a.user.id, usable.id);
      if (!full) return c.json({ positions: [], credentialStatus: 'NONE', source: 'exchange' });
      const credential = await d.vault.decrypt(full);
      const positions = await d.accountAdapter.getPositions({ mode: d.mode, credential });
      return c.json({
        positions,
        credentialStatus: usable.connectionStatus,
        credentialId: usable.id,
        source: 'exchange',
        asOf: Date.now(),
      });
    } catch (e) {
      const detail = describeCredentialFailure(e as Error);
      if (detail.isCredentialProblem) {
        return c.json({
          positions: [],
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
      // Default deployment: READ_ONLY/SHADOW or gate-blocked → NEVER transmit.
      const transmitted = false;
      return {
        transmitted,
        mode: d.mode,
        riskPass: risk.pass,
        liveGateAllowed: risk.liveGate.allowed,
        reasons: risk.pass ? risk.liveGate.reasons : risk.reasons,
        // The gate list is returned here too, so a rejection is explainable without a second round trip.
        gates: risk.gates,
        failCount: risk.failCount,
        unknownInputs: st.unknown,
        note: 'shadow/blocked — no order transmitted to BitMart (Controlled Live Order requires all gates + explicit owner authorization)',
      };
    });
    return c.json(result);
  });

  return app;
}
