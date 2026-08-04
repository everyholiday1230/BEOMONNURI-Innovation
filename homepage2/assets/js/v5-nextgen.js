/* =========================================================
   BEOMONNURI v5 — NEXTGEN INTERACTIVE LAYER
   - WebGL2 fragment-shader neural activation field (LIF-inspired)
   - GLSL liquid hero layer / Three.js refraction glass orbs
   - 3D CSS cylinder partner marquee
   - Scroll progress bar
   - Chromatic aberration on fast scroll
   ========================================================= */

const $5 = (s, r = document) => r.querySelector(s);
const $$5 = (s, r = document) => Array.from(r.querySelectorAll(s));

// Pauses interval-driven demo/status updates while the tab is hidden to avoid
// wasting CPU on invisible content. Resumes automatically when visible again.
const pausableInterval5 = (fn, ms) => {
  let id = setInterval(fn, ms);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(id);
    } else {
      id = setInterval(fn, ms);
    }
  });
  return id;
};
// Always run all animations/WebGL effects — branded experience takes priority.
// (Original prefers-reduced-motion check disabled per client direction 2026-07.)
const reducedV5 = false;

/* ============================================================
   1. SCROLL PROGRESS BAR
   ============================================================ */
(() => {
  const bar = $5('.scroll-progress > div');
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? scrollY / max : 0;
    bar.style.setProperty('--p', p.toFixed(4));
  };
  update();
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
})();

/* ============================================================
   2. CHROMATIC ABERRATION ON FAST SCROLL
   ============================================================ */
(() => {
  if (reducedV5) return;
  const filter = document.querySelector('#chroma feDisplacementMap');
  if (!filter) return;

  let lastY = scrollY;
  let lastT = performance.now();
  let velocity = 0;
  let target = 0;
  let current = 0;
  let raf;

  const updateAberration = () => {
    current = current + (target - current) * 0.15;
    filter.setAttribute('scale', current.toFixed(2));
    if (Math.abs(target - current) > 0.05) {
      raf = requestAnimationFrame(updateAberration);
    } else {
      raf = null;
    }
  };

  addEventListener('scroll', () => {
    const now = performance.now();
    const dy = scrollY - lastY;
    const dt = now - lastT;
    velocity = Math.abs(dy / Math.max(dt, 1)); // px per ms
    lastY = scrollY;
    lastT = now;
    target = Math.min(velocity * 8, 12);
    if (!raf) raf = requestAnimationFrame(updateAberration);
  }, { passive: true });

  // Decay
  pausableInterval5(() => {
    target *= 0.85;
    if (target < 0.05) target = 0;
    if (!raf) raf = requestAnimationFrame(updateAberration);
  }, 100);
})();

/* ============================================================
   3. NEURAL ACTIVATION FIELD (WebGL2 fragment shader)
   Simulates a 2D LIF-inspired neuron grid. Each pixel is a neuron.
   Mouse acts as continuous stimulus. Activation propagates.
   ============================================================ */
