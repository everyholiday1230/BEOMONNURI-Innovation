/* ============================================================
   즐겨찾기 · 시장 목록 — 모드에 맞는 단일 출처
   ------------------------------------------------------------
   왜 이 파일이 필요한가

   ★★ 두 가지가 목업이었다.

     (1) 즐겨찾기 별이 **목업 카탈로그의 고정 플래그**였다.
         `QT.MARKETS` 의 `fav: true` 를 그대로 그렸고, 별을 눌러도 아무 일도
         일어나지 않았다(onClick 이 없었다). 서버에는 `/api/me/favorites` 가
         버전·상한·감사까지 갖춘 상태로 이미 있었는데 화면이 부르지 않았다.
         이용자는 자기가 고른 종목이 저장됐다고 믿는다.

     (2) Market Watch 가 **모드와 무관하게 선물 카탈로그**를 보여줬다.
         현물 모드로 바꿔 차트는 현물이 되는데 목록은 선물 21종(PERP 표기)이
         그대로 남았다. 목록에서 종목을 고르면 현물 차트가 열리므로, 이용자는
         선물 종목을 골랐다고 믿으면서 현물을 본다.

   ★ 즐겨찾기 키에 시장을 넣는다.

     같은 `BTCUSDT` 라도 현물과 선물은 **다른 상품**이다. 한 키로 합치면 현물에서
     별을 켠 것이 선물 목록에도 켜지고, 그 반대도 된다. 그래서 `spot:BTCUSDT` 처럼
     시장을 접두어로 붙인다. 선물은 기존 저장값과의 호환을 위해 접두어 없이 둔다
     (이미 저장된 즐겨찾기가 사라지면 이용자는 우리가 지웠다고 생각한다).

   ★ 저장 실패를 조용히 넘기지 않는다.

     별은 눌리는 순간 바뀌어야 한다(느린 응답을 기다리면 고장으로 느낀다). 그래서
     화면을 먼저 바꾸고 서버에 보낸다. 실패하면 **되돌리고 알린다** — 저장된 줄
     알았는데 다음 접속에 사라지면 그게 더 나쁘다.
   ============================================================ */

