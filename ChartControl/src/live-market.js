/* ============================================================
   Live Market Bridge — 목업 데이터 계층을 실거래소 데이터로 교체
   ------------------------------------------------------------
   설계 원칙

   1. 디자인/마크업을 바꾸지 않는다.
      기존 목업이 노출한 함수/이벤트 시그니처를 그대로 유지하고 내부만 교체한다.
        QT.MARKETS            — 배열 요소를 제자리(in-place)에서 갱신
        QT.generateCandles    — 동기 함수 유지. 캐시 히트 시 실캔들, 미스 시 목업
        QT.generateOrderBook  — 실오더북 우선, 없으면 목업
        QT.generateTrades     — 실체결 우선, 없으면 목업
        QT.stream             — on/emit/start/stop/getState/setConnectionState 동일

   2. 백엔드가 죽어도 화면이 깨지지 않는다.
      실데이터가 없으면 즉시 목업으로 폴백한다. 사용자에게는 연결 표시등으로만
      알린다. (헤더의 conn 표시는 이미 디자인에 존재한다)

   3. 실데이터인지 목업인지 항상 구분 가능하게 한다.
      QTLive.isLive(symbol) / QTLive.getSource() 로 조회할 수 있다.
      돈이 걸린 화면에서 "지금 보이는 값이 실제인가"를 판별할 수 없으면 안 된다.

   4. 렌더 폭주를 막는다.
      KuCoin depth5 는 초당 20회 넘게 온다. 그대로 React 에 흘리면 CPU 를 태운다.
      틱/오더북은 스로틀하고, 체결은 원본을 유지한다(테이프 누락 방지).
   ============================================================ */

