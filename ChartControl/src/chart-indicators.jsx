/* ============================================================
   Chart Indicators — KLineChart 내장 지표 27종 배선
   ------------------------------------------------------------
   기존 `Indicators` 버튼은 아무 동작이 없었다. 버튼을 바꾸지 않고
   드롭다운 패널만 붙여 실제로 지표를 켜고 끌 수 있게 한다.

   지표 목록은 하드코딩하지 않고 KLineChart 에서 런타임에 읽는다
   (getSupportedIndicators). 라이브러리를 올려 지표가 늘어나면 자동 반영된다.
   설명과 배치(캔들 겹침 vs 별도 페인)만 우리가 정의한다.
   ============================================================ */

(function () {
  'use strict';

  const { useState, useMemo, useEffect, useRef, useCallback } = React;
  const KL = window.klinecharts;
  const I18n = window.QTI18n;

  /** 사전 조회 단축. i18n 이 없으면 키를 그대로 보여준다(빈 화면 방지). */
  const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);

  /** 지표 설명. 사전에 없으면 지표 코드를 그대로 쓴다. */
  const descOf = (name) => (I18n && I18n.exists(`ind_${name}`) ? I18n.t(`ind_${name}`) : name);

  /**
   * 언어가 바뀌면 재렌더하는 공용 훅.
   * 여러 컴포넌트가 쓰므로 window 에 올려 중복 정의를 막는다.
   */
  if (!window.useI18nLocale) {
    window.useI18nLocale = function useI18nLocale() {
      const [locale, setLocaleState] = useState(() => (I18n ? I18n.getLocale() : 'en'));
      useEffect(() => {
        if (!I18n) return undefined;
        setLocaleState(I18n.getLocale());
        return I18n.subscribe((next) => setLocaleState(next));
      }, []);
      return locale;
    };
  }

  /**
   * 계정 데이터(실 잔고·포지션)가 갱신되면 재렌더하는 공용 훅.
   *
   * 이 훅이 없으면 실데이터가 도착해도 화면은 최초 렌더의 목업을 계속 보여준다.
   * 여러 페이지가 쓰므로 window 에 올려 중복 정의를 막는다.
   *
   * status 를 함께 돌려준다 — 화면이 "실데이터인지" 를 사용자에게 알려야 한다.
   * 목업을 실데이터처럼 보여주는 것이 이 시스템에서 가장 위험한 표시 오류다.
   */
  if (!window.useAccountData) {
    window.useAccountData = function useAccountData() {
      const Acct = window.QTAccount;
      const [snap, setSnap] = useState(() => ({
        status: Acct ? Acct.getStatus() : 'OFFLINE',
        version: 0,
      }));

      useEffect(() => {
        if (!Acct) return undefined;
        setSnap({ status: Acct.getStatus(), version: 0 });
        return Acct.subscribe((st) => setSnap({ status: st.status, version: st.version }));
      }, []);

      return {
        status: snap.status,
        version: snap.version,
        isLive: snap.status === 'VERIFIED',
        error: Acct ? Acct.getError() : null,
        asOf: Acct ? Acct.getAsOf() : null,
      };
    };
  }

  /**
   * 관리자 데이터가 갱신되면 재렌더하는 공용 훅.
   *
   * 상태를 함께 돌려준다 — 권한 없음(403)과 조회 실패를 화면이 구분해
   * 보여줘야 한다. 둘을 같은 문구로 표시하면 운영자가 원인을 못 찾는다.
   */
  if (!window.useAdminData) {
    window.useAdminData = function useAdminData() {
      const A = window.QTAdmin;
      const [snap, setSnap] = useState(() => ({
        status: A ? A.getStatus() : 'OFFLINE',
        version: 0,
      }));

      useEffect(() => {
        if (!A) return undefined;
        setSnap({ status: A.getStatus(), version: 0 });
        return A.subscribe((st) => setSnap({ status: st.status, version: st.version }));
      }, []);

      return {
        status: snap.status,
        version: snap.version,
        isLive: snap.status === 'READY',
        error: A ? A.getError() : null,
        asOf: A ? A.getAsOf() : null,
        refresh: A ? A.refresh : function () {},
      };
    };
  }

  /**
   * 지표 메타데이터.
   *
   * overlay=true  -> 캔들 페인에 겹쳐 그린다 (가격과 같은 축을 쓰는 지표)
   * overlay=false -> 별도 페인에 그린다 (스케일이 다른 지표)
   *
   * 이 구분을 틀리면 예컨대 RSI(0~100)가 가격축에 그려져 화면 밖으로 나가거나
   * 캔들이 짜부라진다. 그래서 지표마다 명시한다.
   */
  /**
   * 지표 배치 정보만 정의한다. 표시 문자열은 사전(i18n)에서 가져온다.
   *
   * overlay=true  -> 캔들 페인에 겹쳐 그린다 (가격과 같은 축)
   * overlay=false -> 별도 페인에 그린다 (스케일이 다름)
   *
   * 이 구분을 틀리면 RSI(0~100)가 가격축에 그려져 캔들이 짜부라진다.
   * 목록 자체는 KLineChart 에서 런타임 조회하므로, 여기 없는 지표가 생기면
   * 기본값(별도 페인 + other 그룹)으로 안전하게 동작한다.
   */
  const PLACEMENT = {
    MA:   { overlay: true,  group: 'trend' },
    EMA:  { overlay: true,  group: 'trend' },
    SMA:  { overlay: true,  group: 'trend' },
    BOLL: { overlay: true,  group: 'volatility' },
    BBI:  { overlay: true,  group: 'trend' },
    SAR:  { overlay: true,  group: 'trend' },
    AVP:  { overlay: true,  group: 'volume' },

    VOL:  { overlay: false, group: 'volume' },
    OBV:  { overlay: false, group: 'volume' },
    VR:   { overlay: false, group: 'volume' },
    EMV:  { overlay: false, group: 'volume' },
    PVT:  { overlay: false, group: 'volume' },

    MACD: { overlay: false, group: 'momentum' },
    RSI:  { overlay: false, group: 'momentum' },
    KDJ:  { overlay: false, group: 'momentum' },
    CCI:  { overlay: false, group: 'momentum' },
    WR:   { overlay: false, group: 'momentum' },
    BIAS: { overlay: false, group: 'momentum' },
    BRAR: { overlay: false, group: 'momentum' },
    CR:   { overlay: false, group: 'momentum' },
    ROC:  { overlay: false, group: 'momentum' },
    MTM:  { overlay: false, group: 'momentum' },
    AO:   { overlay: false, group: 'momentum' },
    PSY:  { overlay: false, group: 'momentum' },

    DMI:  { overlay: false, group: 'trend' },
    DMA:  { overlay: false, group: 'trend' },
    TRIX: { overlay: false, group: 'trend' },
  };

  /** 그룹 표시 순서. 라벨은 사전에서 가져온다. */
  const GROUP_ORDER = ['trend', 'momentum', 'volatility', 'volume', 'other'];




  /** KLineChart 가 실제로 지원하는 지표만 노출한다. */
  function supportedIndicators() {
    if (!KL || typeof KL.getSupportedIndicators !== 'function') return [];
    return KL.getSupportedIndicators().map((name) => {
      // 배치 정보가 없는 지표(라이브러리 업데이트로 새로 생긴 것)는
      // 안전한 기본값으로 처리한다. 목록에서 빠지지 않게 하는 것이 중요하다.
      const placement = PLACEMENT[name] || { overlay: false, group: 'other' };
      return { name, ...placement };
    });
  }

  /**
   * 지표 패널.
   *
   * @param {object} p
   * @param {() => object|null} p.getChart  KLineChart 인스턴스 접근자
   * @param {number} p.version              차트 재생성 감지용 (인스턴스 교체 시 재조회)
   * @param {() => void} p.onClose
   */
  /*
     사용자가 지정한 지표 파라미터(예: MA 기간)를 로컬에 저장한다.
     새로고침 후에도 유지되고, 차트(ChartKline)가 기본 지표를 만들 때도 이 값을 읽는다.
  */
  const CALC_KEY = 'qt.chart.calcparams.v1';
  function loadCalcAll() { try { return JSON.parse(localStorage.getItem(CALC_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function getCalc(name) { const v = loadCalcAll()[name]; return Array.isArray(v) && v.length ? v.slice() : null; }
  function setCalc(name, params) { try { const all = loadCalcAll(); all[name] = params; localStorage.setItem(CALC_KEY, JSON.stringify(all)); } catch (e) { /* noop */ } }
  if (!window.QTChartParams) window.QTChartParams = { get: getCalc, set: setCalc, all: loadCalcAll };

  window.ChartIndicatorPanel = function ChartIndicatorPanel({ getChart, version, onClose, publish = true }) {
    const [q, setQ] = useState('');
    const [active, setActive] = useState(() => new Map()); // name -> paneId
    const [params, setParams] = useState(() => new Map()); // name -> calcParams[]
    const [editing, setEditing] = useState(null); // 파라미터 편집 중인 지표 이름
    const panelRef = useRef(null);
    /*
       ★★ 툴바(.chart-toolbar)는 overflow-x:auto 라, 그 안에서 absolute 로 띄운
         드롭다운이 세로로 잘려 아무것도 안 보였다(실측 버그). 그래서 버튼 위치를
         기준으로 position:fixed 로 띄워 조상 overflow 클리핑을 벗어난다.
    */
    const [fixedPos, setFixedPos] = useState(null);
    useEffect(() => {
      const wrap = panelRef.current && panelRef.current.parentElement;
      if (!wrap) return undefined;
      const place = () => {
        const r = wrap.getBoundingClientRect();
        const w = 320;
        let left = Math.round(r.left);
        if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
        setFixedPos({ top: Math.round(r.bottom + 6), left: left });
      };
      place();
      window.addEventListener('resize', place);
      return () => window.removeEventListener('resize', place);
    }, []);
    // 언어 변경 시 라벨/설명이 즉시 갱신되도록 구독한다.
    window.useI18nLocale();

    const all = useMemo(supportedIndicators, []);

    // 차트에 이미 붙어 있는 지표를 읽어 체크 상태를 맞춘다.
    // (MA/VOL 은 ChartKline 이 기본으로 켜둔다)
    const syncFromChart = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart) return;
      try {
        const map = new Map();
        /*
           ★★ 설정값(calcParams)도 함께 모은다.

             학습 데이터가 "어떤 지표를 켜고 매매했는가" 를 담는다. 그런데
             `MA` 만으로는 20일선인지 120일선인지 알 수 없고, 그 둘은 완전히
             다른 판단이다. 이름만 남기면 학습에서 두 경우가 한 덩어리가 된다.
        */
        const detail = [];
        const pmap = new Map();
        for (const ind of chart.getIndicators()) {
          map.set(ind.name, ind.paneId);
          if (Array.isArray(ind.calcParams) && ind.calcParams.length) pmap.set(ind.name, ind.calcParams.slice());
          detail.push({
            id: ind.name,
            // 값이 없으면 넣지 않는다 — 기본값을 적으면 없던 설정이 생긴다.
            ...(Array.isArray(ind.calcParams) && ind.calcParams.length
              ? { params: { calcParams: ind.calcParams } }
              : {}),
          });
        }
        setActive(map);
        setParams(pmap);
        /*
           ★ 활성 지표를 공유 저장소에 알린다.

             AI 코파일럿의 맥락 칩이 이 값을 읽는다. 전에는 그 칩에 지표 이름이
             박혀 있어서, 사용자가 켠 것과 다른 지표를 보고 있다고 말했다.
             차트를 소유한 이곳에서 알려야 어긋나지 않는다.
        */
        /*
           ★★ 포커스된 칸만 게시한다.

             격자에서 칸이 6개면 6개가 모두 게시하고, 마지막에 렌더된 칸의
             지표가 남는다. AI 코파일럿이 그 값을 읽으므로, 이용자가 보고 있지
             않은 차트의 지표를 말하게 된다. 학습 기록에도 같은 값이 들어간다 —
             "어떤 지표를 보고 주문했는가" 가 틀리면 데이터가 조용히 오염된다.
        */
        if (window.QTChartState && publish) {
          window.QTChartState.publishIndicators([...map.keys()]);
          // 설정값까지 담은 형태. 학습 문맥 수집이 이것을 읽는다.
          if (window.QTChartState.publishIndicatorDetail) {
            window.QTChartState.publishIndicatorDetail(detail);
          }
        }
      } catch (e) { /* noop */ }
    }, [getChart, publish]);

    useEffect(() => {
      syncFromChart();
    }, [syncFromChart, version]);

    // 바깥 클릭 / ESC 로 닫기
    useEffect(() => {
      const onDown = (e) => {
        if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [onClose]);

    const filtered = useMemo(() => {
      const needle = q.trim().toLowerCase();
      const list = needle
        ? all.filter((i) => i.name.toLowerCase().includes(needle) || descOf(i.name).toLowerCase().includes(needle))
        : all;
      const grouped = {};
      for (const item of list) {
        const g = item.group || 'other';
        (grouped[g] = grouped[g] || []).push(item);
      }
      for (const g of Object.keys(grouped)) grouped[g].sort((a, b) => a.name.localeCompare(b.name));
      return grouped;
    }, [all, q]);

    const toggle = useCallback((item) => {
      const chart = getChart && getChart();
      if (!chart) return;

      const currentPane = active.get(item.name);
      if (currentPane !== undefined) {
        try {
          chart.removeIndicator({ paneId: currentPane, name: item.name });
        } catch (e) { /* noop */ }
      } else {
        try {
          let created;
          if (item.overlay) {
            // 실측 주의 2가지:
            //  1) paneId 를 3번째 인자로 주면 무시되고 새 페인이 생긴다.
            //     IndicatorCreate 안에 넣어야 캔들 페인에 겹친다.
            //  2) isStack=true 가 없으면 같은 페인의 기존 지표를 "교체"한다.
            //     BOLL 을 켜면 MA 가 사라지는 것을 실제로 확인했다.
            created = chart.createIndicator({ name: item.name, paneId: 'candle_pane' }, true);
          } else {
            created = chart.createIndicator({ name: item.name }, false);
          }
          // 저장해 둔 사용자 파라미터가 있으면 적용한다.
          const saved = getCalc(item.name);
          if (saved) {
            try {
              chart.overrideIndicator(created && typeof created === 'string'
                ? { id: created, calcParams: saved }
                : { name: item.name, calcParams: saved });
            } catch (e) { /* noop */ }
          }
        } catch (e) {
          console.warn('[Indicators] 생성 실패', item.name, e);
        }
      }
      // 차트가 실제로 반영한 결과를 다시 읽는다 (낙관적 갱신 금지).
      setTimeout(syncFromChart, 0);
    }, [active, getChart, syncFromChart]);

    // 지표 파라미터(기간 등) 하나를 바꾼다 — 차트에 즉시 반영하고 로컬에 저장한다.
    const updateParam = useCallback((item, idx, raw) => {
      const chart = getChart && getChart();
      if (!chart) return;
      const cur = (params.get(item.name) || []).slice();
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return;
      cur[idx] = n;
      try {
        chart.overrideIndicator({ name: item.name, paneId: active.get(item.name), calcParams: cur });
      } catch (e) { /* noop */ }
      setCalc(item.name, cur);
      setParams((prev) => { const next = new Map(prev); next.set(item.name, cur); return next; });
    }, [params, active, getChart]);

    const clearAll = useCallback(() => {
      const chart = getChart && getChart();
      if (!chart) return;
      for (const [name, paneId] of active.entries()) {
        try {
          chart.removeIndicator({ paneId, name });
        } catch (e) { /* noop */ }
      }
      setTimeout(syncFromChart, 0);
    }, [active, getChart, syncFromChart]);

    /*
       ★★ 지표 프리셋 저장/불러오기는 **여기**에 있어야 한다.

         원래는 저장 페이지(pages-points.jsx)에 "현재 지표 저장" 버튼이 있었다.
         그 버튼은 window.ChartKlineUtil.listIndicators() 로 켜둔 지표를 읽는데,
         그 함수는 **마운트된 차트 인스턴스**만 훑는다(INSTANCES). 저장 페이지에는
         차트가 없으니 언제나 빈 배열이었다 → "켜둔 지표가 없습니다" → 저장 불가.
         그래서 프로덕션 saved_items 테이블이 0행이었다(실측). 즉 저장 기능이
         존재하는 것처럼 보였을 뿐, 누구도 한 번도 저장할 수 없었다.

         지표는 차트에 있다. 그러니 저장 버튼도 차트에 있어야 한다.
    */
    const [saveMsg, setSaveMsg] = useState(null);
    const [presets, setPresets] = useState(null); // null = 아직 모름, [] = 없음
    const [presetsOpen, setPresetsOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const loadPresets = useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedList) { setPresets([]); return; }
      api.savedList('indicator').then((r) => {
        // ★ 조회 실패를 "없음"으로 표시하지 않는다. 그러면 저장한 게 사라진 것처럼 보인다.
        if (r && r.ok === false) { setPresets(null); setSaveMsg({ ok: false, text: t('sv_list_failed') }); return; }
        setPresets((r && r.items) || []);
      }).catch(() => { setPresets(null); setSaveMsg({ ok: false, text: t('sv_list_failed') }); });
    }, []);

    const savePreset = useCallback(async () => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedCreate) return;
      // 차트에서 직접 읽는다 — 이 패널은 차트와 같은 화면에 있으므로 항상 실제 값이다.
      const inds = [...active.entries()].map(([name, paneId]) => ({
        name, paneId, calcParams: (params.get(name) || []).slice(),
      }));
      if (inds.length === 0) { setSaveMsg({ ok: false, text: t('sv_no_indicators') }); return; }
      setBusy(true);
      setSaveMsg(null);
      try {
        const r = await api.savedCreate({
          kind: 'indicator', scope: 'global',
          name: t('sv_indicator_preset_name', { n: inds.length }),
          payload: { indicators: inds },
        });
        if (r && r.ok !== false) {
          setSaveMsg({ ok: true, text: t('sv_saved_ok', { n: (r && r.charged) || 0 }) });
          loadPresets(); // ★ 저장 직후 목록을 새로 읽는다. 안 하면 방금 저장한 게 안 보인다.
        } else setSaveMsg({ ok: false, text: (r && r.message) || t('sv_save_failed') });
      } catch (e) {
        setSaveMsg({ ok: false, text: e && e.status === 402 ? t('sv_need_points') : ((e && e.message) || t('sv_save_failed')) });
      }
      setBusy(false);
    }, [active, params, loadPresets]);

    /** 저장된 프리셋을 차트에 적용한다. 켜져 있던 지표는 먼저 내린다. */
    const applyPreset = useCallback((item) => {
      const chart = getChart && getChart();
      if (!chart) return;
      const list = (item && item.payload && item.payload.indicators) || [];
      if (!Array.isArray(list) || list.length === 0) { setSaveMsg({ ok: false, text: t('sv_preset_empty') }); return; }
      for (const [name, paneId] of active.entries()) {
        try { chart.removeIndicator({ paneId, name }); } catch (e) { /* noop */ }
      }
      let applied = 0;
      for (const ind of list) {
        const nm = ind && ind.name;
        if (!nm) continue;
        try {
          const onCandle = ind.paneId === 'candle_pane';
          chart.createIndicator({ name: nm, ...(onCandle ? { paneId: 'candle_pane' } : {}) }, onCandle);
          if (Array.isArray(ind.calcParams) && ind.calcParams.length) {
            chart.overrideIndicator({ name: nm, calcParams: ind.calcParams.slice() });
            setCalc(nm, ind.calcParams.slice());
          }
          applied += 1;
        } catch (e) { /* 개별 지표 실패는 나머지를 막지 않는다 */ }
      }
      // ★ 요청한 개수가 아니라 **실제로 올라간 개수**를 알린다.
      setSaveMsg({ ok: applied > 0, text: t('sv_preset_applied', { n: applied, total: list.length }) });
      setPresetsOpen(false);
      setTimeout(syncFromChart, 0);
    }, [active, getChart, syncFromChart]);

    const deletePreset = useCallback((id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedDelete) return;
      api.savedDelete(id).then(loadPresets).catch(() => setSaveMsg({ ok: false, text: t('sv_delete_failed') }));
    }, [loadPresets]);

    const togglePresets = useCallback(() => {
      setPresetsOpen((o) => { const n = !o; if (n) loadPresets(); return n; });
    }, [loadPresets]);

    const groups = Object.keys(filtered);
    const totalShown = groups.reduce((n, g) => n + filtered[g].length, 0);

    return (
      <div
        className="chart-ind-panel"
        ref={panelRef}
        style={fixedPos ? { position: 'fixed', top: fixedPos.top, left: fixedPos.left, right: 'auto', zIndex: 200 } : undefined}
      >
        <div className="chart-ind-panel__head">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('indicators_search_placeholder')}
            aria-label={t('indicators_search_placeholder')}
          />
          <span className="chart-ind-panel__count">{active.size}/{all.length}</span>
        </div>

        {/* 프리셋 저장/불러오기 — 차트와 같은 화면이라 켜둔 지표를 실제로 읽을 수 있다. */}
        <div className="chart-ind-panel__presets">
          <button
            type="button"
            className="btn btn--sm"
            onClick={savePreset}
            disabled={busy || active.size === 0}
            title={active.size === 0 ? t('sv_no_indicators') : t('sv_save_preset')}
          >
            {t('sv_save_preset')}{active.size > 0 ? ' (' + active.size + ')' : ''}
          </button>
          <button
            type="button"
            className={'btn btn--sm' + (presetsOpen ? ' is-active' : '')}
            onClick={togglePresets}
            aria-expanded={presetsOpen}
          >
            {t('sv_my_presets')}{Array.isArray(presets) ? ' · ' + presets.length : ''}
          </button>
        </div>

        {saveMsg && (
          <div
            role="status"
            className={'chart-ind-panel__msg' + (saveMsg.ok ? ' is-ok' : ' is-err')}
          >
            {saveMsg.text}
          </div>
        )}

        {presetsOpen && (
          <div className="chart-ind-panel__preset-list">
            {presets === null ? (
              <div className="chart-ind-panel__preset-empty">
                {t('sv_list_failed')}{' '}
                <button type="button" className="btn btn--sm" onClick={loadPresets}>{t('sv_retry')}</button>
              </div>
            ) : presets.length === 0 ? (
              <div className="chart-ind-panel__preset-empty">{t('sv_empty')}</div>
            ) : presets.map((it) => (
              <div key={it.id} className="chart-ind-panel__preset-row">
                <span className="chart-ind-panel__preset-name">{it.name}</span>
                <button type="button" className="btn btn--sm" onClick={() => applyPreset(it)}>{t('sv_load')}</button>
                <button type="button" className="btn btn--sm" onClick={() => deletePreset(it.id)}>{t('sv_delete')}</button>
              </div>
            ))}
          </div>
        )}

        <div className="chart-ind-panel__body">
          {totalShown === 0 && <div className="chart-ind-panel__empty">{t('no_match')}</div>}
          {GROUP_ORDER.map((g) => {
            const items = filtered[g];
            if (!items || items.length === 0) return null;
            return (
              <div key={g}>
                <div className="chart-ind-group">{t(`indicators_group_${g}`)}</div>
                {items.map((item) => {
                  const on = active.has(item.name);
                  const plist = params.get(item.name) || [];
                  const canEdit = on && plist.length > 0;
                  return (
                    <div key={item.name} className="chart-ind-rowwrap">
                      <button
                        className={`chart-ind-row ${on ? 'is-on' : ''}`}
                        onClick={() => toggle(item)}
                        aria-pressed={on}
                        title={descOf(item.name)}
                      >
                        <span className="chart-ind-row__check">{on ? '✓' : ''}</span>
                        <span className="chart-ind-row__name">{item.name}</span>
                        <span className="chart-ind-row__desc">{descOf(item.name)}</span>
                        <span className="chart-ind-row__pane">
                          {t(item.overlay ? 'indicators_placement_overlay' : 'indicators_placement_pane')}
                        </span>
                      </button>
                      {canEdit && (
                        <button
                          className={`chart-ind-gear ${editing === item.name ? 'is-on' : ''}`}
                          onClick={() => setEditing(editing === item.name ? null : item.name)}
                          title={t('nav_settings')}
                          aria-label={t('nav_settings')}
                          aria-expanded={editing === item.name}
                        >⚙</button>
                      )}
                      {canEdit && editing === item.name && (
                        <div className="chart-ind-params">
                          {plist.map((val, i) => (
                            <input
                              key={i}
                              type="number"
                              min="1"
                              className="chart-ind-param"
                              value={val}
                              onChange={(e) => updateParam(item, i, e.target.value)}
                              aria-label={`${item.name} ${i + 1}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="chart-ind-panel__foot">
          <span className="chart-ind-panel__count">
            {active.size > 0 ? [...active.keys()].join(' · ') : t('indicators_none_active')}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={clearAll} disabled={active.size === 0}>
            {t('clear')}
          </button>
        </div>
      </div>
    );
  };

  window.ChartIndicatorsMeta = { PLACEMENT, GROUP_ORDER, supportedIndicators };
})();

/* ============================================================
   활성 지표 공유 저장소
   ------------------------------------------------------------
   왜 필요한가

     AI 코파일럿의 맥락 칩은 "지금 어떤 지표가 켜져 있는지" 를 보여준다. 그런데
     차트 인스턴스는 ChartWidget 안에만 있어서, 코파일럿에 맥락을 넘겨주는 쪽
     (App)에서는 접근할 수 없다. 그래서 전에는 `MA20 · MA60 · MA120` 이 그냥
     적혀 있었다 — 사용자가 무엇을 켰는지와 아무 상관이 없는 글자다.

   ★ 차트를 소유한 쪽이 값을 적고, 필요한 쪽이 읽는다. 반대 방향(코파일럿이
     차트를 찾아가는 것)으로 만들면 차트가 없는 화면에서 깨진다.

   ★ 읽지 못하면 null 이다. 빈 배열로 두면 "지표를 하나도 켜지 않았다" 는
     사실 주장이 되어버린다 — 우리가 확인한 것이 아니다.
   ============================================================ */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  let current = null;                 // string[] | null
  const listeners = new Set();

  function publish(names) {
    const next = Array.isArray(names) && names.length ? [...new Set(names)] : null;
    // 같은 내용이면 알리지 않는다 (불필요한 재렌더를 만들지 않는다).
    const same = (a, b) => (a === b) || (Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((x, i) => x === b[i]));
    if (same(current, next)) return;
    current = next;
    listeners.forEach((fn) => { try { fn(current); } catch (e) { /* 한 구독자의 오류가 나머지를 막지 않는다 */ } });
  }

  /*
     설정값까지 담은 지표 목록.

     ★ 이름 목록(current)과 따로 둔다. 이름 목록은 화면 칩이 쓰고, 이쪽은
       학습 기록이 쓴다. 한 값으로 합치면 칩이 `MA{"calcParams":[20]}` 같은
       글자를 표시하게 된다.
  */
  let currentDetail = null;           // Array<{id, params?}> | null

  window.QTChartState = {
    publishIndicators: publish,
    getIndicators: () => current,
    publishIndicatorDetail(list) {
      currentDetail = Array.isArray(list) && list.length ? list : null;
    },
    /** 설정값까지 담은 활성 지표. 모르면 null (빈 배열이 아니다). */
    getIndicatorDetail: () => currentDetail,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** React 훅 — 값이 바뀌면 다시 렌더된다. */
    useIndicators() {
      const [v, setV] = useState(current);
      useEffect(() => window.QTChartState.subscribe(setV), []);
      return v;
    },
  };
})();
