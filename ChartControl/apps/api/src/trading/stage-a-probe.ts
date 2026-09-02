/**
 * Phase 3 Stage A — Production READ-ONLY probe (items 6/7). Credentials are obtained ONLY through
 * `resolveCredentialProvider` → AWS Secrets Manager (IAM role). This module MUST NOT read the BitMart
 * secret/memo from process.env, CLI arguments, or files — the only inputs are the non-secret Secret
 * ARN/id + region. Output is schema-only (never balances/positions values, never secret/memo/signature).
 * READ-ONLY endpoints only: no order/cancel/modify/leverage/position-mode/transfer/withdraw/margin.
 */
import { BitMartFuturesAdapter, type ExchangeContext } from '@quantumtrade/exchange-bitmart';
import { BITMART_BROKER_ID } from '@quantumtrade/config';
import { resolveCredentialProvider } from './credential-source';

export interface StageAItemResult {
  item: string;
  ok: boolean;
  /** top-level schema (keys/length) only — never values */
  schema?: string;
  note?: string;
}

export interface StageAProbeOptions {
  restBase: string;
  /** non-secret AWS Secrets Manager identifier + region (NOT the credential itself). */
  secretId?: string;
  region?: string;
  /** test-only injected AWS client factory (never a secret). */
  clientFactory?: Parameters<typeof resolveCredentialProvider>[0]['clientFactory'];
  /** Override the broker attribution id. Defaults to BITMART_BROKER_ID. Not a secret. */
  brokerId?: string;
}

const schemaOf = (d: unknown): string => {
  if (Array.isArray(d)) return `array[${d.length}]` + (d[0] && typeof d[0] === 'object' ? ` keys={${Object.keys(d[0] as object).join(',')}}` : '');
  if (d && typeof d === 'object') return `keys={${Object.keys(d as object).join(',')}}`;
  return typeof d;
};

/**
 * Runs the read-only Stage A checks. Credentials load via AWS Secrets Manager (fail-closed if the
 * source is misconfigured). Returns schema-only results; the caller may log them safely.
 */
export async function runStageAReadOnly(opts: StageAProbeOptions): Promise<StageAItemResult[]> {
  // Fail-closed credential resolution — production path, no env/CLI/file secret.
  const provider = resolveCredentialProvider({
    isProduction: true,
    source: 'aws-secrets-manager',
    secretId: opts.secretId,
    region: opts.region,
    clientFactory: opts.clientFactory,
  });
  const credential = await provider.load(); // AWS Secrets Manager only
  // Broker id is included so the probe exercises the exact header set a real request sends. The probe
  // is read-only, so there is nothing to attribute — this is about not letting the verified path and
  // the production path diverge.
  const adapter = new BitMartFuturesAdapter({
    restBase: opts.restBase,
    brokerId: opts.brokerId ?? BITMART_BROKER_ID,
  });
  const ctx: ExchangeContext = { mode: 'LIVE_READ_ONLY', credential };

  const results: StageAItemResult[] = [];
  const run = async (item: string, fn: () => Promise<unknown>) => {
    try {
      results.push({ item, ok: true, schema: schemaOf(await fn()) });
    } catch (e) {
      results.push({ item, ok: false, note: (e as Error).message });
    }
  };
  await run('assets/available-balance', () => adapter.getBalances(ctx));
  await run('positions', () => adapter.getPositions(ctx));
  await run('open-orders', () => adapter.getOpenOrders(ctx, 'BTCUSDT'));
  return results;
}
