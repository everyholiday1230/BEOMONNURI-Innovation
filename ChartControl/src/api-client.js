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

  /*
     서버 설정 캐시.

     /api/config 는 부팅 시 한 번 오는 정적 정보다(모드·기본심볼·가입링크).
     화면 곳곳에서 필요하지만 매번 네트워크를 타면 안 되므로 여기 담아둔다.
     null = 아직 안 왔다. {} 로 초기화하지 않는다 — 값이 없는 것과
     아직 모르는 것을 구분해야 한다.
  */
  var serverConfig = null;

  /*
     설정 도착 알림.

     화면은 설정이 오기 전에 이미 렌더된다. 알리지 않으면 가입 링크가 있어도
     영원히 안 보인다(실제로 겪음 — 설정은 있는데 카드가 안 떴다).
     React 컴포넌트는 이 구독으로 재렌더한다.
  */
  var configListeners = new Set();
  function notifyConfig() {
    configListeners.forEach(function (fn) {
      try { fn(serverConfig); } catch (e) { /* 한 구독자의 예외가 나머지를 막지 않는다 */ }
    });
  }

  var rest = {
    /**
     * 백엔드 생존·모드 확인. 가장 가벼운 엔드포인트를 쓴다 —
     * 거래소가 죽어도 200 이 와야 "백엔드는 살아있음"을 구분할 수 있다.
     */
    status: function () {
      return getJSON('', '/api/config').then(function (cfg) {
        // 화면이 나중에 쓸 수 있게 원본을 보관하고 구독자에게 알린다.
        if (cfg && typeof cfg === 'object') { serverConfig = cfg; notifyConfig(); }
        return {
          ok: true,
          data: {
            dataMode: cfg && cfg.dataMode,
            source: cfg && cfg.marketDataSource,
            tradingMode: cfg && cfg.tradingMode,
            liveOrdersEnabled: !!(cfg && cfg.liveOrdersEnabled),
            defaultSymbol: cfg && cfg.defaultSymbol,
            timeframes: (cfg && cfg.timeframes) || [],
            exchangeSignupUrl: (cfg && cfg.exchangeSignupUrl) || '',
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
    /**
     * 거래소 카탈로그.
     *
     * ★★ 화면이 `window.QTApp.EXCHANGES`(디자이너 예시 9개)를 직접 읽고 있었다.
     *   그 목록은 어댑터가 없는 거래소까지 "연결 가능" 으로 보여준다 —
     *   사용자가 거래소에서 키를 만들어 등록하고, 아무것도 조회되지 않는
     *   이유를 알 수 없다. 서버가 실제 연결 가능 여부를 판정한다.
     *
     * @param {boolean} includeAll 미협약 거래소까지 받는다 (관리자 화면용)
     */
    exchanges: function (includeAll) {
      var qs = includeAll ? '?include=all' : '';
      return getJSON('', '/api/v1/exchanges' + qs).then(function (res) {
        var items = (res && res.items) || [];
        return {
          ok: true,
          data: {
            items: items,
            /* 감춘 개수. 화면이 "N개 준비 중" 을 말할 수 있다. */
            hiddenNotConnectable: (res && res.hiddenNotConnectable) || 0,
          },
        };
      });
    },

    /*
       차트 템플릿 (기기 간 동기화).

       ★★ 원래 `localStorage` 에만 저장했다. 집 PC 에서 만든 지표 조합이 사무실
         PC·휴대폰에서는 없었다 — 같은 계정으로 로그인했으면 따라오는 것이
         사용자 기대다.

       ★ 서버가 이 기능을 지원하지 않으면(SQLite 개발 환경) 404 가 온다.
         그때는 오류로 다루지 않고 `supported: false` 로 알려, 화면이 기존처럼
         기기 저장만 쓰게 한다 — 기능이 사라지는 대신 동기화만 빠진다.
    */
    chartTemplates: function () {
      return getJSON('', '/api/me/chart-templates')
        .then(function (r) {
          return { ok: true, supported: true, items: (r && r.items) || [], max: (r && r.max) || 0 };
        })
        .catch(function (err) {
          if (err && (err.status === 404 || err.status === 401)) {
            return { ok: false, supported: err.status !== 404, items: [] };
          }
          throw err;
        });
    },

    saveChartTemplate: function (tpl) {
      return sendJSON('PUT', '/api/me/chart-templates', tpl);
    },

    deleteChartTemplate: function (id) {
      return sendJSON('DELETE', '/api/me/chart-templates/' + encodeURIComponent(String(id)));
    },

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

    /**
     * 자산곡선 (일별 스냅샷).
     *
     * ★★ **빈 날을 채우지 않는다.** 접속하지 않은 날은 점이 없다. 화면이 점을
     *   직선으로 이으면 없었던 자산 변화를 그리게 되므로, `interpolated: false`
     *   를 보고 끊어 그릴지 판단해야 한다.
     *
     * ★ `canPlot` 이 서버 판정이다. 점이 1개면 선을 만들 수 없다 — 화면마다
     *   다른 기준을 쓰면 어느 한 곳이 빈 곡선을 그린다.
     *
     * ★ `source` 를 섞지 않는다. 'exchange'(실잔고) 와 'mock'(모의 거래)이
     *   한 곡선에 섞이면 모의 성과를 실제로 읽는다.
     */
    equityCurve: function (opts) {
      opts = opts || {};
      var qs = '?days=' + (opts.days || 30) + '&source=' + (opts.source || 'exchange');
      return getJSON('', '/api/portfolio/equity-curve' + qs).then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          points: (r && r.points) || [],
          canPlot: Boolean(r && r.canPlot),
          history: (r && r.history) || { points: 0, firstDate: null, lastDate: null },
          source: (r && r.source) || 'exchange',
          interpolated: Boolean(r && r.interpolated),
        };
      });
    },

    /*
       ---- 우리 DB 의 거래 기록 (모의 포함) ----

       ★★ 왜 별도 경로인가

         `/api/trading/*` 는 **거래소에 직접 물어본다** — 사용자가 등록한 API 키가
         검증돼야 답이 온다. 그런데 모의 주문은 거래소로 나가지 않고 우리 DB 에만
         기록된다. 그래서 키가 없어도 볼 수 있어야 한다.

         전에는 이 경로를 읽는 화면이 하나도 없었다. 모의 주문이 DB 에 정확히
         저장되는데도 `/order-history` 와 `/portfolio` 는 목업을 보여줬다 —
         사용자는 주문이 실패한 줄 안다.

       ★ 응답의 `mode` 가 'MOCK' 이면 모의 체결이다. 화면이 그것을 표시해야
         실제 체결로 오인되지 않는다.
    */

    /** 우리 DB 에 남은 주문 이력. 거래소 키 없이도 동작한다. */
    localOrders: function (opts) {
      opts = opts || {};
      var qs = '?limit=' + (opts.limit || 50);
      if (opts.symbol) qs += '&symbol=' + encodeURIComponent(opts.symbol);
      return getJSON('', '/api/orders/history' + qs).then(function (r) {
        return {
          ok: true,
          items: (r && r.items) || [],
          total: (r && r.page && r.page.total) || 0,
          source: (r && r.source) || null,
        };
      });
    },

    /** 우리 DB 에 남은 미체결 주문. */
    localOpenOrders: function (opts) {
      opts = opts || {};
      return getJSON('', '/api/orders/open?limit=' + (opts.limit || 50)).then(function (r) {
        return { ok: true, items: (r && r.items) || [], total: (r && r.page && r.page.total) || 0 };
      });
    },

    /** 우리 DB 에 남은 포지션. */
    localPositions: function () {
      return getJSON('', '/api/positions').then(function (r) {
        return {
          ok: true,
          items: (r && r.items) || [],
          total: (r && r.page && r.page.total) || 0,
          source: (r && r.source) || null,
        };
      });
    },

    /** 우리 DB 에 남은 체결. */
    localTrades: function (opts) {
      opts = opts || {};
      return getJSON('', '/api/trades?limit=' + (opts.limit || 50)).then(function (r) {
        return { ok: true, items: (r && r.items) || [], total: (r && r.page && r.page.total) || 0 };
      });
    },

    /**
     * 내가 등록한 거래소 키 목록.
     *
     * ★ 비밀키는 오지 않는다 — 마스킹된 접근키와 검증 상태만 온다.
     * ★ `permissions` 는 항상 빈 배열이다. 거래소 키의 권한을 우리가 알 수
     *   없으므로 지어내지 않는다. 화면이 '확인되지 않음' 으로 표시한다.
     */
    exchangeKeys: function () {
      return getJSON('', '/api/trading/credentials').then(function (r) {
        return { ok: true, items: (r && r.items) || [], exchange: (r && r.exchange) || null };
      });
    },

    /*
       ---- 즐겨찾기 (기기 간 동기화) ----

       ★ localStorage 만 쓰면 기기별로 갈린다. 휴대폰에서 등록하고 컴퓨터에서
         열면 비어 보이고, 사용자는 사라졌다고 생각한다. 서버에 저장 경로가
         이미 있었는데 화면이 부르지 않아 테이블이 비어 있었다.
    */

    favorites: function () {
      return getJSON('', '/api/me/favorites').then(function (r) {
        return {
          ok: true,
          symbols: (r && r.symbols) || [],
          version: (r && r.version) || 0,
          maxFavorites: (r && r.maxFavorites) || null,
        };
      });
    },

    /** 목록 전체를 보낸다 (덮어쓰기). 서버가 상한을 검사한다. */
    saveFavorites: function (symbols) {
      return sendJSON('PUT', '/api/me/favorites', { symbols: symbols || [] });
    },

    /*
       ---- 서버 알림 ----

       ★ 서버가 만드는 알림이다(주문 체결 · 문의 답변 · 포인트 변동).
         클라이언트가 계산하는 청산 경고(QTRisk)와는 다른 출처다.

       ★ 전에는 이 경로를 읽는 화면이 없었다. 서버는 알림을 만들어 저장하는데
         사용자는 볼 수 없는 상태였다 — 답변을 달아도 문의한 사람이 모른다.
    */
    notifications: function (opts) {
      opts = opts || {};
      var qs = '?limit=' + (opts.limit || 50);
      if (opts.unreadOnly) qs += '&unreadOnly=true';
      return getJSON('', '/api/notifications' + qs).then(function (r) {
        return {
          ok: true,
          items: (r && r.items) || [],
          unreadCount: (r && r.unreadCount) || 0,
        };
      });
    },

    /** 읽음 표시. 목록을 다시 불러오지 않아도 되게 결과만 돌려준다. */
    markNotificationRead: function (id) {
      return sendJSON('POST', '/api/notifications/' + encodeURIComponent(id) + '/read', {});
    },

    markAllNotificationsRead: function () {
      return sendJSON('POST', '/api/notifications/read-all', {});
    },

    // ---- 법적 문서 ----

    /**
     * 약관·개인정보처리방침·위험고지·보안 안내.
     *
     * ★ 인증 없이 호출한다 — 회원가입 전에 읽어야 한다.
     * ★ 게시되지 않아도 200 + available:false 로 온다. 404 로 다루면 링크가
     *   깨진 것처럼 보이고 콘솔이 오염된다.
     */
    legal: function (kind) {
      var loc = (window.QTI18n && window.QTI18n.getLocale) ? window.QTI18n.getLocale() : 'en';
      return getJSON('', '/api/legal/' + encodeURIComponent(kind) + '?locale=' + encodeURIComponent(loc))
        .then(function (r) {
          return {
            available: Boolean(r && r.available),
            reason: (r && r.reason) || null,
            kind: (r && r.kind) || kind,
            locale: (r && r.locale) || loc,
            requestedLocale: (r && r.requestedLocale) || loc,
            version: (r && r.version) || null,
            title: (r && r.title) || null,
            body: (r && r.body) || '',
            effectiveAt: (r && r.effectiveAt) || null,
            publishedAt: (r && r.publishedAt) || null,
            supportEmail: (r && r.supportEmail) || null,
          };
        });
    },

    /**
     * 게시된 문서 목록.
     *
     * 회원가입 화면이 "동의 대상이 실제로 존재하는가" 를 확인하는 데 쓴다.
     * 없는데 동의를 받으면 그 동의는 의미가 없다.
     */
    legalIndex: function () {
      return getJSON('', '/api/legal').then(function (r) {
        return { available: Boolean(r && r.available), documents: (r && r.documents) || [] };
      });
    },

    // ---- 포인트 ----

    /**
     * 내 포인트 — 잔액·내역·상품·이용권.
     *
     * ★ 응답의 `disclosures` 를 화면이 반드시 표시해야 한다:
     *     cashConvertible:false — 현금으로 바꿀 수 없다
     *     withdrawable:false    — 출금할 수 없다
     *   이 사실을 감추면 사용자가 적립된 포인트를 인출하려 하고, 안 된다는
     *   것을 나중에 알게 된다.
     *
     * ★ `settings.purchaseAvailable` 이 구매 버튼 표시의 유일한 근거다.
     *   설정값(purchaseEnabledInSettings)만 보고 버튼을 띄우면, 결제 대행사가
     *   없는 상태에서 사용자가 돈을 보낼 방법을 찾는다.
     */
    points: function () {
      return getJSON('', '/api/points/me').then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          enabled: Boolean(r && r.enabled),
          settings: (r && r.settings) || null,
          balance: (r && typeof r.balance === 'number') ? r.balance : null,
          entitlements: (r && r.entitlements) || {},
          catalog: (r && r.catalog) || [],
          history: (r && r.history) || [],
          redemptions: (r && r.redemptions) || [],
          disclosures: (r && r.disclosures) || { cashConvertible: false, withdrawable: false, usableOnlyInApp: true },
        };
      });
    },

    /**
     * 이용권 소비 (AI 분석 실행 등).
     *
     * 서버가 이용권을 1회 차감한다. false 면 남은 이용권이 없다 —
     * 그때 기능을 실행해서는 안 된다(무료로 제공하는 셈이 된다).
     */
    consumeEntitlement: function (itemId) {
      return sendJSON('POST', '/api/points/consume', { itemId: itemId })
        .then(function (r) { return { ok: true, consumed: Boolean(r && r.consumed), remaining: r && r.remaining }; });
    },

    /**
     * 상품 사용.
     *
     * 잔액 부족은 402 로 온다 — 400(잘못된 요청)과 다르게 안내해야 한다.
     * 요청은 올바르고 잔액이 모자란 것이다.
     */
    redeemPoints: function (itemId) {
      return sendJSON('POST', '/api/points/redeem', { itemId: itemId });
    },

    // ---- 친구 초대 (리퍼럴) ----

    /**
     * 내 초대 현황.
     *
     * ★ 응답의 `disclosures` 를 화면이 반드시 표시해야 한다:
     *     accrualComputed:false — 적립 예정액을 우리가 계산하지 않는다
     *     autoPayout:false      — 자동 지급하지 않는다
     *   이 두 사실을 감추면 사용자는 잔액이 쌓이고 자동 입금될 것으로 기대한다.
     *
     * enabled:false 면 코드가 없다. 그때 코드를 만들어 보여주면 안 된다 —
     * 사용자가 공유하고 보상을 기다린다.
     */
    referral: function () {
      return getJSON('', '/api/referral/me').then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          enabled: Boolean(r && r.enabled),
          code: (r && r.code) || null,
          link: (r && r.link) || null,
          settings: (r && r.settings) || null,
          summary: (r && r.summary) || null,
          signups: (r && r.signups) || [],
          payouts: (r && r.payouts) || [],
          disclosures: (r && r.disclosures) || { accrualComputed: false, autoPayout: false },
        };
      });
    },

    /** 코드 유효성 확인 (가입 화면). 인증 불필요. */
    referralCheck: function (code) {
      return getJSON('', '/api/referral/check?code=' + encodeURIComponent(code)).then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          enabled: Boolean(r && r.enabled),
          valid: Boolean(r && r.valid),
          sharePct: r && r.sharePct,
        };
      });
    },

    // ---- 전략 ----

    /**
     * 전략 목록 + 백테스트 지표.
     *
     * ★ metrics 의 null 은 0 이 아니라 **미실행**이다. 0 으로 바꾸면
     *   "수익률 0%" 로 읽히고, 실행하지 않은 것과 실행했는데 성과가 없는 것이
     *   구분되지 않는다. 서버가 metricsNote 로 이 사실을 함께 보낸다.
     *
     * unavailable 은 이 배포에 없는 기능 목록이다(구독 등급·사용자 작성 전략·
     * 실거래 실적). 화면이 그 항목을 감추는 근거로 쓴다.
     */
    strategies: function (params) {
      var q = [];
      if (params && params.symbol) q.push('symbol=' + encodeURIComponent(params.symbol));
      if (params && params.timeframe) q.push('timeframe=' + encodeURIComponent(params.timeframe));
      return getJSON('', '/api/strategies' + (q.length ? '?' + q.join('&') : ''), { timeoutMs: 25000 })
        .then(function (r) {
          return {
            ok: true,
            data: (r && r.items) || [],
            symbol: r && r.symbol,
            timeframe: r && r.timeframe,
            dataSource: r && r.dataSource,
            metricsNote: r && r.metricsNote,
            caveats: (r && r.caveats) || [],
            unavailable: (r && r.unavailable) || [],
          };
        });
    },

    /** 전략 하나. */
    strategy: function (id, params) {
      var q = [];
      if (params && params.symbol) q.push('symbol=' + encodeURIComponent(params.symbol));
      if (params && params.timeframe) q.push('timeframe=' + encodeURIComponent(params.timeframe));
      return getJSON('', '/api/strategies/' + encodeURIComponent(id) + (q.length ? '?' + q.join('&') : ''),
        { timeoutMs: 25000 }).then(function (r) { return { ok: true, data: r }; });
    },

    /** 백테스트 실행. 계산에 시간이 걸리므로 타임아웃을 넉넉히 준다. */
    backtest: function (id, body) {
      return sendJSON('POST', '/api/strategies/' + encodeURIComponent(id) + '/backtest', body || {},
        { timeoutMs: 60000 });
    },

    /**
     * 내가 팔로우한 전략.
     *
     * 서버가 autoExecution:false 와 설명을 함께 준다 — 팔로우는 관심 등록이고
     * 신호를 자동 실행하지 않는다. 화면이 그 사실을 반드시 표시해야 한다:
     * "자동 복제" 로 오해하면 사용자가 주문이 나갈 줄 알고 기다린다.
     *
     * 각 항목의 `id` 는 팔로우 레코드 ID 다(전략 ID 가 아니다). 해제할 때
     * 그 값이 필요하므로 함께 돌려준다.
     */
    myStrategies: function () {
      return getJSON('', '/api/strategies/mine').then(function (r) {
        return {
          ok: true,
          data: (r && r.items) || [],
          autoExecution: Boolean(r && r.autoExecution),
          note: (r && r.note) || '',
        };
      });
    },

    /**
     * 팔로우 등록.
     *
     * symbol·timeframe 이 필수다 — 같은 전략을 다른 심볼·주기로 따로
     * 팔로우할 수 있고, 서버가 그 조합으로 기록한다. 생략하면 400 이다.
     */
    followStrategy: function (id, symbol, timeframe) {
      return sendJSON('POST', '/api/strategies/follow', {
        strategyId: id,
        symbol: symbol,
        timeframe: timeframe,
      });
    },

    /** 팔로우 해제. 전략 ID 가 아니라 **팔로우 레코드 ID** 가 필요하다. */
    unfollowStrategy: function (followId) {
      return sendJSON('DELETE', '/api/strategies/follow/' + encodeURIComponent(followId));
    },

    /** 내 문의 목록. */
    supportTickets: function () {
      return getJSON('', '/api/support/tickets').then(function (r) {
        return { ok: true, data: (r && r.tickets) || [], supported: !(r && r.supported === false) };
      });
    },

    /** 내 문의 상세. 내부 메모는 서버가 제외한다. */
    supportTicket: function (id) {
      return getJSON('', '/api/support/tickets/' + encodeURIComponent(id)).then(function (r) {
        return { ok: true, ticket: r && r.ticket, messages: (r && r.messages) || [] };
      });
    },

    /** 새 문의 접수. */
    createSupportTicket: function (input) {
      return sendJSON('POST', '/api/support/tickets', input || {});
    },

    /** 내 문의에 답글. */
    replySupportTicket: function (id, body) {
      return sendJSON('POST', '/api/support/tickets/' + encodeURIComponent(id) + '/reply', { body: body });
    },

    /**
     * 공지 (사용자용). 게시되고 기간 안에 있는 것만 돌아온다.
     * 인증이 필요 없다 — 점검 공지는 로그인 못 하는 상황에서도 보여야 한다.
     */
    notices: function (locale) {
      return getJSON('', '/api/notices' + (locale ? '?locale=' + encodeURIComponent(locale) : ''))
        .then(function (r) {
          return { ok: true, data: (r && r.notices) || [], supported: Boolean(r && r.supported) };
        });
    },

    /**
     * 계약 사양 — 수수료율·증거금률·승수.
     *
     * ★ 수수료율은 거래소 **기본값**이다. 사용자별 VIP 할인은 반영되지 않는다.
     *   "고객이 실제로 내는 수수료" 로 표시하면 안 된다.
     */
    contractSpecs: function (symbols) {
      var q = symbols && symbols.length ? '?symbols=' + symbols.join(',') : '';
      return market('/contract-specs' + q, { timeoutMs: 20000 }).then(function (r) {
        return {
          ok: true,
          data: (r && r.specs) || [],
          supported: Boolean(r && r.supported),
        };
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
      // 멱등성 키처럼 요청별로 필요한 헤더를 받는다.
      if (opts.headers) {
        Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
      }

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

    /**
     * 주문 취소. clientOrderId 로 부른다.
     *
     * 거래소 내부 orderId 를 화면이 들고 다니지 않는다 — 거래소를 바꾸면
     * 전부 깨진다. 서버가 조회해서 변환한다.
     */
    cancel: function (symbol, clientOrderId) {
      return sendJSON('POST', '/api/trading/orders/cancel', {
        symbol: symbol,
        clientOrderId: clientOrderId,
      }).then(function (r) {
        return { ok: Boolean(r && r.canceled), reason: (r && r.reason) || null };
      });
    },

    /**
     * 한 심볼의 미체결 전체 취소.
     *
     * 되돌릴 수 없으므로 서버가 confirm 을 요구한다. 호출자가 사용자 확인을
     * 받은 뒤에만 이 함수를 부른다 — 자동으로 confirm 을 넣으면 게이트가 무의미하다.
     */
    cancelAll: function (symbol) {
      return sendJSON('POST', '/api/trading/orders/cancel-all', {
        symbol: symbol,
        confirm: true,
      }).then(function (r) {
        return { ok: true, canceled: (r && r.canceled) || [], count: (r && r.count) || 0 };
      });
    },

    /**
     * 실주문 제출 — 거래소로 나가는 경로.
     *
     * 시뮬레이션(createDraft/confirm)과 **다른 엔드포인트**다. 하나로 합치면
     * 모드 판단이 틀렸을 때 모의 주문이 실주문으로 나간다.
     *
     * Idempotency-Key 를 반드시 보낸다. 재시도로 주문이 두 번 나가는 것을 막는
     * 유일한 장치이고, 서버가 이 값을 clientOrderId 로 쓴다.
     *
     * @returns transmitted 가 true 일 때만 실제로 거래소에 접수됐다.
     *          SUBMIT_UNKNOWN 이면 접수 여부를 **알 수 없다** — 재시도하지 말고
     *          미체결 목록을 조회해 확인해야 한다.
     */
    submitLive: function (o) {
      var key = o.idempotencyKey || newClientOrderId();
      var body = {
        symbol: o.symbol,
        side: o.side === 'short' ? 'short' : 'long',
        orderType: String(o.orderType || o.type || 'limit').toLowerCase(),
        quantity: decStr(o.quantity !== undefined ? o.quantity : o.size),
        leverage: Number(o.leverage) || 1,
        marginMode: o.marginMode === 'cross' ? 'cross' : 'isolated',
        // 서버가 명시적 확인을 요구한다. 사용자가 확인 버튼을 누른 시점에만 보낸다.
        confirmationToken: o.confirmationToken || '',
      };
      if (body.orderType !== 'market' && o.price !== undefined && o.price !== null) {
        body.price = decStr(o.price);
      }
      if (o.reduceOnly) body.reduceOnly = true;

      return sendJSON('POST', '/api/trading/orders/submit', body, {
        headers: { 'idempotency-key': key },
      }).then(function (r) {
        return {
          ok: Boolean(r && r.transmitted),
          outcome: (r && r.outcome) || null,
          order: (r && r.order) || null,
          // 차단 사유. 화면이 "왜 안 됐는지" 를 보여줘야 한다.
          reasons: (r && r.reasons) || [],
          gates: (r && r.gates) || [],
          reconcile: (r && r.reconcile) || null,
          brokerAttached: Boolean(r && r.brokerAttached),
          idempotencyKey: key,
        };
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

  /**
   * 목록 응답을 공통 봉투로 감싼다.
   *
   * 상태(credentialStatus)를 반드시 함께 넘긴다. 빈 배열만 돌려주면 호출자가
   * "없음" 과 "확인 불가" 를 구분할 수 없고, 화면이 "주문 없음" 을 표시하게 된다.
   */
  function wrapList(key) {
    return function (r) {
      return {
        ok: true,
        data: (r && (r[key] || r.items)) || [],
        credentialStatus: (r && r.credentialStatus) || null,
        reason: (r && r.reason) || null,
        asOf: (r && r.asOf) || null,
      };
    };
  }

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

    /*
       주문·체결·자금이동 조회.
       봉투 형태를 잔고·포지션과 똑같이 맞춘다 — 호출자가 상태 판단을
       한 가지 방식으로만 하면 되기 때문이다.
    */
    openOrders: function (symbol) {
      var q = symbol ? '?symbol=' + encodeURIComponent(symbol) : '';
      return getJSON('', '/api/trading/open-orders' + q).then(wrapList('orders'));
    },

    orderHistory: function (symbol) {
      var q = symbol ? '?symbol=' + encodeURIComponent(symbol) : '';
      return getJSON('', '/api/trading/order-history' + q).then(wrapList('orders'));
    },

    fills: function (symbol) {
      var q = symbol ? '?symbol=' + encodeURIComponent(symbol) : '';
      return getJSON('', '/api/trading/fills' + q).then(wrapList('fills'));
    },

    transactions: function (symbol) {
      var q = symbol ? '?symbol=' + encodeURIComponent(symbol) : '';
      return getJSON('', '/api/trading/transactions' + q).then(wrapList('transactions'));
    },
  };

  // ---------------------------------------------------------------
  // 관리자 (등급 검사는 서버가 한다)
  // ---------------------------------------------------------------

  /*
     ★ 화면에서 메뉴를 숨기는 것은 보안이 아니다.
     아래 호출은 모두 서버가 401/403 으로 막는다. 권한 없는 사용자가 직접
     호출하면 거부되고, 그게 실제 방어선이다(packages/admin-domain 권한 집합).

     그래서 여기서 등급을 검사하지 않는다 — 두 곳에서 검사하면 어긋나고,
     화면 검사를 통과했다는 이유로 서버 검사를 느슨하게 만들 위험이 생긴다.
  */
  var admin = {
    /** 대시보드 요약. 사용자 수·거래소 상태·리스크 게이트. */
    overview: function () {
      return getJSON('', '/api/admin/overview').then(function (r) { return { ok: true, data: r }; });
    },

    /** 사용자 목록. 검색·상태 필터를 서버가 처리한다. */
    users: function (opts) {
      opts = opts || {};
      var q = [];
      if (opts.search) q.push('search=' + encodeURIComponent(opts.search));
      if (opts.status) q.push('status=' + encodeURIComponent(opts.status));
      if (opts.limit) q.push('limit=' + opts.limit);
      return getJSON('', '/api/admin/users' + (q.length ? '?' + q.join('&') : ''))
        .then(function (r) {
          return { ok: true, data: (r && r.users) || [], total: (r && r.total) || 0 };
        });
    },

    user: function (id) {
      return getJSON('', '/api/admin/users/' + encodeURIComponent(id))
        .then(function (r) { return { ok: true, data: r }; });
    },

    /*
       사용자 상태 변경.

       되돌릴 수 있는 작업이지만 사용자에게는 즉시 영향이 간다(로그인 차단).
       그래서 이유(reason)를 함께 보낸다 — 감사 로그에 남아야 나중에
       "누가 왜" 를 확인할 수 있다.
    */
    disableUser: function (id, reason) {
      return sendJSON('POST', '/api/admin/users/' + encodeURIComponent(id) + '/disable', { reason: reason || '' });
    },

    enableUser: function (id, reason) {
      return sendJSON('POST', '/api/admin/users/' + encodeURIComponent(id) + '/enable', { reason: reason || '' });
    },

    /** 세션 강제 종료. 계정 탈취 대응에 쓴다. */
    revokeSessions: function (id, reason) {
      return sendJSON('POST', '/api/admin/users/' + encodeURIComponent(id) + '/revoke-sessions', { reason: reason || '' });
    },

    /**
     * 전체 주문 (읽기 전용).
     *
     * 서버가 readOnly·note 를 함께 준다. 화면이 그 사실을 표시해야 한다 —
     * 관리자가 취소 버튼을 찾다가 없어서 "고장" 으로 오해하지 않게.
     */
    orders: function (params) {
      var q = [];
      if (params && params.limit) q.push('limit=' + params.limit);
      if (params && params.symbol) q.push('symbol=' + encodeURIComponent(params.symbol));
      return getJSON('', '/api/admin/orders' + (q.length ? '?' + q.join('&') : ''))
        .then(function (r) {
          return {
            ok: true,
            data: (r && r.orders) || [],
            total: (r && r.total) || 0,
            readOnly: Boolean(r && r.readOnly),
            note: (r && r.note) || '',
          };
        });
    },

    /** 전체 포지션 (읽기 전용). */
    positions: function (params) {
      var q = [];
      if (params && params.limit) q.push('limit=' + params.limit);
      return getJSON('', '/api/admin/positions' + (q.length ? '?' + q.join('&') : ''))
        .then(function (r) {
          return {
            ok: true,
            data: (r && r.positions) || [],
            total: (r && r.total) || 0,
            readOnly: Boolean(r && r.readOnly),
            note: (r && r.note) || '',
          };
        });
    },

    /** 보안 요약 — 사용자·세션·MFA·잠금 집계. */
    securitySummary: function () {
      return getJSON('', '/api/admin/security/summary').then(function (r) { return { ok: true, data: r }; });
    },

    /** 사건(인시던트) 목록. */
    incidents: function () {
      return getJSON('', '/api/admin/incidents').then(function (r) {
        return { ok: true, data: (r && r.incidents) || [] };
      });
    },

    /** 릴리스 게이트 — 운영 배포 전 통과해야 하는 항목. */
    releaseGates: function () {
      return getJSON('', '/api/admin/release-gates').then(function (r) {
        return { ok: true, data: (r && r.gates) || [] };
      });
    },

    /**
     * 브로커 리베이트.
     *
     * 설정이 없으면 서버가 503 + configured:false 를 준다. 그것을 오류로
     * 던지지 않고 상태로 돌려준다 — "설정 안 됨" 은 장애가 아니라 사실이다.
     */
    brokerRebates: function () {
      return getJSON('', '/api/admin/broker/rebates').then(function (r) {
        /*
           설정 여부는 `configured` 플래그로만 판단한다.

           빈 배열을 "리베이트 0원" 으로 읽으면 안 된다 — 설정을 안 해서
           조회조차 못 한 상태와, 조회했는데 정말 0원인 상태는 다르다.
           앞은 설정을 하면 수익이 생기고, 뒤는 영업 문제다.
        */
        var configured = !(r && r.configured === false);
        return { ok: true, configured: configured, data: (r && r.rebates) || [] };
      });
    },

    /*
       ---- KuCoin 브로커 정산 (운영) ----

       ★★ 이것이 **우리 수익을 확인하는 유일한 경로**다.

         주문에 브로커 서명을 붙였다는 것은 우리 쪽 주장이고, 실제로 집계됐는지는
         거래소만 안다. 응답의 `...WithTag` 가 그 판정이다.

       ★ 세 가지 상태를 구분해서 화면에 알려야 한다:
           configured: false  → 운영자 키가 설정되지 않음 (수익 0원이 아니다)
           approved: false    → 키는 있으나 브로커로 승인되지 않음
           brokerAttached: false → 승인됐지만 서명 헤더 3종이 없음 → 앞으로도 집계 안 됨
    */

    brokerCommission: function (opts) {
      opts = opts || {};
      return getJSON('', '/api/admin/broker/kucoin/commission?page=' + (opts.page || 1)
        + '&pageSize=' + (opts.pageSize || 50)).then(function (r) {
        return {
          ok: true,
          configured: !(r && r.configured === false),
          approved: !(r && r.approved === false),
          brokerAttached: Boolean(r && r.brokerAttached),
          items: (r && r.items) || [],
          totalNum: (r && r.totalNum) || 0,
          error: (r && r.error) || null,
        };
      });
    },

    brokerUsers: function (opts) {
      opts = opts || {};
      return getJSON('', '/api/admin/broker/kucoin/users?page=' + (opts.page || 1)
        + '&pageSize=' + (opts.pageSize || 50)).then(function (r) {
        return {
          ok: true,
          configured: !(r && r.configured === false),
          approved: !(r && r.approved === false),
          items: (r && r.items) || [],
          totalNum: (r && r.totalNum) || 0,
          error: (r && r.error) || null,
        };
      });
    },

    /**
     * 리베이트 원장 CSV 링크.
     *
     * ★ 서버가 파일을 대신 받지 않는다. 이 CSV 에는 거래자 UID 가 있어서
     *   사본을 만들면 그것을 지킬 책임이 생긴다. 링크를 받아 즉시 연다.
     * ★ 날짜는 YYYYMMDD 다 (ISO 를 보내면 조용히 빈 결과가 된다).
     */
    brokerRebateCsv: function (begin, end, tradeType) {
      var qs = '?begin=' + encodeURIComponent(begin) + '&end=' + encodeURIComponent(end);
      if (tradeType) qs += '&tradeType=' + encodeURIComponent(tradeType);
      return getJSON('', '/api/admin/broker/kucoin/rebate-csv' + qs).then(function (r) {
        return {
          ok: true,
          configured: !(r && r.configured === false),
          approved: !(r && r.approved === false),
          url: (r && r.url) || null,
          error: (r && r.error) || null,
        };
      });
    },

    // ---- 법적 문서 (운영) ----

    legal: function () {
      return getJSON('', '/api/admin/legal').then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          documents: (r && r.documents) || [],
          published: (r && r.published) || [],
          readiness: (r && r.readiness) || null,
        };
      });
    },

    createLegalDraft: function (input) {
      return sendJSON('POST', '/api/admin/legal/draft', input || {});
    },

    updateLegalDraft: function (id, input) {
      return sendJSON('POST', '/api/admin/legal/' + encodeURIComponent(id), input || {});
    },

    /** 게시. 되돌릴 수 없다 — 이미 본 사람이 있을 수 있다. */
    publishLegal: function (id) {
      return sendJSON('POST', '/api/admin/legal/' + encodeURIComponent(id) + '/publish', {});
    },

    // ---- 포인트 (운영) ----

    /** 제도 조건 + 부채 집계 + 상품 + 원장 정합성. */
    points: function () {
      return getJSON('', '/api/admin/points').then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          settings: (r && r.settings) || null,
          totals: (r && r.totals) || null,
          catalog: (r && r.catalog) || [],
          integrity: (r && r.integrity) || null,
        };
      });
    },

    setPointSettings: function (input) {
      return sendJSON('POST', '/api/admin/points/settings', input || {});
    },

    upsertPointItem: function (item) {
      return sendJSON('POST', '/api/admin/points/catalog', item || {});
    },

    /**
     * 수동 지급·회수.
     *
     * ★ memo 가 필수다 — 이유 없는 조정은 나중에 검증할 수 없다.
     *   회수는 삭제가 아니라 반대 항목 추가다(원장은 추가만 한다).
     */
    adjustPoints: function (input) {
      return sendJSON('POST', '/api/admin/points/adjust', input || {});
    },

    /** 특정 사용자의 원장 (고객 문의 응대용). */
    pointsOf: function (userId) {
      return getJSON('', '/api/admin/points/' + encodeURIComponent(userId))
        .then(function (r) { return { ok: true, data: r }; });
    },

    // ---- 리퍼럴 (운영) ----

    /** 제도 조건 + 초대자 목록. */
    referral: function (limit) {
      return getJSON('', '/api/admin/referral' + (limit ? '?limit=' + limit : '')).then(function (r) {
        return {
          ok: true,
          supported: !(r && r.supported === false),
          settings: (r && r.settings) || null,
          referrers: (r && r.referrers) || [],
        };
      });
    },

    /**
     * 조건 변경.
     *
     * 서버가 검증한다: 제도를 켜려면 payoutNote 와 sharePct>0 이 필요하다.
     * 지급 방법을 밝히지 않고 켜면 사용자가 자동 입금을 기대한다.
     */
    setReferralSettings: function (input) {
      return sendJSON('POST', '/api/admin/referral/settings', input || {});
    },

    /**
     * 지급 기록.
     *
     * ★ 실제로 보낸 뒤에만 입력한다. 이 기록이 "보냈다" 는 유일한 근거다.
     *   method 는 필수 — 근거 없는 기록은 나중에 검증할 수 없다.
     */
    recordReferralPayout: function (input) {
      return sendJSON('POST', '/api/admin/referral/payouts', input || {});
    },

    /** 특정 초대자 상세. */
    referralDetail: function (userId) {
      return getJSON('', '/api/admin/referral/' + encodeURIComponent(userId))
        .then(function (r) { return { ok: true, data: r }; });
    },

    // ---- AI 운영 ----

    /**
     * AI 정책. 프롬프트 원문과 자격증명은 서버가 절대 반환하지 않는다
     * (digest 만 온다). 화면이 원문을 기대하면 안 된다.
     */
    aiPolicy: function () {
      return getJSON('', '/api/admin/ai/policy').then(function (r) { return { ok: true, data: r }; });
    },

    /**
     * AI 사용량. provider='unavailable' 이면 실행 자체가 없었다는 뜻이다 —
     * 토큰 0 이 아니라 "미실행" 이다. summary 의 null 을 0 으로 바꾸면
     * 그 구분이 사라진다.
     */
    aiUsage: function () {
      return getJSON('', '/api/admin/ai/usage').then(function (r) { return { ok: true, data: r }; });
    },

    // ---- 고객 지원 티켓 (운영자) ----

    /** 티켓 목록 + 상태별 건수. */
    tickets: function (params) {
      var q = [];
      if (params && params.status) q.push('status=' + encodeURIComponent(params.status));
      if (params && params.limit) q.push('limit=' + params.limit);
      return getJSON('', '/api/admin/support/tickets' + (q.length ? '?' + q.join('&') : ''))
        .then(function (r) {
          return {
            ok: true,
            data: (r && r.tickets) || [],
            counts: (r && r.counts) || null,
            supported: !(r && r.supported === false),
          };
        });
    },

    /** 티켓 상세 — 운영자용이므로 내부 메모가 포함된다. */
    ticket: function (id) {
      return getJSON('', '/api/admin/support/tickets/' + encodeURIComponent(id))
        .then(function (r) {
          return { ok: true, ticket: r && r.ticket, messages: (r && r.messages) || [] };
        });
    },

    /**
     * 답장 또는 내부 메모.
     *
     * internal=true 는 고객에게 보이지 않는다. 호출자가 어느 쪽인지 반드시
     * 명시해야 하므로 기본값을 두지 않는다 — 기본이 있으면 실수로 내부 메모가
     * 고객에게 나가거나, 답장이 고객에게 안 보인다.
     */
    replyTicket: function (id, body, internal) {
      return sendJSON('POST', '/api/admin/support/tickets/' + encodeURIComponent(id) + '/reply',
        { body: body, internal: internal === true });
    },

    setTicketStatus: function (id, status) {
      return sendJSON('POST', '/api/admin/support/tickets/' + encodeURIComponent(id) + '/status', { status: status });
    },

    setTicketPriority: function (id, priority) {
      return sendJSON('POST', '/api/admin/support/tickets/' + encodeURIComponent(id) + '/priority', { priority: priority });
    },

    assignTicket: function (id, unassign) {
      return sendJSON('POST', '/api/admin/support/tickets/' + encodeURIComponent(id) + '/assign',
        { unassign: unassign === true });
    },

    // ---- 공지 ----

    /**
     * 내 관리자 권한. **화면 게이팅의 유일한 출처**다.
     *
     * 등급 이름으로 판단하지 않는 이유: 등급→권한 대응은 서버에만 있고 바뀔 수 있다.
     * 화면이 `role === 'ADMIN'` 으로 버튼을 켜면 서버가 권한을 조정한 순간
     * 화면과 서버가 어긋나 "버튼은 있는데 누르면 403" 이 된다.
     */
    me: function () {
      return getJSON('', '/api/admin/me').then(function (r) {
        return {
          ok: true,
          role: r && r.role,
          permissions: (r && r.permissions) || [],
          capabilities: (r && r.capabilities) || [],
        };
      });
    },

    /** 공지 목록 (초안·게시·보관 전부). */
    notices: function (limit) {
      return getJSON('', '/api/admin/notices' + (limit ? '?limit=' + limit : ''))
        .then(function (r) { return { ok: true, data: (r && r.notices) || [], total: (r && r.total) || 0 }; });
    },

    /**
     * 공지 작성. **초안으로 만들어진다** — 게시는 별도 동작이다.
     * 실수로 즉시 전체 공개되는 것을 막기 위한 설계다.
     */
    createNotice: function (input) {
      return sendJSON('POST', '/api/admin/notices', input || {});
    },

    updateNotice: function (id, input) {
      return sendJSON('PATCH', '/api/admin/notices/' + encodeURIComponent(id), input || {});
    },

    /** 게시 — 이 순간부터 전체 사용자에게 보인다. */
    publishNotice: function (id) {
      return sendJSON('POST', '/api/admin/notices/' + encodeURIComponent(id) + '/publish', {});
    },

    /** 내림 — 초안으로 되돌린다. 잘못 게시한 것을 즉시 감춘다. */
    unpublishNotice: function (id) {
      return sendJSON('POST', '/api/admin/notices/' + encodeURIComponent(id) + '/unpublish', {});
    },

    /** 보관 — 삭제하지 않는다. 무엇을 공지했는지는 기록으로 남아야 한다. */
    archiveNotice: function (id) {
      return sendJSON('POST', '/api/admin/notices/' + encodeURIComponent(id) + '/archive', {});
    },

    /** 로그인 시도 초과로 잠긴 계정 해제. */
    unlockUser: function (id, reason) {
      return sendJSON('POST', '/api/admin/users/' + encodeURIComponent(id) + '/unlock', { reason: reason || '' });
    },

    /** 등급 변경. 서버가 admin.role.write 권한을 요구한다. */
    setUserRole: function (id, role, reason) {
      return sendJSON('POST', '/api/admin/users/' + encodeURIComponent(id) + '/role', { role: role, reason: reason || '' });
    },

    /** 감사 로그. 추가만 가능하고 수정·삭제가 없다(appendOnly). */
    audit: function (opts) {
      opts = opts || {};
      var q = [];
      if (opts.limit) q.push('limit=' + opts.limit);
      if (opts.actor) q.push('actor=' + encodeURIComponent(opts.actor));
      return getJSON('', '/api/admin/audit' + (q.length ? '?' + q.join('&') : ''))
        .then(function (r) {
          return { ok: true, data: (r && r.entries) || [], total: (r && r.total) || 0, appendOnly: Boolean(r && r.appendOnly) };
        });
    },

    systemHealth: function () {
      return getJSON('', '/api/admin/system/health').then(function (r) { return { ok: true, data: r }; });
    },

    securitySummary: function () {
      return getJSON('', '/api/admin/security/summary').then(function (r) { return { ok: true, data: r }; });
    },

    /** 킬스위치 목록. 실주문을 즉시 멈추는 장치다. */
    killSwitches: function () {
      return getJSON('', '/api/admin/kill-switches')
        .then(function (r) { return { ok: true, data: (r && r.killSwitches) || [] }; });
    },

    /*
       킬스위치 토글.

       되돌릴 수 없는 영향이 아니지만 즉시 거래를 멈춘다. 이유를 반드시 받는다 —
       왜 멈췄는지 모르면 언제 풀어야 할지도 알 수 없다.
    */
    setKillSwitch: function (id, active, reason) {
      return sendJSON('POST', '/api/admin/kill-switches/' + encodeURIComponent(id), {
        active: Boolean(active),
        reason: reason || '',
      });
    },

    /** 브로커 리베이트 집계. 수익이 실제로 들어오는지 확인하는 화면이 쓴다. */
    brokerRebates: function () {
      return getJSON('', '/api/admin/broker/rebates').then(function (r) { return { ok: true, data: r }; });
    },
  };

  window.QTApi = {
    /**
     * 서버 설정 (캐시). `/api/config` 가 한 번이라도 성공했으면 그 값.
     *
     * null 을 돌려줄 수 있다 — 아직 안 왔거나 백엔드가 없는 경우다.
     * 호출자는 null 을 "설정 없음" 으로 다루고 기능을 감춰야 한다.
     * {} 로 위장해서 돌려주면 "가입 링크가 빈 문자열" 과 구분되지 않는다.
     */
    getConfig: function () { return serverConfig; },

    /**
     * 설정 도착 구독. 해제 함수를 돌려준다.
     *
     * 이미 도착해 있으면 즉시 한 번 호출한다 — 구독 시점에 따라
     * 알림을 놓치면 화면이 영구히 갱신되지 않는다.
     */
    /**
     * 설정 도착에 반응하는 React 훅. 설정이 오면 컴포넌트를 재렌더한다.
     *
     * 훅을 여기 두는 이유: 설정을 쓰는 화면이 여러 개인데(지갑·입금·위저드)
     * 각자 구독 코드를 쓰면 해제를 빠뜨려 누수가 난다.
     */
    /**
     * 거래소 카탈로그 훅.
     *
     * ★★ 화면이 `window.QTApp.EXCHANGES`(예시 9개)를 직접 읽으면, 어댑터가 없는
     *   거래소까지 "연결 가능" 으로 보인다. 서버 판정을 쓴다.
     *
     * ★ 반환값 셋을 구분한다:
     *     null    아직 조회 중 — "없다" 고 단정하지 않는다
     *     []      조회했고 0개 (설정 문제일 수 있으므로 화면이 안내한다)
     *     [...]   목록
     *
     * @param {boolean} includeAll 미협약까지 포함 (관리자 화면)
     */
    useExchanges: function (includeAll) {
      var R = window.React;
      var st = R.useState(null);
      var data = st[0], setData = st[1];
      var want = includeAll ? 1 : 0;
      R.useEffect(function () {
        /*
           ★ 백엔드가 없는 미리보기에서는 요청하지 않는다. 보내면 404 가 콘솔에
             쌓이고("콘솔 에러 0" 계약이 깨진다), 응답이 오지 않아 화면이 로딩
             상태에서 멈춘다. 화면 쪽이 예시 목록으로 대체한다.
        */
        if (window.QTLive && typeof window.QTLive.isBackendPresent === 'function'
            && window.QTLive.isBackendPresent() === false) {
          return undefined;
        }
        var alive = true;
        window.QTApi.rest.exchanges(Boolean(want))
          .then(function (r) { if (alive) setData(r.data); })
          /* ★ 실패를 빈 목록으로 위장하지 않는다. null 로 남기면 화면이
               "불러올 수 없습니다" 를 보여줄 수 있다. */
          .catch(function () { if (alive) setData(null); });
        return function () { alive = false; };
      }, [want]);
      return data;
    },

    useConfig: function () {
      var R = window.React;
      var pair = R.useState(serverConfig);
      var cfg = pair[0], setCfg = pair[1];
      R.useEffect(function () {
        return window.QTApi.subscribeConfig(function (next) { setCfg(next); });
      }, []);
      return cfg;
    },

    subscribeConfig: function (fn) {
      if (typeof fn !== 'function') return function () {};
      configListeners.add(fn);
      if (serverConfig) { try { fn(serverConfig); } catch (e) { /* 무시 */ } }
      return function () { configListeners.delete(fn); };
    },

    /**
     * 설정을 한 번 받아온다. 이미 있으면 네트워크를 타지 않는다.
     *
     * 실패해도 조용하다 — 정적 폴백(백엔드 없음)에서 콘솔 오류를 내면
     * 진짜 장애를 찾을 때 잡음이 된다.
     */
    ensureConfig: function () {
      if (serverConfig) return Promise.resolve(serverConfig);
      return rest.status().then(function () { return serverConfig; }).catch(function () { return null; });
    },

    /**
     * 거래소의 추천 가입 링크. 설정에 없으면 빈 문자열.
     *
     * 빈 문자열을 돌려주는 계약으로 둔 이유: 호출자가 `if (url)` 한 줄로
     * 유도 카드를 감출 수 있다. 예시 링크로 대체하면 사용자는 가입하지만
     * 귀속이 안 돼 수익이 0 이 된다 — 조용히 새는 손실이다.
     */
    getReferralUrl: function (exchangeId) {
      if (!serverConfig || !exchangeId) return '';
      var map = serverConfig.exchangeReferralUrls;
      if (!map || typeof map !== 'object') return '';
      var url = map[String(exchangeId).toLowerCase()];
      return typeof url === 'string' ? url : '';
    },

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
    admin: admin,
    /** 진단용. 토큰 값 자체는 노출하지 않는다. */
    hasCsrf: function () { return Boolean(csrfToken); },
  };
})();
