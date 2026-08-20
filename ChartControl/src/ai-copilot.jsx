/* ============================================================
   AI Copilot Widget — Hybrid persona (Beginner/Pro auto-switch)
   ------------------------------------------------------------
   Scripted conversation drives Flow 3 (chart drawing) and Flow 5
   (signal → order draft → confirm). All AI 'thinking' is a
   simulated stream — no real LLM call.
   ============================================================ */

(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);
  const I = window.Icons;
  const { fmt, fmtPct } = window.QTFmt;

  // ---- Scripted flows ----
  // Flow 3: trendline
  const FLOW_TRENDLINE = {
    thinking: [
      { key: 'ai_think_collect', dur: 700 },
      { key: 'ai_think_swinglow', dur: 900 },
      { key: 'ai_think_trendcand', dur: 700 },
    ],
        reply_beginner_key: 'ai_reply_trendline_beginner',
        reply_pro_key: 'ai_reply_trendline_pro',
    overlay: {
      id: 'ai-trend-1',
      type: 'trend-line',
      source: 'ai-draft',
      label: 'AI Trendline · slope +42.6',
      points: [], // populated at runtime with actual candle time
      width: 1.8,
    }
  };

  // Flow 5: signal proposal
  const FLOW_SIGNAL = {
    thinking: [
      { key: 'ai_think_mtf', dur: 700 },
      { key: 'ai_think_atr', dur: 900 },
      { key: 'ai_think_rr', dur: 700 },
    ]
  };

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
    context, isBeginner, overlays, addOverlay, updateOverlay, removeOverlay,
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
    // 사전 형식: 쉼표로 구분한 키워드 목록.
    //   en: 'trendline, trend line'
    //   ko: '추세선'
    // 모든 등록 언어의 키워드를 함께 검사한다 — 사용자가 영어 UI 에서
    // 한국어로 입력해도 동작해야 하기 때문이다.
    const INTENTS = ['trendline', 'signal', 'sr', 'hide'];

    function keywordsFor(intent) {
      const I18n = window.QTI18n;
      if (!I18n) return [];
      const out = [];
      for (const loc of I18n.available()) {
        const raw = I18n.t(`intent_kw_${intent}`, undefined, loc.code);
        if (!raw || raw === `intent_kw_${intent}`) continue;
        for (const kw of raw.split(',')) {
          const w = kw.trim().toLowerCase();
          if (w) out.push(w);
        }
      }
      return out;
    }

    function classify(text) {
      const lower = String(text || '').toLowerCase();
      for (const intent of INTENTS) {
        for (const kw of keywordsFor(intent)) {
          if (lower.includes(kw)) return intent;
        }
      }
      return 'general';
    }

    const runThinking = useCallback(async (steps) => {
      const total = steps.length;
      for (let i = 0; i < total; i++) {
        // 단계 문구는 사전에서 가져온다. 이전 방식(steps[i].text)의
        // 하드코딩 문자열을 없앴으므로 key 를 우선 조회하고, 구형 데이터
        // 호환을 위해 text 도 받아들인다.
        setThinking({ steps, currentIdx: i, msg: steps[i].key ? t(steps[i].key) : steps[i].text });
        await new Promise(r => setTimeout(r, steps[i].dur));
      }
      setThinking(null);
    }, []);

    const streamReply = useCallback(async (fullText) => {
      const chunks = fullText.split(' ');
      let acc = '';
      for (let i = 0; i < chunks.length; i++) {
        acc += (i === 0 ? '' : ' ') + chunks[i];
        setStreaming(acc);
        await new Promise(r => setTimeout(r, 22 + Math.random() * 30));
      }
      setStreaming(null);
      setMsgs(m => [...m, makeMsg('ai', fullText)]);
    }, []);

    /*
       ★ 아래 두 함수(submitTrendline · submitSignal)는 **호출되지 않는다.**

         사전에 박힌 좌표로 차트에 선을 그리기 때문에 handleSubmit 에서
         호출을 끊었다(그 자리의 주석 참고). 함수를 지우지 않은 이유는
         서버가 구조화된 신호를 주게 되면 여기에 응답을 넣어 되살리는 것이
         가장 짧은 경로이기 때문이다. 그때 QT.AI_SIGNAL 참조를 서버 응답으로
         바꾸면 된다.

         지금 지워 버리면 오버레이 만드는 방법(타입·앵커·라벨 형식)을 다시
         알아내야 한다.
    */
    const submitTrendline = useCallback(async () => {
      await runThinking(FLOW_TRENDLINE.thinking);
      // Create the overlay — points span last 90 → last 20 candles
      const candles = context.candles;
      const p1 = candles[Math.max(0, candles.length - 90)];
      const p2 = candles[Math.max(0, candles.length - 20)];
      // Fake swing lows below body
      const overlay = {
        ...FLOW_TRENDLINE.overlay,
        id: 'ai-trend-' + Date.now(),
        points: [
          { time: p1.time, price: p1.low - 40 },
          { time: p2.time, price: p2.low + 90 }
        ]
      };
      addOverlay(overlay);
      setMsgs(m => [...m, makeMsg('ai', '', { toolResult: t('ai_tool_trendline') })]);
      await streamReply(t(isBeginner ? FLOW_TRENDLINE.reply_beginner_key : FLOW_TRENDLINE.reply_pro_key));
      // Add tip about drag
      setMsgs(m => [...m, makeMsg('ai', '', { hint: t('ai_hint_drag') })]);
    }, [context, addOverlay, isBeginner, runThinking, streamReply]);

    const submitSignal = useCallback(async () => {
      await runThinking(FLOW_SIGNAL.thinking);
      const signal = QT.AI_SIGNAL;
      // Create overlays for signal
      const now = Date.now();
      const timeAnchor = context.candles[context.candles.length - 8].time;
      addOverlay({
        id: 'sig-entry',
        type: 'entry-zone',
        source: 'ai-draft',
        priceHi: signal.entryZone[1],
        priceLo: signal.entryZone[0],
        label: 'Entry Zone (AI)',
      });
      addOverlay({
        id: 'sig-sl',
        type: 'horizontal',
        source: 'ai-draft',
        points: [{ price: signal.stopLoss, time: timeAnchor }],
        label: `SL · ${signal.stopLoss}`,
      });
      signal.takeProfits.forEach((tp, i) => {
        addOverlay({
          id: 'sig-tp' + (i+1),
          type: 'horizontal',
          source: 'ai-draft',
          points: [{ price: tp, time: timeAnchor }],
          label: `TP${i+1} · ${tp}`,
        });
      });
      addOverlay({
        id: 'sig-marker',
        type: 'signal-marker',
        source: 'ai-draft',
        direction: 'long',
        points: [{ time: timeAnchor, price: (signal.entryZone[0] + signal.entryZone[1]) / 2 }]
      });
      onProposeSignal(signal);
      setMsgs(m => [...m, makeMsg('ai', '', { toolResult: t('ai_tool_signal') })]);
      const reply = isBeginner
        ? t('ai_reply_signal_beginner')
        : t('ai_reply_signal_pro');
      await streamReply(reply);
    }, [context, addOverlay, onProposeSignal, isBeginner, runThinking, streamReply]);

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

      const kind = classify(text);
      /*
         ★★ 좌표를 만드는 도구(추세선·진입 시나리오·지지저항)는 막는다.

           이 세 경로는 사전에 박힌 값을 쓴다 —
             · 진입 시나리오: QT.AI_SIGNAL (진입 68,120 / 손절 67,480 / 익절 68,980…)
             · 지지·저항: 69,120 · 67,200
             · 추세선: 목업 캔들 기준 두 점
           그리고 그 값으로 **차트에 선을 그린다.** 화면에 그려진 선은 분석
           결과로 읽히고, 사용자는 그 가격에 주문을 넣는다.

           AI 를 연결하면 괜찮아지는 문제가 아니다. 서버의 /ai/copilot 은
           **텍스트만** 돌려주고(응답에 좌표가 없다), 구조화된 신호를 주는
           엔드포인트가 없다. 즉 AI 가 붙어도 이 좌표는 여전히 사전 값이다.
           지금은 AI 미연결로 위쪽 가드에 막혀 보이지 않을 뿐이고, 연결하는
           순간 가짜 신호가 차트에 나가는 상태였다.

         ★ 서버가 좌표를 주게 되면 이 상수를 지우고 응답을 그리면 된다.
           그때까지는 무엇이 없어서 못 하는지 말한다.
      */
      if (kind === 'trendline' || kind === 'signal' || kind === 'sr') {
        setMsgs((m) => [...m, makeMsg('ai', t('ai_tools_absent'), { icon: 'warn' })]);
        return;
      }
      // General reply
      await runThinking([{ key: 'ai_think_context', dur: 500 }]);
      await streamReply(t('ai_reply_general', { text }));
    }, [input, aiReady, runThinking, streamReply]);

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
             AI 분석 이용권 소비.

             ★ AI 실행은 우리에게 실제 비용이 든다(토큰). 그래서 포인트로
               구매한 이용권을 차감한다. 이용권이 없으면 실행하지 않는다 —
               실행해 버리면 비용은 우리가 내고 사용자는 무료로 쓴다.

             ★ 제도가 꺼져 있으면 서버가 consumed:true 를 준다.
               그때는 무료로 동작하는 것이 의도다(제도를 끄면 기능이 열린다).

             ★ 소비에 실패(네트워크 등)하면 실행하지 않는다.
               "소비 못 했으니 무료로 해주자" 는 잘못된 관대함이다 — 그 경로가
               열려 있으면 네트워크를 끊어 무료로 쓸 수 있다.
          */
          const api = window.QTApi && window.QTApi.rest;
          if (api && api.consumeEntitlement) {
            try {
              const r = await api.consumeEntitlement('ai_10');
              if (!r.consumed) {
                busyRef.current = false;
                setMsgs((m) => [...m, makeMsg('system', t('ai_need_credit'), { icon: 'warn' })]);
                return false;
              }
            } catch (e) {
              busyRef.current = false;
              setMsgs((m) => [...m, makeMsg('system', t('ai_credit_check_failed'), { icon: 'warn' })]);
              return false;
            }
          }
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
    let aiState, aiStateLabel, aiStateNote, aiStateClass;
    if (thinking)          { aiState = 'thinking';   aiStateLabel = 'THINKING';        aiStateNote = thinking.msg;                    aiStateClass = ''; }
    else if (streaming)    { aiState = 'streaming';  aiStateLabel = 'STREAMING';       aiStateNote = 'Generating response…';          aiStateClass = ''; }
    else if (currentSignal && currentSignal.status === 'approved') { aiState = 'approved'; aiStateLabel = 'SIGNAL APPROVED'; aiStateNote = `${currentSignal.symbol.replace('USDT','/USDT')} · ${currentSignal.timeframe}`; aiStateClass = 'is-approved'; }
    else if (currentSignal){ aiState = 'review';     aiStateLabel = 'WAITING REVIEW';  aiStateNote = 'Signal draft ready · approve or edit'; aiStateClass = ''; }
    /*
       ★★ 'READY' 가 하드코딩돼 있었다. AI 가 연결되지 않은 상태에서도 "준비됨"
         이라고 표시하면, 사용자는 뒤이어 나오는 예시 문구를 실제 분석으로 믿는다.
         연결 상태를 그대로 말한다.
    */
    else if (!aiReady)     { aiState = 'idle';       aiStateLabel = t('ai_state_beta');  aiStateNote = t('ai_state_beta_note'); aiStateClass = 'is-pending'; }
    else                   { aiState = 'idle';       aiStateLabel = 'READY';           aiStateNote = 'Ask about trends, S/R, entry'; aiStateClass = 'is-idle'; }

    // ---- UI ----
    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="ai-header">
          <div className="panel__title" style={{gap: 10}}>
            <span className="dot dot--ai"/>
            <span>{t('ai_copilot')}</span>
            <span className="ai-persona">
              <I.Sparkles size={10}/>
              {isBeginner ? 'Mentor Mode' : 'Analyst Mode'}
            </span>
          </div>
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
          </div>
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
          <span className="ai-state-bar__note">SIM</span>
        </div>

        <div className="ai-context">
          <span className="ai-ctx-chip">{t('fld_symbol')} · <strong>{context.symbol}</strong></span>
          <span className="ai-ctx-chip">TF · <strong>{context.tf}</strong></span>
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

        <div className="ai-messages" ref={scrollRef}>
          {msgs.map(m => (
            <AIMessage key={m.id} msg={m} currentSignal={currentSignal} onApproveSignal={onApproveSignal} onCreateOrderDraft={onCreateOrderDraft} onEditSignal={onEditSignal} onRejectSignal={onRejectSignal} isBeginner={isBeginner}/>
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
          <button className="ai-quick__chip">{t('ai_chip_fib')}</button>
          <button className="ai-quick__chip">{t('ai_chip_rr')}</button>
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
          <button className="ai-input__send" onClick={() => handleSubmit()} disabled={!input.trim()}>
            <I.Send size={16}/>
          </button>
        </div>

        <div className="ai-layers">
          <div className="ai-layers__title">
            <I.Layers size={10} style={{display:'inline', verticalAlign:'-2px', marginRight: 4}}/>
            Signal Layers
          </div>
          {[
            { name: 'AI Draft', count: overlays.filter(o=>o.source==='ai-draft').length, color: 'var(--color-ai)', dashed: true },
            { name: 'AI Approved', count: overlays.filter(o=>o.source==='ai-approved').length, color: 'var(--color-signal-approved)' },
            { name: 'My Drawings', count: overlays.filter(o=>o.source==='user').length, color: 'var(--color-text-primary)' },
            { name: 'Orders', count: 3, color: 'var(--color-order-pending)' },
            { name: 'Positions', count: 3, color: 'var(--color-trade-long)' },
          ].map(l => (
            <div className="ai-layer" key={l.name}>
              <span className="ai-layer__swatch" style={{background: l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined, borderTopColor: l.dashed ? l.color : undefined}}/>
              <span className="ai-layer__name">{l.name}</span>
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
  function AIMessage({ msg, isBeginner }) {
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
            <span>{isUser ? 'You' : (isBeginner ? 'Mentor' : 'Analyst')}</span>
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
