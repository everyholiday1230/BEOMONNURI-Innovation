import { ExchangeSchema, type Exchange } from '@quantumtrade/schemas';

/**
 * G1 — the exchange catalogue.
 *
 * SINGLE SOURCE OF TRUTH for the operator's referral links (absolute rule §5.6). The design handoff
 * keeps them in `team_delivery/src/mock-app-data.js`; on the backend they live here and nowhere else.
 * To change a referral URL, edit this file only.
 *
 * Every field below is transcribed verbatim from `window.QTApp.EXCHANGES`, extracted by executing that
 * file in a node VM (not read by eye). `requiredPermissions` / `forbiddenPermissions` are added — see
 * the header of `packages/schemas/src/exchange.ts` for why.
 *
 * NOTE — referral codes are UNCONFIRMED. The handoff's `README.md` lists
 * "8개 거래소 API 계정 발급 · 대표님 referral 링크 확정" as an open pre-launch item, so the
 * `QUANTUM*` codes here are the designer's placeholders. They are wrong-but-traceable rather than
 * invented: they match the handoff exactly. Confirm before launch.
 */

/**
 * Scopes we ask a user to grant. Read is needed for balances/positions, Trade for order submission.
 * Nothing else is required, so nothing else is requested.
 */
const REQUIRED: Exchange['requiredPermissions'] = ['Read', 'Trade'];

/** Withdraw is refused everywhere it exists (absolute rule §5.4). */
const FORBIDDEN: Exchange['forbiddenPermissions'] = ['Withdraw'];

