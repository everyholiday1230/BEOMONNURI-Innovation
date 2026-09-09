/* ============================================================
   Mock Data — Market snapshot, order book, trades, positions, AI
   ------------------------------------------------------------
   Domain models are designed to be compatible with a future
   KLineChart 10.x adapter and a real order/position service.
   ============================================================ */

(function () {
  'use strict';

  // -------- Symbols / Markets --------
  const MARKETS = [
    { base: 'BTC', quote: 'USDT', type: 'PERP', price: 68432.5, chg24h: 2.34, vol24h: 18_240_000_000, hi: 69120.0, lo: 66890.4, fav: true },
    { base: 'ETH', quote: 'USDT', type: 'PERP', price: 3512.82, chg24h: 1.12, vol24h: 8_120_000_000, hi: 3568.4, lo: 3462.1, fav: true },
    { base: 'SOL', quote: 'USDT', type: 'PERP', price: 178.42, chg24h: 4.56, vol24h: 2_240_000_000, hi: 181.2, lo: 168.9, fav: true },
    { base: 'BNB', quote: 'USDT', type: 'PERP', price: 612.18, chg24h: 0.86, vol24h: 1_140_000_000, hi: 618.0, lo: 604.2 },
    { base: 'XRP', quote: 'USDT', type: 'PERP', price: 0.5842, chg24h: -1.24, vol24h: 940_000_000, hi: 0.596, lo: 0.578 },
    { base: 'DOGE', quote: 'USDT', type: 'PERP', price: 0.13842, chg24h: 3.12, vol24h: 620_000_000, hi: 0.142, lo: 0.132 },
    { base: 'AVAX', quote: 'USDT', type: 'PERP', price: 34.56, chg24h: -0.42, vol24h: 340_000_000, hi: 35.8, lo: 34.1 },
    { base: 'LINK', quote: 'USDT', type: 'PERP', price: 15.28, chg24h: 2.14, vol24h: 280_000_000, hi: 15.6, lo: 14.9 },
    { base: 'MATIC', quote: 'USDT', type: 'PERP', price: 0.5124, chg24h: -2.08, vol24h: 240_000_000, hi: 0.528, lo: 0.508 },
    { base: 'ARB', quote: 'USDT', type: 'PERP', price: 0.842, chg24h: 1.86, vol24h: 180_000_000, hi: 0.854, lo: 0.821 },
    { base: 'OP', quote: 'USDT', type: 'PERP', price: 1.842, chg24h: 5.24, vol24h: 160_000_000, hi: 1.88, lo: 1.74 },
    { base: 'ATOM', quote: 'USDT', type: 'PERP', price: 6.42, chg24h: -0.68, vol24h: 120_000_000, hi: 6.58, lo: 6.34 },
    { base: 'DOT', quote: 'USDT', type: 'PERP', price: 6.82, chg24h: 0.42, vol24h: 110_000_000, hi: 6.94, lo: 6.72 },
    { base: 'ADA', quote: 'USDT', type: 'PERP', price: 0.4212, chg24h: -1.56, vol24h: 320_000_000, hi: 0.432, lo: 0.418 },
    { base: 'NEAR', quote: 'USDT', type: 'PERP', price: 4.82, chg24h: 6.32, vol24h: 210_000_000, hi: 4.94, lo: 4.51 },
    { base: 'INJ', quote: 'USDT', type: 'PERP', price: 22.14, chg24h: 3.42, vol24h: 180_000_000, hi: 22.8, lo: 21.4 },
    { base: 'APT', quote: 'USDT', type: 'PERP', price: 8.94, chg24h: -0.24, vol24h: 96_000_000, hi: 9.12, lo: 8.82 },
    { base: 'SUI', quote: 'USDT', type: 'PERP', price: 1.184, chg24h: 4.12, vol24h: 140_000_000, hi: 1.21, lo: 1.12 },
    { base: 'TON', quote: 'USDT', type: 'PERP', price: 6.42, chg24h: 1.24, vol24h: 88_000_000, hi: 6.52, lo: 6.34 },
    { base: 'FIL', quote: 'USDT', type: 'PERP', price: 4.84, chg24h: -0.86, vol24h: 62_000_000, hi: 4.94, lo: 4.78 },
    { base: 'LTC', quote: 'USDT', type: 'PERP', price: 84.2, chg24h: 0.14, vol24h: 180_000_000, hi: 85.4, lo: 83.6 },
  ];

  // -------- Candles — deterministic sinusoidal + noise so it looks realistic --------
  function seededRand(seed) {
    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function generateCandles({ symbol = 'BTCUSDT', tf = '15m', count = 220, endPrice = 68432.5 } = {}) {
    const tfMinutes = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1H': 60, '4H': 240, '1D': 1440 }[tf] || 15;
    const rand = seededRand(symbol.charCodeAt(0) * 3 + tfMinutes * 17 + 91);
    const now = Date.now();
    const alignedNow = now - (now % (tfMinutes * 60 * 1000));
    const candles = [];
    let price = endPrice * 0.945;
    for (let i = 0; i < count; i++) {
      const t = alignedNow - (count - 1 - i) * tfMinutes * 60 * 1000;
      // slow drift + micro cycle
      const macro = Math.sin(i / 28) * (endPrice * 0.012);
      const meso = Math.sin(i / 9 + 1.3) * (endPrice * 0.006);
      const noise = (rand() - 0.5) * endPrice * 0.0045;
      const target = endPrice * 0.945 + (endPrice * 0.055 * (i / count)) + macro + meso + noise;
      const open = price;
      const close = target;
      const wickTop = (rand() * endPrice * 0.004);
      const wickBot = (rand() * endPrice * 0.004);
      const high = Math.max(open, close) + wickTop;
      const low = Math.min(open, close) - wickBot;
      const volBase = 200 + rand() * 800;
      const isUp = close >= open;
      const volume = volBase * (isUp ? 1 : 0.85) * (0.6 + Math.abs(close - open) / endPrice * 80);
      candles.push({ time: t, open, high, low, close, volume });
      price = close;
    }
    // ensure last close matches endPrice
    const last = candles[candles.length - 1];
    last.close = endPrice;
    last.high = Math.max(last.high, endPrice);
    last.low = Math.min(last.low, endPrice);
    return candles;
  }

  // -------- Order book --------
  function generateOrderBook(mid, spreadBps = 4, rows = 18) {
    const asks = [];
    const bids = [];
    // Tick size proportional to price so BTC uses 1.0 not 0.1
    const tick = mid > 10000 ? 1.0 : mid > 100 ? 0.1 : mid > 1 ? 0.01 : mid > 0.1 ? 0.0001 : 0.00001;
    // 가격을 tick 자리수에 맞춰 반올림한다. 예전에는 toFixed(2) 로 고정되어
    // DOGE(0.07) 같은 저가 심볼에서 모든 호가가 0.07 로 붕괴했고,
    // 그 결과 React 가 중복 key 경고를 냈다.
    const priceDecimals = Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));
    const roundPx = (v) => +v.toFixed(priceDecimals);
    const half = mid * (spreadBps / 2 / 10000);
    let askPx = Math.ceil((mid + half) / tick) * tick;
    let bidPx = Math.floor((mid - half) / tick) * tick;
    let askCum = 0, bidCum = 0;
    for (let i = 0; i < rows; i++) {
      const askSize = +(0.15 + Math.random() * 4.5).toFixed(3);
      askCum += askSize;
      asks.push({ price: roundPx(askPx + i * tick), amount: askSize, cumulative: +askCum.toFixed(3) });
      const bidSize = +(0.15 + Math.random() * 4.5).toFixed(3);
      bidCum += bidSize;
      bids.push({ price: roundPx(bidPx - i * tick), amount: bidSize, cumulative: +bidCum.toFixed(3) });
    }
    return { asks, bids, mid, spread: asks[0].price - bids[0].price };
  }

  // -------- Recent trades --------
  function generateTrades(mid, count = 40) {
    const trades = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const side = Math.random() > 0.48 ? 'buy' : 'sell';
      const px = mid + (Math.random() - 0.5) * mid * 0.0004;
      const amt = +(0.005 + Math.random() * 2.5).toFixed(4);
      trades.push({
        time: now - i * 1200 - Math.random() * 800,
        price: px,
        amount: amt,
        side,
      });
    }
    return trades;
  }

  // -------- Positions --------
  const POSITIONS = [
    {
      id: 'p1', symbol: 'BTCUSDT', type: 'PERP',
      side: 'long', size: 0.185, entry: 67285.4, mark: 68432.5,
      liq: 62140.2, margin: 622.36, marginRatio: 0.234, leverage: 20,
      unPnl: 212.42, unPnlPct: 34.14, rlzPnl: 0,
      tp: 71200, sl: 65800, adl: 2, mode: 'CROSS'
    },
    {
      id: 'p2', symbol: 'ETHUSDT', type: 'PERP',
      side: 'short', size: 1.5, entry: 3568.2, mark: 3512.82,
      liq: 3894.6, margin: 267.15, marginRatio: 0.184, leverage: 20,
      unPnl: 83.07, unPnlPct: 31.10, rlzPnl: 0,
      tp: 3420, sl: 3620, adl: 3, mode: 'ISOLATED'
    },
    {
      id: 'p3', symbol: 'SOLUSDT', type: 'PERP',
      side: 'long', size: 24, entry: 174.20, mark: 178.42,
      liq: 148.4, margin: 209.04, marginRatio: 0.128, leverage: 20,
      unPnl: 101.28, unPnlPct: 48.45, rlzPnl: 0,
      tp: 190, sl: 168, adl: 1, mode: 'CROSS'
    },
  ];

  // -------- Open orders --------
  const OPEN_ORDERS = [
    { id: 'o1', symbol: 'BTCUSDT', side: 'long', type: 'LIMIT', price: 67800, avgPrice: null, amount: 0.05, filled: 0, remaining: 0.05, trigger: null, time: Date.now() - 620000, status: 'pending' },
    { id: 'o2', symbol: 'BTCUSDT', side: 'short', type: 'STOP-LIMIT', price: 66500, avgPrice: null, amount: 0.10, filled: 0, remaining: 0.10, trigger: '≤ 66,800', time: Date.now() - 1400000, status: 'pending' },
    { id: 'o3', symbol: 'ETHUSDT', side: 'long', type: 'LIMIT', price: 3480, avgPrice: null, amount: 0.5, filled: 0.1, remaining: 0.4, trigger: null, time: Date.now() - 2600000, status: 'partial' },
  ];

  // -------- Assets --------
  const ASSETS = {
    walletBalance: 12420.85,
    availableBalance: 9840.22,
    marginBalance: 11836.14,
    usedMargin: 1098.55,
    maintenanceMargin: 218.42,
    unrealizedPnl: 396.77,
    marginRatio: 0.184,
    riskLevel: 'safe',      // safe | warning | danger
    equity: 12820.14
  };

  // -------- AI Signal (Flow 5 primary target) --------
  const AI_SIGNAL = {
    id: 'sig-btc-01',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    direction: 'long',
    entryZone: [68120, 68360],
    stopLoss: 67480,
    takeProfits: [68980, 69640, 70420],
    riskReward: 2.8,
    confidence: 74,
    timeHorizon: '4~12h',
    invalidationKey: 'signal_invalidation_sample',
    reasonKey: 'signal_reason_sample',
    status: 'draft',   // draft | approved | expired
    createdAt: Date.now() - 90_000
  };

  // -------- Layout presets (24-col grid, GridStack-compatible) --------
  /*
     ─────────────────────────── 레이아웃 프리셋 ───────────────────────────

     ★★ 설계 규칙 — 이 넷을 지키지 않으면 화면이 깨진다

       1) **24열 × 16행을 빈칸·겹침 0 으로 완전히 덮는다.**
          빈칸이 있으면 화면에 빈 공간으로 보이고, 겹치면 패널이 서로를 가린다.

       2) **코파일럿을 접었을 때도 빈칸이 없어야 한다.**
          접히면 폭이 1칸으로 줄고, 남은 폭은 `panel-state.applyTo` 가 **왼쪽
          이웃 하나**에게 넘긴다. 그래서 코파일럿의 왼쪽에 **같은 행 범위를
          정확히 덮는** 패널이 있어야 한다.

          예전 ai-workspace 가 이 규칙을 어겼다 — 코파일럿은 y0-16 인데 왼쪽
          차트는 y0-11 뿐이어서, 접으면 y11-16 구간에 **빈칸 25칸**이 생겼다
          (실측: 채움 87%, 다른 프리셋은 93~94%).

       3) 모든 패널이 `layout-engine.jsx` 의 minW/minH 보다 **여유 있게** 크다.
          딱 최소값이면 줄일 수 없고, 최소값보다 작으면 크기 조절 계산이 음수가
          되어 옆 창을 넓히려 할 때 오히려 줄어든다.

       4) **4개만 둔다.** 예전에는 8개였는데 dual-chart·multi-chart 는 miniChart
          로 같은 심볼을 여러 번 그려 쓸모가 적었고, beginner·risk 는 다른
          프리셋의 부분집합이었다. 선택지가 많은 것보다 각각이 분명한 것이 낫다.

     ★ 좌표를 고칠 때는 반드시 빈칸·겹침을 다시 계산할 것. 눈으로는 못 잡는다.
       회귀 테스트가 이 넷을 검사한다(apps/api/src/__tests__/layout-presets.test.ts).
  */
  const LAYOUT_PRESETS = {
    /*
       1. Standard Trader — 기본. 운영 지시로 **배치를 바꾸지 않는다.**
          고객이 보던 화면이 달라지면 그것 자체가 사고다.
    */
    'standard-trader': {
      id: 'standard-trader',
      name: 'Standard Trader',
      descKey: 'preset_desc_standard',
      cols: 96,
      widgets: [
        { id: 'market',     type: 'marketWatch',  x: 0,  y: 0, w: 16, h: 16, minW: 12, minH: 6 },
        { id: 'chart',      type: 'chart',        x: 16,  y: 0, w: 28, h: 11, minW: 24, minH: 6 },
        { id: 'positions',  type: 'positions',    x: 16,  y: 11, w: 52, h: 5, minW: 32, minH: 3 },
        { id: 'ai',         type: 'aiCopilot',    x: 44,  y: 0, w: 24, h: 11, minW: 20, minH: 10 },
        { id: 'orderbook',  type: 'orderBook',    x: 68,  y: 0, w: 12, h: 11, minW: 12, minH: 6 },
        { id: 'trades',     type: 'recentTrades', x: 68,  y: 11, w: 12, h: 5, minW: 12, minH: 3 },
        { id: 'orderEntry', type: 'orderEntry',   x: 80,  y: 0, w: 16, h: 11, minW: 12, minH: 8 },
        { id: 'assets',     type: 'assetsRisk',   x: 80,  y: 11, w: 16, h: 5, minW: 12, minH: 3 },
      ],
    },

    /*
       2. AI Workspace — 코파일럿 중심.

       ★★ 예전 배치는 코파일럿이 y0-16 이고 왼쪽 차트가 y0-11 이어서, 접으면
         y11-16 에 빈칸이 생겼다. 이제 코파일럿을 **차트와 같은 y0-11** 로 맞추고
         그 아래(y11-16)는 assetsRisk 가 채운다. 접으면 차트가 그 폭을 받고,
         아래는 assetsRisk 가 받아 **어느 상태에서도 빈칸이 없다.**
    */
    'ai-workspace': {
      id: 'ai-workspace',
      name: 'AI Workspace',
      descKey: 'preset_desc_ai',
      cols: 96,
      widgets: [
        { id: 'market',     type: 'marketWatch', x: 0,  y: 0, w: 12, h: 16, minW: 12, minH: 6 },
        { id: 'chart',      type: 'chart',       x: 12,  y: 0, w: 40, h: 11, minW: 24, minH: 6 },
        { id: 'positions',  type: 'positions',   x: 12,  y: 11, w: 40, h: 5, minW: 32, minH: 3 },
        { id: 'ai',         type: 'aiCopilot',   x: 52,  y: 0, w: 28, h: 11, minW: 20, minH: 10 },
        { id: 'assets',     type: 'assetsRisk',  x: 52,  y: 11, w: 28, h: 5, minW: 12, minH: 3 },
        { id: 'orderEntry', type: 'orderEntry',  x: 80,  y: 0, w: 16, h: 16, minW: 12, minH: 8 },
      ],
    },

    /*
       3. Chart Focus — 차트를 가장 크게. 코파일럿이 없어 접힘 문제 자체가 없다.
          오른쪽 열을 주문(위)·자산(아래)으로 나눠 아래 빈칸을 없앤다.
    */
    'chart-focus': {
      id: 'chart-focus',
      name: 'Chart Focus',
      descKey: 'preset_desc_chart',
      cols: 96,
      widgets: [
        { id: 'market',     type: 'marketWatch', x: 0,  y: 0, w: 12, h: 16, minW: 12, minH: 6 },
        { id: 'chart',      type: 'chart',       x: 12,  y: 0, w: 68, h: 12, minW: 24, minH: 6 },
        { id: 'positions',  type: 'positions',   x: 12,  y: 12, w: 68, h: 4, minW: 32, minH: 3 },
        { id: 'orderEntry', type: 'orderEntry',  x: 80,  y: 0, w: 16, h: 10, minW: 12, minH: 8 },
        { id: 'assets',     type: 'assetsRisk',  x: 80,  y: 10, w: 16, h: 6, minW: 12, minH: 3 },
      ],
    },

    /*
       4. Scalper — 오더북·체결·주문 중심. 빠른 진입에 필요한 것만 크게 둔다.
          차트는 작게(11열), 대신 오더북과 주문 패널을 넓힌다.
    */
    'scalper': {
      id: 'scalper',
      name: 'Scalper',
      descKey: 'preset_desc_scalper',
      cols: 96,
      widgets: [
        { id: 'market',     type: 'marketWatch',  x: 0,  y: 0, w: 12, h: 16, minW: 12, minH: 6 },
        { id: 'chart',      type: 'chart',        x: 12,  y: 0, w: 44, h: 10, minW: 24, minH: 6 },
        { id: 'positions',  type: 'positions',    x: 12,  y: 10, w: 44, h: 6, minW: 32, minH: 3 },
        { id: 'orderbook',  type: 'orderBook',    x: 56,  y: 0, w: 20, h: 10, minW: 12, minH: 6 },
        { id: 'trades',     type: 'recentTrades', x: 56,  y: 10, w: 20, h: 6, minW: 12, minH: 3 },
        { id: 'orderEntry', type: 'orderEntry',   x: 76,  y: 0, w: 20, h: 11, minW: 12, minH: 8 },
        { id: 'assets',     type: 'assetsRisk',   x: 76,  y: 11, w: 20, h: 5, minW: 12, minH: 3 },
      ],
    },
  };

  // -------- i18n --------
  /*
     ★ 이 상수는 **사용되지 않는다**.

     QTI18n.register() 로 등록되지 않아 t() 가 여기서 값을 찾지 못하고,
     화면에 키 문자열이 그대로 나왔다(실측: 헤더의 mode_spot / mode_futures /
     mode_paper, 그리고 layout_manager · deposit).

     실제 사전은 src/locales/*.js 다. 여기 있던 항목은 그쪽으로 옮겼다.
     이 상수는 QT.I18N 으로 노출돼 있어 참조하는 코드가 있을 수 있으므로
     지우지 않고 남긴다 — 다만 **여기에 문구를 추가해도 화면에 반영되지 않는다.**
  */
  const I18N = {
    ko: {
      nav_markets: '시장', nav_trade: '트레이드', nav_ai: 'AI 전략', nav_portfolio: '포트폴리오', nav_analytics: '분석',
      mode_spot: '현물', mode_futures: '선물', mode_paper: '모의',
      layout_manager: '레이아웃', deposit: '입금',
      mark_price: 'Mark Price', index_price: 'Index Price', funding: 'Funding',
      hi_24: '24H 고가', lo_24: '24H 저가', vol_24: '24H 거래량', change_24: '24H 변동',
      leverage: '레버리지', cross: '크로스', isolated: '격리',
      available: '가용 자산', total: 'Total', size: '수량', price: '가격',
      limit: '지정가', market: '시장가', trigger: '트리거', advanced: '고급',
      long: '롱', short: '숏', buy_long: '매수 · Long', sell_short: '매도 · Short',
      order_book: '오더북', recent_trades: '최근 체결', order_entry: '주문 입력',
      market_watch: '시장', ai_copilot: 'AI Copilot', positions: '포지션',
      assets_risk: '자산 · 리스크',
      open_orders: '미체결', order_history: '주문 내역', trade_history: '체결 내역',
      transaction_history: '입출금 내역', assets: '자산', ai_signals: 'AI 신호',
      layout_edit: '레이아웃 편집', save: '저장', save_as: '이름으로 저장', reset: '기본값',
      lock: '잠금', cancel: '취소', undo: '실행 취소', redo: '다시 실행',
      unsaved: '저장되지 않은 변경사항',
      tweaks: 'Tweaks', close: '닫기',
      confirm_order: '주문 확인', place_order: '주문 실행',
      draft: 'Draft', approved: 'Approved',
    },
    en: {
      nav_markets: 'Markets', nav_trade: 'Trade', nav_ai: 'AI Strategies', nav_portfolio: 'Portfolio', nav_analytics: 'Analytics',
      mode_spot: 'Spot', mode_futures: 'Futures', mode_paper: 'Paper',
      layout_manager: 'Layout', deposit: 'Deposit',
      mark_price: 'Mark Price', index_price: 'Index Price', funding: 'Funding',
      hi_24: '24H High', lo_24: '24H Low', vol_24: '24H Vol', change_24: '24H Chg',
      leverage: 'Leverage', cross: 'Cross', isolated: 'Isolated',
      available: 'Available', total: 'Total', size: 'Size', price: 'Price',
      limit: 'Limit', market: 'Market', trigger: 'Trigger', advanced: 'Advanced',
      long: 'Long', short: 'Short', buy_long: 'Buy · Long', sell_short: 'Sell · Short',
      order_book: 'Order Book', recent_trades: 'Recent Trades', order_entry: 'Order Entry',
      market_watch: 'Markets', ai_copilot: 'AI Copilot', positions: 'Positions',
      assets_risk: 'Assets · Risk',
      open_orders: 'Open Orders', order_history: 'Order History', trade_history: 'Trade History',
      transaction_history: 'Transactions', assets: 'Assets', ai_signals: 'AI Signals',
      layout_edit: 'Layout Edit', save: 'Save', save_as: 'Save As', reset: 'Reset',
      lock: 'Lock', cancel: 'Cancel', undo: 'Undo', redo: 'Redo',
      unsaved: 'Unsaved changes',
      tweaks: 'Tweaks', close: 'Close',
      confirm_order: 'Confirm Order', place_order: 'Place Order',
      draft: 'Draft', approved: 'Approved',
    }
  };

  // Export
  window.QT = window.QT || {};
  Object.assign(window.QT, {
    MARKETS,
    POSITIONS,
    OPEN_ORDERS,
    ASSETS,
    AI_SIGNAL,
    LAYOUT_PRESETS,
    I18N,
    generateCandles,
    generateOrderBook,
    generateTrades,
    seededRand,
  });
})();
