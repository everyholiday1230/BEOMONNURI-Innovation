import { BitMartBrokerRebateClient, type RebateRecord } from '@quantumtrade/exchange-bitmart';
import { resolveCredentialProvider } from './credential-source';

/**
 * Operator-side reader for the BitMart API Broker rebate statement.
 *
 * The rebate is OUR revenue, credited to OUR BitMart spot wallet, so the query authenticates with the
 * OPERATOR's own API key — not a user's. That key is resolved through the same fail-closed path the
 * Stage A probe uses (`resolveCredentialProvider`): AWS Secrets Manager in production, and the dev-only
 * env provider otherwise. This module never reads a secret from process.env directly.
 *
 * Only the access key is used. The rebate endpoint is KEYED (`X-BM-KEY`, unsigned), so the secret key
 * and memo are loaded but not needed for signing here.
 */

export interface BrokerRebateReader {
  brokerId: string;
  fetchSpot: (q: { startTime?: number; endTime?: number }) => Promise<RebateRecord[]>;
}

export interface BrokerRebateReaderOptions {
  brokerId: string;
  isProduction: boolean;
  /** BITMART_CREDENTIAL_SOURCE. Defaults inside resolveCredentialProvider. */
  source?: string;
  /** BITMART_SECRET_ARN | BITMART_SECRET_ID */
  secretId?: string;
  /** AWS_REGION | AWS_DEFAULT_REGION */
  region?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam: injected AWS client factory (never a secret). */
  clientFactory?: Parameters<typeof resolveCredentialProvider>[0]['clientFactory'];
  /** Test seam: injected fetch. */
  fetchImpl?: typeof fetch;
  restBase?: string;
}

/**
 * Build the reader, or return `undefined` when this deployment has no operator credential configured.
 *
 * Returning `undefined` rather than a reader that fails on use is deliberate: the admin route turns it
 * into an explicit `NOT_CONFIGURED` response, so an empty revenue page can be told apart from "we are
 * not asking BitMart". A reader that threw on every call would look like an outage instead.
 *
 * Credentials are loaded per call, not cached. Rebate reads are an occasional admin action, so holding
 * the operator's secret in process memory between requests would add exposure for no benefit.
 */
export function createBrokerRebateReader(
  opts: BrokerRebateReaderOptions,
): BrokerRebateReader | undefined {
  const env = opts.env ?? process.env;

  // Probe configuration WITHOUT loading anything: resolveCredentialProvider is fail-closed and throws
  // when misconfigured, and a missing operator key must not prevent the API from starting.
  let provider: ReturnType<typeof resolveCredentialProvider>;
  try {
    provider = resolveCredentialProvider({
      ...(opts.source !== undefined ? { source: opts.source } : {}),
      ...(opts.secretId !== undefined ? { secretId: opts.secretId } : {}),
      ...(opts.region !== undefined ? { region: opts.region } : {}),
      isProduction: opts.isProduction,
      env,
      ...(opts.clientFactory !== undefined ? { clientFactory: opts.clientFactory } : {}),
    });
  } catch {
    return undefined;
  }

  // The dev env provider constructs successfully even with nothing set, and would then produce an
  // empty access key. Check up front so a dev machine reports NOT_CONFIGURED instead of a BitMart 401.
  if (!opts.isProduction) {
    const devKey = env.BITMART_ACCESS_KEY ?? env.BITMART_API_KEY;
    if (!devKey || devKey.trim() === '') return undefined;
  }

  const client = new BitMartBrokerRebateClient({
    ...(opts.restBase !== undefined ? { restBase: opts.restBase } : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    brokerId: opts.brokerId,
  });

  return {
    brokerId: opts.brokerId,
    fetchSpot: async (q) => {
      const cred = await provider.load();
      return client.getSpotRebates({ accessKey: cred.accessKey }, q);
    },
  };
}