(function () {
  'use strict';

  const { useState, useEffect, useCallback } = React;

  /** 서버가 아는 즐겨찾기 집합. null 은 "아직 읽지 못했다"(빈 집합과 다르다). */
  let favSet = null;
  /* ★ favVersion 을 두고 두 곳에서 대입했지만 읽는 곳이 없었다(죽은 값). 지웠다. */
  let loading = false;
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { /* 한 구독자의 오류가 나머지를 막지 않는다 */ }
    });
  }

  /**
   * 시장을 포함한 저장 키. 선물은 호환을 위해 접두어를 붙이지 않는다.
   *
   * ★ 전부 대문자로 만든다.

   *   접두어만 소문자로 두었더니 저장본은 `SPOT:BTCUSDT`, 조회 키는
   *   `spot:BTCUSDT` 가 되어 **별이 저장은 되는데 다시 열면 꺼져 보였다.**
   *   비교하는 두 곳이 같은 규칙을 쓰지 않으면 저장이 없는 것과 같다.
   */
  function favKey(symbol, market) {
    const s = String(symbol || '').toUpperCase();
    return market === 'spot' ? `SPOT:${s}` : s;
  }

  function currentMarket() {
    return (window.QTMode && window.QTMode.get && window.QTMode.get() === 'spot') ? 'spot' : 'futures';
  }

  function load() {
    if (loading || favSet !== null) return;
    const api = window.QTApi;
    /*
       ★ 즐겨찾기 함수는 `QTApi.rest` 에 있다(auth 가 아니다).

         `QTApi.auth.saveFavorites` 로 잘못 불렀더니 TypeError 가 나고 별이
         조용히 되돌아갔다 — 화면에는 아무 표시가 없었다. 클라이언트 계약을
         추측하지 않고 확인한다.
    */
    if (!api || !api.rest || !api.rest.favorites) return;
    loading = true;
    api.rest.favorites()
      .then((r) => {
        const list = (r && r.symbols) || [];
        favSet = new Set(Array.isArray(list) ? list.map((x) => String(x).toUpperCase()) : []);
        notify();
      })
      .catch(() => {
        /*
           읽지 못하면 null 로 남긴다. 빈 집합으로 두면 "즐겨찾기가 없다" 는
           사실 주장이 되고, 이용자는 자기 목록이 지워졌다고 생각한다.
        */
        notify();
      })
      .finally(() => { loading = false; });
  }

  function isFav(symbol, market) {
    if (!favSet) return false;
    return favSet.has(favKey(symbol, market || currentMarket()));
  }

  function toggle(symbol, market) {
    const api = window.QTApi;
    if (!api || !api.rest || !api.rest.saveFavorites) return Promise.resolve(false);
    if (!favSet) favSet = new Set();
    const key = favKey(symbol, market || currentMarket());
    const had = favSet.has(key);

    // 낙관적 갱신 — 별은 즉시 반응해야 한다.
    if (had) favSet.delete(key); else favSet.add(key);
    notify();

    return api.rest.saveFavorites([...favSet])
      .then(() => true)
      .catch((e) => {
        // 되돌리고 알린다. 저장 안 된 것을 저장된 것처럼 두지 않는다.
        if (had) favSet.add(key); else favSet.delete(key);
        notify();
        if (window.QTToast) {
          window.QTToast({
            title: window.QTI18n ? window.QTI18n.t('fav_save_failed') : 'Could not save',
            desc: String((e && e.message) || ''),
            variant: 'danger',
          });
        }
        return false;
      });
  }

  /* ---------------------------------------------------------------
     현물 시장 목록
     ---------------------------------------------------------------
     현물 티커는 838쌍이 한 번에 온다. 전부 그리면 목록이 쓸모없으므로
     거래대금 상위만 남긴다. 정렬 기준은 견적통화 금액(volValue)이다 —
     수량으로 정렬하면 가격이 낮은 종목이 1위로 올라간다.
  */
  let spotRows = null;      // null = 아직 읽지 못했다
  let spotLoading = false;
  let spotFailed = false;

  function loadSpot() {
    if (spotLoading || spotRows !== null) return;
    const api = window.QTApi;
    if (!api || !api.rest || !api.rest.spot) return;
    spotLoading = true;
    api.rest.spot.tickers()
      .then((r) => {
        if (!r || !r.supported || !Array.isArray(r.data)) { spotFailed = true; notify(); return; }
        const rows = [];
        for (const x of r.data) {
          const id = String(x.symbol || '').toUpperCase();
          if (!id) continue;
          // 견적통화를 분리한다. 목록은 통화별 탭으로 나뉜다.
          let base = id; let quote = '';
          for (const qc of ['USDT', 'USDC', 'BTC', 'ETH', 'KCS', 'TRX', 'DAI', 'EUR']) {
            if (id.length > qc.length && id.endsWith(qc)) { base = id.slice(0, id.length - qc.length); quote = qc; break; }
          }
          if (!quote) continue;
          const price = Number(x.last);
          const vol = Number(x.vol24h);
          if (!Number.isFinite(price) || price <= 0) continue;
          rows.push({
            base,
            quote,
            type: 'SPOT',
            price,
            chg24h: Number.isFinite(Number(x.changePct)) ? Number(x.changePct) : 0,
            vol24h: Number.isFinite(vol) ? vol : 0,
            hi: Number(x.high24h) || null,
            lo: Number(x.low24h) || null,
            dataSource: 'exchange',
          });
        }
        rows.sort((a, b) => b.vol24h - a.vol24h);
        spotRows = rows;
        notify();
      })
      .catch(() => { spotFailed = true; notify(); })
      .finally(() => { spotLoading = false; });
  }

  /*
     모드가 바뀌면 현물 목록을 준비한다. 선물로 돌아갈 때는 캐시를 버리지 않는다 —
     다시 받을 이유가 없고, 왕복을 줄이는 편이 낫다.
  */
  if (window.QTMode && window.QTMode.subscribe) {
    window.QTMode.subscribe(() => {
      if (currentMarket() === 'spot') loadSpot();
      notify();
    });
  }

  window.QTMarkets = {
    /** 즐겨찾기 */
    isFav,
    toggleFav: toggle,
    /** 아직 읽지 못했으면 true — 화면이 '0개' 라고 단정하지 않게 한다. */
    favUnknown: () => favSet === null,

    /**
     * 지금 모드의 시장 목록.
     *
     * @returns {{rows: Array, market: 'spot'|'futures', loading: boolean, failed: boolean}}
     */
    list() {
      const market = currentMarket();
      if (market === 'spot') {
        loadSpot();
        return {
          rows: (spotRows || []).map((r) => ({ ...r, fav: isFav(r.base + r.quote, 'spot') })),
          market,
          loading: spotRows === null && !spotFailed,
          failed: spotFailed,
        };
      }
      const base = (window.QT && window.QT.MARKETS) || [];
      return {
        rows: base.map((r) => ({ ...r, fav: isFav(r.base + r.quote, 'futures') })),
        market,
        loading: false,
        failed: false,
      };
    },

    /** React 훅 — 즐겨찾기나 목록이 바뀌면 다시 렌더된다. */
    use() {
      const [, bump] = useState(0);
      useEffect(() => {
        load();
        if (currentMarket() === 'spot') loadSpot();
        const fn = () => bump((n) => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
      }, []);
      // 시세가 갱신되면 가격도 다시 그려야 한다.
      const liveVersion = window.QTLive && window.QTLive.useLiveVersion ? window.QTLive.useLiveVersion() : 0;
      return useCallback(() => window.QTMarkets.list(), [liveVersion])();
    },
  };
})();
