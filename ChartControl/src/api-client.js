/* ============================================================
   API Client — 백엔드(/api/v1, /ws) 접근 계층
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다. 디자인/렌더링에 관여하지 않는다.

   백엔드가 죽어 있어도 여기서 예외를 던지지 않고 null/빈값을 돌려준다.
   호출자(live-market.js)가 목업으로 폴백할 수 있어야 하기 때문이다.
   ============================================================ */

(function () {
  'use strict';

  /**
   * 백엔드 REST 접두사.
   *
   * apps/api 의 시세 표면은 `/api/market/*` 다. 인증·거래소 등 버전이 붙은
   * 표면은 `/api/v1/*` 를 쓴다. 둘을 따로 둔다 — 한쪽만 바뀌어도 다른 쪽이
   * 깨지지 않게 하기 위함이다.
   */
  var MARKET_BASE = '/api/market';
  var V1_BASE = '/api/v1';

  /** 같은 오리진에 붙는다. 백엔드가 정적 파일도 함께 서빙하므로 CORS 가 없다. */
  function wsUrl() {
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.host + '/ws';
  }

  // ---------------------------------------------------------------
  // REST 기반
  // ---------------------------------------------------------------

  function getJSON(base, path, opts) {
    opts = opts || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || 12000);

    return fetch(base + path, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) { /* 비JSON 응답 */ }
          if (!res.ok) {
            // 백엔드 오류 봉투는 { error: { code, message } } 형태다.
            var msg = (json && json.error && json.error.message)
              || (json && json.error)
              || ('HTTP ' + res.status);
            var err = new Error(msg);
            err.status = res.status;
            err.code = json && json.error && json.error.code;
            err.payload = json;
            throw err;
          }
          return json;
        });
      })
      .finally(function () { clearTimeout(timer); });
  }

  function market(path, opts) { return getJSON(MARKET_BASE, path, opts); }

  // ---------------------------------------------------------------
  // 형식 변환 — 백엔드 정규 스키마 → UI 소비 형태
  // ---------------------------------------------------------------

  /*
     백엔드는 가격·수량을 **문자열**로 보낸다(DecimalString). 부동소수 반올림으로
     0.1 + 0.2 가 어긋나는 것을 막기 위한 의도적 설계다.
     반면 디자이너 UI 는 숫자를 기대한다(toFixed, 산술 비교).
     변환은 여기 한 곳에서만 한다 — 화면 코드에 Number() 가 흩어지면
     빠뜨린 곳에서 문자열 연결("1"+"2"="12") 사고가 난다.
  */

  /** 문자열/숫자를 유한한 숫자로. 변환 불가면 fallback. */
  function num(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * 타임프레임을 백엔드 표기로 맞춘다.
   *
   * 디자이너 차트 버튼은 '1H','4H','1D' 대문자를, 백엔드 정규 스키마는
   * 소문자('1h','4h','1d')를 쓴다. 대문자를 그대로 보내면
   * "unsupported timeframe 1H" 로 400 이 온다(실제로 확인했다).
   */
  function normalizeTimeframe(tf) {
    return String(tf || '').toLowerCase();
  }

  /**
   * 정규 오더북 → UI 오더북.
   *
   * 백엔드: { bids: [[가격, 수량], ...], asks: [...] }  (가격 오름차순 아님, 최우선이 앞)
   * UI:     { bids: [{price, amount, cumulative}], asks: [...], mid, spread }
   *
   * cumulative(누적 수량)는 깊이 막대를 그리는 데 쓰인다. 백엔드가 주지 않으므로
   * 여기서 계산한다.
   */
  function toUiBook(book, rows) {
    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

    function side(levels) {
      var out = [];
      var cum = 0;
      var limit = rows || levels.length;
      for (var i = 0; i < levels.length && out.length < limit; i += 1) {
        var lv = levels[i];
        // 레벨은 [가격, 수량] 배열이다. 객체 형태로 오는 경우도 방어한다.
        var price = num(Array.isArray(lv) ? lv[0] : lv && lv.price, NaN);
        var amount = num(Array.isArray(lv) ? lv[1] : lv && lv.amount, NaN);
        if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
        cum += amount;
        out.push({ price: price, amount: amount, cumulative: Math.round(cum * 1e6) / 1e6 });
      }
      return out;
    }

    var bids = side(book.bids);
    var asks = side(book.asks);
    if (!bids.length || !asks.length) return null;

    var bestBid = bids[0].price;
    var bestAsk = asks[0].price;
    return {
      symbol: book.symbol,
      bids: bids,
      asks: asks,
      mid: (bestBid + bestAsk) / 2,
      spread: bestAsk - bestBid,
      ts: num(book.asOf, Date.now()),
      sequence: book.sequence,
    };
  }

  /**
   * 정규 체결 → UI 체결.
   * 백엔드: { id, price:'문자열', size:'문자열', side, ts }
   * UI:     { time, price, amount, side }
   */
  function toUiTrades(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var t = list[i];
      var price = num(t && t.price, NaN);
      var amount = num(t && (t.size !== undefined ? t.size : t.amount), NaN);
      if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
      out.push({
        id: t.id,
        time: num(t.ts !== undefined ? t.ts : t.time, Date.now()),
        price: price,
        amount: amount,
        // side 는 taker 방향이다. 백엔드가 명시하므로 추론하지 않는다.
        side: t.side === 'sell' ? 'sell' : 'buy',
      });
    }
    return out;
  }

  /**
   * 정규 티커 → UI 티커.
   *
   * 필드 이름이 다르다: changePct→chg24hPct, markPrice→mark, nextFundingAt→nextFundingTime.
   * UI 코드를 고치는 대신 여기서 맞춘다 (디자이너 산출물 불가침).
   */
  function toUiTicker(t) {
    if (!t || !t.symbol) return null;
    return {
      symbol: t.symbol,
      last: num(t.last, 0),
      bid: num(t.bid, undefined),
      ask: num(t.ask, undefined),
      mark: num(t.markPrice !== undefined ? t.markPrice : t.mark, undefined),
      index: num(t.indexPrice !== undefined ? t.indexPrice : t.index, undefined),
      high24h: num(t.high24h, undefined),
      low24h: num(t.low24h, undefined),
      chg24hPct: num(t.changePct !== undefined ? t.changePct : t.chg24hPct, undefined),
      vol24hQuote: num(t.vol24h, undefined),
      fundingRate: num(t.fundingRate, undefined),
      nextFundingTime: num(t.nextFundingAt !== undefined ? t.nextFundingAt : t.nextFundingTime, undefined),
      ts: num(t.asOf !== undefined ? t.asOf : t.ts, Date.now()),
    };
  }

  // ---------------------------------------------------------------
  // REST 표면
  // ---------------------------------------------------------------

  /*
     반환 봉투는 { ok: true, data: ... } 로 통일한다.
     호출자(live-market.js)가 이 형태를 기대하고, 백엔드가 죽었을 때
     목업으로 폴백할지 판단하는 기준이 되기 때문이다.
  */

  var rest = {
    /**
     * 백엔드 생존·모드 확인. 가장 가벼운 엔드포인트를 쓴다 —
     * 거래소가 죽어도 200 이 와야 "백엔드는 살아있음"을 구분할 수 있다.
     */
    status: function () {
      return getJSON('', '/api/config').then(function (cfg) {
        return {
          ok: true,
          data: {
            dataMode: cfg && cfg.dataMode,
            source: cfg && cfg.marketDataSource,
            tradingMode: cfg && cfg.tradingMode,
            liveOrdersEnabled: !!(cfg && cfg.liveOrdersEnabled),
            defaultSymbol: cfg && cfg.defaultSymbol,
            timeframes: (cfg && cfg.timeframes) || [],
          },
        };
      });
    },

    /**
     * 마켓 목록 — 24h 통계 + 계약 사양을 합쳐서 돌려준다.
     *
     * 두 엔드포인트를 합치는 이유: 시세(tickers)에는 tickSize·maxLeverage 가 없고,
     * 사양(symbols)에는 가격이 없다. UI 의 마켓 표는 둘을 동시에 쓴다.
     *
     * 거래소에 없는 심볼은 available:false 로 표시한다. 행을 지우지 않는 것이
     * UI 계약이므로, 목업 값을 유지한 채 플래그만 남긴다.
     */
    markets: function () {
      return Promise.all([
        market('/tickers', { timeoutMs: 20000 }),
        market('/symbols', { timeoutMs: 20000 }),
      ]).then(function (res) {
        var tickers = (res[0] && res[0].items) || [];
        var symbols = (res[1] && res[1].symbols) || [];

        var spec = new Map();
        symbols.forEach(function (s) { spec.set(s.id, s); });

        var rows = tickers.map(function (t) {
          var sp = spec.get(t.symbol) || {};
          return {
            symbol: t.symbol,
            available: true,
            price: num(t.last, 0),
            chg24h: num(t.changePct, 0),
            vol24h: num(t.vol24h, 0),
            hi: num(t.high24h, 0),
            lo: num(t.low24h, 0),
            mark: num(t.markPrice, undefined),
            index: num(t.indexPrice, undefined),
            bid: num(t.bid, undefined),
            ask: num(t.ask, undefined),
            fundingRate: num(t.fundingRate, undefined),
            nextFundingTime: num(t.nextFundingAt, undefined),
            openInterest: num(t.openInterest, undefined),
            tickSize: num(sp.tickSize, undefined),
            multiplier: num(sp.multiplier, undefined),
            maxLeverage: num(sp.maxLeverage, undefined),
            takerFeeRate: num(t.takerFeeRate, undefined),
            makerFeeRate: num(t.makerFeeRate, undefined),
            ts: num(res[0] && res[0].asOf, Date.now()),
          };
        });

        // 거래소에 없는 심볼을 표시한다. UI 가 목업을 유지하도록 available:false 만 남긴다.
        // reason 은 사전 키로 넘긴다 — 문구를 여기 박아두면 언어 추가 때 놓친다.
        var listed = new Set(rows.map(function (r) { return r.symbol; }));
        var wanted = (window.QT && Array.isArray(window.QT.MARKETS)) ? window.QT.MARKETS : [];
        wanted.forEach(function (m) {
          var id = String(m.base || '') + String(m.quote || '');
          if (!id || listed.has(id)) return;
          rows.push({ symbol: id, available: false, reasonKey: 'market_not_listed' });
        });

        return { ok: true, data: rows };
      });
    },

    /** 계약 사양만 필요할 때. */
    instruments: function () {
      return market('/symbols', { timeoutMs: 20000 }).then(function (r) {
        return { ok: true, data: (r && r.symbols) || [] };
      });
    },

    ticker: function (symbol) {
      return market('/ticker?symbol=' + encodeURIComponent(symbol)).then(function (t) {
        var ui = toUiTicker(t);
        return ui ? { ok: true, data: ui } : { ok: false, data: null };
      });
    },

    orderbook: function (symbol, rows) {
      var depth = rows || 20;
      return market('/orderbook?symbol=' + encodeURIComponent(symbol) + '&depth=' + depth)
        .then(function (b) {
          var ui = toUiBook(b, depth);
          return ui ? { ok: true, data: ui } : { ok: false, data: null };
        });
    },

    trades: function (symbol, limit) {
      return market('/trades?symbol=' + encodeURIComponent(symbol) + '&limit=' + (limit || 60))
        .then(function (r) {
          return { ok: true, data: toUiTrades(r && r.trades) };
        });
    },

    candles: function (symbol, tf, limit) {
      return market(
        '/candles?symbol=' + encodeURIComponent(symbol) +
        '&timeframe=' + encodeURIComponent(normalizeTimeframe(tf)) +
        '&limit=' + (limit || 300),
        { timeoutMs: 25000 }
      ).then(function (r) {
        // 캔들은 차트가 Number() 로 변환하므로 문자열을 그대로 넘긴다.
        // 여기서 숫자로 바꾸면 정밀도가 한 번 더 깎인다.
        return { ok: true, data: (r && r.candles) || [] };
      });
    },
  };

  // ---------------------------------------------------------------
  // WebSocket 클라이언트
  // ---------------------------------------------------------------

  /**
   * 자동 재연결 WebSocket.
   *
   * - 재연결 시 구독을 자동 복원한다.
   * - 서버 pong 왕복시간으로 지연(latency)을 측정한다.
   * - 탭이 백그라운드로 가면 브라우저가 타이머를 늦추므로, visibilitychange 에서
   *   연결 상태를 확인하고 필요하면 즉시 재연결한다.
   */
  function createSocket(handlers) {
    handlers = handlers || {};

    var ws = null;
    var closedByUser = false;
    var attempts = 0;
    var reconnectTimer = null;
    var pingTimer = null;
    var lastPingAt = 0;
    var latencyMs = 0;
    var state = 'connecting';

    /** 구독 상태. 재연결 시 이 내용을 그대로 다시 보낸다. */
    var wantedSymbols = new Set();
    var wantedCandles = new Map(); // 'SYM|tf' -> {symbol, tf}

    function setState(next) {
      if (state === next) return;
      state = next;
      if (handlers.onState) handlers.onState(next);
    }

    function send(obj) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }

    function flushSubscriptions() {
      var symbols = Array.from(wantedSymbols);
      var candles = Array.from(wantedCandles.values()).map(function (c) {
        return { symbol: c.symbol, tf: c.tf };
      });
      if (symbols.length || candles.length) {
        send({ op: 'subscribe', symbols: symbols, candles: candles });
      }
    }

    function startPing() {
      stopPing();
      pingTimer = setInterval(function () {
        lastPingAt = Date.now();
        send({ op: 'ping' });
      }, 10000);
    }

    function stopPing() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
    }

    function scheduleReconnect() {
      if (closedByUser || reconnectTimer) return;
      attempts += 1;
      var delay = Math.min(15000, 500 * Math.pow(2, attempts - 1)) + Math.random() * 300;
      setState(attempts > 2 ? 'lost' : 'reconnecting');
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (closedByUser) return;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

      try {
        ws = new WebSocket(wsUrl());
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = function () {
        attempts = 0;
        setState('live');
        flushSubscriptions();
        startPing();
      };

      ws.onmessage = function (evt) {
        var msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }

        if (msg.ch === 'pong') {
          if (lastPingAt) latencyMs = Date.now() - lastPingAt;
          return;
        }
        if (msg.ch === 'connection') {
          // 업스트림(KuCoin) 연결 상태. 브라우저-서버 연결과 구분해서 전달한다.
          if (handlers.onUpstreamState) handlers.onUpstreamState(msg.data && msg.data.state);
          return;
        }
        if (handlers.onMessage) handlers.onMessage(msg.ch, msg.data);
      };

      ws.onclose = function () {
        stopPing();
        scheduleReconnect();
      };

      ws.onerror = function () {
        // onclose 가 이어서 호출되므로 여기서는 아무것도 하지 않는다.
      };
    }

    function subscribeSymbols(symbols) {
      var added = [];
      symbols.forEach(function (s) {
        var sym = String(s || '').toUpperCase();
        if (!sym || wantedSymbols.has(sym)) return;
        wantedSymbols.add(sym);
        added.push(sym);
      });
      if (added.length) send({ op: 'subscribe', symbols: added });
    }

    function unsubscribeSymbols(symbols) {
      var removed = [];
      symbols.forEach(function (s) {
        var sym = String(s || '').toUpperCase();
        if (!wantedSymbols.has(sym)) return;
        wantedSymbols.delete(sym);
        removed.push(sym);
      });
      if (removed.length) send({ op: 'unsubscribe', symbols: removed });
    }

    function subscribeCandles(symbol, tf) {
      var sym = String(symbol || '').toUpperCase();
      var key = sym + '|' + tf;
      if (wantedCandles.has(key)) return;
      wantedCandles.set(key, { symbol: sym, tf: tf });
      send({ op: 'subscribe', candles: [{ symbol: sym, tf: tf }] });
    }

    function unsubscribeCandles(symbol, tf) {
      var sym = String(symbol || '').toUpperCase();
      var key = sym + '|' + tf;
      if (!wantedCandles.has(key)) return;
      wantedCandles.delete(key);
      send({ op: 'unsubscribe', candles: [{ symbol: sym, tf: tf }] });
    }

    function close() {
      closedByUser = true;
      stopPing();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (ws) { try { ws.close(); } catch (e) { /* noop */ } }
      ws = null;
    }

    // 탭 복귀 시 끊긴 연결을 즉시 되살린다.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || closedByUser) return;
      if (!ws || ws.readyState > 1) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        attempts = 0;
        connect();
      }
    });

    return {
      connect: connect,
      close: close,
      subscribeSymbols: subscribeSymbols,
      unsubscribeSymbols: unsubscribeSymbols,
      subscribeCandles: subscribeCandles,
      unsubscribeCandles: unsubscribeCandles,
      getState: function () { return state; },
      getLatency: function () { return latencyMs; },
      isOpen: function () { return Boolean(ws && ws.readyState === 1); },
    };
  }

  // ---------------------------------------------------------------
  // 인증 (세션 쿠키 + CSRF)
  // ---------------------------------------------------------------

  /*
     백엔드 계약 (실측 확인)
     ---------------------
     · 세션은 HttpOnly 쿠키 `qt_session` 이다. JS 가 읽을 수 없다 —
       XSS 로 토큰이 탈취되는 경로를 없애기 위한 설계다.
     · 변경 계열 요청(POST/PATCH/DELETE)은 `x-csrf-token` 헤더가 없으면 403 이다.
       토큰은 로그인 응답과 GET /api/auth/csrf 로 받는다.
     · 등급(role)은 **서버가 주는 값만** 신뢰한다. localStorage 에 캐시된 등급으로
       권한을 판단하면 콘솔 한 줄로 관리자가 된다.
  */

  /** 서버가 준 CSRF 토큰. 메모리에만 둔다 (localStorage 에 넣으면 XSS 로 읽힌다). */
  var csrfToken = null;

  function setCsrf(v) {
    if (typeof v === 'string' && v) csrfToken = v;
  }

  /** 변경 계열 요청. CSRF 토큰이 없으면 먼저 받아온다. */
  function sendJSON(method, path, body, opts) {
    opts = opts || {};
    var attempt = function () {
      var headers = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || 15000);

      // path 는 '/api/auth/login' 처럼 완전한 경로로 받는다.
      // 접두사를 덧붙이면 '/api/api/...' 가 된다.
      return fetch(path, {
        method: method,
        headers: headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
        .then(function (res) {
          return res.text().then(function (text) {
            var json = null;
            try { json = JSON.parse(text); } catch (e) { /* 비JSON */ }
            if (json && json.csrfToken) setCsrf(json.csrfToken);
            if (!res.ok) {
              var err = new Error(
                (json && json.error && json.error.message) ||
                (json && json.message) ||
                ('HTTP ' + res.status)
              );
              err.status = res.status;
              err.code = (json && json.error && json.error.code) || (json && json.code);
              err.payload = json;
              // 필드별 검증 오류를 UI 가 쓸 수 있게 그대로 넘긴다.
              err.fields = (json && json.error && json.error.fields) || (json && json.fields) || null;
              throw err;
            }
            return json;
          });
        })
        .finally(function () { clearTimeout(timer); });
    };

    // 토큰이 없으면 한 번 받아온 뒤 재시도한다.
    if (!csrfToken && method !== 'GET') {
      return auth.csrf().then(attempt, attempt);
    }
    return attempt().catch(function (err) {
      // 세션은 살아있는데 CSRF 토큰이 만료된 경우가 있다. 한 번만 갱신 후 재시도한다.
      if (err && err.status === 403 && !opts.retried) {
        return auth.csrf().then(function () {
          return sendJSON(method, path, body, Object.assign({}, opts, { retried: true }));
        });
      }
      throw err;
    });
  }

  var auth = {
    /** CSRF 토큰 확보. 세션이 없으면 null 이 올 수 있다(정상). */
    csrf: function () {
      return getJSON('', '/api/auth/csrf')
        .then(function (r) { setCsrf(r && r.csrfToken); return r; })
        .catch(function () { return null; });
    },

    /**
     * 현재 로그인 사용자. 비로그인 시 401 이므로 null 을 돌려준다.
     * 등급 판정의 유일한 근거다.
     */
    /**
     * 현재 로그인 사용자. 등급 판정의 유일한 근거다.
     *
     * `/auth/session` 을 쓴다 — 비로그인도 200 이라 브라우저 콘솔에 401 이
     * 남지 않는다. `/auth/me` 는 권한 검사용이므로 여기서 쓰지 않는다.
     */
    me: function () {
      return getJSON('', '/api/auth/session')
        .then(function (r) { return (r && r.user) || null; })
        .catch(function (err) {
          // 구버전 백엔드 호환: /auth/session 이 없으면 /auth/me 로 떨어진다.
          if (err && err.status === 404) {
            return getJSON('', '/api/auth/me')
              .then(function (r) { return (r && r.user) || null; })
              .catch(function (e2) {
                if (e2 && e2.status === 401) return null;
                throw e2;
              });
          }
          if (err && err.status === 401) return null;
          throw err;
        });
    },

    register: function (email, password, extra) {
      var body = Object.assign({ email: email, password: password }, extra || {});
      return sendJSON('POST', '/api/auth/register', body);
    },

    /**
     * 로그인. MFA 가 켜진 계정은 여기서 완료되지 않고 추가 단계를 요구한다.
     * 그 경우 응답에 mfaRequired 계열 신호가 온다 — 호출자가 2단계 화면으로 넘긴다.
     */
    login: function (email, password) {
      return sendJSON('POST', '/api/auth/login', { email: email, password: password });
    },

    logout: function () {
      return sendJSON('POST', '/api/auth/logout').then(function (r) {
        csrfToken = null;
        return r;
      });
    },

    forgotPassword: function (email) {
      return sendJSON('POST', '/api/auth/forgot-password', { email: email });
    },

    resetPassword: function (token, password) {
      return sendJSON('POST', '/api/auth/reset-password', { token: token, password: password });
    },

    requestEmailVerify: function () {
      return sendJSON('POST', '/api/auth/verify-email/request');
    },

    verifyEmail: function (token) {
      return sendJSON('POST', '/api/auth/verify-email', { token: token });
    },

    changePassword: function (currentPassword, newPassword) {
      return sendJSON('POST', '/api/auth/change-password', {
        currentPassword: currentPassword,
        newPassword: newPassword,
      });
    },

    /** MFA 코드 검증. 엔드포인트는 mfa 라우터가 제공한다. */
    verifyMfa: function (code) {
      return sendJSON('POST', '/api/mfa/verify', { code: code });
    },
  };

  // ---------------------------------------------------------------
  // 주문 (검증 → 확인 2단계)
  // ---------------------------------------------------------------

  /*
     백엔드 계약 (실측 확인)
     ---------------------
     POST /api/sim/order-drafts
       요청  { symbol, side:'long'|'short', orderType, price, quantity, leverage, clientOrderId, ... }
       응답  { draftId, preview:{ positionValue, estFee, estLiquidationPrice, ... }, confirmationToken }

     POST /api/sim/orders/confirm
       요청  { draftId, clientOrderId, confirmationToken, userConfirmed:true }
       응답  { order:{ id, status, filledQuantity, events, ... } }

     확인 게이트가 두 겹이다: 토큰 일치 + userConfirmed 플래그.
     실수로 한 번 호출해서 주문이 나가는 것을 막는 설계다. 프론트가 이 둘을
     자동으로 채우면 게이트가 무의미해지므로, **사용자가 확인 버튼을 누른
     시점에만** userConfirmed 를 보낸다.

     side 표기: 디자이너 UI 는 'long'/'short' 를 쓰고 백엔드도 같다 — 변환 불필요.
     'buy'/'sell' 로 보내면 VALIDATION_FAILED 다 (실제로 확인했다).
  */

  /** 주문 고유 식별자. 같은 주문을 두 번 보내도 하나만 체결되게 하는 열쇠다. */
  function newClientOrderId() {
    var rand = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
    return 'qt-' + rand;
  }

  /** 백엔드가 요구하는 십진 문자열. 지수표기(1e-7)는 거부된다. */
  function decStr(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '0';
    // toFixed 로 지수표기를 피하고, 끝의 0 을 정리한다.
    var out = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    return out === '' || out === '-' ? '0' : out;
  }

  var orders = {
    /**
     * 1단계 — 주문 검증. 아직 주문이 나가지 않는다.
     * 수수료·청산가·필요증거금을 서버가 계산해 돌려준다.
     */
    createDraft: function (o) {
      var clientOrderId = o.clientOrderId || newClientOrderId();
      var body = {
        symbol: o.symbol,
        side: o.side === 'short' ? 'short' : 'long',
        orderType: String(o.orderType || o.type || 'limit').toLowerCase(),
        quantity: decStr(o.quantity !== undefined ? o.quantity : o.size),
        leverage: Number(o.leverage) || 1,
        clientOrderId: clientOrderId,
      };
      // 시장가에는 가격을 보내지 않는다. 보내면 "그 가격에 체결된다"는 오해를 만든다.
      if (body.orderType !== 'market' && (o.price !== undefined && o.price !== null)) {
        body.price = decStr(o.price);
      }
      if (o.reduceOnly) body.reduceOnly = true;
      if (o.postOnly) body.postOnly = true;
      if (o.tif) body.timeInForce = String(o.tif).toUpperCase();
      if (o.marginMode) body.marginMode = o.marginMode;

      return sendJSON('POST', '/api/sim/order-drafts', body).then(function (r) {
        return {
          ok: true,
          draftId: r && r.draftId,
          preview: (r && r.preview) || null,
          confirmationToken: r && r.confirmationToken,
          clientOrderId: clientOrderId,
        };
      });
    },

    /**
     * 2단계 — 사용자가 확인 버튼을 누른 뒤에만 호출한다.
     * userConfirmed 를 자동으로 붙이면 확인 게이트가 무의미해진다.
     */
    confirm: function (draft) {
      return sendJSON('POST', '/api/sim/orders/confirm', {
        draftId: draft.draftId,
        clientOrderId: draft.clientOrderId,
        confirmationToken: draft.confirmationToken,
        userConfirmed: true,
      }).then(function (r) {
        return { ok: true, order: (r && r.order) || null };
      });
    },

    /** 주문 목록. */
    list: function () {
      return getJSON('', '/api/sim/orders').then(function (r) {
        return { ok: true, data: (r && r.orders) || [] };
      });
    },
  };

  // ---------------------------------------------------------------
  // 거래소 자격증명 (API 키 연결)
  // ---------------------------------------------------------------

  /*
     백엔드 계약 (실측 확인)
     ---------------------
     POST   /api/trading/credentials            { accessKey, secretKey, memo, label }
            → 201 { id, accessKeyMasked, connectionStatus }
     POST   /api/trading/credentials/:id/verify
            → { id, connectionStatus:'VERIFIED'|'FAILED', permissionsVerified, reason? }
     DELETE /api/trading/credentials/:id        → { ok:true }

     필드 이름이 KuCoin 과 다르다. 저장 계약은 BitMart 시절 이름을 쓴다:
       accessKey → apiKey / secretKey → apiSecret / memo → passphrase
     변환을 화면 코드에 흩뿌리면 한 곳만 틀려도 서명이 조용히 깨진다.
     그래서 여기서만 바꾼다.

     ★ 응답에는 비밀값이 절대 오지 않는다. 마스킹된 키와 상태만 온다.
       화면에 비밀값을 다시 표시할 방법이 없는 것이 의도된 설계다.
  */

  var credentials = {
    /**
     * 자격증명 저장. 서버가 AES-256-GCM 봉투암호화로 보관한다.
     *
     * @param {{apiKey:string, apiSecret:string, passphrase?:string, label?:string}} c
     */
    save: function (c) {
      return sendJSON('POST', '/api/trading/credentials', {
        accessKey: c.apiKey,
        secretKey: c.apiSecret,
        // KuCoin 은 passphrase 가 필수다. 빈 값으로 보내면 서명이 성립하지 않는다.
        memo: c.passphrase || '',
        label: c.label || undefined,
      }).then(function (r) {
        return {
          ok: true,
          id: r && r.id,
          accessKeyMasked: r && r.accessKeyMasked,
          connectionStatus: r && r.connectionStatus,
        };
      });
    },

    /**
     * 저장된 키로 거래소에 실제 연결을 시도한다.
     *
     * 읽기 권한만으로 통과한다 — 주문 권한이 없는 키도 "연결됨"으로 확인된다.
     * 실패해도 예외를 던지지 않고 이유를 돌려준다: 잘못된 키와 네트워크 장애를
     * 구분하지 못하면 사용자가 멀쩡한 키를 지운다.
     */
    verify: function (id) {
      return sendJSON('POST', '/api/trading/credentials/' + encodeURIComponent(id) + '/verify')
        .then(function (r) {
          return {
            ok: (r && r.connectionStatus) === 'VERIFIED',
            status: r && r.connectionStatus,
            permissionsVerified: Boolean(r && r.permissionsVerified),
            reason: (r && r.reason) || null,
          };
        })
        .catch(function (err) {
          return { ok: false, status: 'FAILED', permissionsVerified: false, reason: (err && err.message) || null };
        });
    },

    remove: function (id) {
      return sendJSON('DELETE', '/api/trading/credentials/' + encodeURIComponent(id));
    },

    /*
       실 잔고·포지션.

       상태를 함께 넘긴다. 빈 배열만 돌려주면 호출자가 "잔고 0" 과
       "키를 연결하지 않음" 을 구분할 수 없고, 화면이 0 원을 표시하게 된다.
    */
    balances: function () {
      return getJSON('', '/api/trading/balances').then(function (r) {
        return {
          ok: true,
          data: (r && (r.balances || r.items)) || [],
          credentialStatus: (r && r.credentialStatus) || null,
          reason: (r && r.reason) || null,
          asOf: (r && r.asOf) || null,
        };
      });
    },

    positions: function () {
      return getJSON('', '/api/trading/positions').then(function (r) {
        return {
          ok: true,
          data: (r && (r.positions || r.items)) || [],
          credentialStatus: (r && r.credentialStatus) || null,
          reason: (r && r.reason) || null,
          asOf: (r && r.asOf) || null,
        };
      });
    },
  };

  window.QTApi = {
    rest: rest,
    createSocket: createSocket,
    wsUrl: wsUrl,
    MARKET_BASE: MARKET_BASE,
    V1_BASE: V1_BASE,
    // 변환기를 외부에 노출한다. WS 게이트웨이가 같은 정규 스키마를 보내므로
    // 프레임 처리에서 동일한 변환을 재사용해야 형식이 갈리지 않는다.
    convert: { book: toUiBook, trades: toUiTrades, ticker: toUiTicker, timeframe: normalizeTimeframe },
    auth: auth,
    orders: orders,
    credentials: credentials,
    /** 진단용. 토큰 값 자체는 노출하지 않는다. */
    hasCsrf: function () { return Boolean(csrfToken); },
  };
})();