(function () {
  'use strict';

  var QT = window.QT = window.QT || {};
  var Api = window.QTApi;

  // 목업 원본 보관. 폴백 경로에서 계속 쓴다.
  var mock = {
    generateCandles: QT.generateCandles,
    generateOrderBook: QT.generateOrderBook,
    generateTrades: QT.generateTrades,
    stream: QT.stream,
  };

  if (!Api) {
    console.warn('[QTLive] QTApi 미로드 — 목업 데이터를 유지한다');
    return;
  }

  // ---------------------------------------------------------------
  // 상태
  // ---------------------------------------------------------------

  var TICK_THROTTLE_MS = 200;   // 초당 5회. 목업(2회/초)보다 부드럽다.
  var BOOK_THROTTLE_MS = 150;   // 초당 약 6.7회
  var MARKETS_POLL_MS = 5000;   // 마켓 목록 REST 폴링

  var live = {
    /** 실데이터가 확보된 내부심볼 집합 */
    liveSymbols: new Set(),
    /** KuCoin 미상장 등으로 실데이터를 줄 수 없는 심볼 */
    unsupported: new Set(),
    /** 'SYM|tf' -> 캔들 배열 (시간 오름차순) */
    candles: new Map(),
    /** 'SYM|tf' -> 진행 중 요청 Promise */
    candleInflight: new Map(),
    /** 심볼 -> 최신 오더북 */
    books: new Map(),
    /** 심볼 -> 최근 체결 배열 (최신 우선) */
    trades: new Map(),
    /** 심볼 -> 최신 티커 */
    tickers: new Map(),
    /** 현재 활성 심볼 (트레이딩 화면이 보고 있는 것) */
    activeSymbol: null,
    activeTimeframe: '15m',
    /** 브라우저-서버 연결 상태 */
    socketState: 'connecting',
    /** 서버-KuCoin 업스트림 상태 */
    upstreamState: 'connecting',
    /**
     * 백엔드가 함께 서빙되고 있는지. null 이면 아직 판별 전.
     * false 면 네트워크 요청을 일절 하지 않고 목업으로만 동작한다.
     */
    backendPresent: null,
    /** 마지막 시세 프레임 도착 시각 (ms). null = 아직 없음. */
    lastDataAt: null,
    version: 0,
  };

  /** 목업 스트림 중계 해제 함수들 */
  var mockOffHandlers = [];

  /** 백엔드가 없으면 REST 를 부르지 않는다. 404 콘솔 에러를 막기 위함. */
  function canCallApi() {
    return live.backendPresent !== false;
  }

  /** version 이 바뀔 때 알림받는 구독자. React 컴포넌트 재렌더 트리거. */
  var versionListeners = new Set();

  function bumpVersion() {
    live.version += 1;
    versionListeners.forEach(function (cb) {
      try { cb(live.version); } catch (e) { /* 개별 구독자 오류를 전파하지 않는다 */ }
    });
  }

  /** 연속 호출을 묶어 한 프레임에 한 번만 알린다. */
  var bumpScheduled = false;
  function scheduleBump() {
    if (bumpScheduled) return;
    bumpScheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      bumpScheduled = false;
      bumpVersion();
    }, 16);
  }

  // ---------------------------------------------------------------
  // 이벤트 버스 (목업 QT.stream 과 동일 계약)
  // ---------------------------------------------------------------

  var listeners = new Map();

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return function off() {
      var set = listeners.get(event);
      if (set) set.delete(cb);
    };
  }

  function emit(event, data) {
    var set = listeners.get(event);
    if (!set) return;
    set.forEach(function (cb) {
      try { cb(data); } catch (e) { console.error('[QTLive] 리스너 오류', event, e); }
    });
  }

  // ---------------------------------------------------------------
  // 심볼 유틸
  // ---------------------------------------------------------------

  /** 'BTC/USDT', 'BTC-USDT', 'BTCUSDT' 를 모두 'BTCUSDT' 로 정규화한다. */
  function normalizeSymbol(raw) {
    var s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return null;
    return s;
  }

  function isSupported(symbol) {
    var s = normalizeSymbol(symbol);
    return Boolean(s) && !live.unsupported.has(s);
  }

  // ---------------------------------------------------------------
  // QT.MARKETS 제자리 갱신
  // ---------------------------------------------------------------

  /**
   * 배열 자체를 새 배열로 바꾸지 않는다. widgets.jsx / pages-user.jsx 가
   * QT.MARKETS 참조를 캡처해 두었기 때문에, 참조를 유지하고 요소만 갱신해야
   * 기존 코드가 그대로 동작한다.
   */
  function applyMarkets(rows) {
    if (!Array.isArray(QT.MARKETS) || !Array.isArray(rows)) return;

    var bySymbol = new Map();
    rows.forEach(function (r) { bySymbol.set(r.symbol, r); });

    QT.MARKETS.forEach(function (m) {
      var symbol = normalizeSymbol(m.base + m.quote);
      var r = bySymbol.get(symbol);
      if (!r) return;

      if (r.available === false) {
        // 미상장. 행을 지우지 않고 목업 값을 유지한 뒤 플래그만 남긴다.
        // (버튼/행을 삭제하지 않는다는 UI 계약)
        live.unsupported.add(symbol);
        m.dataSource = 'mock';
        // 문구가 아니라 사전 키를 넘긴다. 표시하는 쪽에서 번역한다.
        m.unavailableReasonKey = r.reasonKey || 'market_not_listed';
        return;
      }

      live.liveSymbols.add(symbol);
      m.dataSource = 'live';
      delete m.unavailableReasonKey;

      if (typeof r.price === 'number' && r.price > 0) m.price = r.price;
      if (typeof r.chg24h === 'number') m.chg24h = r.chg24h;
      if (typeof r.vol24h === 'number') m.vol24h = r.vol24h;
      if (typeof r.hi === 'number' && r.hi > 0) m.hi = r.hi;
      if (typeof r.lo === 'number' && r.lo > 0) m.lo = r.lo;

      // 목업에 없던 추가 정보. 기존 UI 는 무시하고, 새 UI 는 쓸 수 있다.
      m.mark = r.mark;
      m.index = r.index;
      m.bid = r.bid;
      m.ask = r.ask;
      m.fundingRate = r.fundingRate;
      m.nextFundingTime = r.nextFundingTime;
      m.openInterest = r.openInterest;
      m.tickSize = r.tickSize;
      m.multiplier = r.multiplier;
      m.maxLeverage = r.maxLeverage;
      m.takerFeeRate = r.takerFeeRate;
      m.makerFeeRate = r.makerFeeRate;

      // 활성 심볼이면 스트림 상태도 함께 채운다. WS ticker 가 도착하기 전에도
      // 헤더/주문창의 가격이 0 으로 보이지 않게 하기 위함.
      if (symbol === live.activeSymbol) {
        applyTicker({
          symbol: symbol,
          last: r.price,
          bid: r.bid,
          ask: r.ask,
          mark: r.mark,
          index: r.index,
          high24h: r.hi,
          low24h: r.lo,
          chg24hPct: r.chg24h,
          vol24hQuote: r.vol24h,
          fundingRate: r.fundingRate,
          nextFundingTime: r.nextFundingTime,
          ts: r.ts,
        });
      }
    });

    scheduleBump();
  }

  function pollMarkets() {
    if (!canCallApi()) return Promise.resolve();
    return Api.rest
      .markets()
      .then(function (res) {
        if (res && res.ok) applyMarkets(res.data);
      })
      .catch(function (err) {
        // 백엔드 미가동. 목업 유지. 콘솔을 어지럽히지 않기 위해 debug 수준으로만.
        if (live.version === 0) {
          console.info('[QTLive] 마켓 데이터 미수신 — 목업 유지:', err.message);
        }
      });
  }

  // ---------------------------------------------------------------
  // 캔들
  // ---------------------------------------------------------------

  function candleKey(symbol, tf) { return symbol + '|' + tf; }

  /**
   * 캔들 값을 숫자로 맞춘다.
   *
   * ★★ 서버는 가격을 **문자열**로 준다 ("65048.5").
   *
   *   거래소가 문자열로 주고 서버가 정밀도를 보존하려고 그대로 전달한다.
   *   그 자체는 합리적인 선택이지만, 화면이 문자열로 산술을 하면 조용히 깨진다:
   *
   *     hi = "65048.5";  hi += 6.4        →  "65048.56.4"   (연결!)
   *     그 다음 계산이 모두 NaN 이 된다.
   *
   *   실제로 겪었다: /multi-chart 의 MiniChart 가 SVG 좌표에 NaN 을 넣어
   *   콘솔 오류 5,284건을 냈다. 차트는 KLineChart 가 내부에서 Number 로
   *   바꿔주기 때문에 살아 있었고, 그래서 눈에 띄지 않았다.
   *
   * ★ 그래서 **경계에서 한 번만** 바꾼다. 소비하는 쪽마다 Number() 를 부르게
   *   하면 언젠가 한 곳을 빠뜨린다 — 그 한 곳이 조용히 NaN 을 만든다.
   *
   * ★ 숫자로 바꿀 수 없는 값은 그 캔들을 버린다. 0 으로 채우면 차트에
   *   존재하지 않는 급락이 그려진다.
   */
  function toNumericCandles(rows) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      var c = rows[i];
      if (!c) continue;
      var o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
      var t = Number(c.time);
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(cl) || !isFinite(t)) continue;
      var v = Number(c.volume);
      out.push({
        time: t, open: o, high: h, low: l, close: cl,
        // 거래량은 없을 수 있다. 없으면 0 이 아니라 그대로 둔다 — 0 은 "거래가
        // 없었다" 는 뜻이고, 모르는 것과 다르다.
        volume: isFinite(v) ? v : null,
        closed: c.closed !== false,
      });
    }
    return out;
  }

  /** 실캔들을 확보한다. 이미 있거나 요청 중이면 아무 것도 하지 않는다. */
  function ensureCandles(symbol, tf) {
    if (!canCallApi() || !isSupported(symbol)) return;
    var key = candleKey(symbol, tf);
    if (live.candles.has(key) || live.candleInflight.has(key)) return;

    var p = Api.rest
      .candles(symbol, tf, 300)
      .then(function (res) {
        if (res && res.ok && Array.isArray(res.data) && res.data.length) {
          // 문자열 가격을 여기서 숫자로 바꾼다 (경계에서 한 번만).
          live.candles.set(key, toNumericCandles(res.data));
          scheduleBump();
        }
      })
      .catch(function () { /* 목업 폴백 유지 */ })
      .finally(function () { live.candleInflight.delete(key); });

    live.candleInflight.set(key, p);
  }

  /** WS 로 들어온 진행 중 캔들을 병합한다. */
  function mergeCandle(symbol, tf, candle) {
    var key = candleKey(symbol, tf);
    var list = live.candles.get(key);
    if (!list || !list.length) return;

    /*
       WS 캔들도 같은 경계를 지난다.

       ★ 여기를 빠뜨리면 REST 로 받은 캔들은 숫자인데 WS 로 갱신된 마지막
         캔들만 문자열이 된다 — 가장 찾기 어려운 형태의 결함이다.
    */
    var fixed = toNumericCandles([candle]);
    if (!fixed.length) return;
    candle = fixed[0];

    var last = list[list.length - 1];
    if (last.time === candle.time) {
      list[list.length - 1] = candle;
    } else if (candle.time > last.time) {
      list.push(candle);
      if (list.length > 600) list.shift();
    } else {
      return; // 과거 캔들 정정은 다음 REST 갱신에서 반영한다
    }
    scheduleBump();
  }

  /**
   * QT.generateCandles 대체.
   * 동기 계약을 유지해야 한다 (app.jsx 가 useMemo 안에서 직접 호출).
   */
  function generateCandles(opts) {
    opts = opts || {};
    var symbol = normalizeSymbol(opts.symbol) || 'BTCUSDT';
    var tf = opts.tf || '15m';
    var count = opts.count || 220;

    ensureCandles(symbol, tf);

    var list = live.candles.get(candleKey(symbol, tf));
    if (list && list.length) {
      return list.slice(-count).map(function (c) {
        return {
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
      });
    }

    return mock.generateCandles ? mock.generateCandles(opts) : [];
  }

  // ---------------------------------------------------------------
  // 오더북 / 체결
  // ---------------------------------------------------------------

  /**
   * QT.generateOrderBook 대체.
   * 목업 시그니처는 (mid, spreadBps, rows) 이며 mid 로만 심볼을 알 수 없다.
   * 그래서 활성 심볼의 실오더북을 우선 반환하고, 없으면 목업으로 만든다.
   */
  function generateOrderBook(mid, spreadBps, rows) {
    var symbol = live.activeSymbol;
    var book = symbol ? live.books.get(symbol) : null;
    if (book && book.asks.length && book.bids.length) {
      return sliceBook(book, rows || 18);
    }
    return mock.generateOrderBook ? mock.generateOrderBook(mid, spreadBps, rows) : { asks: [], bids: [], mid: mid, spread: 0 };
  }

  function sliceBook(book, rows) {
    return {
      asks: book.asks.slice(0, rows),
      bids: book.bids.slice(0, rows),
      mid: book.mid,
      spread: book.spread,
      symbol: book.symbol,
      ts: book.ts,
    };
  }

  /** QT.generateTrades 대체. */
  function generateTrades(mid, count) {
    var symbol = live.activeSymbol;
    var list = symbol ? live.trades.get(symbol) : null;
    if (list && list.length) return list.slice(0, count || 40);
    return mock.generateTrades ? mock.generateTrades(mid, count) : [];
  }

  // ---------------------------------------------------------------
  // 스트림 (QT.stream 대체)
  // ---------------------------------------------------------------

  var tickState = {
    symbol: 'BTCUSDT',
    price: 0,
    prev: 0,
    change24: 0,
    hi24: 0,
    lo24: 0,
    vol24: 0,
    mark: 0,
    index: 0,
    funding: 0,
    nextFunding: Date.now() + 3600000,
    latencyMs: 0,
    connected: false,
    connectionState: 'connecting',
  };

  var lastTickEmit = 0;
  var lastBookEmit = 0;
  var pendingBook = null;
  var bookTimer = null;

  /**
   * 지정한 키들을 숫자로 맞춘다.
   *
   * ★ 캔들과 같은 이유다 — 서버가 가격을 문자열로 준다. 티커·호가·체결도
   *   마찬가지이고, 화면이 그것으로 산술을 하면 조용히 NaN 이 된다.
   *
   * ★ 값이 없는 키는 건드리지 않는다. undefined 를 0 으로 만들면 "모른다" 가
   *   "0 이다" 로 바뀐다 — 가격이 0 이면 청산 계산이 엉뚱해진다.
   */
  function numify(obj, keys) {
    if (!obj || typeof obj !== 'object') return obj;
    var out = Object.assign({}, obj);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      if (out[k] === undefined || out[k] === null) continue;
      var n = Number(out[k]);
      // 숫자로 못 바꾸면 원래 값을 남긴다. 0 으로 덮으면 없는 값이 실제 값처럼 보인다.
      if (isFinite(n)) out[k] = n;
    }
    return out;
  }

  /** 티커에서 숫자로 다뤄야 하는 필드. */
  var TICKER_NUM = [
    'last', 'markPrice', 'indexPrice', 'high24h', 'low24h', 'vol24h',
    'turnover24h', 'change24h', 'changePct24h', 'fundingRate', 'openInterest',
    'bestBid', 'bestAsk', 'bestBidSize', 'bestAskSize', 'nextFundingTime',
  ];

  /** 체결에서 숫자로 다뤄야 하는 필드. id 는 문자열로 둔다 — 식별자다. */
  var TRADE_NUM = ['price', 'size', 'time', 'ts'];

  /**
   * 호가 정규화.
   *
   * bids/asks 는 [가격, 수량] 배열의 배열이다. 문자열이면 가격 비교가
   * 사전순이 되어 호가창 정렬이 뒤집힌다 — "9" 가 "10" 보다 크게 나온다.
   */
  function numifyBook(book) {
    if (!book) return book;
    var side = function (rows) {
      if (!Array.isArray(rows)) return rows;
      var out = [];
      for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!Array.isArray(r)) { out.push(r); continue; }
        var px = Number(r[0]), sz = Number(r[1]);
        if (!isFinite(px) || !isFinite(sz)) continue;
        out.push([px, sz]);
      }
      return out;
    };
    return Object.assign({}, book, { bids: side(book.bids), asks: side(book.asks) });
  }

  function applyTicker(t) {
    var symbol = normalizeSymbol(t.symbol);
    if (!symbol) return;
    // 문자열 가격을 여기서 숫자로 바꾼다 (경계에서 한 번만).
    t = numify(t, TICKER_NUM);
    live.tickers.set(symbol, t);
    live.liveSymbols.add(symbol);

    /*
       마지막으로 **데이터**를 받은 시각.

       ping/pong 이 아니라 시세 프레임만 기록한다. 연결은 살아 있는데 구독이
       조용히 죽는 경우가 있고(백엔드에서 실제로 겪었다), pong 으로 갱신하면
       그 상태를 "신선함" 으로 오인한다.
    */
    live.lastDataAt = Date.now();

    // MARKETS 행도 함께 갱신해 마켓 목록이 실시간으로 움직이게 한다.
    if (Array.isArray(QT.MARKETS)) {
      for (var i = 0; i < QT.MARKETS.length; i += 1) {
        var m = QT.MARKETS[i];
        if (normalizeSymbol(m.base + m.quote) !== symbol) continue;
        if (typeof t.last === 'number' && t.last > 0) m.price = t.last;
        if (typeof t.chg24hPct === 'number') m.chg24h = t.chg24hPct;
        m.dataSource = 'live';
        break;
      }
    }

    if (symbol !== live.activeSymbol) return;

    tickState.symbol = symbol;
    tickState.prev = tickState.price || t.last;
    tickState.price = t.last;
    tickState.change24 = typeof t.chg24hPct === 'number' ? t.chg24hPct : tickState.change24;
    tickState.hi24 = t.high24h || tickState.hi24;
    tickState.lo24 = t.low24h || tickState.lo24;
    tickState.vol24 = t.vol24hQuote || tickState.vol24;
    tickState.mark = t.mark || t.last;
    tickState.index = t.index || t.last;
    tickState.funding = typeof t.fundingRate === 'number' ? t.fundingRate : tickState.funding;
    if (t.nextFundingTime) tickState.nextFunding = t.nextFundingTime;
    tickState.latencyMs = socket ? socket.getLatency() : 0;

    var now = Date.now();
    if (now - lastTickEmit >= TICK_THROTTLE_MS) {
      lastTickEmit = now;
      emit('tick', Object.assign({}, tickState));
    }
  }

  function applyBook(book) {
    var symbol = normalizeSymbol(book.symbol);
    if (!symbol) return;
    book = numifyBook(book);
    live.books.set(symbol, book);
    if (symbol !== live.activeSymbol) return;

    // 스로틀: 마지막 값만 남기고 주기적으로 한 번 보낸다.
    pendingBook = book;
    if (bookTimer) return;

    var wait = Math.max(0, BOOK_THROTTLE_MS - (Date.now() - lastBookEmit));
    bookTimer = setTimeout(function () {
      bookTimer = null;
      lastBookEmit = Date.now();
      if (pendingBook) {
        emit('orderbook', sliceBook(pendingBook, 18));
        pendingBook = null;
      }
    }, wait);
  }

  function applyTrade(trade) {
    var symbol = normalizeSymbol(trade.symbol);
    if (!symbol) return;
    trade = numify(trade, TRADE_NUM);

    var list = live.trades.get(symbol);
    if (!list) { list = []; live.trades.set(symbol, list); }
    list.unshift(trade);
    if (list.length > 100) list.length = 100;

    if (symbol !== live.activeSymbol) return;
    // 체결 테이프는 스로틀하지 않는다. 누락되면 거래 판단에 쓰는 정보가 사라진다.
    emit('trade', trade);
  }

  function applyTradesSnapshot(payload) {
    var symbol = normalizeSymbol(payload.symbol);
    if (!symbol || !Array.isArray(payload.trades)) return;
    live.trades.set(symbol, payload.trades.slice(0, 100).map(function (x) {
      return numify(x, TRADE_NUM);
    }));
    scheduleBump();
  }

  /**
   * 연결 상태를 하나로 합친다.
   * 브라우저-서버와 서버-KuCoin 중 하나라도 끊기면 실데이터가 아니므로,
   * 사용자에게는 나쁜 쪽 상태를 보여준다. 낙관적으로 표시하면 안 된다.
   */
  function resolveConnectionState() {
    var a = live.socketState;
    var b = live.upstreamState;
    if (a === 'live' && b === 'live') return 'live';
    if (a === 'lost' || b === 'lost') return 'lost';
    return 'reconnecting';
  }

  function publishConnectionState() {
    var next = resolveConnectionState();
    if (tickState.connectionState === next) return;
    tickState.connectionState = next;
    tickState.connected = next === 'live';
    emit('connection', { state: next });
    scheduleBump();
  }

  // ---------------------------------------------------------------
  // 백엔드 존재 감지 — 요청을 보내지 않고 판별한다
  // ---------------------------------------------------------------

  /**
   * 이 폴더는 백엔드 없이 정적 서버로도 그대로 열려야 한다(디자이너 산출물의 계약).
   * 그때 /api 를 찔러보면 404 가 나고 브라우저 콘솔에 에러가 남는다.
   * "콘솔 에러 0" 을 유지하려면 요청 자체를 하지 않아야 한다.
   *
   * 백엔드는 HTML 응답에 `Server-Timing: qtbackend` 를 붙인다.
   * 그 헤더는 동일 오리진에서 추가 요청 없이 읽을 수 있다.
   *
   * 헤더가 없으면 백엔드가 없는 것으로 보고 목업을 유지한다.
   * (Server-Timing 미지원 브라우저 대비 안전장치는 detectBackend 주석 참조)
   */
  function detectBackend() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
      var entry = nav[0];
      if (!entry) return false;

      // serverTiming 미지원 브라우저에서는 undefined 다. 이 경우 오탐(백엔드
      // 있는데 없다고 판단)이 나므로, 그때만 예외적으로 1회 탐색 요청을 허용한다.
      if (typeof entry.serverTiming === 'undefined') return 'probe';

      for (var i = 0; i < entry.serverTiming.length; i += 1) {
        if (entry.serverTiming[i].name === 'qtbackend') return true;
      }
      return false;
    } catch (e) {
      return 'probe';
    }
  }

  /**
   * 감지는 모듈 로드 시점에 즉시 수행한다.
   *
   * start() 안에서 하면 늦다. app.jsx 의 setActiveSymbol 통지 useEffect 가
   * QT.stream.start() 보다 먼저 실행되므로, 그 사이에 REST 요청이 나가버린다.
   * (실제로 정적 모드에서 404 4건이 콘솔에 찍히는 것을 확인했다)
   * detectBackend 는 performance 항목만 읽고 네트워크를 쓰지 않으므로
   * 여기서 바로 호출해도 안전하다.
   */
  var backendDetection = detectBackend();
  live.backendPresent = backendDetection === 'probe' ? null : backendDetection;

  // ---------------------------------------------------------------
  // 소켓 배선
  // ---------------------------------------------------------------

  var socket = null;
  var marketsTimer = null;
  var started = false;

  /**
   * 현재 원하는 구독 상태를 소켓에 반영한다.
   *
   * setActiveSymbol() 이 소켓 생성보다 먼저 호출될 수 있다.
   * (app.jsx 에서 심볼 통지 useEffect 가 QT.stream.start() 보다 앞서 실행된다)
   * 그때 구독이 유실되지 않도록, 소켓이 준비된 뒤 여기서 다시 밀어넣는다.
   * createSocket 내부에도 재연결 복원 로직이 있어 중복 호출은 무해하다.
   */
  function flushDesiredSubscriptions() {
    if (!socket || !live.activeSymbol) return;
    if (isSupported(live.activeSymbol)) {
      socket.subscribeSymbols([live.activeSymbol]);
      if (live.activeTimeframe) {
        socket.subscribeCandles(live.activeSymbol, live.activeTimeframe);
      }
    }
  }

  function handleMessage(ch, data) {
    if (!data) return;
    switch (ch) {
      case 'hello':
        if (Array.isArray(data.unsupported)) {
          data.unsupported.forEach(function (s) { live.unsupported.add(normalizeSymbol(s)); });
        }
        live.upstreamState = data.connection || 'connecting';
        publishConnectionState();
        break;
      case 'ticker':
        applyTicker(data);
        break;
      case 'orderbook':
        applyBook(data);
        break;
      case 'trade':
        applyTrade(data);
        break;
      case 'trades':
        applyTradesSnapshot(data);
        break;
      case 'candle':
        mergeCandle(normalizeSymbol(data.symbol), data.timeframe, data.candle);
        break;
      case 'error':
        // 미지원 심볼 안내 등. 치명적이지 않으므로 콘솔 에러로 올리지 않는다.
        console.info('[QTLive] 서버 알림:', data.message);
        break;
      default:
        break;
    }
  }

  function start() {
    if (started) return;
    started = true;

    if (backendDetection === false) {
      // 백엔드 없음. 목업 그대로 쓰고 네트워크 요청을 하지 않는다.
      // (요청하면 404 가 콘솔 에러로 남아 "콘솔 에러 0" 계약이 깨진다)
      live.backendPresent = false;
      live.socketState = 'offline';
      live.upstreamState = 'offline';
      tickState.connectionState = 'live'; // 목업 스트림은 정상 동작하므로 UI 는 live 유지
      tickState.connected = true;
      startMockFallback();
      console.info('[QTLive] 백엔드 미탑재 — 목업 데이터로 동작한다 (정적 프리뷰 모드)');
      return;
    }

    live.backendPresent = true;
    connectLive(backendDetection === 'probe');
  }

  /**
   * 백엔드가 없을 때는 원래 목업 스트림을 그대로 돌린다.
   * QT.stream 을 우리가 가로챘으므로, 목업의 tick 을 우리 이벤트 버스로 중계한다.
   * 이렇게 하면 app.jsx 가 우리 stream 을 구독한 상태에서도 화면이 움직인다.
   */
  function startMockFallback() {
    if (!mock.stream) return;

    mockOffHandlers = [
      mock.stream.on('tick', function (s) {
        tickState = Object.assign({}, tickState, s, { connectionState: 'live', connected: true });
        emit('tick', Object.assign({}, tickState));
      }),
      mock.stream.on('orderbook', function (ob) { emit('orderbook', ob); }),
      mock.stream.on('trade', function (tr) { emit('trade', tr); }),
      mock.stream.on('connection', function (c) { emit('connection', c); }),
    ];
    mock.stream.start();
  }

  function stopMockFallback() {
    mockOffHandlers.forEach(function (off) { try { off(); } catch (e) { /* noop */ } });
    mockOffHandlers = [];
    if (mock.stream) mock.stream.stop();
  }

  function connectLive(allowProbe) {
    socket = Api.createSocket({
      onMessage: handleMessage,
      onState: function (s) {
        live.socketState = s;
        publishConnectionState();
      },
      onUpstreamState: function (s) {
        live.upstreamState = s || 'reconnecting';
        publishConnectionState();
      },
    });
    socket.connect();

    // 활성 심볼이 아직 정해지지 않았으면 BTC 로 시작한다 (기존 목업 기본값과 동일).
    if (!live.activeSymbol) {
      setActiveSymbol('BTCUSDT');
    } else {
      // 이미 정해져 있었다면 소켓이 없던 시점의 구독을 여기서 복원한다.
      flushDesiredSubscriptions();
      primeActiveSymbol(live.activeSymbol);
    }

    pollMarkets();
    marketsTimer = setInterval(pollMarkets, MARKETS_POLL_MS);

    /*
       서버 설정을 1회 확보한다.

       /api/config 에는 모드·기본심볼 외에 거래소 가입 링크가 들어 있고,
       화면 여러 곳이 그 값으로 요소를 켜고 끈다. 부팅 때 받아두지 않으면
       설정이 있어도 화면에 영구히 반영되지 않는다(실제로 겪음).
       실패는 조용히 무시한다 — 정적 폴백에서 콘솔 오류를 내지 않는다.
    */
    if (Api && Api.ensureConfig) Api.ensureConfig();

    /*
       Server-Timing 을 못 읽는 환경에서만, 백엔드 유무를 확인한다.

       ★★ 이전에는 **한 번 실패하면 곧바로 목업으로 되돌렸다.** 그래서 서버가
         재시작 중이거나 네트워크가 잠깐 끊기면, 그 순간 접속한 사용자가 목업
         데이터를 **자기 잔고·자기 포지션으로** 본다. 그리고 backendPresent 가
         false 로 굳어 새로고침 전까지 계속 목업이다.
         (실측으로 확인했다 — 서버 재시작 직후 목업 값 2건이 노출됐다.)

       ★ 두 경우를 구분한다:
           · HTTP 응답을 받았고 404/501 → 정적 프리뷰다(파일 서버는 있고 API 가
             없다). 목업이 맞다.
           · 네트워크 실패·타임아웃·5xx → 백엔드는 있으나 지금 문제다.
             **목업으로 가지 않는다.** 재시도한다.

       ★ 목업을 보여주는 것보다 "연결 중" 이 낫다. 빈 화면은 사용자가 다시
         시도하게 하지만, 남의 숫자는 자기 것으로 기억한다.
    */
    if (allowProbe) {
      var probeAttempt = 0;
      var PROBE_MAX = 3;

      var probe = function () {
        probeAttempt += 1;
        Api.rest.status().catch(function (err) {
          var status = err && err.status;
          var isMissingApi = status === 404 || status === 501;

          if (isMissingApi) {
            console.info('[QTLive] API 없음 (HTTP ' + status + ') — 정적 프리뷰로 동작한다');
            stop();
            started = true;
            live.backendPresent = false;
            startMockFallback();
            return;
          }

          if (probeAttempt < PROBE_MAX) {
            // 지수적으로 늘린다. 서버 재시작은 보통 몇 초 안에 끝난다.
            var wait = 1500 * probeAttempt;
            console.info(
              '[QTLive] 백엔드 확인 실패 (' + (status || '네트워크') + ') — ' +
                wait + 'ms 후 재시도 ' + probeAttempt + '/' + (PROBE_MAX - 1),
            );
            setTimeout(probe, wait);
            return;
          }

          /*
             재시도까지 실패했다. 여기서도 목업으로 바꾸지 않는다 —
             화면은 "데이터를 불러올 수 없음" 으로 남는다.
             ★ backendPresent 를 null 로 유지하면 QTMockPolicy 가 목업을 쓰지
               않는다(판정 불가 = 목업 금지).
          */
          console.warn('[QTLive] 백엔드에 연결할 수 없습니다. 목업으로 대체하지 않습니다.');
          live.socketState = 'offline';
          live.upstreamState = 'offline';
        });
      };

      probe();
    }
  }

  function stop() {
    if (!started) return;
    started = false;
    if (marketsTimer) clearInterval(marketsTimer);
    marketsTimer = null;
    if (bookTimer) clearTimeout(bookTimer);
    bookTimer = null;
    if (socket) socket.close();
    socket = null;
    stopMockFallback();
  }

  /**
   * 트레이딩 화면이 보고 있는 심볼을 알린다.
   * 이 심볼만 WS 로 ticker/depth/execution 을 구독한다. 21개 전부 구독하면
   * 업스트림 토픽이 63개가 되고 브라우저도 감당하지 못한다.
   */
  function setActiveSymbol(rawSymbol) {
    var symbol = normalizeSymbol(rawSymbol);
    if (!symbol || symbol === live.activeSymbol) return;

    var prev = live.activeSymbol;
    live.activeSymbol = symbol;

    if (socket) {
      if (prev) {
        socket.unsubscribeSymbols([prev]);
        if (live.activeTimeframe) socket.unsubscribeCandles(prev, live.activeTimeframe);
      }
      flushDesiredSubscriptions();
    }

    primeActiveSymbol(symbol);

    var t = live.tickers.get(symbol);
    if (t) applyTicker(t);
    scheduleBump();
  }

  /** 활성 심볼의 스냅샷을 REST 로 즉시 받아 첫 화면이 비지 않게 한다. */
  function primeActiveSymbol(symbol) {
    if (!canCallApi() || !isSupported(symbol)) return;

    Api.rest.orderbook(symbol, 20)
      .then(function (res) { if (res && res.ok) applyBook(res.data); })
      .catch(function () {});
    Api.rest.trades(symbol, 60)
      .then(function (res) { if (res && res.ok) applyTradesSnapshot({ symbol: symbol, trades: res.data }); })
      .catch(function () {});
    Api.rest.ticker(symbol)
      .then(function (res) { if (res && res.ok) applyTicker(res.data); })
      .catch(function () {});
    ensureCandles(symbol, live.activeTimeframe);
  }

  /** 차트 타임프레임 변경을 알린다. 해당 캔들 스트림을 구독한다. */
  function setActiveTimeframe(tf) {
    if (!tf || tf === live.activeTimeframe) return;
    var prev = live.activeTimeframe;
    live.activeTimeframe = tf;

    if (socket && live.activeSymbol) {
      if (prev) socket.unsubscribeCandles(live.activeSymbol, prev);
      flushDesiredSubscriptions();
    }
    if (live.activeSymbol) ensureCandles(live.activeSymbol, tf);
  }

  // ---------------------------------------------------------------
  // 교체 적용
  // ---------------------------------------------------------------

  QT.generateCandles = generateCandles;
  QT.generateOrderBook = generateOrderBook;
  QT.generateTrades = generateTrades;

  QT.stream = {
    on: on,
    emit: emit,
    start: start,
    stop: stop,
    // 목업에는 수동 tick 이 있었다. 실데이터에서는 의미가 없으므로 no-op.
    tick: function () {},
    getState: function () { return Object.assign({}, tickState); },
    setConnectionState: function (s) {
      // 개발자 도구에서 연결 상태를 강제로 바꿔보는 용도로 남겨둔다.
      live.upstreamState = s;
      publishConnectionState();
    },
  };

  // ---------------------------------------------------------------
  // React 연동 훅
  // ---------------------------------------------------------------

  /**
   * 실데이터가 갱신될 때 재렌더를 유발하는 훅.
   * 기존 컴포넌트의 useMemo 의존성 배열에 이 값을 추가하면 된다.
   * 반환값은 단조증가 정수이므로 값 자체에 의미는 없다.
   */
  function useLiveVersion() {
    var React = window.React;
    if (!React) return 0;
    var state = React.useState(live.version);
    var version = state[0];
    var setVersion = state[1];

    React.useEffect(function () {
      var off = subscribeVersion(function (v) { setVersion(v); });
      // 마운트 사이에 갱신이 있었을 수 있으므로 즉시 동기화한다.
      setVersion(live.version);
      return off;
    }, []);

    return version;
  }

  function subscribeVersion(cb) {
    versionListeners.add(cb);
    return function () { versionListeners.delete(cb); };
  }

  // ---------------------------------------------------------------
  // 공개 API
  // ---------------------------------------------------------------

  window.QTLive = {
    start: start,
    stop: stop,
    setActiveSymbol: setActiveSymbol,
    setActiveTimeframe: setActiveTimeframe,
    useLiveVersion: useLiveVersion,
    subscribeVersion: subscribeVersion,

    /** 해당 심볼이 실데이터인지. 목업이면 false. */
    isLive: function (symbol) {
      var s = normalizeSymbol(symbol);
      return Boolean(s) && live.liveSymbols.has(s) && !live.unsupported.has(s);
    },

    /** 'live' | 'mock' — 화면 전체의 데이터 출처 */
    getSource: function () {
      if (live.backendPresent === false) return 'mock';
      return live.socketState === 'live' && live.liveSymbols.size > 0 ? 'live' : 'mock';
    },

    /**
     * 백엔드가 붙어 있는가.
     *
     * null = 아직 판정 못 함. true/false = 확정.
     * 세 값을 구분하는 이유: "아직 모름" 을 false 로 다루면 부팅 직후 한순간
     * 목업 화면이 보이고, true 로 다루면 백엔드 없는 환경에서 실데이터인 척한다.
     */
    isBackendPresent: function () { return live.backendPresent; },

    getUnsupported: function () { return Array.from(live.unsupported); },
    getConnectionState: function () { return tickState.connectionState; },
    getLatency: function () { return socket ? socket.getLatency() : 0; },

    /**
     * 마지막 시세 데이터가 도착한 뒤 흐른 시간(ms).
     *
     * null = 아직 한 번도 받지 못했다. 0 으로 주면 "방금 받았다" 는 거짓이
     * 되고, 죽은 화면을 신선하다고 표시한다.
     */
    getDataAgeMs: function () {
      return live.lastDataAt ? Date.now() - live.lastDataAt : null;
    },
    getActiveSymbol: function () { return live.activeSymbol; },
    getTicker: function (symbol) { return live.tickers.get(normalizeSymbol(symbol)) || null; },

    /** 진단용. 콘솔에서 QTLive.debug() 로 현재 상태를 본다. */
    debug: function () {
      return {
        backendPresent: live.backendPresent,
        socketState: live.socketState,
        upstreamState: live.upstreamState,
        resolved: tickState.connectionState,
        activeSymbol: live.activeSymbol,
        activeTimeframe: live.activeTimeframe,
        liveSymbols: Array.from(live.liveSymbols),
        unsupported: Array.from(live.unsupported),
        candleKeys: Array.from(live.candles.keys()),
        version: live.version,
        latencyMs: socket ? socket.getLatency() : 0,
      };
    },
  };
})();
