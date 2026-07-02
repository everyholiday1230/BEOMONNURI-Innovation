/* =========================================================
   BEOMONNURI — AI FRONTIER v4 INTERACTIVE LAYER
   - GLSL Shader Neural Field (Three.js)
   - Live Pipeline Flow Canvas
   - Magnetic Cards
   - AI Chat Widget (window.genspark.complete)
   - Live Intelligence Board
   - Lenis-style smooth scroll
   ========================================================= */

/* ---------- UTILITIES ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
// Always run all animations/WebGL effects — branded experience takes priority.
// (Original prefers-reduced-motion check disabled per client direction 2026-07.)
const reduced = false;

/* ---------- CUSTOM CURSOR ---------- */
(() => {
  if (matchMedia('(hover: none)').matches) return;
  const ring = $('.cursor-ring');
  const dot = $('.cursor-dot');
  if (!ring || !dot) return;

  let mx = innerWidth/2, my = innerHeight/2, rx = mx, ry = my;
  addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
  });

  const tick = () => {
    rx = lerp(rx, mx, 0.18);
    ry = lerp(ry, my, 0.18);
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(tick);
  };
  tick();

  // Hover targets
  const setHover = (on) => {
    ring.classList.toggle('hover', on);
    dot.classList.toggle('hover', on);
  };
  document.addEventListener('mouseover', e => {
    if (e.target.closest('a, button, .svc, .hb-cell, [data-cursor]')) setHover(true);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('a, button, .svc, .hb-cell, [data-cursor]')) setHover(false);
  });
})();

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

/* ---------- LIVE HUD ---------- */
(() => {
  const pad = n => n.toString().padStart(2, '0');
  const t = $('#hud-time');
  const lat = $('#hud-lat');
  const tps = $('#hud-tps');
  const ctx = $('#hud-ctx');
  const chart = $('.hud-mini-chart');

  if (t) {
    setInterval(() => {
      const d = new Date();
      t.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }, 1000);
  }

  setInterval(() => {
    if (lat) lat.textContent = (128 + Math.floor(Math.random() * 36)) + ' ms';
    if (tps) tps.textContent = (3500 + Math.floor(Math.random() * 900)).toLocaleString();
    if (chart) {
      chart.querySelectorAll('span').forEach(s => {
        s.style.height = (30 + Math.random() * 70) + '%';
      });
    }
  }, 1400);
})();

/* ---------- PARTNER LOGO MARQUEE ----------
   고화질 SVG 모노그램 로고 — 무한 확대해도 깨지지 않음.
   각 파트너의 한자/이니셜을 모티프로 한 자체 디자인 로고.
   ※ 실제 공식 로고로 교체하려면 logoSvg 함수에서 대응되는 case만 바꾸세요. */
