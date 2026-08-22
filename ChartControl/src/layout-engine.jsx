/* ============================================================
   Layout Engine — 24-col Grid, Drag & Resize, Undo/Redo
   ------------------------------------------------------------
   Widget metadata is GridStack.js compatible:
     { id, type, x, y, w, h, minW, minH, maxW, maxH,
       locked, hidden, collapsed, visible }
   ------------------------------------------------------------
   Public API (final):
     engine.layout, engine.presetId
     engine.isEditing / isLocked / dirty / selectedId
     engine.setIsEditing(bool) / setIsLocked(fn) / setSelectedId(id)
     engine.updateWidget(id, partial)
     engine.hideWidget(id) / showWidget(id) / duplicateWidget(id)
     engine.toggleLock(id) / removeWidget(id) / addWidget(type)
     engine.undo / redo / save / reset / applyPreset(id)
   ============================================================ */

(function () {
  const { useState, useEffect, useRef, useCallback } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);
  const I = window.Icons;

  // ---------- helpers ----------
  function overlaps(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
  function hasCollision(widgets, target) {
    return widgets.some(w => !w.hidden && w.id !== target.id && overlaps(w, target));
  }
  function findFreeSpot(widgets, w, h, cols = 24) {
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const trial = { x, y, w, h, id: '__probe__' };
        if (!hasCollision(widgets, trial)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  const DEFAULT_WIDGET_META = {
    marketWatch:  { minW: 3, minH: 6,  name: 'Market Watch' },
    chart:        { minW: 8, minH: 6,  name: 'Main Chart' },
    orderBook:    { minW: 3, minH: 6,  name: 'Order Book' },
    recentTrades: { minW: 3, minH: 3,  name: 'Recent Trades' },
    orderEntry:   { minW: 3, minH: 8,  name: 'Order Entry' },
    positions:    { minW: 8, minH: 3,  name: 'Positions & Orders' },
    assetsRisk:   { minW: 3, minH: 3,  name: 'Assets · Risk' },
    aiCopilot:    { minW: 5, minH: 10, name: t('ai_copilot_title') },
    miniChart:    { minW: 4, minH: 6,  name: 'Mini Chart' },
  };

  // ---------- Main hook ----------
  window.useLayoutEngine = function useLayoutEngine(initialPresetId = 'standard-trader') {
    const [layout, setLayout] = useState(() => {
      const saved = localStorage.getItem('qt.layout');
      if (saved) { try { return JSON.parse(saved); } catch (e) {} }
      return JSON.parse(JSON.stringify(QT.LAYOUT_PRESETS[initialPresetId]));
    });
    const [history, setHistory] = useState({ past: [], future: [] });
    const [isEditing, setIsEditing] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [presetId, setPresetId] = useState(initialPresetId);
    const [selectedId, setSelectedId] = useState(null);
    const [ghost, setGhost] = useState(null); // {x,y,w,h,valid}
    const [libraryOpen, setLibraryOpen] = useState(false);

    const _pushHistory = useCallback((prev) => {
      setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
    }, []);

    const commit = useCallback((newLayout) => {
      setHistory(h => ({ past: [...h.past, layout].slice(-30), future: [] }));
      setLayout(newLayout);
      setDirty(true);
    }, [layout]);

    const undo = useCallback(() => {
      setHistory(h => {
        if (!h.past.length) return h;
        const prev = h.past[h.past.length - 1];
        setLayout(prev);
        setDirty(true);
        return { past: h.past.slice(0, -1), future: [layout, ...h.future].slice(0, 30) };
      });
    }, [layout]);

    const redo = useCallback(() => {
      setHistory(h => {
        if (!h.future.length) return h;
        const next = h.future[0];
        setLayout(next);
        setDirty(true);
        return { past: [...h.past, layout], future: h.future.slice(1) };
      });
    }, [layout]);

    const save = useCallback(() => {
      localStorage.setItem('qt.layout', JSON.stringify(layout));
      setDirty(false);
    }, [layout]);

    const reset = useCallback((newPreset = presetId) => {
      const preset = QT.LAYOUT_PRESETS[newPreset];
      if (!preset) return;
      commit(JSON.parse(JSON.stringify(preset)));
      setPresetId(newPreset);
      setSelectedId(null);
    }, [commit, presetId]);

    const applyPreset = useCallback((id) => {
      const preset = QT.LAYOUT_PRESETS[id];
      if (!preset) return;
      commit(JSON.parse(JSON.stringify(preset)));
      setPresetId(id);
      setSelectedId(null);
    }, [commit]);

    const updateWidget = useCallback((id, partial) => {
      setLayout(prev => {
        const nextWidgets = prev.widgets.map(w => w.id === id ? { ...w, ...partial } : w);
        const next = { ...prev, widgets: nextWidgets };
        if (!partial._dragging && !partial._resizing) {
          setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
          setDirty(true);
        }
        return next;
      });
    }, []);

    /*
       마지막으로 만진 창 순서.

       ★ 배치(layout)에 저장하지 않는다. 쌓임 순서는 **보는 방식**이고, 저장하면
         레이아웃 프리셋이 세션마다 달라진다(누적 규칙: 접기와 같은 원칙).
    */
    const [raised, setRaised] = useState({});
    const raiseWidget = useCallback((id) => {
      if (!id) return;
      setRaised((prev) => {
        /* 이미 맨 위면 다시 쓰지 않는다 — 불필요한 렌더를 만든다. */
        const max = Object.values(prev).reduce((m, v) => (v > m ? v : m), 0);
        if (prev[id] === max && max > 0) return prev;
        return { ...prev, [id]: max + 1 };
      });
    }, []);

    const hideWidget = useCallback((id) => {
      setLayout(prev => {
        const nextWidgets = prev.widgets.map(w => w.id === id ? { ...w, hidden: true } : w);
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: nextWidgets };
      });
      setSelectedId(null);
    }, []);

    const showWidget = useCallback((id) => {
      setLayout(prev => {
        const w = prev.widgets.find(x => x.id === id);
        if (!w) return prev;
        const others = prev.widgets.filter(x => !x.hidden && x.id !== id);
        const spot = findFreeSpot(others, w.w, w.h);
        const nextWidgets = prev.widgets.map(x =>
          x.id === id ? { ...x, hidden: false, x: spot.x, y: spot.y } : x
        );
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: nextWidgets };
      });
    }, []);

    const duplicateWidget = useCallback((id) => {
      setLayout(prev => {
        const src = prev.widgets.find(w => w.id === id);
        if (!src) return prev;
        const others = prev.widgets.filter(x => !x.hidden);
        const spot = findFreeSpot(others, src.w, src.h);
        const newId = src.id + '-copy-' + Math.random().toString(36).slice(2, 5);
        const clone = { ...src, id: newId, x: spot.x, y: spot.y };
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: [...prev.widgets, clone] };
      });
    }, []);

    const toggleLock = useCallback((id) => {
      setLayout(prev => {
        const nextWidgets = prev.widgets.map(w =>
          w.id === id ? { ...w, locked: !w.locked } : w
        );
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: nextWidgets };
      });
    }, []);

    const removeWidget = useCallback((id) => {
      setLayout(prev => {
        const nextWidgets = prev.widgets.filter(w => w.id !== id);
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: nextWidgets };
      });
      setSelectedId(null);
    }, []);

    const addWidget = useCallback((type) => {
      const meta = DEFAULT_WIDGET_META[type] || { minW: 4, minH: 6 };
      setLayout(prev => {
        const others = prev.widgets.filter(x => !x.hidden);
        const w = Math.max(meta.minW, type === 'chart' ? 12 : 6);
        const h = Math.max(meta.minH, type === 'aiCopilot' ? 12 : 8);
        const spot = findFreeSpot(others, w, h);
        const newId = type + '-' + Math.random().toString(36).slice(2, 5);
        const widget = { id: newId, type, x: spot.x, y: spot.y, w, h, ...meta };
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: [...prev.widgets, widget] };
      });
    }, []);

    return {
      layout, presetId, isEditing, isLocked, dirty, history,
      selectedId, ghost, libraryOpen,
      setIsEditing, setIsLocked, setSelectedId, setGhost, setLibraryOpen,
      updateWidget, hideWidget, showWidget, duplicateWidget,
      toggleLock, removeWidget, addWidget,
      /* 마지막으로 만진 창을 맨 위로 올린다. 화면이 드래그 시작 때 부른다. */
      raiseWidget, raised,
      commit, undo, redo, save, reset, applyPreset,
    };
  };

  // ============================================================
  // WIDGET WRAPPER — handles drag/resize on grid
  // ============================================================
  window.WidgetHost = function WidgetHost({
    widget, cols = 24, rowH = 40, gap = 6,
    isEditing, isLocked, isSelected, onChange,
    onSelect, onHide, onDuplicate, onLock, onSettings, onMaximize,
    children, trackRef, label, allWidgets: _allWidgets,
    /*
       마지막으로 만진 순서. 0 이면 아직 만지지 않았다(기본 쌓임 유지).
       클 수록 위에 온다 — 엔진이 관리한다(raiseWidget).
    */
    raisedOrder = 0,
    /** 이 창을 맨 위로 올려 달라고 알린다. */
    onRaise,
    /** 숨긴 위젯 라이브러리를 열어 달라고 알린다(닫기 안내의 되살리기 버튼). */
    onOpenLibrary,
  }) {
    const rootRef = useRef(null);
    const [drag, setDrag] = useState(null);
    const [resize, setResize] = useState(null);

    /*
       ★★ 여기서 조기 반환하면 안 된다 (React 훅 규칙).

         `if (widget.hidden) return null;` 이 이 위치에 있었다. 이 아래에 훅
         (useCallback 등)이 더 있으므로, 숨긴 순간 그 렌더는 훅을 **덜 호출**한다.
         React 가 "Rendered fewer hooks than expected" 로 던지고 **화면 전체가
         죽는다** — 실측: 호가창 닫기 버튼을 누르자 위젯 8개가 0개가 됐다.

       ★ 그래서 판정만 미리 해 두고, 반환은 훅을 모두 부른 뒤 JSX 자리에서 한다.
    */
    const isHidden = Boolean(widget.hidden);

    const style = {
      gridColumn: `${widget.x + 1} / span ${widget.w}`,
      gridRow: `${widget.y + 1} / span ${widget.h}`,
      /*
         ★★ 마지막으로 만진 창이 맨 위에 남는다.

           전에는 드래그하는 동안만 z-index 30 이었고, 놓으면 원래대로 돌아갔다.
           그래서 겹치도록 배치하면 방금 올린 창이 다시 아래로 깔렸다.

         ★ 왜 `raisedAt` 인가 — 단순히 "선택된 것 하나만 올리기" 로 하면, 창을
           세 개 겹쳤을 때 두 번째로 만진 창이 세 번째 아래로 들어간다. 만진
           순서를 기억해야 쌓임이 사람의 기대와 맞는다.

         기준값 5 위에 순서를 얹는다. 드래그(20~30)보다는 낮게 둬서 드래그 중인
         창이 항상 최상단에 보이게 한다.
      */
      zIndex: raisedOrder > 0 ? 5 + Math.min(raisedOrder, 12) : undefined,
    };

    // ---- Drag handler ----
    const onDragStart = useCallback((e) => {
      if (!isEditing || isLocked || widget.locked) return;
      onSelect && onSelect(widget.id);
      /*
         ★ 드래그를 시작하는 순간 맨 위로 올린다. 놓은 뒤에도 위에 남는다 —
           겹치게 배치했을 때 방금 올린 창이 다시 깔리면 올린 의미가 없다.
      */
      onRaise && onRaise(widget.id);
      const rect = trackRef.current.getBoundingClientRect();
      const cellW = (rect.width - (cols - 1) * gap) / cols;
      const cellH = rowH;
      setDrag({
        x0: e.clientX, y0: e.clientY,
        ox: widget.x, oy: widget.y,
        cellW, cellH
      });
      e.preventDefault();
      e.stopPropagation();
    }, [isEditing, isLocked, widget, cols, gap, rowH, trackRef, onSelect]);

    useEffect(() => {
      if (!drag) return;
      const onMove = (e) => {
        const dx = Math.round((e.clientX - drag.x0) / (drag.cellW + gap));
        const dy = Math.round((e.clientY - drag.y0) / (drag.cellH + gap));
        let nx = Math.max(0, Math.min(cols - widget.w, drag.ox + dx));
        let ny = Math.max(0, drag.oy + dy);
        onChange({ x: nx, y: ny, _dragging: true });
      };
      const onUp = () => {
        onChange({ _dragging: false });
        setDrag(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [drag, cols, gap, widget, onChange]);

    // ---- Resize handler ----
    const onResizeStart = useCallback((e, dir) => {
      if (!isEditing || isLocked || widget.locked) return;
      onSelect && onSelect(widget.id);
      const rect = trackRef.current.getBoundingClientRect();
      const cellW = (rect.width - (cols - 1) * gap) / cols;
      const cellH = rowH;
      setResize({
        dir, x0: e.clientX, y0: e.clientY,
        ow: widget.w, oh: widget.h, ox: widget.x, oy: widget.y, cellW, cellH
      });
      e.preventDefault();
      e.stopPropagation();
    }, [isEditing, isLocked, widget, cols, gap, rowH, trackRef, onSelect]);

    useEffect(() => {
      if (!resize) return;
      const onMove = (e) => {
        const dx = Math.round((e.clientX - resize.x0) / (resize.cellW + gap));
        const dy = Math.round((e.clientY - resize.y0) / (resize.cellH + gap));
        const minW = widget.minW || 3;
        const minH = widget.minH || 3;
        let nw = resize.ow, nh = resize.oh;
        if (resize.dir.includes('e')) {
          nw = Math.max(minW, Math.min(cols - resize.ox, resize.ow + dx));
        }
        if (resize.dir.includes('s')) {
          nh = Math.max(minH, resize.oh + dy);
        }
        onChange({ w: nw, h: nh, _resizing: true });
      };
      const onUp = () => {
        onChange({ _resizing: false });
        setResize(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [resize, cols, gap, widget.minW, widget.minH, onChange]);

    const showResize = isEditing && !isLocked && !widget.locked;
    const _showControls = isEditing && (isSelected || false);

    /* ★ 훅을 모두 부른 뒤에 숨김을 처리한다(위 isHidden 주석 참조). */
    if (isHidden) return null;

    return (
      <div
        ref={rootRef}
        className={
          `widget` +
          (isEditing ? ' is-editing' : '') +
          (isSelected ? ' is-selected' : '') +
          (drag ? ' is-dragging' : '') +
          (resize ? ' is-resizing' : '') +
          (widget.locked ? ' is-locked' : '')
        }
        style={style}
        data-widget-id={widget.id}
        data-widget-type={widget.type}
        onClick={() => isEditing && onSelect && onSelect(widget.id)}
      >
        <div className="widget__body">
          {children}
        </div>

        {/* State ring for hover/selected */}
        {isEditing && <div className="widget-state-ring"/>}

        {/* Grid info chip (bottom-left) */}
        {isEditing && (
          <div className="widget-info">
            <span className="type">{label}</span>
            <span> · {widget.w}×{widget.h} · ({widget.x},{widget.y})</span>
          </div>
        )}

        {/*
           ★★ 편집 모드가 아니어도 닫을 수 있게 한다.

             전에는 닫기 버튼이 편집 모드(Layout 버튼)에서만 나왔다. 창 하나를
             치우려고 편집 모드에 들어갔다 나오는 것은 번거롭다 — 특히 코파일럿·
             호가창처럼 자주 켜고 끄는 것이 있다.

           ★ 다시 켜는 곳은 편집 모드의 위젯 라이브러리다. 그래서 닫을 때
             어디서 되살리는지 알려준다(안내 없으면 닫고 못 찾는다).

           ★ 편집 모드에서는 아래 컨트롤 묶음에 닫기가 이미 있으므로 겹치지 않게
             편집 중에는 그리지 않는다.
        */}
        {!isEditing && onHide && (
          <button
            className="qt-widget-close"
            title={t('lay_hide_hint')}
            aria-label={t('lay_hide')}
            onClick={(e) => {
              e.stopPropagation();
              onHide(widget.id);
              if (window.QTToast) {
                window.QTToast({
                  title: t('lay_hidden_toast'),
                  desc: t('lay_hidden_toast_desc'),
                  variant: 'info',
                  /*
                     ★ 안내에서 바로 되살릴 수 있게 한다. 문구만 주면 "어디서
                       되살리나" 를 찾아야 하고, 그 사이 안내가 사라진다.
                  */
                  action: onOpenLibrary
                    ? { label: t('lay_reopen'), onClick: onOpenLibrary }
                    : undefined,
                });
              }
            }}
          >
            <I.X size={11}/>
          </button>
        )}

        {/* Widget controls popover (top-right) */}
        {isEditing && (
          <div className="widget-controls" onClick={e => e.stopPropagation()}>
            <button className="widget-controls__btn" onMouseDown={onDragStart} title={t('lay_drag')}><I.Drag size={11}/></button>
            <div className="widget-controls__sep"/>
            <button className="widget-controls__btn" onClick={() => onLock && onLock(widget.id)} title={widget.locked ? t('lay_unlock') : t('lock')}>
              {widget.locked ? <I.Lock size={11}/> : <I.Unlock size={11}/>}
            </button>
            <button className="widget-controls__btn" onClick={() => onSettings && onSettings(widget.id)} title={t('chart_settings')}><I.Cog size={11}/></button>
            <button className="widget-controls__btn" onClick={() => onDuplicate && onDuplicate(widget.id)} title={t('lay_duplicate')}><I.Layers size={11}/></button>
            <button className="widget-controls__btn" onClick={() => onMaximize && onMaximize(widget.id)} title={t('lay_maximize')}><I.Expand size={11}/></button>
            <div className="widget-controls__sep"/>
            <button className="widget-controls__btn is-danger" onClick={() => onHide && onHide(widget.id)} title={t('lay_hide')}><I.EyeOff size={11}/></button>
          </div>
        )}

        {/* Also allow dragging by grabbing the panel header area */}
        {isEditing && !widget.locked && (
          <div
            style={{position:'absolute', top:0, left:0, right:80, height: 36, zIndex: 4, cursor: drag ? 'grabbing' : 'grab'}}
            onMouseDown={onDragStart}
          />
        )}

        {showResize && (
          <>
            <div className="resize-handle resize-handle--e" onMouseDown={(e) => onResizeStart(e, 'e')}/>
            <div className="resize-handle resize-handle--s" onMouseDown={(e) => onResizeStart(e, 's')}/>
            <div className="resize-handle resize-handle--se" onMouseDown={(e) => onResizeStart(e, 'se')}/>
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // PRESET RIBBON — visual mini-preview cards for 7 presets
  // ============================================================
  window.PresetRibbon = function PresetRibbon({ engine }) {
    return (
      <div className="preset-ribbon">
        {Object.values(QT.LAYOUT_PRESETS).map(p => {
          const isActive = engine.presetId === p.id;
          // Build 12x11 mini grid preview from widget positions
          const cells = [];
          p.widgets.forEach(w => {
            const miniX = Math.round(w.x / 24 * 12);
            const miniW = Math.max(1, Math.round(w.w / 24 * 12));
            const miniY = Math.round(w.y / 16 * 11);
            const miniH = Math.max(1, Math.round(w.h / 16 * 11));
            cells.push(
              <div
                key={w.id}
                className={`preset-card__cell preset-card__cell--${w.type}`}
                style={{
                  gridColumn: `${miniX + 1} / span ${miniW}`,
                  gridRow: `${miniY + 1} / span ${miniH}`,
                }}
              />
            );
          });
          return (
            <button
              key={p.id}
              className={`preset-card ${isActive ? 'is-active' : ''}`}
              onClick={() => engine.applyPreset(p.id)}
              title={`${p.name} · ${p.widgets.length} widgets`}
            >
              <div className="preset-card__name">
                <span>{p.name}</span>
                {isActive && <span className="preset-card__check">✓</span>}
              </div>
              <div className="preset-card__mini">
                {cells}
              </div>
              <div className="preset-card__desc">{p.descKey ? t(p.descKey) : p.description}</div>
            </button>
          );
        })}
      </div>
    );
  };

  // ============================================================
  // HIDDEN WIDGETS LIBRARY (drawer, right side)
  // ============================================================
  window.WidgetLibrary = function WidgetLibrary({ engine, onClose }) {
    const hidden = engine.layout.widgets.filter(w => w.hidden);
    const iconMap = {
      chart: I.Chart, marketWatch: I.Grid, orderBook: I.Book, recentTrades: I.Zap,
      orderEntry: I.Wallet, positions: I.LayoutIcon, assetsRisk: I.Wallet,
      aiCopilot: I.Sparkles, miniChart: I.Chart,
    };
    return (
      <div className="widget-library">
        <div className="widget-library__header">
          <div className="widget-library__title">
            <I.EyeOff size={12}/>
            {t('lay_hidden_widgets')} <span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', fontSize: 10}}>{hidden.length}</span>
          </div>
          <button className="btn btn--icon" onClick={onClose} title={t('close')}><I.X size={12}/></button>
        </div>
        <div className="widget-library__body">
          {hidden.length === 0 ? (
            <div className="widget-library__empty">{t('widget_library_f29084')}<br/><span style={{color:'var(--color-text-secondary)'}}>{t('widget_library_3b690d')} <I.EyeOff size={10}/> {t('widget_library_f7178c')}</span></div>
          ) : (
            hidden.map(w => {
              const Icon = iconMap[w.type] || I.Grid;
              return (
                /*
                   ★★ 행 전체를 누를 수 있게 한다.

                     숨긴 항목은 `＋ ADD` **버튼에만** 클릭이 걸려 있었고, 아래
                     "추가" 목록은 **행 전체**에 걸려 있었다. 두 목록이 나란히
                     있는데 동작이 달라서, 행을 눌러도 아무 일이 없는 줄 알았다
                     (실측: 행 클릭 → 위젯 그대로 7개).
                */
                <div
                  key={w.id}
                  className="widget-library__item"
                  onClick={() => engine.showWidget(w.id)}
                >
                  <div className="widget-library__item__icon"><Icon size={12}/></div>
                  <div className="widget-library__item__name">{w.type}<span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginLeft: 6, fontSize:10}}>{w.w}×{w.h}</span></div>
                  {/* 행에도 클릭이 있으므로 이중 실행을 막는다. */}
                  <button
                    className="widget-library__item__add"
                    onClick={(e) => { e.stopPropagation(); engine.showWidget(w.id); }}
                  >＋ ADD</button>
                </div>
              );
            })
          )}
          <div style={{borderTop:'1px solid var(--color-border-subtle)', marginTop: 6, paddingTop: 6}}>
            <div style={{fontSize: 10, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-tertiary)', padding:'4px 6px', fontWeight:600}}>{t('lay_add_new')}</div>
            {['orderBook','recentTrades','aiCopilot','miniChart','assetsRisk'].map(type => {
              const Icon = iconMap[type] || I.Grid;
              return (
                <div key={type} className="widget-library__item" onClick={() => engine.addWidget(type)}>
                  <div className="widget-library__item__icon"><Icon size={12}/></div>
                  <div className="widget-library__item__name">{type}</div>
                  <button className="widget-library__item__add">＋ ADD</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // LAYOUT EDIT TOOLBAR (enhanced)
  // ============================================================
  window.LayoutEditToolbar = function LayoutEditToolbar({ engine, onExit, onSaveAs, t }) {
    const hiddenCount = engine.layout.widgets.filter(w => w.hidden).length;
    return (
      <div className="layout-toolbar">
        <div>
          <div className="layout-toolbar__title">
            <I.LayoutIcon size={14}/>
            <span>{t('layout_edit')}</span>
            {engine.dirty && (
              <span className="layout-toolbar__dirty">● UNSAVED CHANGES</span>
            )}
          </div>
          <div className="layout-toolbar__sub">
            {t('layout_edit_toolbar_38b2c0')} <kbd style={{fontSize:9}}>Ctrl+Z</kbd> {t('undo')} · <kbd style={{fontSize:9}}>Ctrl+S</kbd> {t('save')}
          </div>
        </div>

        <div className="layout-toolbar__actions">
          <button
            className={`btn btn--sm ${engine.libraryOpen ? 'btn--primary' : ''}`}
            onClick={() => engine.setLibraryOpen(!engine.libraryOpen)}
            title={t('lay_library_title')}
          >
            <I.EyeOff size={13}/> {t('lay_library')}
            {hiddenCount > 0 && (
              <span style={{padding:'0 5px', background: engine.libraryOpen ? 'rgba(255,255,255,0.2)' : 'var(--color-warning)', color: engine.libraryOpen ? 'inherit' : 'var(--color-bg-app)', borderRadius:8, fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700}}>{hiddenCount}</span>
            )}
          </button>

          <div style={{width:1, height: 20, background:'var(--color-border-subtle)'}}/>

          <button className="btn btn--sm btn--ghost" onClick={engine.undo} disabled={!engine.history.past.length} title={t('lay_undo_hint')}>
            <I.Undo size={13}/> {t('undo')}
          </button>
          <button className="btn btn--sm btn--ghost" onClick={engine.redo} disabled={!engine.history.future.length} title={t('lay_redo_hint')}>
            <I.Redo size={13}/> {t('redo')}
          </button>

          <div style={{width:1, height: 20, background:'var(--color-border-subtle)'}}/>

          <button className="btn btn--sm btn--ghost" onClick={() => engine.setIsLocked(v => !v)}>
            {engine.isLocked ? <I.Lock size={13}/> : <I.Unlock size={13}/>} {engine.isLocked ? t('lay_locked') : t('lock')}
          </button>
          <button className="btn btn--sm" onClick={() => engine.reset(engine.presetId)} title={t('lay_reset_hint')}>
            <I.Refresh size={13}/> {t('reset')}
          </button>
          <button className="btn btn--sm" onClick={onSaveAs}>{t('save_as')}</button>
          <button className="btn btn--sm btn--primary" onClick={() => engine.save()} disabled={!engine.dirty}>
            <I.Save size={13}/> {t('save')}
          </button>
          <button className="btn btn--sm btn--danger" onClick={onExit}>
            <I.X size={13}/> {t('cancel')}
          </button>
        </div>
      </div>
    );
  };
})();
