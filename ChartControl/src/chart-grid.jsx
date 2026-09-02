/* ============================================================
   차트 격자 — 트레이드 화면 안에서 멀티차트

   무엇을 하는가
   -----------
   거래 화면의 차트 자리를 1·2·4·6칸으로 나눈다. **각 칸이 완전한 차트**다 —
   지표·드로잉·시간축이 칸마다 따로 있다.

   ★★ 포커스 = 활성 종목

     칸을 누르면 그 칸이 포커스가 되고, **왼쪽 종목 목록·AI 대화·주문 패널이
     모두 그 칸의 종목을 따라간다.**

     처음 만들 때는 첫 칸만 주문 대상으로 고정하고 나머지는 '보기 전용' 으로
     두었다. 그 구조에서는 이용자가 3번 칸(ETH)을 보다가 주문하면 활성
     종목(BTC)으로 나간다 — 오류도 없고 화면도 정상이라 체결 뒤에야 안다.
     포커스와 주문 대상을 **같은 값**으로 묶으면 그 어긋남이 존재할 수 없다.

   ★★ 전역 단일값 충돌

     차트는 활성 지표를 `QTChartState` 에 게시하고, AI 코파일럿이 그것을 읽는다.
     칸이 6개인데 6개가 모두 게시하면 **마지막에 렌더된 칸의 지표**가 코파일럿에
     표시된다 — 이용자가 보고 있는 칸과 무관한 지표다. 그래서 게시는 포커스된
     칸만 한다(`focused` 를 차트에 내려보낸다).

   불변식
   -----
   1. 종목 목록은 `QTMarkets` 단일 출처다. 여기에 적으면 현물 모드에서 선물
      종목이 나온다.
   2. 칸 배치·종목·주기는 저장된다. 저장 실패는 무시한다(화면을 막지 않는다).
   3. 포커스된 칸의 종목이 활성 종목이다. 두 값을 따로 두지 않는다.
   4. 칸 수를 줄일 때 사라지는 칸의 설정은 지우지 않는다 — 다시 늘리면 돌아온다.
   ============================================================ */
