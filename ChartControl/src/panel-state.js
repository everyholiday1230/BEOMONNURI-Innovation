/* ============================================================
   패널 접힘 상태 — window.QTPanelState

   무엇을 하는가
   -----------
   "어떤 위젯이 접혀 있는가" 를 한 곳에 둔다. 위젯 자신이 접기 버튼을 누르고,
   레이아웃이 그 사실을 읽어 **빈 공간을 옆 위젯에 넘긴다.**

   ★★ 왜 필요했는가

     코파일럿에는 접기 버튼이 이미 있었다. 그런데 접으면 본문만 숨고 **격자
     칸은 그대로 남았다** — 368×730 짜리 빈 상자가 화면에 남고 차트는 커지지
     않는다. 접는 목적이 "차트를 넓게 보는 것" 인데 그 목적이 달성되지 않았다.

   ★ 왜 위젯이 직접 레이아웃을 고치지 않는가

     위젯이 자기 크기를 바꾸면 그것이 저장된 레이아웃에 남는다. 그러면 접었다
     펴는 동작이 이용자가 손으로 맞춰 둔 배치를 영구히 망친다. 접힘은 **표시
     상태**이고 배치가 아니다 — 그래서 따로 둔다.

   불변식
   -----
   1. 저장된 레이아웃(`layout.widgets`)은 건드리지 않는다. 그릴 때만 변환한다.
   2. 접힌 위젯은 화면에서 사라지지 않는다 — 좁은 띠로 남아야 다시 펼 수 있다.
   3. 넘겨받을 이웃이 없으면 아무 것도 하지 않는다(억지로 옮기면 겹친다).
   ============================================================ */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  /** 접힌 위젯 id 집합. */
  const collapsed = new Set();
  const listeners = new Set();

  /** 접었을 때 남기는 폭(칸). 헤더의 접기 버튼을 누를 수 있어야 한다. */
  const COLLAPSED_W = 2;

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { /* 한 구독자의 오류가 나머지를 막지 않는다 */ }
    });
  }

  window.QTPanelState = {
    isCollapsed(id) { return collapsed.has(id); },

    setCollapsed(id, on) {
      if (!id) return;
      const had = collapsed.has(id);
      if (on) collapsed.add(id); else collapsed.delete(id);
      if (had !== collapsed.has(id)) emit();
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** React 훅 — 접힘이 바뀌면 다시 렌더된다. */
    useCollapsedVersion() {
      const [v, setV] = useState(0);
      useEffect(() => window.QTPanelState.subscribe(() => setV((n) => n + 1)), []);
      return v;
    },

    /**
     * 그릴 때 쓰는 기하 변환.
     *
     * 접힌 위젯을 좁은 띠로 만들고, **같은 행을 공유하는 왼쪽 이웃**에게 그
     * 폭을 넘긴다.
     *
     * ★ 왼쪽을 고르는 이유: 이 배치에서 코파일럿의 왼쪽이 차트다. 접는 목적이
     *   차트를 넓게 보는 것이므로 그쪽으로 넘기는 것이 의도에 맞는다.
     *
     * ★ 겹치는 행이 없으면 이웃이 아니다. 세로로 떨어진 위젯을 늘리면 다른
     *   위젯 위로 겹쳐 그려진다.
     *
     * @param {Array} widgets 저장된 위젯 목록 (건드리지 않는다)
     * @returns {Array} 그릴 위젯 목록
     */
    applyTo(widgets) {
      if (!Array.isArray(widgets) || collapsed.size === 0) return widgets;

      const out = widgets.map((w) => ({ ...w }));

      for (const target of out) {
        if (!collapsed.has(target.id) || target.hidden) continue;
        const freed = target.w - COLLAPSED_W;
        if (freed <= 0) continue;

        /*
           같은 행대를 공유하고, 접힌 위젯의 **왼쪽에 붙어 있는** 위젯을 찾는다.
           여러 개면 겹치는 행이 가장 많은 것을 고른다(차트가 정답이 되게).
        */
        let best = null;
        let bestOverlap = 0;
        for (const other of out) {
          if (other === target || other.hidden) continue;
          const touchesLeft = other.x + other.w === target.x;
          if (!touchesLeft) continue;
          const overlap = Math.min(other.y + other.h, target.y + target.h) - Math.max(other.y, target.y);
          if (overlap > bestOverlap) { best = other; bestOverlap = overlap; }
        }
        if (!best) continue;

        best.w += freed;
        target.x += freed;
        target.w = COLLAPSED_W;
      }

      return out;
    },
  };
})();
