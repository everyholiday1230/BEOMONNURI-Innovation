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
    t
  }) {
    const [msgs, setMsgs] = useState(() => [
      makeMsg('system', t('ai_ctx_loaded'), { icon: 'ok' }),
      makeMsg('ai', isBeginner
        ? t('ai_welcome_beginner', { symbol: context.symbol })
        : t('ai_welcome_pro', { symbol: context.symbol, tf: context.tf, price: fmt(context.price, 1), time: new Date().toLocaleTimeString(window.QTI18n ? window.QTI18n.bcp47Of() : 'en-GB', { hour12: false }) }))
    ]);
    const [input, setInput] = useState('');
    const [thinking, setThinking] = useState(null); // { steps, currentIdx, msg }
    const [streaming, setStreaming] = useState(null);
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

    const handleSubmit = useCallback(async (raw) => {
      const text = (raw ?? input).trim();
      if (!text) return;
      setMsgs(m => [...m, makeMsg('user', text)]);
      setInput('');
      const kind = classify(text);
      if (kind === 'trendline') return submitTrendline();
      if (kind === 'signal') return submitSignal();
      if (kind === 'sr') {
        await runThinking([{ key: 'ai_think_swings', dur: 700 }, { key: 'ai_think_volnodes', dur: 700 }]);
        addOverlay({ id: 'sr-res', type: 'horizontal', source: 'ai-draft', points: [{ price: 69120, time: Date.now() }], label: 'Resistance · 69,120' });
        addOverlay({ id: 'sr-sup', type: 'horizontal', source: 'ai-draft', points: [{ price: 67200, time: Date.now() }], label: 'Support · 67,200' });
        setMsgs(m => [...m, makeMsg('ai', '', { toolResult: t('ai_tool_sr') })]);
        await streamReply(isBeginner
          ? t('ai_reply_sr_beginner')
          : t('ai_reply_sr_pro'));
        return;
      }
      // General reply
      await runThinking([{ key: 'ai_think_context', dur: 500 }]);
      await streamReply(t('ai_reply_general', { text }));
    }, [input, submitTrendline, submitSignal, addOverlay, runThinking, streamReply, isBeginner]);

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
    else                   { aiState = 'idle';       aiStateLabel = 'READY';           aiStateNote = 'Ask about trends, S/R, entry';  aiStateClass = 'is-idle'; }

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
            <button className="btn btn--icon" title="Layout"><I.LayoutIcon size={14}/></button>
            <button className="btn btn--icon" title="More"><I.More size={14}/></button>
          </div>
        </div>

        {/* AI STATE BAR — describes what the AI is doing right now */}
        <div className="ai-state-bar">
          <span className={`ai-state-bar__pill ${aiStateClass}`}>
            <span className="dot dot--ai"/>
            {aiStateLabel}
          </span>
          <span className="ai-state-bar__note">{aiStateNote}</span>
          <span className="ai-state-bar__spacer"/>
          <span className="ai-state-bar__note" title="Data freshness">◷ {new Date().toLocaleTimeString('en-GB',{hour12:false})}</span>
          <span className="ai-state-bar__note">·</span>
          <span className="ai-state-bar__note">SIM</span>
        </div>

        <div className="ai-context">
          <span className="ai-ctx-chip">Symbol · <strong>{context.symbol}</strong></span>
          <span className="ai-ctx-chip">TF · <strong>{context.tf}</strong></span>
          <span className="ai-ctx-chip">Last · <strong>{fmt(context.price, 1)}</strong></span>
          <span className="ai-ctx-chip">Indicators · <strong>MA20 · MA60 · MA120</strong></span>
          <span className="ai-ctx-chip">Range · <strong>{context.candles.length} bars</strong></span>
          <span className="ai-ctx-chip" style={{color:'var(--color-warning)'}}>⚠ Analysis tool · Not financial advice</span>
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
                  <span>Analyst</span>
                  <span>·</span>
                  <span>Thinking</span>
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
                  <span>Analyst</span>
                  <span>·</span>
                  <span>Streaming</span>
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
              <button className="ai-layer__eye" title="Toggle"><I.Eye size={12}/></button>
            </div>
          ))}
        </div>
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
                <span style={{fontSize:9, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-tertiary)'}}>Confidence</span>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>Model v1</span>
              </div>
              <div className={`conf-ring ${isApproved ? 'conf-ring--approved' : ''}`} style={{'--pct': signal.confidence}}>
                <span className="conf-ring__label">{signal.confidence}%</span>
              </div>
            </div>
          </div>

          <div className="signal-card__grid">
            <div className="signal-card__row"><span className="signal-card__k">Entry Zone</span><span className="signal-card__v">{fmt(signal.entryZone[0], 0)} – {fmt(signal.entryZone[1], 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">Stop Loss</span><span className="signal-card__v t-short">{fmt(signal.stopLoss, 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">R : R</span><span className="signal-card__v">1 : {signal.riskReward.toFixed(1)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">TP1 / TP2 / TP3</span><span className="signal-card__v t-long">{fmt(signal.takeProfits[0], 0)} / {fmt(signal.takeProfits[1], 0)} / {fmt(signal.takeProfits[2], 0)}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">Time Horizon</span><span className="signal-card__v">{signal.timeHorizon}</span></div>
            <div className="signal-card__row"><span className="signal-card__k">Invalidation</span><span className="signal-card__v" style={{fontSize: 11, color:'var(--color-text-secondary)'}}>{signal.invalidationKey ? t(signal.invalidationKey) : signal.invalidation}</span></div>
          </div>

          <div className="signal-card__reason">
            <strong>{t(isBeginner ? 'ai_reason_beginner' : 'ai_reason_pro')}: </strong>{signal.reasonKey ? t(signal.reasonKey) : signal.reason}
          </div>

          {/* Invalidation banner — always visible, cannot be missed */}
          <div className="invalidation-banner">
            <I.Alert size={14} className="invalidation-banner__icon"/>
            <div>
              <strong>Invalidation:</strong> {signal.invalidationKey ? t(signal.invalidationKey) : signal.invalidation}
              <span style={{color:'var(--color-text-tertiary)', marginLeft: 6, fontFamily:'var(--font-mono)', fontSize: 10}}>{t('ai_invalidation_note')}</span>
            </div>
          </div>

          <div className="signal-card__actions">
            {!isApproved ? (
              <>
                <button className="btn btn--sm btn--primary" onClick={onApprove}><I.Check size={12}/> Approve Signal</button>
                <button className="btn btn--sm" onClick={onEdit}>Edit</button>
                <button className="btn btn--sm">Save as Draft</button>
                <button className="btn btn--sm btn--danger" onClick={onReject}>Reject</button>
              </>
            ) : (
              <>
                <button className="btn btn--sm btn--primary" onClick={onCreateOrder}><I.ArrowRight size={12}/> Create Order Draft</button>
                <button className="btn btn--sm">Set Alert</button>
                <button className="btn btn--sm">Duplicate</button>
              </>
            )}
          </div>

          <div style={{fontSize: 10, color:'var(--color-text-tertiary)', display:'flex', gap: 10}}>
            <span>Generated {new Date(signal.createdAt).toLocaleTimeString('en-GB',{hour12:false})}</span>
            <span>·</span>
            <span>Model: QuantumTrade Analyst v1</span>
            <span>·</span>
            <span>ID: {signal.id}</span>
          </div>
        </div>
      </div>
    );
  }
})();
