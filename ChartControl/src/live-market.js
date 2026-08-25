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
    /**
     * 심볼 -> 추세 스파크라인 종가 배열.
     *
     * 캔들 캐시와 따로 둔다. 스파크라인은 적은 봉(24개)만 받으므로 이것을
     * 캔들 캐시에 넣으면 차트가 24봉만 있는 것으로 잘못 판단한다.
     */
    sparklines: new Map(),
    /** 심볼 -> 진행 중 스파크라인 요청 */
    sparkInflight: new Map(),
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

      /*
         ★ 이 목록은 **선물** 마켓 폴링에서 온다(Api.rest.markets). 그러므로
           선물로 등록한다. 시장 없이 넣으면 '어느 시장에 상장됐는지' 를 잃고,
           그 심볼에 다른 시장 경로로 요청하게 된다(규칙 18).
      */
      live.liveSymbols.add(symbol + '|futures');
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

    /*
       ★ 목록에 없던 실거래 심볼을 추가한다.

         전에는 위 forEach 가 **기존 QT.MARKETS 행만 제자리 갱신**해서, 목업 시드에
         들어 있던 소수 종목만 보였다(거래소는 수백 개를 주는데 화면엔 20여 개).
         참조를 유지해야 하므로(컴포넌트가 QT.MARKETS 배열 참조를 캡처함) 새 배열로
         바꾸지 않고 제자리에 push 한다. 가격이 없는 심볼은 넣지 않는다(정직).
    */
    var existing = new Set(QT.MARKETS.map(function (m) { return normalizeSymbol(m.base + m.quote); }));
    var QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
    rows.forEach(function (r) {
      if (!r || r.available === false) return;
      var sym = normalizeSymbol(r.symbol);
      if (!sym || existing.has(sym)) return;
      var base = r.base;
      var quote = r.quote;
      if (!base || !quote) {
        base = sym; quote = '';
        for (var qi = 0; qi < QUOTES.length; qi += 1) {
          var qc = QUOTES[qi];
          if (sym.length > qc.length && sym.slice(-qc.length) === qc) { base = sym.slice(0, sym.length - qc.length); quote = qc; break; }
        }
        if (!quote) return;
      }
      if (!(typeof r.price === 'number' && r.price > 0)) return;
      existing.add(sym);
      live.liveSymbols.add(sym + '|futures');
      QT.MARKETS.push({
        base: base, quote: quote, type: 'futures', dataSource: 'live',
        price: r.price,
        chg24h: typeof r.chg24h === 'number' ? r.chg24h : 0,
        vol24h: typeof r.vol24h === 'number' ? r.vol24h : 0,
        hi: typeof r.hi === 'number' ? r.hi : null,
        lo: typeof r.lo === 'number' ? r.lo : null,
        mark: r.mark, index: r.index, bid: r.bid, ask: r.ask,
        fundingRate: r.fundingRate, nextFundingTime: r.nextFundingTime, openInterest: r.openInterest,
        tickSize: r.tickSize, multiplier: r.multiplier, maxLeverage: r.maxLeverage,
        takerFeeRate: r.takerFeeRate, makerFeeRate: r.makerFeeRate,
      });
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

  /**
   * 캔들 캐시 키.
   *
   * ★★ 시장(현물/선물)을 키에 포함한다.

   *   두 시장의 캔들은 **같은 심볼·같은 주기라도 다른 값**이다(가격이 다르고,
   *   상장 여부도 다르다). 키에 시장을 넣지 않으면 모드를 바꿨을 때 이전 시장의
   *   캔들이 그대로 보인다 — 이용자는 현물 차트를 본다고 믿으면서 선물 가격을
   *   읽는다. 그 상태로 주문을 내면 예상과 다른 가격에 체결된다.
   */
  function currentMarketId() {
    return (window.QTMode && window.QTMode.get && window.QTMode.get() === 'spot') ? 'spot' : 'futures';
  }

  function candleKey(symbol, tf) {
    return symbol + '|' + tf + '|' + currentMarketId();
  }

  /**
   * 티커 캐시 키.
   *
   * ★★ 시장을 포함한다. 캔들과 같은 이유다.

   *   현물과 선물은 같은 심볼이라도 **다른 가격**이고, 선물에만 있는 값(마크가·
   *   지수가·펀딩비)이 있다. 한 키를 공유하면 현물 화면에 선물 값이 남는다.
   *   실측에서 현물로 바꾼 뒤에도 mark·index·fundingRate 가 남아 있었다.
   *   화면이 그 항목을 숨기고 있어 눈에 띄지 않았지만, `last` 가 선물 가격으로
   *   덮이면 이용자는 현물 가격이라고 믿으며 다른 값을 본다.
   */
  function tickerKey(symbol) {
    return symbol + '|' + currentMarketId();
  }

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

  /**
   * 추세 스파크라인용 종가 배열.
   *
   * ★★ 시장 목록의 'Trend' 열이 사인파 + 난수였다.
   *
   *   `r.price * (1 + Math.sin(i/3 + base.charCodeAt(0)) * 0.02 + (Math.random()-0.5)*0.006)`
   *   심볼 이름으로 위상을 정한 가짜 곡선이다. 작은 그림이라 근거가 없다는
   *   것이 드러나지 않고, 사용자는 그 모양을 보고 종목을 고른다.
   *
   * ★ 왜 별도 함수인가
   *   캔들 차트용 `ensureCandles` 는 300봉을 받는다. 목록에는 20여 종목이
   *   동시에 있으므로 그대로 쓰면 300봉 × 20 요청이 된다. 스파크라인은
   *   24포인트면 충분하므로 적게 받고, 받은 것은 같은 캐시에 넣지 않는다
   *   (차트가 24봉만 있는 것으로 오해하면 안 된다).
   *
   * ★ 요청은 **화면이 요구할 때 한 번만** 나간다. 없는 동안 호출자는
   *   빈 배열을 받고 '—' 를 표시해야 한다. 가짜 곡선으로 채우지 않는다.
   *
   * @returns {number[]} 종가 배열. 아직 없으면 빈 배열.
   */
  var SPARK_TF = '1h';
  var SPARK_COUNT = 24;
  function getSparkline(symbol) {
    var s = normalizeSymbol(symbol);
    if (!s) return [];

    /*
       ★ 캐시 키에 시장을 넣는다. 같은 심볼이라도 현물과 선물의 종가가 다르므로,
         한 키를 공유하면 현물 목록에 선물 추세가 그려진다.
    */
    var cached = live.sparklines.get(s + '|' + currentMarketId());
    if (cached) return cached;

    // 차트용 캔들이 이미 있으면 그것을 쓴다 — 요청을 아낀다.
    var full = live.candles.get(candleKey(s, live.activeTimeframe || '15m'));
    if (full && full.length) {
      return full.slice(-SPARK_COUNT).map(function (c) { return c.close; });
    }

    ensureSparkline(s);
    return [];
  }

  /*
     ★ 큐 상한과 실패 백오프.

       검증 도구가 51개 라우트를 빠르게 넘기며 순회할 때 /markets 가 502 로
       실패했다. 화면이 넘어가도 큐에 남은 심볼을 계속 요청하기 때문에 요청이
       라우트를 넘어 누적되고, 어느 지점에서 상류 한도에 닿는다.
       사람이 쓸 때도 목록을 빠르게 여닫으면 같은 일이 생긴다.

       두 가지로 막는다.
         · 상한: 큐가 가득하면 새 요청을 버린다. 버려진 심볼은 '—' 로 남고,
           다시 화면에 필요해지면 그때 한 번 더 시도된다.
         · 백오프: 실패하면 다음 간격을 늘린다. 상류가 한도라고 말할 때
           같은 속도로 계속 두드리면 시세·주문 조회까지 막힌다.
  */
  var SPARK_QUEUE_MAX = 24;
  var SPARK_GAP_MIN_MS = 120;
  var SPARK_GAP_MAX_MS = 4000;
  var sparkGapMs = SPARK_GAP_MIN_MS;
  var sparkQueue = [];
  var sparkRunning = false;

  function pumpSparkQueue() {
    if (sparkRunning) return;
    var job = sparkQueue.shift();
    if (!job) return;
    var symbol = job.symbol;
    sparkRunning = true;

    /*
       ★★ 스파크라인도 시장을 구분해야 한다.

         현물 목록에는 BTCUSDC·USDTUSDC 처럼 **선물에 없는 종목**이 있다. 그런데
         이 큐가 언제나 선물 캔들 경로로 요청해서, 그 종목마다 502
         (`KuCoin 선물 미상장 심볼`)가 났다. 실측으로 /markets 에서 502 3건이
         잡혔고 원인이 이것이었다.

       ★ 502 는 재시도 대상으로 취급되어 백오프를 키운다. 즉 존재하지 않는 종목
         때문에 **실제로 필요한 스파크라인 요청까지 느려진다.**
    */
    /*
       ★★ 시장은 **큐에 넣을 때** 정해진다 — 꺼낼 때 다시 읽으면 안 된다.

         큐는 간격을 두고 천천히 비워진다(상류 한도 때문에). 그 사이 이용자가
         모드를 바꿀 수 있다. 전에는 여기서 `currentMarketId()` 를 다시 읽어서,
         **현물 목록에서 담은 종목을 선물 경로로 요청했다.** BTCUSDC·USDTUSDC 는
         선물에 없으므로 502(`선물 미상장 심볼`)가 났다. 실측으로 /markets 에서
         이 502 가 반복 잡혔고, 원인이 이것이다.

       ★ 502 는 백오프를 키운다. 즉 없는 심볼 하나가 **실제로 필요한 추세선
         요청까지 느리게** 만든다.
    */
    var reqMk = job.market;
    var reqSpot = reqMk === 'spot';
    /*
       ★ 현물인데 현물 경로가 없으면 **요청하지 않는다.** 선물 경로로 떨어지면
         선물에 없는 종목이 502 가 되고, 있는 종목은 다른 시장의 추세선이 된다.
         둘 다 조용히 틀린다 — 추세선은 '—' 로 비워 두는 편이 맞다.
    */
    if (reqSpot && !(Api.rest.spot && Api.rest.spot.candles)) {
      live.sparkInflight.delete(symbol + '|' + reqMk);
      sparkRunning = false;
      if (sparkQueue.length) setTimeout(pumpSparkQueue, sparkGapMs);
      return;
    }
    var spark = reqSpot
      ? Api.rest.spot.candles(symbol, SPARK_TF, SPARK_COUNT)
      : Api.rest.candles(symbol, SPARK_TF, SPARK_COUNT);
    spark
      .then(function (res) {
        if (res && res.ok && Array.isArray(res.data) && res.data.length) {
          var closes = [];
          for (var i = 0; i < res.data.length; i += 1) {
            var v = Number(res.data[i].close);
            if (isFinite(v)) closes.push(v);
          }
          // 점이 2개 미만이면 선이 되지 않는다. 저장하지 않아 '—' 로 남긴다.
          if (closes.length >= 2) {
            live.sparklines.set(symbol + '|' + reqMk, closes);
            scheduleBump();
          }
          // 성공했으면 원래 속도로 돌아온다.
          sparkGapMs = SPARK_GAP_MIN_MS;
        } else {
          sparkGapMs = Math.min(sparkGapMs * 2, SPARK_GAP_MAX_MS);
        }
      })
      .catch(function () {
        /* 실패는 '—' 로 남는다. 가짜로 채우지 않는다. 속도만 줄인다. */
        sparkGapMs = Math.min(sparkGapMs * 2, SPARK_GAP_MAX_MS);
      })
      .finally(function () {
        live.sparkInflight.delete(symbol + '|' + reqMk);
        sparkRunning = false;
        if (sparkQueue.length) setTimeout(pumpSparkQueue, sparkGapMs);
      });
  }

  function ensureSparkline(symbol) {
    if (!canCallApi()) return;
    /*
       ★★ 시세가 실제로 도착한 심볼만 요청한다.

         전에는 `isSupported()` 로 걸렀다. 그 판정은 `unsupported` 집합에
         없으면 통과시키는데, 그 집합은 WS 의 hello 메시지나 시세 목록이
         도착한 뒤에야 채워진다. 그래서 화면이 뜬 직후에는 **미상장 심볼도
         통과했고**, TON 처럼 KuCoin 선물에 없는 종목에 캔들을 요청해
         502(UPSTREAM_ERROR: 미상장 심볼)를 받았다. 검증에서 /markets 가
         반복 실패한 원인이 이것이다.

         liveSymbols 는 시세가 실제로 들어온 심볼만 담는다. 미상장은 여기
         들어올 수 없으므로, 이 조건이면 없는 심볼에 요청하지 않는다.
         시세가 아직 안 온 종목은 조금 뒤에 채워진다 — 시세도 없는 종목의
         추세선을 서둘러 그릴 이유는 없다.
    */
    // 지금 시장에 시세가 온 심볼만. 다른 시장에만 있는 종목은 요청하지 않는다.
    if (!hasLiveTicker(symbol)) return;
    var sk = symbol + '|' + currentMarketId();
    if (live.sparklines.has(sk) || live.sparkInflight.has(sk)) return;
    // 상한을 넘으면 요청하지 않는다 — '—' 로 남는 편이 상류 한도를 쓰는 것보다 낫다.
    if (sparkQueue.length >= SPARK_QUEUE_MAX) return;

    // inflight 에 먼저 표시한다 — 같은 심볼이 큐에 두 번 들어가지 않게.
    live.sparkInflight.set(sk, true);
    // 시장을 함께 싣는다. 꺼낼 때의 모드가 아니라 담을 때의 시장이 맞다.
    sparkQueue.push({ symbol: symbol, market: currentMarketId() });
    pumpSparkQueue();
  }

  /**
   * 이 시장에 이 심볼의 시세가 실제로 도착했는가.
   *
   * ★ 시세가 온 적 없는 심볼에 캔들을 요청하면 502 가 온다. 그리고 502 는
   *   백오프를 키우므로, 없는 심볼 하나가 **실제로 필요한 요청까지 느리게** 만든다.
   */
  function hasLiveTicker(symbol, mk) {
    return live.liveSymbols.has(symbol + '|' + (mk || currentMarketId()))
      && !live.unsupported.has(symbol);
  }

  /**
   * 이 심볼의 **표시용 데이터**가 실제인가.
   *
   * ★★ 티커만 보면 안 된다.
   *
   *   거래소에서 실제로 받아 온 캔들을 들고 있는데도 티커가 아직 안 왔다는
   *   이유로 '실데이터 아님' 이 되면, 위젯이 그 봉을 그리지 않는다. 현물
   *   모드의 거래 화면에서 이 일이 실제로 일어났다 — 캔들 60개가 메모리에
   *   있는데 보조 차트가 **빈 칸**이었다. 오류도 없어서 "차트가 안 나온다" 는
   *   형태로만 보인다.
   *
   * ★ 반대로 넓히지도 않는다. 목업 캔들은 여기 들어오지 않는다 —
   *   `live.candles` 에는 서버 응답만 저장한다(mock 은 반환만 하고 저장하지 않는다).
   */
  function hasLiveData(symbol, tf) {
    if (live.unsupported.has(symbol)) return false;
    if (hasLiveTicker(symbol)) return true;
    // 활성 주기를 우선 보고, 없으면 이 심볼의 아무 주기라도 실캔들이 있으면 실데이터다.
    var key = candleKey(symbol, tf || live.activeTimeframe || '15m');
    var got = live.candles.get(key);
    if (got && got.length) return true;
    var prefix = symbol + '|';
    var suffix = '|' + currentMarketId();
    var it = live.candles.keys();
    for (var k = it.next(); !k.done; k = it.next()) {
      var kk = k.value;
      if (kk.indexOf(prefix) === 0 && kk.indexOf(suffix, kk.length - suffix.length) !== -1) {
        var arr = live.candles.get(kk);
        if (arr && arr.length) return true;
      }
    }
    return false;
  }

  /**
   * 지금 현물 모드인가.
   *
   * ★★ 현물과 선물은 **다른 캔들 경로**를 쓴다. 배열 순서와 심볼 표기가 달라서
   *   한쪽 응답을 다른 쪽 파서로 읽으면 고가·저가가 뒤섞인 차트가 나온다.
   *   그래서 캐시 키에도 시장을 넣어, 모드를 바꿀 때 이전 시장의 캔들이
   *   그대로 보이지 않게 한다.
   */
  function isSpotMode() {
    return Boolean(window.QTMode && window.QTMode.get && window.QTMode.get() === 'spot');
  }

  /** 실캔들을 확보한다. 이미 있거나 요청 중이면 아무 것도 하지 않는다. */
  function ensureCandles(symbol, tf) {
    if (!canCallApi()) return;
    var spot = isSpotMode();
    /*
       ★ 미상장 검사는 **선물 기준**이다. 현물에는 다른 목록이 적용되므로
         현물 모드에서는 이 검사를 건너뛴다 — 선물에 없는 종목이 현물에는
         있을 수 있고, 그것을 막으면 볼 수 있는 차트를 못 보게 된다.
    */
    if (!spot && !isSupported(symbol)) return;
    var key = candleKey(symbol, tf);
    if (live.candles.has(key) || live.candleInflight.has(key)) return;

    var p = (spot && Api.rest.spot
      ? Api.rest.spot.candles(symbol, tf, 300)
      : Api.rest.candles(symbol, tf, 300))
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

  /*
     차트를 과거로 스크롤할 때 더 오래된 캔들을 받아 온다. KLineChart 의
     setDataLoader(backward) 가 이 함수를 부른다. beforeTs 이전 캔들을 서버에서
     받아(백엔드는 before 파라미터 지원) 캐시 앞쪽에 병합하고, 받은 배열을
     오름차순(오래된 것 먼저)으로 반환한다. 실패/없음이면 빈 배열.
  */
  function loadOlderCandles(symbol, tf, beforeTs, limit) {
    if (!canCallApi()) return Promise.resolve([]);
    var sym = normalizeSymbol(symbol);
    if (!sym || !beforeTs) return Promise.resolve([]);
    var spot = isSpotMode();
    var req = (spot && Api.rest.spot)
      ? Api.rest.spot.candles(sym, tf, limit || 300, beforeTs)
      : Api.rest.candles(sym, tf, limit || 300, beforeTs);
    return req.then(function (res) {
      if (!(res && res.ok && Array.isArray(res.data) && res.data.length)) return [];
      var older = toNumericCandles(res.data)
        .filter(function (c) { return c && c.time && c.time < beforeTs; })
        .sort(function (a, b) { return a.time - b.time; });
      if (!older.length) return [];
      var key = candleKey(sym, tf);
      var cur = live.candles.get(key);
      if (cur && cur.length) {
        var firstTs = cur[0].time;
        var head = older.filter(function (c) { return c.time < firstTs; });
        if (head.length) live.candles.set(key, head.concat(cur));
      }
      return older;
    }).catch(function () { return []; });
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

  /**
   * 티커를 반영한다.
   *
   * @param {object} t        티커
   * @param {'spot'|'futures'} [market]  이 데이터가 **어느 시장에서 왔는지**
   *
   * ★★ 시장을 인자로 받는 이유

   *   전에는 저장 키를 `현재 모드` 로 만들었다. 그런데 선물 시세 폴링은 모드와
   *   무관하게 돌기 때문에, 현물 모드에서 **선물 데이터가 현물 키에 기록됐다.**
   *   실측에서 현물 티커에 mark·index·fundingRate 가 남아 있었고, `last` 도
   *   선물 가격으로 덮일 수 있었다 — 이용자는 현물 가격이라고 믿으며 다른 값을 본다.
   *
   *   그래서 **쓰는 쪽이 출처를 밝힌다.** 생략하면 선물로 본다(기존 호출 호환).
   */
  function applyTicker(t, market) {
    var symbol = normalizeSymbol(t.symbol);
    if (!symbol) return;
    var mk = market === 'spot' ? 'spot' : 'futures';
    // 문자열 가격을 여기서 숫자로 바꾼다 (경계에서 한 번만).
    t = numify(t, TICKER_NUM);
    /*
       ★★ 부분 갱신을 덮어쓰기로 처리하지 않는다.

         현물 WS 의 ticker 프레임에는 **24시간 변동률·고가·저가·거래대금이 없다**
         (KuCoin 이 주지 않는다. 실제 프레임으로 확인: price·bestBid·bestAsk·size 뿐).
         그것으로 티커를 통째로 바꾸면 변동률이 사라져 **모든 종목이 "변동 없음"**
         으로 보이고, 24시간 고저와 거래대금도 빈다. 화면은 값이 지워진 것을
         "0" 으로 그린다.

         그래서 기존 값 위에 도착한 필드만 덮는다. 선물은 전체 티커가 오므로
         결과가 같다.
    */
    var prev = live.tickers.get(symbol + '|' + mk);
    if (prev) t = Object.assign({}, prev, t);
    live.tickers.set(symbol + '|' + mk, t);
    /*
       ★★ 시장을 함께 담는다 (규칙 18: 시장별 캐시 키).

         전에는 심볼만 담았다. 그래서 **현물 티커가 도착한 심볼을 선물에도
         상장된 것으로 취급했다.** BTCUSDC·USDTUSDC 는 현물에만 있는데,
         스파크라인이 선물 캔들 경로로 요청해 502(`선물 미상장 심볼`)가 났다.
         실측으로 /markets 에서 이 502 가 잡혔고 원인이 이것이다.
    */
    live.liveSymbols.add(symbol + '|' + mk);

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
        /*
           ★ 서버 세션의 시장을 그대로 따른다. 우리가 요청한 시장과 서버가
             구독한 시장은 같아야 하지만, 전환 직후에는 이전 시장의 프레임이
             한두 개 더 올 수 있다. 그것을 새 시장 키에 쓰면 값이 섞인다.
        */
        applyTicker(data, data && data.market ? data.market : currentMarketId());
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

    var t = live.tickers.get(tickerKey(symbol));
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
    /*
       ★ React 가 없으면 0 을 돌려준다(정적 프리뷰·테스트 하네스에서 이 파일만 로드되는 경우).
         규칙상 조기 return 뒤의 훅 호출이지만, window.React 의 유무는 페이지 수명 동안
         바뀌지 않으므로 훅 순서는 렌더마다 동일하다. 조건을 없앨 수는 없다 — React 가
         없으면 훅 자체를 부를 수 없다.
    */
    if (!React) return 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    var state = React.useState(live.version);
    var version = state[0];
    var setVersion = state[1];

    // eslint-disable-next-line react-hooks/rules-of-hooks
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

  /*
     ★★ 모드가 바뀌면 티커를 현물/선물에 맞게 다시 받는다.

       캔들은 키에 시장이 들어 있어 자동으로 새로 받지만, 티커는 심볼별 Map 에
       들어 있어 이전 시장 값이 남는다. 그러면 헤더의 현재가는 선물, 차트는 현물이
       되어 **같은 화면에서 두 가격이 어긋난다.** 실제로 그런 종류의 불일치를
       코파일럿 인사말에서 겪었다.

     ★ REST 로 먼저 한 번 채운다. 현물 WS 의 ticker 프레임에는 24시간 변동률·
       고저·거래대금이 없으므로(KuCoin 이 주지 않는다), 그 값들은 REST 에서만 온다.
       WS 는 그 위에 최근가와 최우선 호가만 덮는다.
  */
  if (window.QTMode && window.QTMode.subscribe) {
    window.QTMode.subscribe(function () {
      live.tickers.clear();
      live.unsupported.clear();
      if (!canCallApi()) { scheduleBump(); return; }
      var spot = isSpotMode();
      if (spot && Api.rest.spot) {
        Api.rest.spot.tickers()
          .then(function (r) {
            if (!r || !r.supported || !Array.isArray(r.data)) return;
            r.data.forEach(function (row) { applyTicker(row, 'spot'); });
            scheduleBump();
          })
          .catch(function () { scheduleBump(); });
      } else {
        // 선물로 돌아오면 기존 경로가 다시 채운다.
        scheduleBump();
      }

      /*
         ★★ WS 를 새 시장으로 다시 구독한다.

           REST 로 한 번 채우는 것만으로는 **가격이 멈춰 있다.** 실측에서
           모드를 바꾼 뒤 11초 동안 값이 그대로였다 — 서버 세션의 시장이 여전히
           선물이라 현물 프레임이 오지 않았기 때문이다.

           서버는 subscribe 요청의 `market` 으로 세션 시장을 정하고, 시장이
           바뀌면 이전 구독을 끊는다. 그래서 클라이언트가 다시 구독해야 한다.
      */
      if (socket && live.activeSymbol) {
        try {
          socket.unsubscribeSymbols([live.activeSymbol]);
          if (live.activeTimeframe) socket.unsubscribeCandles(live.activeSymbol, live.activeTimeframe);
          socket.subscribeSymbols([live.activeSymbol]);
          if (live.activeTimeframe) socket.subscribeCandles(live.activeSymbol, live.activeTimeframe);
        } catch (e) { /* 소켓이 아직 없으면 연결 시 구독된다 */ }
      }
    });
  }

  window.QTLive = {
    start: start,
    stop: stop,
    setActiveSymbol: setActiveSymbol,
    setActiveTimeframe: setActiveTimeframe,
    /** 차트 과거 스크롤 시 더 오래된 캔들을 받아 온다(오름차순 배열 반환). */
    loadOlderCandles: loadOlderCandles,
    /*
       현재 주기를 읽는다.

       ★ 설정하는 창구(setActiveTimeframe)만 있고 읽는 창구가 없었다. 학습
         문맥이 "그때 무슨 주기를 보고 있었는가" 를 담아야 하는데, 화면 상태를
         추측하면 틀린다 — 15분봉을 보며 낸 주문이 1시간봉으로 기록된다.
    */
    getActiveTimeframe: function () { return live.activeTimeframe || null; },
    useLiveVersion: useLiveVersion,
    subscribeVersion: subscribeVersion,

    /** 해당 심볼이 실데이터인지. 목업이면 false. */
    isLive: function (symbol) {
      var s = normalizeSymbol(symbol);
      /*
         ★ 캔들도 함께 본다. 티커만 보면 실캔들을 들고도 '목업' 으로 취급해
           위젯이 봉을 그리지 않는다(현물 거래 화면에서 실제로 겪었다).
      */
      return Boolean(s) && hasLiveData(s);
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
    getTicker: function (symbol) { return live.tickers.get(tickerKey(normalizeSymbol(symbol))) || null; },

    /**
     * 추세 스파크라인 종가 배열. 아직 없으면 빈 배열을 준다.
     *
     * 호출자는 빈 배열을 '—' 로 표시해야 한다 — 가짜 곡선으로 채우지 않는다.
     * 처음 호출하면 요청이 나가고, 도착하면 useLiveVersion 이 올라가 다시 그린다.
     */
    getSparkline: getSparkline,

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
