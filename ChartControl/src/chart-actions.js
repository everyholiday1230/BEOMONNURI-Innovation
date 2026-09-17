/* ============================================================
   Chart Actions — 차트 툴바/드로잉 버튼의 실제 동작
   ------------------------------------------------------------
   디자이너가 만든 버튼은 마크업을 그대로 두고, 동작만 여기서 제공한다.
   KLineChart API 를 이 파일에 모아 두는 이유:
     · 렌더러가 바뀌어도 버튼 쪽 코드를 고치지 않는다
     · 각 동작이 "실제로 무엇을 하는지" 한 곳에서 읽힌다

   하드코딩 금지 원칙 적용:
     · 문자열은 전부 i18n 사전에서 가져온다
     · 드로잉 도구 매핑은 KLineChart 가 지원하는 오버레이와 런타임 대조한다
       (지원하지 않는 도구는 자동으로 비활성 처리되며 목록에서 사라지지 않는다)
     · 파일명·확장자 같은 값도 사전/상수에서 가져온다
   ============================================================ */

(function () {
  'use strict';

  const KL = window.klinecharts;
  const I18n = window.QTI18n;
  const t = (k, v) => (I18n ? I18n.t(k, v) : k);

  /**
   * 디자이너 드로잉 도구 id -> KLineChart 내장 오버레이 이름.
   *
   * 우리 커스텀 오버레이(qt*)는 AI 신호 표현용이고, 사용자가 직접 그리는
   * 도구는 KLineChart 내장을 쓴다. 내장은 그리기 단계(클릭 순서), 자석,
   * 편집 핸들이 이미 구현되어 있어 우리가 다시 만들 이유가 없다.
   *
   * 'cursor' 는 그리기 도구가 아니므로 매핑하지 않는다.
   */
  const DRAW_TOOL_OVERLAY = {
    'trend-line': 'segment',
    horizontal: 'horizontalStraightLine',
    fib: 'fibonacciLine',
    // 롱·숏은 자체 오버레이다. KLineChart 에 포지션 도구가 없어서,
    // 예전에는 priceChannelLine(가격채널)에 연결해 두었다 — 버튼 이름과
    // 그려지는 도형이 달라 오해를 만들었다. 진입/목표/손절 3점 + 손익비를 그린다.
    long: 'qtLongPosition',
    short: 'qtShortPosition',
    measure: 'priceLine',
    text: 'simpleAnnotation',
  };

  /** 자석 모드 순환. KLineChart 가 지원하는 값만 쓴다. */
  const MAGNET_MODES = ['normal', 'weak_magnet', 'strong_magnet'];

  function supportedOverlays() {
    try {
      return KL && typeof KL.getSupportedOverlays === 'function' ? KL.getSupportedOverlays() : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 클릭으로 가격을 찍는 도구 — KLineChart 오버레이가 아니다.
   *
   * ★ TP/SL 은 도형을 그리는 것이 아니라 **주문 패널의 값**을 정한다. 그래서
   *   `DRAW_TOOL_OVERLAY` 에 넣지 않는다. 넣으면 `isDrawToolAvailable` 이
   *   klinecharts 지원 목록에서 찾다가 실패해 버튼이 비활성으로 보인다.
   */
  const PRICE_PICK_TOOLS = ['tp', 'sl'];

  /** 해당 드로잉 도구를 현재 렌더러에서 쓸 수 있는지. */
  function isDrawToolAvailable(toolId) {
    if (toolId === 'cursor') return true;
    /* 가격 찍기는 좌표 변환만 쓰므로 오버레이 지원 여부와 무관하다. */
    if (PRICE_PICK_TOOLS.includes(toolId)) return true;
    const name = DRAW_TOOL_OVERLAY[toolId];
    if (!name) return false;
    return supportedOverlays().includes(name);
  }

  /**
   * 차트 액션 묶음을 만든다.
   * @param {() => object|null} getChart  KLineChart 인스턴스 접근자
   * @param {object} [opts]
   * @param {() => HTMLElement|null} [opts.getContainer] 전체화면 대상 요소
   * @param {(msg: {title:string, desc?:string, variant?:string}) => void} [opts.notify]
   */
  function createChartActions(getChart, opts = {}) {
    const { getContainer, notify, getSymbol } = opts;

    /**
     * 현재 심볼의 가격 소수점 자리수.
     *
     * widgets.jsx 의 tickSize 계산을 재사용한다. 자리수 계산을 두 곳에서 따로 하면
     * 화면의 호가와 도형의 가격 라벨이 다른 자리수로 표시된다.
     */
    function priceDecimals() {
      try {
        const fmt = window.QTFmt;
        const symbol = typeof getSymbol === 'function' ? getSymbol() : null;
        if (fmt && symbol && typeof fmt.tickSizeFor === 'function' && typeof fmt.decimalsForTick === 'function') {
          return fmt.decimalsForTick(fmt.tickSizeFor(symbol));
        }
      } catch (e) { /* 알 수 없으면 아래 기본값 */ }
      return 2;
    }

    const toast = (titleKey, descKey, variant) => {
      if (!notify) return;
      notify({
        title: t(titleKey),
        desc: descKey ? t(descKey) : undefined,
        variant: variant || 'info',
      });
    };

    /** 사용자가 그린 오버레이만 대상으로 한다 (AI 신호는 제외). */
    /**
     * 사용자가 직접 그린 도형만 고른다. AI 신호·주문선·포지션선은 제외한다.
     *
     * 판단 근거를 두 번 바꿨다. 그 이유를 남긴다.
     *   1차: 이름이 'qt' 로 시작하면 시스템 것으로 봤다.
     *        → 자체 오버레이를 사용자 도구로 추가한 순간 깨졌다
     *          (롱·숏 포지션 도구가 숨김·삭제에서 조용히 빠졌다).
     *   2차: source 가 알려진 시스템 값이면 제외했다.
     *        → 실제 source 값은 'order', 'position-long', 'ai-approved', 'ai-draft' 등
     *          여러 개였고, 목록에서 빠진 값이 사용자 도형으로 오인돼 삭제됐다.
     *   현재: **우리가 그리기 도구로 만든 것만** 표시해 두고 그것만 대상으로 한다.
     *        추측하지 않는다. 목록을 관리하지 않아도 새 도구가 자동으로 포함된다.
     */
    const USER_DRAW_SOURCE = 'user-draw';

    const userOverlays = (chart) => {
      try {
        return chart.getOverlays().filter((o) => {
          const src = o && o.extendData && o.extendData.source;
          if (src === USER_DRAW_SOURCE) return true;
          // 표시가 없는 도형: KLineChart 내장 이름이면 사용자가 그린 것으로 본다.
          // (이 변경 전에 그려진 도형이 지워지지 않는 상태로 남는 것을 막는다)
          return !src && !String(o.name || '').startsWith('qt');
        });
      } catch (e) {
        return [];
      }
    };

    return {
      // -----------------------------------------------------------
      // 드로잉
      // -----------------------------------------------------------

      /**
       * 드로잉 도구 선택. KLineChart 는 "그리기 시작"을 오버레이 생성으로 표현하며,
       * 사용자가 필요한 점을 클릭하면 완성된다.
       */
      startDrawing(toolId, magnetMode) {
        const chart = getChart();
        if (!chart) return false;
        if (toolId === 'cursor') return true;
        /*
           ★ TP/SL 은 도형이 아니라 **가격 값**을 정하는 도구다. 여기서 오버레이를
             만들려 하면 매핑이 없어 'draw_tool_unavailable' 토스트가 뜬다.
             호출부(app.jsx pickTool)가 armPricePick 을 쓰도록 갈라 두었지만,
             여기서도 조용히 통과시켜 두 경로가 어긋나도 오작동하지 않게 한다.
        */
        if (PRICE_PICK_TOOLS.includes(toolId)) return true;

        const name = DRAW_TOOL_OVERLAY[toolId];
        if (!name || !supportedOverlays().includes(name)) {
          toast('draw_tool_unavailable', undefined, 'warning');
          return false;
        }
        try {
          chart.createOverlay({
            name,
            // 자석 모드를 그리기에 반영한다. 캔들 고저가에 정확히 붙는다.
            mode: magnetMode && MAGNET_MODES.includes(magnetMode) ? magnetMode : 'normal',
            /*
               가격 표시 자리수를 넘긴다. 없으면 오버레이가 부동소수를 그대로 그려서
               '64283.04431256001' 처럼 보인다(실제로 확인했다).
               심볼별 tickSize 에서 계산한다 — BTC(0.1)와 DOGE(0.00001)가 다르다.
            */
            // 우리가 그리기 도구로 만든 도형임을 표시한다. 숨김·잠금·삭제가
            // 이 표시를 근거로 대상을 고른다 (AI 신호·주문선은 건드리지 않는다).
            extendData: { decimals: priceDecimals(), source: USER_DRAW_SOURCE },
            /*
               ★★ 수평선을 클릭하면 **가격을 숫자로 입력**할 수 있게 한다.

                 마우스로 끌어 맞추면 원하는 값에 정확히 못 세운다. 지지·저항선은
                 "68,400" 같은 딱 떨어지는 값에 두고 싶은데 드래그로는 68,412 처럼
                 어긋나고, 그 선을 기준으로 만든 주문 초안도 함께 어긋난다.

               ★ 수평선만 대상이다. 추세선·피보나치는 점이 둘 이상이라 숫자 하나로
                 정할 수 없다.

               ★ 여기서 창을 직접 만들지 않는다. 이벤트를 올려보내 화면이 띄우게 한다 —
                 이 파일은 KLineChart API 를 감싸는 곳이고 DOM 을 만들지 않는다.
            */
            onClick: (event) => {
              if (name !== 'horizontalStraightLine') return false;
              const ov = event && event.overlay;
              const pt = ov && ov.points && ov.points[0];
              try {
                window.dispatchEvent(new CustomEvent('qt:hline-click', {
                  detail: {
                    overlayId: ov ? ov.id : null,
                    value: pt && pt.value != null ? pt.value : null,
                    decimals: priceDecimals(),
                  },
                }));
              } catch (e) { /* 이벤트 실패가 차트를 막지 않는다 */ }
              return false;
            },
          });
          return true;
        } catch (e) {
          console.warn('[ChartActions] 드로잉 시작 실패', toolId, e);
          return false;
        }
      },

      /**
       * ★★★ **차트를 클릭해 TP/SL 가격을 정한다.**
       *
       *   운영자 요청: "차트에서 드래그로 TP SL 모두 설정할 수 있도록."
       *
       *   지금까지는 주문 패널에 값을 **먼저 입력해야** 선이 나타났고, 그 뒤에만
       *   끌어 옮길 수 있었다. 즉 드래그로 **옮기기**는 됐지만 **설정**은 안 됐다.
       *
       * ★★ 기본값(예: ±2%)을 만들어 선을 띄우지 않는다. 그건 이용자가 정하지 않은
       *   가격을 화면에 진짜처럼 보여주는 것이고, 이 저장소가 명시적으로 거부해 온
       *   방식이다(app.jsx visibleOverlays 주석). 대신 **한 번의 클릭으로 첫 값을
       *   받는다** — 이용자가 고른 가격이므로 지어낸 값이 아니다.
       *
       * ★ 한 번만 받고 스스로 해제한다(one-shot). 켜진 채로 두면 다음 클릭이
       *   의도하지 않은 값을 덮어쓴다.
       *
       * ★ 캔버스의 `offsetY` 를 쓴다. 화면 좌표에서 rect 를 빼는 계산을 하면
       *   스크롤·확대 상태에서 어긋난다. 캔버스 상대 좌표가 곧 차트 좌표다
       *   (실측: value 68432.5 → y 86 → 되돌리면 68435.5, 1픽셀 오차).
       *
       * @param {'tp'|'sl'} kind
       * @returns {() => void} 해제 함수. 도구를 바꾸거나 Esc 를 누르면 호출한다.
       */
      armPricePick(kind) {
        const chart = getChart();
        if (!chart) return null;

        /*
           ★★★ **리스너는 컨테이너에 붙인다 — 캔버스가 아니다.**

             KLineChart 는 패널마다 캔버스를 **여러 장 겹쳐** 놓는다(실측: 캔들 패널에
             2장, Y축에 2장). 그래서 캔버스 하나에 리스너를 붙이면 클릭이 **맨 위
             캔버스**로 가고, 형제인 내 캔버스에는 capture 로도 오지 않는다
             (capture 는 조상 사슬만 타고, 형제는 사슬이 아니다).
             실제로 그렇게 붙였다가 클릭이 한 번도 잡히지 않았다.

           ★ 그래서 조상인 컨테이너에 붙이고, 좌표는 **캔들 패널 캔버스의 rect** 를
             기준으로 계산한다.
        */
        const container = (typeof getContainer === 'function' ? getContainer() : null);
        if (!container) {
          toast('draw_tool_unavailable', undefined, 'warning');
          return null;
        }

        /** 캔들 패널 캔버스 — 컨테이너 안에서 가장 큰 것. */
        const paneRect = () => {
          const best = [...container.querySelectorAll('canvas')]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.height > 80 && r.width > 80)
            .sort((a, b) => (b.height * b.width) - (a.height * a.width))[0];
          return best || null;
        };

        let done = false;
        const prevCursor = container.style.cursor;
        /* 십자선으로 "지금 가격을 찍는 중" 을 알린다. */
        container.style.cursor = 'crosshair';

        /*
           ★★★ **`click` 의 좌표를 쓰지 않는다 — 터치에서 (0,0) 으로 온다.**

             실측(모바일 뷰포트, 390×844): 손가락 탭으로 합성된 `click` 이
             `clientX=0, clientY=0` 으로 도착했다. 그래서 "패널 안쪽 클릭만 받는다"
             검사가 걸러내고, **터치에서는 TP/SL 을 찍을 수 없었다.**
             마우스 클릭은 같은 좌표에서 정상 동작했으므로 데스크톱만 검증했을 때는
             보이지 않는 결함이었다.

           ★ 그래서 좌표는 `pointerdown` 에서 받는다 — 마우스·터치·펜 모두 정확하다.
             그리고 `pointerup` 에서 "거의 움직이지 않았으면" 탭으로 보고 확정한다.

           ★★ 이 방식은 부수 효과로 **팬을 빼앗지 않는다.** 손가락을 끌면(TAP_SLOP
             초과) 찍지 않고 차트 팬으로 남겨 둔다. `click` 을 쓰면 끌고 놓아도
             click 이 발생해 의도치 않은 값이 들어갈 수 있다.
        */
        const TAP_SLOP = 10;   // 이 이상 움직이면 탭이 아니라 드래그로 본다
        let press = null;      // { id, x, y, inside }

        const off = () => {
          if (done) return;
          done = true;
          container.removeEventListener('pointerdown', onDown, true);
          container.removeEventListener('pointerup', onUp, true);
          container.removeEventListener('pointercancel', onCancel, true);
          container.style.cursor = prevCursor;
        };

        function onDown(ev) {
          const r = paneRect();
          if (!r) return;
          const inside = ev.clientY >= r.top && ev.clientY <= r.bottom
            && ev.clientX >= r.left && ev.clientX <= r.right;
          press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, inside, top: r.top };
        }

        function onCancel() { press = null; }

        function onUp(ev) {
          const p = press;
          press = null;
          if (!p || p.id !== ev.pointerId) return;
          /*
             ★ 패널 밖에서 시작한 것은 무시하고 **모드를 유지한다** — 툴바를 스쳤다고
               도구가 꺼지면 이용자는 왜 꺼졌는지 알 수 없다.
          */
          if (!p.inside) return;
          /* 끌었으면 탭이 아니다 → 팬으로 남겨 둔다. */
          if (Math.abs(ev.clientX - p.x) > TAP_SLOP || Math.abs(ev.clientY - p.y) > TAP_SLOP) return;

          const c = getChart();
          if (!c) { off(); return; }
          let value = null;
          try {
            const got = c.convertFromPixel({ y: p.y - p.top }, { paneId: 'candle_pane' });
            value = got && Number.isFinite(got.value) ? got.value : null;
          } catch (e) { value = null; }
          off();
          /*
             ★ 값을 못 읽으면 조용히 넘기지 않는다. 이용자는 눌렀는데 아무 일도
               일어나지 않은 것을 "고장" 으로 읽는다.
          */
          if (value === null || value <= 0) {
            toast('chart_hline_bad', undefined, 'warning');
            return;
          }
          try {
            window.dispatchEvent(new CustomEvent('qt:price-pick', {
              detail: { kind, value, decimals: priceDecimals() },
            }));
          } catch (e) { /* 이벤트 실패가 차트를 막지 않는다 */ }
        }

        container.addEventListener('pointerdown', onDown, true);
        container.addEventListener('pointerup', onUp, true);
        container.addEventListener('pointercancel', onCancel, true);
        return off;
      },

      /** 사용자 드로잉 전체 삭제. AI 신호 오버레이는 남긴다. */
      removeAllDrawings() {
        const chart = getChart();
        if (!chart) return 0;
        const list = userOverlays(chart);
        for (const o of list) {
          try { chart.removeOverlay({ id: o.id }); } catch (e) { /* noop */ }
        }
        toast(list.length ? 'drawings_removed' : 'drawings_none', undefined, list.length ? 'success' : 'info');
        return list.length;
      },

      /** 드로잉 잠금 토글. 잠기면 드래그로 움직이지 않는다. */
      setDrawingsLocked(locked) {
        const chart = getChart();
        if (!chart) return 0;
        const list = userOverlays(chart);
        for (const o of list) {
          try { chart.overrideOverlay({ id: o.id, lock: locked }); } catch (e) { /* noop */ }
        }
        toast(locked ? 'drawings_locked' : 'drawings_unlocked');
        return list.length;
      },

      /** 드로잉 표시/숨김 토글. */
      setDrawingsVisible(visible) {
        const chart = getChart();
        if (!chart) return 0;
        const list = userOverlays(chart);
        for (const o of list) {
          try { chart.overrideOverlay({ id: o.id, visible }); } catch (e) { /* noop */ }
        }
        toast(visible ? 'drawings_shown' : 'drawings_hidden');
        return list.length;
      },

      /** 자석 모드 순환: 없음 -> 약 -> 강 -> 없음 */
      cycleMagnet(current) {
        const idx = MAGNET_MODES.indexOf(current);
        const next = MAGNET_MODES[(idx + 1) % MAGNET_MODES.length];
        toast(`magnet_${next}`);
        return next;
      },

      // -----------------------------------------------------------
      // 화면
      // -----------------------------------------------------------

      /** 스크린샷 저장. KLineChart 가 캔버스를 합성해 dataURL 로 준다. */
      screenshot(meta = {}) {
        const chart = getChart();
        if (!chart) return false;
        try {
          const url = chart.getConvertPictureUrl(true, 'jpeg', meta.background);
          if (!url) return false;
          const parts = [meta.symbol, meta.timeframe, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')]
            .filter(Boolean)
            .map((s) => String(s).replace(/[^\w.-]+/g, '_'));
          const a = document.createElement('a');
          a.href = url;
          a.download = `${parts.join('_') || 'chart'}.jpeg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast('screenshot_saved', undefined, 'success');
          return true;
        } catch (e) {
          console.warn('[ChartActions] 스크린샷 실패', e);
          toast('screenshot_failed', undefined, 'error');
          return false;
        }
      },

      /** 전체화면 토글. */
      async toggleFullscreen() {
        const el = getContainer && getContainer();
        if (!el) return false;
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return false;
          }
          await el.requestFullscreen();
          // 전체화면 전환 후 캔버스 크기를 다시 잡아야 한다.
          setTimeout(() => {
            const chart = getChart();
            if (chart) { try { chart.resize(); } catch (e) { /* noop */ } }
          }, 120);
          return true;
        } catch (e) {
          console.warn('[ChartActions] 전체화면 실패', e);
          toast('fullscreen_failed', undefined, 'warning');
          return false;
        }
      },

      /** 최신 캔들로 스크롤. */
      scrollToLatest() {
        const chart = getChart();
        if (!chart) return false;
        try { chart.scrollToRealTime(); return true; } catch (e) { return false; }
      },

      isFullscreen() {
        return Boolean(document.fullscreenElement);
      },
    };
  }

  window.ChartActions = {
    create: createChartActions,
    DRAW_TOOL_OVERLAY,
    PRICE_PICK_TOOLS,
    MAGNET_MODES,
    isDrawToolAvailable,
    supportedOverlays,
  };
})();