(() => {
  if (reducedV5) return;
  const canvas = $5('#neural-grid');
  const hero = $5('.hero');
  if (!canvas || !hero) return;
  // Disabled per user feedback (see v5-nextgen.css #neural-grid { display:none }).
  // Skip WebGL init entirely to avoid wasting GPU/CPU on an invisible canvas.
  if (getComputedStyle(canvas).display === 'none') return;

  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) {
    // Fallback: hide canvas
    canvas.style.display = 'none';
    return;
  }

  // === Shaders ===
  const vertSrc = `#version 300 es
    in vec2 a_pos;
    out vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Simulation step shader — reads previous state, computes next state.
  const simSrc = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_prev;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;          // 0..1
    uniform float u_mouseStrength;
    uniform float u_time;
    out vec4 outColor;

    // hash for stochasticity
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 px = 1.0 / u_resolution;
      // Read self + neighbors
      vec4 c = texture(u_prev, v_uv);
      vec4 n = texture(u_prev, v_uv + vec2(0.0,  px.y));
      vec4 s = texture(u_prev, v_uv + vec2(0.0, -px.y));
      vec4 e = texture(u_prev, v_uv + vec2( px.x, 0.0));
      vec4 w = texture(u_prev, v_uv + vec2(-px.x, 0.0));

      // r channel = membrane potential, g = refractory cooldown, b = recent spike flash
      float V = c.r;
      float refr = c.g;
      float flash = c.b;

      // Diffusion from neighbors (synaptic input)
      float input_sum = (n.b + s.b + e.b + w.b) * 0.18;

      // Mouse stimulus (spatial gaussian around cursor) — stronger
      float dMouse = distance(v_uv, u_mouse);
      float stim = u_mouseStrength * exp(-dMouse * dMouse * 18.0) * 2.4;

      // Ambient activity — keep things alive even without mouse
      float noise = (hash(v_uv * 100.0 + u_time) - 0.5) * 0.012;
      float ambient = sin(u_time * 0.7 + v_uv.x * 6.0 + v_uv.y * 8.0) * 0.008;

      // Update potential
      float leak = 0.965;
      V = V * leak + input_sum + stim + noise + ambient;

      // Refractory recovery
      refr = max(refr - 0.055, 0.0);

      // Spike condition — lower threshold for more activity
      float spike = 0.0;
      if (V > 0.70 && refr <= 0.0) {
        spike = 1.0;
        V = -0.15;
        refr = 1.0;
      }

      flash = max(spike, flash * 0.88);  // longer flash decay

      outColor = vec4(V, refr, flash, 1.0);
    }
  `;

  // Display shader — renders the state with colors matching the brand.
  const displaySrc = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_state;
    uniform vec2 u_resolution;
    out vec4 outColor;

    void main() {
      vec4 s = texture(u_state, v_uv);
      float flash = s.b;
      float V = s.r;

      // Grid pattern — denser
      vec2 cellUV = fract(v_uv * 80.0);
      float cellDist = length(cellUV - 0.5) * 2.0;
      float dot_ = smoothstep(0.5, 0.0, cellDist);

      // Lines connecting active neurons (faint)
      vec2 lineUV = abs(fract(v_uv * 80.0) - 0.5);
      float lines = smoothstep(0.48, 0.5, max(lineUV.x, lineUV.y));

      // Brand acid #921230 in linear-ish RGB
      vec3 acid = vec3(0.57, 0.07, 0.19);
      vec3 acidBright = vec3(0.77, 0.10, 0.25);
      vec3 ink = vec3(0.05, 0.05, 0.05);
      vec3 bg = vec3(0.965, 0.957, 0.937);

      // Background: visible but subtle grid
      vec3 col = mix(bg, ink, dot_ * 0.10);

      // Active neurons glow — much stronger
      float activity = max(flash, max(0.0, V) * 0.7);
      col = mix(col, acid, dot_ * activity * 2.2);
      col = mix(col, acidBright, flash * dot_ * 0.9);

      // Halo around active cells
      vec2 haloUV = fract(v_uv * 80.0) - 0.5;
      float halo = exp(-length(haloUV) * 4.0) * activity;
      col = mix(col, acid, halo * 0.5);

      // Output is multiplied over the page (CSS mix-blend-mode: multiply)
      float alpha = clamp(activity * 0.85 + 0.08, 0.0, 0.95);
      outColor = vec4(col, alpha);
    }
  `;

  // Compile helpers
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('shader error:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const link = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  };

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const simFs = compile(gl.FRAGMENT_SHADER, simSrc);
  const dispFs = compile(gl.FRAGMENT_SHADER, displaySrc);
  if (!vs || !simFs || !dispFs) { canvas.style.display = 'none'; return; }

  const simProg = link(vs, simFs);
  const dispProg = link(vs, dispFs);

  // Quad
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(simProg, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Ping-pong textures
  const SIM_RES = 256;
  const makeTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SIM_RES, SIM_RES, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // Check for HALF_FLOAT support
  const ext = gl.getExtension('EXT_color_buffer_half_float');
  if (!ext) { canvas.style.display = 'none'; return; }

  let texA = makeTex();
  let texB = makeTex();

  const makeFbo = (tex) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fb;
  };
  let fboA = makeFbo(texA);
  let fboB = makeFbo(texB);

  // Mouse
  const mouse = { x: 0.5, y: 0.5, strength: 0.0 };
  let lastMove = 0;
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = 1.0 - (e.clientY - r.top) / r.height;  // GL coords
    mouse.strength = 1.0;
    lastMove = performance.now();
  });
  hero.addEventListener('pointerleave', () => { mouse.strength = 0; });

  // Sizing
  const resize = () => {
    const w = hero.offsetWidth, h = hero.offsetHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  };
  resize();
  addEventListener('resize', resize);

  // Uniform locations
  const simUni = {
    prev: gl.getUniformLocation(simProg, 'u_prev'),
    res: gl.getUniformLocation(simProg, 'u_resolution'),
    mouse: gl.getUniformLocation(simProg, 'u_mouse'),
    strength: gl.getUniformLocation(simProg, 'u_mouseStrength'),
    time: gl.getUniformLocation(simProg, 'u_time'),
  };
  const dispUni = {
    state: gl.getUniformLocation(dispProg, 'u_state'),
    res: gl.getUniformLocation(dispProg, 'u_resolution'),
  };

  // Periodic random stimuli (so it feels alive even without mouse)
  const randomStims = Array.from({length: 6}, () => ({
    x: Math.random(), y: Math.random(),
    next: performance.now() + Math.random() * 2000,
  }));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const start = performance.now();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  const tick = () => {
    if (!visible) { requestAnimationFrame(tick); return; }
    const now = performance.now();
    const t = (now - start) / 1000;

    // Decay mouse strength
    mouse.strength = Math.max(0, mouse.strength - 0.015);

    // Inject random stimuli
    let stimX = mouse.x, stimY = mouse.y, stimStr = mouse.strength;
    randomStims.forEach(s => {
      if (now > s.next) {
        // single pulse
        if (mouse.strength < 0.05) {
          stimX = s.x; stimY = s.y; stimStr = 0.6;
        }
        s.x = Math.random(); s.y = Math.random();
        s.next = now + 1200 + Math.random() * 2400;
      }
    });

    // === SIM STEP: render to fboB using texA ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.uniform1i(simUni.prev, 0);
    gl.uniform2f(simUni.res, SIM_RES, SIM_RES);
    gl.uniform2f(simUni.mouse, stimX, stimY);
    gl.uniform1f(simUni.strength, stimStr);
    gl.uniform1f(simUni.time, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // === DISPLAY: render to screen ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(dispProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(dispUni.state, 0);
    gl.uniform2f(dispUni.res, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Swap
    [texA, texB] = [texB, texA];
    [fboA, fboB] = [fboB, fboA];

    requestAnimationFrame(tick);
  };
  tick();
})();

/* ============================================================
   10. GLSL LIQUID HERO LAYER
   Worley-noise based flow field that distorts with mouse.
   Renders behind text, on top of neural-grid.
   ============================================================ */
(() => {
  if (reducedV5) return;
  const canvas = document.querySelector('#liquid-hero');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;

  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) { canvas.style.display = 'none'; return; }

  const vert = `#version 300 es
    in vec2 a_pos;
    out vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const frag = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_time;
    uniform float u_aspect;
    out vec4 outColor;

    // 2D hash
    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
    }

    // Worley / cellular noise — distance to nearest feature point
    float worley(vec2 uv) {
      vec2 i = floor(uv);
      vec2 f = fract(uv);
      float minDist = 1.5;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = hash22(i + g) * 0.5 + 0.5;
          // Time-varying point positions for fluid motion
          o = 0.5 + 0.5 * sin(u_time * 0.5 + 6.2831 * o);
          vec2 r = g + o - f;
          float d = dot(r, r);
          minDist = min(minDist, d);
        }
      }
      return sqrt(minDist);
    }

    // FBM-ish layered noise for variation
    float fbm(vec2 uv) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * worley(uv);
        uv *= 2.0;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = v_uv;
      uv.x *= u_aspect;

      // Mouse displacement field
      vec2 mUV = u_mouse;
      mUV.x *= u_aspect;
      vec2 toMouse = uv - mUV;
      float dMouse = length(toMouse);
      vec2 dir = toMouse / (dMouse + 0.001);
      float pull = exp(-dMouse * dMouse * 6.0) * 0.18;
      uv -= dir * pull;

      // Flow over time
      vec2 flow = vec2(sin(u_time * 0.25), cos(u_time * 0.18));
      float w = worley(uv * 3.0 + flow);
      float w2 = worley(uv * 6.0 - flow * 0.7);

      // Ink-blot field
      float ink = smoothstep(0.55, 0.15, w) * 0.6
                + smoothstep(0.45, 0.05, w2) * 0.4;

      // Highlight near mouse
      float spotlight = exp(-dMouse * dMouse * 4.0);
      ink += spotlight * 0.25;

      // Color palette
      vec3 acid = vec3(0.57, 0.07, 0.19);
      vec3 ink_col = vec3(0.05, 0.05, 0.05);
      vec3 bg = vec3(0.965, 0.957, 0.937);

      vec3 col = mix(bg, ink_col, ink * 0.35);
      col = mix(col, acid, ink * spotlight * 1.5);

      // Veining — fine dark lines
      float vein = smoothstep(0.08, 0.0, abs(w - 0.5));
      col = mix(col, ink_col, vein * 0.4);

      // Alpha for blend
      float alpha = ink * 0.45 + spotlight * 0.25;
      alpha = clamp(alpha, 0.0, 0.65);

      outColor = vec4(col, alpha);
    }
  `;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('liquid shader error', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vert);
  const fs = compile(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) { canvas.style.display = 'none'; return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.style.display = 'none';
    return;
  }

  const quad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_resolution');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uAspect = gl.getUniformLocation(prog, 'u_aspect');

  const resize = () => {
    const w = hero.offsetWidth, h = hero.offsetHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  };
  resize();
  addEventListener('resize', resize);

  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / r.width;
    mouse.ty = 1.0 - (e.clientY - r.top) / r.height;
  });

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const start = performance.now();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  const tick = () => {
    if (!visible) { requestAnimationFrame(tick); return; }
    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;
    const t = (performance.now() - start) / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uTime, t);
    gl.uniform1f(uAspect, canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(tick);
  };
  tick();
})();

/* ============================================================
   12. THREE.JS REFRACTION GLASS ORBS (hero floating elements)
   Crystal-like glass spheres that refract the background.
   ============================================================ */
(() => {
  if (reducedV5) return;
  if (typeof THREE === 'undefined') return;
  const container = document.querySelector('#glass-orbs');
  if (!container) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // Environment cubemap — generate procedurally with gradient.
  // We'll use a CubeRenderTarget with a generated scene as env for fake refraction.
  const envScene = new THREE.Scene();
  const envSize = 256;
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(envSize, {
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);

  // Build env: gradient sphere with ink/acid pattern
  const envGeom = new THREE.SphereGeometry(40, 32, 32);
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime;
      void main() {
        vec3 d = normalize(vWorldPos);
        // gradient based on y
        vec3 bg = vec3(0.965, 0.957, 0.937);
        vec3 deep = vec3(0.93, 0.91, 0.88);
        vec3 acid = vec3(0.57, 0.07, 0.19);
        vec3 ink = vec3(0.05, 0.05, 0.05);
        vec3 col = mix(deep, bg, d.y * 0.5 + 0.5);
        // Bands
        float band = sin(d.y * 24.0 + uTime * 0.3);
        col = mix(col, acid, smoothstep(0.7, 1.0, band) * 0.4);
        col = mix(col, ink, smoothstep(0.85, 1.0, abs(d.x)) * 0.2);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const envMesh = new THREE.Mesh(envGeom, envMat);
  envScene.add(envMesh);

  // Glass orbs
  const orbs = [];
  const makeOrb = (x, y, z, scale) => {
    const geo = new THREE.IcosahedronGeometry(1, 4);
    // r128 compatible glass — use envMap reflection + low opacity
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.05,
      envMap: cubeRenderTarget.texture,
      envMapIntensity: 1.6,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      reflectivity: 1.0,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    mesh.userData = {
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.4,
      ax: x, ay: y, az: z,
      spin: (Math.random() - 0.5) * 0.6,
    };
    scene.add(mesh);
    orbs.push(mesh);
  };

  // Distribute 4 orbs around screen
  makeOrb(-3.6, 2.0, 0, 0.55);
  makeOrb( 3.8, 1.2, -1, 0.42);
  makeOrb(-2.5,-2.2, -0.5, 0.38);
  makeOrb( 2.8,-1.5, 0.5, 0.5);

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 5); scene.add(key);
  const acid = new THREE.PointLight(0x921230, 1.8, 12);
  acid.position.set(-2, -1, 3); scene.add(acid);

  const resize = () => {
    const r = container.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  container.parentElement.addEventListener('pointermove', e => {
    const r = container.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
  });

  const clock = new THREE.Clock();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  let envFrameCount = 0;
  const tick = () => {
    if (!visible) { requestAnimationFrame(tick); return; }
    const t = clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    envMat.uniforms.uTime.value = t;

    // Update env every few frames (throttled — reflection env changes slowly)
    envFrameCount++;
    if (envFrameCount % 3 === 0) {
      cubeCamera.update(renderer, envScene);
    }

    orbs.forEach(o => {
      const ud = o.userData;
      o.position.x = ud.ax + Math.sin(t * ud.speed + ud.phase) * 0.4;
      o.position.y = ud.ay + Math.cos(t * ud.speed * 0.8 + ud.phase) * 0.3;
      o.rotation.x = t * ud.spin * 0.6;
      o.rotation.y = t * ud.spin + ud.phase;
    });

    // Parallax
    scene.rotation.y = mouse.x * 0.15;
    scene.rotation.x = mouse.y * 0.1;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
})();

/* ============================================================
   5. 3D CYLINDER PARTNER MARQUEE
   ============================================================ */
(() => {
  const stage = $5('#cylinder-stage');
  if (!stage) return;

  const partnerLogos = {
    'mss': { src: 'assets/img/logos/partners/mss.png', alt: '중소벤처기업부 공식 로고' },
    'fin-nh': { src: 'assets/img/logos/partners/nonghyup.png', alt: '농협 공식 로고' },
    'inv-posco': { src: 'assets/img/logos/partners/posco-technology-investment.png', alt: '포스코기술투자 공식 로고' },
    'edu-dku': { src: 'assets/img/logos/partners/dankook-university.png', alt: '단국대학교 공식 로고' },
    'lab-knl': { src: 'assets/img/logos/partners/knal-kor.png', alt: '한국나노분석랩 공식 로고' },
    'kiss': { src: 'assets/img/logos/partners/gangdong-kiss.png', alt: '강동 K-ISS 멘토링센터 공식 로고' },
    'startup': { src: 'assets/img/logos/partners/modoo-startup.png', alt: '모두의창업 공식 로고' },
    'youth-foundation': { src: 'assets/img/logos/partners/youth-foundation.png', alt: '청년재단 공식 로고' },
    /* TEMP-HIDDEN(LOCALMOTIVE / 2026-08-04): 재노출 시 아래 한 줄의 주석만 해제
    'localmotive': { src: 'assets/img/logos/partners/localmotive.png', alt: '(주)로컬모티브 공식 로고' },
    */
    'gov-gg': { src: 'assets/img/logos/partners/gbsa.png', alt: '경기도경제과학진흥원 공식 로고' },
    'moel': { src: 'assets/img/logos/partners/moel.png', alt: '고용노동부 공식 로고' },
    'korcham': { src: 'assets/img/logos/partners/korcham.png', alt: '대한상공회의소 공식 로고' },
  };
  const partnerOrder = [
    'mss',
    'moel',
    'gov-gg',
    'korcham',
    'startup',
    'inv-posco',
    'fin-nh',
    'youth-foundation',
    'edu-dku',
    /* TEMP-HIDDEN(LOCALMOTIVE / 2026-08-04): 재노출 시 아래 한 줄의 주석만 해제
    'localmotive',
    */
    'lab-knl',
    'kiss',
  ];

  // Prefer logos copied from hidden flat marquee, fallback to static source paths.
  const logoMap = {};
  const logoHtml = (id, src, alt) => `<img class="logo-mark logo-${id}" src="${src}" alt="${alt || ''}" loading="eager" decoding="async" referrerpolicy="no-referrer" />`;

  const collectLogos = () => {
    $$5('#partner-marquee-track .pm-item').forEach(item => {
      const id = item.getAttribute('data-partner-id');
      const img = item.querySelector('img.logo-mark');
      if (!id || !img || !img.src) return;
      logoMap[id] = logoHtml(id, img.src, img.alt || partnerLogos[id]?.alt || '');
    });
  };

  const ensureFallbackLogos = () => {
    partnerOrder.forEach((id) => {
      if (logoMap[id]) return;
      const fallback = partnerLogos[id];
      if (!fallback) return;
      logoMap[id] = logoHtml(id, fallback.src, fallback.alt);
    });
  };

  const N = partnerOrder.length;
  // 좁은 화면에서는 컨테이너 폭이 줄어드는데 radius가 고정이면 로고가
  // 카메라(perspective)에 지나치게 가까워져 과도하게 확대/흐릿하게 보인다
  // (모바일에서 실제 재현된 문제). 컨테이너 실측 폭 기준으로 radius를 낮춘다.
  const getRadius = () => {
    const w = stage.parentElement ? stage.parentElement.clientWidth : innerWidth;
    if (w <= 340) return 140;
    if (w <= 480) return 190;
    if (w <= 700) return 260;
    return 480;
  };
  let radius = getRadius();
  const angleStep = 360 / N;

  const render = () => {
    ensureFallbackLogos();
    if (!partnerOrder.every((id) => logoMap[id])) return false;
    radius = getRadius();
    stage.innerHTML = partnerOrder.map((id, i) => {
      const angle = i * angleStep;
      return `<div class="cylinder-face" style="transform: rotateY(${angle}deg) translateZ(${radius}px);">
        ${logoMap[id]}
      </div>`;
    }).join('');
    return true;
  };

  let tries = 0;
  const tryRender = () => {
    // `.partner-marquee`(숨김 소스) 안의 이미지는 loading="lazy" + display:none
    // 조합 때문에 브라우저가 실제 다운로드를 시작하지 않는 경우가 있어(모바일에서
    // 재현됨) img.src가 비어 있는 채로 남을 수 있다. 그 결과 3D 실린더가 최대
    // 12번(2.4s) 재시도하는 동안 빈 화면으로 노출되는 문제가 있었다.
    // → 폴백 경로(항상 유효한 정적 파일)를 먼저 렌더링해 즉시 로고를 보여주고,
    //   숨김 마퀴에서 더 나은 소스(webp 등)를 구할 수 있으면 그때 교체한다.
    ensureFallbackLogos();
    render();
    startRotation();

    collectLogos();
    const hasAllFromMarquee = partnerOrder.every((id) => logoMap[id] && !logoMap[id].includes(partnerLogos[id]?.src));
    if (!hasAllFromMarquee && tries < 6) {
      tries += 1;
      setTimeout(() => {
        collectLogos();
        render();
      }, 250);
    }
  };

  // Drive rotation via requestAnimationFrame instead of a CSS animation.
  // Some browsers stall/steady CSS transform animations when combined with
  // `perspective` + `overflow: hidden` on the parent (seen on Safari/iOS and
  // some Chromium/GPU driver combos), leaving the cylinder visibly frozen.
  // Manual rAF control is more reliable across environments.
  const ROTATION_PERIOD_MS = 40000; // matches previous 40s CSS animation
  let rotationVisible = true;
  document.addEventListener('visibilitychange', () => {
    rotationVisible = !document.hidden;
  });

  function startRotation() {
    let start = null;
    const spin = (now) => {
      if (!rotationVisible) {
        requestAnimationFrame(spin);
        return;
      }
      if (start === null) start = now;
      const elapsed = (now - start) % ROTATION_PERIOD_MS;
      const angle = -(elapsed / ROTATION_PERIOD_MS) * 360;
      stage.style.transform = `translate(-50%, -50%) rotateY(${angle}deg)`;
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  }

  setTimeout(tryRender, 30);

  // 화면 회전/리사이즈 시 radius를 다시 계산해 확대/왜곡 방지
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (getRadius() !== radius) render();
    }, 200);
  });
})();

/* ============================================================
   9. CONTAINER QUERY POLYFILL HINT — none needed, native 2026
   ============================================================ */
