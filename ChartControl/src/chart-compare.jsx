/* ============================================================
   심볼 비교 (Compare)
   ------------------------------------------------------------
   차트에 다른 심볼의 가격 흐름을 겹쳐 그린다.

   왜 정규화가 필요한가
   ------------------
   BTC(64,000)와 DOGE(0.07)를 같은 가격축에 그리면 DOGE 는 바닥에 붙은 직선이
   된다. 그래서 "비교" 는 절대가격이 아니라 **상대 변화**를 봐야 한다.

   방식: 비교 심볼의 첫 캔들 종가를 기준 심볼의 첫 캔들 종가에 맞춰 배율을 곱한다.
        두 선이 같은 지점에서 출발하므로, 이후 벌어지는 간격이 곧 상대 성과다.
        (TradingView 의 Compare 와 같은 개념)

   왜 지표로 구현하는가
   ------------------
   KLineChart 의 오버레이는 사용자가 점을 찍어 만드는 도형이다. 비교선은 모든
   캔들에 값이 있는 연속 데이터이므로 지표(indicator)가 맞다. 지표는 캔들 페인에
   겹칠 수 있고(paneId), 데이터가 바뀌면 자동으로 다시 계산된다.

   ★ 타임스탬프로 정렬한다
   두 심볼의 캔들 수가 다를 수 있다(상장 시점 차이, 거래 정지 구간).
   인덱스로 맞추면 시간이 어긋난 비교가 되어 완전히 잘못된 결론을 만든다.
   ============================================================ */

