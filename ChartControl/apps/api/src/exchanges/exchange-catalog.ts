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
 * NOTE — referral codes are CONFIRMED FOR KUCOIN AND BITMART.
 *
 *   KuCoin  `https://www.kucoin.com/r/broker/CXE8HTY1` — the operator's real broker referral link,
 *           verified 2026-08 by opening it: it lands on
 *           `/ucenter/signup?rcode=CXE8HTY1&utm_source=bf` and names our account as the inviter.
 *
 *   BitMart `https://www.bitmart.com/invite/ctCAsR` (code `ctCAsR`) — supplied by the operator
 *           2026-08. It replaced the designer's `register?r=QUANTUM` placeholder, which mattered
 *           because BitMart is `status: 'available'`: unlike the `preparing` exchanges, that wrong
 *           link WAS shown to users, so sign-ups through it credited nobody.
 *
 *   Everyone else still carries the designer's `QUANTUM*` placeholders. They are
 *   wrong-but-traceable rather than invented: they match the handoff exactly. That is tolerable
 *   only because those exchanges are `status: 'preparing'` and cannot be connected — the wizard
 *   never shows their link. Confirm each one before making it connectable, otherwise users sign up
 *   and the revenue is attributed to nobody.
 *
 *   ★ Why the `/r/broker/` path matters: `/r/rf/` is an ordinary personal referral and does NOT
 *     credit the broker account. Both paths accept the same code and both look fine in a browser,
 *     so a wrong path fails silently — sign-ups happen and the rebate is simply zero.
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
    // 주의 2: referral 은 운영자의 실제 브로커 추천 링크다 (2026-08 확인).
    //         /r/broker/ 경로여야 한다 — /r/rf/ 는 일반 개인 추천이고 브로커
    //         계정에 귀속되지 않는다. 링크를 열면
    //         /ucenter/signup?rcode=CXE8HTY1&utm_source=bf 로 넘어가며 초대자가
    //         우리 계정으로 표시되는 것을 실제로 확인했다.
    //         (KUCOIN_BROKER_PARTNER 와는 별개 — 이건 가입 유입용 링크다)
    //
    //         referralCode 를 함께 둔다: 이용자가 KuCoin 모바일 앱에서 가입하면
    //         링크를 탈 수 없어 가입 화면에 코드를 손으로 넣어야 한다. 코드를
    //         보여주지 않으면 그 경로로 가입한 사람은 귀속이 되지 않는다.
    id: 'kucoin',
    name: 'KuCoin',
    logoText: 'K',
    logoBg: '#24AE8F',
    logoColor: '#0A0E14',
    market: 'Global · 664 USDT perpetuals',
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_kucoin',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Margin'],
    minLatency: 18,
    apiDocs: 'https://www.kucoin.com/docs-new',
    permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://www.kucoin.com/r/broker/CXE8HTY1',
    referralCode: 'CXE8HTY1',
    referralConfirmed: true,
    /*
       ★ 거래소별 문구를 만들지 않는다. 문구 내용이 거래소와 무관하기 때문이다
         ("이 링크로 가입하면…"). 거래소마다 키를 만들면 거래소를 추가할 때마다
         3개 언어 문장이 늘고, 어느 하나가 낡으면 화면마다 다른 말을 하게 된다.
    */
    referralNoteKey: 'ex_referral_confirmed',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_binance',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options', 'Margin'],
    minLatency: 12,
    apiDocs: 'https://binance-docs.github.io/apidocs/',
    permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://accounts.binance.com/register?ref=QUANTUM-KURI',
    referralNoteKey: 'ex_referral_tbd',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_bitget',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Copy'],
    minLatency: 18,
    apiDocs: 'https://bitgetlimited.github.io/apidoc/en/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://partner.bitget.com/bg/QUANTUMKURI',
    referralNoteKey: 'ex_referral_tbd',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_bitmart',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 24,
    apiDocs: 'https://developer-pro.bitmart.com/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'memo'],
    /*
       ★★ 운영자의 실제 초대 링크 (2026-08 확인).

         전에는 디자이너 자리표시(`register?r=QUANTUM`)가 들어 있었다. 그런데
         BitMart 는 `status: 'available'` 이라 **화면에 실제로 노출되는 링크였다.**
         그 링크로 가입한 사람은 아무에게도 귀속되지 않는다 — 오류도 없고 화면도
         정상이라 "가입은 늘어나는데 수익이 0" 으로만 나타난다.

       ★ 환경변수(EXCHANGE_REFERRAL_URL_BITMART)가 이 값을 덮어쓴다. 계정을
         바꿀 때 코드를 고치지 않아도 된다.
    */
    referral: 'https://www.bitmart.com/invite/ctCAsR',
    /*
       링크로 오지 않고 직접 가입하는 사람이 입력하는 코드.

       ★ 링크와 같은 계정의 값이어야 한다. 어긋나면 어느 쪽으로 가입했는지에
         따라 귀속이 갈린다 — 틀린 코드는 없는 코드보다 나쁘다.
    */
    referralCode: 'ctCAsR',
    referralConfirmed: true,
    referralNoteKey: 'ex_referral_confirmed',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_okx',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
    minLatency: 14,
    apiDocs: 'https://www.okx.com/docs-v5/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret', 'passphrase'],
    referral: 'https://www.okx.com/join/QUANTUMKURI',
    referralNoteKey: 'ex_referral_tbd',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_bybit',
    supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
    minLatency: 15,
    apiDocs: 'https://bybit-exchange.github.io/docs/v5/intro',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://www.bybit.com/invite?ref=QUANTUM',
    referralNoteKey: 'ex_referral_tbd',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_gate',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 22,
    apiDocs: 'https://www.gate.io/docs/apiv4/',
    permissions: ['Read', 'Trade', 'Withdraw'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://www.gate.io/signup/QUANTUMKURI',
    referralNoteKey: 'ex_referral_tbd',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_kraken',
    supportedProducts: ['Spot', 'Perp', 'Futures'],
    minLatency: 32,
    apiDocs: 'https://docs.kraken.com/rest/',
    permissions: ['Read', 'Trade'],
    required: ['apiKey', 'privateKey'],
    referral: 'https://kraken.com/sign-up?ref=QUANTUM',
    referralNoteKey: 'ex_referral_pending',
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
    /* 화면 표기는 사전에서 온다 — 서버가 문장을 정하면 ja/zh 화면에 영어가 남는다. */
    marketKey: 'ex_market_coinbase',
    supportedProducts: ['Spot', 'Perp (Advanced)'],
    minLatency: 34,
    apiDocs: 'https://docs.cloud.coinbase.com/',
    permissions: ['Read', 'Trade'],
    required: ['apiKey', 'apiSecret'],
    referral: 'https://coinbase.com/join/QUANTUM',
    referralNoteKey: 'ex_referral_tbd',
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
/*
   ★★ BitMart 를 뺐다. **2026-08-26 01:00 UTC 에 거래를 종료했다.**

     그런데 연결 가능 목록에 남아 있어서, 고객 지갑 화면에 파트너 거래소로
     노출되고 가입 링크(https://www.bitmart.com/invite/...)와 "Connect API" 까지
     제공됐다. 고객이 문 닫은 거래소에 가입해 키를 만들어 넣는 경로였다 —
     그 키로는 아무 주문도 나가지 않고, 고객은 이유를 알 수 없다.

   ★ 카탈로그에서 지우지는 않는다. 어댑터 코드도 남아 있고(폴백), 과거 연결
     기록과 리베이트 조회가 그 id 를 참조한다. '연결을 권하지 않는다' 와
     '존재하지 않는다' 는 다른 사실이다.
*/
export const CONNECTABLE_EXCHANGE_IDS: readonly string[] = Object.freeze(['kucoin']);

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

/**
 * Built-in referral defaults for the UI — only exchanges whose link the operator has verified.
 *
 * ★ Why this is derived here instead of being configured per deployment.
 *
 *   The referral link is not a secret and not deployment-specific: it identifies the operator's
 *   own account and is the same everywhere the product runs. Keeping it only in the environment
 *   meant the confirmed value lived in two unrelated places (this file and the env), and the UI
 *   read the env one. A deployment that simply forgot the variable showed no link at all and
 *   every sign-up went unattributed — with nothing on screen to reveal it.
 *
 *   So the code holds the verified value, and the environment may override it (see
 *   `EXCHANGE_REFERRAL_URL_*`). Configuration wins when present; otherwise the reviewed value in
 *   the repository is used.
 *
 * ★ Unconfirmed entries are excluded. A placeholder code is worse than no link: the user signs
 *   up, sees success, and the revenue is attributed to nobody.
 */
export function getConfirmedReferrals(): {
  urls: Readonly<Record<string, string>>;
  codes: Readonly<Record<string, string>>;
} {
  const urls: Record<string, string> = {};
  const codes: Record<string, string> = {};
  for (const e of EXCHANGES) {
    if (e.referralConfirmed !== true) continue;
    if (e.referral) urls[e.id] = e.referral;
    if (e.referralCode) codes[e.id] = e.referralCode;
  }
  return { urls: Object.freeze(urls), codes: Object.freeze(codes) };
}
