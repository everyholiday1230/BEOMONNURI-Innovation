import { describe, it, expect } from 'vitest';
import {
  assertProductionWsUrl,
  isProductionWsUrl,
  BITMART_WS_PRIVATE_DEFAULT,
  BITMART_WS_PUBLIC_DEFAULT,
} from '../ws-config';
import { BitMartPrivateStreamAdapter } from '../private-ws-adapter';

describe('BitMart WS URL production allowlist (§ pre-fix 2/3)', () => {
  it('accepts official production public + private URLs', () => {
    expect(isProductionWsUrl(BITMART_WS_PUBLIC_DEFAULT, 'public')).toBe(true);
    expect(isProductionWsUrl(BITMART_WS_PRIVATE_DEFAULT, 'private')).toBe(true);
    expect(assertProductionWsUrl(BITMART_WS_PRIVATE_DEFAULT)).toBe(BITMART_WS_PRIVATE_DEFAULT);
  });
  it('REJECTS demo WS endpoints (fail-closed)', () => {
    expect(() => assertProductionWsUrl('wss://openapi-wsdemo-v2.bitmart.com/user?protocol=1.1')).toThrow(/demo/i);
    expect(() => assertProductionWsUrl('wss://demo-api-cloud-v2.bitmart.com/user')).toThrow(/demo/i);
    expect(isProductionWsUrl('wss://openapi-wsdemo-v2.bitmart.com/api')).toBe(false);
  });
  it('rejects non-wss and non-official hosts', () => {
    // This asserts the guard REJECTS a plaintext (non-TLS) socket URL: the insecure scheme is the
    // test input, and the assertion is that it throws.
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
    expect(() => assertProductionWsUrl('ws://openapi-ws-v2.bitmart.com/user')).toThrow(/wss/i);
    expect(() => assertProductionWsUrl('wss://evil.example.com/user')).toThrow(/non-official/i);
    expect(() => assertProductionWsUrl('not-a-url')).toThrow(/invalid/i);
  });
});

describe('BitMartPrivateStreamAdapter construction (fail-closed on demo)', () => {
  it('constructs with a production URL and exposes it', () => {
    const a = new BitMartPrivateStreamAdapter({ url: BITMART_WS_PRIVATE_DEFAULT });
    expect(a.url).toBe(BITMART_WS_PRIVATE_DEFAULT);
    expect(a.connected).toBe(false);
  });
  it('THROWS at construction for a demo URL (never connects)', () => {
    expect(() => new BitMartPrivateStreamAdapter({ url: 'wss://openapi-wsdemo-v2.bitmart.com/user' })).toThrow(/demo/i);
  });
  it('connect without a socket factory / credentials is Not Executed (fail-closed), not faked', async () => {
    const a = new BitMartPrivateStreamAdapter({ url: BITMART_WS_PRIVATE_DEFAULT });
    await expect(a.connect({ mode: 'LIVE_READ_ONLY', credential: { accessKey: '', secretKey: '', memo: '' } }, () => {})).rejects.toThrow(/Not Executed|fail-closed/i);
    expect(a.connected).toBe(false);
  });
});