(function () {
  'use strict';
  const { useState, useEffect, useCallback } = React;

  const t = (k, p) => (window.QTI18n ? window.QTI18n.t(k, p) : k);

  const LAYOUTS = {
    '1': { cols: 1, rows: 1, count: 1 },
    '2': { cols: 2, rows: 1, count: 2 },
    '2x2': { cols: 2, rows: 2, count: 4 },
    '3x2': { cols: 3, rows: 2, count: 6 },
  };

  const MAX_PANES = 6;
  const STORE_KEY = 'qt.chartGrid';

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (!v || typeof v !== 'object') return null;
      return {
        layout: LAYOUTS[v.layout] ? v.layout : '1',
        symbols: Array.isArray(v.symbols) ? v.symbols.slice(0, MAX_PANES).map(String) : [],
        timeframes: Array.isArray(v.timeframes) ? v.timeframes.slice(0, MAX_PANES).map(String) : [],
        focused: Number.isInteger(v.focused) && v.focused >= 0 && v.focused < MAX_PANES ? v.focused : 0,
      };
    } catch (e) {
      return null;
    }
  }

  function saveState(v) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* noop */ }
  }

  /**
   * @param {object} props
   * @param {string} props.activeSymbol 지금 활성 종목 (주문 패널이 묶여 있는 값).
   * @param {string} props.activeTimeframe 활성 주기.
   * @param {(symbol:string)=>void} props.onSelectSymbol 활성 종목 변경 요청.
   * @param {(tf:string)=>void} [props.onSelectTimeframe] 활성 주기 변경 요청.
   * @param {(args:{symbol:string,timeframe:string,focused:boolean,paneId:string,onFocus:Function})=>React.ReactNode} props.renderPane
   *   칸 하나를 그린다. 완전한 차트를 그리는 책임은 호출자(app.jsx)에 있다 —
   *   차트 위젯이 필요한 값(캔들·오버레이·콜백)을 이 파일이 알 필요가 없다.
   */
  window.ChartGrid = function ChartGrid({
    activeSymbol, activeTimeframe, onSelectSymbol, onSelectTimeframe, renderPane,
  }) {
    const saved = loadState();
    const [layout, setLayout] = useState(saved ? saved.layout : '1');
    const [symbols, setSymbols] = useState(saved ? saved.symbols : []);
    const [timeframes, setTimeframes] = useState(saved ? saved.timeframes : []);
    const [focused, setFocused] = useState(saved ? saved.focused : 0);

    const cfg = LAYOUTS[layout] || LAYOUTS['1'];

    useEffect(() => {
      saveState({ layout, symbols, timeframes, focused });
    }, [layout, symbols, timeframes, focused]);

    /*
       종목 목록. QTMarkets 단일 출처.

       ★ `use()` 는 `{rows, market, loading, failed}` 를 준다(배열이 아니다).
    */
    const markets = window.QTMarkets && window.QTMarkets.use ? window.QTMarkets.use() : null;
    const options = React.useMemo(() => {
      const rows = (markets && markets.rows) || [];
      const out = [];
      for (const m of rows) {
        const sym = String(m.base || '') + String(m.quote || '');
        if (sym && out.indexOf(sym) === -1) out.push(sym);
        if (out.length >= 60) break;
      }
      // 활성 종목이 목록에 없어도 넣는다 — 없으면 <select aria-label={t('a11y_symbol')}> 가 다른 값을 보여준다.
      if (activeSymbol && out.indexOf(activeSymbol) === -1) out.unshift(activeSymbol);
      return out;
    }, [markets && markets.rows, markets && markets.market, activeSymbol]);

    /*
       칸의 종목.

       ★★ 포커스된 칸은 **활성 종목**이다. 왼쪽 목록에서 종목을 고르면 활성
         종목이 바뀌고, 그 변화가 포커스된 칸에 그대로 나타나야 한다. 칸이
         자기 값을 따로 들고 있으면 목록에서 고른 종목이 화면에 반영되지 않는다.
    */
    const symbolAt = useCallback((i) => {
      if (i === focused) return activeSymbol;
      const picked = symbols[i];
      if (picked) return picked;
      // 아직 고르지 않은 칸은 활성 종목이 아닌 것으로 채운다(같은 종목 두 번은 무의미).
      const rest = options.filter((s) => s !== activeSymbol);
      return rest[i % Math.max(1, rest.length)] || activeSymbol;
    }, [focused, activeSymbol, symbols, options]);

    const timeframeAt = useCallback(
      (i) => (i === focused ? (activeTimeframe || '15m') : (timeframes[i] || activeTimeframe || '15m')),
      [focused, activeTimeframe, timeframes],
    );

    /*
       포커스 이동.

       ★★ 활성 종목까지 함께 바꾼다. 포커스와 주문 대상이 다르면, 보고 있는
         차트와 다른 종목으로 주문이 나간다.

       ★ 이전 포커스 칸의 종목을 저장해 둔다. 저장하지 않으면 포커스를 옮길 때
         그 칸이 "정해지지 않은 칸" 으로 돌아가 다른 종목을 보여준다.
    */
    const focusPane = useCallback((i) => {
      if (i === focused) return;
      const prevSymbol = activeSymbol;
      const prevTf = activeTimeframe || '15m';
      const nextSymbol = symbolAt(i);
      const nextTf = timeframeAt(i);
      setSymbols((prev) => { const n = [...prev]; n[focused] = prevSymbol; n[i] = nextSymbol; return n; });
      setTimeframes((prev) => { const n = [...prev]; n[focused] = prevTf; n[i] = nextTf; return n; });
      setFocused(i);
      if (onSelectSymbol && nextSymbol && nextSymbol !== activeSymbol) onSelectSymbol(nextSymbol);
      if (onSelectTimeframe && nextTf && nextTf !== prevTf) onSelectTimeframe(nextTf);
    }, [focused, activeSymbol, activeTimeframe, symbolAt, timeframeAt, onSelectSymbol, onSelectTimeframe]);

    /** 칸의 종목을 바꾼다. 포커스된 칸이면 활성 종목도 바뀐다. */
    const setSymbolAt = useCallback((i, v) => {
      if (i === focused) {
        if (onSelectSymbol) onSelectSymbol(v);
        return;
      }
      setSymbols((prev) => { const n = [...prev]; n[i] = v; return n; });
    }, [focused, onSelectSymbol]);

    const setTfAt = useCallback((i, v) => {
      if (i === focused) {
        if (onSelectTimeframe) onSelectTimeframe(v);
        return;
      }
      setTimeframes((prev) => { const n = [...prev]; n[i] = v; return n; });
    }, [focused, onSelectTimeframe]);

    /*
       칸 수를 줄일 때 포커스가 사라진 칸에 남아 있으면 안 된다.

       ★ 남으면 활성 종목이 **보이지 않는 칸**의 종목이 되고, 주문 대상이
         화면에 없는 상태가 된다.
    */
    useEffect(() => {
      if (focused >= cfg.count) focusPane(0);
      // focusPane 은 focused 에 의존하므로 여기서 직접 부르되, 조건이 참일 때만이다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cfg.count]);

    const TFS = ['1m', '5m', '15m', '1H', '4H', '1D'];
    const single = cfg.count === 1;

    return (
      <div className="qt-cgrid">
        <div className="qt-cgrid__bar">
          <span className="qt-cgrid__barlabel">{t('cg_layout')}</span>
          <div className="seg">
            {Object.keys(LAYOUTS).map((k) => (
              <button
                key={k}
                type="button"
                className={`seg__opt ${layout === k ? 'is-active' : ''}`}
                aria-pressed={layout === k}
                onClick={() => setLayout(k)}
              >
                {k === '1' ? t('cg_single') : k}
              </button>
            ))}
          </div>
          {!single && (
            /*
               ★ 포커스된 칸이 곧 주문 대상이다. 그 사실을 글자로도 밝힌다 —
                 테두리만으로는 급할 때 놓친다.
            */
            <span className="qt-cgrid__warn">
              {t('cg_focus_note', { symbol: activeSymbol || '—' })}
            </span>
          )}
        </div>

        <div
          className="qt-cgrid__grid"
          style={{
            gridTemplateColumns: `repeat(${cfg.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${cfg.rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: cfg.count }).map((_, i) => {
            const sym = symbolAt(i);
            const tf = timeframeAt(i);
            const isFocused = i === focused;
            return (
              <div
                key={i}
                className={`qt-cgrid__pane ${isFocused && !single ? 'is-focused' : ''}`}
                /*
                   ★ 캡처 단계에서 포커스를 잡는다. 차트 안의 드로잉 도구가
                     클릭을 소비하기 때문에, 버블 단계로 두면 차트를 눌러도
                     포커스가 옮겨지지 않는다.
                */
                onMouseDownCapture={() => { if (!isFocused) focusPane(i); }}
              >
                {!single && (
                  <div className="qt-cgrid__head">
                    <select
                      className="qt-cgrid__sym"
                      value={sym}
                      onChange={(e) => setSymbolAt(i, e.target.value)}
                      aria-label={t('cg_pane_symbol')}
                    >
                      {options.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="seg qt-cgrid__tfs">
                      {TFS.map((x) => (
                        <button
                          key={x}
                          type="button"
                          className={`seg__opt ${tf === x ? 'is-active' : ''}`}
                          aria-pressed={tf === x}
                          onClick={() => setTfAt(i, x)}
                        >{x}</button>
                      ))}
                    </div>
                    {isFocused && (
                      <span className="qt-cgrid__focustag">{t('cg_focused')}</span>
                    )}
                  </div>
                )}
                <div className="qt-cgrid__body">
                  {renderPane
                    ? renderPane({
                      symbol: sym,
                      timeframe: tf,
                      focused: isFocused,
                      paneId: `pane-${i}`,
                      setTimeframe: (v) => setTfAt(i, v),
                    })
                    : <div className="qt-cgrid__empty">{t('cg_pane_unavailable')}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
})();
