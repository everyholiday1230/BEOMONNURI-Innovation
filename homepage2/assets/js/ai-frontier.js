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
// Always run all animations/WebGL effects — branded experience takes priority.
// (Original prefers-reduced-motion check disabled per client direction 2026-07.)
const reduced = false;

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
    { id: 'mss', alt: '중소벤처기업부 공식 로고', src: 'assets/img/logos/partners/mss.png' },
    { id: 'moel', alt: '고용노동부 공식 로고', src: 'assets/img/logos/partners/moel.png' },
    { id: 'gov-gg', alt: '경기도경제과학진흥원 공식 로고', src: 'assets/img/logos/partners/gbsa.png', webp: 'assets/img/logos/partners/gbsa.webp' },
    { id: 'korcham', alt: '대한상공회의소 공식 로고', src: 'assets/img/logos/partners/korcham.png' },
    { id: 'startup', alt: '모두의창업 공식 로고', src: 'assets/img/logos/partners/modoo-startup.png' },
    { id: 'inv-posco', alt: '포스코기술투자 공식 로고', src: 'assets/img/logos/partners/posco-technology-investment.png' },
    { id: 'fin-nh', alt: '농협 공식 로고', src: 'assets/img/logos/partners/nonghyup.png' },
    { id: 'youth-foundation', alt: '청년재단 공식 로고', src: 'assets/img/logos/partners/youth-foundation.png' },
    { id: 'edu-dku', alt: '단국대학교 공식 로고', src: 'assets/img/logos/partners/dankook-university.png' },
    /* TEMP-HIDDEN(LOCALMOTIVE / 2026-08-04): 재노출 시 아래 한 줄의 주석만 해제
    { id: 'localmotive', alt: '(주)로컬모티브 공식 로고', src: 'assets/img/logos/partners/localmotive.png' },
    */
    { id: 'lab-knl', alt: '한국나노분석랩 공식 로고', src: 'assets/img/logos/partners/knal-kor.png' },
    { id: 'kiss', alt: '강동 K-ISS 멘토링센터 공식 로고', src: 'assets/img/logos/partners/gangdong-kiss.png' },
  ];

  const itemHtml = (p) => `
    <div class="pm-item" data-cursor data-partner-id="${p.id}">
      <img class="logo-mark logo-${p.id}" src="${p.src}" alt="${p.alt}" loading="eager" decoding="async" referrerpolicy="no-referrer" />
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
      if (!marqueeVisible || marqueeHovered) {
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
