/* ============================================================
   Mock App Data — Exchanges, Referrals, Admin, User Profile,
   Notifications, Strategies, Portfolio, Analytics
   ------------------------------------------------------------
   대표님 referral 링크 등 향후 편집이 필요한 값은 이 파일에서만
   관리합니다. 다른 파일은 여기 데이터를 참조만 하도록 설계.
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // EXCHANGES  — 사용자가 API key 를 연동할 수 있는 지원 거래소
  // 각 항목의 referral 필드가 대표님 회원가입 링크입니다.
  // 링크는 언제든 이 파일에서만 수정하면 전체 UI 반영.
  // ============================================================
  const EXCHANGES = [
    {
      // KuCoin — 현재 브로커 계약 거래소. 목록 첫 자리.
      // 백엔드 단일 진실 공급원: apps/api/src/exchanges/exchange-catalog.ts
      // (백엔드가 붙으면 이 목업은 GET /api/v1/exchanges 로 대체된다)
      id: 'kucoin',
      name: 'KuCoin',
      logoText: 'K',
      logoBg: '#24AE8F',
      logoColor: '#0A0E14',
      market: 'Global · 664 USDT perpetuals',
      marketKey: 'ex_market_kucoin',
      supportedProducts: ['Spot', 'Perp', 'Futures', 'Margin'],
      minLatency: 18,
      apiDocs: 'https://www.kucoin.com/docs-new',
      permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
      // KuCoin 은 passphrase 필수 — 세 필드를 다 받아야 서명이 만들어진다.
      required: ['apiKey', 'apiSecret', 'passphrase'],
      /*
         추천 가입 링크.

         원래 예시 코드('QUANTUM-KURI' 등)가 9개 거래소에 박혀 있었다. 디자인
         시연용 값이었지만 그대로 런칭하면 사용자는 그 링크로 가입하고,
         존재하지 않는 코드라 **귀속이 안 돼 수익이 0** 이 된다. 가입은
         정상으로 보이므로 새는 것을 알아채기 어렵다.

         실제 값은 서버 설정(EXCHANGE_REFERRAL_URL_<ID>)에서 온다.
         null 이면 화면이 유도 카드를 감춘다 — 링크 없는 카드를 보여주지 않는다.
      */
      referral: null,
      referralRebate: { pending: true },
      status: 'available',
      recommended: true,
    },
    {
      id: 'binance',
      name: 'Binance',
      logoText: 'B',
      logoBg: '#F0B90B',
      logoColor: '#0A0E14',
      market: 'Global · #1 by volume',
      marketKey: 'ex_market_binance',
      supportedProducts: ['Spot', 'Perp', 'Futures', 'Options', 'Margin'],
      minLatency: 12,
      apiDocs: 'https://binance-docs.github.io/apidocs/',
      permissions: ['Read', 'Trade', 'Withdraw', 'Futures'],
      required: ['apiKey', 'apiSecret'],
      referral: null,
      referralRebate: { rebatePct: 20 },
      status: 'available',
      recommended: true,
    },
    {
      id: 'bitget',
      name: 'Bitget',
      logoText: 'Bg',
      logoBg: '#00CED1',
      logoColor: '#0A0E14',
      market: 'Global · Copy trading strong',
      marketKey: 'ex_market_bitget',
      supportedProducts: ['Spot', 'Perp', 'Futures', 'Copy'],
      minLatency: 18,
      apiDocs: 'https://bitgetlimited.github.io/apidoc/en/',
      permissions: ['Read', 'Trade', 'Withdraw'],
      required: ['apiKey', 'apiSecret', 'passphrase'],
      referral: null,
      referralRebate: { rebatePct: 50, bonusUsd: 100 },
      status: 'available',
      recommended: true,
    },
    {
      id: 'bitmart',
      name: 'BitMart',
      logoText: 'Bm',
      logoBg: '#00D4AA',
      logoColor: '#0A0E14',
      market: 'Global · Deep alt liquidity',
      marketKey: 'ex_market_bitmart',
      supportedProducts: ['Spot', 'Perp', 'Futures'],
      minLatency: 24,
      apiDocs: 'https://developer-pro.bitmart.com/',
      permissions: ['Read', 'Trade', 'Withdraw'],
      required: ['apiKey', 'apiSecret', 'memo'],
      referral: null,
      referralRebate: { rebatePct: 25 },
      status: 'available',
      recommended: false,
    },
    {
      id: 'okx',
      name: 'OKX',
      logoText: 'OK',
      logoBg: '#0D0D0D',
      logoColor: '#FFFFFF',
      market: 'Global · Institutional',
      marketKey: 'ex_market_okx',
      supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
      minLatency: 14,
      apiDocs: 'https://www.okx.com/docs-v5/',
      permissions: ['Read', 'Trade', 'Withdraw'],
      required: ['apiKey', 'apiSecret', 'passphrase'],
      referral: null,
      referralRebate: { rebatePct: 20, bonusUsd: 50 },
      status: 'available',
      recommended: true,
    },
    {
      id: 'bybit',
      name: 'Bybit',
      logoText: 'By',
      logoBg: '#F7A600',
      logoColor: '#0A0E14',
      market: 'Global · Derivatives focus',
      marketKey: 'ex_market_bybit',
      supportedProducts: ['Spot', 'Perp', 'Futures', 'Options'],
      minLatency: 15,
      apiDocs: 'https://bybit-exchange.github.io/docs/v5/intro',
      permissions: ['Read', 'Trade', 'Withdraw'],
      required: ['apiKey', 'apiSecret'],
      referral: null,
      referralRebate: { rebatePct: 40 },
      status: 'available',
      recommended: true,
    },
    {
      id: 'gate',
      name: 'Gate.io',
      logoText: 'Gt',
      logoBg: '#2354E6',
      logoColor: '#FFFFFF',
      market: 'Global · Alt-heavy',
      marketKey: 'ex_market_gate',
      supportedProducts: ['Spot', 'Perp', 'Futures'],
      minLatency: 22,
      apiDocs: 'https://www.gate.io/docs/apiv4/',
      permissions: ['Read', 'Trade', 'Withdraw'],
      required: ['apiKey', 'apiSecret'],
      referral: null,
      referralRebate: { rebatePct: 30 },
      status: 'available',
      recommended: false,
    },
    {
      id: 'kraken',
      name: 'Kraken',
      logoText: 'Kr',
      logoBg: '#5741D9',
      logoColor: '#FFFFFF',
      market: 'US · Regulated',
      marketKey: 'ex_market_kraken',
      supportedProducts: ['Spot', 'Perp', 'Futures'],
      minLatency: 32,
      apiDocs: 'https://docs.kraken.com/rest/',
      permissions: ['Read', 'Trade'],
      required: ['apiKey', 'privateKey'],
      referral: null,
      referralRebate: { pending: true },
      status: 'beta',
      recommended: false,
    },
    {
      id: 'coinbase',
      name: 'Coinbase',
      logoText: 'Cb',
      logoBg: '#0052FF',
      logoColor: '#FFFFFF',
      market: 'US · Institutional',
      marketKey: 'ex_market_coinbase',
      supportedProducts: ['Spot', 'Perp (Advanced)'],
      minLatency: 34,
      apiDocs: 'https://docs.cloud.coinbase.com/',
      permissions: ['Read', 'Trade'],
      required: ['apiKey', 'apiSecret'],
      referral: null,
      referralRebate: { creditUsd: 30 },
      status: 'coming-soon',
      recommended: false,
    },
  ];

  // ============================================================
  // USER — 현재 로그인한 프로필 (mock)
  // ============================================================
  const USER = {
    id: 'usr_kuri001',
    name: '권누리',
    email: 'kuri@quantumtrade.ai',
    avatarInitial: 'K',
    role: 'user',             // user | ops | admin | super
    kycLevel: 2,              // 0..3
    kycStatus: 'verified',    // pending | verified | rejected | expired
    twofa: true,
    createdAt: '2025-11-18T02:14:00Z',
    lastLogin: '2026-08-02T09:14:00Z',
    tier: 'Pro',              // Beginner | Standard | Pro | VIP
    tradingVolume30d: 42_180_000,
    connectedExchanges: ['binance', 'bitget'],
    apiKeys: [
      { id: 'apk_1', exchange: 'binance', label: 'Main Trading', permissions: ['Read','Trade','Futures'], created: '2026-05-12', lastUsed: '2026-08-02T08:12:00Z', status: 'active', ipRestricted: true },
      { id: 'apk_2', exchange: 'bitget',  label: 'Copy trading',  permissions: ['Read','Trade'],           created: '2026-06-01', lastUsed: '2026-08-01T15:44:00Z', status: 'active', ipRestricted: false },
    ],
  };

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  const NOTIFICATIONS = [
    { id:'n1',  kind:'signal',  title:'AI Signal · BTC/USDT Long',    body:'Confidence 74% · Entry 68,120–68,360',   time: Date.now()-1000*60*3,    unread:true,  route:'/trade' },
    { id:'n2',  kind:'order',   title:'주문 체결 · SOL/USDT Long',     body:'0.5 SOL @ 178.42 · Fee 0.06 USDT',       time: Date.now()-1000*60*14,   unread:true,  route:'/order-history' },
    { id:'n3',  kind:'risk',    title:'⚠ 마진 비율 경고 · ETH/USDT',   body:'Margin ratio 62% · 주의',                 time: Date.now()-1000*60*32,   unread:true,  route:'/portfolio' },
    { id:'n4',  kind:'system',  title:'API Key 사용 감지',            body:'Binance · Main Trading · Seoul IP',       time: Date.now()-1000*60*90,   unread:false, route:'/settings/security' },
    { id:'n5',  kind:'signal',  title:'AI Signal · ETH/USDT Short',   body:'Confidence 68% · Entry 3,568',            time: Date.now()-1000*60*180,  unread:false, route:'/trade' },
    { id:'n6',  kind:'notice',  title:'📢 정기 점검 안내',              body:'8월 5일 04:00–04:30 UTC · WebSocket 재연결', time: Date.now()-1000*60*60*5, unread:false, route:'/notifications' },
    { id:'n7',  kind:'promo',   title:'🎉 신규 리베이트 프로모션',       body:'8월 한 달간 수수료 30% 환급',              time: Date.now()-1000*60*60*10,unread:false, route:'/notifications' },
    { id:'n8',  kind:'order',   title:'주문 취소 · BTC/USDT',           body:'Limit 66,500 · 사용자 취소',              time: Date.now()-1000*60*60*22,unread:false, route:'/order-history' },
    { id:'n9',  kind:'system',  title:'거래소 연동 완료',                body:'Bitget · API key 검증 성공',              time: Date.now()-1000*60*60*40,unread:false, route:'/wallet' },
    { id:'n10', kind:'notice',  title:'📄 이용약관 개정',                body:'2026-08-15 부터 적용 · 확인 필요',        time: Date.now()-1000*60*60*72,unread:false, route:'/notifications' },
  ];

  // ============================================================
  // AI STRATEGIES (팔로우/백테스트 가능한 목록)
  // ============================================================
  const STRATEGIES = [
    { id:'strat-01', name:'BTC Momentum Rider',        authorKey:'author_house_lab', tag:'Momentum · 4H',   pnl30:  38.4, winRate: 62, sharpe: 2.1, maxDD:  8.4, followers: 1240, subscription:'Free',   backtestRange:'2024-01 → 2026-07' },
    { id:'strat-02', name:'ETH Mean Reversion',        author:'@byrne',           tag:'Mean-Rev · 1H',    pnl30:  22.1, winRate: 71, sharpe: 2.9, maxDD:  5.2, followers:  842, subscription:'Free',   backtestRange:'2024-06 → 2026-07' },
    { id:'strat-03', name:'Alt Rotation Alpha',        author:'@nova',            tag:'Rotation · 1D',    pnl30:  84.6, winRate: 54, sharpe: 1.6, maxDD: 18.2, followers:  612, subscription:'Pro',    backtestRange:'2023-01 → 2026-07' },
    { id:'strat-04', name:'Volatility Fade (SOL)',     authorKey:'author_house_lab', tag:'Vol · 15m',        pnl30:  12.8, winRate: 74, sharpe: 3.4, maxDD:  3.9, followers:  428, subscription:'Free',   backtestRange:'2025-01 → 2026-07' },
    { id:'strat-05', name:'BTC Trend + Copilot',       authorKey:'author_house_lab', tag:'Trend + AI · 4H',  pnl30:  54.2, winRate: 58, sharpe: 2.4, maxDD:  9.8, followers: 2140, subscription:'Pro',    backtestRange:'2024-01 → 2026-07', featured: true },
    { id:'strat-06', name:'Funding Rate Arbitrage',    author:'@perpfarmer',      tag:'Delta-Neutral',    pnl30:   4.6, winRate: 92, sharpe: 4.8, maxDD:  1.1, followers:  318, subscription:'VIP',    backtestRange:'2024-06 → 2026-07' },
    { id:'strat-07', name:'Breakout Scalper (BTC/ETH)',author:'@atlas',           tag:'Scalp · 5m',       pnl30:  28.4, winRate: 48, sharpe: 1.8, maxDD:  6.4, followers:  524, subscription:'Pro',    backtestRange:'2025-06 → 2026-07' },
    { id:'strat-08', name:'AI News Sentiment Long',    authorKey:'author_house_lab', tag:'Sentiment · 1H',   pnl30:  16.2, winRate: 66, sharpe: 2.2, maxDD:  4.8, followers:  892, subscription:'Pro',    backtestRange:'2025-09 → 2026-07' },
  ];

  // ============================================================
  // TRADE JOURNAL (사용자의 과거 트레이드 · Analytics 페이지)
  // ============================================================
  const TRADE_JOURNAL = [
    { id:'tj-24', date:'2026-08-02', sym:'BTC/USDT', side:'long',  entry:67285.4, exit:68432.5, size:0.185, pnl: 212.42, roi:  1.71, mood:'confident', tag:['ai-signal','trend'] },
    { id:'tj-23', date:'2026-08-01', sym:'ETH/USDT', side:'short', entry:3568.2,  exit:3512.82, size:1.5,   pnl:  83.07, roi:  1.55, mood:'confident', tag:['mean-rev'] },
    { id:'tj-22', date:'2026-07-31', sym:'SOL/USDT', side:'long',  entry:174.20,  exit:178.42,  size:24,    pnl: 101.28, roi:  2.42, mood:'neutral',   tag:['ai-signal'] },
    { id:'tj-21', date:'2026-07-30', sym:'BTC/USDT', side:'long',  entry:67840,   exit:67280,   size:0.10,  pnl: -56.00, roi: -0.82, mood:'nervous',   tag:['news-fade'] },
    { id:'tj-20', date:'2026-07-29', sym:'ARB/USDT', side:'long',  entry:0.821,   exit:0.842,   size:1200,  pnl:  25.20, roi:  2.56, mood:'confident', tag:['breakout'] },
    { id:'tj-19', date:'2026-07-28', sym:'DOGE/USDT',side:'short', entry:0.142,   exit:0.138,   size:8000,  pnl:  32.00, roi:  2.82, mood:'neutral',   tag:['range'] },
    { id:'tj-18', date:'2026-07-27', sym:'ETH/USDT', side:'long',  entry:3480,    exit:3568,    size:0.4,   pnl:  35.20, roi:  2.53, mood:'confident', tag:['ai-signal','trend'] },
    { id:'tj-17', date:'2026-07-26', sym:'BTC/USDT', side:'short', entry:68120,   exit:67480,   size:0.08,  pnl:  51.20, roi:  1.51, mood:'neutral',   tag:['tp1'] },
    { id:'tj-16', date:'2026-07-25', sym:'AVAX/USDT',side:'long',  entry:34.10,   exit:33.60,   size:20,    pnl: -10.00, roi: -1.47, mood:'nervous',   tag:['stop-loss'] },
    { id:'tj-15', date:'2026-07-24', sym:'BTC/USDT', side:'long',  entry:67200,   exit:68450,   size:0.15,  pnl: 187.50, roi:  1.86, mood:'confident', tag:['ai-signal','trend','tp3'] },
  ];

  // ============================================================
  // PORTFOLIO ALLOCATION (자산 배분 · Portfolio 페이지)
  // ============================================================
  const ALLOCATION = [
    { asset:'BTC',  value: 6842.30, pct: 34.2, chg24h:  2.34 },
    { asset:'ETH',  value: 4210.50, pct: 21.1, chg24h:  1.12 },
    { asset:'SOL',  value: 2140.80, pct: 10.7, chg24h:  4.56 },
    { asset:'USDT', value: 5820.14, pct: 29.1, chg24h:  0.00 },
    { asset:'ARB',  value:  480.60, pct:  2.4, chg24h:  1.86 },
    { asset:'OP',   value:  325.70, pct:  1.6, chg24h:  5.24 },
    { asset:'OTHER', assetKey:'asset_other', value:  180.10, pct:  0.9, chg24h:  0.42 },
  ];

  // Equity curve — 30 days
  const EQUITY_CURVE = (function () {
    const points = [];
    let v = 11400;
    const now = Date.now();
    for (let i = 29; i >= 0; i--) {
      v += (Math.random() - 0.42) * 220;
      v = Math.max(10800, v);
      points.push({ t: now - i * 86400 * 1000, v: +v.toFixed(2) });
    }
    // ensure last matches equity in mock-data
    points[points.length - 1].v = 12820.14;
    return points;
  })();

  // ============================================================
  // ADMIN — USERS
  // ============================================================
  const ADMIN_USERS = [
    { id:'usr_kuri001', name:'권누리',   email:'kuri@quantumtrade.ai',    kyc:2, status:'active',    tier:'Pro',    country:'KR', vol30: 42_180_000, joined:'2025-11-18', flags:[] },
    { id:'usr_00002',   name:'이혜원',   email:'hyewon@quantumtrade.ai',  kyc:3, status:'active',    tier:'VIP',    country:'KR', vol30:112_400_000, joined:'2025-11-18', flags:[] },
    { id:'usr_00003',   name:'John Kim', email:'john.kim@example.com',    kyc:2, status:'active',    tier:'Pro',    country:'US', vol30:  8_240_000, joined:'2026-01-14', flags:[] },
    { id:'usr_00004',   name:'田中 陽菜', email:'haruna@example.jp',       kyc:2, status:'active',    tier:'Standard', country:'JP', vol30: 3_120_000, joined:'2026-02-02', flags:[] },
    { id:'usr_00005',   name:'Alice Wu', email:'alice.wu@example.com',    kyc:1, status:'pending',   tier:'Beginner',country:'HK', vol30:    140_000, joined:'2026-06-28', flags:['low-kyc'] },
    { id:'usr_00006',   name:'Mike J.',  email:'mike@example.com',        kyc:0, status:'suspended', tier:'Beginner',country:'GB', vol30:          0, joined:'2026-04-02', flags:['aml-review'] },
    { id:'usr_00007',   name:'박서준',   email:'seojun@example.com',      kyc:3, status:'active',    tier:'VIP',    country:'KR', vol30: 68_400_000, joined:'2025-12-04', flags:[] },
    { id:'usr_00008',   name:'Sara N.',  email:'sara@example.com',        kyc:2, status:'active',    tier:'Pro',    country:'SG', vol30: 12_800_000, joined:'2026-01-21', flags:[] },
    { id:'usr_00009',   name:'Amir F.',  email:'amir@example.com',        kyc:2, status:'active',    tier:'Standard', country:'AE', vol30:  2_240_000, joined:'2026-03-16', flags:[] },
    { id:'usr_00010',   name:'Lea C.',   email:'lea@example.com',         kyc:1, status:'active',    tier:'Beginner',country:'FR', vol30:    620_000, joined:'2026-05-04', flags:[] },
    { id:'usr_00011',   name:'김도현',   email:'dohyun@example.com',      kyc:2, status:'restricted',tier:'Standard', country:'KR', vol30:  1_140_000, joined:'2026-02-19', flags:['ip-anomaly'] },
    { id:'usr_00012',   name:'Emma B.',  email:'emma@example.com',        kyc:2, status:'active',    tier:'Standard', country:'DE', vol30:  4_820_000, joined:'2026-01-30', flags:[] },
  ];

  // ============================================================
  // ADMIN — LIVE TRADES stream (for Trade Monitoring page)
  // ============================================================
  const ADMIN_LIVE_TRADES = [
    { time: Date.now()-1000*2,   userId:'usr_kuri001', sym:'BTC/USDT', side:'long',  size:0.185,  price:68432.5, notional:12660.06, tag:'ok' },
    { time: Date.now()-1000*4,   userId:'usr_00007',   sym:'ETH/USDT', side:'short', size:24.0,   price: 3512.8, notional:84307.20, tag:'large' },
    { time: Date.now()-1000*8,   userId:'usr_00003',   sym:'SOL/USDT', side:'long',  size:120,    price:  178.4, notional:21408.00, tag:'ok' },
    { time: Date.now()-1000*12,  userId:'usr_00002',   sym:'BTC/USDT', side:'long',  size:2.0,    price:68420.0, notional:136840.00,tag:'vip' },
    { time: Date.now()-1000*15,  userId:'usr_00008',   sym:'DOGE/USDT',side:'short', size:100000, price:  0.138, notional:13800.00, tag:'ok' },
    { time: Date.now()-1000*20,  userId:'usr_00011',   sym:'BTC/USDT', side:'short', size:8.4,    price:68400.0, notional:574560.00,tag:'suspicious' },
    { time: Date.now()-1000*24,  userId:'usr_00004',   sym:'ARB/USDT', side:'long',  size:5000,   price:  0.842, notional: 4210.00, tag:'ok' },
    { time: Date.now()-1000*30,  userId:'usr_kuri001', sym:'SOL/USDT', side:'long',  size:5,      price:  178.5, notional:  892.50, tag:'ok' },
    { time: Date.now()-1000*38,  userId:'usr_00007',   sym:'ETH/USDT', side:'long',  size:12.4,   price: 3513.0, notional:43561.20, tag:'ok' },
    { time: Date.now()-1000*44,  userId:'usr_00006',   sym:'BTC/USDT', side:'short', size:0.02,   price:68420.0, notional: 1368.40, tag:'flagged' },
    { time: Date.now()-1000*52,  userId:'usr_00009',   sym:'ATOM/USDT',side:'long',  size:800,    price:  6.42,  notional: 5136.00, tag:'ok' },
    { time: Date.now()-1000*60,  userId:'usr_00003',   sym:'BTC/USDT', side:'long',  size:0.5,    price:68410.0, notional:34205.00, tag:'ok' },
    { time: Date.now()-1000*72,  userId:'usr_00002',   sym:'BTC/USDT', side:'short', size:1.2,    price:68440.0, notional:82128.00, tag:'vip' },
    { time: Date.now()-1000*90,  userId:'usr_00012',   sym:'AVAX/USDT',side:'long',  size:80,     price: 34.6,   notional: 2768.00, tag:'ok' },
  ];

  // ============================================================
  // ADMIN — RISK QUEUE
  // ============================================================
  const ADMIN_RISK_QUEUE = [
    { id:'r1', userId:'usr_00006', sym:'BTC/USDT', side:'short', size:0.02,  entry:68120, mark:68432, marginRatio:0.94, liqDist: 0.6,  severity:'critical' },
    { id:'r2', userId:'usr_00011', sym:'ETH/USDT', side:'long',  size:8.4,   entry: 3512, mark: 3510, marginRatio:0.71, liqDist: 3.8,  severity:'high' },
    { id:'r3', userId:'usr_00005', sym:'SOL/USDT', side:'long',  size:120,   entry:  180, mark:  178, marginRatio:0.62, liqDist: 5.4,  severity:'high' },
    { id:'r4', userId:'usr_00009', sym:'DOGE/USDT',side:'long',  size:80000, entry: 0.14, mark: 0.138,marginRatio:0.44, liqDist: 8.2,  severity:'medium' },
    { id:'r5', userId:'usr_00012', sym:'ARB/USDT', side:'long',  size:12000, entry:0.842, mark:0.836, marginRatio:0.28, liqDist:12.4,  severity:'low' },
  ];

  // ============================================================
  // ADMIN — AI Ops (signal quality)
  // ============================================================
  const ADMIN_AI_METRICS = {
    modelVersionKey: 'model_analyst_v142',
    lastDeploy: '2026-07-24T09:00:00Z',
    signalsToday: 486,
    approveRate: 0.62,        // 62% of signals approved by users
    hitRate7d: 0.58,           // 58% of approved signals hit TP1
    avgConfidence: 0.71,
    avgRR: 2.6,
    tokensToday: 4_820_000,
    tokensCostUSD: 68.42,
    avgLatencyMs: 1240,
    errorRate: 0.008,
    modelBreakdown: [
      { model: 'v1.4.2', share: 0.86, hitRate: 0.58 },
      { model: 'v1.3.9', share: 0.14, hitRate: 0.51 },
    ],
    recentIncidents: [
      { time: Date.now()-1000*60*20,  severity:'warn',  desc:'Response latency spike · 3.2s (WS backfill)' },
      { time: Date.now()-1000*60*140, severity:'ok',    desc:'Prompt v14 rollout complete' },
    ],
  };

  // ============================================================
  // ADMIN — SYSTEM STATUS
  // ============================================================
  const ADMIN_SYSTEM = [
    { id:'ws',       name:'WebSocket Gateway',  status:'ok',      latency:12,  uptime:99.984 },
    { id:'match',    name:'Matching Engine',    status:'ok',      latency: 4,  uptime:99.999 },
    { id:'risk',     name:'Risk Engine',        status:'ok',      latency: 8,  uptime:99.980 },
    { id:'ai',       name:'AI Analyst Model',   status:'degraded',latency:1240,uptime:99.640, note:'응답 지연 관찰' },
    { id:'db-hot',   name:'DB · Hot Shard',     status:'ok',      latency: 2,  uptime:99.998 },
    { id:'db-cold',  name:'DB · Analytics',     status:'ok',      latency: 6,  uptime:99.960 },
    { id:'cdn',      name:'Static CDN',         status:'ok',      latency:24,  uptime:99.999 },
    { id:'batch',    name:'Nightly Batch',      status:'ok',      latency:'—', uptime:99.900, note:'다음 실행 03:00 UTC' },
    { id:'kyc',      name:'KYC Provider',       status:'ok',      latency:840, uptime:99.920 },
    { id:'notify',   name:'Notification Fanout',status:'ok',      latency:32,  uptime:99.980 },
  ];

  // ============================================================
  // ADMIN — AUDIT LOG
  // ============================================================
  const ADMIN_AUDIT = [
    { time: Date.now()-1000*60*4,   actor:'admin_kuri', action:'user.suspend',           target:'usr_00006', ip:'59.10.'+Math.floor(Math.random()*255)+'.4', ok:true },
    { time: Date.now()-1000*60*22,  actor:'admin_kuri', action:'fee.update',             target:'tier:VIP', ip:'59.10.20.4', ok:true, meta:'maker 0.02 → 0.015' },
    { time: Date.now()-1000*60*40,  actor:'ops_hyewon', action:'notice.publish',         target:'notice#42', ip:'223.62.150.8', ok:true },
    { time: Date.now()-1000*60*54,  actor:'system',     action:'batch.reconcile.run',    target:'2026-08-01', ip:'—', ok:true },
    { time: Date.now()-1000*60*80,  actor:'admin_kuri', action:'ai.prompt.deploy',       target:'analyst/v14.3', ip:'59.10.20.4', ok:true },
    { time: Date.now()-1000*60*140, actor:'ops_hyewon', action:'user.kyc.approve',       target:'usr_00003', ip:'223.62.150.8', ok:true },
    { time: Date.now()-1000*60*220, actor:'admin_kuri', action:'design.token.publish',   target:'brand.institutional-cool', ip:'59.10.20.4', ok:true },
    { time: Date.now()-1000*60*300, actor:'system',     action:'trade.anomaly.flag',     target:'trade_881423', ip:'—', ok:true, meta:'>3σ size · usr_00011' },
    { time: Date.now()-1000*60*420, actor:'ops_hyewon', action:'promo.launch',           target:'PROMO-AUG26', ip:'223.62.150.8', ok:true },
    { time: Date.now()-1000*60*600, actor:'admin_kuri', action:'exchange.enable',        target:'okx', ip:'59.10.20.4', ok:true },
  ];

  // ============================================================
  // NOTICES / CS TICKETS
  // ============================================================
  const NOTICES = [
    { id:'nt-42', title:'📢 정기 점검 안내 (8/5 04:00-04:30 UTC)', pinned:true, published:'2026-08-01', status:'published' },
    { id:'nt-41', title:'🎉 8월 리베이트 프로모션 안내',            pinned:true, published:'2026-08-01', status:'published' },
    { id:'nt-40', title:'📄 이용약관 개정 (8/15 시행)',             pinned:false, published:'2026-07-30', status:'published' },
    { id:'nt-39', title:'🆕 OKX 거래소 연동 지원 시작',              pinned:false, published:'2026-07-24', status:'published' },
    { id:'nt-38', title:'🔧 AI Copilot v1.4 릴리즈 노트',            pinned:false, published:'2026-07-24', status:'published' },
    { id:'nt-37', title:'📉 시장 급변 대응 안내 (2026-07-19)',       pinned:false, published:'2026-07-19', status:'published' },
  ];

  const CS_TICKETS = [
    { id:'cs-001', user:'usr_00005', subject:'KYC 승인 대기',        status:'open',     priority:'medium', updated: Date.now()-1000*60*20 },
    { id:'cs-002', user:'usr_00011', subject:'출금 지연 문의',        status:'open',     priority:'high',   updated: Date.now()-1000*60*40 },
    { id:'cs-003', user:'usr_00003', subject:'API key 검증 실패',    status:'pending',  priority:'medium', updated: Date.now()-1000*60*120 },
    { id:'cs-004', user:'usr_00008', subject:'수수료 문의',           status:'resolved', priority:'low',    updated: Date.now()-1000*60*260 },
  ];

  // ============================================================
  // FEES / REBATES
  // ============================================================
  const FEE_TIERS = [
    { tier:'Beginner', maker:0.0200, taker:0.0500, vol30Req:0,          holdReq:0 },
    { tier:'Standard', maker:0.0180, taker:0.0450, vol30Req:1_000_000,  holdReq:0 },
    { tier:'Pro',      maker:0.0150, taker:0.0400, vol30Req:10_000_000, holdReq:1000 },
    { tier:'VIP',      maker:0.0150, taker:0.0350, vol30Req:50_000_000, holdReq:5000 },
  ];

  const PROMOTIONS = [
    { id:'PROMO-AUG26', name:'8월 리베이트 30%', period:'2026-08-01 ~ 2026-08-31', status:'active',   payout: 12_480 },
    { id:'PROMO-KYC',   name:'KYC 완료 $50 웰컴', period:'상시',                     status:'active',   payout:  1_240 },
    { id:'PROMO-INV',   name:'친구 초대 페이백',    period:'상시',                     status:'active',   payout:  8_620 },
  ];

  // ============================================================
  // DESIGN OPS — 대표님이 UI 토큰/컴포넌트 관리
  // ============================================================
  const DESIGN_OPS = {
    tokens: {
      brands: ['institutional-cool','quantum-violet','onyx-emerald','graphite-amber'],
      longshortPairs: ['teal-magenta','green-red','cyan-orange'],
      themes: ['dark','light'],
      densities: ['comfortable','compact','dense'],
    },
    componentCount: 27,
    pageCount: 24,
    lastPublished: '2026-08-01T11:20:00Z',
    unpublishedChanges: 3,
    changes: [
      { time: Date.now()-1000*60*20,  author:'권누리', kind:'token', title:'Focus ring stroke 1→2px' },
      { time: Date.now()-1000*60*90,  author:'권누리', kind:'component', title:'RiskChecklist icon size 14→16' },
      { time: Date.now()-1000*60*180, author:'권누리', kind:'token', title:'brand-subtle alpha 0.12→0.14' },
    ],
  };

  // ============================================================
  // Export
  // ============================================================
  window.QTApp = {
    EXCHANGES,
    USER,
    NOTIFICATIONS,
    STRATEGIES,
    TRADE_JOURNAL,
    ALLOCATION,
    EQUITY_CURVE,
    ADMIN_USERS,
    ADMIN_LIVE_TRADES,
    ADMIN_RISK_QUEUE,
    ADMIN_AI_METRICS,
    ADMIN_SYSTEM,
    ADMIN_AUDIT,
    NOTICES,
    CS_TICKETS,
    FEE_TIERS,
    PROMOTIONS,
    DESIGN_OPS,
  };
})();
