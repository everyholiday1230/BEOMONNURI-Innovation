/* ============================================================
   AI Copilot Widget — Hybrid persona (Beginner/Pro auto-switch)
   ------------------------------------------------------------
   Scripted conversation drives Flow 3 (chart drawing) and Flow 5
   (signal → order draft → confirm). All AI 'thinking' is a
   simulated stream — no real LLM call.
   ============================================================ */

(function () {
  const { useState, useEffect, useRef, useCallback } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);
  const I = window.Icons;
  const { fmt } = window.QTFmt;

  // ---- AI Message model ----
  function makeMsg(role, content, extras = {}) {
    return {
      id: 'm' + Math.random().toString(36).slice(2, 8),
      role,          // 'user' | 'ai' | 'system'
      content,       // string with simple markdown (**bold**, - lists)
      time: Date.now(),
      ...extras
    };
  }

  // ---- Markdown-lite renderer ----
  function renderContent(str) {
    if (!str) return null;
    const lines = str.split('\n');
    const out = [];
    let listBuf = [];
    lines.forEach((line, i) => {
      if (line.startsWith('- ')) {
        listBuf.push(line.slice(2));
        return;
      }
      if (listBuf.length) {
        out.push(<ul key={'ul' + i}>{listBuf.map((li, j) => <li key={j} dangerouslySetInnerHTML={{__html: applyInline(li)}}/>)}</ul>);
        listBuf = [];
      }
      if (line.trim() === '') return;
      out.push(<p key={i} dangerouslySetInnerHTML={{__html: applyInline(line)}}/>);
    });
    if (listBuf.length) {
      out.push(<ul key="ulend">{listBuf.map((li, j) => <li key={j} dangerouslySetInnerHTML={{__html: applyInline(li)}}/>)}</ul>);
    }
    return out;
  }
  function applyInline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  // ============================================================
  window.AICopilot = function AICopilot({
    context, isBeginner, overlays, addOverlay, updateOverlay: _updateOverlay, removeOverlay: _removeOverlay,
    onProposeSignal, currentSignal, onApproveSignal, onCreateOrderDraft, onEditSignal, onRejectSignal,
    t,
    /*
       ★ 이 위젯의 격자 id. 접힘을 레이아웃에 알릴 때 쓴다.

         기본값 'ai' — 프리셋에서 코파일럿 위젯 id 가 'ai' 다. 다른 id 로
         복제하면 그 id 를 넘겨야 한다(안 넘기면 원본 칸이 접힌다).
    */
    widgetId = 'ai',
  }) {
    /*
       ★★ 첫 인사말에 **마운트 시점의 가격**을 박아 두면 안 된다.

         전에는 useState 초기화에서 `context.price` 를 문장에 넣었다. 실시세는
         비동기로 도착하므로 그 시점의 값은 목업 초기값이고, 그대로 대화 기록에
         남는다. 실제로 칩에는 62,836.4 가 보이는데 인사말은 68,432.5 를
         말하고 있었다 — 같은 화면에서 두 가격이 어긋났고, 사용자는 어느 쪽을
         믿어야 할지 알 수 없다.

       ★ 그래서 **실시세가 도착한 뒤에** 인사말을 넣는다. 대화 기록은 나중에
         고쳐 쓰지 않는다(고쳐 쓰면 사용자가 본 내용과 달라진다).

       ★ 맥락 문장도 사전에 숫자가 박혀 있었다
         ('BTC/USDT Perp · 15m · 220 candles · 5 indicators active').
         지금 보고 있는 심볼·주기·봉 수·지표 수를 넣는다.
    */
    const ctxText = () => {
      const bars = Array.isArray(context.candles) ? context.candles.length : 0;
      const inds = Array.isArray(context.indicators) ? context.indicators.length : 0;
      const vars = { symbol: context.symbol, tf: context.tf, bars, n: inds };
      return inds > 0 ? t('ai_ctx_loaded_ind', vars) : t('ai_ctx_loaded', vars);
    };

    const [msgs, setMsgs] = useState(() => [makeMsg('system', ctxText(), { icon: 'ok' })]);
    const greetedRef = useRef(false);
    useEffect(() => {
      if (greetedRef.current) return;
      /*
         가격이 실시세인지 확인한다. 목업 소스일 때는 가격을 말하지 않는다 —
         디자인 미리보기에서 실제 시세처럼 보이면 그것이 또 다른 가짜 정보다.
      */
      const src = window.QTLive && window.QTLive.getSource ? window.QTLive.getSource() : 'mock';
      const isLive = src && src !== 'mock';
      const price = Number(context.price);
      if (!isLive || !Number.isFinite(price) || price <= 0) return;
      greetedRef.current = true;
      /*
         ★ 언어 태그는 `bcp47Of()` 다 — `bcp47` 이라는 함수는 없다.
           없는 함수를 부르면 렌더 전체가 죽는다(실측: 화면이 빈 채로 남았다).
      */
      const time = new Date().toLocaleTimeString(
        window.QTI18n && window.QTI18n.bcp47Of ? window.QTI18n.bcp47Of() : undefined,
      );
      setMsgs((prev) => [...prev, makeMsg('ai', isBeginner
        ? t('ai_welcome_beginner', { symbol: context.symbol })
        : t('ai_welcome_pro', { symbol: context.symbol, tf: context.tf, price: fmt(price, 1), time }))]);
    }, [context.price, context.symbol, context.tf, isBeginner]);

    const [input, setInput] = useState('');
    const [thinking, setThinking] = useState(null); // { steps, currentIdx, msg }
    const [streaming, setStreaming] = useState(null);
    /*
       접기 상태.

       ★★ 헤더의 두 버튼(Layout/More)은 **onClick 이 없는 껍데기**였다. 눌러도
         아무 일이 없어서, 코파일럿이 화면을 차지하는데 치울 방법이 없었다.

       ★ 접으면 본문만 숨기고 헤더는 남긴다. 완전히 없애면 다시 펼 수단이
         사라진다(레이아웃 편집으로 들어가야 한다).

       ★ 선택을 기억한다 — 접어 놓고 새로고침했는데 다시 펼쳐져 있으면
         매번 접어야 한다.
    */
    const [collapsed, setCollapsed] = useState(() => {
      /*
         ★★ 기본값은 **접힌 상태**다.

           코파일럿은 이제 거래 화면 기본 배치에 들어 있다(standard-trader).
           펼친 채로 시작하면 디자이너가 만든 배치보다 차트가 좁아진다 —
           접힌 상태는 2칸만 쓰고 남는 폭을 차트가 가져가므로 첫 화면이
           이전과 같다.

         ★ 이용자가 한 번이라도 펼치면 그 선택을 기억한다(아래 저장).
           접어 놓고 새로고침했는데 다시 펼쳐져 있으면 매번 접어야 한다.
      */
      try {
        const saved = localStorage.getItem('qt.ai.collapsed');
        if (saved === '0') return false;   // 이용자가 펼쳐 둔 것
        return true;                        // 저장이 없거나 '1' 이면 접힘
      } catch (e) { return true; }
    });
    const toggleCollapsed = useCallback(() => {
      setCollapsed((prev) => {
        const next = !prev;
        try { localStorage.setItem('qt.ai.collapsed', next ? '1' : '0'); } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
        /*
           ★★ 레이아웃에도 알린다.

             전에는 본문만 숨겼다. 그래서 접으면 **368×730 짜리 빈 상자**가
             남고 차트는 그대로였다 — 접는 목적이 차트를 넓게 보는 것인데
             그 목적이 달성되지 않았다.

           ★ 저장된 배치를 고치지 않는다. QTPanelState 는 표시 상태만 들고
             있고, 그릴 때 그 공간을 왼쪽 이웃(차트)에게 넘긴다.
        */
        if (window.QTPanelState) window.QTPanelState.setCollapsed(widgetId, next);
        return next;
      });
    }, [widgetId]);

    /*
       ★ 처음 마운트될 때도 알린다. 접힌 상태가 저장돼 있으면(localStorage)
         새로고침 후에도 공간이 넘어가 있어야 한다 — 안 하면 접힌 채로 빈
         상자만 남는다.
    */
    useEffect(() => {
      if (window.QTPanelState) window.QTPanelState.setCollapsed(widgetId, collapsed);
      return () => {
        // 위젯이 사라지면 접힘 기록도 지운다(없는 위젯 때문에 배치가 틀어지지 않게).
        if (window.QTPanelState) window.QTPanelState.setCollapsed(widgetId, false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [widgetId, collapsed]);
    const inputRef = useRef(null);
    const scrollRef = useRef(null);

    // Autoscroll
    useEffect(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [msgs, thinking, streaming]);

    // ---- 의도 분류 ----
    //
    // 키워드를 코드에 박지 않는다. 사전(intent_kw_*)에서 가져오므로 언어를
    // 추가하면 그 언어의 명령어가 자동으로 인식된다.
    //
    // 의도 분류(추세선/신호/지지저항 키워드 매칭)는 제거했다. 이제 실제 모델이
    // 자연어를 이해하고 propose_chart_command/propose_signal 툴로 판단하므로,
    // 프론트의 좁은 키워드 분류기는 불필요하다(서버가 돌려주는 command/signal
    // 이벤트를 그대로 렌더한다).

    // 대화 id(첫 요청에 생성) + 진행 중 스트림 핸들(중단용).
    const convRef = useRef(null);
    const activeStreamRef = useRef(null);
    const CONV_KEY = 'qt.ai.convId';

    /*
       새로고침 후 대화 복원.

       대화 id 를 localStorage 에 저장해 두고, 마운트 시 서버에서 이전 메시지를
       불러와 이어 붙인다. id 가 이 사용자 것이 아니면(다른 로그인) 서버가 404 →
       저장을 지우고 새로 시작한다. AI 가 준비된 뒤에만 시도한다.
    */
    const restoredRef = useRef(false);
    useEffect(() => {
      if (restoredRef.current || !aiReady) return;
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiConversationMessages) return;
      let saved = null;
      try { saved = localStorage.getItem(CONV_KEY); } catch (e) { /* 접근 불가 */ }
      restoredRef.current = true;
      let cancelled = false;
      const restore = (id, persist) => api.aiConversationMessages(id).then((rows) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return false;
        convRef.current = id;
        if (persist) { try { localStorage.setItem(CONV_KEY, id); } catch (e) { /* noop */ } }
        greetedRef.current = true; // 복원 시 인사말 생략(이미 대화가 있으므로)
        setMsgs([
          makeMsg('system', ctxText(), { icon: 'ok' }),
          ...rows.map((r) => makeMsg(r.role === 'assistant' ? 'ai' : (r.role === 'user' ? 'user' : 'system'), r.content || '')),
        ]);
        return true;
      });
      if (saved) {
        restore(saved, false).catch(() => {
          // 내 대화가 아니거나 사라짐 — 저장을 지우고 서버 최신 대화로 이어받기 시도.
          try { localStorage.removeItem(CONV_KEY); } catch (e) { /* noop */ }
          convRef.current = null;
          if (api.aiListConversations) {
            api.aiListConversations().then((r) => {
              const list = (r && r.conversations) || [];
              if (!cancelled && list.length > 0) return restore(list[0].id, true);
              return false;
            }).catch(() => { /* noop */ });
          }
        });
      } else if (api.aiListConversations) {
        /*
           ★ localStorage 에 대화 ID 가 없으면 서버(각 고객별 DB)에서 최신 대화를
             이어받는다. 다른 기기/브라우저에서도 대화가 이어진다.
        */
        api.aiListConversations().then((r) => {
          const list = (r && r.conversations) || [];
          if (!cancelled && list.length > 0) return restore(list[0].id, true);
          return false;
        }).catch(() => { /* 목록 조회 실패는 새 대화로 시작 */ });
      }
      return () => { cancelled = true; };
    }, [aiReady]);

    /*
       심볼이 바뀌면 대화를 새로 시작한다.

       BTC 를 보다가 ETH 로 바꾸면, 이전 심볼 기준으로 나눈 대화·그린 오버레이가
       뒤섞여 오해를 준다. 진행 중 스트림을 끊고, 대화 id 를 비우고(localStorage 도),
       컨텍스트 안내만 남긴 새 대화로 전환한다. 첫 마운트에서는 리셋하지 않는다.
    */
    const prevSymbolRef = useRef(context.symbol);
    useEffect(() => {
      if (prevSymbolRef.current === context.symbol) return;
      prevSymbolRef.current = context.symbol;
      if (activeStreamRef.current && activeStreamRef.current.abort) activeStreamRef.current.abort();
      activeStreamRef.current = null;
      convRef.current = null;
      try { localStorage.removeItem(CONV_KEY); } catch (e) { /* noop */ }
      setThinking(null);
      setStreaming(null);
      setMsgs([makeMsg('system', ctxText(), { icon: 'ok' })]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context.symbol]);

    /* 숫자 변환 헬퍼 — 가격은 서버에서 DecimalString(문자열)로 온다. */
    const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const anchorTime = useCallback(() => {
      const cs = context.candles;
      return (Array.isArray(cs) && cs.length) ? cs[Math.max(0, cs.length - 1)].time : Date.now();
    }, [context.candles]);

    /*
       서버가 검증해 보낸 AiChartCommand 하나를 실제 차트에 적용한다. 좌표·가격은
       모두 서버 값이다(프론트에 박힌 예시 아님). 지표는 ChartKlineUtil 브리지로.
       반환값은 채팅에 표시할 짧은 안내(없으면 표시 안 함).
    */
    const applyCommand = useCallback((cmd) => {
      if (!cmd || !cmd.command) return null;
      const a = cmd.args || {};
      const id = 'ai-' + (cmd.commandId || Math.random().toString(36).slice(2, 8));
      const util = window.ChartKlineUtil;
      switch (cmd.command) {
        case 'createTrendLine':
          addOverlay({ id, type: 'trend-line', source: 'ai-draft', width: 1.8, label: a.label || t('ai_overlay_trendline'),
            points: (Array.isArray(a.points) ? a.points : []).map((p) => ({ time: Number(p.time), price: toNum(p.price) })) });
          return t('ai_tool_trendline');
        case 'createHorizontalLevel':
          addOverlay({ id, type: 'horizontal', source: 'ai-draft', label: a.label || String(a.price), points: [{ price: toNum(a.price), time: anchorTime() }] });
          return t('ai_cmd_applied');
        case 'createSupportResistance':
          addOverlay({ id, type: 'horizontal', source: 'ai-draft', label: (a.kind === 'support' ? 'S' : 'R') + ' · ' + a.price, points: [{ price: toNum(a.price), time: anchorTime() }] });
          return t('ai_tool_sr');
        case 'createEntryZone':
          addOverlay({ id, type: 'entry-zone', source: 'ai-draft', priceLo: toNum(a.priceLo), priceHi: toNum(a.priceHi), label: t('ai_overlay_entry_zone') });
          return t('ai_cmd_applied');
        case 'createStopLoss':
          addOverlay({ id, type: 'horizontal', source: 'ai-draft', label: 'SL · ' + a.price, points: [{ price: toNum(a.price), time: anchorTime() }] });
          return t('ai_cmd_applied');
        case 'createTakeProfit':
          addOverlay({ id, type: 'horizontal', source: 'ai-draft', label: 'TP' + ((toNum(a.index) || 0) + 1) + ' · ' + a.price, points: [{ price: toNum(a.price), time: anchorTime() }] });
          return t('ai_cmd_applied');
        case 'createInvalidationLevel':
          addOverlay({ id, type: 'horizontal', source: 'ai-draft', label: t('ai_invalidation_word') + ' · ' + a.price, points: [{ price: toNum(a.price), time: anchorTime() }] });
          return t('ai_cmd_applied');
        case 'createLongMarker':
        case 'createShortMarker':
          addOverlay({ id, type: 'signal-marker', source: 'ai-draft', direction: cmd.command === 'createLongMarker' ? 'long' : 'short',
            text: a.text, points: [{ time: Number(a.point && a.point.time), price: toNum(a.point && a.point.price) }] });
          return t('ai_cmd_applied');
        case 'addIndicator': {
          const ok = util && util.addIndicator ? util.addIndicator(a.indicator, a.params) : false;
          return ok ? t('ai_indicator_added', { name: a.indicator }) : t('ai_indicator_unsupported', { name: a.indicator });
        }
        case 'removeIndicator':
          if (util && util.removeIndicator) util.removeIndicator(a.indicator);
          return t('ai_indicator_removed', { name: a.indicator });
        case 'hideOverlay':
        case 'deleteOverlay':
          if (_removeOverlay) _removeOverlay(a.overlayId);
          return t('ai_overlay_removed');
        case 'updateOverlay':
          if (_updateOverlay && a.patch) _updateOverlay(a.overlayId, a.patch);
          return t('ai_cmd_applied');
        default:
          return null;
      }
    }, [addOverlay, _removeOverlay, _updateOverlay, anchorTime, t]);

    /* 서버가 검증해 보낸 SignalObject를 오버레이(진입/손절/익절/마커)로 그리고 상위에 제안한다. */
    const applySignal = useCallback((sig) => {
      if (!sig || !Array.isArray(sig.entryZone)) return;
      const anchor = anchorTime();
      addOverlay({ id: 'sig-entry', type: 'entry-zone', source: 'ai-draft', priceLo: toNum(sig.entryZone[0]), priceHi: toNum(sig.entryZone[1]), label: t('ai_overlay_entry_zone') });
      addOverlay({ id: 'sig-sl', type: 'horizontal', source: 'ai-draft', points: [{ price: toNum(sig.stopLoss), time: anchor }], label: 'SL · ' + sig.stopLoss });
      (Array.isArray(sig.takeProfits) ? sig.takeProfits : []).forEach((tp, i) => {
        addOverlay({ id: 'sig-tp' + (i + 1), type: 'horizontal', source: 'ai-draft', points: [{ price: toNum(tp), time: anchor }], label: 'TP' + (i + 1) + ' · ' + tp });
      });
      const mid = (toNum(sig.entryZone[0]) + toNum(sig.entryZone[1])) / 2;
      addOverlay({ id: 'sig-marker', type: 'signal-marker', source: 'ai-draft', direction: sig.direction || 'long', points: [{ time: anchor, price: mid }] });
      if (onProposeSignal) onProposeSignal(sig);
    }, [addOverlay, anchorTime, onProposeSignal, t]);

    // AI 가 만든 선/신호를 저장한다(포인트 차감). 저장소는 PG(/me/saved).
    const [savingId, setSavingId] = useState(null);
    const saveProposal = useCallback(async (msgId, savable) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedCreate || !savable) return;
      setSavingId(msgId);
      const sym = String(context.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      try {
        const r = await api.savedCreate({
          kind: savable.kind,
          name: savable.name,
          symbol: sym || undefined,
          timeframe: context.tf,
          payload: savable.payload,
        });
        if (r && r.ok !== false) {
          setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, saved: true, savedNote: t('sv_saved_ok', { n: (r && r.charged) || 0 }) } : x)));
        } else {
          setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, savedNote: (r && r.message) || t('sv_save_failed') } : x)));
        }
      } catch (e) {
        const insuff = e && e.status === 402;
        setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, savedNote: insuff ? t('sv_need_points') : ((e && e.message) || t('sv_save_failed')) } : x)));
      }
      setSavingId(null);
    }, [context.symbol, context.tf, t]);

    // CCAI Copilot 안에서 저장된 항목(신호/지표/드로잉)을 본다.
    const [savedOpen, setSavedOpen] = useState(false);
    const [savedItems, setSavedItems] = useState(null);
    const loadSaved = useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedList) { setSavedItems([]); return; }
      api.savedList().then((r) => setSavedItems((r && r.items) || [])).catch(() => setSavedItems([]));
    }, []);
    const toggleSaved = useCallback(() => {
      setSavedOpen((o) => { const n = !o; if (n) loadSaved(); return n; });
    }, [loadSaved]);
    const deleteSavedItem = useCallback((id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedDelete) return;
      api.savedDelete(id).then(() => loadSaved()).catch(() => { /* noop */ });
    }, [loadSaved]);

    /*
       AI 분석 사용 가능 여부.

       ★★ 이것을 확인하지 않아서, AI 가 **연결되지 않은 상태에서도** 사전에 박힌
         예시 문구를 분석 결과처럼 답했다. 실측한 응답:
           "저항: 69,120 (07-16 이후 미검증). 지지: 67,200 (2회 터치, 거래량 많음)"
         당시 BTC 실제가는 65,000 대였다. 근거 없는 숫자이고, 진입·손절 제안까지
         (손절 67,480 · 목표 68,980/69,640/70,420) 함께 나왔다.
         게다가 그 값으로 **차트에 실제 선을 그렸다**(addOverlay).

       ★ 사용자는 이 숫자로 진입과 손절을 정한다. 근거 없는 가격을 분석으로
         내보내는 것은 이 서비스에서 가장 위험한 거짓이다. 베타로 열더라도
         "아직 분석할 수 없다" 고 말해야 하고, 창 조작·대화 기록 같은 UI 는
         그대로 쓸 수 있게 둔다.
    */
    const aiCfg = window.QTApi && window.QTApi.useConfig ? window.QTApi.useConfig() : null;
    /* 판정 전(null)에는 분석을 시작하지 않는다 — 잠깐 열렸다 막히면 사용자가
       그 사이에 본 숫자를 기억한다. */
    const aiReady = Boolean(aiCfg && aiCfg.aiAvailable === true);

    const handleSubmit = useCallback(async (raw) => {
      const text = (raw ?? input).trim();
      if (!text) return;
      setMsgs(m => [...m, makeMsg('user', text)]);
      setInput('');

      /*
         ★★ AI 가 준비되지 않았으면 여기서 멈춘다.

           분석 문구를 만들지 않고, 차트에 선도 그리지 않는다. 무엇이 준비되면
           되는지 알려 주는 것까지가 지금 할 수 있는 정직한 응답이다.
      */
      if (!aiReady) {
        setMsgs(m => [...m, makeMsg('ai', t('ai_unavailable_reply'), { icon: 'warn' })]);
        return;
      }

      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiCopilotStream) {
        setMsgs((m) => [...m, makeMsg('ai', t('ai_unavailable_reply'), { icon: 'warn' })]);
        return;
      }

      /*
         실제 백엔드(/ai/copilot)에 스트리밍으로 붙는다. 서버는 실시장 스냅샷으로
         근거를 잡고, 모델의 제안을 검증한 뒤 command/signal 이벤트를 준다. 좌표는
         전부 서버가 검증한 값이다 — 프론트에 박힌 예시 숫자를 그리지 않는다.
         근거(실가격)가 없으면 서버가 가격 제안을 거부하므로 가짜 선이 나갈 수 없다.
      */
      let conversationId = convRef.current;
      try {
        if (!conversationId) {
          conversationId = await api.aiCreateConversation('Copilot');
          convRef.current = conversationId;
          try { localStorage.setItem(CONV_KEY, conversationId); } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
        }
      } catch (e) {
        setMsgs((m) => [...m, makeMsg('ai', t('ai_stream_error', { msg: (e && e.message) || '' }), { icon: 'warn' })]);
        return;
      }

      // 진행 표시(가짜 계산 단계가 아니라 단순 로딩). 첫 토큰이 오면 사라진다.
      setThinking({ steps: [], currentIdx: 0, msg: t('ai_thinking') });
      let acc = '';
      const lang = (window.QTI18n && window.QTI18n.getLocale && String(window.QTI18n.getLocale()).indexOf('ko') === 0) ? 'ko' : 'en';
      /*
         심볼을 백엔드 표기로 맞춘다. 화면 context.symbol 은 'BTC/USDT'(슬래시 포함)인데
         서버의 시세 조회(getTicker)·정규 스키마는 'BTCUSDT' 를 쓴다. 슬래시를 남기면
         근거 시세를 못 찾아 서버가 가격 제안을 거부한다(=기능이 안 켜진 것처럼 보인다).
         타임프레임은 이미 소문자('15m' 등)라 그대로 보낸다.
      */
      const wireSymbol = String(context.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      /*
         지금 화면에 켜둔 지표와 사용자가 그린 선을 함께 보낸다(서버는 봉·가격을 직접
         조회하므로, 여기선 "사용자 화면 상태"만 참고용으로 전달한다). 크기를 제한한다.
      */
      const chartContext = {
        indicators: Array.isArray(context.indicators) ? context.indicators.slice(0, 12) : [],
        drawings: (Array.isArray(overlays) ? overlays : [])
          .filter((o) => o && (o.source === 'user' || o.source === 'ai-draft'))
          .slice(0, 20)
          .map((o) => ({
            type: o.type, label: o.label, source: o.source,
            price: o.price != null ? o.price : (o.priceLo != null ? o.priceLo : (o.points && o.points[0] ? o.points[0].price : undefined)),
          })),
      };
      const stream = api.aiCopilotStream(
        { conversationId, message: text, symbol: wireSymbol, timeframe: context.tf, mode: 'copilot', language: lang, chartContext },
        {
          onEvent: (ev) => {
            if (!ev || !ev.type) return;
            if (ev.type === 'text') { setThinking(null); acc += ev.delta || ''; setStreaming(acc); return; }
            if (ev.type === 'command') { const note = applyCommand(ev.command); if (note) setMsgs((m) => [...m, makeMsg('ai', '', { toolResult: note, savable: { kind: 'drawing', name: note, payload: ev.command } })]); return; }
            if (ev.type === 'signal') { applySignal(ev.signal); setMsgs((m) => [...m, makeMsg('ai', '', { toolResult: t('ai_tool_signal'), savable: { kind: 'signal', name: t('ai_tool_signal') + (ev.signal && ev.signal.direction ? ' · ' + ev.signal.direction : ''), payload: ev.signal } })]); return; }
            if (ev.type === 'points') { setMsgs((m) => [...m, makeMsg('ai', '', { toolResult: t('ai_points_charged', { n: ev.charged, bal: ev.balance }) })]); return; }
            if (ev.type === 'error') { setThinking(null); setStreaming(null); const insuff = (ev.code === 'INSUFFICIENT_POINTS'); setMsgs((m) => [...m, makeMsg('ai', insuff ? t('ai_need_points') : t('ai_stream_error', { msg: ev.message || ev.code || '' }), { icon: 'warn' })]); return; }
            // 'tool' | 'state' | 'usage' — 내부 신호, UI 에 별도 표시하지 않는다.
          },
          onError: (e) => { setThinking(null); setStreaming(null); const insuff = (e && e.code === 'INSUFFICIENT_POINTS'); setMsgs((m) => [...m, makeMsg('ai', insuff ? t('ai_need_points') : t('ai_stream_error', { msg: (e && e.message) || '' }), { icon: 'warn' })]); },
          onDone: () => { setThinking(null); setStreaming(null); if (acc) setMsgs((m) => [...m, makeMsg('ai', acc)]); activeStreamRef.current = null; },
        },
      );
      activeStreamRef.current = stream;
    }, [input, aiReady, context.symbol, context.tf, context.indicators, overlays, t, applyCommand, applySignal]);

    /*
       차트 툴바의 'AI 분석' 버튼과 연결하는 창구.

       그 버튼은 window.QTAiBridge.requestAnalysis 를 호출하는데, 그 객체가
       **어디에도 정의돼 있지 않았다.** 그래서 항상 폴백 토스트("코파일럿을
       열어주세요")만 떴고, 실제 분석은 시작되지 않았다.

       여기서 노출한다 — 코파일럿이 마운트돼 있을 때만 존재하므로, 버튼은
       코파일럿이 화면에 없으면 기존 토스트로 안내한다(그 폴백은 옳다).

       ★ 분석 요청을 큐에 쌓지 않는다. 사용자가 버튼을 여러 번 누르면 같은
         분석이 겹쳐 실행돼 대화가 중복된다. 진행 중이면 무시한다.
    */
    const busyRef = useRef(false);
    useEffect(() => {
      window.QTAiBridge = {
        requestAnalysis: async (info) => {
          if (busyRef.current) return false;

          /*
             ★★ AI 가 준비되지 않았으면 실행하지 않는다.

               이 경로는 차트 툴바의 'AI 분석' 버튼이 부른다. 아래 분석 흐름은
               사전에 박힌 예시 가격(69,120 / 67,200 / 손절 67,480 …)을 쓰고
               차트에 선까지 그리므로, AI 미연결 상태로 실행되면 근거 없는
               숫자를 분석 결과로 내보내게 된다.

             ★ 이용권 차감보다 **먼저** 막는다. 실행하지 못할 것에 이용권을
               쓰면 사용자가 대가를 내고 아무것도 받지 못한다.
          */
          if (!aiReady) {
            setMsgs((m) => [...m, makeMsg('ai', t('ai_unavailable_reply'), { icon: 'warn' })]);
            return false;
          }

          busyRef.current = true;

          /*
             과금은 서버(/ai/copilot)가 사용량 기반으로 처리한다. 실행 전 최소 잔액
             확인 + 실행 후 출력 토큰만큼 차감(멱등). 잔액이 부족하면 서버가 402 를
             주고 handleSubmit 의 스트림 onError 가 안내한다. 여기서 미리 차감하지
             않는다 — 그러면 이중 과금이 된다.
          */
          /*
             자연어 요청으로 바꿔 기존 흐름을 그대로 탄다.

             별도 분석 경로를 만들지 않는 이유: 의도 분류·사고 단계·스트리밍
             응답이 이미 handleSubmit 에 있다. 새 경로를 만들면 두 곳이 갈라진다.
             문구는 사전에서 가져온다 — 코드에 한국어를 박으면 영어 UI 에서
             한국어 요청이 나간다.
          */
          const text = t('ai_bridge_analyze_request', {
            symbol: (info && info.symbol) || context.symbol,
            tf: (info && info.timeframe) || context.tf,
          });
          Promise.resolve(handleSubmit(text)).finally(() => { busyRef.current = false; });
          return true;
        },
        isBusy: () => busyRef.current,
      };
      return () => { delete window.QTAiBridge; };
    }, [handleSubmit, context.symbol, context.tf, t]);

    // Watch for user edits on AI-draft overlays → inject an AI message
    const overlayVersions = useRef({});
    useEffect(() => {
      overlays.filter(o => o.source === 'ai-draft').forEach(o => {
        const key = JSON.stringify(o.points || {} + o.priceHi + o.priceLo);
        if (overlayVersions.current[o.id] && overlayVersions.current[o.id] !== key) {
          // Something changed
          setMsgs(m => {
            // avoid spamming: only add if last msg isn't the same edit message
            const last = m[m.length - 1];
            if (last && last.editRef === o.id && Date.now() - last.time < 400) return m;
            let detail = '';
            if (o.type === 'entry-zone') detail = `Entry Zone → ${fmt(o.priceLo, 1)} – ${fmt(o.priceHi, 1)}`;
            else if (o.type === 'horizontal' && o.points?.[0]) detail = `${o.label || 'Level'} → ${fmt(o.points[0].price, 1)}`;
            else if (o.type === 'trend-line') detail = `Trendline anchors moved`;
            return [...m, makeMsg('ai', '', { toolResult: t('ai_tool_edited', { detail }), editRef: o.id })];
          });
        }
        overlayVersions.current[o.id] = key;
      });
    }, [overlays]);

    // ---- Compute AI state for state bar ----
    // Idle | Thinking | Streaming | Draft ready | Waiting review | Approved | Error | Stale | Reconnecting
    /* ★ 전에는 aiState 변수도 함께 두었지만 읽는 곳이 없었다(죽은 대입 6곳). 지웠다. */
    let aiStateLabel, aiStateNote, aiStateClass;
    if (thinking)          { aiStateLabel = t('ai_state_thinking');  aiStateNote = thinking.msg;                    aiStateClass = ''; }
    else if (streaming)    { aiStateLabel = t('ai_state_streaming'); aiStateNote = t('ai_state_streaming_note');      aiStateClass = ''; }
    else if (currentSignal && currentSignal.status === 'approved') { aiStateLabel = t('ai_state_approved'); aiStateNote = `${currentSignal.symbol.replace('USDT','/USDT')} · ${currentSignal.timeframe}`; aiStateClass = 'is-approved'; }
    else if (currentSignal){ aiStateLabel = t('ai_state_review');    aiStateNote = t('ai_state_review_note');         aiStateClass = ''; }
    /*
       ★★ 'READY' 가 하드코딩돼 있었다. AI 가 연결되지 않은 상태에서도 "준비됨"
         이라고 표시하면, 사용자는 뒤이어 나오는 예시 문구를 실제 분석으로 믿는다.
         연결 상태를 그대로 말한다.
    */
    else if (!aiReady)     { aiStateLabel = t('ai_state_beta');      aiStateNote = t('ai_state_beta_note');           aiStateClass = 'is-pending'; }
    else                   { aiStateLabel = t('ai_state_ready');     aiStateNote = t('ai_state_ready_note');          aiStateClass = 'is-idle'; }

    // ---- UI ----
    return (
      <div className={`panel ${collapsed ? 'qt-ai-collapsed' : ''}`} style={{height:'100%'}}>
        <div className="ai-header">
          {/*
             ★★ 접힌 상태에서는 제목을 그리지 않는다.

               접힌 띠는 2칸(약 109px)이다. 그런데 제목(점 + {t('ai_copilot_title')} +
               {t('ai_analyst_mode')})이 150px 를 차지해서, 그 뒤에 오는 펼치기 버튼이
               패널 밖(x=1203, 패널은 1028~1137)으로 밀려났다. 패널은
               `overflow: hidden` 이므로 **버튼이 잘려서 보이지 않았다** —
               접은 뒤 다시 펼칠 방법이 화면에 없었다(실측으로 확인).

             ★ 접혔을 때는 버튼만 남긴다. 무엇인지는 버튼의 title 이 말한다
               ("Expand the copilot").
          */}
          {!collapsed && (
            <div className="panel__title" style={{gap: 10}}>
              <span className="dot dot--ai"/>
              <span>{t('ai_copilot')}</span>
              <span className="ai-persona">
                <I.Sparkles size={10}/>
                {isBeginner ? t('ai_mentor_mode') : t('ai_analyst_mode')}
              </span>
            </div>
          )}
          <div className="panel__actions">
            {/*
               ★ 원래 이 두 버튼은 onClick 이 없어 눌러도 아무 일이 없었다.
                 마크업·클래스는 그대로 두고 동작만 붙였다.
            */}
            <button
              className="btn btn--icon"
              title={collapsed ? t('ai_expand') : t('ai_collapse')}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <I.Down size={14}/> : <I.Up size={14}/>}
            </button>
            {/*
               ★ 접힌 띠에는 펼치기 버튼만 남긴다. 좁은 폭에 버튼 두 개를 넣으면
                 둘 다 잘리거나, 펼치려다 대화를 지운다.
            */}
            {!collapsed && (
              <button
                className="btn btn--icon"
                title={t('ai_clear_chat')}
                onClick={() => {
                  /* 대화만 비운다. 컨텍스트(심볼·타임프레임) 안내는 남겨야
                     지금 무엇을 보고 있는지 알 수 있다. */
                  setMsgs([makeMsg('system', t('ai_ctx_loaded'), { icon: 'ok' })]);
                  setThinking(null);
                  setStreaming(null);
                }}
              >
                <I.More size={14}/>
              </button>
            )}
          </div>
          {/*
             ★ 띠가 무엇인지 알려준다. 버튼만 있으면 무엇을 펼치는 것인지 모른다.
               세로쓰기로 좁은 폭에 들어간다(pending.css).
          */}
          {collapsed && <span className="ai-collapsed-label">{t('ai_copilot')}</span>}
        </div>

        {/*
           ★ 접으면 본문을 숨기고 헤더만 남긴다.

             완전히 없애면 다시 펼 수단이 사라진다(레이아웃 편집으로 들어가야
             한다). 헤더가 남아 있으면 같은 버튼으로 다시 펼 수 있다.
        */}
        {!collapsed && (
          <>
        {/* AI STATE BAR — describes what the AI is doing right now */}
        <div className="ai-state-bar">
          <span className={`ai-state-bar__pill ${aiStateClass}`}>
            <span className="dot dot--ai"/>
            {aiStateLabel}
          </span>
          <span className="ai-state-bar__note">{aiStateNote}</span>
          <span className="ai-state-bar__spacer"/>
          <span className="ai-state-bar__note" title={t('data_freshness')}>◷ {new Date().toLocaleTimeString('en-GB',{hour12:false})}</span>
          <span className="ai-state-bar__note">·</span>
          {/*
             ★★ 'SIM' 이 문자열로 박혀 있었다. 실주문을 연 배포에서도 이 자리에 SIM 이
               남아, AI 패널만 보는 사용자는 주문이 모의라고 믿는다. 위험을 축소하는
               방향으로 틀리는 표시는 가장 나쁘다 — 상단 띠와 같은 기준(서버 설정)을 쓴다.
          */}
          {(() => {
            const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
            const live = cfg ? (Boolean(cfg.liveOrdersEnabled) && /LIVE/i.test(String(cfg.tradingMode || ''))) : null;
            const key = live === null ? 'ai_bar_mode_unknown' : live ? 'ai_bar_mode_live' : 'ai_bar_mode_sim';
            return (
              <span className="ai-state-bar__note" style={live ? { color: 'var(--color-trade-short)', fontWeight: 700 } : undefined}>
                {t(key)}
              </span>
            );
          })()}
        </div>

        <div className="ai-context">
          <span className="ai-ctx-chip">{t('fld_symbol')} · <strong>{context.symbol}</strong></span>
          <span className="ai-ctx-chip">TF · <strong>{context.tf}</strong></span>
          <span className="ai-ctx-chip" role="button" tabIndex={0} style={{cursor:'pointer'}} onClick={toggleSaved} title={t('sv_section_title')}>
            <I.Save size={10}/> {t('ai_saved_view')}{Array.isArray(savedItems) ? ' · ' + savedItems.length : ''}
          </span>
          <span className="ai-ctx-chip">{t('ai_ctx_last')} · <strong>{fmt(context.price, 1)}</strong></span>
          {/*
             ★ 지표 목록을 코드에 박지 않는다.

               전에는 `MA20 · MA60 · MA120` 이 그대로 적혀 있었다. 사용자가 무엇을
               켜 두었는지와 무관한 글자이고, 사용자는 이 칩을 보고 "AI 가 이
               지표들을 본다" 고 이해한다. 차트가 알려준 값이 없으면 칩을 그리지
               않는다 — 빈 값을 '없음' 으로 적으면 사실 주장이 되어버린다.
          */}
          {Array.isArray(context.indicators) && context.indicators.length > 0 && (
            <span className="ai-ctx-chip">{t('indicators')} · <strong>{context.indicators.join(' · ')}</strong></span>
          )}
          <span className="ai-ctx-chip">{t('ai_ctx_range')} · <strong>{t('ai_ctx_bars', { n: context.candles.length })}</strong></span>
          <span className="ai-ctx-chip" style={{color:'var(--color-warning)'}}>{t('ai_not_advice')}</span>
        </div>

        {savedOpen && (
          <div style={{margin:'0 0 6px', border:'1px solid var(--color-border-subtle)', borderRadius:6, background:'var(--color-bg-surface)', maxHeight:180, overflowY:'auto'}}>
            {savedItems === null ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>…</div>
            ) : savedItems.length === 0 ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('sv_empty')}</div>
            ) : savedItems.map((it) => (
              <div key={it.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                <span style={{fontSize:9.5, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'var(--color-bg-elevated)', color:'var(--color-text-secondary)'}}>{t('sv_kind_' + it.kind)}</span>
                <span style={{flex:1, fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.name}{it.symbol ? ' · ' + it.symbol : ''}{it.timeframe ? ' · ' + it.timeframe : ''}</span>
                <button className="btn btn--icon btn--sm" title={t('sv_delete')} onClick={() => deleteSavedItem(it.id)}><I.Trash size={11}/></button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-messages" ref={scrollRef}>
          {msgs.map(m => (
            <AIMessage key={m.id} msg={m} currentSignal={currentSignal} onApproveSignal={onApproveSignal} onCreateOrderDraft={onCreateOrderDraft} onEditSignal={onEditSignal} onRejectSignal={onRejectSignal} onSaveProposal={saveProposal} savingId={savingId} isBeginner={isBeginner}/>
          ))}

          {/* SIGNAL CARD floated once a signal is proposed and last message is AI reply */}
          {currentSignal && msgs.some(m => m.role === 'ai') && (
            <SignalCard signal={currentSignal} onApprove={onApproveSignal} onCreateOrder={onCreateOrderDraft} onEdit={onEditSignal} onReject={onRejectSignal} isBeginner={isBeginner}/>
          )}

          {thinking && (
            <div className="ai-msg ai-msg--ai">
              <div className="ai-msg__avatar">AI</div>
              <div className="ai-msg__body">
                <div className="ai-msg__meta">
                  <span>{t('ai_analyst')}</span>
                  <span>·</span>
                  <span>{t('ai_thinking')}</span>
                  <span className="dot dot--ai" style={{animation:'pulse 1.2s infinite'}}/>
                </div>
                <div className="ai-msg__bubble" style={{borderStyle:'dashed', borderColor:'var(--color-ai)'}}>
                  {thinking.steps.map((s, i) => (
                    <div key={i} style={{
                      display:'flex', alignItems:'center', gap:8, opacity: i <= thinking.currentIdx ? 1 : 0.35, marginBottom: 4
                    }}>
                      <span style={{color: i < thinking.currentIdx ? 'var(--color-success)' : i === thinking.currentIdx ? 'var(--color-ai)' : 'var(--color-text-tertiary)'}}>
                        {i < thinking.currentIdx ? '✓' : i === thinking.currentIdx ? '◐' : '○'}
                      </span>
                      <span style={{fontSize: 12, fontFamily:'var(--font-mono)'}}>{s.key ? t(s.key) : s.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {streaming && (
            <div className="ai-msg ai-msg--ai">
              <div className="ai-msg__avatar">AI</div>
              <div className="ai-msg__body">
                <div className="ai-msg__meta">
                  <span>{t('ai_analyst')}</span>
                  <span>·</span>
                  <span>{t('col_streaming')}</span>
                </div>
                <div className="ai-msg__bubble">
                  {renderContent(streaming)}
                  <span className="ai-cursor"/>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="ai-quick">
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_trendline_cmd'))}>{t('ai_chip_trendline')}</button>
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_signal_cmd'))}>{t('ai_chip_signal')}</button>
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_sr_cmd'))}>{t('ai_chip_sr')}</button>
          {/* ★ 전에는 이 두 칩에 onClick 이 없어 눌러도 아무 일이 없었다. 자연어 요청으로 연결한다. */}
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_fib_cmd'))}>{t('ai_chip_fib')}</button>
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_rr_cmd'))}>{t('ai_chip_rr')}</button>
        </div>

        <div className="ai-input">
          <textarea
            ref={inputRef}
            className="ai-input__box"
            placeholder={t(isBeginner ? 'ai_input_beginner' : 'ai_input_pro')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={2}
          />
          {/*
             ★ 응답이 진행 중이면 보내기 대신 중단 버튼을 보여준다. 진행 중인 SSE 스트림을
               취소하고(activeStreamRef.abort) 진행 표시를 정리한다. 전에는 중단 수단이
               없어, 긴 응답이 돌면 사용자가 기다리거나 새로고침할 수밖에 없었다.
          */}
          {(thinking || streaming) ? (
            <button
              className="ai-input__send"
              title={t('ai_stop')}
              onClick={() => {
                if (activeStreamRef.current && activeStreamRef.current.abort) activeStreamRef.current.abort();
                activeStreamRef.current = null;
                setThinking(null);
                setStreaming(null);
              }}
            >
              <I.Stop size={16}/>
            </button>
          ) : (
            <button className="ai-input__send" onClick={() => handleSubmit()} disabled={!input.trim()}>
              <I.Send size={16}/>
            </button>
          )}
        </div>

        <div className="ai-layers">
          <div className="ai-layers__title">
            <I.Layers size={10} style={{display:'inline', verticalAlign:'-2px', marginRight: 4}}/>
            {t('ai_signal_layers')}
          </div>
          {[
            { name: 'AI Draft', label: t('ai_layer_draft'), count: overlays.filter(o=>o.source==='ai-draft').length, color: 'var(--color-ai)', dashed: true },
            { name: 'AI Approved', label: t('ai_layer_approved'), count: overlays.filter(o=>o.source==='ai-approved').length, color: 'var(--color-signal-approved)' },
            { name: 'My Drawings', label: t('ai_layer_mine'), count: overlays.filter(o=>o.source==='user').length, color: 'var(--color-text-primary)' },
            /* ★ 주문·포지션 개수는 실제 오버레이에서 센다. 전에는 3 으로 박혀 있었다 —
                 주문이 없어도 "3" 이라고 말하는 가짜 값이었다(사용자가 있지도 않은 주문을 믿는다). */
            { name: 'Orders', label: t('ai_layer_orders'), count: overlays.filter(o=>o.source==='order').length, color: 'var(--color-order-pending)' },
            { name: 'Positions', label: t('ai_layer_positions'), count: overlays.filter(o=>String(o.source||'').indexOf('position')===0).length, color: 'var(--color-trade-long)' },
          ].map(l => (
            <div className="ai-layer" key={l.name}>
              <span className="ai-layer__swatch" style={{background: l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined, borderTopColor: l.dashed ? l.color : undefined}}/>
              <span className="ai-layer__name">{l.label || l.name}</span>
              <span className="ai-layer__count">{l.count}</span>
              <button className="ai-layer__eye" title={t('ai_toggle')}><I.Eye size={12}/></button>
            </div>
          ))}
        </div>
          </>
        )}
      </div>
    );
  };

  // ---- Sub components ----
  function AIMessage({ msg, isBeginner, onSaveProposal, savingId }) {
    if (msg.role === 'system') {
      return (
        <div style={{display:'flex', alignItems:'center', gap: 8, fontSize: 11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', padding:'2px 0'}}>
          <span className="dot dot--live" style={{width:5,height:5}}/>
          <span>{msg.content}</span>
        </div>
      );
    }
    if (msg.toolResult) {
      return (
        <div style={{marginLeft: 34}}>
          <div className="ai-tool-result">
            <I.Sparkles size={11}/>
            <span>{msg.toolResult}</span>
            {msg.savable && !msg.saved && (
              <button
                className="btn btn--sm"
                style={{marginLeft:'auto'}}
                disabled={savingId === msg.id}
                onClick={() => onSaveProposal && onSaveProposal(msg.id, msg.savable)}
              >
                {savingId === msg.id ? t('sv_saving') : t('ai_save_proposal', { n: 100 })}
              </button>
            )}
            {msg.savedNote && <span style={{marginLeft: msg.savable && !msg.saved ? 8 : 'auto', fontSize:11, color:'var(--color-text-secondary)'}}>{msg.savedNote}</span>}
          </div>
        </div>
      );
    }
    if (msg.hint) {
      return (
        <div style={{marginLeft: 34, padding: '8px 12px', background:'var(--color-bg-surface)', borderRadius:6, fontSize: 12, color:'var(--color-text-secondary)', border:'1px dashed var(--color-border-default)'}}>
          {msg.hint}
        </div>
      );
    }
    const isUser = msg.role === 'user';
    return (
      <div className={`ai-msg ${isUser ? 'ai-msg--user' : 'ai-msg--ai'}`}>
        <div className="ai-msg__avatar">{isUser ? 'You' : 'AI'}</div>
        <div className="ai-msg__body">
          <div className="ai-msg__meta">
            <span>{isUser ? t('ai_you') : (isBeginner ? t('ai_mentor') : t('ai_analyst'))}</span>
            <span>·</span>
            <span>{new Date(msg.time).toLocaleTimeString('en-GB', {hour12:false})}</span>
          </div>
          <div className="ai-msg__bubble">
            {renderContent(msg.content)}
          </div>
        </div>
      </div>
    );
  }

  function SignalCard({ signal, onApprove, onCreateOrder, onEdit, onReject, isBeginner }) {
    const isApproved = signal.status === 'approved';
    return (
      <div style={{marginLeft: 34}}>
        <div className={`signal-card ${isApproved ? 'signal-card--approved' : ''}`}>
          <div className="signal-card__head">
            <div className="signal-card__title">
              <span className={`badge ${isApproved ? 'badge--approved' : 'badge--draft'}`}>{isApproved ? '✓ APPROVED' : '◐ AI DRAFT'}</span>
              <span style={{fontSize:14, fontWeight:600}}>{signal.symbol.replace('USDT','/USDT')}</span>
              <span className="badge badge--long">▲ LONG</span>
              <span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', fontSize:11}}>{signal.timeframe} · {signal.timeHorizon}</span>
            </div>
            <div style={{display:'inline-flex', alignItems:'center', gap: 10}}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end'}}>
                <span style={{fontSize:9, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-tertiary)'}}>{t('ai_confidence')}</span>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{(() => {
                  /*
                     ★ 모델 이름을 코드에 박지 않는다.

                       'Model v1' 이라고 적혀 있었다. 실제로 어떤 모델이 돌고
                       있는지와 무관한 글자다. 이용자가 신호의 근거를 판단할 때
                       모델 버전을 보는데, 그것이 사실이 아니면 판단 근거가 없다.
                       서버가 알려주지 않으면 '—' 로 둔다.
                  */
                  const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
                  const model = cfg && cfg.aiModel ? String(cfg.aiModel) : '';
                  return model || t('dash');
                })()}</span>
              </div>
              <div className={`conf-ring ${isApproved ? 'conf-ring--approved' : ''}`} style={{'--pct': signal.confidence}}>
                <span className="conf-ring__label">{signal.confidence}%</span>
              </div>
            </div>
          </div>

          <div className="signal-card__grid">
            <div className="signal-card__row"><span className="signal-card__k">{t('ai_entry_zone')}</span><span className="signal-card__v">{fmt(signal.entryZone[0], 0)} – {fmt(signal.entryZone[1], 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">{t('op_stop_loss')}</span><span className="signal-card__v t-short">{fmt(signal.stopLoss, 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">R : R</span><span className="signal-card__v">1 : {signal.riskReward.toFixed(1)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">TP1 / TP2 / TP3</span><span className="signal-card__v t-long">{fmt(signal.takeProfits[0], 0)} / {fmt(signal.takeProfits[1], 0)} / {fmt(signal.takeProfits[2], 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">{t('ai_time_horizon')}</span><span className="signal-card__v">{signal.timeHorizon}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">{t('ai_invalidation_word')}</span><span className="signal-card__v" style={{fontSize: 11, color:'var(--color-text-secondary)'}}>{signal.invalidationKey ? t(signal.invalidationKey) : signal.invalidation}</span></div>
          </div>

          <div className="signal-card__reason">
            <strong>{t(isBeginner ? 'ai_reason_beginner' : 'ai_reason_pro')}: </strong>{signal.reasonKey ? t(signal.reasonKey) : signal.reason}
          </div>

          {/* Invalidation banner — always visible, cannot be missed */}
          <div className="invalidation-banner">
            <I.Alert size={14} className="invalidation-banner__icon"/>
            <div>
              <strong>{t('ai_invalidation')}</strong> {signal.invalidationKey ? t(signal.invalidationKey) : signal.invalidation}
              <span style={{color:'var(--color-text-tertiary)', marginLeft: 6, fontFamily:'var(--font-mono)', fontSize: 10}}>{t('ai_invalidation_note')}</span>
            </div>
          </div>

          <div className="signal-card__actions">
            {!isApproved ? (
              <>
                <button className="btn btn--sm btn--primary" onClick={onApprove}><I.Check size={12}/> {t('ai_approve_signal')}</button>
                <button className="btn btn--sm" onClick={onEdit}>{t('col_edit')}</button>
                <button className="btn btn--sm">{t('ai_save_draft')}</button>
                <button className="btn btn--sm btn--danger" onClick={onReject}>{t('col_reject')}</button>
              </>
            ) : (
              <>
                <button className="btn btn--sm btn--primary" onClick={onCreateOrder}><I.ArrowRight size={12}/> {t('ai_create_order_draft')}</button>
                <button className="btn btn--sm">{t('ai_set_alert')}</button>
                <button className="btn btn--sm">{t('lay_duplicate')}</button>
              </>
            )}
          </div>

          <div style={{fontSize: 10, color:'var(--color-text-tertiary)', display:'flex', gap: 10}}>
            <span>Generated {new Date(signal.createdAt).toLocaleTimeString('en-GB',{hour12:false})}</span>
            <span>·</span>
            <span>{t('copilot_model_label')}</span>
            <span>·</span>
            <span>ID: {signal.id}</span>
          </div>
        </div>
      </div>
    );
  }
})();
