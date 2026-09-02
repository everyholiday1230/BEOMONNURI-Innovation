import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialVault, LocalKekProvider, maskAccessKey } from '../trading/credential-vault';
import { IdempotencyService, MemoryIdempotencyStore, newClientOrderId } from '../trading/idempotency';
import { runRiskEngine, type TradingPolicy } from '../trading/risk-engine';
import type { SymbolInfo } from '@quantumtrade/schemas';

const KEK = randomBytes(32).toString('base64');
const SYM: SymbolInfo = { id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual', pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001', minQty: '0.001', maxLeverage: 125 };
const POLICY: TradingPolicy = { allowedSymbols: ['BTCUSDT'], maxOrderNotional: '100000', maxLeverage: 20, maxOpenPositions: 5, dailyOrderLimit: 50, dailyLossLimit: '1000', priceDeviationLimitPct: 5 };

describe('credential vault (envelope encryption)', () => {
  it('encrypts (no plaintext), masks access key, decrypts round-trip server-side', async () => {
    const vault = new CredentialVault(new LocalKekProvider(KEK));
    const cred = { accessKey: 'AKIA1234567890', secretKey: 'super-secret-value', memo: 'my-memo' };
    const enc = await vault.encrypt(cred);
    const blob = JSON.stringify(enc);
    expect(blob).not.toContain('super-secret-value');
    expect(blob).not.toContain('my-memo');
    expect(enc.accessKeyMasked).toBe('AKIA…7890');
    expect(enc.encryptionKeyVersion).toBe('local-v1');
    const dec = await vault.decrypt(enc);
    expect(dec).toEqual(cred);
  });
  it('tampered ciphertext fails auth (GCM)', async () => {
    const vault = new CredentialVault(new LocalKekProvider(KEK));
    const enc = await vault.encrypt({ accessKey: 'a', secretKey: 's', memo: 'm' });
    await expect(vault.decrypt({ ...enc, encryptedSecretKey: Buffer.from('deadbeef'.repeat(8)).toString('base64') })).rejects.toThrow();
  });
  it('supports KEK rotation (re-wrap DEK, plaintext recoverable)', async () => {
    const v1 = new CredentialVault(new LocalKekProvider(KEK, 'local-v1'));
    const enc = await v1.encrypt({ accessKey: 'a', secretKey: 's', memo: 'm' });
    const newKms = new LocalKekProvider(randomBytes(32).toString('base64'), 'local-v2');
    const rotated = await v1.rotate(enc, newKms);
    expect(rotated.encryptionKeyVersion).toBe('local-v2');
    const v2 = new CredentialVault(newKms);
    expect((await v2.decrypt(rotated)).secretKey).toBe('s');
  });
  it('masks short keys fully', () => {
    expect(maskAccessKey('short')).toBe('****');
  });
});

describe('idempotency service', () => {
  it('same key returns the same result; fn runs once', async () => {
    const svc = new IdempotencyService(new MemoryIdempotencyStore());
    let calls = 0;
    const fn = async () => { calls++; return { orderId: 'o1' }; };
    const a = await svc.run('k1', fn);
    const b = await svc.run('k1', fn);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual({ orderId: 'o1' });
    expect(calls).toBe(1);
  });
  it('concurrent same-key calls do not double-run (race protection)', async () => {
    const svc = new IdempotencyService(new MemoryIdempotencyStore());
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return calls; };
    const [x, y] = await Promise.all([svc.run('kR', fn), svc.run('kR', fn)]);
    expect(calls).toBe(1);
    expect(x.result).toBe(y.result);
  });
  it('client order ids are unique', () => {
    const s = new Set(Array.from({ length: 1000 }, () => newClientOrderId()));
    expect(s.size).toBe(1000);
  });
});

describe('server risk engine', () => {
  const base = {
    mode: 'LIVE_TRADE' as const, symbol: SYM, side: 'long' as const, orderType: 'limit' as const,
    price: '68000.0', quantity: '0.100', leverage: 20, stopLoss: '67000.0', takeProfit: '70000.0',
    riskReward: '2', maxEstLoss: '100', positionValue: '6800', marketDataStatus: 'LIVE', referencePrice: '68010.0',
    policy: POLICY, liveTradingEnabled: true, emergencyKillSwitch: false, credentialStatus: 'VERIFIED',
    futureTradePermissionVerified: true, userStatus: 'active', previewExpired: false, confirmationTokenValid: true,
    idempotencyKeyValid: true, exchangeConnectivityHealthy: true, dailyOrderCount: 0, dailyLossSoFar: '0', openPositions: 0,
    /*
       ★★ POLICY 는 일일 손실 한도 1000 을 걸어 두었다. 그런데 dailyLossSoFar 는
         측정값이 아니라 고정된 '0' 이다. 예전에는 `0 <= 1000` 이 참이라 이 테스트가
         통과했는데, 그건 **한도가 아무 것도 막지 못하는 상태를 통과로 본 것**이었다.
         이제 엔진은 "한도는 있는데 측정할 수 없다" 를 거부로 다룬다. 그래서 이
         테스트는 측정 가능함을 명시해야 한다 — 그게 이 테스트가 원래 검사하려던
         상황(깨끗한 주문)이다.
    */
    dailyLossKnown: true,
  };
  it('passes a clean live order and the live gate allows', () => {
    const r = runRiskEngine(base);
    expect(r.pass).toBe(true);
    expect(r.liveGate.allowed).toBe(true);
  });
  it('fails on leverage over policy', () => {
    const r = runRiskEngine({ ...base, leverage: 100 });
    expect(r.pass).toBe(false);
    expect(r.gates.find((g) => g.id === 'policy.leverage')!.status).toBe('fail');
    expect(r.liveGate.allowed).toBe(false);
  });
  it('fails on stale market data (and blocks live gate)', () => {
    const r = runRiskEngine({ ...base, marketDataStatus: 'STALE' });
    expect(r.pass).toBe(false);
    expect(r.liveGate.allowed).toBe(false);
  });
  it('fails on price deviation beyond limit', () => {
    const r = runRiskEngine({ ...base, price: '80000.0' });
    expect(r.gates.find((g) => g.id === 'policy.priceDeviation')!.status).toBe('fail');
  });
  it('kill switch / flag-off blocks live gate even when risk passes', () => {
    const r = runRiskEngine({ ...base, emergencyKillSwitch: true });
    expect(r.pass).toBe(true);
    expect(r.liveGate.allowed).toBe(false);
  });
  it('daily order limit enforced', () => {
    const r = runRiskEngine({ ...base, dailyOrderCount: 50 });
    expect(r.gates.find((g) => g.id === 'policy.dailyOrders')!.status).toBe('fail');
  });
});
