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

  /*
     접었을 때 남기는 폭(칸). 헤더의 접기 버튼을 누를 수 있어야 한다.

     ★★ 2 칸이었다. 24칸 격자에서 2칸은 1600px 화면에서 **109px** 이고, 그 안에는
       세로 라벨과 32px 버튼 하나뿐이다. 고객이 "차트와 코파일럿 사이에 빈 공간이
       있다" 고 한 것이 이 띠다 — 접는 목적이 차트를 넓게 보는 것인데 100px 넘게
       비어 있으면 목적이 절반만 달성된다.

     ★ 1 칸이면 1600px 에서 약 57px 이고 32px 버튼이 들어간다. 가장 좁은 데스크톱
       (1024px)에서도 격자 한 칸이 약 33px 이라 버튼이 겨우 들어간다 — 그래서
       `.panel.qt-ai-collapsed` 의 좌우 패딩을 0 으로 두는 CSS 가 함께 있어야 한다
       (pending.css 의 .qt-ai-collapsed 규칙).
  */
  /*
     ★★ **96열 기준 4칸**이다. 그리드를 24 → 48 → 96 열로 올렸으므로 예전 24열의
       1칸과 같은 실제 폭이다. 1 로 두면 접힌 패널이 절반 폭이 되어 접기 버튼이
       들어가지 않는다.
  */
  const COLLAPSED_W = 4;

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { /* 한 구독자의 오류가 나머지를 막지 않는다 */ }
    });
  }

  window.QTPanelState = {
    /*
       ★★★ 접힌(숨긴) 패널의 자리를 **그릴 때** 이웃에게 넘긴다.

         저장된 배치는 언제나 "다 펼친 상태" 하나다. 접힘은 여기서 파생 계산한다.
         그래야 되살릴 때 원래 배치로 **정확히** 돌아온다 — 저장 좌표를 실제로
         고치는 방식은 여러 개를 접었다 폈을 때 복원되지 않았다(실측 54~90%,
         기본 96~97%). layout-engine 의 hideWidget 주석에 기록해 두었다.

       ★ 규칙: 접힌 칸의 **행 범위를 빈틈없이 덮는** 옆 이웃들을 그 폭만큼 넓힌다.
         가로가 안 되면 **열 범위를 덮는** 위/아래 이웃을 그 높이만큼 넓힌다.
         한쪽만 넓히면 나머지가 겹치므로 덮는 이웃을 **모두** 넓힌다.

       ★ 어느 쪽도 맞지 않으면 그대로 둔다. 구멍이 남는 것이 배치를 망가뜨리는
         것보다 낫다.

       ★ 접힌 것을 여러 개 처리할 때는 **하나씩 순서대로** 적용한다. 앞서 넓어진
         결과 위에서 다음을 계산해야 두 번째 구멍도 메워진다.
    */
    applyFolds(widgets, cols, rows) {
      if (!Array.isArray(widgets)) return widgets;
      if (!widgets.some((w) => w && w.hidden)) return widgets;

      const C = cols || 96;
      const R = rows || 16;
      const out = widgets.map((w) => ({ ...w }));

      /*
         ★ 빈 칸을 실제로 세어 **가장 큰 빈 사각형**을 찾는다. 접힌 칸 하나만 보고
           이웃을 넓히면, 여러 개를 접었을 때 남는 조각을 못 메운다.
           실측(사각형 없이 접힌 칸만 볼 때): chart-focus 3개 접으면 채움 **16%**.
      */
      const emptyRect = () => {
        const grid = [];
        for (let r = 0; r < R; r++) grid.push(new Array(C).fill(false));
        for (const o of out) {
          if (o.hidden) continue;
          for (let r = o.y; r < Math.min(R, o.y + o.h); r++)
            for (let c = o.x; c < Math.min(C, o.x + o.w); c++)
              if (r >= 0 && c >= 0) grid[r][c] = true;
        }
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            if (grid[r][c]) continue;
            let w = 0;
            while (c + w < C && !grid[r][c + w]) w++;
            let h = 1;
            outer: while (r + h < R) {
              for (let k = c; k < c + w; k++) if (grid[r + h][k]) break outer;
              h++;
            }
            return { x: c, y: r, w, h };
          }
        }
        return null;
      };

      /*
         ★★ 채우는 조건: 이웃의 **다른 축 범위가 빈 사각형 안에 들어 있어야** 한다.
           삐져나오면 넓히는 순간 바깥의 남의 칸을 덮어 겹친다.

         ★ 빈틈없이 덮을 것을 요구하지 **않는다.** 조건에 맞는 이웃만 넓히고 다시
           빈 사각형을 찾으면, 남은 조각이 다음 회차에 더 작은 사각형으로 잡혀
           차례로 메워진다. "완전히 덮을 때만 넓힌다" 로 만들었을 때는 조금이라도
           어긋나면 통째로 포기해 큰 구멍이 남았다.
      */
      const fill = (rect) => {
        const vis = out.filter((o) => !o.hidden);
        const inRows = (o) => o.y >= rect.y && o.y + o.h <= rect.y + rect.h;
        const inCols = (o) => o.x >= rect.x && o.x + o.w <= rect.x + rect.w;
        const west = vis.filter((o) => o.x + o.w === rect.x && inRows(o));
        if (west.length) { west.forEach((o) => { o.w += rect.w; }); return true; }
        const east = vis.filter((o) => o.x === rect.x + rect.w && inRows(o));
        if (east.length) { east.forEach((o) => { o.x -= rect.w; o.w += rect.w; }); return true; }
        const north = vis.filter((o) => o.y + o.h === rect.y && inCols(o));
        if (north.length) { north.forEach((o) => { o.h += rect.h; }); return true; }
        const south = vis.filter((o) => o.y === rect.y + rect.h && inCols(o));
        if (south.length) { south.forEach((o) => { o.y -= rect.h; o.h += rect.h; }); return true; }
        return false;
      };

      /* ★ 안전 상한. 못 메우는 조각이 남아도 무한 반복하지 않는다. */
      for (let guard = 0; guard < 400; guard++) {
        const rect = emptyRect();
        if (!rect) break;
        if (!fill(rect)) break;
      }
      return out;
    },

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
        /*
           ★★ '정확히 맞닿음' 을 요구하지 않는다.

             전에는 `other.x + other.w === target.x` 로 딱 붙은 경우만 이웃으로
             봤다. 그래서 이용자가 창 크기를 조절해 한 열이라도 틈이 생기면 접힘
             변환이 **사라지고** 화면이 갑자기 튀었다. 크기 조절이 접힘을 깨뜨리는
             원인이었다(실측으로 확인했다).

           ★ 왼쪽에 있고 행이 겹치는 것 중 **가장 가까운** 것을 고른다. 오른쪽 변이
             접힌 패널의 왼쪽 변을 넘지 않아야 한다(넘으면 이미 겹친 상태다).
        */
        let bestGap = Infinity;
        for (const other of out) {
          if (other === target || other.hidden) continue;
          const right = other.x + other.w;
          if (right > target.x) continue;           // 오른쪽에 있거나 이미 겹친다
          const overlap = Math.min(other.y + other.h, target.y + target.h) - Math.max(other.y, target.y);
          if (overlap <= 0) continue;               // 행이 겹치지 않으면 이웃이 아니다
          const gap = target.x - right;
          if (gap < bestGap || (gap === bestGap && overlap > bestOverlap)) {
            best = other; bestOverlap = overlap; bestGap = gap;
          }
        }
        if (!best) continue;

        /*
           ★★ **왼쪽 이웃 하나만 넓히면 구멍이 생긴다.**

             접힌 패널의 행 범위를 왼쪽에서 **여러 패널이 나눠 덮는** 경우가 있다.
             하나만 넓히면 나머지 행에는 아무것도 오지 않아 빈칸이 남는다.

             실제로 그랬다 — ai-workspace 에서 코파일럿은 y0-16 인데 왼쪽 차트는
             y0-11 뿐이어서, 접으면 y11-16 에 **빈칸 25칸**이 생겼다(채움 87%).

           ★ 그래서 `best` 와 **같은 거리에 있고 행이 겹치는** 패널을 모두 모아
             함께 넓힌다. 그 집합이 접힌 패널의 행 범위를 빈틈없이 덮을 때만
             적용한다 — 덮지 못하면 넓혀도 구멍이 남으므로 손대지 않는 것이 낫다.
        */
        const sameGap = out.filter((o) => o !== target && !o.hidden
          && target.x - (o.x + o.w) === bestGap
          && Math.min(o.y + o.h, target.y + target.h) - Math.max(o.y, target.y) > 0);

        /* 이 집합이 target 의 행 범위를 빈틈없이 덮는가. */
        const covered = (() => {
          const rows = sameGap
            .map((o) => [Math.max(o.y, target.y), Math.min(o.y + o.h, target.y + target.h)])
            .sort((a, b) => a[0] - b[0]);
          let edge = target.y;
          for (const [a, b] of rows) {
            if (a > edge) return false;      // 사이에 틈이 있다
            edge = Math.max(edge, b);
          }
          return edge >= target.y + target.h;
        })();

        /* 덮지 못하면 하나만 넓힌다(예전 동작) — 그래도 겹침 검사는 한다. */
        const grow = covered ? sameGap : [best];

        for (const g of grow) g.w += freed;
        target.x += freed;
        target.w = COLLAPSED_W;

        /*
           ★ 변환 결과가 겹치면 **전부** 되돌린다. 이 함수는 그리기 직전에 돌기
             때문에 여기서 겹치면 화면에 그대로 겹쳐 보인다.
        */
        const collide = out.some((a, i) => out.some((b, j) => j > i
          && !a.hidden && !b.hidden
          && !(a.x + a.w <= b.x || b.x + b.w <= a.x
            || a.y + a.h <= b.y || b.y + b.h <= a.y)));
        if (collide) {
          for (const g of grow) g.w -= freed;
          target.x -= freed;
          target.w = freed + COLLAPSED_W;
        }
      }

      return out;
    },
  };
})();
