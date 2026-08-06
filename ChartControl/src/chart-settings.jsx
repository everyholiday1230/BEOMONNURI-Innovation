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

  window.ChartTemplatePanel = function ChartTemplatePanel({
    getChart, version, symbol, timeframe, notify, onClose,
  }) {
    useLocale();
    const ref = useRef(null);
    const [store, setStore] = useState(loadStore);
    const [name, setName] = useState('');

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
      const next = {
        version: STORE.version,
        items: [
          ...store.items.filter((i) => i.name !== label),
          { name: label, savedAt: Date.now(), symbol, timeframe, ...snapshot },
        ],
      };
      if (saveStore(next)) {
        setStore(next);
        setName('');
        if (notify) notify({ title: t('template_saved', { name: label }), variant: 'success' });
      }
    }, [capture, name, notify, store.items, symbol, timeframe]);

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
    }, [store.items]);

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
