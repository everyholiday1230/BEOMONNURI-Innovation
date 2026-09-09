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
    context, isBeginner, overlays, addOverlay, updateOverlay, removeOverlay: _removeOverlay,
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
       ★★ 후속 제안. 서버가 규칙으로 골라 보낸다(모델이 만들지 않는다).

         답변만 하고 끝내면 고객이 매번 "다음에 뭘 물어야 하나" 를 스스로 떠올려야
         한다. 대화 흐름에 맞는 다음 질문을 제시해 그 부담을 없앤다.

       ★ 새 질문을 보내면 즉시 비운다. 이전 답변에 딸린 제안이 남아 있으면 방금
         답변과 관계없는 것을 권하는 셈이 된다.
    */
    const [followUps, setFollowUps] = useState([]);
    /*
       복기 제안을 낼 수 있는지 판단하는 값.

       ★★ null 을 유지한다 — **모르는 것과 없는 것을 구별한다.** false 로 시작하면
         조회 전에 "거래 기록 없음" 이 되어 복기 제안이 영구히 안 나온다.

       ★ 한 번만 조회한다. 제안 문구를 고르는 데만 쓰므로 실시간일 필요가 없다.
    */
    const [hasTradeHistory, setHasTradeHistory] = useState(null);
    /* 시그널 카드의 저장·알림 진행 상태와 결과 문구. */
    const [sigSaveBusy, setSigSaveBusy] = useState(false);
    const [sigAlertBusy, setSigAlertBusy] = useState(false);
    const [sigNote, setSigNote] = useState(null);
    useEffect(() => {
      let dead = false;
      /* ★ localOrders 는 window.QTApi.rest 에 있다 — QTApi 직하가 아니다(실측으로 확인). */
      const api = window.QTApi && window.QTApi.rest;
      if (!api || typeof api.localOrders !== 'function') return undefined;
      api.localOrders({ limit: 1 })
        .then((r) => { if (!dead) setHasTradeHistory(Boolean(r && ((r.total || 0) > 0 || (r.items || []).length > 0))); })
        /* ★ 실패는 null 로 남긴다. false 로 바꾸면 조회 실패가 '거래 없음' 이 된다. */
        .catch(() => { if (!dead) setHasTradeHistory(null); });
      return () => { dead = true; };
    }, []);
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
       ★★ AI 사용 가능 여부는 **여기서** 선언한다(아래 복원 effect 보다 위).

         예전에는 이 선언이 파일 한참 아래에 있었는데, 복원 effect 의 의존성
         배열([aiReady])은 **렌더 중에** 평가된다. 즉 선언 전에 읽혔다.
         브라우저 Babel 이 const 를 var 로 낮추던 동안에는 값이 undefined 가 되어
         오류 없이 넘어갔고(그래서 복원이 첫 렌더에서 항상 건너뛰어졌다),
         사전 컴파일에서 var 변환을 빼자 TDZ 오류로 화면이 통째로 죽었다.

       ★ 즉 이건 문법 문제가 아니라 **선언보다 먼저 쓰는 실제 결함**이었고,
         var 호이스팅이 가려주고 있었다. 선언을 사용보다 앞으로 옮겨 고친다.
    */
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

    /*
       새로고침 후 대화 복원.

       대화 id 를 localStorage 에 저장해 두고, 마운트 시 서버에서 이전 메시지를
       불러와 이어 붙인다. id 가 이 사용자 것이 아니면(다른 로그인) 서버가 404 →
       저장을 지우고 새로 시작한다. AI 가 준비된 뒤에만 시도한다.
    */
    /*
       ★★ 과거 대화 목록.

         대화는 서버에 저장되고 마운트 시 **가장 최근 것 하나**가 자동 복원됐다.
         그런데 aiListConversations() 는 목록 전체를 돌려주는데도 화면은 list[0]
         만 썼다 — 즉 어제 하던 대화로 돌아갈 방법이 없었다. 저장·복원 기능이
         있는데 고를 수 없어서 없는 것처럼 보였다.

       ★ null = 아직 모름, [] = 정말 없음, convError = 조회 실패.
         조회 실패를 빈 목록으로 두면 "대화가 없다" 로 읽힌다.
    */
    const [convOpen, setConvOpen] = useState(false);
    const [convList, setConvList] = useState(null);
    const [convError, setConvError] = useState(false);
    const [convBusy, setConvBusy] = useState(null);

    /** 대화 하나를 화면에 올린다. 마운트 복원과 목록 선택이 같은 경로를 쓴다. */
    const restoreConversation = useCallback(async (id, persist) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiConversationMessages || !id) return false;
      const rows = await api.aiConversationMessages(id);
      if (!Array.isArray(rows) || rows.length === 0) return false;
      convRef.current = id;
      if (persist) { try { localStorage.setItem(CONV_KEY, id); } catch (e) { /* noop */ } }
      greetedRef.current = true; // 복원 시 인사말 생략(이미 대화가 있다)
      setMsgs([
        makeMsg('system', ctxText(), { icon: 'ok' }),
        ...rows.map((r) => makeMsg(r.role === 'assistant' ? 'ai' : (r.role === 'user' ? 'user' : 'system'), r.content || '')),
      ]);
      return true;
    }, []);

    const loadConversations = useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiListConversations) { setConvList([]); return; }
      api.aiListConversations().then((r) => {
        if (r && r.ok === false) { setConvList(null); setConvError(true); return; }
        setConvError(false);
        setConvList((r && r.conversations) || []);
      }).catch(() => { setConvList(null); setConvError(true); });
    }, []);

    const toggleConversations = useCallback(() => {
      setConvOpen((o) => { const n = !o; if (n) loadConversations(); return n; });
    }, [loadConversations]);

    const pickConversation = useCallback(async (id) => {
      setConvBusy(id);
      try {
        const ok = await restoreConversation(id, true);
        if (ok) setConvOpen(false);
      } catch (e) { /* 실패는 아래 목록에 남는다 */ }
      setConvBusy(null);
    }, [restoreConversation]);

    const restoredRef = useRef(false);
    useEffect(() => {
      if (restoredRef.current || !aiReady) return;
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiConversationMessages) return;
      let saved = null;
      try { saved = localStorage.getItem(CONV_KEY); } catch (e) { /* 접근 불가 */ }
      restoredRef.current = true;
      let cancelled = false;
      /*
         ★ 마운트 복원과 목록 선택이 **같은 함수**를 쓴다. 예전에는 이 안에만
           복원 로직이 있어서 목록에서 고르는 기능을 붙일 수 없었다.
           cancelled 검사만 여기서 덧붙인다(마운트 해제 후 setState 방지).
      */
      const restore = (id, persist) => restoreConversation(id, persist)
        .then((ok) => (cancelled ? false : ok));
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
          if (updateOverlay && a.patch) updateOverlay(a.overlayId, a.patch);
          return t('ai_cmd_applied');
        default:
          return null;
      }
    }, [addOverlay, _removeOverlay, updateOverlay, anchorTime, t]);

    /* 서버가 검증해 보낸 SignalObject를 오버레이(진입/손절/익절/마커)로 그리고 상위에 제안한다. */
    /*
       고객이 만든 셋업의 검토 결과를 차트에 얹는다.

       ★★ 전에는 `if (!Array.isArray(sig.entryZone)) return;` 로 시작했다. 서버가
         구조를 바꾼 뒤(entryZone → entry, takeProfits → targets) 이 가드가 **모든
         결과를 조용히 걸러냈다.** 그런데 대화에는 '📊 5 overlays created' 가
         그대로 붙었다 — 화면이 그리지 않은 것을 그렸다고 말한 것이다.
         이 코드베이스가 금지한 실패 방식이고, 실제로 고객 문의로 돌아왔다.

       ★ 그래서 **그린 것만 세어서 돌려준다.** 호출부가 그 개수로 문구를 만든다.
         하드코딩한 개수를 쓰면 같은 사고가 반복된다.

       ★ entry 는 이제 구간이 아니라 한 점이다(고객이 입력한 진입가). 손절·목표가는
         고객이 주지 않았으면 없다 — 없는 것을 지어내 그리지 않는다.
    */
    const applySignal = useCallback((sig) => {
      if (!sig || !Array.isArray(sig.sides) || sig.sides.length === 0) return [];
      const anchor = anchorTime();
      const drawn = [];

      /*
         ★★ 방향을 말하지 않은 고객에게는 **롱·숏을 같은 굵기로** 그린다.

           한쪽만 그리거나 한쪽을 강조하면 그것이 곧 추천이 된다. 그리는 방식으로도
           방향을 발신하지 않아야 한다 — 문구만 대칭이고 그림이 한쪽이면 고객은
           그림을 믿는다.

         ★ 그래서 오버레이 id 에 방향을 넣어 두 벌이 공존하게 한다. 예전에는
           'sig-entry' 처럼 고정 id 여서 두 번째 방향이 첫 번째를 덮어썼다.

         ★ 그린 것만 세어서 돌려준다. 하드코딩한 개수를 쓰면 "5개 그렸습니다" 라고
           말하고 아무것도 안 그리는 사고가 반복된다(실제로 고객 문의로 돌아왔다).
      */
      const both = sig.sides.length > 1;
      sig.sides.forEach((side) => {
        if (!side || !side.direction) return;
        const d = side.direction;
        const tag = both ? ' (' + t(d === 'long' ? 'side_long' : 'side_short') + ')' : '';
        const entry = toNum(side.entry);
        if (Number.isFinite(entry) && entry > 0) {
          addOverlay({ id: 'sig-entry-' + d, type: 'horizontal', source: 'ai-draft', points: [{ price: entry, time: anchor }], label: t('ai_overlay_entry_zone') + tag });
          drawn.push(t('ai_overlay_entry_zone') + tag);
          addOverlay({ id: 'sig-marker-' + d, type: 'signal-marker', source: 'ai-draft', direction: d, points: [{ time: anchor, price: entry }] });
        }
        const stop = toNum(side.stop);
        if (Number.isFinite(stop) && stop > 0) {
          addOverlay({ id: 'sig-sl-' + d, type: 'horizontal', source: 'ai-draft', points: [{ price: stop, time: anchor }], label: 'SL' + tag + ' · ' + side.stop });
          drawn.push('SL' + tag);
        }
        (Array.isArray(side.targets) ? side.targets : []).forEach((tp, i) => {
          const v = toNum(tp);
          if (!Number.isFinite(v) || v <= 0) return;
          addOverlay({ id: 'sig-tp' + (i + 1) + '-' + d, type: 'horizontal', source: 'ai-draft', points: [{ price: v, time: anchor }], label: 'TP' + (i + 1) + tag + ' · ' + tp });
          drawn.push('TP' + (i + 1) + tag);
        });
      });

      if (onProposeSignal) onProposeSignal(sig);
      return drawn;
    }, [addOverlay, anchorTime, onProposeSignal, t]);

    // AI 가 만든 선/신호를 저장한다(포인트 차감). 저장소는 PG(/me/saved).
    const [savingId, setSavingId] = useState(null);
    /*
       ★ saveProposal 은 loadSaved 보다 위에 선언돼 있다. deps 배열에 loadSaved 를
         직접 넣으면 렌더 중 아직 초기화되지 않은 const 를 읽어(TDZ) 앱이 죽는다.
         그래서 ref 로 건넨다.
    */
    const loadSavedRef = useRef(null);
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
          // ★ 저장 직후 목록을 다시 읽는다. 안 하면 방금 저장한 항목이 목록에 없다.
          if (loadSavedRef.current) loadSavedRef.current();
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
    /* 저장이 요금제에 포함돼 있는가. 서버 판정을 그대로 쓴다(조회 실패 시 false). */
    const [savesAllowed, setSavesAllowed] = useState(false);
    const [savedError, setSavedError] = useState(false);
    const loadSaved = useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedList) { setSavedItems([]); return; }
      /*
         ★ 조회 실패를 빈 목록으로 두면 "저장된 게 없다"고 보인다. 저장한 게
           사라진 것처럼 보이는 게 제일 나쁜 오해라, 실패는 실패로 알린다.
           (null = 오류 상태, [] = 정말 없음)
      */
      api.savedList().then((r) => {
        if (r && r.ok === false) { setSavedItems(null); setSavedError(true); return; }
        setSavedError(false);
        setSavedItems((r && r.items) || []);
        /*
           ★ 저장 가능 여부는 **서버 판정**이다(요금제 plan_f_saves). 무료 플랜은
             저장이 아예 불가하므로(운영 결정 2026-09-08) 버튼을 눌러 402 를 보게
             하지 않고 미리 막고 이유를 적는다.
        */
        setSavesAllowed(Boolean(r && r.savesAllowed));
      }).catch(() => { setSavedItems(null); setSavedError(true); setSavesAllowed(false); });
    }, []);
    /*
       ★ 목록을 한 번도 열지 않아도 저장 버튼의 활성 여부를 알아야 한다.
         마운트 때 한 번 읽는다(목록은 접혀 있어도 게이트 판정은 필요하다).
    */
    useEffect(() => { loadSaved(); }, [loadSaved]);
    useEffect(() => { loadSavedRef.current = loadSaved; }, [loadSaved]);
    const toggleSaved = useCallback(() => {
      setSavedOpen((o) => { const n = !o; if (n) loadSaved(); return n; });
    }, [loadSaved]);
    const deleteSavedItem = useCallback((id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedDelete) return;
      api.savedDelete(id).then(() => loadSaved()).catch(() => { /* noop */ });
    }, [loadSaved]);

    /*
       저장 항목을 차트에 다시 적용한다(불러오기).

       ★ 저장은 종류(kind)와 payload 를 각 고객별 DB 에 남긴다. 여기서 그 payload 로
         드로잉/신호를 다시 그린다. 예전에는 목록만 보여주고 다시 그릴 방법이 없어
         "불러오기" 가 사실상 없었다.
    */
    const applySaved = useCallback((it) => {
      if (!it) return;
      try {
        if (it.kind === 'drawing' && it.payload) { applyCommand(it.payload); }
        else if (it.kind === 'signal' && it.payload) { applySignal(it.payload); }
        else if (it.kind === 'indicator' && it.payload && it.payload.command) { applyCommand(it.payload); }
        setMsgs((m) => [...m, makeMsg('system', t('sv_loaded', { name: it.name || '' }), { icon: 'ok' })]);
      } catch (e) { /* 적용 실패는 조용히 무시 — 저장 데이터가 손상됐을 수 있다 */ }
      setSavedOpen(false);
    }, [applyCommand, applySignal, t]);

    /*
       ★★ 시그널 카드의 '초안 저장' 과 '알림 설정'.

         두 버튼 모두 onClick 이 없어 눌러도 아무 일이 없었다. 그런데 서버 기능은 둘 다
         이미 있었다 — 저장은 savedCreate(이 파일의 다른 곳에서 쓴다), 알림은
         POST /api/me/alerts. **화면에서만 끊겨 있었다.**

       ★ 결과를 반드시 말한다. 눌렀는데 표시가 없으면 됐는지 알 수 없고, 고객은 다시
         누른다 — 알림이 두 개 생긴다.
    */
    const saveSignalDraft = useCallback(async () => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || typeof api.savedCreate !== 'function' || !currentSignal) return;
      setSigSaveBusy(true); setSigNote(null);
      const sym = String(context.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      try {
        const r = await api.savedCreate({
          kind: 'signal',
          name: `${sym || 'signal'} ${currentSignal.direction || ''}`.trim(),
          symbol: sym || undefined,
          timeframe: context.tf,
          payload: currentSignal,
        });
        setSigNote(r && r.ok !== false
          ? { ok: true, text: t('sv_saved_ok', { n: (r && r.name) || '' }) }
          : { ok: false, text: (r && r.message) || t('sv_save_failed') });
      } catch (e) {
        /* ★ 포인트 부족은 다른 문제다 — 저장 실패로 뭉뚱그리지 않는다. */
        const insuff = e && e.status === 402;
        setSigNote({ ok: false, text: insuff ? t('ai_points_insufficient') : ((e && e.message) || t('sv_save_failed')) });
      }
      setSigSaveBusy(false);
    }, [currentSignal, context.symbol, context.tf, t]);

    const setSignalAlert = useCallback(async () => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || typeof api.createPriceAlert !== 'function' || !currentSignal) return;
      /*
         ★ 진입 구간의 가까운 쪽을 알림 가격으로 쓴다. 구간을 알림으로 바꿀 수는 없으므로
           "이 가격에 닿으면 알려 달라" 로 좁힌다.
         ★ 방향은 현재가 기준으로 정한다. 위/아래를 잘못 고르면 알림이 즉시 발동하거나
           영원히 안 온다.
      */
      const zone = Array.isArray(currentSignal.entryZone) ? currentSignal.entryZone.map(Number) : [];
      const target = zone.length ? (currentSignal.direction === 'short' ? Math.max(...zone) : Math.min(...zone)) : null;
      if (!target || !Number.isFinite(target)) { setSigNote({ ok: false, text: t('ai_alert_no_price') }); return; }
      const last = Number(context.price);
      const direction = Number.isFinite(last) ? (target >= last ? 'above' : 'below') : 'above';
      setSigAlertBusy(true); setSigNote(null);
      try {
        const r = await api.createPriceAlert({
          symbol: String(context.symbol || '').toUpperCase(),
          direction,
          targetPrice: target,
        });
        setSigNote(r && r.ok !== false
          ? { ok: true, text: t('ai_alert_created', { price: String(target) }) }
          : { ok: false, text: (r && r.message) || t('ai_alert_failed') });
      } catch (e) {
        setSigNote({ ok: false, text: (e && e.message) || t('ai_alert_failed') });
      }
      setSigAlertBusy(false);
    }, [currentSignal, context.symbol, context.price, t]);

    const handleSubmit = useCallback(async (raw) => {
      const text = (raw ?? input).trim();
      if (!text) return;
      /* ★ 이전 답변의 제안을 즉시 비운다. 남겨두면 방금 질문과 무관한 것을 권한다. */
      setFollowUps([]);
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
      /*
         ★★ 전에는 `indexOf('ko') === 0 ? 'ko' : 'en'` 2택이었다. 그런데 한국어 사전이
           등록돼 있지 않아 getLocale() 이 'ko' 를 돌려주는 일이 없었고, 결과적으로
           **항상 'en'** 이 나갔다. 일본어·중국어 이용자도 'en' 으로 뭉개졌다.

         ★ 이제 UI 로케일을 그대로 보낸다(참고용). 실제 응답 언어는 서버 프롬프트가
           **고객이 쓴 문장의 언어**로 결정한다 — UI 가 영어인데 한국어로 물은 고객이
           영어 답을 받는 것이 원래 불만이었기 때문이다. 이 값은 언어를 판별할 수
           없을 때의 참고값으로만 쓴다.
      */
      const lang = (() => {
        try {
          const loc = window.QTI18n && window.QTI18n.getLocale ? String(window.QTI18n.getLocale() || '') : '';
          return loc ? loc.toLowerCase() : 'en';
        } catch (e) { return 'en'; }
      })();
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
        /*
           ★★ 계산된 지표 값을 함께 보낸다. 이것이 없으면 AI 는 수치를 말할 수 없다
             (안전 규칙이 출처 없는 숫자를 금지한다).

             화면이 이미 계산한 값을 그대로 보낸다 — 서버에서 다시 계산하면 고객이
             보는 숫자와 어긋날 수 있고, 그러면 어느 쪽도 믿을 수 없다.

           ★ 최신 값과 그 직전 값만 보낸다. 전체 계열(지표당 수백 개)을 보내면
             프롬프트가 비대해지고 토큰 비용이 오른다. 해석에 필요한 것은 현재
             값과 방향이다.

           ★★ 값이 없는 지표는 값 필드 없이 이름만 간다. 0 이나 null 을 넣으면
             모델이 그것을 값으로 읽는다.
        */
        indicatorValues: Array.isArray(context.indicatorDetail)
          ? context.indicatorDetail.slice(0, 12).map((d) => ({
            name: d.id,
            ...(d.params && d.params.calcParams ? { params: d.params.calcParams } : {}),
            ...(d.latest ? { latest: d.latest } : {}),
            ...(d.previous ? { previous: d.previous } : {}),
          }))
          : [],
        /*
           ★★ 후속 제안을 고르는 근거. 서버가 규칙으로 제안을 고를 때만 쓴다.

             권한 판단에는 쓰이지 않는다(브라우저가 보낸 값이라 신뢰할 수 없다).
             틀려도 최악의 결과가 "덜 알맞은 제안" 이어야 한다.

           ★ 모르는 값은 보내지 않는다. 0 으로 보내면 "없다" 가 되어, 조회 실패와
             실제로 없는 것을 구별할 수 없다.
        */
        positionCount: Array.isArray(overlays)
          ? overlays.filter((o) => o && String(o.source || '').startsWith('position')).length
          : undefined,
        openOrderCount: Array.isArray(overlays)
          ? overlays.filter((o) => o && o.source === 'order').length
          : undefined,
        /* ★ null 이면 보내지 않는다 — 서버도 '모름' 으로 취급한다. */
        hasTradeHistory: hasTradeHistory === null ? undefined : hasTradeHistory,
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
            /*
               ★★ 진행 표시가 **항상 비어 있었다.**

                 `setThinking({ steps: [], ... })` 가 유일한 호출이었고 steps 를 채우는
                 코드가 없어서, 사고 단계 패널(1085행의 steps.map)이 아무것도 그리지
                 않았다. 고객은 질문을 보낸 뒤 'Thinking' 글자만 보고 기다렸다 —
                 도구를 몇 개 쓰는지, 어디까지 갔는지 알 수 없었다.

               ★ 서버는 이미 보내고 있었다. `state`(validating·streaming)와
                 `tool`(name·ok)을 orchestrator 가 내보내고 ai-routes 가 그대로
                 흘려보내는데(:299), 클라이언트가 "내부 신호" 로 버렸다.

               ★ 도구 이름을 사람이 읽는 말로 바꾸지 않는다. 14개 도구에 언어별
                 사전을 만들면 도구가 늘 때마다 사전이 뒤처지고, 뒤처진 사전은
                 빈 칸으로 나타난다. 밑줄만 공백으로 바꿔 그대로 보여준다.
            */
            if (ev.type === 'state') {
              const label = ev.state === 'validating' ? t('ai_step_validating')
                : ev.state === 'streaming' ? t('ai_state_streaming_note')
                  : null;
              if (label) {
                setThinking((prev) => {
                  const steps = (prev && Array.isArray(prev.steps)) ? prev.steps : [];
                  if (steps.some((s) => s.text === label)) return prev;
                  const next = steps.concat([{ text: label }]);
                  return { steps: next, currentIdx: next.length - 1, msg: (prev && prev.msg) || t('ai_thinking') };
                });
              }
              return;
            }
            if (ev.type === 'tool') {
              /*
                 ★ 실패한 도구를 성공처럼 보이게 두지 않는다. 패널의 체크 표시는
                   순서(index)로만 정해지므로, 실패는 문구에 표시해야 드러난다.
              */
              const base = t('ai_step_tool', { name: String(ev.name || '').replace(/_/g, ' ') });
              const text = ev.ok === false ? base + ' ✗' : base;
              setThinking((prev) => {
                const steps = (prev && Array.isArray(prev.steps)) ? prev.steps : [];
                const next = steps.concat([{ text }]);
                return { steps: next, currentIdx: next.length - 1, msg: (prev && prev.msg) || t('ai_thinking') };
              });
              return;
            }
            if (ev.type === 'command') { const note = applyCommand(ev.command); if (note) setMsgs((m) => [...m, makeMsg('ai', '', { toolResult: note, savable: { kind: 'drawing', name: note, payload: ev.command } })]); return; }
            if (ev.type === 'signal') {
              /*
                 ★★ 전에는 `toolResult: t('ai_tool_signal')` — '📊 5 overlays created ·
                   entry zone / SL / TP1-3 / long marker' 를 **하드코딩**했다. 실제로
                   몇 개를 그렸는지와 무관했고, 서버 구조가 바뀐 뒤에는 하나도 그리지
                   않았는데도 이 문구가 나갔다. 고객은 차트를 보고 "안 그려졌다" 고
                   문의했다.
                 ★ applySignal 이 그린 것을 돌려주므로 그것만 적는다. 아무것도 못
                   그렸으면 그 사실을 적는다 — 조용히 넘어가면 같은 문의가 반복된다.
              */
              const drawn = applySignal(ev.signal) || [];
              const note = drawn.length
                ? t('ai_setup_drawn', { n: drawn.length, items: drawn.join(' / ') })
                : t('ai_setup_nothing_drawn');
              setMsgs((m) => [...m, makeMsg('ai', '', {
                toolResult: note,
                /*
                   ★ 저장 이름에 방향을 넣되, 양방향 제시면 방향을 넣지 않는다 —
                     '내 셋업 · long' 으로 저장되면 고르지 않은 방향이 기록에 남는다.
                */
                savable: { kind: 'signal', name: t('ai_my_setup') + (() => {
                  const s = ev.signal && Array.isArray(ev.signal.sides) ? ev.signal.sides : [];
                  return s.length === 1 && s[0].direction ? ' · ' + s[0].direction : '';
                })(), payload: ev.signal },
              })]);
              return;
            }
            if (ev.type === 'suggestions') { setFollowUps(Array.isArray(ev.items) ? ev.items : []); return; }
            if (ev.type === 'points') { setMsgs((m) => [...m, makeMsg('ai', '', { toolResult: t('ai_points_charged', { n: ev.charged, bal: ev.balance }) })]); return; }
            if (ev.type === 'error') {
              setThinking(null); setStreaming(null);
              /*
                 ★★ **거부된 답변을 화면에 남기지 않는다.**

                   서버는 답변을 스트리밍한 뒤 안전 검사(screenModelOutput)를 하고,
                   걸리면 `unsafe-output` 을 보낸다. 그런데 그때까지 쌓인 텍스트가
                   `acc` 에 남아 있어서, 아래 onDone 이 그것을 **그대로 대화에
                   추가**했다. 즉 "수익 보장" 같은 문구나 시세가 낡은 상태의 조언이
                   서버가 거부했는데도 고객 화면에 보였다.

                 ★ acc 를 비워야 onDone 이 추가하지 않는다. 경고만 띄우고 텍스트를
                   남기면, 고객은 경고를 흘려보고 본문을 읽는다.

                 ★ 왜 서버가 스트리밍 전에 막지 않는가: 검사는 답변 **전체**를 봐야
                   한다(문장 중간까지로는 수익 보장 문구를 판정할 수 없다). 그래서
                   스트리밍 UX 를 유지하려면 클라이언트가 회수하는 것이 맞다.
              */
              const unsafe = (ev.code === 'unsafe-output');
              if (unsafe) acc = '';

              /*
                 ★★ **방향을 안 말했을 때는 오류가 아니다 — 되물어야 한다.**

                   서버(orchestrator)는 고객이 방향(롱/숏)을 말하지 않았는데 모델이
                   수준을 제안하려 하면 `direction-not-stated` 로 거부한다. 방향을 AI 가
                   고르면 그것이 곧 매매 신호가 되므로, 그 거부 자체는 맞다.

                 ★★ 그런데 이 화면이 그것을 **개발자용 영어 문장 그대로** 경고로 띄웠다:

                     ⚠ the user has not stated a direction — ask them to choose ...

                   고객에게는 그냥 고장으로 보인다. BEWHITE 님이 "또 안 된다" 고 한 것이
                   이것이다. 방향을 안 쓰는 것이 오히려 자연스러운 질문 방식이라
                   (예: "BTC 어때?") 대부분의 요청에서 이 화면이 나왔다.

                 ★ 스트림에 도구 결과를 모델에 되먹이는 루프가 없다(단일 패스). 그래서
                   모델이 스스로 되묻게 만들 수 없다. 되묻는 문장은 이 화면이 만든다 —
                   그래야 고객의 UI 언어로 나온다.

                 ★ 롱·숏을 **같은 크기로 나란히** 놓는다. 하나를 먼저·크게 놓으면 그것이
                   추천으로 읽히고, 그러면 방향을 AI 가 고른 것과 다르지 않다.

                 ★ acc 를 비우지 않는다. 방향 없이도 할 수 있는 관찰(지지·저항·추세선)은
                   이미 유효하게 스트리밍됐다. 그것을 지우면 고객은 아무것도 못 받는다.
              */
              /*
                 ★★ 이제 이 경로는 **드물다** — 그러나 지우지 않는다.

                   정책이 바뀌었다. 방향을 말하지 않아도 서버는 거부하지 않고 롱·숏을
                   **함께** 제시한다(review_setup 의 sides 2개). 그래서 정상 흐름에서는
                   이 오류가 나오지 않는다.

                 ★ 남겨두는 이유: 차트 명령 경로에서 한쪽 마커만 그리려 할 때 여전히
                   이 코드로 거부한다(방향 발신 구멍 차단). 그때 고객 화면에 개발자용
                   영어가 뜨면 안 된다 — 그것이 BEWHITE 님이 겪은 문제였다.

                 ★ 그리고 모델이 sides 를 한쪽만 보내 스키마 검증에 떨어지는 경우에도
                   고객에게는 "방향을 알려주세요" 로 보이는 것이 맞다. 내부 위반을
                   고객이 이해할 수 있는 요청으로 바꿔주는 자리다.
              */
              if (ev.code === 'direction-not-stated') {
                if (acc) { setMsgs((m) => [...m, makeMsg('ai', acc)]); acc = ''; }
                /*
                   ★★ 고객이 쓴 언어로 되묻는다.

                     이 문장은 서버가 아니라 이 화면이 만들기 때문에 **UI 언어**로 나온다.
                     그런데 UI 는 en/ja/zh 뿐이라, 한국어로 질문한 고객이 영어 답을 받는다.
                     방금 고친 "고객이 쓴 언어로 답한다" 가 이 경로에서만 깨진다.

                   ★ UI 에 한국어를 추가하는 것이 아니다(운영 결정: 한국어 UI 없음).
                     **AI 의 답변만** 고객 언어를 따르게 하는 것이고, 그것은 이미 정해진
                     방침이다. 그래서 이 문장에 한해 한글 입력을 보고 갈라준다.

                   ★ 판정은 한글 음절 존재 여부다. 로마자로 쓴 한국어("long? eottae?")까지
                     잡으려 하면 다른 언어를 오판한다 — 넓히지 않는다.
                */
                const ko = /[\uAC00-\uD7A3]/.test(text);
                setMsgs((m) => [...m, makeMsg('ai', ko
                  ? '진입·손절·목표 가격을 잡으려면 어느 방향으로 보고 계신지 알아야 합니다. 여기서는 롱과 숏 모두 성립하는데 가격대가 달라집니다. 방향을 말씀해 주시면 그 전제로 검토해 드리겠습니다. 롱인가요, 숏인가요?'
                  : t('ai_ask_direction'))]);
                setFollowUps(ko
                  ? [
                    /* ★ 칩 문구에도 방향 단어(롱/숏)가 들어 있어야 한다 — 이것을 눌러 보낸
                         문장이 다시 서버의 방향 검사를 통과해야 하기 때문이다. */
                    { key: 'ko_long', labelText: '롱', questionText: '여기서 롱으로 보고 있어요 — 제 셋업을 검토해 주세요' },
                    { key: 'ko_short', labelText: '숏', questionText: '여기서 숏으로 보고 있어요 — 제 셋업을 검토해 주세요' },
                  ]
                  : [
                    { key: 'ai_dir_long_chip', promptKey: 'ai_dir_long_prompt' },
                    { key: 'ai_dir_short_chip', promptKey: 'ai_dir_short_prompt' },
                  ]);
                return;
              }

              const insuff = (ev.code === 'INSUFFICIENT_POINTS');
              setMsgs((m) => [...m, makeMsg('ai',
                insuff ? t('ai_need_points')
                  : unsafe ? t('ai_unsafe_output')
                    : t('ai_stream_error', { msg: ev.message || ev.code || '' }),
                { icon: 'warn' })]);
              return;
            }
            // 'tool' | 'state' | 'usage' — 내부 신호, UI 에 별도 표시하지 않는다.
          },
          onError: (e) => { setThinking(null); setStreaming(null); const insuff = (e && e.code === 'INSUFFICIENT_POINTS'); setMsgs((m) => [...m, makeMsg('ai', insuff ? t('ai_need_points') : t('ai_stream_error', { msg: (e && e.message) || '' }), { icon: 'warn' })]); },
          onDone: () => { setThinking(null); setStreaming(null); if (acc) setMsgs((m) => [...m, makeMsg('ai', acc)]); activeStreamRef.current = null; },
        },
      );
      activeStreamRef.current = stream;
    }, [input, aiReady, context.symbol, context.tf, context.indicators, overlays, hasTradeHistory, t, applyCommand, applySignal]);

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
      <div className={`panel qt-ai-panel ${collapsed ? 'qt-ai-collapsed' : ''}`} style={{height:'100%'}}>
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
            <button aria-label={collapsed ? t('ai_expand') : t('ai_collapse')}
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
              <button aria-label={t('ai_clear_chat')}
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
                {/*
                   ★★ 아이콘이 `I.More`(점 3개) 였다. 다른 패널의 **더보기 메뉴와
                     완전히 같은 모양**이다(widgets.jsx 의 orderBook·orderEntry 등).

                     그래서 메뉴가 열릴 것으로 기대하고 누르는데 **대화가 지워진다.**
                     되돌릴 수 없는 동작을 메뉴처럼 보이는 버튼에 둔 것이다.

                   ★ 휴지통으로 바꾼다. 지우는 동작임이 모양만으로 드러나고, 같은
                     헤더의 접기 화살표(I.Up/I.Down)와도 혼동되지 않는다.
                */}
                <I.Trash size={14}/>
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
          {/* 과거 대화 — 저장·자동복원은 되는데 고를 방법이 없었다. */}
          <span
            className="ai-ctx-chip"
            role="button"
            tabIndex={0}
            style={{cursor:'pointer'}}
            onClick={toggleConversations}
            title={t('ai_conv_title')}
          >
            <I.Book size={10}/> {t('ai_conv_view')}{Array.isArray(convList) ? ' · ' + convList.length : ''}
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

        {convOpen && (
          <div style={{margin:'0 0 6px', border:'1px solid var(--color-border-subtle)', borderRadius:6, background:'var(--color-bg-surface)', maxHeight:180, overflowY:'auto'}}>
            {convError ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-danger, #dc2626)'}}>
                {t('ai_conv_failed')}{' '}
                <button type="button" className="btn btn--sm" onClick={loadConversations}>{t('sv_retry')}</button>
              </div>
            ) : convList === null ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>…</div>
            ) : convList.length === 0 ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('ai_conv_none')}</div>
            ) : convList.map((cv) => {
              const mine = convRef.current === cv.id;
              return (
                <div key={cv.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                  <span style={{flex:1, fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                    {cv.title || t('ai_conv_untitled')}
                    {mine && <span style={{marginLeft:6, fontSize:10, color:'var(--color-text-tertiary)'}}>{t('ai_conv_current')}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={convBusy === cv.id || mine}
                    onClick={() => pickConversation(cv.id)}
                  >
                    {convBusy === cv.id ? '…' : t('ai_conv_open')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {savedOpen && (
          <div style={{margin:'0 0 6px', border:'1px solid var(--color-border-subtle)', borderRadius:6, background:'var(--color-bg-surface)', maxHeight:180, overflowY:'auto'}}>
            {savedItems === null && savedError ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>
                {t('sv_list_failed')}{' '}
                <button type="button" className="btn btn--sm" onClick={loadSaved}>{t('sv_retry')}</button>
              </div>
            ) : savedItems === null ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>…</div>
            ) : savedItems.length === 0 ? (
              <div style={{padding:'10px 12px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('sv_empty')}</div>
            ) : savedItems.map((it) => (
              <div key={it.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                <span style={{fontSize:9.5, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'var(--color-bg-elevated)', color:'var(--color-text-secondary)'}}>{t('sv_kind_' + it.kind)}</span>
                <span style={{flex:1, fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.name}{it.symbol ? ' · ' + it.symbol : ''}{it.timeframe ? ' · ' + it.timeframe : ''}</span>
                <button aria-label={t('sv_load')} className="btn btn--icon btn--sm" title={t('sv_load')} onClick={() => applySaved(it)}><I.Plus size={11}/></button>
                <button aria-label={t('sv_delete')} className="btn btn--icon btn--sm" title={t('sv_delete')} onClick={() => deleteSavedItem(it.id)}><I.Trash size={11}/></button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-messages" ref={scrollRef}>
          {msgs.map(m => (
            <AIMessage key={m.id} msg={m} currentSignal={currentSignal} onApproveSignal={onApproveSignal} onCreateOrderDraft={onCreateOrderDraft} onEditSignal={onEditSignal} onRejectSignal={onRejectSignal} onSaveProposal={saveProposal} savingId={savingId} savesAllowed={savesAllowed} isBeginner={isBeginner}/>
          ))}

          {/* SIGNAL CARD floated once a signal is proposed and last message is AI reply */}
          {currentSignal && msgs.some(m => m.role === 'ai') && (
            <SignalCard signal={currentSignal} onApprove={onApproveSignal} onCreateOrder={onCreateOrderDraft} onEdit={onEditSignal} onReject={onRejectSignal} isBeginner={isBeginner} onSaveDraft={saveSignalDraft} onSetAlert={setSignalAlert} saveBusy={sigSaveBusy} alertBusy={sigAlertBusy} actionNote={sigNote}/>
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

        {/*
             후속 제안. 답변이 끝난 뒤에만, 그리고 서버가 실제로 보낸 것만 그린다.

             ★★ 죽은 버튼을 만들지 않는다. 각 칩은 사전에 있는 질문 문장을 그대로
               전송한다 — 누르면 반드시 대화가 이어진다. 문구가 사전에 없으면
               (번역 누락) 그 칩은 그리지 않는다.

             ★ 스트리밍 중에는 숨긴다. 답이 나오는 중에 다음 질문을 권하면 방금
               질문을 취소하는 것처럼 보인다.
        */}
        {followUps.length > 0 && !streaming && !thinking && (
          <div className="ai-quick ai-quick--followup" aria-label={t('ai_fu_title')}>
            <span className="ai-quick__label">{t('ai_fu_title')}</span>
            {followUps.map((f) => {
              /*
                 ★ 사전 키 대신 **문구를 직접** 받을 수도 있게 한다(labelText/questionText).

                   방향 되묻기 칩은 고객이 쓴 언어를 따라야 하는데, UI 사전에는 한국어가
                   없다. 사전을 거치지 않고 문구를 그대로 넘길 길이 필요하다.

                 ★ 아래 '사전에 없으면 그리지 않는다' 검사를 우회하지 않는다 — 직접 넘긴
                   문구는 빈 값만 걸러내면 충분하다(키 미해결 문제가 없다).
              */
              const label = f && f.labelText ? f.labelText : (f && f.key ? t(f.key) : '');
              const question = f && f.questionText ? f.questionText : (f && f.promptKey ? t(f.promptKey, f.params || {}) : '');
              /* ★ 사전에 없으면 t() 가 키를 그대로 돌려준다. 그런 칩은 그리지 않는다. */
              if (!label || label === f.key || !question || question === f.promptKey) return null;
              return (
                <button
                  key={f.key}
                  className="ai-quick__chip ai-quick__chip--followup"
                  onClick={() => handleSubmit(question)}
                >{label}</button>
              );
            })}
          </div>
        )}

        <div className="ai-quick">
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_trendline_cmd'))}>{t('ai_chip_trendline')}</button>
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_signal_cmd'))}>{t('ai_chip_signal')}</button>
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_sr_cmd'))}>{t('ai_chip_sr')}</button>
          {/* 피보나치 칩은 제거했다 — AI 는 피보나치를 그릴 수 없다(명령이 없다). 눌러도 못 그리면서
              포인트만 든다. 피보나치는 차트 드로잉 툴바의 수동 피보나치 도구로 그린다. */}
          <button className="ai-quick__chip" onClick={() => handleSubmit(t('ai_chip_rr_cmd'))}>{t('ai_chip_rr')}</button>
        </div>

        <div className="ai-input">
          <textarea aria-label={t('ai_copilot_title')} ref={inputRef}
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
            <button aria-label={t('ai_stop')}
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
            { name: 'AI Draft', label: t('ai_layer_draft'), count: overlays.filter(o=>o.source==='ai-draft').length, color: 'var(--color-ai)', dashed: true , match: (o=>o.source==='ai-draft')},
            { name: 'AI Approved', label: t('ai_layer_approved'), count: overlays.filter(o=>o.source==='ai-approved').length, color: 'var(--color-signal-approved)' , match: (o=>o.source==='ai-approved')},
            { name: 'My Drawings', label: t('ai_layer_mine'), count: overlays.filter(o=>o.source==='user').length, color: 'var(--color-text-primary)' , match: (o=>o.source==='user')},
            /* ★ 주문·포지션 개수는 실제 오버레이에서 센다. 전에는 3 으로 박혀 있었다 —
                 주문이 없어도 "3" 이라고 말하는 가짜 값이었다(사용자가 있지도 않은 주문을 믿는다). */
            { name: 'Orders', label: t('ai_layer_orders'), count: overlays.filter(o=>o.source==='order').length, color: 'var(--color-order-pending)' , match: (o=>o.source==='order')},
            { name: 'Positions', label: t('ai_layer_positions'), count: overlays.filter(o=>String(o.source||'').indexOf('position')===0).length, color: 'var(--color-trade-long)' , match: (o=>String(o.source||'').startsWith('position'))},
          ].map(l => {
            /*
               ★★ 이 눈 버튼에 onClick 이 없었다 — 눌러도 아무 일이 없었다.

                 차트는 `overlay.hidden` 을 이미 존중한다(chart-kline.jsx 의
                 `if (!ov || ov.hidden) continue`). 즉 숨기는 기능은 있었고 **화면에서만
                 끊겨 있었다.** 선이 겹쳐 차트를 못 보겠을 때 고객이 할 수 있는 일이 없었다.

               ★ 레이어를 한 번에 켜고 끈다. 하나라도 보이면 '전부 숨기기', 전부 숨겨져 있으면
                 '전부 보이기' — 눌렀을 때 결과가 예측 가능해야 한다.

               ★ 대상이 없으면 누를 수 없게 한다. 0개인 레이어의 토글은 눌러도 변화가 없고,
                 그건 다시 죽은 버튼이다.
            */
            const members = overlays.filter(l.match);
            const anyVisible = members.some((o) => !o.hidden);
            return (
            <div className="ai-layer" key={l.name}>
              <span className="ai-layer__swatch" style={{background: l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined}}/>
              <span className="ai-layer__name">{l.label || l.name}</span>
              <span className="ai-layer__count">{l.count}</span>
              <button
                aria-label={t(anyVisible ? 'ai_layer_hide' : 'ai_layer_show')}
                className="ai-layer__eye"
                title={t(anyVisible ? 'ai_layer_hide' : 'ai_layer_show')}
                disabled={members.length === 0}
                onClick={() => { members.forEach((o) => updateOverlay(o.id, { hidden: anyVisible })); }}
              ><I.Eye size={12}/></button>
            </div>
          );})}
        </div>
          </>
        )}
      </div>
    );
  };

  // ---- Sub components ----
  function AIMessage({ msg, isBeginner, onSaveProposal, savingId, savesAllowed }) {
    /*
       ★★ AI 가 그린 선·신호에 **이름을 지을 수 있게 한다.**

         전에는 `name: note` — 도구 결과 문구가 그대로 이름이 됐다. 그래서 저장
         목록이 '📊 5 overlays created · entry zone / SL / TP1-3' 처럼 다 비슷해
         나중에 어느 것이 무엇인지 구분할 수 없었다. 이름은 고객이 나중에 찾기
         위한 것이므로 고객이 정해야 한다.

       ★ 자동 이름을 기본값으로 채워 둔다 — 빈 칸을 주면 이름 없이 저장하려다
         서버가 400('name required')을 돌려준다.
    */
    const [nameDraft, setNameDraft] = useState(null);   // null = 입력칸 닫힘
    const beginEdit = () => setNameDraft(String((msg.savable && msg.savable.name) || '').slice(0, 120));
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
              savesAllowed === false ? (
                /*
                   ★ 무료 플랜은 저장이 아예 불가하다(운영 결정). 버튼을 그려 놓고
                     402 를 돌려주면 고객은 고장으로 읽는다 — disabled + 이유를 적는다.
                */
                <button
                  aria-label={t('sv_plan_required')}
                  className="btn btn--sm"
                  style={{marginLeft:'auto'}}
                  disabled
                  title={t('sv_plan_required')}
                >
                  {t('sv_plan_required')}
                </button>
              ) : nameDraft === null ? (
                <button
                  className="btn btn--sm"
                  style={{marginLeft:'auto'}}
                  disabled={savingId === msg.id}
                  onClick={beginEdit}
                >
                  {savingId === msg.id ? t('sv_saving') : t('ai_save_proposal', { n: 100 })}
                </button>
              ) : (
                <span style={{marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:6}}>
                  <input
                    aria-label={t('sv_name_label')}
                    className="input input--sm"
                    style={{width: 140, fontSize: 11.5}}
                    value={nameDraft}
                    maxLength={120}
                    placeholder={t('sv_name_label')}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameDraft.trim()) { onSaveProposal(msg.id, { ...msg.savable, name: nameDraft.trim() }); setNameDraft(null); }
                      if (e.key === 'Escape') setNameDraft(null);
                    }}
                  />
                  <button
                    className="btn btn--sm btn--primary"
                    disabled={savingId === msg.id || !nameDraft.trim()}
                    onClick={() => { onSaveProposal(msg.id, { ...msg.savable, name: nameDraft.trim() }); setNameDraft(null); }}
                  >
                    {savingId === msg.id ? t('sv_saving') : t('sv_save')}
                  </button>
                  <button aria-label={t('cancel')} className="btn btn--icon btn--sm" title={t('cancel')} onClick={() => setNameDraft(null)}>
                    <I.X size={11}/>
                  </button>
                </span>
              )
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
          {/*
             ★★ 면책 문구를 **답변마다 화면에서 붙인다.**

               예전에는 이 문구가 목업 provider 의 하드코딩 텍스트에만 있었다. 운영
               provider(OpenAI)는 시스템 프롬프트로 지시받을 뿐이고, 모델이 그 문장을
               실제로 쓸지는 보장되지 않는다. 즉 **운영 응답에는 면책이 없을 수 있었다.**

             ★ 모델에 맡기지 않고 결정적으로 붙인다. 우리가 통제할 수 없는 것에
               법적 문구를 의존하면 안 된다.

             ★ 경고 아이콘 메시지(오류·거부 안내)에는 붙이지 않는다 — 그 말풍선은
               답변이 아니다.
          */}
          {!isUser && !msg.icon && (
            <div className="ai-msg__disclaimer" role="note">
              {t('ai_disclaimer')}
            </div>
          )}
        </div>
      </div>
    );
  }

  function SignalCard({ signal, onApprove, onCreateOrder, onEdit, onReject, isBeginner, onSaveDraft, onSetAlert, saveBusy, alertBusy, actionNote }) {
    const isApproved = signal.status === 'approved';
    return (
      <div style={{marginLeft: 34}}>
        <div className={`signal-card ${isApproved ? 'signal-card--approved' : ''}`}>
          <div className="signal-card__head">
            <div className="signal-card__title">
              {/*
                 ★ '◐ AI DRAFT' 였다. AI 가 만든 초안이라는 뜻인데, 운영 결정에 따라
                   이제 셋업은 **고객이 만든다**. 표기를 사실에 맞춘다.
              */}
              <span className={`badge ${isApproved ? 'badge--approved' : 'badge--draft'}`}>{isApproved ? '✓ ' + t('ai_setup_checked') : t('ai_my_setup')}</span>
              <span style={{fontSize:14, fontWeight:600}}>{signal.symbol.replace('USDT','/USDT')}</span>
              {/*
                   ★★ 방향이 **하드코딩 `▲ LONG`** 이었다. 숏 신호도 롱으로 표시됐다.

                     고객이 카드를 보고 방향을 반대로 읽는다. 그 상태에서 '주문 초안' 을
                     누르면 초안 자체는 서버가 준 방향으로 만들어지므로, 화면과 주문이
                     어긋난 채로 확인 절차가 진행된다. 방향을 잘못 읽고 확인하는 것이
                     이 화면에서 나올 수 있는 최악의 결과다.

                   ★ 색과 화살표도 방향에 맞춘다 — 초록 위쪽 화살표가 숏에 붙으면 글자를
                     읽지 않는 사람은 계속 롱으로 본다.
                   ★ 방향이 없으면 만들지 않는다. '—' 로 두고 색도 중립으로 한다 —
                     모르는 것을 롱이라고 말하지 않는다.
              */}
              {/*
                 ★★ 양방향 제시일 때는 한쪽 배지를 달지 않는다.

                   sides 가 2개면 고객이 방향을 말하지 않은 것이고, 그때 배지에 '롱' 이
                   붙으면 카드 전체가 롱 제안으로 읽힌다 — 그림과 표를 대칭으로 만들어도
                   맨 위 배지 하나가 그것을 전부 무너뜨린다.
              */}
              {(() => {
                const sides = Array.isArray(signal.sides) ? signal.sides : [];
                if (sides.length > 1) {
                  return (
                    <span className="badge" style={{color:'var(--color-text-secondary)'}}>
                      {t('ai_both_directions')}
                    </span>
                  );
                }
                const d = sides.length === 1 ? sides[0].direction : null;
                return (d === 'long' || d === 'short') ? (
                  <span className={`badge badge--${d}`}>
                    {d === 'long' ? '▲' : '▼'} {t(d === 'long' ? 'side_long' : 'side_short')}
                  </span>
                ) : (
                  <span className="badge" style={{color:'var(--color-text-tertiary)'}}>—</span>
                );
              })()}
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
              {/*
                 ★★ 확신도 링(conf-ring)을 제거했다.

                   AI 가 고객 셋업에 확신도 점수를 붙이면 그것이 곧 예측이고 추천이다.
                   운영 결정(2026-09-08): 신호는 고객이 만들고 AI 는 서포트한다 —
                   서포트는 점수를 매기는 일이 아니다. 스키마에서도 confidence 를
                   지웠으므로 값 자체가 오지 않는다.

                 ★ 대신 손익비를 보여준다. 그것은 고객이 준 숫자로 계산한 **사실**이다.

                 ★★ 양방향 제시일 때는 헤더에 손익비를 두지 않는다. 방향마다 값이 다르고,
                   헤더에 하나만 놓으면 그 방향이 대표로 읽힌다. 아래 표에서 방향별로
                   나란히 보여준다.
              */}
              {(Array.isArray(signal.sides) && signal.sides.length === 1 && signal.sides[0].riskReward) ? (
                <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end'}}>
                  <span style={{fontSize:9, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-tertiary)'}}>R : R</span>
                  <span style={{fontSize:13, fontWeight:600, fontFamily:'var(--font-mono)'}}>1 : {signal.sides[0].riskReward}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="signal-card__grid">
            {/*
               ★★ 방향별로 나란히 보여준다.

                 sides 가 1개면 고객이 방향을 말한 것이라 예전과 같은 한 줄 표다.
                 2개면 방향을 말하지 않은 것이고, 롱·숏을 **같은 형식·같은 줄 수**로
                 놓는다. 한쪽을 자세히 쓰면 그것이 추천이 된다.

               ★ 순서를 롱→숏으로 고정한다. 손익비가 좋은 쪽을 앞에 놓는 식으로
                 정렬하면 정렬이 곧 추천이 된다.

               ★ 고객이 주지 않은 값은 '—' 로 둔다. 지어내지 않는다.
            */}
            {(Array.isArray(signal.sides) ? signal.sides : [])
              .slice()
              .sort((a, b) => (a.direction === 'long' ? -1 : 1) - (b.direction === 'long' ? -1 : 1))
              .map((side) => {
                const both = signal.sides.length > 1;
                const dirLabel = t(side.direction === 'long' ? 'side_long' : 'side_short');
                return (
                  <React.Fragment key={side.direction}>
                    {both ? (
                      <div className="signal-card__row" style={{borderTop:'1px solid var(--color-border)', paddingTop: 6, marginTop: 4}}>
                        <span className="signal-card__k" style={{fontWeight:600, color:'var(--color-text-primary)'}}>
                          {side.direction === 'long' ? '▲' : '▼'} {dirLabel}
                        </span>
                        <span className="signal-card__v" style={{fontSize:11, color:'var(--color-text-tertiary)'}}>
                          {side.riskReward ? 'R:R 1 : ' + side.riskReward : t('dash')}
                        </span>
                      </div>
                    ) : null}
                    <div className="signal-card__row"><span className="signal-card__k">{t('ai_entry_zone')}</span><span className="signal-card__v">{side.entry ? fmt(side.entry, 0) : t('dash')}</span></div>
                    <div className="signal-card__row"><span className="signal-card__k">{t('op_stop_loss')}</span><span className="signal-card__v t-short">{side.stop ? fmt(side.stop, 0) : t('dash')}</span></div>
                    <div className="signal-card__row"><span className="signal-card__k">TP</span><span className="signal-card__v t-long">{Array.isArray(side.targets) && side.targets.length ? side.targets.map((v) => fmt(v, 0)).join(' / ') : t('dash')}</span></div>
                    <div className="signal-card__row"><span className="signal-card__k">{t('ai_invalidation_word')}</span><span className="signal-card__v" style={{fontSize: 11, color:'var(--color-text-secondary)'}}>{side.invalidation || t('dash')}</span></div>
                    {Array.isArray(side.contradictingEvidence) && side.contradictingEvidence.length ? (
                      <div className="signal-card__row"><span className="signal-card__k">{t('ai_setup_against')}</span><span className="signal-card__v" style={{fontSize: 11, color:'var(--color-text-secondary)'}}>{side.contradictingEvidence.join(' · ')}</span></div>
                    ) : null}
                  </React.Fragment>
                );
              })}
            {/*
               ★ 빠진 항목을 숨기지 않고 적는다. 손절 없는 셋업을 조용히 넘기면
                 고객은 자기가 빠뜨린 것을 모른다 — 그것이 이 검토의 목적이다.
            */}
            {Array.isArray(signal.missing) && signal.missing.length ? (
              <div className="signal-card__row"><span className="signal-card__k">{t('ai_setup_missing')}</span><span className="signal-card__v t-warning">{signal.missing.join(' / ')}</span></div>
            ) : null}
          </div>

          {/*
             ★★ 방향과 무관한 관찰. 방향을 말하지 않은 고객도 이것은 받아야 한다 —
               지지·저항·추세는 방향을 고르지 않고도 말할 수 있는 사실이다.
          */}
          {Array.isArray(signal.observations) && signal.observations.length ? (
            <div className="signal-card__reason">
              <strong>{t('ai_observations')}: </strong>
              {signal.observations.join(' · ')}
            </div>
          ) : null}

          {/*
             ★★ 양방향 제시일 때 어느 쪽도 권하지 않는다는 것을 **글로** 적는다.
               표가 대칭이어도 고객은 "AI가 뭔가 알고 보여준다" 고 읽는다.
          */}
          {Array.isArray(signal.sides) && signal.sides.length > 1 ? (
            <div className="signal-card__reason" style={{color:'var(--color-text-secondary)'}}>
              {t('ai_both_directions_note')}
            </div>
          ) : null}

          {/*
             ★★ 반대 근거는 이제 **방향별 표 안**에 있다(위 grid). 방향마다 반대 근거가
               다르기 때문이다 — 양방향 제시에서 하나로 합치면 어느 방향에 반대되는
               근거인지 알 수 없다.

             ★ 초보자 안내만 여기 남긴다. '반대 근거' 라는 말만 보면 왜 반대되는 것을
               보여주는지 오해할 수 있다 — 셋업을 막는 것이 아니라 놓친 것을 보여주는
               칸이다.
          */}
          {isBeginner && (Array.isArray(signal.sides) ? signal.sides : []).some((s) => Array.isArray(s.contradictingEvidence) && s.contradictingEvidence.length) ? (
            <div className="signal-card__reason" style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>
              {t('ai_setup_against_hint')}
            </div>
          ) : null}

          {/*
             무효화 배너 — 항상 보인다.

             ★★ 무효화 조건은 방향마다 다르다. 양방향 제시일 때 하나만 골라 띄우면
               그 방향이 대표로 읽힌다. 그래서 그때는 방향별 조건을 표에 두고, 배너에는
               "방향을 고르면 그 방향의 무효화 조건을 본다" 는 안내를 둔다.

             ★ 값이 없으면 '—' 로 둔다. 여기에 그럴듯한 문장을 지어 넣으면 고객은
               검증된 조건으로 읽는다.
          */}
          <div className="invalidation-banner">
            <I.Alert size={14} className="invalidation-banner__icon"/>
            <div>
              <strong>{t('ai_invalidation')}</strong>{' '}
              {(() => {
                const sides = Array.isArray(signal.sides) ? signal.sides : [];
                if (sides.length > 1) return t('ai_invalidation_per_side');
                if (signal.invalidationKey) return t(signal.invalidationKey);
                return (sides.length === 1 && sides[0].invalidation) ? sides[0].invalidation : t('dash');
              })()}
              <span style={{color:'var(--color-text-tertiary)', marginLeft: 6, fontFamily:'var(--font-mono)', fontSize: 10}}>{t('ai_invalidation_note')}</span>
            </div>
          </div>

          <div className="signal-card__actions">
            {!isApproved ? (
              <>
                <button className="btn btn--sm btn--primary" onClick={onApprove}><I.Check size={12}/> {t('ai_approve_signal')}</button>
                <button className="btn btn--sm" onClick={onEdit}>{t('col_edit')}</button>
                {/*
                     ★★ 이 버튼에 onClick 이 없었다 — 눌러도 아무 일이 없었다.

                       분석을 저장하는 기능은 **이미 있다**(savedCreate, 이 파일의 다른 곳에서
                       쓰고 있다). 화면에서만 끊겨 있었다. 간판 기능의 후속 동작이 눌리지 않으면
                       고객은 분석을 남겨 둘 방법이 없다고 판단한다.
                */}
                <button className="btn btn--sm" disabled={saveBusy} onClick={onSaveDraft}>
                  {saveBusy ? t('sec_loading') : t('ai_save_draft')}
                </button>
                <button className="btn btn--sm btn--danger" onClick={onReject}>{t('col_reject')}</button>
              </>
            ) : (
              <>
                <button className="btn btn--sm btn--primary" onClick={onCreateOrder}><I.ArrowRight size={12}/> {t('ai_create_order_draft')}</button>
                {/*
                     ★★ '알림 설정' 도 onClick 이 없었다. 가격 알림 서버 기능은 이미 있다
                       (POST /api/me/alerts). 진입 구간 가격을 알림 지점으로 쓴다 — "거기 오면
                       알려 달라" 가 이 버튼의 뜻이다.

                     ★ '복제' 는 제거했다. 무엇을 복제하는지 정의되지 않았고(신호는 하나만 유지된다),
                       서버에도 대응 기능이 없다. 눌리지 않는 버튼보다 없는 편이 정직하다.
                */}
                <button className="btn btn--sm" disabled={alertBusy} onClick={onSetAlert}>
                  {alertBusy ? t('sec_loading') : t('ai_set_alert')}
                </button>
              </>
            )}
          </div>
          {/* ★ 눌렀는데 아무 표시가 없으면 됐는지 알 수 없다. 성공·실패를 같은 자리에 말한다. */}
          {actionNote && (
            <div style={{marginTop:6, fontSize:11, color: actionNote.ok ? 'var(--color-trade-long)' : 'var(--color-warning)'}}>
              {actionNote.text}
            </div>
          )}

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
