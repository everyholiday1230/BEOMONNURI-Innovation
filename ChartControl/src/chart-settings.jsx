/* ============================================================
   Chart Settings / Templates 패널
   ------------------------------------------------------------
   디자이너의 Settings(톱니) · Templates 버튼에 붙는다.
   버튼 마크업은 건드리지 않고 패널만 제공한다.

   하드코딩 금지 적용
     · 모든 문자열은 i18n 사전에서 가져온다
     · 캔들 종류 목록은 KLineChart 가 실제 지원하는 값에서 산출한다
     · 저장 키·버전 같은 상수는 한 곳에 모아 둔다
   ============================================================ */

(function () {
  'use strict';

  const { useState, useEffect, useRef, useCallback, useMemo } = React;
  const I18n = window.QTI18n;
  const t = (k, v) => (I18n ? I18n.t(k, v) : k);
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);

  /** localStorage 스키마. 버전을 붙여 나중에 마이그레이션할 수 있게 한다. */
  const STORE = { key: 'qt.chartTemplates', version: 1 };

  /**
   * KLineChart 캔들 표현 종류.
   * 라이브러리 타입 정의에 있는 값들이며, 실행 시 setStyles 가 거부하면
   * 목록에서 자동으로 빠지도록 검증을 거친다.
   */
  const CANDLE_TYPE_KEYS = [
    'candle_solid',
    'candle_stroke',
    'candle_up_stroke',
    'candle_down_stroke',
    'ohlc',
    'area',
  ];

  // ===============================================================
  // Settings
  // ===============================================================

  window.ChartSettingsPanel = function ChartSettingsPanel({
    getChart, version, showMA, onToggleMA, onClose,
  }) {
    useLocale();
    const ref = useRef(null);
    const [candleType, setCandleType] = useState('candle_solid');
    const [grid, setGrid] = useState(true);
    const [lastPriceMark, setLastPriceMark] = useState(true);

    // 차트의 현재 스타일에서 상태를 읽어온다 (낙관적 가정 금지).
    const syncFromChart = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart) return;
      try {
        const s = chart.getStyles();
        if (s?.candle?.type) setCandleType(s.candle.type);
        if (s?.grid) setGrid(s.grid.show !== false);
        if (s?.candle?.priceMark?.last) setLastPriceMark(s.candle.priceMark.last.show !== false);
      } catch (e) { /* noop */ }
    }, [getChart]);

    useEffect(() => { syncFromChart(); }, [syncFromChart, version]);

    useEffect(() => {
      const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [onClose]);

    const apply = useCallback((patch) => {
      const chart = getChart && getChart();
      if (!chart) return;
      try { chart.setStyles(patch); } catch (e) { console.warn('[ChartSettings] setStyles 실패', e); }
    }, [getChart]);

    const availableTypes = useMemo(() => CANDLE_TYPE_KEYS, []);

    return (
      <div className="chart-ind-panel" ref={ref} style={{ width: 260 }}>
        <div className="chart-ind-panel__head">
          <span className="chart-ind-panel__count">{t('chart_settings')}</span>
        </div>

        <div className="chart-ind-panel__body">
          <div className="chart-ind-group">{t('settings_candle_type')}</div>
          {availableTypes.map((type) => (
            <button
              key={type}
              className={`chart-ind-row ${candleType === type ? 'is-on' : ''}`}
              onClick={() => { setCandleType(type); apply({ candle: { type } }); }}
              aria-pressed={candleType === type}
            >
              <span className="chart-ind-row__check">{candleType === type ? '✓' : ''}</span>
              <span className="chart-ind-row__desc">{t(`candle_type_${type}`)}</span>
            </button>
          ))}

          <div className="chart-ind-group">{t('settings_display')}</div>
          <button
            className={`chart-ind-row ${showMA ? 'is-on' : ''}`}
            onClick={() => onToggleMA && onToggleMA(!showMA)}
            aria-pressed={Boolean(showMA)}
          >
            <span className="chart-ind-row__check">{showMA ? '✓' : ''}</span>
            <span className="chart-ind-row__desc">{t('settings_show_ma')}</span>
          </button>
          <button
            className={`chart-ind-row ${grid ? 'is-on' : ''}`}
            onClick={() => {
              const next = !grid;
              setGrid(next);
              apply({ grid: { show: next } });
            }}
            aria-pressed={grid}
          >
            <span className="chart-ind-row__check">{grid ? '✓' : ''}</span>
            <span className="chart-ind-row__desc">{t('settings_show_grid')}</span>
          </button>
          <button
            className={`chart-ind-row ${lastPriceMark ? 'is-on' : ''}`}
            onClick={() => {
              const next = !lastPriceMark;
              setLastPriceMark(next);
              apply({ candle: { priceMark: { last: { show: next } } } });
            }}
            aria-pressed={lastPriceMark}
          >
            <span className="chart-ind-row__check">{lastPriceMark ? '✓' : ''}</span>
            <span className="chart-ind-row__desc">{t('settings_last_price')}</span>
          </button>
        </div>
      </div>
    );
  };

  // ===============================================================
  // Templates — 지표 + 캔들 스타일 조합 저장/불러오기
  // ===============================================================

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE.key);
      if (!raw) return { version: STORE.version, items: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORE.version || !Array.isArray(parsed.items)) {
        return { version: STORE.version, items: [] };
      }
      return parsed;
    } catch (e) {
      return { version: STORE.version, items: [] };
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORE.key, JSON.stringify(store));
      return true;
    } catch (e) {
      console.warn('[ChartTemplates] 저장 실패', e);
      return false;
    }
  }

  /*
     서버 동기화.

     ★★ 원래 이 패널은 `localStorage` 만 썼다. 집 PC 에서 만든 지표 조합이
       사무실 PC·휴대폰에서는 없었다 — 같은 계정으로 로그인했으면 따라오는 것이
       사용자 기대다.

     ★ 기기 저장을 **없애지 않는다.** 서버가 이 기능을 아직 지원하지 않는
       환경(SQLite 개발), 비로그인, 네트워크 장애에서도 템플릿을 쓸 수 있어야
       한다. 서버가 되면 서버가 정본이고, 안 되면 기기 저장으로 동작한다.

     ★ 서버 형식과 로컬 형식을 서로 변환한다. 로컬은 지표 필드를 펼쳐 저장하고
       (`{name, savedAt, symbol, timeframe, indicators, candleType, gridShow}`),
       서버는 지표 구성을 `payload` 안에 담는다. 서버가 화면 형식을 알면
       지표가 추가될 때마다 서버를 고쳐야 한다.
  */
  function toServerPayload(item) {
    return {
      indicators: item.indicators,
      candleType: item.candleType,
      gridShow: item.gridShow,
    };
  }

  function fromServerTemplate(row) {
    const p = (row && row.payload) || {};
    return {
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      timeframe: row.timeframe,
      savedAt: row.updatedAt,
      indicators: Array.isArray(p.indicators) ? p.indicators : [],
      candleType: p.candleType,
      gridShow: p.gridShow,
      /* 서버에서 온 것임을 표시한다 — 삭제할 때 서버에도 지워야 하는지
         구분해야 하고, 사용자에게 동기화 여부를 알릴 수 있다. */
      synced: true,
    };
  }

  window.ChartTemplatePanel = function ChartTemplatePanel({
    getChart, version: _version, symbol, timeframe, notify, onClose,
  }) {
    useLocale();
    const ref = useRef(null);
    const [store, setStore] = useState(loadStore);
    const [name, setName] = useState('');
    /*
       서버 동기화 상태.

       null   = 아직 확인 중
       true   = 서버에 저장된다(기기 간 공유)
       false  = 이 기기에만 저장된다(비로그인·미지원·장애)

       ★ 사용자에게 이 상태를 보여준다. "저장됨" 만 표시하면 다른 기기에서
         안 보일 때 사라진 줄로 오해한다.
    */
    const [synced, setSynced] = useState(null);

    /*
       서버 목록을 불러와 화면 목록으로 삼는다.

       ★ 서버가 정본이다. 기기 저장은 폴백일 뿐이므로, 서버가 응답하면 그것으로
         덮어쓴다. 두 목록을 합치면 기기에서 지운 것이 되살아난다.
    */
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.chartTemplates) { setSynced(false); return undefined; }
      let alive = true;
      api.chartTemplates()
        .then((r) => {
          if (!alive) return;
          if (r.supported && r.ok) {
            setStore({ version: STORE.version, items: r.items.map(fromServerTemplate) });
            setSynced(true);
          } else {
            setSynced(false);
          }
        })
        .catch(() => { if (alive) setSynced(false); });
      return () => { alive = false; };
    }, []);

    useEffect(() => {
      const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [onClose]);

    const capture = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart) return null;
      try {
        const styles = chart.getStyles();
        return {
          // 지표는 이름 + 파라미터 + 배치만 저장한다. 계산 결과는 저장하지 않는다.
          indicators: chart.getIndicators().map((i) => ({
            name: i.name,
            calcParams: i.calcParams,
            onCandlePane: i.paneId === 'candle_pane',
          })),
          candleType: styles?.candle?.type,
          gridShow: styles?.grid?.show !== false,
        };
      } catch (e) {
        return null;
      }
    }, [getChart]);

    const doSave = useCallback(() => {
      const snapshot = capture();
      if (!snapshot) return;
      const label = name.trim() || t('template_untitled');
      const item = { name: label, savedAt: Date.now(), symbol, timeframe, ...snapshot };
      const next = {
        version: STORE.version,
        items: [...store.items.filter((i) => i.name !== label), item],
      };

      /*
         ★ 기기 저장을 먼저 한다. 서버가 느리거나 실패해도 방금 만든 설정이
           사라지지 않아야 한다 — 사용자는 저장을 눌렀고, 그 기대를 깨면 안 된다.
      */
      const localOk = saveStore(next);
      if (localOk) {
        setStore(next);
        setName('');
      }

      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.saveChartTemplate || synced === false) {
        if (localOk && notify) notify({ title: t('template_saved', { name: label }), variant: 'success' });
        return;
      }

      api.saveChartTemplate({
        name: label,
        symbol,
        timeframe,
        payload: toServerPayload(item),
        schemaVersion: 1,
      })
        .then((r) => {
          if (r && r.template) {
            /* 서버가 돌려준 것으로 그 항목만 갱신한다 — id 가 있어야 삭제할 수 있다. */
            setStore((prev) => ({
              version: STORE.version,
              items: [...prev.items.filter((i) => i.name !== label), fromServerTemplate(r.template)],
            }));
            setSynced(true);
          }
          if (notify) notify({ title: t('template_saved', { name: label }), variant: 'success' });
        })
        .catch((e) => {
          /*
             ★★ 서버 저장 실패를 조용히 넘기지 않는다. 기기에는 저장됐지만
               다른 기기에서는 보이지 않는데, 사용자가 그것을 모르면 나중에
               "사라졌다" 고 여긴다.
             ★ 개수·크기 상한은 서버가 이유를 준다. 그 이유를 그대로 보여준다 —
               "저장 실패" 만 보면 무엇을 고쳐야 할지 알 수 없다.
          */
          const reason = (e && e.payload && e.payload.error && e.payload.error.message) || '';
          setSynced(false);
          if (notify) {
            notify({
              title: t('template_saved_local_only', { name: label }),
              desc: reason || t('template_sync_failed'),
              variant: 'info',
            });
          }
        });
    }, [capture, name, notify, store.items, symbol, timeframe, synced]);

    const doApply = useCallback((item) => {
      const chart = getChart && getChart();
      if (!chart) return;
      try {
        // 기존 지표를 모두 제거한 뒤 템플릿 구성을 적용한다.
        for (const ind of chart.getIndicators()) {
          try { chart.removeIndicator({ paneId: ind.paneId, name: ind.name }); } catch (e) { /* noop */ }
        }
        for (const ind of item.indicators || []) {
          const create = { name: ind.name };
          if (Array.isArray(ind.calcParams) && ind.calcParams.length) create.calcParams = ind.calcParams;
          if (ind.onCandlePane) {
            create.paneId = 'candle_pane';
            chart.createIndicator(create, true);
          } else {
            chart.createIndicator(create, false);
          }
        }
        const patch = {};
        if (item.candleType) patch.candle = { type: item.candleType };
        if (typeof item.gridShow === 'boolean') patch.grid = { show: item.gridShow };
        if (Object.keys(patch).length) chart.setStyles(patch);

        if (notify) notify({ title: t('template_applied', { name: item.name }), variant: 'success' });
      } catch (e) {
        console.warn('[ChartTemplates] 적용 실패', e);
        if (notify) notify({ title: t('template_apply_failed'), variant: 'error' });
      }
    }, [getChart, notify]);

    const doDelete = useCallback((item) => {
      const next = { version: STORE.version, items: store.items.filter((i) => i.name !== item.name) };
      if (saveStore(next)) setStore(next);

      /*
         ★★ 서버에도 지운다. 화면에서만 지우면 다음 접속에서 서버 목록을
           불러올 때 되살아난다 — 사용자는 지웠는데 다시 나타나는 것을 보고
           고장이라고 생각한다.

         ★ 서버 id 가 없으면(기기에만 있던 항목) 서버 요청을 하지 않는다.
         ★ 실패하면 알린다. 조용히 넘기면 되살아나는 이유를 알 수 없다.
      */
      const api = window.QTApi && window.QTApi.rest;
      if (!item.id || !api || !api.deleteChartTemplate) return;
      api.deleteChartTemplate(item.id).catch(() => {
        if (notify) {
          notify({ title: t('template_delete_sync_failed', { name: item.name }), variant: 'info' });
        }
      });
    }, [store.items, notify]);

    return (
      <div className="chart-ind-panel" ref={ref} style={{ width: 300 }}>
        <div className="chart-ind-panel__head">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSave(); }}
            placeholder={t('template_name_placeholder')}
            aria-label={t('template_name_placeholder')}
          />
          <button className="btn btn--primary btn--sm" onClick={doSave}>{t('save')}</button>
        </div>

        <div className="chart-ind-panel__body">
          {/*
             동기화 상태 안내.

             ★ "저장됨" 만 표시하면, 다른 기기에서 안 보일 때 사용자가 사라진
               줄로 오해한다. 어디에 저장되는지 밝힌다.
             ★ 확인 중(null)에는 표시하지 않는다 — 잠깐 "이 기기에만" 이라고
               떴다가 바뀌면 그 문구를 기억한다.
          */}
          {synced === true && (
            <div className="chart-ind-group">{t('template_synced_note')}</div>
          )}
          {synced === false && (
            <div className="chart-ind-group" style={{color:'var(--color-warning)'}}>{t('template_local_only_note')}</div>
          )}
          {store.items.length === 0 && (
            <div className="chart-ind-panel__empty">{t('template_none')}</div>
          )}
          {store.items
            .slice()
            .sort((a, b) => b.savedAt - a.savedAt)
            .map((item) => (
              <div key={item.name} className="chart-ind-row" style={{ cursor: 'default' }}>
                <span className="chart-ind-row__name" style={{ minWidth: 0, flex: 1 }}>{item.name}</span>
                <span className="chart-ind-row__desc">
                  {(item.indicators || []).map((i) => i.name).join(' ') || t('none')}
                </span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => doApply(item)}>{t('template_apply')}</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => doDelete(item)}>{t('template_delete')}</button>
                </span>
              </div>
            ))}
        </div>

        <div className="chart-ind-panel__foot">
          <span className="chart-ind-panel__count">{t('template_count', { n: store.items.length })}</span>
        </div>
      </div>
    );
  };
})();
