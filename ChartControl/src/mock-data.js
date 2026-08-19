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
  const LAYOUT_PRESETS = {
    'standard-trader': {
      id: 'standard-trader',
      name: 'Standard Trader',
      descKey: 'preset_desc_standard',
      cols: 24,
      widgets: [
        { id: 'market',    type: 'marketWatch', x: 0,  y: 0,  w: 4,  h: 16, minW: 3, minH: 8 },
        { id: 'chart',     type: 'chart',       x: 4,  y: 0,  w: 12, h: 11, minW: 8, minH: 6 },
        { id: 'positions', type: 'positions',   x: 4,  y: 11, w: 12, h: 5,  minW: 8, minH: 3 },
        { id: 'orderbook', type: 'orderBook',   x: 16, y: 0,  w: 4,  h: 11, minW: 3, minH: 6 },
        { id: 'trades',    type: 'recentTrades',x: 16, y: 11, w: 4,  h: 5,  minW: 3, minH: 3 },
        { id: 'orderEntry',type: 'orderEntry',  x: 20, y: 0,  w: 4,  h: 11, minW: 3, minH: 8 },
        { id: 'assets',    type: 'assetsRisk',  x: 20, y: 11, w: 4,  h: 5,  minW: 3, minH: 3 },
      ]
    },
    'ai-workspace': {
      id: 'ai-workspace',
      name: 'AI Workspace',
      descKey: 'preset_desc_ai',
      cols: 24,
      /*
         ★★ 원래 위젯이 4개뿐이었고 **주문 패널(orderEntry)이 없었다.**
           코파일럿이 24칸 중 9칸을 차지해서, 이 워크스페이스에서는 분석은
           볼 수 있는데 주문을 넣을 수가 없었다. 분석을 보고 바로 주문하는
           것이 이 화면의 목적이므로, 주문 패널이 없으면 화면을 벗어나야 한다.

         ★ 코파일럿을 9 → 6 칸으로 줄이고 주문 패널 4칸을 넣었다(minW 3).
           합계 3 + 11 + 6 + 4 = 24.
      */
      widgets: [
        { id: 'market',    type: 'marketWatch', x: 0,  y: 0,  w: 3,  h: 16, minW: 3, minH: 8 },
        { id: 'chart',     type: 'chart',       x: 3,  y: 0,  w: 11, h: 11, minW: 8, minH: 6 },
        { id: 'positions', type: 'positions',   x: 3,  y: 11, w: 11, h: 5,  minW: 8, minH: 3 },
        { id: 'ai',        type: 'aiCopilot',   x: 14, y: 0,  w: 6,  h: 16, minW: 5, minH: 10 },
        { id: 'orderEntry',type: 'orderEntry',  x: 20, y: 0,  w: 4,  h: 16, minW: 3, minH: 8 },
      ]
    },
    'chart-focus': {
      id: 'chart-focus',
      name: 'Chart Focus',
      descKey: 'preset_desc_chart',
      cols: 24,
      widgets: [
        { id: 'market',    type: 'marketWatch', x: 0,  y: 0,  w: 3,  h: 16 },
        { id: 'chart',     type: 'chart',       x: 3,  y: 0,  w: 17, h: 12 },
        { id: 'positions', type: 'positions',   x: 3,  y: 12, w: 17, h: 4 },
        { id: 'orderEntry',type: 'orderEntry',  x: 20, y: 0,  w: 4,  h: 16 },
      ]
    },
    'scalper': {
      id: 'scalper',
      name: 'Scalper',
      descKey: 'preset_desc_scalper',
      cols: 24,
      widgets: [
        { id: 'market',    type: 'marketWatch', x: 0,  y: 0,  w: 3,  h: 16 },
        { id: 'chart',     type: 'chart',       x: 3,  y: 0,  w: 12, h: 9 },
        { id: 'positions', type: 'positions',   x: 3,  y: 9,  w: 12, h: 7 },
        { id: 'orderbook', type: 'orderBook',   x: 15, y: 0,  w: 4,  h: 16 },
        { id: 'orderEntry',type: 'orderEntry',  x: 19, y: 0,  w: 5,  h: 12 },
        { id: 'trades',    type: 'recentTrades',x: 19, y: 12, w: 5,  h: 4 },
      ]
    },
    /*
       2분할 차트 — 거래 화면 안에서 두 종목을 나란히 본다.

       왜 별도 페이지(/multi-chart)가 아니라 프리셋인가
         /multi-chart 로 나가면 주문 패널과 포지션이 없다. 두 종목을 비교하는
         이유는 그중 하나를 거래하기 위해서인데, 비교하다가 주문하려면 화면을
         떠나야 했고 그 사이에 가격이 움직인다.

       구성
         위쪽에 차트 둘(왼쪽이 활성 심볼, 오른쪽은 위젯이 따로 기억한다),
         아래에 포지션과 주문 패널. marketWatch 를 빼서 차트 폭을 확보했다 —
         심볼은 각 차트 머리의 버튼으로 바꾼다.
    */
    'dual-chart': {
      id: 'dual-chart',
      name: 'Dual Chart',
      descKey: 'preset_desc_dual',
      cols: 24,
      widgets: [
        { id: 'chart',     type: 'chart',      x: 0,  y: 0,  w: 12, h: 10 },
        { id: 'chart2',    type: 'miniChart',  x: 12, y: 0,  w: 12, h: 10 },
        { id: 'positions', type: 'positions',  x: 0,  y: 10, w: 14, h: 6 },
        { id: 'orderEntry',type: 'orderEntry', x: 14, y: 10, w: 10, h: 6 },
      ]
    },
    'multi-chart': {
      id: 'multi-chart',
      name: 'Multi-Chart',
      descKey: 'preset_desc_multi',
      cols: 24,
      widgets: [
        { id: 'market',    type: 'marketWatch', x: 0,  y: 0,  w: 3,  h: 16 },
        { id: 'chart',     type: 'chart',       x: 3,  y: 0,  w: 11, h: 8 },
        { id: 'chart2',    type: 'miniChart',   x: 14, y: 0,  w: 10, h: 8 },
        { id: 'chart3',    type: 'miniChart',   x: 3,  y: 8,  w: 11, h: 8 },
        { id: 'chart4',    type: 'miniChart',   x: 14, y: 8,  w: 10, h: 8 },
      ]
    },
    'beginner': {
      id: 'beginner',
      name: 'Beginner',
      descKey: 'preset_desc_beginner',
      cols: 24,
      widgets: [
        { id: 'chart',     type: 'chart',       x: 0,  y: 0,  w: 16, h: 12 },
        { id: 'orderEntry',type: 'orderEntry',  x: 16, y: 0,  w: 8,  h: 12 },
        { id: 'positions', type: 'positions',   x: 0,  y: 12, w: 24, h: 4 },
      ]
    },
    'risk': {
      id: 'risk',
      name: 'Risk Monitor',
      descKey: 'preset_desc_risk',
      cols: 24,
      widgets: [
        { id: 'positions', type: 'positions',   x: 0,  y: 0,  w: 14, h: 10 },
        { id: 'assets',    type: 'assetsRisk',  x: 14, y: 0,  w: 10, h: 6 },
        { id: 'chart',     type: 'chart',       x: 14, y: 6,  w: 10, h: 10 },
        { id: 'orderbook', type: 'orderBook',   x: 0,  y: 10, w: 7,  h: 6 },
        { id: 'trades',    type: 'recentTrades',x: 7,  y: 10, w: 7,  h: 6 },
      ]
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