(function () {
  'use strict';

  const { useState, useEffect, useCallback, useMemo, useRef } = React;

  const KL = window.klinecharts;
  const I18n = window.QTI18n;

  function t(key, vars) {
    return I18n ? I18n.t(key, vars) : key;
  }

  /** 지표 이름. 심볼별로 인스턴스를 따로 만들되 템플릿은 하나를 공유한다. */
  const COMPARE_INDICATOR = 'qtCompare';

  /**
   * 비교 심볼의 캔들 캐시.
   *
   * `SYMBOL|tf` → { byTime: Map<ms, close>, first: number }
   * 지표 calc() 는 동기 함수라서 여기서 미리 받아둔 값을 읽는다.
   */
  const cache = new Map();

  /** 비교선 색상. 기준 심볼(캔들)과 구분되는 색을 순서대로 쓴다. */
  const COMPARE_COLORS = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

  function cacheKey(symbol, tf) {
    return `${symbol}|${tf}`;
  }

  /**
   * 비교 심볼 캔들을 받아 캐시에 넣는다.
   *
   * 실패하면 캐시에 넣지 않는다 — 빈 데이터를 넣으면 선이 0 에 붙어
   * "가격이 0 으로 폭락한 것처럼" 보인다.
   */
  function loadCompare(symbol, tf, limit) {
    const key = cacheKey(symbol, tf);
    const Api = window.QTApi;
    if (!Api || !Api.rest) return Promise.reject(new Error('backend_unavailable'));

    return Api.rest.candles(symbol, tf, limit || 300).then((res) => {
      const rows = (res && res.data) || [];
      if (!rows.length) throw new Error('no_data');

      const byTime = new Map();
      let first = null;
      for (const c of rows) {
        const ts = Number(c.time);
        const close = Number(c.close);
        if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
        byTime.set(ts, close);
        if (first === null) first = close;
      }
      if (first === null) throw new Error('no_data');

      cache.set(key, { byTime, first, loadedAt: Date.now(), count: byTime.size });
      return cache.get(key);
    });
  }

  /**
   * 비교 지표 템플릿을 등록한다.
   *
   * calc() 는 기준 캔들 목록을 받아 같은 길이의 배열을 돌려줘야 한다.
   * 값이 없는 구간은 null 로 둔다 — 0 을 넣으면 선이 바닥으로 떨어진다.
   */
  let registered = false;
  function ensureRegistered() {
    if (registered || !KL || typeof KL.registerIndicator !== 'function') return registered;

    KL.registerIndicator({
      name: COMPARE_INDICATOR,
      shortName: 'CMP',
      // 캔들과 같은 축을 쓴다. 정규화했으므로 값의 크기가 기준 심볼과 같은 범위다.
      series: 'price',
      precision: 2,
      figures: [{ key: 'value', title: '', type: 'line' }],

      calc: (dataList, indicator) => {
        const ext = (indicator && indicator.extendData) || {};
        const entry = cache.get(cacheKey(ext.symbol, ext.timeframe));
        if (!entry || !dataList.length) return dataList.map(() => ({ value: null }));

        /*
           기준값을 "화면에 보이는 첫 캔들" 이 아니라 "데이터의 첫 캔들" 로 잡는다.
           보이는 범위를 기준으로 하면 스크롤할 때마다 선이 위아래로 튀어서
           비교가 불가능하다.
        */
        let baseMain = null;
        let baseCmp = null;
        for (const d of dataList) {
          const cmp = entry.byTime.get(Number(d.timestamp));
          if (cmp !== undefined && Number.isFinite(d.close) && d.close > 0) {
            baseMain = d.close;
            baseCmp = cmp;
            break;
          }
        }
        // 겹치는 구간이 하나도 없으면 비교할 수 없다. 선을 그리지 않는다.
        if (baseMain === null) return dataList.map(() => ({ value: null }));

        const scale = baseMain / baseCmp;
        return dataList.map((d) => {
          const cmp = entry.byTime.get(Number(d.timestamp));
          return { value: cmp === undefined ? null : cmp * scale };
        });
      },
    });

    registered = true;
    return true;
  }

  // ---------------------------------------------------------------
  // 패널
  // ---------------------------------------------------------------

  /**
   * 비교 심볼 관리 패널.
   *
   * 마크업은 지표 패널(chart-ind-panel)과 같은 클래스를 쓴다 — 새 CSS 를 만들지
   * 않고 디자이너 스타일을 그대로 재사용한다.
   */
  window.ChartComparePanel = function ChartComparePanel({
    getChart,
    version,
    baseSymbol,
    timeframe,
    notify,
    onClose,
  }) {
    if (window.useI18nLocale) window.useI18nLocale();

    const [query, setQuery] = useState('');
    /** 추가된 비교 심볼. [{ symbol, indicatorId, color }] */
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState('');
    const boxRef = useRef(null);

    // 사용 가능한 심볼 목록. 실시세가 있으면 그것을, 없으면 목업 목록을 쓴다.
    const candidates = useMemo(() => {
      const markets = (window.QT && window.QT.MARKETS) || [];
      return markets
        .map((m) => `${m.base}${m.quote}`)
        .filter((s) => s && s !== baseSymbol);
    }, [baseSymbol]);

    const filtered = useMemo(() => {
      const q = query.trim().toUpperCase();
      const chosen = new Set(items.map((i) => i.symbol));
      return candidates
        .filter((s) => !chosen.has(s) && (!q || s.includes(q)))
        .slice(0, 40);
    }, [candidates, query, items]);

    /** 바깥을 누르면 닫는다. 지표 패널과 같은 동작이라 사용자가 헷갈리지 않는다. */
    useEffect(() => {
      const onDown = (e) => {
        if (boxRef.current && !boxRef.current.contains(e.target)) onClose && onClose();
      };
      const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [onClose]);

    /**
     * 차트에서 현재 비교 지표를 다시 읽는다.
     *
     * 낙관적 갱신을 하지 않는다 — 차트가 실제로 반영한 것만 화면에 보여야
     * "추가된 줄 알았는데 없는" 상태를 만들지 않는다.
     */
    const syncFromChart = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart || !chart.getIndicators) return;
      try {
        const got = chart.getIndicators({ paneId: 'candle_pane', name: COMPARE_INDICATOR });
        const list = got instanceof Map ? [...got.values()].flat() : Array.isArray(got) ? got : [];
        setItems(
          list
            .filter((i) => i && i.name === COMPARE_INDICATOR)
            .map((i, idx) => ({
              symbol: (i.extendData && i.extendData.symbol) || '?',
              indicatorId: i.id,
              color: COMPARE_COLORS[idx % COMPARE_COLORS.length],
            })),
        );
      } catch (e) {
        // 읽을 수 없으면 화면 목록을 비우지 않는다. 지우면 삭제 버튼이 사라진다.
        console.warn('[Compare] 지표 조회 실패', e);
      }
    }, [getChart]);

    useEffect(() => { syncFromChart(); }, [syncFromChart, version]);

    /**
     * 타임프레임이 바뀌면 캐시가 무효다. 다시 받아 지표를 갱신한다.
     * 이걸 하지 않으면 15분봉 차트에 1분봉 비교선이 남아 시간이 어긋난다.
     */
    useEffect(() => {
      if (!items.length) return;
      let cancelled = false;
      (async () => {
        for (const it of items) {
          try {
            await loadCompare(it.symbol, timeframe, 300);
          } catch (e) { /* 개별 실패는 아래 override 에서 걸러진다 */ }
        }
        if (cancelled) return;
        const chart = getChart && getChart();
        if (!chart) return;
        for (const it of items) {
          try {
            chart.overrideIndicator({
              id: it.indicatorId,
              extendData: { symbol: it.symbol, timeframe },
            });
          } catch (e) { /* noop */ }
        }
      })();
      return () => { cancelled = true; };
      // items 를 의존성에 넣으면 무한 루프가 된다 (syncFromChart 가 items 를 바꾼다).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeframe]);

    const add = useCallback(
      async (symbol) => {
        const chart = getChart && getChart();
        if (!chart) return;
        if (!ensureRegistered()) {
          setError(t('cmp_err_unsupported'));
          return;
        }
        setBusy(symbol);
        setError('');
        try {
          const entry = await loadCompare(symbol, timeframe, 300);

          const color = COMPARE_COLORS[items.length % COMPARE_COLORS.length];
          // isStack=true 가 없으면 같은 페인의 기존 지표를 교체한다.
          // (MA 가 사라지는 것을 실제로 확인했다 — chart-indicators.jsx 주석 참고)
          chart.createIndicator(
            {
              name: COMPARE_INDICATOR,
              paneId: 'candle_pane',
              extendData: { symbol, timeframe },
              styles: { lines: [{ color, size: 1.5 }] },
            },
            true,
          );

          if (notify) {
            notify({
              title: t('cmp_added', { symbol }),
              desc: t('cmp_added_desc', { count: entry.count }),
              variant: 'success',
            });
          }
          setQuery('');
          setTimeout(syncFromChart, 0);
        } catch (e) {
          const key =
            e && e.message === 'backend_unavailable' ? 'cmp_err_offline'
            : e && e.message === 'no_data' ? 'cmp_err_no_data'
            : 'cmp_err_failed';
          setError(t(key, { symbol }));
        } finally {
          setBusy(null);
        }
      },
      [getChart, timeframe, items.length, notify, syncFromChart],
    );

    const remove = useCallback(
      (item) => {
        const chart = getChart && getChart();
        if (!chart) return;
        try {
          chart.removeIndicator({ paneId: 'candle_pane', id: item.indicatorId });
        } catch (e) {
          console.warn('[Compare] 삭제 실패', e);
        }
        setTimeout(syncFromChart, 0);
      },
      [getChart, syncFromChart],
    );

    const clearAll = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart) return;
      for (const it of items) {
        try { chart.removeIndicator({ paneId: 'candle_pane', id: it.indicatorId }); } catch (e) { /* noop */ }
      }
      setTimeout(syncFromChart, 0);
    }, [getChart, items, syncFromChart]);

    return (
      <div className="chart-ind-panel" style={{ width: 320 }} ref={boxRef}>
        {/*
          마크업은 지표 패널(chart-indicators.css)의 클래스를 그대로 재사용한다.
          새 CSS 를 만들지 않는다 — 두 패널이 다른 모양이면 디자인 일관성이 깨진다.
        */}
        <div className="chart-ind-panel__head">
          <input
            placeholder={t('cmp_search_placeholder')}
            aria-label={t('cmp_search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <span className="chart-ind-panel__count">{items.length}</span>
        </div>

        <div className="chart-ind-panel__body">
          {/* 기준 심볼 안내 — 무엇과 비교하는지 분명해야 한다. */}
          <div className="chart-ind-group">{t('cmp_base_note', { symbol: baseSymbol, tf: timeframe })}</div>

          {error && <div className="chart-ind-panel__empty">{error}</div>}

          {items.length > 0 && (
            <>
              <div className="chart-ind-group">{t('cmp_active')}</div>
              {items.map((it) => (
                <div className="chart-ind-row is-on" key={it.indicatorId}>
                  {/* 색 견본. 차트의 선 색과 같아야 어느 선이 어느 심볼인지 알 수 있다. */}
                  <span
                    className="chart-ind-row__check"
                    style={{ background: it.color, borderColor: it.color }}
                    aria-hidden="true"
                  />
                  <span className="chart-ind-row__name">{it.symbol}</span>
                  <button
                    className="chart-ind-row__pane"
                    onClick={() => remove(it)}
                    title={t('cmp_remove', { symbol: it.symbol })}
                    aria-label={t('cmp_remove', { symbol: it.symbol })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}

          <div className="chart-ind-group">{t('cmp_available')}</div>
          {filtered.length === 0 && <div className="chart-ind-panel__empty">{t('cmp_no_match')}</div>}
          {filtered.map((sym) => (
            <button
              className="chart-ind-row"
              key={sym}
              onClick={() => add(sym)}
              disabled={busy === sym}
            >
              <span className="chart-ind-row__name">{sym}</span>
              <span className="chart-ind-row__desc">{busy === sym ? t('cmp_loading') : ''}</span>
            </button>
          ))}
        </div>

        {items.length > 0 && (
          <div className="chart-ind-panel__foot">
            <button className="btn btn--xs" onClick={clearAll}>{t('cmp_clear')}</button>
          </div>
        )}
      </div>
    );
  };

  /** 진단·테스트용. */
  window.ChartCompare = {
    INDICATOR: COMPARE_INDICATOR,
    load: loadCompare,
    ensureRegistered,
    cacheSize: () => cache.size,
    debug: () => [...cache.entries()].map(([k, v]) => ({ key: k, candles: v.count, first: v.first })),
  };
})();
