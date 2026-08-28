/* =========================================================
   BEOMONNURI — AI FRONTIER v4 INTERACTIVE LAYER
   - GLSL Shader Neural Field (Three.js)
   - Partner logo marquee
   - Magnetic Cards
   - Scroll reveal
   - Anchor smooth scroll
   ========================================================= */

/* ---------- UTILITIES ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));

/* ---------- 모션 환경설정 게이트 (WCAG 2.3.3 / 2.2.2) ----------
   전정장애 사용자가 자동재생 애니메이션을 끌 수 있도록 모션 on/off 상태를 한 곳에서
   관리한다. 우선순위: 사용자 명시 선택(localStorage) > OS prefers-reduced-motion 설정.
   <html data-motion="on|off"> 속성으로 반영해 CSS/JS 양쪽에서 제어 가능하게 하고,
   window.BN_MOTION = { isOff(), toggle(), subscribe(fn) } 를 공개한다. */
(() => {
  const STORAGE_KEY = 'bn-motion';
  const root = document.documentElement;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const subs = [];

  const stored = () => {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  };
  // 저장된 사용자 선택이 있으면 그것을 우선하고, 없으면 OS 설정을 따른다.
  const computeOff = () => {
    const s = stored();
    if (s === 'on') return false;
    if (s === 'off') return true;
    return mq.matches;
  };

  let off = computeOff();

  const apply = () => { root.setAttribute('data-motion', off ? 'off' : 'on'); };
  apply();

  const notify = () => { subs.forEach(fn => { try { fn(off); } catch (e) {} }); };

  const setOff = (next, persist) => {
    off = !!next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, off ? 'off' : 'on'); } catch (e) {}
    }
    apply();
    notify();
  };

  // OS 설정이 바뀌면, 사용자가 아직 명시적으로 선택하지 않은 경우에만 따라간다.
  const onMq = () => { if (stored() === null) setOff(mq.matches, false); };
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);

  window.BN_MOTION = {
    isOff: () => off,
    toggle: () => { setOff(!off, true); return off; },
    subscribe: (fn) => {
      if (typeof fn === 'function') { subs.push(fn); fn(off); }
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
  };
})();

// 초기 렌더 시점의 모션 OFF 여부. 무거운 WebGL 초기화를 건너뛰는 게이트로 쓰인다.
// (런타임 일시정지/재개는 각 rAF 루프가 window.BN_MOTION.isOff()를 매 프레임 확인한다.)
const reduced = !!(window.BN_MOTION && window.BN_MOTION.isOff());
// 매 프레임 조회용 헬퍼 — rAF 루프가 모션 상태에 즉시 반응하도록 한다.
const motionOff = () => !!(window.BN_MOTION && window.BN_MOTION.isOff());

/* 모션 정지/재생 토글 버튼은 제거했다(2026-08-28, 운영 요청).
   애니메이션은 기본적으로 자동 재생한다.
   단, OS 의 "동작 줄이기(prefers-reduced-motion: reduce)" 설정이 켜진 사용자에게는
   BN_MOTION 게이트가 여전히 애니메이션을 끈다(WCAG 2.3.3 존중, 전정장애 배려).
   이 판단은 OS 설정만으로 이뤄지며, 화면에는 어떤 컨트롤도 노출하지 않는다. */

/* ---------- SMOOTH SCROLL ----------
   We intentionally use NATIVE scroll. CSS `scroll-behavior: smooth` is enabled
   on demand for anchor jumps only. This avoids breaking iframes / preview tooling. */
(() => {
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (id === '#' || id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  });
})();

/* ---------- PARTNER LOGO MARQUEE ----------
   파트너 공식 로고 이미지 렌더링 (텍스트 라벨 제거: 로고만 노출). */