(() => {
  const partners = [
    { id: 'gov-gg',    cat: '公 GOV',       ko: '경기도경제과학진흥원',   en: 'GBSA',     mono: 'GG' },
    { id: 'fin-nh',    cat: '金 FIN',       ko: '농협',                  en: 'NH',       mono: 'NH' },
    { id: 'inv-posco', cat: '投 INVEST',    ko: '포스코기술투자',         en: 'PTI',      mono: 'PT' },
    { id: 'edu-dku',   cat: '學 EDU',       ko: '단국대학교',            en: 'DKU',      mono: 'DK' },
    { id: 'lab-knl',   cat: '研 LAB',       ko: '한국나노분석랩',         en: 'KNL',      mono: 'KN' },
    { id: 'kiss',      cat: '育 K-ISS',     ko: '강동 K-ISS 멘토링센터',  en: 'K-ISS',    mono: 'KI' },
    { id: 'startup',   cat: '起 STARTUP',   ko: '모두의창업',            en: 'MODU',     mono: 'MD' },
    { id: 'moel',      cat: '公 GOV',       ko: '고용노동부',            en: 'MOEL',     mono: 'ML' },
    { id: 'korcham',   cat: '商 KORCHAM',   ko: '대한상공회의소',         en: 'KORCHAM',  mono: 'KC' },
    { id: 'ykorea',    cat: '青 YOUTH',     ko: '청년재단',              en: 'Y-KOREA',  mono: 'YK' },
    { id: 'localmotive', cat: '走 STARTUP', ko: 'Localmotive',         en: 'LMV',      mono: 'LM' },
    { id: 'mss',       cat: '中 SMB',       ko: '중소벤처기업부',         en: 'MSS',      mono: 'MS' },
  ];

  // SVG monogram generator — bold geometric marks for each partner.
  const logoSvg = (p) => {
    const variants = {
      'gov-gg': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="경기도경제과학진흥원">
          <rect width="64" height="64" fill="#0d0d0d"/>
          <path d="M14 18 L32 14 L50 18 L50 30 L40 30 L40 26 L32 22 L24 26 L24 30 L14 30 Z" fill="#f6f4ef"/>
          <rect x="14" y="34" width="36" height="3" fill="#921230"/>
          <text x="32" y="50" text-anchor="middle" font-family="Archivo Black" font-size="11" font-weight="900" fill="#f6f4ef" letter-spacing="-0.5">GBSA</text>
        </svg>`,
      'fin-nh': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="농협">
          <circle cx="32" cy="32" r="30" fill="#0d6638"/>
          <path d="M22 18 L22 46 L26 46 L26 28 L38 46 L42 46 L42 18 L38 18 L38 36 L26 18 Z" fill="#fff"/>
          <text x="32" y="58" text-anchor="middle" font-family="Archivo Black" font-size="6" fill="#0d6638" letter-spacing="0.5">NONGHYUP</text>
        </svg>`,
      'inv-posco': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="포스코기술투자">
          <rect width="64" height="64" fill="#0d0d0d"/>
          <path d="M14 16 L20 16 L32 32 L44 16 L50 16 L36 36 L36 48 L28 48 L28 36 Z" fill="#921230"/>
          <rect x="14" y="50" width="36" height="2" fill="#f6f4ef"/>
        </svg>`,
      'edu-dku': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="단국대학교">
          <rect width="64" height="64" fill="#003876"/>
          <path d="M14 18 L26 18 Q34 18 34 32 Q34 46 26 46 L14 46 Z" fill="none" stroke="#fff" stroke-width="4"/>
          <text x="42" y="42" font-family="Archivo Black" font-size="22" fill="#fff">K</text>
          <rect x="14" y="50" width="36" height="2" fill="#ffd200"/>
        </svg>`,
      'lab-knl': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="한국나노분석랩">
          <rect width="64" height="64" fill="#f6f4ef" stroke="#0d0d0d" stroke-width="2"/>
          <circle cx="32" cy="28" r="10" fill="none" stroke="#0d0d0d" stroke-width="2"/>
          <circle cx="32" cy="28" r="4" fill="#921230"/>
          <circle cx="32" cy="28" r="16" fill="none" stroke="#0d0d0d" stroke-width="1" stroke-dasharray="2 2"/>
          <text x="32" y="55" text-anchor="middle" font-family="Archivo Black" font-size="8" fill="#0d0d0d">KNL</text>
        </svg>`,
      'kiss': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="K-ISS">
          <rect width="64" height="64" fill="#921230"/>
          <text x="32" y="34" text-anchor="middle" font-family="Archivo Black" font-size="22" fill="#fff" letter-spacing="-1">K</text>
          <line x1="20" y1="42" x2="44" y2="42" stroke="#fff" stroke-width="1.5"/>
          <text x="32" y="54" text-anchor="middle" font-family="Archivo Black" font-size="9" fill="#fff" letter-spacing="0.5">ISS</text>
        </svg>`,
      'startup': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="모두의창업">
          <rect width="64" height="64" fill="#f6f4ef" stroke="#0d0d0d" stroke-width="2"/>
          <circle cx="20" cy="32" r="6" fill="#921230"/>
          <circle cx="32" cy="32" r="6" fill="#0d0d0d"/>
          <circle cx="44" cy="32" r="6" fill="#921230"/>
          <text x="32" y="54" text-anchor="middle" font-family="Archivo Black" font-size="7" fill="#0d0d0d">MODU</text>
        </svg>`,
      'moel': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="고용노동부">
          <rect width="64" height="64" fill="#003876"/>
          <!-- Stylized 'ML' with worker-motion arch -->
          <path d="M12 44 L12 22 L18 22 L24 34 L30 22 L36 22 L36 44 L30 44 L30 32 L26 40 L22 40 L18 32 L18 44 Z" fill="#fff"/>
          <path d="M40 22 L44 22 L44 40 L52 40 L52 44 L40 44 Z" fill="#fff"/>
          <rect x="10" y="50" width="44" height="2" fill="#00a3e0"/>
          <text x="32" y="60" text-anchor="middle" font-family="Archivo Black" font-size="6" fill="#fff" letter-spacing="0.4">MOEL · KR</text>
        </svg>`,
      'korcham': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="대한상공회의소">
          <rect width="64" height="64" fill="#0d0d0d"/>
          <!-- KOREA CHAMBER motif — building columns + roof -->
          <path d="M10 22 L32 12 L54 22 L54 26 L10 26 Z" fill="#c8102e"/>
          <rect x="14" y="28" width="4" height="18" fill="#f6f4ef"/>
          <rect x="22" y="28" width="4" height="18" fill="#f6f4ef"/>
          <rect x="30" y="28" width="4" height="18" fill="#f6f4ef"/>
          <rect x="38" y="28" width="4" height="18" fill="#f6f4ef"/>
          <rect x="46" y="28" width="4" height="18" fill="#f6f4ef"/>
          <rect x="10" y="48" width="44" height="3" fill="#f6f4ef"/>
          <text x="32" y="60" text-anchor="middle" font-family="Archivo Black" font-size="7" fill="#c8102e" letter-spacing="0.3">KORCHAM</text>
        </svg>`,
      'ykorea': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="청년재단">
          <rect width="64" height="64" fill="#00a99d"/>
          <!-- Bold Y with sunrise curve for youth -->
          <path d="M14 14 L24 32 L24 46 L30 46 L30 32 L40 14 L34 14 L27 26 L20 14 Z" fill="#fff"/>
          <circle cx="46" cy="20" r="6" fill="#ffd200"/>
          <path d="M40 26 Q46 20 52 26" fill="none" stroke="#fff" stroke-width="1.5"/>
          <text x="32" y="60" text-anchor="middle" font-family="Archivo Black" font-size="6" fill="#fff" letter-spacing="0.4">YOUTH · KR</text>
        </svg>`,
      'localmotive': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="Localmotive">
          <rect width="64" height="64" fill="#f6f4ef" stroke="#0d0d0d" stroke-width="2"/>
          <!-- Locomotive-inspired train silhouette + arrow -->
          <rect x="10" y="22" width="30" height="18" fill="#0d0d0d"/>
          <rect x="40" y="18" width="14" height="22" fill="#921230"/>
          <circle cx="18" cy="44" r="4" fill="#0d0d0d"/>
          <circle cx="30" cy="44" r="4" fill="#0d0d0d"/>
          <circle cx="46" cy="44" r="4" fill="#921230"/>
          <path d="M52 22 L58 22 L54 18 L58 18" fill="none" stroke="#921230" stroke-width="1.5"/>
          <text x="32" y="58" text-anchor="middle" font-family="Archivo Black" font-size="6" fill="#0d0d0d" letter-spacing="0.4">LOCALMOTIVE</text>
        </svg>`,
      'mss': `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark" aria-label="중소벤처기업부">
          <rect width="64" height="64" fill="#003876"/>
          <path d="M18 20 L32 16 L46 20 L46 26 L18 26 Z" fill="#fff"/>
          <rect x="22" y="30" width="20" height="2" fill="#fff"/>
          <rect x="22" y="36" width="20" height="2" fill="#fff"/>
          <text x="32" y="52" text-anchor="middle" font-family="Archivo Black" font-size="7" fill="#fff">MSS</text>
        </svg>`,
    };
    return variants[p.id] || `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="logo-mark">
        <rect width="64" height="64" fill="#0d0d0d"/>
        <text x="32" y="40" text-anchor="middle" font-family="Archivo Black" font-size="22" fill="#f6f4ef">${p.mono}</text>
      </svg>`;
  };

  const itemHtml = (p) => `
    <div class="pm-item" data-cursor>
      ${logoSvg(p)}
      <div class="meta">
        <div class="cat">${p.cat}</div>
        <div class="name">${p.ko}<span class="en">${p.en}</span></div>
      </div>
    </div>`;

  const track = $('#partner-marquee-track');
  if (!track) return;
  const html = partners.map(itemHtml).join('');
  // Duplicate for seamless loop
  track.innerHTML = html + html;
})();

/* ---------- LEGACY DATA TICKER (still used on other pages) ---------- */
(() => {
  const items = [
    { sym: 'KOSPI', val: '2,718.4', d: '+0.42%' },
    { sym: 'KOSDAQ', val: '862.1', d: '+0.78%' },
    { sym: 'USD/KRW', val: '1,362', d: '-0.11%', down: true },
    { sym: 'WTI', val: '$76.2', d: '+1.24%' },
    { sym: 'NICKEL', val: '$18,420', d: '-0.62%', down: true },
    { sym: '배추(상)', val: '₩4,820/kg', d: '+2.10%' },
    { sym: 'H100·NODE', val: '4 avail', d: 'ready' },
    { sym: 'RAG·INDEX', val: '128,420 docs', d: '+312' },
    { sym: 'AGENTS·LIVE', val: '27', d: '+3' },
    { sym: 'PILOTS·Q2', val: '8 orgs', d: 'active' },
    { sym: 'LATENCY·P95', val: '186 ms', d: '-12ms' },
    { sym: 'UPTIME·30D', val: '99.98%', d: 'green' },
    { sym: 'BTC', val: '$72,481', d: '+1.84%' },
    { sym: 'ETH', val: '$3,892', d: '+0.92%' },
  ];
  const build = () => items.map(i => `
    <div class="tk-item">
      <span class="dot"></span>
      <span class="sym">${i.sym}</span>
      <span class="val">${i.val}</span>
      <span class="delta${i.down ? ' down' : ''}">${i.d}</span>
    </div>`).join('');
  const track = $('#ticker-track');
  if (track) track.innerHTML = build() + build();
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

/* ---------- PIPELINE LIVE FLOW CANVAS ---------- */
(() => {
  const canvas = $('#pipe-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  };
  resize();
  addEventListener('resize', () => {
    canvas.width = canvas.width; // reset
    resize();
  });

  // Define 4 stage nodes horizontally
  const stages = 4;
  const W = () => canvas.width / dpr;
  const H = () => canvas.height / dpr;
  const yMid = () => H() / 2;

  // Packets that travel from stage 0 → 3
  const packets = [];
  const spawnPacket = () => {
    packets.push({
      progress: 0,
      speed: 0.0015 + Math.random() * 0.0015,
      lane: (Math.random() - 0.5) * 60,
      color: Math.random() < 0.3 ? '#921230' : '#0d0d0d',
      size: 2 + Math.random() * 2.5,
    });
  };
  setInterval(spawnPacket, 280);
  for (let i = 0; i < 12; i++) {
    packets.push({
      progress: Math.random(),
      speed: 0.0015 + Math.random() * 0.0015,
      lane: (Math.random() - 0.5) * 60,
      color: Math.random() < 0.3 ? '#921230' : '#0d0d0d',
      size: 2 + Math.random() * 2.5,
    });
  }

  let mouseX = -1000;
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
  });
  canvas.addEventListener('pointerleave', () => { mouseX = -1000; });

  const draw = () => {
    const w = W(), h = H(), my = yMid();
    ctx.clearRect(0, 0, w, h);

    // Background sine wave
    ctx.strokeStyle = 'rgba(13,13,13,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = my + Math.sin(x * 0.02 + Date.now() * 0.001) * 14;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Stage stations
    const stagePositions = [];
    for (let s = 0; s < stages; s++) {
      const x = ((s + 0.5) / stages) * w;
      stagePositions.push(x);
      // Station ring
      ctx.strokeStyle = 'rgba(13,13,13,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, my, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Inner dot
      ctx.fillStyle = '#921230';
      ctx.beginPath();
      ctx.arc(x, my, 4, 0, Math.PI * 2);
      ctx.fill();
      // Pulse ring
      const pulseR = 16 + ((Date.now() * 0.02 + s * 200) % 60);
      const pulseA = 1 - ((pulseR - 16) / 60);
      ctx.strokeStyle = `rgba(146,18,48,${pulseA * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, my, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Connecting line between stages
    ctx.strokeStyle = 'rgba(13,13,13,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(stagePositions[0], my);
    ctx.lineTo(stagePositions[stages-1], my);
    ctx.stroke();
    ctx.setLineDash([]);

    // Packets
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.progress += p.speed;
      if (p.progress >= 1) { packets.splice(i, 1); continue; }
      const x = stagePositions[0] + (stagePositions[stages-1] - stagePositions[0]) * p.progress;
      const y = my + p.lane * Math.sin(p.progress * Math.PI);
      // Trail
      ctx.strokeStyle = p.color === '#921230' ? 'rgba(146,18,48,0.5)' : 'rgba(13,13,13,0.4)';
      ctx.lineWidth = p.size * 0.8;
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      // Head
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouse interaction lens
    if (mouseX > 0) {
      const grad = ctx.createRadialGradient(mouseX, my, 0, mouseX, my, 80);
      grad.addColorStop(0, 'rgba(146,18,48,0.15)');
      grad.addColorStop(1, 'rgba(146,18,48,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(mouseX - 80, 0, 160, h);
    }

    requestAnimationFrame(draw);
  };
  draw();
})();

/* ---------- INTEL BOARD CHARTS ---------- */
(() => {
  const charts = $$('canvas[data-chart]');
  if (!charts.length) return;

  const drawChart = (canvas, opts) => {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;

    // Background grid
    ctx.strokeStyle = 'rgba(246,244,239,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Data
    const data = opts.data;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    // Filled area
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h * 0.8) - h * 0.1;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(146,18,48,0.4)');
    grad.addColorStop(1, 'rgba(146,18,48,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.strokeStyle = opts.color || '#c41a3f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h * 0.8) - h * 0.1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last point pulse
    const lastX = w;
    const lastY = h - ((data[data.length-1] - min) / range) * (h * 0.8) - h * 0.1;
    ctx.fillStyle = '#c41a3f';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  };

  const initial = (n, base, vol) => Array.from({length: n}, (_, i) =>
    base + Math.sin(i * 0.4) * vol + (Math.random() - 0.5) * vol * 0.5
  );

  const datasets = {
    throughput: initial(40, 60, 18),
    latency: initial(40, 50, 12),
    accuracy: initial(40, 80, 8),
    cost: initial(40, 40, 14),
  };

  const renderAll = () => {
    charts.forEach(c => {
      const key = c.dataset.chart;
      const data = datasets[key] || datasets.throughput;
      drawChart(c, { data });
    });
  };

  // Update last point + redraw periodically
  setInterval(() => {
    Object.keys(datasets).forEach(k => {
      datasets[k].shift();
      const last = datasets[k][datasets[k].length - 1];
      datasets[k].push(last + (Math.random() - 0.5) * 8);
    });
    renderAll();
  }, 1500);

  renderAll();
  addEventListener('resize', () => setTimeout(renderAll, 100));

  // Animated numeric counter
  const counters = $$('[data-count]');
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const dur = 1800;
    const start = performance.now();
    const isNegative = target < 0;
    const abs = Math.abs(target);
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const v = Math.round(abs * ease);
      const unitSpan = el.querySelector('.unit');
      el.firstChild.nodeValue = (isNegative ? '−' : '') + v;
      if (unitSpan) el.appendChild(unitSpan);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) { animateCount(e.target); io.unobserve(e.target); }});
  }, { threshold: 0.5 });
  counters.forEach(c => io.observe(c));
})();

