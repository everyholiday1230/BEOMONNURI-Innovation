/* =========================================================
   BEOMONNURI v5 — ANCHOR POSITIONING ENHANCEMENT
   - Auto-pairs [data-anchor="X"] elements with [data-popover-for="X"]
   - Injects rich popover content (mini charts, descriptions)
   - Provides JS fallback for browsers without native anchor positioning
   - Smart hover delay + click-to-pin
   ========================================================= */

const initAnchorPositioning = () => {
  const reduced = false; // Always run animations per client direction 2026-07.
  const isMobile = matchMedia('(hover: none), (max-width: 700px)').matches;
  if (isMobile) return;

  const supportsAnchor = CSS.supports('anchor-name', '--x');

  /* ==========================================================
     1. POPOVER DATABASE — content for each anchor
     ========================================================== */
  const popoverData = {
    'hud-latency': {
      label: '/ LATENCY · P95',
      value: '142', unit: 'ms',
      desc: '최근 30일 P95 응답 지연시간. 목표 200ms 이하 유지 중.',
      meta: { left: '30d avg', right: '<span class="ok">▲ within SLA</span>' },
      chartData: [180, 165, 172, 158, 161, 145, 152, 148, 155, 142, 138, 145, 142],
    },
    'hud-tps': {
      label: '/ THROUGHPUT',
      value: '3,847', unit: 'tok/s',
      desc: '초당 처리되는 토큰 수. 멀티-에이전트 워크로드 합산.',
      meta: { left: 'live · 1s tick', right: '<span class="ok">●</span> stable' },
      chartData: [3200, 3450, 3380, 3620, 3580, 3700, 3750, 3680, 3820, 3850, 3790, 3847],
    },
    'hud-uptime': {
      label: '/ UPTIME · 30D',
      value: '99.98', unit: '%',
      desc: 'KR-PRIVATE 운영 환경 가동률. 계획 정비 시간 제외.',
      meta: { left: '30d window', right: '<span class="ok">▲ green</span>' },
      chartData: [99.95, 100, 99.98, 100, 99.99, 100, 99.97, 100, 99.98, 99.99, 100, 99.98],
    },
    'hud-context': {
      label: '/ CONTEXT WINDOW',
      value: '128K', unit: 'tok',
      desc: '단일 추론에 입력 가능한 최대 토큰. 문서 약 320페이지 분량.',
      meta: { left: 'model v2.6', right: 'expandable' },
    },
    'hud-region': {
      label: '/ REGION',
      value: 'KR', unit: 'PRIVATE',
      desc: '국내 보안 환경 전용. 데이터 외부 유출 0건. 감사 로그 ed25519 서명.',
      meta: { left: 'compliance', right: '<span class="ok">●</span> verified' },
    },
    'hud-model': {
      label: '/ MODEL',
      value: 'v2.6', unit: '',
      desc: '범온 코어 v2.6. 산업 도메인 4개에 특화 미세조정.',
      meta: { left: 'released 2026.Q1', right: 'beomon-core' },
    },

    // INTEL metrics
    'intel-throughput': {
      label: '/ MODEL THROUGHPUT',
      value: '3,847', unit: 'tok/s',
      desc: 'P95 지연 186ms 이하 유지하며 측정. 멀티-테넌트 환경 합산.',
      meta: { left: '30d avg', right: '<span class="ok">▲</span> +12% MoM' },
      chartData: [60, 65, 58, 72, 68, 75, 78, 70, 82, 85, 79, 88, 85],
    },
    'intel-accuracy': {
      label: '/ SEARCH ACCURACY',
      value: '94', unit: '%',
      desc: '내부 문서 Top-3 검색 정확도. 정답이 상위 3건 안에 포함된 비율.',
      meta: { left: 'eval set: 1,240 q', right: 'rerank v3' },
      chartData: [78, 82, 85, 87, 86, 89, 90, 91, 92, 93, 93, 94, 94],
    },
    'intel-processing': {
      label: '/ PROCESSING TIME',
      value: '−68', unit: '%',
      desc: '도입 전 대비 평균 업무 처리시간 단축률. 7개 파일럿 평균.',
      meta: { left: 'baseline: pre-AI', right: 'verified' },
    },
    'intel-leakage': {
      label: '/ DATA LEAKAGE',
      value: '0', unit: '건',
      desc: '누적 운영 기간 전체에서 발생한 외부 유출 건수. RBAC + 감사 로그.',
      meta: { left: 'since launch', right: '<span class="ok">●</span> zero-trust' },
    },
  };

  /* ==========================================================
     2. AUTO-PAIRING — find existing anchors in the DOM and
     attach popovers
     ========================================================== */

  // First, mark existing HUD/intel values as anchors
  const wireExistingElements = () => {
    // Hero HUD rows
    const hudMap = {
      'hud-lat':     'hud-latency',
      'hud-tps':     'hud-tps',
      'hud-ctx':     'hud-context',
    };
    Object.keys(hudMap).forEach(domId => {
      const el = document.getElementById(domId);
      if (el) el.dataset.anchor = hudMap[domId];
    });

    // HUD rows (the "v" span within rows for static values)
    document.querySelectorAll('.hud .hud-row').forEach(row => {
      const k = row.querySelector('.k');
      const v = row.querySelector('.v');
      if (!k || !v) return;
      const kText = k.textContent.trim().toLowerCase();
      if (kText === 'uptime' && !v.dataset.anchor) v.dataset.anchor = 'hud-uptime';
      else if (kText === 'region' && !v.dataset.anchor) v.dataset.anchor = 'hud-region';
      else if (kText === 'model' && !v.dataset.anchor) v.dataset.anchor = 'hud-model';
    });

    // Intel cells
    document.querySelectorAll('.intel-cell').forEach((cell) => {
      const label = cell.querySelector('.ic-label');
      const value = cell.querySelector('.ic-value');
      if (!label || !value) return;
      const text = label.textContent;
      if (text.includes('THROUGHPUT')) value.dataset.anchor = 'intel-throughput';
      else if (text.includes('SEARCH')) value.dataset.anchor = 'intel-accuracy';
      else if (text.includes('PROCESSING')) value.dataset.anchor = 'intel-processing';
      else if (text.includes('LEAKAGE')) value.dataset.anchor = 'intel-leakage';
    });
  };

  wireExistingElements();

  const anchors = Array.from(document.querySelectorAll('[data-anchor]'));
  if (!anchors.length) return;

  /* ==========================================================
     3. CREATE POPOVER ELEMENTS
     ========================================================== */
  const popovers = new Map();
  anchors.forEach((anchor, idx) => {
    const key = anchor.dataset.anchor;
    const data = popoverData[key];
    if (!data) return;

    const anchorName = `--anchor-${idx}`;

    // Set anchor-name on the anchor element
    if (supportsAnchor) {
      anchor.style.anchorName = anchorName;
    }

    // Build popover DOM
    const pop = document.createElement('div');
    pop.className = 'info-popover';
    pop.dataset.popoverFor = key;
    if (supportsAnchor) {
      pop.style.positionAnchor = anchorName;
    }

    const chartHtml = data.chartData ? `<canvas class="ip-chart"></canvas>` : '';
    const metaHtml = data.meta ? `
      <div class="ip-meta">
        <span>${data.meta.left}</span>
        <span>${data.meta.right}</span>
      </div>` : '';

    pop.innerHTML = `
      <div class="ip-label">${data.label}</div>
      <div class="ip-value">${data.value}${data.unit ? `<span class="unit">${data.unit}</span>` : ''}</div>
      ${chartHtml}
      <div class="ip-desc">${data.desc}</div>
      ${metaHtml}
    `;
    document.body.appendChild(pop);
    popovers.set(anchor, { pop, data });

    // Draw chart if any
    if (data.chartData) {
      const canvas = pop.querySelector('canvas');
      // Wait for layout
      requestAnimationFrame(() => drawChart(canvas, data.chartData));
    }
  });

  /* ==========================================================
     4. CHART RENDERER (mini sparkline)
     ========================================================== */
  function drawChart(canvas, data) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) {
      // Popover not yet visible — use parent width
      const parent = canvas.parentElement;
      canvas.width = (parent.offsetWidth - 40) * dpr;
      canvas.height = 56 * dpr;
      canvas.style.height = '56px';
    } else {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    // Filled area
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h * 0.85) - h * 0.08;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(196,26,63,0.45)');
    grad.addColorStop(1, 'rgba(196,26,63,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.strokeStyle = '#c41a3f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h * 0.85) - h * 0.08;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last point dot
    const lastX = w;
    const lastY = h - ((data[data.length-1] - min) / range) * (h * 0.85) - h * 0.08;
    ctx.fillStyle = '#c41a3f';
    ctx.beginPath();
    ctx.arc(lastX - 3, lastY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(196,26,63,0.3)';
    ctx.beginPath();
    ctx.arc(lastX - 3, lastY, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ==========================================================
     5. HOVER LOGIC — open/close with smart delay
     ========================================================== */
  let openTimer, closeTimer, currentOpen;

  const positionFallback = (anchor, pop) => {
    if (supportsAnchor) return;
    // Manual positioning for browsers without anchor support
    const r = anchor.getBoundingClientRect();
    const pw = 280; // popover width
    const ph = pop.offsetHeight || 200;
    let x = r.left;
    let y = r.bottom + 12;
    // Flip if off-screen
    if (x + pw > innerWidth - 20) x = r.right - pw;
    if (y + ph > innerHeight - 20) y = r.top - ph - 12;
    pop.style.setProperty('--fb-x', x + 'px');
    pop.style.setProperty('--fb-y', y + 'px');
  };

  const openPopover = (anchor) => {
    const item = popovers.get(anchor);
    if (!item) return;
    if (currentOpen && currentOpen !== item.pop) {
      currentOpen.classList.remove('open');
    }
    positionFallback(anchor, item.pop);
    item.pop.classList.add('open');
    currentOpen = item.pop;

    // Redraw chart now that popover is visible
    const canvas = item.pop.querySelector('canvas');
    if (canvas && item.data.chartData) {
      requestAnimationFrame(() => drawChart(canvas, item.data.chartData));
    }
  };

  const closePopover = (pop) => {
    if (!pop) return;
    pop.classList.remove('open');
    if (currentOpen === pop) currentOpen = null;
  };

  anchors.forEach(anchor => {
    const item = popovers.get(anchor);
    if (!item) return;
    const pop = item.pop;

    anchor.addEventListener('mouseenter', () => {
      clearTimeout(closeTimer);
      openTimer = setTimeout(() => openPopover(anchor), 180);
    });
    anchor.addEventListener('mouseleave', () => {
      clearTimeout(openTimer);
      closeTimer = setTimeout(() => closePopover(pop), 320);
    });
    anchor.addEventListener('focus', () => openPopover(anchor));
    anchor.addEventListener('blur', () => closePopover(pop));

    // Keep open while hovering the popover itself
    pop.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    pop.addEventListener('mouseleave', () => {
      closeTimer = setTimeout(() => closePopover(pop), 200);
    });
  });

  // Close on scroll (popovers don't follow scroll without anchor support)
  if (!supportsAnchor) {
    addEventListener('scroll', () => {
      if (currentOpen) closePopover(currentOpen);
    }, { passive: true });
  }

  // Close on outside click
  document.addEventListener('click', e => {
    if (currentOpen &&
        !e.target.closest('.info-popover') &&
        !e.target.closest('[data-anchor]')) {
      closePopover(currentOpen);
    }
  });

  // Log to console
  console.log(
    `%c◉ Anchor Positioning: ${supportsAnchor ? 'native' : 'JS fallback'} · ${anchors.length} anchors`,
    'color:#921230;font-weight:bold'
  );
};

// Run once DOM is ready (handles late-loading scripts + race conditions)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnchorPositioning);
} else {
  // DOM already parsed — run on next frame so other v5 scripts finish first
  requestAnimationFrame(initAnchorPositioning);
}