(() => {
  const partners = [
    { id: 'mss', alt: '중소벤처기업부 공식 로고', src: 'assets/img/logos/partners/mss.png', webp: 'assets/img/logos/partners/mss.webp' },
    { id: 'moel', alt: '고용노동부 공식 로고', src: 'assets/img/logos/partners/moel.png', webp: 'assets/img/logos/partners/moel.webp' },
    { id: 'gov-gg', alt: '경기도경제과학진흥원 공식 로고', src: 'assets/img/logos/partners/gbsa.png', webp: 'assets/img/logos/partners/gbsa.webp' },
    { id: 'korcham', alt: '대한상공회의소 공식 로고', src: 'assets/img/logos/partners/korcham.png' },
    { id: 'startup', alt: '모두의창업 공식 로고', src: 'assets/img/logos/partners/modoo-startup.png' },
    { id: 'inv-posco', alt: '포스코기술투자 공식 로고', src: 'assets/img/logos/partners/posco-technology-investment.png' },
    { id: 'fin-nh', alt: '농협 공식 로고', src: 'assets/img/logos/partners/nonghyup.png', webp: 'assets/img/logos/partners/nonghyup.webp' },
    { id: 'youth-foundation', alt: '청년재단 공식 로고', src: 'assets/img/logos/partners/youth-foundation.png', webp: 'assets/img/logos/partners/youth-foundation.webp' },
    { id: 'edu-dku', alt: '단국대학교 공식 로고', src: 'assets/img/logos/partners/dankook-university.png', webp: 'assets/img/logos/partners/dankook-university.webp' },
    /* TEMP-HIDDEN(LOCALMOTIVE / 2026-08-04): 재노출 시 아래 한 줄의 주석만 해제
    { id: 'localmotive', alt: '(주)로컬모티브 공식 로고', src: 'assets/img/logos/partners/localmotive.png', webp: 'assets/img/logos/partners/localmotive.webp' },
    */
    { id: 'lab-knl', alt: '한국나노분석랩 공식 로고', src: 'assets/img/logos/partners/knal-kor.png', webp: 'assets/img/logos/partners/knal-kor.webp' },
    { id: 'kiss', alt: '강동 K-ISS 멘토링센터 공식 로고', src: 'assets/img/logos/partners/gangdong-kiss.png' },
  ];

  // WebP를 우선 제공하고 PNG로 폴백한다. data-webp는 3D 실린더(v5-nextgen.js)가
  // 같은 소스를 재사용할 때 읽는다.
  // 파트너 로고 원본(PNG) 실측 크기 — CLS 방지를 위해 <img>에 width/height를 명시한다.
  // (assets/img/logos/partners/*.png 를 PIL로 조사한 실제 픽셀값. CSS가 표시 크기를
  //  제어하므로 여기 값은 종횡비 박스 예약 용도이다.)
  const LOGO_DIMS = {
    'mss':              { w: 960,  h: 750 },
    'moel':             { w: 960,  h: 960 },
    'gov-gg':           { w: 844,  h: 297 },
    'korcham':          { w: 410,  h: 165 },
    'startup':          { w: 1024, h: 342 },
    'inv-posco':        { w: 400,  h: 133 },
    'fin-nh':           { w: 1280, h: 410 },
    'youth-foundation': { w: 1200, h: 360 },
    'edu-dku':          { w: 500,  h: 500 },
    'localmotive':      { w: 443,  h: 101 },
    'lab-knl':          { w: 710,  h: 473 },
    'kiss':             { w: 1015, h: 132 },
  };
  const imgHtml = (p) => {
    const d = LOGO_DIMS[p.id];
    const wh = d ? ` width="${d.w}" height="${d.h}"` : '';
    return `<img class="logo-mark logo-${p.id}" src="${p.src}" alt="${p.alt}"` +
      wh +
      (p.webp ? ` data-webp="${p.webp}"` : '') +
      ` loading="eager" decoding="async" referrerpolicy="no-referrer" />`;
  };

  const itemHtml = (p) => `
    <div class="pm-item" data-partner-id="${p.id}">
      ${p.webp
        ? `<picture><source type="image/webp" srcset="${p.webp}">${imgHtml(p)}</picture>`
        : imgHtml(p)}
    </div>`;

  const track = $('#partner-marquee-track');
  if (!track) return;
  const html = partners.map(itemHtml).join('');
  // Duplicate for seamless loop
  track.innerHTML = html + html;

  // Drive the scroll via requestAnimationFrame instead of the CSS
  // `pm-scroll` animation. Some browsers/GPU driver combos stall CSS
  // transform animations on long-lived elements, leaving the marquee
  // visibly frozen (seen on the hero cylinder too). Manual rAF control
  // is more reliable across environments and pauses when tab is hidden.
  const SCROLL_SPEED_PX_PER_MS = 0.045; // ~ matches previous 50s/track-width feel
  let marqueeVisible = true;
  document.addEventListener('visibilitychange', () => {
    marqueeVisible = !document.hidden;
  });
  let marqueeHovered = false;
  const marqueeEl = track.closest('.partner-marquee');
  if (marqueeEl) {
    marqueeEl.addEventListener('mouseenter', () => { marqueeHovered = true; });
    marqueeEl.addEventListener('mouseleave', () => { marqueeHovered = false; });
  }

  const startMarqueeScroll = () => {
    let offset = 0;
    let halfWidth = track.scrollWidth / 2;
    let last = null;
    const step = (now) => {
      if (!marqueeVisible || marqueeHovered || motionOff()) {
        last = null;
        requestAnimationFrame(step);
        return;
      }
      if (last === null) last = now;
      const dt = now - last;
      last = now;
      // Re-measure in case images finished loading and changed width.
      if (track.scrollWidth > 0) halfWidth = track.scrollWidth / 2;
      offset += SCROLL_SPEED_PX_PER_MS * dt;
      if (halfWidth > 0 && offset >= halfWidth) offset -= halfWidth;
      track.style.transform = `translateX(${-offset}px)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Only animate marquees that are actually visible (skip the hidden
  // index.html source track used solely to feed the 3D cylinder).
  if (getComputedStyle(track.closest('.partner-marquee') || track).display !== 'none') {
    startMarqueeScroll();
  }
})();

/* ---------- BEAM TRACKING (radial gradient follows mouse) ---------- */
(() => {
  if (matchMedia('(hover: none)').matches) return;
  const hero = $('.hero');
  if (!hero) return;
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    hero.style.setProperty('--beam-x', x + '%');
    hero.style.setProperty('--beam-y', y + '%');
  });
})();

/* ---------- MAGNETIC SVC CARDS ---------- */
(() => {
  $$('.svc, .hb-cell').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      card.style.setProperty('--mouse-x', x + '%');
      card.style.setProperty('--mouse-y', y + '%');
      card.style.setProperty('--beam-x', x + '%');
      card.style.setProperty('--beam-y', y + '%');
    });
  });
})();

/* ---------- SCROLL REVEAL (IntersectionObserver) ----------
   Defense-in-depth: content is visible by default. We only ARM (hide-then-lift)
   elements that are below the fold at first paint. If reduced motion or no IO support,
   nothing gets armed — everything stays visible. */
(() => {
  const reveals = $$('.reveal');
  if (!reveals.length) return;

  if (reduced || !('IntersectionObserver' in window)) {
    // Nothing to do — content stays visible.
    return;
  }

  // Arm only elements that start below the fold.
  const fold = innerHeight;
  const toArm = [];
  reveals.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top >= fold) toArm.push(el);
  });
  toArm.forEach(el => el.classList.add('armed'));

  if (!toArm.length) return;

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px 200px 0px' });

  toArm.forEach(el => io.observe(el));

  // Safety net: 2s after load, force-reveal any armed element that's still not `.in`.
  setTimeout(() => {
    $$('.reveal.armed:not(.in)').forEach(el => el.classList.add('in'));
  }, 2000);
})();

/* ---------- HERO 3D NEURAL FIELD (Three.js + GLSL) ---------- */
(() => {
  if (typeof THREE === 'undefined') return;
  if (reduced) return;
  const canvas = $('#hero-canvas');
  const hero = $('.hero');
  if (!canvas || !hero) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 16);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const resize = () => {
    const w = hero.offsetWidth, h = hero.offsetHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  addEventListener('resize', resize);

  // --- Particles with shader material ---
  const NODE_COUNT = 380;
  const positions = new Float32Array(NODE_COUNT * 3);
  const offsets = new Float32Array(NODE_COUNT);
  const sizes = new Float32Array(NODE_COUNT);

  for (let i = 0; i < NODE_COUNT; i++) {
    // Distribute in a sphere shell
    const phi = Math.acos(1 - 2 * Math.random());
    const theta = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 4;
    positions[i*3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i*3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i*3 + 2] = r * Math.cos(phi) * 0.6;
    offsets[i] = Math.random() * Math.PI * 2;
    sizes[i] = 0.6 + Math.random() * 1.4;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const vertexShader = `
    attribute float aOffset;
    attribute float aSize;
    uniform float uTime;
    uniform vec2 uMouse;
    varying float vAlpha;
    varying float vDist;

    void main() {
      vec3 p = position;
      // Subtle breathing
      float breathe = sin(uTime * 0.5 + aOffset) * 0.3;
      p *= 1.0 + breathe * 0.04;
      // Mouse attraction — pull toward camera projection
      vec3 mouseWorld = vec3(uMouse * 6.0, 0.0);
      vec3 toMouse = mouseWorld - p;
      float dist = length(toMouse);
      float force = smoothstep(8.0, 0.0, dist) * 0.6;
      p += normalize(toMouse) * force;
      vDist = dist;

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = aSize * (200.0 / -mvPosition.z) * (1.0 + force * 1.5);
      vAlpha = 0.4 + force * 0.6 + sin(uTime + aOffset) * 0.1;
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying float vAlpha;
    varying float vDist;
    uniform vec3 uColorA;
    uniform vec3 uColorB;

    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.0, d);
      float glow = smoothstep(0.5, 0.15, d);
      vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 8.0, vDist));
      float a = core * vAlpha + glow * 0.3;
      gl_FragColor = vec4(col, a);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uColorA: { value: new THREE.Color('#921230') }, // acid wine
      uColorB: { value: new THREE.Color('#0d0d0d') }, // ink
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geom, mat);
  scene.add(points);

  // --- Connecting LINES ---
  const linePositions = [];
  const lineThreshold = 2.8;
  for (let i = 0; i < NODE_COUNT; i++) {
    for (let j = i + 1; j < NODE_COUNT; j++) {
      const dx = positions[i*3] - positions[j*3];
      const dy = positions[i*3+1] - positions[j*3+1];
      const dz = positions[i*3+2] - positions[j*3+2];
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < lineThreshold) {
        linePositions.push(positions[i*3], positions[i*3+1], positions[i*3+2]);
        linePositions.push(positions[j*3], positions[j*3+1], positions[j*3+2]);
      }
    }
  }
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x0d0d0d,
    transparent: true,
    opacity: 0.08,
  });
  const lines = new THREE.LineSegments(lineGeom, lineMat);
  scene.add(lines);

  // --- Pulse traces (sparse acid bright nodes that pulse) ---
  const pulseCount = 8;
  const pulses = [];
  for (let i = 0; i < pulseCount; i++) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x921230, transparent: true, opacity: 0.9 })
    );
    const idx = Math.floor(Math.random() * NODE_COUNT);
    sphere.position.set(positions[idx*3], positions[idx*3+1], positions[idx*3+2]);
    sphere.userData = { phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.4 };
    scene.add(sphere);
    pulses.push(sphere);
  }

  // Mouse tracking
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
  });
  hero.addEventListener('pointerleave', () => { mouse.tx = 0; mouse.ty = 0; });

  const clock = new THREE.Clock();
  const animate = () => {
    // 모션 OFF(사용자 정지 또는 reduced-motion) 상태면 렌더를 건너뛰고 대기한다.
    if (motionOff()) { requestAnimationFrame(animate); return; }
    const t = clock.getElapsedTime();
    mouse.x = lerp(mouse.x, mouse.tx, 0.06);
    mouse.y = lerp(mouse.y, mouse.ty, 0.06);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uMouse.value.set(mouse.x, mouse.y);

    // Rotate the system slowly + parallax
    points.rotation.y = t * 0.04 + mouse.x * 0.3;
    points.rotation.x = mouse.y * 0.3;
    lines.rotation.copy(points.rotation);

    // Pulse animation
    pulses.forEach(p => {
      const s = 1 + Math.sin(t * p.userData.speed + p.userData.phase) * 0.6;
      p.scale.setScalar(s);
      p.material.opacity = 0.4 + Math.sin(t * p.userData.speed + p.userData.phase) * 0.5;
    });

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();
})();

/* ---------- VIEW TRANSITIONS — silence harmless "Transition was skipped" rejection ---------- */
(() => {
  addEventListener('unhandledrejection', e => {
    const msg = String(e.reason && e.reason.message || e.reason || '');
    if (msg.includes('Transition was skipped') || msg.includes('view transition')) {
      e.preventDefault();
    }
  });
})();