/* ---------- LIVE LOG STREAM ---------- */
(() => {
  const log = $('.intel-log');
  if (!log) return;
  const messages = [
    'agent.session.start uid=A2F71',
    'rag.query top_k=5 ctx=128K',
    'embed.batch n=312 dim=1536',
    'rerank.complete score=0.94',
    'tool.invoke db.query t=42ms',
    'guardrail.pass policy=KR-PRIV',
    'workflow.step approve.waiting',
    'audit.log signed=ed25519',
    'cache.hit ratio=0.71',
    'agent.respond tokens=1284',
    'private.vault encrypt=AES256',
    'pilot.metric KPI=on-track',
    'agent.session.end uid=A2F71',
    'monitor.heartbeat ok',
  ];
  const lvls = ['INFO', 'OK', 'INFO', 'OK', 'TRACE', 'OK', 'INFO', 'AUDIT', 'INFO', 'OK', 'OK', 'INFO', 'INFO', 'OK'];
  let i = 0;
  const push = () => {
    const d = new Date();
    const ts = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
    const m = messages[i % messages.length];
    const lvl = lvls[i % lvls.length];
    i++;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="ts">${ts}</span><span class="lvl">${lvl}</span><span class="msg">${m}</span>`;
    log.prepend(row);
    while (log.children.length > 10) log.removeChild(log.lastChild);
  };
  for (let k = 0; k < 6; k++) push();
  setInterval(push, 1100);
})();

/* ---------- AI WIDGET ---------- */
(() => {
  const widget = $('.ai-widget');
  if (!widget) return;
  const header = $('.ai-widget-header', widget);
  const body = $('.ai-widget-body', widget);
  const input = $('.ai-widget-input input', widget);
  const sendBtn = $('.ai-widget-input button', widget);

  header.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    widget.classList.toggle('open');
  });

  const addMsg = (text, who = 'bot', loading = false) => {
    const m = document.createElement('div');
    m.className = `ai-msg ${who}${loading ? ' loading' : ''}`;
    if (who === 'bot' && !loading) {
      m.innerHTML = `<div class="meta">BEOMONNURI · AI</div>${text}`;
    } else if (who === 'bot' && loading) {
      m.innerHTML = `<div class="meta">BEOMONNURI · 추론 중</div>`;
    } else {
      m.textContent = text;
    }
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  };

  // Initial greeting + suggestions
  const greet = document.createElement('div');
  greet.className = 'ai-msg bot';
  greet.innerHTML = `<div class="meta">BEOMONNURI · AI</div>안녕하세요. 범온누리 AI입니다. 어떤 기업 AI 도입이 필요하신가요?`;
  body.appendChild(greet);

  const suggest = document.createElement('div');
  suggest.className = 'ai-suggest';
  ['도입 절차는?', '보안은?', '가격은?', '4개 제품 요약'].forEach(s => {
    const b = document.createElement('button');
    b.textContent = s;
    b.addEventListener('click', () => { input.value = s; send(); });
    suggest.appendChild(b);
  });
  body.appendChild(suggest);

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'user');
    const loader = addMsg('', 'bot', true);
    try {
      const prompt = `당신은 범온누리(BEOMONNURI)의 기업 AI 도입 상담사입니다.
범온누리는 다음 4개의 AI 제품을 운영합니다:
1) 프라이빗 AI — 보안 환경 사내 검색/지식 (RAG, RBAC)
2) 에이전트 AI — 반복 업무 자동화 + 사람 검토 흐름
3) 슈퍼차트 AI — 금융/리서치 시장 데이터 분석
4) 공동주택 관리 AI — 민원·시설·회계·공지 통합
모든 제품은 KR-PRIVATE 환경에서 작동, 데이터 외부 유출 0건을 보장합니다.
간결하고 신뢰감 있는 한국어로 2~4문장으로 답하세요.

사용자 질문: ${text}`;
      const res = await window.genspark.complete({
        messages: [{ role: 'user', content: prompt }],
      });
      loader.classList.remove('loading');
      loader.innerHTML = `<div class="meta">BEOMONNURI · AI</div>${res}`;
    } catch (err) {
      loader.classList.remove('loading');
      loader.innerHTML = `<div class="meta">BEOMONNURI · AI</div>지금은 응답을 드릴 수 없습니다. 도입 진단을 신청해 주세요.`;
    }
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
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