const CATALOGUE: readonly Exchange[] = [
  {
    // KuCoin — 현재 브로커 계약 거래소. 카탈로그 첫 자리에 둔다.
    //
    // 주의 1: KuCoin 은 apiKey/apiSecret 외에 passphrase 가 필수다. 다른 거래소와
    //         달리 세 필드를 모두 받아야 서명이 만들어진다.
    // 주의 2: referral 코드는 미확정이다. 브로커 승인 후 실제 코드로 교체해야 한다.
    //         (KUCOIN_BROKER_PARTNER 와는 별개 — 이건 가입 유입용 링크다)
    id: 'kucoin',
    name: 'KuCoin',
    logoText: 'K',
    logoBg: '#24AE8F',
    logoColor: '#0A0E14',
    market: 'Global · 664 USDT perpetuals',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Margin'],
    minLatency: 18,
    apiDocs: 'https://www.kucoin.com/docs-new',
    permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://www.kucoin.com/r/rf/QUANTUM-KURI',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: true,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'binance',
    name: 'Binance',
    logoText: 'B',
    logoBg: '#F0B90B',
    logoColor: '#0A0E14',
    market: 'Global · #1 by volume',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options', 'Margin'],
    minLatency: 12,
    apiDocs: 'https://binance-docs.github.io/apidocs/',
    permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://accounts.binance.com/register?ref=QUANTUM-KURI',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: true,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'bitget',
    name: 'Bitget',
    logoText: 'Bg',
    logoBg: '#00CED1',
    logoColor: '#0A0E14',
    market: 'Global · Copy trading strong',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Copy'],
    minLatency: 18,
    apiDocs: 'https://bitgetlimited.github.io/apidoc/en/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://partner.bitget.com/bg/QUANTUMKURI',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: true,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'bitmart',
    name: 'BitMart',
    logoText: 'Bm',
    logoBg: '#00D4AA',
    logoColor: '#0A0E14',
    market: 'Global · Deep alt liquidity',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 24,
    apiDocs: 'https://developer-pro.bitmart.com/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'memo'],
    referral: 'https://www.bitmart.com/register?r=QUANTUM',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: false,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'okx',
    name: 'OKX',
    logoText: 'OK',
    logoBg: '#0D0D0D',
    logoColor: '#FFFFFF',
    market: 'Global · Institutional',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
    minLatency: 14,
    apiDocs: 'https://www.okx.com/docs-v5/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://www.okx.com/join/QUANTUMKURI',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: true,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'bybit',
    name: 'Bybit',
    logoText: 'By',
    logoBg: '#F7A600',
    logoColor: '#0A0E14',
    market: 'Global · Derivatives focus',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
    minLatency: 15,
    apiDocs: 'https://bybit-exchange.github.io/docs/v5/intro',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://www.bybit.com/invite?ref=QUANTUM',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: true,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'gate',
    name: 'Gate.io',
    logoText: 'Gt',
    logoBg: '#2354E6',
    logoColor: '#FFFFFF',
    market: 'Global · Alt-heavy',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 22,
    apiDocs: 'https://www.gate.io/docs/apiv4/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://www.gate.io/signup/QUANTUMKURI',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'available',
    recommended: false,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: FORBIDDEN,
  },
  {
    id: 'kraken',
    name: 'Kraken',
    logoText: 'Kr',
    logoBg: '#5741D9',
    logoColor: '#FFFFFF',
    market: 'US · Regulated',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 32,
    apiDocs: 'https://docs.kraken.com/rest/',
    permissions: ['Read', 'Trade'],
    required: ['apiKey', 'privateKey'],
    referral: 'https://kraken.com/sign-up?ref=QUANTUM',
    referralNote: '리퍼럴 프로그램 준비 중',
    status: 'beta',
    recommended: false,
    requiredPermissions: REQUIRED,
    // Kraken's key system does not expose a Withdraw scope in the catalogue, so there is nothing to
    // forbid. The empty list is meaningful, not an oversight.
    forbiddenPermissions: [],
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    logoText: 'Cb',
    logoBg: '#0052FF',
    logoColor: '#FFFFFF',
    market: 'US · Institutional',
    supportedProducts: ['Spot', 'Perp (Advanced)'],
    minLatency: 34,
    apiDocs: 'https://docs.cloud.coinbase.com/',
    permissions: ['Read', 'Trade'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://coinbase.com/join/QUANTUM',
    referralNote: '수수료 페이백 (조건 확정 전)',
    status: 'coming-soon',
    recommended: false,
    requiredPermissions: REQUIRED,
    forbiddenPermissions: [],
  },
];

/**
 * Validate at module load. A malformed catalogue is a deploy-time bug, not a request-time one — an
 * exchange whose `forbiddenPermissions` forgot `Withdraw` must never reach a user, so this throws
 * rather than logging.
 */
const parsed = CATALOGUE.map((e, i) => {
  const r = ExchangeSchema.safeParse(e);
  if (!r.success) {
    const detail = r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
    throw new Error(`exchange catalogue entry ${i} (${e.id ?? '?'}) is invalid — ${detail}`);
  }
  return r.data;
});

const ids = parsed.map((e) => e.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) {
  throw new Error(`exchange catalogue has duplicate id(s): ${[...new Set(dupes)].join(', ')}`);
}

/** The validated catalogue. Frozen: a request handler must not be able to mutate shared state. */
export const EXCHANGES: readonly Exchange[] = Object.freeze(parsed);

/*
   실제로 연결할 수 있는 거래소.

   ★★ 카탈로그에는 9개가 있지만 **어댑터가 있는 것은 2개**다
     (`packages/exchange-kucoin`, `packages/exchange-bitmart`).
     나머지 7개는 사용자가 키를 등록해도 잔고 조회·주문이 동작하지 않는다.
     그런데 카탈로그에서 `status: 'available'` 로 나가고 있었다 — 사용자는
     연결된다고 믿고 거래소에서 키를 만들어 넣는다.

   ★ 목록에서 지우지 않는다. 나중에 협약이 늘어날 것이고, 운영자는 어떤
     거래소가 준비 중인지 봐야 한다. 대신 **일반 사용자에게는 감추고**
     관리자에게는 "미협약" 으로 보여준다(노출 판정은 라우터에서).

   ★ 이 목록은 어댑터 존재와 브로커 협약을 함께 뜻한다. 어댑터만 있고 협약이
     없으면 리베이트가 없으므로 여기 넣지 않는다.
     환경변수로 열지 않는다 — 어댑터 없는 거래소를 env 로 켜면 사용자가
     동작하지 않는 키를 등록하게 된다. 코드에 어댑터가 추가될 때 함께 고친다.
*/
export const CONNECTABLE_EXCHANGE_IDS: readonly string[] = Object.freeze(['kucoin', 'bitmart']);

/** 어댑터가 있고 협약된 거래소인가. */
export function isConnectable(id: string): boolean {
  return CONNECTABLE_EXCHANGE_IDS.includes(id);
}

/*
   카탈로그와 어댑터 목록이 어긋나지 않게 기동 시 확인한다.

   ★ 오타로 'kucoin' 을 'kukoin' 이라 쓰면 조용히 0개가 노출되고, 아무도
     거래소를 연결할 수 없게 된다. 그 상태로 배포되면 원인을 찾기 어렵다.
*/
{
  const unknown = CONNECTABLE_EXCHANGE_IDS.filter((id) => !parsed.some((e) => e.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `CONNECTABLE_EXCHANGE_IDS references unknown exchange id(s): ${unknown.join(', ')} — ` +
        'fix the id or add it to the catalogue',
    );
  }
}

/** Provenance string reported on the response, matching the market routes' convention. */
export const EXCHANGE_CATALOGUE_SOURCE = 'static-catalogue';

export function getExchange(id: string): Exchange | undefined {
  return EXCHANGES.find((e) => e.id === id);
}

/**
 * Permission gate used when a user stores or verifies an API key. Kept next to the catalogue so the
 * rule and the data cannot drift apart.
 *
 * Returns the forbidden scopes that were granted. An empty array means the key is acceptable.
 */
export function findForbiddenGrants(
  exchangeId: string,
  grantedPermissions: readonly string[],
): readonly string[] {
  const ex = getExchange(exchangeId);
  if (!ex) return [];
  const granted = new Set(grantedPermissions.map((p) => p.toLowerCase()));
  return ex.forbiddenPermissions.filter((p) => granted.has(p.toLowerCase()));
}
