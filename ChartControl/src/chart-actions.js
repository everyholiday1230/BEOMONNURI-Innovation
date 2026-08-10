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

  /** 해당 드로잉 도구를 현재 렌더러에서 쓸 수 있는지. */
  function isDrawToolAvailable(toolId) {
    if (toolId === 'cursor') return true;
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
          });
          return true;
        } catch (e) {
          console.warn('[ChartActions] 드로잉 시작 실패', toolId, e);
          return false;
        }
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
    MAGNET_MODES,
    isDrawToolAvailable,
    supportedOverlays,
  };
})();
