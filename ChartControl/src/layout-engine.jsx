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
  function minWOf(w) { return w.minW || (DEFAULT_WIDGET_META[w.type] && DEFAULT_WIDGET_META[w.type].minW) || 3; }
  function minHOf(w) { return w.minH || (DEFAULT_WIDGET_META[w.type] && DEFAULT_WIDGET_META[w.type].minH) || 3; }
  /** 두 구간이 겹치는가(한 축). */
  function spansAxis(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

  /*
     확대 요청을 **이웃 축소**로 해결한다 (한 방향, k 열/행).

     ★★ 왜 이 방식인가

       기본 배치는 24열을 빈틈 없이 채운다. 그래서 어떤 창을 넓히든 이웃과 겹치고,
       "겹치면 되돌린다" 만 있으면 확대가 영구히 불가능하다(실측 확인).

       바로 옆 이웃만 줄이면 최대 1열밖에 못 넓힌다(측정: 기본 배치의 여유가 0~1열).
       그래서 한 줄의 이웃들을 **차례로** 줄인다. 위치는 옮기지 않고 같은 줄에서
       순서도 유지한다 — 다른 줄로 밀어내는 자동 재배치와 다르다.

     ★★ 기하 추론을 믿지 않고 **결과를 검증한다.**

       이 계산을 세 번 틀렸다(양보량 공식, 적용 단계 minW 보정, 대상 minW 보정).
       그래서 만든 배치를 마지막에 전수 검사한다 — 겹침, 최소 크기, 화면 경계.
       하나라도 어긋나면 이 k 는 버린다. 추론이 틀려도 잘못된 배치가 나가지 않는다.

     ★ 요청량부터 1까지 줄여가며 성립하는 최대치를 쓴다. 24열 안이므로 비용이 작다.
  */
  function buildGrowth(before, others, dir, k, cols) {
    const t = { ...before };
    const next = others.map((o) => ({ ...o }));
    let need = k;

    /*
       ★★ **경계를 맞대고 있는 이웃은 순차가 아니라 전부 줄여야 한다.**

         예전에는 `need` 를 이웃에게 순서대로 빼서 0 이 되면 멈췄다. 가로(e/w)는
         한 줄에 이웃이 하나씩 늘어서 있어 그게 맞다. 그런데 세로(n/s)는 **여러
         열이 같은 y 경계를 공유**한다. 하나만 줄이면 나머지는 그대로 남아 대상과
         겹치고, 전수 검증이 그것을 잡아 **null 을 돌려준다** — 즉 아무 일도
         일어나지 않는다.

         실측으로 격리했다: standard 배치에서 `positions` 를 위로 넓히려 하면
         위쪽에 chart(여유5)와 ai(여유1)가 같은 y11 경계를 공유하는데, chart 만
         줄어들어 ai 와 겹쳤고 결과가 버려졌다. 그래서 위쪽 크기 조절이 전혀
         동작하지 않았다.

       ★ 그래서 대상과 **직접 맞닿은** 이웃(첫 줄)은 모두 k 만큼 줄인다. 하나라도
         여유가 부족하면 이 k 는 성립하지 않는다(resolveGrowth 가 더 작은 k 를
         시도한다). 맞닿지 않은 뒷줄은 밀려나기만 하면 되므로 예전처럼 다룬다.
    */
    /*
       ★ 세로(n/s) 전용. 가로는 아래 shrinkOrPush 를 쓴다 — 세로는 행 수 제약이 달라
         (화면 높이가 고정) 같은 방식이 맞는지 확인하지 않았고, 지금 문제도 가로다.
         변경 범위를 좁게 유지한다.
    */
    const shrinkTouching = (list, sizeKey, minOf, edgeOf) => {
      const touching = list.filter((o) => edgeOf(o));
      for (const o of touching) {
        if (o[sizeKey] - minOf(o) < k) return false;
      }
      for (const o of touching) o[sizeKey] -= k;
      return true;
    };

    /*
       ★★★ **닿은 이웃만 보면 그 뒤의 여유를 쓸 수 없다.**

         실측(기본 배치, positions 를 동쪽으로 늘리기):
             positions col 17~68 · trades col 69~80(minW 12, **이미 최소**) ·
             assets col 81~96(minW 12, 여유 4칸)
         닿은 이웃은 trades 하나이고 그것이 최소폭이라 `room < k` 로 즉시 실패했다.
         뒤의 assets 에 4칸이 남아 있는데 쓰지 못했다 — 그래서 **동쪽으로 아무리
         끌어도 전혀 움직이지 않았다**(운영자 신고. 방향은 반대로 전해졌지만
         "한쪽이 안 된다" 는 사실이었다).

       ★ 그래서 닿은 이웃을 **줄이거나, 못 줄이면 밀어낸다.** 밀려난 이웃은 다시 그
         뒤에서 자리를 얻어야 하므로, 줄에 있는 이웃을 앞에서부터 순서대로 훑으며
         `need` 를 넘긴다. 마지막까지 못 흡수하면 이 k 는 실패다(그때는 더 작은 k 로
         재시도한다 — resolveGrowth 가 한다).

       ★★ 여러 행대가 같은 경계를 공유할 수 있다(market y0-16 의 오른쪽에 chart y0-11
         과 positions y11-16). 그래서 **같은 x 에 있는 이웃 전부**를 한 묶음으로
         처리한다 — 하나만 줄이면 나머지가 겹쳐 결과가 버려진다.

       ★ 결과는 아래 전수 검증(겹침·최소크기·경계)이 다시 확인한다. 이 계산을 이전에
         세 번 틀렸으므로 추론을 믿지 않는다.
    */
    const shrinkOrPush = (list, dir2) => {
      const sizeKey = 'w';
      const posKey = 'x';
      /* ★ x 오름차순(동쪽) / 내림차순(서쪽)으로 훑는다. */
      const ordered = dir2 === 'e'
        ? [...list].sort((a, b) => a[posKey] - b[posKey])
        : [...list].sort((a, b) => b[posKey] - a[posKey]);
      let remaining = k;
      /* 같은 좌표에 있는 것들을 묶어 한 번에 처리한다. */
      const groups = [];
      for (const o of ordered) {
        const last = groups[groups.length - 1];
        if (last && last[0][posKey] === o[posKey]) last.push(o);
        else groups.push([o]);
      }
      for (const g of groups) {
        if (remaining <= 0) break;
        /* 이 묶음이 내줄 수 있는 최소 여유(묶음 전체가 같이 줄어야 한다). */
        const room = Math.min(...g.map((o) => o[sizeKey] - minWOf(o)));
        const give = Math.max(0, Math.min(room, remaining));
        for (const o of g) {
          o[sizeKey] -= give;
          /* ★ 동쪽으로 늘릴 때 이웃은 그만큼 오른쪽에서 잘리고 왼쪽 경계가 밀린다. */
          if (dir2 === 'e') o[posKey] += (remaining - give);
          else o[posKey] -= (remaining - give);
        }
        remaining -= give;
      }
      return remaining <= 0;
    };

    if (dir === 'e') {
      t.w = before.w + k;
      const line = next
        .filter((o) => spansAxis(t.y, t.y + t.h, o.y, o.y + o.h) && o.x >= before.x + before.w)
        .sort((a, b) => a.x - b.x);
      /*
         ★ 오른쪽으로 맞닿은 이웃은 **전부** k 만큼 줄인다. 여러 행대가 같은 x 경계를
           공유할 수 있다(예: market y0-16 의 오른쪽에 chart y0-11 과 positions y11-16).
           하나만 줄이면 나머지가 겹쳐 결과가 버려진다 — 그래서 넓히기가 실패했다.
      */
      if (!shrinkOrPush(line, 'e')) return null;
      need = 0;
      /* ★ 행이 겹치는 것끼리만 가로로 쌓는다. 한 커서로 훑으면 다른 행의 이웃이 밀린다. */
      for (const o of line) {
        const leftOf = [t, ...line].filter((q) => q !== o
          && spansAxis(o.y, o.y + o.h, q.y, q.y + q.h) && q.x <= o.x);
        const wall = leftOf.reduce((mx, q) => Math.max(mx, q.x + q.w), 0);
        if (wall > o.x) o.x = wall;
      }
    } else if (dir === 'w') {
      if (before.x - k < 0) return null;
      t.x = before.x - k; t.w = before.w + k;
      const line = next
        .filter((o) => spansAxis(t.y, t.y + t.h, o.y, o.y + o.h) && o.x + o.w <= before.x)
        .sort((a, b) => b.x - a.x);
      /* ★ 왼쪽으로 맞닿은 이웃도 전부 줄인다(위와 같은 이유). */
      if (!shrinkOrPush(line, 'w')) return null;
      need = 0;
      for (const o of line) {
        if (o.x + o.w > t.x) o.x = Math.max(0, t.x - o.w);
      }
    } else if (dir === 's') {
      t.h = before.h + k;
      const line = next
        .filter((o) => spansAxis(t.x, t.x + t.w, o.x, o.x + o.w) && o.y >= before.y + before.h)
        .sort((a, b) => a.y - b.y);
      /* ★ 아래로 맞닿은(y == 대상 하단) 이웃은 **전부** k 만큼 줄인다. */
      if (!shrinkTouching(line, 'h', minHOf, (o) => o.y === before.y + before.h)) return null;
      need = 0;
      /*
         ★★ 재배치는 **열이 겹치는 것끼리만** 세로로 쌓는다.

           예전에는 `line` 전체를 하나의 커서로 훑었다. 그런데 세로 방향의 `line` 에는
           **서로 다른 열**에 있는 이웃이 함께 들어온다(예: chart x4-11 과 ai x11-17).
           그것들을 한 커서로 쌓으면 두 번째 이웃이 첫 번째 **아래로** 밀려나
           y 가 음수까지 갔다(실측: ai 의 y 가 -10).

         ★ 그래서 이웃마다 자기 열과 겹치는 것들만 보고 위치를 정한다.
      */
      for (const o of line) {
        const above = [t, ...line].filter((q) => q !== o
          && spansAxis(o.x, o.x + o.w, q.x, q.x + q.w) && q.y <= o.y);
        const floor = above.reduce((mx, q) => Math.max(mx, q.y + q.h), 0);
        if (floor > o.y) o.y = floor;
      }
    } else if (dir === 'n') {
      if (before.y - k < 0) return null;
      t.y = before.y - k; t.h = before.h + k;
      const line = next
        .filter((o) => spansAxis(t.x, t.x + t.w, o.x, o.x + o.w) && o.y + o.h <= before.y)
        .sort((a, b) => b.y - a.y);
      /* ★ 위로 맞닿은(하단 == 대상 상단) 이웃은 **전부** k 만큼 줄인다. */
      if (!shrinkTouching(line, 'h', minHOf, (o) => o.y + o.h === before.y)) return null;
      need = 0;
      /*
         ★★ 위와 같은 이유로 **열이 겹치는 것끼리만** 쌓는다. 한 커서로 훑으면
           다른 열의 이웃이 위로 밀려 y 가 음수가 된다.
         ★ 맞닿은 이웃은 이미 k 만큼 줄었으므로 y 를 그대로 두면 대상과 딱 맞는다.
           그 아래(=대상 쪽)로 침범하는 경우만 끌어올린다.
      */
      for (const o of line) {
        const bottom = o.y + o.h;
        if (bottom > t.y) o.y = Math.max(0, t.y - o.h);
      }
    } else {
      return null;
    }

    if (need > 0) return null;   // 줄일 수 있는 이웃이 부족하다

    /* ★★ 전수 검증. 추론이 틀려도 잘못된 배치를 내보내지 않는다. */
    const all = [t, ...next];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) if (overlaps(all[i], all[j])) return null;
    }
    if (all.some((w) => w.w < 1 || w.h < 1)) return null;
    if (all.some((w) => w.x < 0 || w.y < 0 || w.x + w.w > cols)) return null;
    if (next.some((o) => o.w < minWOf(o) || o.h < minHOf(o))) return null;
    return { target: t, others: next };
  }

  /** 성립하는 최대 확대를 찾는다. 하나도 안 되면 원래 배치를 그대로 돌려준다. */
  function resolveGrowth(before, others, dir, want, cols = 96) {
    for (let k = want; k >= 1; k -= 1) {
      const r = buildGrowth(before, others, dir, k, cols);
      if (r) return r;
    }
    return { target: { ...before }, others: others.map((o) => ({ ...o })) };
  }

  function findFreeSpot(widgets, w, h, cols = 96) {
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const trial = { x, y, w, h, id: '__probe__' };
        if (!hasCollision(widgets, trial)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

    /*
     ★★ minW 는 **96열 기준**이다. 그리드를 24 → 48 → 96 열로 올렸다.

       24열이면 1920px 화면에서 한 칸이 약 71px 이라, 크기를 조절할 때 마우스를 71px
       움직여야 한 칸이 바뀌어 뚝뚝 끊겼다. 48열이면 약 35px 이다.

     ★ 프리셋 좌표(x·w·minW)와 CSS grid-template-columns 도 함께 두 배로 바꿨다.
       한 곳만 고치면 배치가 절반으로 쪼그라들거나 최소폭이 절반이 된다.

     ★ minH 는 그대로다 — 행 수(16)는 바꾸지 않았다. 세로는 한 칸이 약 45px 이라
       가로만큼 끊기지 않았다.
  */
const DEFAULT_WIDGET_META = {
    marketWatch:  { minW: 12, minH: 6,  name: 'Market Watch' },
    /*
       ★★ chart 최소폭을 8 → 6 으로 낮춘다.

         기본 배치(standard-trader)가 실제로 폭 6 을 쓰고 있었다. 선언이 8 이면
         "지켜지지 않는 최소값" 이고, 크기 조절 계산에서 `폭 - 최소폭` 이 음수가
         되어 옆 창을 넓힐 때 오히려 줄어드는 결함을 만들었다(실측 재현).

       ★ 두 곳(프리셋·이 메타)이 갈리면 같은 문제가 다시 생긴다. 테스트가 두 값의
         일치를 검사한다.
    */
    chart:        { minW: 24, minH: 6,  name: 'Main Chart' },
    orderBook:    { minW: 12, minH: 6,  name: 'Order Book' },
    recentTrades: { minW: 12, minH: 3,  name: 'Recent Trades' },
    orderEntry:   { minW: 12, minH: 8,  name: 'Order Entry' },
    positions:    { minW: 32, minH: 3,  name: 'Positions & Orders' },
    assetsRisk:   { minW: 12, minH: 3,  name: 'Assets · Risk' },
    aiCopilot:    { minW: 20, minH: 10, name: t('ai_copilot_title') },
    miniChart:    { minW: 16, minH: 6,  name: 'Mini Chart' },
  };

  // ---------- Main hook ----------
  /** 지금 격자의 열 수. 프리셋·CSS(widgets.css 의 grid-template-columns)와 같아야 한다. */
  const GRID_COLS = 96;

  /**
   * 저장된 레이아웃을 지금 격자에 맞춘다.
   *
   * ★★ 왜 필요한가 — **이것이 없으면 기존 고객 화면이 절반만 찬다.**
   *
   *   격자를 24 → 48 열로 올렸다(크기 조절이 뚝뚝 끊겨서). 그런데 이용자가 손으로
   *   맞춘 배치는 `qt.layout` 에 **24열 좌표로** 저장돼 있다. 그것을 48열 격자에
   *   그대로 그리면 모든 패널이 절반 폭이 되고 오른쪽 절반이 빈다.
   *
   *   실측으로 확인했다: 24열 저장본 → 채움 **46%** (48열 저장본은 91%).
   *
   * ★ 비율로 환산한다(x·w·minW × 48/24). 반올림 때문에 1칸이 어긋날 수 있으므로
   *   마지막에 격자 밖으로 나가는 것만 잘라낸다 — 겹침까지 고치려 들지 않는다.
   *   이용자 배치를 크게 바꾸는 것보다, 살짝 어긋난 채 열어 주는 편이 낫다
   *   (원하면 프리셋을 다시 누르면 된다).
   *
   * ★ cols 가 없는 아주 예전 저장본은 24열로 본다 — 48열 도입 전에는 전부 24였다.
   */
  function migrateLayoutCols(layout) {
    if (!layout || !Array.isArray(layout.widgets)) return layout;
    const from = Number(layout.cols) || 24;
    if (from === GRID_COLS) return layout;

    const k = GRID_COLS / from;
    const widgets = layout.widgets.map((w) => {
      const x = Math.round((w.x || 0) * k);
      const width = Math.max(1, Math.round((w.w || 1) * k));
      return {
        ...w,
        /* 격자 밖으로 나가지 않게 자른다. */
        x: Math.min(x, GRID_COLS - 1),
        w: Math.min(width, GRID_COLS - Math.min(x, GRID_COLS - 1)),
        ...(w.minW ? { minW: Math.max(1, Math.round(w.minW * k)) } : {}),
      };
    });
    return { ...layout, cols: GRID_COLS, widgets };
  }

  window.useLayoutEngine = function useLayoutEngine(initialPresetId = 'standard-trader') {
    const [layout, setLayout] = useState(() => {
      const saved = localStorage.getItem('qt.layout');
      if (saved) {
        try {
          /*
             ★ 읽는 즉시 환산하고 **다시 저장한다.** 저장하지 않으면 매번 환산하게
               되고, 반올림이 누적될 위험이 있다.
          */
          const migrated = migrateLayoutCols(JSON.parse(saved));
          if (migrated && Number(migrated.cols) === GRID_COLS) {
            try { localStorage.setItem('qt.layout', JSON.stringify(migrated)); } catch (e) { /* 저장 실패는 무시 */ }
          }
          return migrated;
        } catch (e) { /* 깨진 저장본은 프리셋으로 시작한다 */ }
      }
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

    /*
       ★★ 설정 패널에서 고른 레이아웃 프리셋을 실제로 반영한다.

         `initialPresetId` 는 이름 그대로 **처음 한 번만** 쓰였다. 그래서 설정에서
         'Scalper' 를 눌러도 tweaks 값만 바뀌고 화면 배치는 그대로였다 — 버튼이
         눌리는데 아무 일도 일어나지 않는다.

       ★ 첫 마운트에서는 적용하지 않는다(저장된 배치를 프리셋으로 덮어쓰면
         이용자가 손으로 맞춘 배치가 사라진다). 이후 프리셋이 **바뀔 때만** 적용한다.
    */
    const presetPropRef = useRef(initialPresetId);
    useEffect(() => {
      if (presetPropRef.current === initialPresetId) return;
      presetPropRef.current = initialPresetId;
      const preset = QT.LAYOUT_PRESETS[initialPresetId];
      if (!preset) return;
      const next = JSON.parse(JSON.stringify(preset));
      setLayout(next);
      setPresetId(initialPresetId);
      setSelectedId(null);
      // 프리셋 적용은 되돌릴 수 있어야 한다(실수로 눌렀을 때 배치를 잃지 않게).
      setHistory((h) => ({ past: [...h.past].slice(-30), future: [] }));
      try { localStorage.setItem('qt.layout', JSON.stringify(next)); } catch (e) { /* 무시 */ }
    }, [initialPresetId]);

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
      /*
         ★★ 최신 상태를 저장한다.

           전에는 `layout` 을 클로저로 잡아 저장했다. 크기 조절이 끝나는 순간
           호출되는 저장은 **직전 렌더의 layout** 을 쓰게 되어, 방금 바꾼 크기가
           빠진 채 저장됐다(그래서 새로고침하면 되돌아갔다).
           setLayout 의 갱신 함수로 현재 값을 받아 저장한다.
      */
      setLayout((cur) => {
        try { localStorage.setItem('qt.layout', JSON.stringify(cur)); } catch (e) { /* 저장 실패는 무시 */ }
        return cur;
      });
      setDirty(false);
    }, []);

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

    /*
       드래그·리사이즈를 시작할 때의 위치·크기.

       ★ 놓았을 때 겹치면 이 자리로 되돌린다. 조작 전 상태이므로 겹치지 않는 것이
         보장된다 — 임의의 빈자리로 옮기면 사용자가 창을 잃어버린다.
    */
    const geomStartRef = useRef(null);
    /*
       ★★★ 크기 조절 **제스처 시작 시점의 배치 전체**를 기억한다.

         왜 필요한가 — 이것이 "훅훅 미끄러진다" 의 진짜 원인이었다.

         손잡이는 제스처 시작부터의 **절대** 변화량을 보낸다(예: 계속 +1열).
         그런데 이웃을 줄이는 계산이 그 값을 **이미 줄어든 현재 상태**에 매번 다시
         적용했다. 그래서 마우스가 한 칸을 넘긴 뒤에는 **마우스가 움직일 때마다**
         한 칸씩 더 늘어났다 — 커서는 5px 만 갔는데 패널은 한 칸씩 계속 자랐다.

         실측(96열, 한 칸 19.48px, 수정 전):
           마우스 20px → +19px(1열)   ← 여기까지는 맞다
                  25px → +39px(2열)   ← 5px 더 갔는데 한 칸 더
                  30px → +58px(3열)
                  35px → +77px(4열)   ← 최소폭에 걸려 멈춤
         즉 첫 칸 이후로는 5px 마다 한 칸. 이론값의 약 4배 속도다. 천천히 움직이면
         (이벤트가 많아서) 더 많이 자라고, 빨리 움직이면 덜 자란다 — 손에는
         제어할 수 없이 미끄러지는 것으로 느껴진다.

       ★ 고침: 매 이동마다 **기준 스냅샷**에서 다시 계산한다. 절대 변화량을 절대
         기준에 적용하므로 이벤트 개수와 무관하게 결과가 같다(멱등).

       ★ Math.round → Math.trunc 와 48→96열은 별개의 문제였다(칸 크기·경계 타이밍).
         그 둘을 고친 뒤에도 이 누적이 남아 있었다.
    */
    const resizeBaseRef = useRef(null);

    const updateWidget = useCallback((id, partial) => {
      setLayout(prev => {
        const target = prev.widgets.find(w => w.id === id);
        /*
           ★★ 겹치는 위치·크기는 받지 않는다.

             `overlaps`·`hasCollision` 은 처음부터 이 파일에 있었는데, 위젯을 새로
             켤 때와 복제할 때(findFreeSpot)만 쓰였다. 드래그·리사이즈가 지나는
             이 함수는 좌표를 **그대로 저장했다.** 그래서 창을 끌어다 놓으면 겹쳤다.

             실측: 프리셋 6개의 초기 배치는 모두 겹침 0쌍인데, 편집 모드에서 창
             하나를 다른 창 위로 끌면 겹침 2쌍이 됐다. 설계가 아니라 검사를 부르지
             않은 것이었다.

           ★★ 겹칠 때 **되돌리지 않고 마지막 유효 위치를 유지한다.**

             드래그 중에 창이 원래 자리로 튀면 조작감이 망가진다. 겹치는 좌표만
             무시하면, 창은 마우스를 따라오다가 다른 창에 닿는 순간 그 앞에서
             멈춘다 — 벽에 막히는 느낌이고, 사용자가 왜 멈췄는지 바로 안다.

           ★ 위치·크기와 무관한 변경(잠금, 설정, _dragging 플래그만 있는 호출)은
             그대로 통과시킨다. 그것까지 막으면 드래그 종료 신호가 사라진다.
        */
        const touchesGeometry = partial.x !== undefined || partial.y !== undefined
          || partial.w !== undefined || partial.h !== undefined;
        /*
           ★★ **이동 중에는 막지 않는다. 놓을 때만 판정한다.**

             처음에는 매 호출을 검사했는데 창이 갇혔다(실측: 아래 빈 공간으로 700px
             끌어도 좌표가 그대로였다). 드래그는 픽셀마다 onChange 를 부르고, 경로가
             다른 창을 스치는 순간부터 좌표가 전부 거부된다. 기준점(drag.ox/oy)은
             그대로이므로 그 뒤의 이동도 같은 절대 좌표를 계산해 계속 거부된다 —
             한 번 막히면 영구히 지나갈 수 없다.

             그래서 드래그·리사이즈 **중**(_dragging/_resizing)에는 그대로 통과시키고,
             **끝나는 순간**에 겹쳤는지 본다. 겹쳤으면 그 조작을 시작 위치로
             되돌린다. 화면에서는 창을 끌어다 놓았을 때 원래 자리로 돌아가므로,
             "여기는 놓을 수 없다" 가 분명히 보인다.

           ★ 시작 위치는 드래그가 시작될 때 기억한다(geomStartRef). 되돌릴 곳을
             모르면 겹친 상태로 남을 수밖에 없다.
        */
        const isTransient = partial._dragging === true || partial._resizing === true;
        const isEnding = partial._dragging === false || partial._resizing === false;

        /*
           ★★★ 기준 스냅샷은 **분기 밖에서** 잡아야 한다.

             처음에는 아래 `else if (target && isTransient && !geomStartRef.current)`
             안에 넣었다. 그런데 크기 조절이면 그 위의 성장 분기가 먼저 걸려서 이
             `else if` 는 **실행되지 않는다.** 그래서 스냅샷이 영원히 null 이고,
             계산은 계속 `prev` 를 기준으로 해서 누적이 그대로 남았다.
             실측으로 확인했다 — 고쳤다고 생각했는데 수치가 한 글자도 안 바뀌었다
             (20px→+19, 25px→+39, 30px→+58 ... 수정 전과 동일).

           ★ 그러므로 분기 판단보다 **먼저** 잡는다. 제스처 첫 호출에서 한 번만
             잡히고(`!resizeBaseRef.current`), 끝날 때 해제한다.
        */
        if (partial._resizing === true && !resizeBaseRef.current) {
          resizeBaseRef.current = prev.widgets.map(w => ({ ...w }));
        }
        if (partial._resizing === false) {
          resizeBaseRef.current = null;
        }

        let applied = partial;
        let neighbours = null;

        if (target && partial._resizing === true && partial._from && partial._dir) {
          /*
             ★★ 크기 조절은 **이웃을 차례로 줄여서** 해결한다(되돌리지 않는다).

               24열이 빈틈 없이 채워져 있어, 되돌리기만 하면 확대가 영구히
               불가능하다. 바로 옆만 줄이면 1열이 한계였다(측정). 그래서 같은 줄의
               이웃들을 순서대로 줄인다 — 위치를 다른 줄로 옮기지는 않는다.

             ★ 각 방향을 따로 처리한다. 대각선 손잡이는 두 방향이 함께 오는데,
               한 번에 풀려고 하면 검증이 복잡해진다. 가로를 먼저 풀고 그 결과에
               세로를 적용한다.
          */
          const from = partial._from;
          /*
             ★ 변화량(열/행)만 뽑는다. 절대 좌표는 쓰지 않는다 — 손잡이는 그려진
               기하를 기준으로 움직이고, 계산은 저장 기하에서 하기 때문이다.
          */
          const dirs = [];
          if (partial._dir.includes('e') && partial.w > from.w) dirs.push(['e', partial.w - from.w]);
          if (partial._dir.includes('w') && partial.x < from.x) dirs.push(['w', from.x - partial.x]);
          if (partial._dir.includes('s') && partial.h > from.h) dirs.push(['s', partial.h - from.h]);
          if (partial._dir.includes('n') && partial.y < from.y) dirs.push(['n', from.y - partial.y]);

          if (dirs.length > 0) {
            /*
               ★★ 계산을 **저장 좌표계 하나로** 통일한다.

                 접힌 패널이 있으면 그릴 때만 기하가 바뀐다(panel-state 의 applyTo).
                 좌표계가 둘이면 어느 쪽에서 계산해도 틀린다:
                   · 저장값으로 계산하면 화면과 기준이 어긋난다
                   · 그려진 값으로 계산해 저장하면 변환이 두 번 적용된다
                 두 방식을 모두 실측으로 실패시켰다(겹침 발생, 이웃만 축소).

               ★ 열 단위 변화량은 두 좌표계에서 같다(칸 폭이 일정하다). 그래서
                 **변화량만** 받아 저장 좌표계에서 계산하면 변환과 무관하게 맞는다.
                 화면 반영은 렌더 단계가 알아서 한다.
            */
            /*
               ★★ **기준 스냅샷**에서 계산한다. `prev` 를 쓰면 이미 반영된 축소에
                 절대 변화량을 다시 적용해 누적된다(위 resizeBaseRef 주석의 실측).
               ★ 제스처의 첫 호출에서는 스냅샷이 아직 없다 — 그때의 `prev` 가 곧
                 시작 상태이므로 그대로 쓰면 맞다.
            */
            const base = resizeBaseRef.current || prev.widgets;
            const baseTarget = base.find(w => w.id === id) || target;
            let cur = { ...baseTarget };
            let rest = base.filter(w => !w.hidden && w.id !== id).map(w => ({ ...w }));
            for (const [dir, want] of dirs) {
              const r = resolveGrowth(cur, rest, dir, want, prev.cols || 96);
              cur = r.target; rest = r.others;
            }
            const { _from: _f, _dir: _d, ...restPartial } = partial;
            void _f; void _d;
            applied = { ...restPartial, x: cur.x, y: cur.y, w: cur.w, h: cur.h };
            neighbours = new Map(rest.map(o => [o.id, o]));
          } else {
            /*
               ★★ 확대가 아니면(축소·이동) 그대로 통과시키되 **겹침은 검사한다.**

                 처음에는 무조건 통과시켰다. 그러자 축소·이동 조합에서 겹침이
                 새어나갔다 — 실측으로 확인했다(확대는 0건인데 겹침 1쌍이 생겼다).
                 확대만 검사하면 나머지 경로가 무방비가 된다.

               ★ 겹치면 기하 변경을 버린다. 조작 중이므로 다음 마우스 이동이
                 다시 시도하고, 겹치지 않는 위치에서 반영된다.
            */
            const { _from: _f2, _dir: _d2, ...restPartial } = partial;
            void _f2; void _d2;
            /*
               ★★ 축소·이동도 **변화량**으로 적용한다.

                 손잡이는 그려진 기하를 기준으로 절대 좌표를 보낸다. 접힘 변환이
                 있으면 그 값이 저장 기하와 다르다 — 그대로 적용하면 줄이려는데
                 오히려 늘어나 이웃과 겹치고, 겹침 검사가 막아서 **축소가 전혀
                 되지 않았다**(실측: 781px 에서 두 번 줄여도 그대로).
            */
            /*
               ★★★ **기준 스냅샷에서 계산해야 한다.** 확대 경로는 `resizeBaseRef` 를
                 쓰는데 축소 경로는 `target`(=현재 상태)을 썼다. 그래서 한 제스처 안에서
                 이미 반영된 변화 위에 절대 변화량을 다시 적용해 값이 어긋났다.

                 실측: 동쪽으로 넓힌 뒤(span 52→56) 다시 좁히면 **그대로 56** 이었다.
                 운영자가 전한 "한쪽으로만 되고 반대로는 안 된다" 가 이것이다.

               ★ 확대와 축소가 **같은 기준**을 써야 한다. 그러지 않으면 방향에 따라
                 동작이 달라지고, 그것이 "미끄러진다·안 된다" 로 느껴진다.
            */
            const shrinkBase = resizeBaseRef.current || prev.widgets;
            const baseT = shrinkBase.find(w => w.id === id) || target;
            const others = prev.widgets.filter(w => !w.hidden && w.id !== id);
            /*
               ★★★ **드래그 이동은 `_from` 을 보내지 않는다.**

                 이 경로는 원래 크기 **축소**를 위해 만들어졌고, 손잡이가 함께 보내는
                 `_from`(제스처 시작 기하)으로 변화량을 계산한다. 그런데 창을 끌어
                 옮기는 드래그는 `_from` 을 보내지 않는다 — `onChange({x, y, _dragging})`
                 뿐이다. 그래서 `from.x` 가 `undefined` 가 되고 계산이 NaN 이 됐다.

                 실측: 편집 모드에서 ai 창을 assets 자리로 끌어도 **좌표가 한 칸도
                 바뀌지 않았다**(45/span 24 → 45/span 24). 고객이 원한 "AI 창을
                 포지션과 에셋 사이에 넣기" 가 이것 때문에 막혀 있었다.

               ★ `_from` 이 없으면 **보내온 절대 좌표를 그대로 쓴다.** 드래그는 접힘
                 변환과 무관한 격자 좌표를 직접 계산해 보내므로(onDragStart 의
                 drag.ox/oy 기준) 변환이 필요 없다.
               ★ 변화량 방식은 `_from` 이 있을 때만 쓴다 — 그때는 손잡이가 그려진
                 기하를 기준으로 절대값을 보내기 때문에 변환이 필요하다.
            */
            const moved = from ? {
              x: baseT.x + (partial.x - from.x),
              y: baseT.y + (partial.y - from.y),
              w: baseT.w + (partial.w - from.w),
              h: baseT.h + (partial.h - from.h),
            } : {
              x: partial.x !== undefined ? partial.x : target.x,
              y: partial.y !== undefined ? partial.y : target.y,
              w: partial.w !== undefined ? partial.w : target.w,
              h: partial.h !== undefined ? partial.h : target.h,
            };
            /* ★ 최소 크기 아래로는 줄이지 않는다. */
            moved.w = Math.max(minWOf(target), moved.w);
            moved.h = Math.max(minHOf(target), moved.h);
            Object.assign(restPartial, moved);
            const candidate = { ...target, ...restPartial };
            if (hasCollision(others, candidate)) {
              const { x: _x2, y: _y2, w: _w2, h: _h2, ...noGeom } = restPartial;
              void _x2; void _y2; void _w2; void _h2;
              applied = noGeom;
              if (Object.keys(applied).length === 0) return prev;
            } else {
              applied = restPartial;
            }
          }
        } else if (target && isEnding) {
          /*
             ★★★ **크기 조절이 끝날 때 이 분기가 축소를 되돌리고 있었다.**

               실측: 동쪽 손잡이를 왼쪽으로 끌면 **끌고 있는 동안은 span 52→46 으로
               줄어드는데, 놓는 순간 52 로 돌아갔다.** 운영자가 전한 "축소가 안 된다" 가
               이것이다(방향은 반대로 전해졌다).

             ★ 원인: `geomStartRef` 가 **리사이즈에서는 잡히지 않는다.** 아래
               `else if (target && isTransient && !geomStartRef.current)` 에서 잡는데,
               크기 조절은 그 위의 리사이즈 분기가 먼저 걸려 **여기까지 오지 않는다.**
               (이 파일에서 resizeBaseRef 도 똑같은 이유로 한 번 실패했고, 그때는
                분기 판단보다 먼저 잡도록 고쳤다. 같은 함정을 다시 밟았다.)

               그래서 `geomStartRef` 에는 **이전 제스처의 값**이 남아 있고, 겹침이
               감지되면 그 오래된 좌표로 되돌렸다.

             ★★ 되돌릴 근거가 확실하지 않으면 **되돌리지 않는다.** 시작 좌표가 이
               제스처의 것이 아니면(id 불일치 또는 없음) 그대로 둔다 — 잘못된 좌표로
               되돌리는 것은 아무것도 하지 않는 것보다 나쁘다.
             ★ 크기 조절은 위 분기에서 이미 겹침을 검사하고 거부한다. 그러므로 여기서
               다시 되돌릴 필요가 없다 — 되돌림은 **드래그 이동**을 위한 장치다.
          */
          const isResizeEnd = partial._resizing === false;
          const others = prev.widgets.filter(w => !w.hidden && w.id !== id);
          if (!isResizeEnd && hasCollision(others, target)) {
            const start = geomStartRef.current;
            if (start && start.id === id) {
              /* ★ 시작 위치로 되돌린다. 그 자리는 조작 전이므로 겹치지 않았다. */
              applied = { ...partial, x: start.x, y: start.y, w: start.w, h: start.h };
            }
          }
          geomStartRef.current = null;
        } else if (target && isTransient && !geomStartRef.current) {
          /* ★ 조작이 시작됐다. 되돌릴 자리를 기억한다. */
          geomStartRef.current = { id, x: target.x, y: target.y, w: target.w, h: target.h };
        }
        void touchesGeometry;

        let nextWidgets = prev.widgets.map(w => {
          if (w.id === id) return { ...w, ...applied };
          /* ★ 줄어든 이웃을 함께 반영한다. 대상만 바꾸면 겹친 상태가 저장된다. */
          const n = neighbours && neighbours.get(w.id);
          return n ? { ...w, x: n.x, y: n.y, w: n.w, h: n.h } : w;
        });

        /*
           ★★★ 크기 조절이 **끝난 뒤** 빈 자리를 메운다.

             패널을 줄이면 그만큼이 빈 채로 남았다. 늘릴 때는 이웃을 줄여서 자리를
             만드는데, 줄일 때는 아무도 그 자리를 받지 않았기 때문이다.
             실측: 채움 96% → 60px 늘림 96% → 60px 되돌림 **89%**. 화면에 구멍이
             보인다. 접기에서 쓴 것과 **같은 문제**라 같은 함수로 처리한다.

           ★ 조작 **중**(_resizing === true)에는 하지 않는다. 매 이동마다 이웃을
             넓히면 그것이 다음 계산의 기준이 되어 또 누적된다 — 방금 고친 그
             버그를 다시 만드는 셈이다. 끝나는 순간에 한 번만 정리한다.

           ★ 실패하거나 함수가 없으면 그대로 둔다. 구멍이 남는 것이 배치를
             망가뜨리는 것보다 낫다.
        */
        if (partial._resizing === false && window.QTPanelState
            && typeof window.QTPanelState.fillHoles === 'function') {
          try {
            /*
               ★★★ **방금 조작한 창을 흡수 후보에서 뺀다.**

                 이것이 없어서 축소가 전혀 되지 않았다. 창을 줄이면 옆에 빈칸이 생기고,
                 fillHoles 의 흡수 후보에 **줄인 창 자신이** 들어가 줄인 만큼을 그대로
                 되돌려받았다(실측: 끌 때 52→46, 놓는 순간 52 복귀).
            */
            const filled = window.QTPanelState.fillHoles(nextWidgets, prev.cols || 96, 16, id);
            const vis = filled.filter(w => !w.hidden);
            const bad = vis.some(a => a.w < 1 || a.h < 1)
              || vis.some((a, i2) => vis.slice(i2 + 1).some(c => overlaps(a, c)));
            if (!bad) nextWidgets = filled;
          } catch (e) { void e; }
        }
        const next = { ...prev, widgets: nextWidgets };
        if (!applied._dragging && !applied._resizing) {
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

    /*
       ★★★ 접기는 **숨김 표시만** 남긴다. 저장 좌표는 절대 건드리지 않는다.

         왜 이렇게 하는가 — 앞서 세 번 실패했다.

         처음에는 접을 때 이웃을 실제로 넓혀 저장했다. 그러면 되살릴 때 그 폭을
         정확히 돌려받아야 하는데, 여러 개를 접었다 펴는 순서·중간 편집까지 맞추는
         것이 사실상 불가능했다. 세 가지 방법을 실측으로 모두 실패시켰다:
           · 넘겨준 양을 기록해 되돌리기        → 복원 후 채움 54~85%
           · 겹친 만큼 줄이기(작은 축)          → 80~90%
           · 겹친 만큼 줄이기(넓어진 축)        → 75~86%
         기본이 96~97% 인데 어느 방법도 돌아오지 못했다.

       ★ 그래서 좌표를 **파생값**으로 만든다. 저장된 배치는 언제나 "다 펼친 상태"
         하나뿐이고, 접힘은 그릴 때 변환으로 적용한다(applyFolds). 되살리기는
         집합에서 id 를 빼는 것이므로 원래 배치로 **정확히** 돌아온다.

       ★ 같은 구조를 이미 쓰고 있다 — panel-state.applyTo 가 접힌 패널의 기하를
         렌더 시점에 다시 쓴다. 같은 규칙을 따르면 좌표계가 하나 더 늘지 않는다.
    */
    const hideWidget = useCallback((id) => {
      setLayout(prev => {
        const nextWidgets = prev.widgets.map(w => w.id === id ? { ...w, hidden: true } : w);
        setHistory(h => ({ past: [...h.past, prev].slice(-30), future: [] }));
        setDirty(true);
        return { ...prev, widgets: nextWidgets };
      });
      setSelectedId(null);
    }, []);

    /*
       ★ 되살리기는 숨김만 해제한다. 좌표를 건드리지 않으므로 접기 전 배치로
         **정확히** 돌아온다. 빈자리를 찾을 필요도 없다 — 그 자리는 애초에
         이 패널의 자리이고, 저장 좌표에서 비워진 적이 없다.
    */
    const showWidget = useCallback((id) => {
      setLayout(prev => {
        if (!prev.widgets.some(x => x.id === id)) return prev;
        const nextWidgets = prev.widgets.map(x => x.id === id ? { ...x, hidden: false } : x);
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
      const meta = DEFAULT_WIDGET_META[type] || { minW: 16, minH: 6 };
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
    widget, cols = 96, rowH = 40, gap = 6,
    isEditing, isLocked, isSelected, onChange,
    /** 크기 조절이 끝났을 때 호출된다 — 상위가 레이아웃을 저장한다. */
    onResizeEnd,
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
      /*
         ★★ 크기 조절은 편집 모드에 들어가지 않아도 된다.

           전에는 `!isEditing` 이면 즉시 반환해서, 창 크기를 바꾸려면 매번
           레이아웃 편집으로 들어가야 했다. 크기 조절은 배치를 흔들지 않는
           국소 조작이므로 트레이드 화면에서 바로 되게 한다.
           (창을 끌어 옮기는 것은 오조작 위험이 커서 편집 모드에 남긴다.)
         ★ 잠긴 창은 그대로 보호한다.
      */
      if (isLocked || widget.locked) return;
      onSelect && onSelect(widget.id);
      /*
         ★★ 크기를 조절한 창도 맨 위로 올린다.

           전에는 raise 가 **드래그에만** 걸려 있었다. 그래서 창을 좌우로 늘리면
           방금 만진 창이 옆 패널(코파일럿 등) **아래로 깔린 채** 커졌다 —
           늘린 부분이 가려져서 무엇을 만졌는지 보이지 않는다.

           마지막에 만진 창이 위에 온다는 규칙은 옮길 때든 늘릴 때든 같아야 한다.
      */
      onRaise && onRaise(widget.id);
      const rect = trackRef.current.getBoundingClientRect();
      const cellW = (rect.width - (cols - 1) * gap) / cols;
      const cellH = rowH;
      setResize({
        dir, x0: e.clientX, y0: e.clientY,
        ow: widget.w, oh: widget.h, ox: widget.x, oy: widget.y, cellW, cellH
      });
      e.preventDefault();
      e.stopPropagation();
    }, [isLocked, widget, cols, gap, rowH, trackRef, onSelect, onRaise]);

    useEffect(() => {
      if (!resize) return;
      const onMove = (e) => {
        /*
           ★★ **반올림하지 않는다.** 커서가 한 칸을 완전히 지난 뒤에만 한 칸 움직인다.

             예전에는 `Math.round` 였다. 그러면 한 칸(약 39px)의 **절반만** 움직여도
             한 칸이 바뀐다 — 패널 경계가 커서를 앞질러 가고, 손에는 "미끄러진다" 로
             느껴진다. 실측: 마우스 20px 이동에 패널이 38px 커졌다.

             버림으로 바꾸면 경계가 커서를 따라오다 칸 경계에서 딱 걸린다. 같은 격자,
             같은 칸 크기인데 조작감이 달라진다.

           ★ 음수(왼쪽·위로 끌기)도 0 쪽으로 버려야 한다. `Math.floor(-0.6)` 은 -1 이라
             반올림과 같아진다. 그래서 `Math.trunc` 를 쓴다.
        */
        const step = (delta, size) => Math.trunc(delta / (size + gap));
        const dx = step(e.clientX - resize.x0, resize.cellW);
        const dy = step(e.clientY - resize.y0, resize.cellH);
        const minW = widget.minW || 12;
        const minH = widget.minH || 3;
        let nw = resize.ow, nh = resize.oh, nx = resize.ox, ny = resize.oy;
        if (resize.dir.includes('e')) {
          nw = Math.max(minW, Math.min(cols - resize.ox, resize.ow + dx));
        }
        if (resize.dir.includes('s')) {
          nh = Math.max(minH, resize.oh + dy);
        }
        if (resize.dir.includes('w')) {
          // 왼쪽 모서리: x 를 옮기고 그만큼 폭을 키운다. 좌측 경계(0)와 최소폭으로 제한.
          const cand = Math.max(0, Math.min(resize.ox + dx, resize.ox + resize.ow - minW));
          nx = cand; nw = resize.ow + (resize.ox - cand);
        }
        if (resize.dir.includes('n')) {
          // 위쪽 모서리: y 를 옮기고 그만큼 높이를 키운다.
          const cand = Math.max(0, Math.min(resize.oy + dy, resize.oy + resize.oh - minH));
          ny = cand; nh = resize.oh + (resize.oy - cand);
        }
        /*
           ★★ 방향과 시작 크기를 함께 보낸다.

             엔진이 "어느 방향으로 얼마나 넓히려는가" 를 알아야 그 줄의 이웃들을
             차례로 줄일 수 있다. 첫 _resizing 호출에서 기준을 추측하면 이미 새
             크기가 들어 있어 확대를 감지하지 못한다 — 그 버그를 실측으로 겪었다.
        */
        onChange({
          x: nx, y: ny, w: nw, h: nh, _resizing: true,
          _dir: resize.dir,
          _from: { x: resize.ox, y: resize.oy, w: resize.ow, h: resize.oh },
        });
      };
      const onUp = () => {
        onChange({ _resizing: false });
        setResize(null);
        /*
           ★ 크기를 바꾸면 곧바로 저장한다. 편집 모드에서는 '저장' 버튼이 있지만,
             트레이드 화면에서 바로 조절할 때는 누를 버튼이 없다 — 저장하지 않으면
             새로고침에 되돌아가서 "조절이 안 된다" 로 보인다.
           ★ onChange(_resizing:false) 가 상태에 반영된 **뒤에** 저장해야 한다.
             같은 틱에 저장하면 조절 중 플래그가 섞인 값이 저장될 수 있다.
        */
        if (onResizeEnd) setTimeout(() => onResizeEnd(), 0);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [resize, cols, gap, widget.minW, widget.minH, onChange, onResizeEnd]);

    /*
       ★ 크기 조절 손잡이는 편집 모드가 아니어도 보인다(잠긴 창은 제외).
         트레이드 화면에서 바로 창 크기를 맞출 수 있어야 한다 — 편집 모드는
         창을 옮기고 추가·삭제하는 배치 작업용으로 남긴다.
       ★ 평상시에는 테두리에 가깝게(연하게) 보이도록 CSS 가 처리한다.
    */
    /*
       ★★ 접힌 패널은 크기를 조절할 수 없다.

         접히면 폭이 고정 띠(2열)로 강제되고, 그 값은 그릴 때 만들어진다. 손잡이를
         끌면 저장값과 화면값이 서로 다른 방향으로 움직여 겹침이 생긴다(실측:
         접힌 코파일럿의 e 손잡이를 끌자 겹침 1쌍이 발생했다).

       ★ 손잡이를 아예 내보내지 않는다. 끌 수 없는 손잡이를 보여주는 것은
         죽은 버튼과 같다 — 펼치면 다시 조절할 수 있다.
    */
    const isCollapsedPanel = typeof window !== 'undefined' && window.QTPanelState
      && typeof window.QTPanelState.isCollapsed === 'function'
      && window.QTPanelState.isCollapsed(widget.id);
    const showResize = !isLocked && !widget.locked && !isCollapsedPanel;
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
            <button aria-label={t('lay_drag')} className="widget-controls__btn" onMouseDown={onDragStart} title={t('lay_drag')}><I.Drag size={11}/></button>
            <div className="widget-controls__sep"/>
            <button aria-label={widget.locked ? t('lay_unlock') : t('lock')} className="widget-controls__btn" onClick={() => onLock && onLock(widget.id)} title={widget.locked ? t('lay_unlock') : t('lock')}>
              {widget.locked ? <I.Lock size={11}/> : <I.Unlock size={11}/>}
            </button>
            <button aria-label={t('chart_settings')} className="widget-controls__btn" onClick={() => onSettings && onSettings(widget.id)} title={t('chart_settings')}><I.Cog size={11}/></button>
            <button aria-label={t('lay_duplicate')} className="widget-controls__btn" onClick={() => onDuplicate && onDuplicate(widget.id)} title={t('lay_duplicate')}><I.Layers size={11}/></button>
            <button aria-label={t('lay_maximize')} className="widget-controls__btn" onClick={() => onMaximize && onMaximize(widget.id)} title={t('lay_maximize')}><I.Expand size={11}/></button>
            <div className="widget-controls__sep"/>
            <button aria-label={t('lay_hide')} className="widget-controls__btn is-danger" onClick={() => onHide && onHide(widget.id)} title={t('lay_hide')}><I.EyeOff size={11}/></button>
          </div>
        )}

        {/*
           편집 모드에서는 위젯 어디를 잡아도 드래그된다. (전에는 상단 36px 띠만
           잡혔다 — 차트처럼 내용이 꽉 찬 위젯은 잡을 곳이 거의 없어 "이동이
           자유롭지 않다"는 문제가 있었다.) 리사이즈 핸들(z5)·컨트롤(z8)은 이 면
           (z2) 위에 있어 그대로 동작한다.
        */}
        {isEditing && !widget.locked && (
          <div
            className="widget-drag-surface"
            style={{position:'absolute', inset:0, zIndex:2, cursor: drag ? 'grabbing' : 'grab'}}
            onMouseDown={onDragStart}
          />
        )}

        {showResize && (
          <>
            <div className="resize-handle resize-handle--e" onMouseDown={(e) => onResizeStart(e, 'e')}/>
            <div className="resize-handle resize-handle--s" onMouseDown={(e) => onResizeStart(e, 's')}/>
            <div className="resize-handle resize-handle--w" onMouseDown={(e) => onResizeStart(e, 'w')}/>
            <div className="resize-handle resize-handle--n" onMouseDown={(e) => onResizeStart(e, 'n')}/>
            <div className="resize-handle resize-handle--se" onMouseDown={(e) => onResizeStart(e, 'se')}/>
            <div className="resize-handle resize-handle--sw" onMouseDown={(e) => onResizeStart(e, 'sw')}/>
            <div className="resize-handle resize-handle--ne" onMouseDown={(e) => onResizeStart(e, 'ne')}/>
            <div className="resize-handle resize-handle--nw" onMouseDown={(e) => onResizeStart(e, 'nw')}/>
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
          <button aria-label={t('close')} className="btn btn--icon" onClick={onClose} title={t('close')}><I.X size={12}/></button>
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
          <button aria-label={t('lay_library_title')}
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

          <button aria-label={t('lay_undo_hint')} className="btn btn--sm btn--ghost" onClick={engine.undo} disabled={!engine.history.past.length} title={t('lay_undo_hint')}>
            <I.Undo size={13}/> {t('undo')}
          </button>
          <button aria-label={t('lay_redo_hint')} className="btn btn--sm btn--ghost" onClick={engine.redo} disabled={!engine.history.future.length} title={t('lay_redo_hint')}>
            <I.Redo size={13}/> {t('redo')}
          </button>

          <div style={{width:1, height: 20, background:'var(--color-border-subtle)'}}/>

          <button className="btn btn--sm btn--ghost" onClick={() => engine.setIsLocked(v => !v)}>
            {engine.isLocked ? <I.Lock size={13}/> : <I.Unlock size={13}/>} {engine.isLocked ? t('lay_locked') : t('lock')}
          </button>
          <button aria-label={t('lay_reset_hint')} className="btn btn--sm" onClick={() => engine.reset(engine.presetId)} title={t('lay_reset_hint')}>
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
