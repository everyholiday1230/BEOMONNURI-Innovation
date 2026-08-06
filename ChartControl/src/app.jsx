/* ============================================================
   Main App — routing shell, header, sidebar, trading screen
   ============================================================ */

(function () {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const I = window.Icons;
  const { fmt, fmtPct, fmtCompact, fmtPrice } = window.QTFmt;

  // ---- Persist / read tweaks state ----
  /**
   * 기본 언어를 브라우저 설정에서 결정한다.
   *
   * 해외 우선 출시이므로 기본은 영어다. 다만 한국어 브라우저에서는 한국어를
   * 보여주는 것이 맞으므로 navigator.language 를 본다. 사용자가 Tweaks 에서
   * 직접 바꾸면 그 선택이 localStorage 에 저장되어 이 함수보다 우선한다.
   */
  function detectDefaultLang() {
    // 언어 후보를 하드코딩하지 않는다. i18n 레지스트리에 등록된 언어와
    // 브라우저 설정을 대조하므로, 로케일 파일을 추가하면 자동으로 후보가 된다.
    if (window.QTI18n) return window.QTI18n.detect();
    return 'en';
  }

  const DEFAULT_TWEAKS = {
    theme: 'dark',
    brand: 'institutional-cool',
    longshort: 'teal-magenta',
    density: 'comfortable',
    presetId: 'standard-trader',
    lang: detectDefaultLang(),
    pro: true,      // Pro is default (interactions_depth 8)
    numFmt: 'standard',
    role: 'user',   // user | ops | admin | super
  };

  function useTweaks() {
    const [state, setState] = useState(() => {
      const saved = localStorage.getItem('qt.tweaks');
      if (saved) { try { return { ...DEFAULT_TWEAKS, ...JSON.parse(saved) }; } catch (e) {} }
      return DEFAULT_TWEAKS;
    });
    useEffect(() => {
      localStorage.setItem('qt.tweaks', JSON.stringify(state));
      const root = document.documentElement;
      root.dataset.theme = state.theme;
      root.dataset.brand = state.brand;
      root.dataset.longshort = state.longshort;
      root.dataset.density = state.density;
      // 언어는 i18n 이 단일 출처다. setLocale 이 document lang 도 갱신한다.
      if (window.QTI18n) window.QTI18n.setLocale(state.lang);
      else root.setAttribute('lang', state.lang);
    }, [state]);
    const set = useCallback((partial) => setState(s => ({ ...s, ...partial })), []);
    return [state, set];
  }

  /**
   * 유효 등급 — 화면 권한 판단의 단일 출처.
   *
   * 서버 세션이 있으면 **서버 등급만** 쓴다. 헤더의 등급 스위치는 디자이너가
   * 화면을 미리 보기 위한 도구이므로 지우지 않지만, 백엔드가 붙은 상태에서는
   * 효력이 없다. 그러지 않으면 콘솔에서 등급을 바꿔 관리자 화면을 열 수 있다.
   *
   *   백엔드 있음 + 로그인  → 서버 등급
   *   백엔드 있음 + 비로그인 → null (등급 제한이 있는 것은 아무것도 못 봄)
   *   백엔드 없음(정적 프리뷰) → 스위치 값 (실데이터가 없으니 위험하지 않다)
   *
   * 이건 1겹(화면 숨김)이다. 실제 차단은 서버가 403 으로 한다.
   */
  function useEffectiveRole(tweaksRole) {
    const [snap, setSnap] = useState(() =>
      window.QTAuth ? window.QTAuth.get() : { tier: null, loading: false, offline: true }
    );

    useEffect(() => {
      if (!window.QTAuth) return undefined;
      setSnap(window.QTAuth.get());
      return window.QTAuth.subscribe((s) => setSnap({ ...s }));
    }, []);

    // 백엔드가 없으면 스위치를 그대로 쓴다 (정적 프리뷰 계약).
    if (!window.QTAuth || snap.offline) {
      return { role: tweaksRole, loading: false, offline: true, user: null, switchActive: true };
    }
    return {
      role: snap.tier,
      loading: snap.loading,
      offline: false,
      user: snap.user || null,
      switchActive: false,
    };
  }

  // ---- Router hash ----
  function useRoute() {
    const [route, setRoute] = useState(() => {
      const hash = window.location.hash.replace(/^#/, '') || '/trade';
      const [path, qs] = hash.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      return { path, query };
    });
    useEffect(() => {
      const onHash = () => {
        const hash = window.location.hash.replace(/^#/, '') || '/trade';
        const [path, qs] = hash.split('?');
        setRoute({ path, query: Object.fromEntries(new URLSearchParams(qs || '')) });
      };
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const push = useCallback((path, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      window.location.hash = path + (qs ? '?' + qs : '');
    }, []);
    return [route, push];
  }

  // ---- Toasts ----
  function useToasts() {
    const [toasts, setToasts] = useState([]);
    const push = useCallback((toast) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, ...toast }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.duration || 4200);
    }, []);
    return [toasts, push];
  }

  // ============================================================
  // ROOT APP
  // ============================================================
  window.App = function App() {
    const [tweaks, setTweaks] = useTweaks();
    // 화면 권한의 단일 출처. 백엔드가 붙으면 서버 등급이 스위치를 덮어쓴다.
    const auth = useEffectiveRole(tweaks.role);
    const [route, pushRoute] = useRoute();
    const [tweaksOpen, setTweaksOpen] = useState(false);
    const [toasts, pushToast] = useToasts();
    // 번역 조회를 i18n 레지스트리에 위임한다. 디자이너가 만든 QT.I18N 60키는
    // QTI18n.absorbLegacy() 가 흡수하므로 기존 키가 그대로 동작한다.
    const t = useCallback(
      (k, vars) => (window.QTI18n ? window.QTI18n.t(k, vars) : ((QT.I18N[tweaks.lang] && QT.I18N[tweaks.lang][k]) || k)),
      [tweaks.lang],
    );

    // Layout engine
    const engine = window.useLayoutEngine(tweaks.presetId);
    useEffect(() => {
      if (engine.presetId !== tweaks.presetId) engine.applyPreset(tweaks.presetId);
    }, [tweaks.presetId]);
    useEffect(() => {
      // Reflect engine-driven preset changes back into Tweaks (so tweaks panel highlights the current preset)
      if (engine.presetId !== tweaks.presetId) setTweaks({ presetId: engine.presetId });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.presetId]);

    // Market state / candles / stream
    const [market, setMarket] = useState(() => QT.MARKETS.find(m => m.base === 'BTC'));
    const [timeframe, setTimeframe] = useState('15m');

    // 실데이터 브릿지: 실캔들/실시세가 도착하면 liveVersion 이 올라가고
    // 아래 useMemo 가 다시 계산된다. 백엔드가 없으면 항상 0 이며 목업이 쓰인다.
    const liveVersion = window.QTLive ? window.QTLive.useLiveVersion() : 0;

    // 활성 심볼/타임프레임을 브릿지에 알린다. 이 심볼만 WebSocket 으로 구독된다.
    useEffect(() => {
      if (window.QTLive) window.QTLive.setActiveSymbol(market.base + market.quote);
    }, [market.base, market.quote]);

    // 심볼이 바뀌면 헤더/주문창이 이전 심볼 가격을 들고 있지 않게 즉시 갱신한다.
    // market.price 는 마켓 목록 폴링으로 21개 심볼 모두 실시간 값이 채워져 있다.
    useEffect(() => {
      if (market.price > 0) {
        setLastPrice(market.price);
        setPrevPrice(market.price);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market.base, market.quote]);

    // 심볼이 바뀌면 이전 심볼의 오더북/체결을 즉시 버린다.
    // 그러지 않으면 ETH 화면에 BTC 체결가(68,4xx)가 남아 섞여 보인다.
    //
    // 심볼 전환 직후에는 실데이터가 아직 도착하지 않아 목업이 시딩된다.
    // 그래서 실데이터가 들어올 때까지(liveVersion 변화) 재시딩을 반복하고,
    // 실데이터를 한 번 받으면 멈춘다. 계속 재시딩하면 누적된 실시간 체결이
    // 매번 지워지기 때문이다.
    // 실데이터 여부는 symbol 필드 유무로 판별한다(목업에는 없다).
    const seededRef = useRef(null);
    useEffect(() => {
      const key = market.base + market.quote;
      if (seededRef.current === key) return;

      const book = QT.generateOrderBook(market.price);
      const tape = QT.generateTrades(market.price, 60);
      setOrderBook(book);
      setTrades(tape);

      const bookIsLive = book && book.symbol === key;
      const tapeIsLive = tape.length > 0 && tape[0].symbol === key;
      if (bookIsLive && tapeIsLive) seededRef.current = key;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market.base, market.quote, liveVersion]);
    useEffect(() => {
      if (window.QTLive) window.QTLive.setActiveTimeframe(timeframe);
    }, [timeframe]);

    const candles = useMemo(() => QT.generateCandles({ symbol: market.base + market.quote, tf: timeframe, count: 220, endPrice: market.price }), [market.base, market.quote, timeframe, market.price, liveVersion]);
    const [lastPrice, setLastPrice] = useState(market.price);
    const [prevPrice, setPrevPrice] = useState(market.price);
    const [orderBook, setOrderBook] = useState(() => QT.generateOrderBook(market.price));
    const [trades, setTrades] = useState(() => QT.generateTrades(market.price, 60));
    const [conn, setConn] = useState('live');
    const [latency, setLatency] = useState(34);

    useEffect(() => {
      const offTick = QT.stream.on('tick', (s) => {
        setPrevPrice(lp => (lp !== s.price ? lp : lp));
        setLastPrice(s.price);
        setLatency(Math.round(s.latencyMs));
      });
      const offOb = QT.stream.on('orderbook', (ob) => setOrderBook(ob));
      const offTrade = QT.stream.on('trade', (tr) => setTrades(prev => [tr, ...prev].slice(0, 80)));
      const offConn = QT.stream.on('connection', (c) => setConn(c.state));
      QT.stream.start();
      return () => { offTick(); offOb(); offTrade(); offConn(); QT.stream.stop(); };
    }, []);

    // Overlays (AI signals + user drawings)
    //
    // 오버레이는 심볼에 귀속된다. ChartCanvas 가 오버레이 가격을 Y축 범위에
    // 포함시키기 때문에(클리핑 방지), 다른 심볼의 오버레이가 남아 있으면
    // 가격대가 다른 심볼로 전환했을 때 캔들이 짜부라진다.
    // 예: BTC 오버레이 67,285 가 남은 상태에서 ETH(1,871) 를 보면
    //     Y범위가 [-3457, 73000] 이 되어 차트가 직선이 된다. (실제로 재현했다)
    // 그래서 각 오버레이에 symbol 을 달고, 현재 심볼 것만 차트에 넘긴다.
    const [overlays, setOverlays] = useState([
      // Seed a couple of orders/positions as overlays
      {
        id: 'ord-1', type: 'horizontal', source: 'order', symbol: 'BTCUSDT',
        points: [{ price: 67800, time: Date.now() }],
        label: 'Open Order · Long 0.05 @ 67,800'
      },
      {
        id: 'pos-1', type: 'horizontal', source: 'position-long', symbol: 'BTCUSDT',
        points: [{ price: 67285.4, time: Date.now() }],
        label: 'Position Entry · Long 0.185'
      },
    ]);
    const activeSymbolKey = market.base + market.quote;
    const addOverlay = useCallback((ov) => setOverlays(prev => [...prev.filter(x => x.id !== ov.id), { symbol: activeSymbolKey, ...ov }]), [activeSymbolKey]);
    const updateOverlay = useCallback((id, patch) => setOverlays(prev => prev.map(o => o.id === id ? { symbol: o.symbol, ...patch } : o)), []);
    const removeOverlay = useCallback((id) => setOverlays(prev => prev.filter(o => o.id !== id)), []);
    const clearAIOverlays = useCallback(() => setOverlays(prev => prev.filter(o => o.source !== 'ai-draft' && o.source !== 'ai-approved')), []);

    // 차트/위젯에 넘길 오버레이. 심볼이 지정되지 않은 것(구버전 저장분)은
    // 어느 심볼에서도 가격축을 망치지 않도록 현재 심볼에서만 보여준다.
    const visibleOverlays = useMemo(
      () => overlays.filter(o => !o.symbol || o.symbol === activeSymbolKey),
      [overlays, activeSymbolKey]
    );

    // AI signal state (Flow 5)
    const [currentSignal, setCurrentSignal] = useState(null);
    const [orderDraft, setOrderDraft] = useState(null);   // { price, size, side, tpsl }

    // Click on order book price → prefill Order Entry
    const handleClickPrice = useCallback((price) => {
      setOrderDraft(d => ({ ...(d || { size: 0.05, side: 'long' }), price }));
      pushToast({ title: t('toast_price_filled', { price: fmtPrice(price) }), desc: t('toast_price_filled_desc'), variant: 'info', duration: 2000 });
    }, []);

    const [orderPreview, setOrderPreview] = useState(null); // modal
    const [flowStep, setFlowStep] = useState('idle'); // idle | draft | user-review | approved | order-draft | preview | risk-check | confirm | submitted

    const proposeSignal = useCallback((sig) => {
      setCurrentSignal({ ...sig, status: 'draft' });
      setFlowStep('user-review');
    }, []);
    const approveSignal = useCallback(() => {
      setCurrentSignal(s => s ? { ...s, status: 'approved' } : s);
      // Also flip AI overlays to approved variant
      setOverlays(prev => prev.map(o => o.source === 'ai-draft' && o.id.startsWith('sig') ? { ...o, source: 'ai-approved', style: { ...(o.style||{}), dashed: false } } : o));
      setFlowStep('approved');
      pushToast({ title: t('toast_signal_approved'), desc: t('toast_signal_approved_desc'), variant: 'success' });
    }, [pushToast]);
    const rejectSignal = useCallback(() => {
      setCurrentSignal(null);
      clearAIOverlays();
      setFlowStep('idle');
      pushToast({ title: t('toast_signal_rejected'), desc: t('toast_signal_rejected_desc'), variant: 'warning' });
    }, [clearAIOverlays, pushToast]);
    const createOrderDraft = useCallback(() => {
      if (!currentSignal) return;
      setOrderDraft({
        side: currentSignal.direction,
        price: (currentSignal.entryZone[0] + currentSignal.entryZone[1]) / 2,
        size: 0.05,
        tpsl: {
          tp: currentSignal.takeProfits,
          sl: currentSignal.stopLoss,
        }
      });
      setFlowStep('order-draft');
      pushToast({ title: t('toast_draft_created'), desc: t('toast_draft_created_desc'), variant: 'ai' });
    }, [currentSignal, pushToast]);

    // ---- Order flow ----
    /**
     * 1단계 — 주문 검증.
     *
     * 서버가 수수료·청산가·필요증거금을 계산해 준다. 클라이언트 계산값을
     * 그대로 보여주면 서버와 어긋날 수 있고, 사용자는 화면 숫자를 믿고 주문한다.
     * 그래서 서버 값이 오면 그것으로 덮어쓴다.
     */
    const placeOrder = useCallback((data) => {
      if (data.hasErrors) {
        pushToast({ title: t('toast_order_invalid'), desc: t('toast_order_invalid_desc'), variant: 'error' });
        return;
      }

      // 백엔드가 없으면 화면 흐름만 보여준다 (정적 프리뷰 계약).
      if (!window.QTApi || !window.QTApi.orders) {
        setOrderPreview(data);
        setFlowStep('preview');
        return;
      }

      setOrderPreview(data);
      setFlowStep('preview');

      window.QTApi.orders.createDraft({
        symbol: market.symbol || (market.base + market.quote),
        side: data.side,
        orderType: data.type,
        price: data.price,
        quantity: data.size,
        leverage: data.leverage || market.leverage || 10,
        reduceOnly: data.reduceOnly,
        postOnly: data.postOnly,
        tif: data.tif,
      })
        .then((res) => {
          // 서버 계산값으로 미리보기를 교체한다. 화면 숫자와 실제 체결 조건을 일치시킨다.
          setOrderPreview((prev) => (prev ? { ...prev, draft: res, serverPreview: res.preview } : prev));
        })
        .catch((err) => {
          setFlowStep('idle');
          setOrderPreview(null);
          pushToast({
            title: t('toast_order_rejected'),
            desc: (err && err.message) || t('toast_order_invalid_desc'),
            variant: 'error',
          });
        });
    }, [pushToast, market]);

    /**
     * 2단계 — 사용자가 확인을 누른 시점.
     *
     * 서버 확인 게이트가 두 겹이다(토큰 일치 + userConfirmed). 여기서만
     * userConfirmed 를 보낸다 — 자동으로 붙이면 게이트가 무의미해진다.
     */
    const confirmOrder = useCallback(async () => {
      const draft = orderPreview && orderPreview.draft;

      if (!window.QTApi || !window.QTApi.orders || !draft) {
        // 정적 프리뷰 또는 검증 응답 대기 중. 화면 흐름만 진행한다.
        setFlowStep('risk-check');
        await new Promise(r => setTimeout(r, 500));
        setFlowStep('confirm');
        await new Promise(r => setTimeout(r, 400));
        setFlowStep('submitted');
        pushToast({
          title: t('toast_order_accepted', { side: t(orderPreview.side === 'long' ? 'side_long' : 'side_short') }),
          desc: t('toast_order_accepted_desc', { size: fmt(orderPreview.size, 4), base: market.base, price: fmt(orderPreview.price, 1) }),
          variant: 'success'
        });
        setTimeout(() => { setOrderPreview(null); setFlowStep('idle'); }, 1000);
        return;
      }

      setFlowStep('risk-check');
      try {
        const res = await window.QTApi.orders.confirm(draft);
        setFlowStep('confirm');
        const order = res && res.order;
        setFlowStep('submitted');
        pushToast({
          title: t('toast_order_accepted', { side: t(orderPreview.side === 'long' ? 'side_long' : 'side_short') }),
          // 서버가 알려준 실제 상태를 보여준다. '접수됨'과 '체결됨'은 다른 사실이다.
          desc: t('toast_order_status_desc', {
            status: (order && order.status) || 'ACCEPTED',
            size: fmt(Number((order && order.quantity) || orderPreview.size), 4),
            base: market.base,
            price: fmt(Number((order && order.price) || orderPreview.price), 1),
          }),
          variant: 'success',
        });
        setTimeout(() => { setOrderPreview(null); setFlowStep('idle'); }, 1200);
      } catch (err) {
        setFlowStep('idle');
        pushToast({
          title: t('toast_order_rejected'),
          desc: (err && err.message) || t('toast_order_invalid_desc'),
          variant: 'error',
        });
        setTimeout(() => setOrderPreview(null), 300);
      }
    }, [orderPreview, market, pushToast]);

    // ---- Enter Edit Mode ----
    useEffect(() => {
      const isEdit = route.query.mode === 'layout-edit';
      engine.setIsEditing(isEdit);
    }, [route.query.mode]);

    // Keyboard shortcuts
    useEffect(() => {
      const onKey = (e) => {
        if (e.target.matches('input, textarea')) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); engine.undo(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); engine.redo(); }
        else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); engine.save(); pushToast({ title: 'Layout Saved', variant: 'success' }); }
        else if (e.key === 'Escape' && engine.isEditing) {
          if (engine.dirty && !confirm(t('confirm_unsaved_leave'))) return;
          pushRoute('/trade');
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [engine, pushRoute, pushToast]);

    // ---- Compute layout with drag preview ----
    // (Widget positions are updated on-the-fly during drag/resize via engine.updateWidget)

    const bodyRef = useRef(null);
    const isBeginner = !tweaks.pro;

    const chartContext = useMemo(() => ({
      symbol: market.base + '/' + market.quote,
      tf: timeframe,
      price: lastPrice,
      candles,
    }), [market, timeframe, lastPrice, candles]);

    // ---- shellProps for new-page components ----
    const shellProps = {
      activePath: route.path,
      // 서버 세션 등급. 비로그인이면 null 이다 — 'user' 로 가정하지 않는다.
      role: auth.role,
      // 등급을 아직 확인 중인지. 화면이 권한 판단을 미룰 수 있게 넘긴다.
      roleLoading: auth.loading,
      user: auth.user,
      onNavigate: (fullPath) => {
        // fullPath like "/markets" or "/trade?symbol=BTCUSDT"
        const [path, qs] = fullPath.split('?');
        const q = Object.fromEntries(new URLSearchParams(qs || ''));
        pushRoute(path, q);
      },
    };

    // ---- Route dispatch — return early for non-trade routes ----
    const isTradeRoute = route.path === '/trade' || !route.path;
    // Auth/Landing routes have no sim-stripe, no header, no sidebar (fully custom shell)
    const isAuthRoute = ['/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset'].includes(route.path);

    // All known routes — anything not in this list is 404
    const ALL_KNOWN_ROUTES = [
      '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
      '/trade',
      '/markets', '/ai-strategies', '/ai-strategies/detail', '/ai-strategies/my',
      '/portfolio', '/analytics', '/multi-chart',
      '/wallet', '/wallet/deposit', '/wallet/withdraw', '/wallet/transactions',
      '/referral', '/fees', '/help', '/settings', '/notifications', '/order-history',
      '/admin', '/admin/users', '/admin/users/detail', '/admin/trades', '/admin/ai-ops',
      '/admin/design-ops', '/admin/risk', '/admin/assets', '/admin/kyc',
      '/admin/deposits', '/admin/withdrawals', '/admin/fees', '/admin/notices',
      '/admin/notices/new', '/admin/system', '/admin/audit', '/admin/broadcast', '/admin/cs',
    ];

    // 구현 상태 표시(provenance.js)가 "상태 등록을 빠뜨린 라우트" 를 찾을 수 있게
    // 목록을 노출한다. 라우트를 추가하고 상태 등록을 잊으면 audit() 이 잡아낸다.
    window.QT_ALL_ROUTES = ALL_KNOWN_ROUTES;
    const isKnownRoute = ALL_KNOWN_ROUTES.includes(route.path);
    const isNotFound = !isKnownRoute;

    // ============================================================
    // RENDER
    // ============================================================
    // Auth/Landing/NotFound routes render fully-custom shells (no header/sidebar/sim-stripe)
    if (isAuthRoute || isNotFound) {
      return (
        <>
          {route.path === '/'               && <window.LandingPage        shellProps={shellProps}/>}
          {route.path === '/login'          && <window.LoginPage          shellProps={shellProps}/>}
          {route.path === '/signup'         && <window.SignupPage         shellProps={shellProps}/>}
          {route.path === '/verify-email'   && <window.EmailVerifyPage    shellProps={shellProps}/>}
          {route.path === '/kyc'            && <window.KYCOnboardingPage  shellProps={shellProps}/>}
          {route.path === '/password-reset' && <window.PasswordResetPage  shellProps={shellProps}/>}
          {isNotFound && <window.NotFoundPage shellProps={shellProps} message={t('notfound_path', { path: route.path })}/>}

          {/* Toasts still render even in auth mode */}
          <div className="toast-region">
            {toasts.map(t => (
              <div key={t.id} className={`toast toast--${t.variant || 'info'}`}>
                <div className="toast__title">{t.title}</div>
                {t.desc && <div className="toast__desc">{t.desc}</div>}
              </div>
            ))}
          </div>
        </>
      );
    }

    return (
      <div className="app-shell app-shell--v2">
        {/* SIMULATION STRIPE — persistent global affordance */}
        <div className="sim-stripe" style={{gridColumn:'1 / -1'}}>
          <div className="sim-stripe__left">
            <span className="sim-stripe__badge">SIMULATION</span>
            <span>Mock data · No real funds at risk · Prototype demo</span>
          </div>
          <div className="sim-stripe__right">
            <span>Session · SIM-{new Date().getUTCFullYear()}-{String(new Date().getUTCMonth()+1).padStart(2,'0')}-KURI</span>
            <span>·</span>
            <span>Data seed · deterministic</span>
          </div>
        </div>

        {/* HEADER */}
        <header className="app-header" style={{gridColumn:'1 / -1'}}>
          <a className="app-brand" href="#/trade">
            <span className="app-brand__mark">Q</span>
            <span className="app-brand__name">QuantumTrade</span>
            <span className="app-brand__ver">v1.0</span>
          </a>

          <div className="seg" style={{marginRight: 8}}>
            <button className="seg__opt">{t('mode_spot')}</button>
            <button className="seg__opt is-active">{t('mode_futures')}</button>
            <button className="seg__opt">{t('mode_paper')}</button>
          </div>

          <nav className="app-nav">
            <a className="app-nav__item" href="#/markets"><I.Grid size={13}/>{t('nav_markets')}</a>
            <a className={`app-nav__item ${route.path === '/trade' ? 'is-active' : ''}`} href="#/trade"><I.Chart size={13}/>{t('nav_trade')}</a>
            <a className="app-nav__item" href="#/trade?workspace=ai" onClick={() => setTweaks({ presetId: 'ai-workspace' })}><I.Sparkles size={13}/>{t('nav_ai')}</a>
            <a className="app-nav__item" href="#/portfolio"><I.Wallet size={13}/>{t('nav_portfolio')}</a>
            <a className="app-nav__item" href="#/analytics"><I.Book size={13}/>{t('nav_analytics')}</a>
          </nav>

          <div className="app-header__right">
            {/*
              등급 스위치 — 디자이너가 화면을 미리 보는 도구다. 버튼은 그대로 둔다.
              백엔드가 붙으면 서버 등급이 우선하므로 이 스위치는 효력이 없다.
              그 사실을 title 로 알려준다 (눌러도 아무 일 없으면 버그로 보인다).
            */}
            <div
              className="role-switcher"
              title={auth.switchActive
                ? t('role_switch_preview')
                : t('role_switch_disabled', { role: auth.role || t('role_none') })}
            >
              {['user','ops','admin','super'].map(r => (
                <button
                  key={r}
                  className={`role-switcher__opt ${(auth.switchActive ? tweaks.role : auth.role) === r ? 'is-active' : ''}`}
                  onClick={() => setTweaks({ role: r })}
                  disabled={!auth.switchActive}
                >
                  {r === 'super' ? 'SUPER' : r.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="conn-cluster" title={`WebSocket ${conn} · Latency ${latency}ms · Mock stream`}>
              <span className={`conn-cluster__seg ${conn === 'live' ? 'is-live' : conn === 'reconnecting' ? 'is-warn' : 'is-err'}`}>
                <span className={`dot ${conn === 'live' ? 'dot--live' : conn === 'reconnecting' ? 'dot--warn' : 'dot--err'}`}/>
                {conn === 'live' ? 'WS' : conn === 'reconnecting' ? 'RECON' : 'DOWN'}
              </span>
              <span className={`conn-cluster__seg conn-cluster__latency ${latency > 200 ? 'is-err' : latency > 100 ? 'is-warn' : ''}`}>
                <span className="k">↔</span>{latency}ms
              </span>
              <span className="conn-cluster__seg" title="Data freshness">
                <span className="k">◷</span>0s
              </span>
            </div>
            <button className="header-tool header-tool--icon" title="Alerts">
              <I.Bell size={14}/>
              <span style={{position:'absolute', top:4, right:4, width:6, height:6, borderRadius:999, background:'var(--color-danger)'}}/>
            </button>
            <button className="header-tool header-tool--icon" onClick={() => setTweaks({ theme: tweaks.theme === 'dark' ? 'light' : 'dark' })} title="Toggle theme">
              {tweaks.theme === 'dark' ? <I.Moon size={14}/> : <I.Sun size={14}/>}
            </button>
            <button className="header-tool" title="Language" onClick={() => setTweaks({ lang: tweaks.lang === 'ko' ? 'en' : 'ko' })}>
              <I.Globe size={13}/>
              <span style={{fontFamily:'var(--font-mono)', fontSize: 11}}>{tweaks.lang.toUpperCase()}</span>
            </button>
            <a className="header-tool" href="design-system.html" target="_blank" title="Design System">
              <I.Book size={13}/><span>Design</span>
            </a>
            <a className="header-tool" href="developer-handoff.html" target="_blank" title="Developer Handoff">
              <I.LayoutIcon size={13}/><span>Handoff</span>
            </a>
            <a className="header-tool" href="design-library/index.html" target="_blank" title="Design Library">
              <I.Layers size={13}/><span>Library</span>
            </a>
            <button className="header-tool" onClick={() => pushRoute('/trade', { mode: 'layout-edit' })}>
              <I.LayoutIcon size={13}/> {t('layout_manager')}
            </button>
            <button className="btn btn--sm btn--primary">
              <I.Plus size={12}/> {t('deposit')}
            </button>
            {/*
              프로필 버튼 — 마크업과 스타일은 그대로다. 동작만 붙였다.
              로그인 상태면 로그아웃, 아니면 로그인 화면으로 보낸다.
              머리글자는 로그인한 이메일에서 뽑는다 (비로그인 시 기존 'K' 유지).
            */}
            <button
              className="header-tool header-tool--icon"
              title={auth.user ? t('profile_signed_in_as', { email: auth.user.email }) : t('profile_sign_in')}
              onClick={() => {
                if (!auth.user) { pushRoute('/login'); return; }
                if (window.QTAuth) {
                  window.QTAuth.logout().then(() => pushRoute('/login'));
                } else {
                  pushRoute('/login');
                }
              }}
            >
              <div style={{width: 22, height: 22, background: 'var(--color-brand)', color:'var(--color-text-inverse)', borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600}}>{auth.user && auth.user.email ? auth.user.email[0].toUpperCase() : 'K'}</div>
            </button>
          </div>
        </header>

        {/* SIDEBAR — legacy sidebar shown only on /trade */}
        {isTradeRoute && (
        <aside className="app-sidebar">
          <a className="sb-item is-active" href="#/trade" title="Trade"><I.Chart size={16}/></a>
          <a className="sb-item" href="#/trade?workspace=ai" onClick={() => setTweaks({ presetId: 'ai-workspace' })} title="AI Workspace"><I.Sparkles size={16}/></a>
          <a className="sb-item" href="#/trade?preset=multi-chart" onClick={() => setTweaks({ presetId: 'multi-chart' })} title="Multi-Chart"><I.Grid size={16}/></a>
          <a className="sb-item" href="#/portfolio" title="Portfolio"><I.Wallet size={16}/></a>
          <a className="sb-item" href="#/analytics" title="Analytics"><I.Book size={16}/></a>
          <div className="sb-sep"/>
          <button className="sb-item" onClick={() => pushRoute('/trade', { mode: 'layout-edit' })} title="Layout Edit"><I.LayoutIcon size={16}/></button>
          <button className="sb-item" onClick={() => setTweaksOpen(v => !v)} title="Tweaks">
            <I.Cog size={16}/>
          </button>
          <div style={{marginTop:'auto'}}/>
          <a className="sb-item" href="design-system.html" target="_blank" title="Design System"><I.Book size={16}/></a>
          <a className="sb-item" href="developer-handoff.html" target="_blank" title="Developer Handoff"><I.LayoutIcon size={16}/></a>
          <a className="sb-item" title="Profile"><I.User size={16}/></a>
        </aside>
        )}

        {/* ============================================================
             ROUTE DISPATCH — non-trade pages
             Each page renders its own PageShell (sidebar + main).
             ============================================================ */}
        {!isTradeRoute && (
          <div style={{gridColumn: '1 / -1', overflow: 'hidden'}}>
            {/* USER PAGES */}
            {route.path === '/markets'        && <window.MarketsPage        shellProps={shellProps}/>}
            {route.path === '/ai-strategies'  && <window.AIStrategiesPage   shellProps={shellProps}/>}
            {route.path === '/ai-strategies/detail' && <window.StrategyDetailPage shellProps={shellProps} strategyId={route.query.id}/>}
            {route.path === '/ai-strategies/my' && <window.MyStrategiesPage shellProps={shellProps}/>}
            {route.path === '/portfolio'      && <window.PortfolioPage      shellProps={shellProps}/>}
            {route.path === '/analytics'      && <window.AnalyticsPage      shellProps={shellProps}/>}
            {route.path === '/multi-chart'    && <window.MultiChartPage     shellProps={shellProps}/>}
            {route.path === '/wallet'         && <window.WalletPage         shellProps={shellProps}/>}
            {route.path === '/wallet/deposit' && <window.DepositPage        shellProps={shellProps}/>}
            {route.path === '/wallet/withdraw'&& <window.WithdrawPage       shellProps={shellProps}/>}
            {route.path === '/wallet/transactions' && <window.TransactionHistoryPage shellProps={shellProps}/>}
            {route.path === '/referral'       && <window.ReferralPage       shellProps={shellProps}/>}
            {route.path === '/fees'           && <window.FeeRebatePage      shellProps={shellProps}/>}
            {route.path === '/help'           && <window.HelpCenterPage     shellProps={shellProps}/>}
            {route.path === '/settings'       && <window.SettingsPage       shellProps={shellProps}/>}
            {route.path === '/notifications'  && <window.NotificationsPage  shellProps={shellProps}/>}
            {route.path === '/order-history'  && <window.OrderHistoryPage   shellProps={shellProps}/>}

            {/* ADMIN routes */}
            {route.path === '/admin'              && <window.AdminDashboardPage  shellProps={shellProps}/>}
            {route.path === '/admin/users'        && <window.AdminUsersPage      shellProps={shellProps}/>}
            {route.path === '/admin/users/detail' && <window.AdminUserDetailPage shellProps={shellProps} userId={route.query.id}/>}
            {route.path === '/admin/trades'       && <window.AdminTradesPage     shellProps={shellProps}/>}
            {route.path === '/admin/ai-ops'       && <window.AdminAIOpsPage      shellProps={shellProps}/>}
            {route.path === '/admin/design-ops'   && <window.AdminDesignOpsPage  shellProps={shellProps}/>}
            {route.path === '/admin/risk'         && <window.AdminRiskPage       shellProps={shellProps}/>}
            {route.path === '/admin/assets'       && <window.AdminAssetsHiFiPage shellProps={shellProps}/>}
            {route.path === '/admin/kyc'          && <window.AdminKYCQueuePage   shellProps={shellProps}/>}
            {route.path === '/admin/deposits'     && <window.AdminDepositsPage   shellProps={shellProps}/>}
            {route.path === '/admin/withdrawals'  && <window.AdminWithdrawalsPage shellProps={shellProps}/>}
            {route.path === '/admin/fees'         && <window.AdminFeesPage       shellProps={shellProps}/>}
            {route.path === '/admin/notices'      && <window.AdminNoticesPage    shellProps={shellProps}/>}
            {route.path === '/admin/notices/new'  && <window.AdminNoticeEditorPage shellProps={shellProps}/>}
            {route.path === '/admin/system'       && <window.AdminSystemPage     shellProps={shellProps}/>}
            {route.path === '/admin/audit'        && <window.AdminAuditPage      shellProps={shellProps}/>}
            {route.path === '/admin/broadcast'    && <window.AdminBroadcastPage  shellProps={shellProps}/>}
            {route.path === '/admin/cs'           && <window.AdminCSTicketPage   shellProps={shellProps} ticketId={route.query.id}/>}

            {/* NotFound is handled in the isAuthRoute block above */}
          </div>
        )}

        {/* MAIN — trade route only */}
        {isTradeRoute && (
        <main className="app-main">
          {/* Layout edit toolbar + preset ribbon */}
          {engine.isEditing && (
            <>
              <window.LayoutEditToolbar
                engine={engine}
                onExit={() => {
                  if (engine.dirty && !confirm(t('confirm_unsaved_leave'))) return;
                  pushRoute('/trade');
                }}
                onSaveAs={() => {
                  const name = prompt(t('prompt_layout_name'), t('prompt_layout_default'));
                  if (name) {
                    engine.save();
                    pushToast({ title: t('toast_layout_saved', { name }), desc: t('toast_layout_saved_desc'), variant: 'success' });
                  }
                }}
                t={t}
              />
              <window.PresetRibbon engine={engine}/>
            </>
          )}

          {/* Symbol Header */}
          <window.SymbolHeader price={lastPrice} prev={prevPrice} market={market} t={t}/>

          {/* Body Grid */}
          <div
            ref={bodyRef}
            className={`trade-body ${engine.isEditing ? 'is-editing' : ''}`}
            style={{ gridTemplateRows: `repeat(auto-fill, ${40}px)` }}
          >
            {engine.layout.widgets.map(w => (
              <window.WidgetHost
                key={w.id}
                widget={w}
                trackRef={bodyRef}
                cols={engine.layout.cols}
                rowH={40}
                gap={6}
                isEditing={engine.isEditing}
                isLocked={engine.isLocked}
                isSelected={engine.selectedId === w.id}
                onSelect={engine.setSelectedId}
                onHide={engine.hideWidget}
                onDuplicate={engine.duplicateWidget}
                onLock={engine.toggleLock}
                onSettings={() => pushToast({ title: 'Widget Settings', desc: '(spec-only — future implementation)', variant: 'info' })}
                onMaximize={() => pushToast({ title: 'Maximize Widget', desc: '(spec-only — future implementation)', variant: 'info' })}
                label={widgetLabel(w.type, t)}
                allWidgets={engine.layout.widgets}
                onChange={(patch) => engine.updateWidget(w.id, patch)}
              >
                <WidgetContent
                  widget={w}
                  market={market}
                  lastPrice={lastPrice}
                  prevPrice={prevPrice}
                  candles={candles}
                  timeframe={timeframe}
                  setTimeframe={setTimeframe}
                  orderBook={orderBook}
                  trades={trades}
                  overlays={visibleOverlays}
                  addOverlay={addOverlay}
                  updateOverlay={updateOverlay}
                  removeOverlay={removeOverlay}
                  onSelectMarket={setMarket}
                  onPlaceOrder={placeOrder}
                  onClickPrice={handleClickPrice}
                  pushToast={pushToast}
                  chartContext={chartContext}
                  currentSignal={currentSignal}
                  proposeSignal={proposeSignal}
                  approveSignal={approveSignal}
                  createOrderDraft={createOrderDraft}
                  rejectSignal={rejectSignal}
                  orderDraft={orderDraft}
                  isBeginner={isBeginner}
                  t={t}
                />
              </window.WidgetHost>
            ))}
          </div>
        </main>
        )}

        {/* Hidden Widget Library drawer (only in edit mode) */}
        {engine.isEditing && engine.libraryOpen && (
          <window.WidgetLibrary engine={engine} onClose={() => engine.setLibraryOpen(false)}/>
        )}

        {/* Toasts */}
        <div className="toast-region">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast--${t.variant || 'info'}`}>
              <div className="toast__title">{t.title}</div>
              {t.desc && <div className="toast__desc">{t.desc}</div>}
            </div>
          ))}
        </div>

        {/* Order preview modal */}
        {orderPreview && (
          <OrderPreviewModal
            order={orderPreview}
            step={flowStep}
            onCancel={() => { setOrderPreview(null); setFlowStep('idle'); }}
            onConfirm={confirmOrder}
            market={market}
            lastPrice={lastPrice}
            t={t}
          />
        )}

        {/* Tweaks panel */}
        <window.TweaksPanel
          tweaks={tweaks}
          setTweaks={setTweaks}
          open={tweaksOpen}
          onClose={() => setTweaksOpen(false)}
          t={t}
        />

        {/* Tweaks toggle button (floating) */}
        {!tweaksOpen && (
          <button
            onClick={() => setTweaksOpen(true)}
            style={{
              position: 'fixed', bottom: 20, right: 20, zIndex: 100,
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--color-brand)', color: 'var(--color-text-inverse)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-3)'
            }}
            title="Open Tweaks"
          >
            <I.Cog size={18}/>
          </button>
        )}
      </div>
    );
  };

  // ============================================================
  // Widget dispatcher
  // ============================================================
  function widgetLabel(type, t) {
    const map = {
      marketWatch: t('market_watch'),
      chart: 'Chart',
      orderBook: t('order_book'),
      recentTrades: t('recent_trades'),
      orderEntry: t('order_entry'),
      positions: t('positions'),
      assetsRisk: t('assets_risk'),
      aiCopilot: t('ai_copilot'),
      miniChart: 'Mini Chart',
    };
    return map[type] || type;
  }

  function WidgetContent(props) {
    const { widget } = props;
    // 실 잔고·포지션이 도착하면 재렌더한다. 이 훅이 없으면 위젯이 최초 렌더의
    // 목업을 계속 보여준다 (QT.POSITIONS 를 바꿔치기해도 React 는 모른다).
    if (window.useAccountData) window.useAccountData();
    switch (widget.type) {
      case 'marketWatch':
        return <window.MarketWatch current={props.market.base + props.market.quote} onSelect={props.onSelectMarket} t={props.t}/>;
      case 'chart':
        return <ChartWidget {...props}/>;
      case 'miniChart':
        return <MiniChartWidget {...props}/>;
      case 'orderBook':
        return <window.OrderBook book={props.orderBook} lastPrice={props.lastPrice} prevPrice={props.prevPrice} onClickPrice={props.onClickPrice} t={props.t}/>;
      case 'recentTrades':
        return <window.RecentTrades trades={props.trades} t={props.t}/>;
      case 'orderEntry':
        return <window.OrderEntry
          lastPrice={props.lastPrice} market={props.market} assets={QT.ASSETS}
          marginMode="CROSS" leverage={20}
          prefillPrice={props.orderDraft?.price}
          prefillSize={props.orderDraft?.size}
          prefillSide={props.orderDraft?.side}
          tpsl={props.orderDraft?.tpsl}
          onPlaceOrder={props.onPlaceOrder}
          isBeginner={props.isBeginner}
          t={props.t}
        />;
      case 'positions':
        return <window.PositionsPanel lastPrice={props.lastPrice} positions={QT.POSITIONS} orders={QT.OPEN_ORDERS} t={props.t}/>;
      case 'assetsRisk':
        return <window.AssetsRisk assets={QT.ASSETS} t={props.t}/>;
      case 'aiCopilot':
        return <window.AICopilot
          context={props.chartContext}
          isBeginner={props.isBeginner}
          overlays={props.overlays}
          addOverlay={props.addOverlay}
          updateOverlay={props.updateOverlay}
          removeOverlay={props.removeOverlay}
          currentSignal={props.currentSignal}
          onProposeSignal={props.proposeSignal}
          onApproveSignal={props.approveSignal}
          onCreateOrderDraft={props.createOrderDraft}
          onRejectSignal={props.rejectSignal}
          t={props.t}
        />;
      default:
        return <div className="panel"><div className="empty"><span>Unknown widget: {widget.type}</span></div></div>;
    }
  }

  // ============================================================
  // Chart widget wrapper (with toolbar + draw tools)
  // ============================================================
  function ChartWidget({ market, lastPrice, candles, timeframe, setTimeframe, overlays, updateOverlay, addOverlay, pushToast, t }) {
    const [activeTool, setActiveTool] = useState('cursor');
    const [showMA, setShowMA] = useState(true);
    // 지표 패널. 버튼 마크업은 그대로 두고 패널만 아래에 띄운다.
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    // KLineChart 인스턴스. 지표 패널이 이걸 통해 지표를 켜고 끈다.
    const chartInstRef = useRef(null);
    const [chartGen, setChartGen] = useState(0);
    const handleChartReady = useCallback((chart) => {
      chartInstRef.current = chart;
      // 인스턴스가 바뀌면 패널이 상태를 다시 읽어야 한다.
      setChartGen(g => g + 1);
    }, []);
    const getChart = useCallback(() => chartInstRef.current, []);
    const supportsIndicators = Boolean(window.ChartIndicatorPanel && window.klinecharts);

    // 차트 액션 (스크린샷·전체화면·드로잉 등). KLineChart API 는 chart-actions.js 가 감싼다.
    const bodyElRef = useRef(null);
    const actions = useMemo(
      () => (window.ChartActions
        ? window.ChartActions.create(getChart, {
            getContainer: () => bodyElRef.current,
            notify: (msg) => pushToast && pushToast(msg),
          })
        : null),
      [getChart, pushToast],
    );

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [magnetMode, setMagnetMode] = useState('normal');
    const [drawingsLocked, setDrawingsLocked] = useState(false);
    const [drawingsHidden, setDrawingsHidden] = useState(false);
    const [isFull, setIsFull] = useState(false);

    // 브라우저 전체화면 상태는 ESC 로도 바뀌므로 이벤트로 추적한다.
    useEffect(() => {
      const onFs = () => {
        setIsFull(Boolean(document.fullscreenElement));
        const chart = getChart();
        if (chart) setTimeout(() => { try { chart.resize(); } catch (e) { /* noop */ } }, 120);
      };
      document.addEventListener('fullscreenchange', onFs);
      return () => document.removeEventListener('fullscreenchange', onFs);
    }, [getChart]);

    /** 드로잉 도구 선택. 그리기 가능한 도구면 KLineChart 그리기를 시작한다. */
    const pickTool = useCallback((toolId) => {
      setActiveTool(toolId);
      if (actions) actions.startDrawing(toolId, magnetMode);
    }, [actions, magnetMode]);

    return (
      <div className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tf">
            {['1m','5m','15m','30m','1H','4H','1D'].map(tf => (
              <button key={tf} className={`chart-tf__btn ${timeframe===tf?'is-active':''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
            ))}
          </div>
          <div className="chart-tool-wrap">
            <button
              className={`chart-tool ${indicatorsOpen ? 'is-active' : ''}`}
              onClick={() => supportsIndicators && setIndicatorsOpen(o => !o)}
              title={supportsIndicators ? t('indicators') : t('indicators_unavailable')}
              aria-expanded={indicatorsOpen}
            >
              {t('indicators')} <I.ChevronDown size={10}/>
            </button>
            {indicatorsOpen && supportsIndicators && (
              <window.ChartIndicatorPanel
                getChart={getChart}
                version={chartGen}
                onClose={() => setIndicatorsOpen(false)}
              />
            )}
          </div>
          {/* Compare(다중 심볼 비교) 와 Replay(과거 재생)는 데이터 배선 설계가
              필요해 아직 미구현이다. 버튼을 없애지 않고, 눌렀을 때 "준비 중"임을
              분명히 알린다 — 눌러도 아무 일 없는 상태로 두지 않는다. */}
          <button
            className="chart-tool"
            title={t('chart_compare')}
            onClick={() => pushToast && pushToast({ title: t('chart_compare'), desc: t('feature_pending'), variant: 'info' })}
          >
            {t('chart_compare')}
          </button>
          <div className="chart-tool-wrap">
            <button
              className={`chart-tool ${templatesOpen ? 'is-active' : ''}`}
              title={t('chart_templates')}
              aria-expanded={templatesOpen}
              onClick={() => setTemplatesOpen(o => !o)}
            >
              {t('chart_templates')}
            </button>
            {templatesOpen && window.ChartTemplatePanel && (
              <window.ChartTemplatePanel
                getChart={getChart}
                version={chartGen}
                symbol={`${market.base}${market.quote}`}
                timeframe={timeframe}
                notify={pushToast}
                onClose={() => setTemplatesOpen(false)}
              />
            )}
          </div>
          <div className="chart-toolbar__sep"/>
          <button
            className="chart-tool"
            style={{color:'var(--color-ai)'}}
            title={t('chart_ai_analyze')}
            onClick={() => {
              // AI Copilot 이 이미 분석 흐름을 갖고 있다. 그쪽을 호출한다.
              if (window.QTAiBridge && window.QTAiBridge.requestAnalysis) {
                window.QTAiBridge.requestAnalysis({ symbol: `${market.base}/${market.quote}`, timeframe });
              } else if (pushToast) {
                pushToast({ title: t('chart_ai_analyze'), desc: t('ai_open_copilot'), variant: 'ai' });
              }
            }}
          >
            <I.Sparkles size={12}/> {t('chart_ai_analyze')}
          </button>
          <div style={{marginLeft:'auto', display:'inline-flex', gap: 2}}>
            {/* Replay 는 과거 재생 기능이라 설계가 필요하다. 지금은 "최신 캔들로 이동"으로
                실제 동작을 준다 — 죽은 버튼으로 두지 않되 없는 기능을 있다고 하지 않는다. */}
            <button
              className="chart-tool"
              title={t('chart_scroll_latest')}
              onClick={() => actions && actions.scrollToLatest()}
            >
              <I.Refresh size={12}/>
            </button>
            <button
              className="chart-tool"
              title={t('chart_screenshot')}
              onClick={() => actions && actions.screenshot({
                symbol: `${market.base}${market.quote}`,
                timeframe,
              })}
            >
              <I.Camera size={12}/>
            </button>
            <button
              className={`chart-tool ${isFull ? 'is-active' : ''}`}
              title={t('chart_fullscreen')}
              aria-pressed={isFull}
              onClick={() => actions && actions.toggleFullscreen()}
            >
              <I.Expand size={12}/>
            </button>
            <div className="chart-tool-wrap">
              <button
                className={`chart-tool ${settingsOpen ? 'is-active' : ''}`}
                title={t('chart_settings')}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(o => !o)}
              >
                <I.Cog size={12}/>
              </button>
              {settingsOpen && window.ChartSettingsPanel && (
                <window.ChartSettingsPanel
                  getChart={getChart}
                  version={chartGen}
                  showMA={showMA}
                  onToggleMA={setShowMA}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="chart-body" ref={bodyElRef}>
          <div className="chart-drawtools">
            {/* 도구 목록. 라벨은 사전에서 가져오고, 현재 렌더러가 지원하지 않는
                도구는 비활성 표시만 한다 — 버튼을 없애지 않는다. */}
            {[
              { id: 'cursor', icon: I.Cursor, key: 'tool_cursor' },
              { id: 'trend-line', icon: I.Line, key: 'tool_trend_line' },
              { id: 'horizontal', icon: I.Horizontal, key: 'tool_horizontal' },
              { id: 'fib', icon: I.Fib, key: 'tool_fib' },
              { id: 'long', icon: I.LongPos, key: 'tool_long' },
              { id: 'short', icon: I.ShortPos, key: 'tool_short' },
              { id: 'measure', icon: I.Measure, key: 'tool_measure' },
              { id: 'text', icon: I.Text, key: 'tool_text' },
            ].map(tool => {
              const available = !window.ChartActions || window.ChartActions.isDrawToolAvailable(tool.id);
              return (
                <button
                  key={tool.id}
                  className={`chart-drawtool ${activeTool===tool.id?'is-active':''}`}
                  onClick={() => pickTool(tool.id)}
                  title={available ? t(tool.key) : `${t(tool.key)} — ${t('draw_tool_unavailable')}`}
                  aria-pressed={activeTool===tool.id}
                  style={available ? undefined : { opacity: 0.4 }}
                >
                  <tool.icon size={14}/>
                </button>
              );
            })}
            <div className="chart-drawtool-sep"/>
            <button
              className={`chart-drawtool ${magnetMode !== 'normal' ? 'is-active' : ''}`}
              title={`${t('tool_magnet')} · ${t('magnet_' + magnetMode)}`}
              aria-pressed={magnetMode !== 'normal'}
              onClick={() => actions && setMagnetMode(actions.cycleMagnet(magnetMode))}
            >
              <I.Magnet size={14}/>
            </button>
            <button
              className={`chart-drawtool ${drawingsLocked ? 'is-active' : ''}`}
              title={t('tool_lock')}
              aria-pressed={drawingsLocked}
              onClick={() => {
                if (!actions) return;
                const next = !drawingsLocked;
                actions.setDrawingsLocked(next);
                setDrawingsLocked(next);
              }}
            >
              <I.Lock size={14}/>
            </button>
            <button
              className={`chart-drawtool ${drawingsHidden ? 'is-active' : ''}`}
              title={t('tool_hide')}
              aria-pressed={drawingsHidden}
              onClick={() => {
                if (!actions) return;
                const nextHidden = !drawingsHidden;
                actions.setDrawingsVisible(!nextHidden);
                setDrawingsHidden(nextHidden);
              }}
            >
              <I.EyeOff size={14}/>
            </button>
            <button
              className="chart-drawtool"
              title={t('tool_remove_all')}
              onClick={() => actions && actions.removeAllDrawings()}
            >
              <I.Trash size={14}/>
            </button>
          </div>

          {/* 차트 렌더러.
              기본은 KLineChart(지표 27종·드로잉 16종·정확한 시간축). 자체 Canvas
              엔진은 삭제하지 않고 폴백으로 남겨둔다 — localStorage 에
              qt.chartEngine='canvas' 를 넣으면 즉시 되돌릴 수 있고,
              klinecharts 로드 실패 시에도 자동으로 자체 엔진이 쓰인다. */}
          {(() => {
            const Renderer = window.ChartRenderer ? window.ChartRenderer() : window.ChartCanvas;
            return (
              <Renderer
                candles={candles}
                timeframe={timeframe}
                symbol={`${market.base}/${market.quote}`}
                overlays={overlays}
                onOverlayChange={(id, ov) => updateOverlay(id, ov)}
                lastPrice={lastPrice}
                showMA={showMA}
                activeTool={activeTool}
                onChartReady={handleChartReady}
              />
            );
          })()}
        </div>
      </div>
    );
  }

  function MiniChartWidget({ market, candles, timeframe }) {
    return <window.MiniChart symbol={`${market.base}/${market.quote}`} timeframe={timeframe}/>;
  }

  // ============================================================
  // Risk Checklist — multi-signal safety
  // ============================================================
  function RiskChecklist({ order, lastPrice }) {
    const px = order.price;
    const isLong = order.side === 'long';
    const priceDev = ((px - lastPrice) / lastPrice) * 100;
    const tp = Array.isArray(order.tpsl?.tp) ? order.tpsl.tp[0] : order.tpsl?.tp;
    const sl = order.tpsl?.sl;

    const checks = [];
    // 1. SL direction
    if (sl != null) {
      const slValid = isLong ? sl < px : sl > px;
      checks.push({
        state: slValid ? 'ok' : 'fail',
        label: t('risk_sl_direction'),
        detail: t(slValid ? 'risk_sl_ok' : 'risk_sl_fail'),
        meta: `SL ${fmt(sl,1)} vs Entry ${fmt(px,1)}`,
      });
    }
    // 2. TP direction
    if (tp != null) {
      const tpValid = isLong ? tp > px : tp < px;
      checks.push({
        state: tpValid ? 'ok' : 'fail',
        label: t('risk_tp_direction'),
        detail: t(tpValid ? 'risk_tp_ok' : 'risk_tp_fail'),
        meta: `TP ${fmt(tp,1)} vs Entry ${fmt(px,1)}`,
      });
    }
    // 3. Leverage
    const leverage = 20;
    checks.push({
      state: leverage > 50 ? 'warn' : 'ok',
      label: t('risk_leverage'),
      detail: t(leverage > 50 ? 'risk_lev_high' : 'risk_lev_normal', { lev: leverage }),
      meta: `${leverage}×`,
    });
    // 4. Liquidation distance
    const liqDistPct = Math.abs(((order.estLiq - px) / px) * 100);
    checks.push({
      state: liqDistPct < 3 ? 'fail' : liqDistPct < 6 ? 'warn' : 'ok',
      label: t('risk_liq_distance'),
      detail: t(liqDistPct < 3 ? 'risk_liq_danger' : liqDistPct < 6 ? 'risk_liq_warn' : 'risk_liq_safe'),
      meta: `-${liqDistPct.toFixed(2)}%`,
    });
    // 5. Price deviation
    checks.push({
      state: Math.abs(priceDev) > 3 ? 'warn' : 'ok',
      label: t('risk_price_dev'),
      detail: t(Math.abs(priceDev) > 3 ? 'risk_dev_far' : 'risk_dev_near'),
      meta: `${priceDev >= 0 ? '+' : ''}${priceDev.toFixed(2)}%`,
    });
    // 6. Data freshness
    checks.push({
      state: 'ok',
      label: t('risk_data_state'),
      detail: 'Live · 24ms · Mock stream',
      meta: 'WS',
    });
    // 7. AI confidence
    checks.push({
      state: 'ok',
      label: 'AI Confidence',
      detail: t('risk_ai_conf_detail'),
      meta: '74%',
    });

    const failCount = checks.filter(c => c.state === 'fail').length;
    const warnCount = checks.filter(c => c.state === 'warn').length;

    return (
      <div className="risk-checklist">
        <div className="risk-checklist__title">
          <span>Risk Check · Pre-submission</span>
          <span style={{fontFamily:'var(--font-mono)', textTransform:'none', letterSpacing:'0.02em'}}>
            {failCount > 0 ? <span style={{color:'var(--color-danger)'}}>{failCount} FAIL</span> : warnCount > 0 ? <span style={{color:'var(--color-warning)'}}>{warnCount} WARN</span> : <span style={{color:'var(--color-success)'}}>ALL CLEAR</span>}
          </span>
        </div>
        {checks.map((c, i) => (
          <div key={i} className={`risk-check is-${c.state}`}>
            <span className="risk-check__icon">{c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '✗'}</span>
            <span>{c.label}</span>
            <span style={{color:'var(--color-text-tertiary)', fontSize: 10, marginLeft: 8}}>{c.detail}</span>
            <span className="risk-check__meta">{c.meta}</span>
          </div>
        ))}
      </div>
    );
  }

  // ============================================================
  // Order Preview Modal (multi-step)
  // ============================================================
  function OrderPreviewModal({ order, step, onCancel, onConfirm, market, lastPrice, t }) {
    /*
       서버가 계산한 값이 오면 그것을 보여준다.
       클라이언트 추정치를 그대로 두면 화면 숫자와 실제 체결 조건이 어긋난다.
       사용자는 화면 숫자를 믿고 확인을 누르므로, 이 불일치는 그대로 손실이 된다.
       서버 응답이 아직 없으면 클라이언트 추정치를 쓴다 (빈 화면보다 낫다).
    */
    const sp = order.serverPreview || null;
    const shown = {
      notional: sp && sp.positionValue !== undefined ? Number(sp.positionValue) : order.totalUSDT,
      fee: sp && sp.estFee !== undefined ? Number(sp.estFee) : order.fee,
      liq: sp && sp.estLiquidationPrice !== undefined ? Number(sp.estLiquidationPrice) : order.estLiq,
      margin: sp && sp.requiredMargin !== undefined ? Number(sp.requiredMargin) : order.requiredMargin,
      /** 서버 검증을 통과했는지. 통과 전에는 확인 버튼을 누를 수 없다. */
      verified: Boolean(sp),
    };
    const isFinal = step === 'submitted';
    const submitting = step === 'risk-check' || step === 'confirm';
    return (
      <div className="overlay" onClick={onCancel}>
        <div className="modal" style={{width: 640}} onClick={e => e.stopPropagation()}>
          <div className="modal__header">
            <div>
              <div className="modal__title">
                {t('op_title')} · {order.side === 'long' ? t('side_long_arrow') : t('side_short_arrow')}
                <span className={`badge ${order.side==='long'?'badge--long':'badge--short'}`} style={{marginLeft: 8}}>{order.type}</span>
              </div>
              <div style={{fontSize: 12, color:'var(--color-text-tertiary)', marginTop: 2}}>
                {t('op_sim_notice')}
              </div>
            </div>
            <button className="btn btn--icon" onClick={onCancel}><I.X size={14}/></button>
          </div>

          <div className="op-flow-steps">
            <span className={`op-step ${['user-review','approved','order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>1. AI Analysis</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['approved','order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>2. User Review</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>3. Approve</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['preview','risk-check','confirm','submitted'].includes(step) ? (step === 'preview' ? 'is-active' : 'is-done') : ''}`}>4. Preview</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['risk-check','confirm','submitted'].includes(step) ? (step === 'risk-check' ? 'is-active' : 'is-done') : ''}`}>5. Risk Check</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${step==='confirm' ? 'is-active' : step === 'submitted' ? 'is-done' : ''}`}>6. Final Confirm</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${step==='submitted' ? 'is-active' : ''}`}>7. Submitted</span>
          </div>

          <div className="modal__body">
            <div className="op-grid">
              <div className="op-row"><span className="op-row__k">Symbol</span><span className="op-row__v">{market.base}/{market.quote} · PERP</span></div>
              <div className="op-row"><span className="op-row__k">Side / Type</span><span className="op-row__v"><span className={order.side==='long'?'t-long':'t-short'}>{order.side === 'long' ? '▲ LONG' : '▼ SHORT'}</span> · {order.type}</span></div>
              <div className="op-row"><span className="op-row__k">Price</span><span className="op-row__v">{fmt(order.price, 1)} USDT</span></div>
              <div className="op-row"><span className="op-row__k">Size</span><span className="op-row__v">{fmt(order.size, 4)} {market.base}</span></div>
              <div className="op-row"><span className="op-row__k">Notional</span><span className="op-row__v">{fmt(shown.notional)} USDT</span></div>
              <div className="op-row"><span className="op-row__k">Leverage</span><span className="op-row__v">20×</span></div>
              <div className="op-row"><span className="op-row__k">Required Margin</span><span className="op-row__v">{fmt(shown.margin)} USDT</span></div>
              <div className="op-row"><span className="op-row__k">Est. Fee (0.04%)</span><span className="op-row__v">{fmt(shown.fee, 4)} USDT</span></div>
              <div className="op-row"><span className="op-row__k">Est. Liq. Price</span><span className="op-row__v t-warning">{fmt(shown.liq, 1)}</span></div>
              <div className="op-row"><span className="op-row__k">TIF</span><span className="op-row__v">{order.tif || 'GTC'}</span></div>
              {order.tpsl && (
                <>
                  <div className="op-row"><span className="op-row__k">Take Profit</span><span className="op-row__v t-long">{Array.isArray(order.tpsl.tp) ? order.tpsl.tp.map(t => fmt(t,0)).join(' / ') : fmt(order.tpsl.tp, 1)}</span></div>
                  <div className="op-row"><span className="op-row__k">Stop Loss</span><span className="op-row__v t-short">{fmt(order.tpsl.sl, 1)}</span></div>
                </>
              )}
            </div>

            {/* Multi-signal Risk Checklist */}
            <RiskChecklist order={order} lastPrice={lastPrice}/>

            <div className="oe-warn" style={{marginTop: 12}}>
              <span className="oe-warn__icon"><I.Alert size={14}/></span>
              <div>
                <strong>{t('op_ai_warn_label')}</strong> {t('op_ai_warn_body')}
              </div>
            </div>

            {submitting && (
              <div style={{marginTop:16, padding: 12, background:'var(--color-bg-panel)', borderRadius: 6, textAlign:'center'}}>
                <div className="dot dot--live" style={{marginRight: 6}}/>
                {t(step === 'risk-check' ? 'op_risk_checking' : 'op_submitting')}
              </div>
            )}
            {isFinal && (
              <div style={{marginTop:16, padding: 12, background:'oklch(74% 0.14 150 / 0.14)', border:'1px solid var(--color-success)', borderRadius: 6, color:'var(--color-success)', textAlign:'center'}}>
                <I.Check size={16} style={{display:'inline', verticalAlign:'-3px', marginRight: 4}}/>
                <strong>{t('op_accepted')}</strong> · Order ID: SIM-{Math.random().toString(36).slice(2,8).toUpperCase()}
              </div>
            )}
          </div>

          <div className="modal__footer">
            {!isFinal && !submitting && (
              <>
                <button className="btn" onClick={onCancel}>{t('cancel')}</button>
                {/*
                  서버 검증(주문 초안)이 끝나기 전에는 확인을 막는다.
                  검증 전에 확인하면 서버가 계산한 수수료·청산가를 보지 않은 채
                  주문하는 셈이다. 백엔드가 없는 정적 프리뷰에서는 그대로 진행한다.
                */}
                <button
                  className={`btn btn--${order.side}`}
                  onClick={onConfirm}
                  style={{minWidth: 180}}
                  disabled={Boolean(window.QTApi && window.QTApi.orders) && !shown.verified}
                  title={Boolean(window.QTApi && window.QTApi.orders) && !shown.verified ? t('op_verifying') : undefined}
                >
                  <I.Check size={14}/> {shown.verified || !(window.QTApi && window.QTApi.orders) ? t('op_final_confirm') : t('op_verifying')}
                </button>
              </>
            )}
            {submitting && <button className="btn" disabled>{t('op_submitting_short')}</button>}
            {isFinal && <button className="btn btn--primary" onClick={onCancel}>{t('close')}</button>}
          </div>
        </div>
      </div>
    );
  }
})();
