/* =========================================================
   BEOMONNURI v5 — WebGPU COMPUTE PARTICLE SYSTEM
   진짜 WebGPU compute shader를 사용한 우아한 입자 흐름.
   미지원 환경에서는 CPU 폴백.

   효과: 마우스 주변으로 부드럽게 끌리는 소수의 발광 입자들.
   "정신없는" 효과가 아닌 절제된 시그니처.
   ========================================================= */
(() => {
  // Reduced-motion gate removed per client direction 2026-07 —
  // WebGPU/GPU particles always render for the branded experience.
  const reduced = false;

  // GLOBAL: canvas covers entire viewport (fixed), not just hero
  let canvas = document.querySelector('#gpu-particles');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gpu-particles';
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1',                // behind content (which is z-index 2+), above background
      pointerEvents: 'none',
      mixBlendMode: 'normal',
    });
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }

  // Update the label in system bar (Home only)
  const labelButton = document.querySelector('.system-bar button.active .label');

  const NUM_PARTICLES = 80;

  // Shared resize logic — full viewport
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  };
  resize();
  addEventListener('resize', resize);

  // Mouse state — track globally on document
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0 };
  document.addEventListener('pointermove', e => {
    mouse.tx = e.clientX / innerWidth;
    mouse.ty = e.clientY / innerHeight;
    mouse.active = 1;
  });
  document.addEventListener('pointerleave', () => { mouse.active = 0; });

  /* ==========================================================
     WEBGPU PATH
     ========================================================== */
  const tryWebGPU = async () => {
    if (!('gpu' in navigator)) return false;
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      device = await adapter.requestDevice();
    } catch (e) { return false; }

    const context = canvas.getContext('webgpu');
    if (!context) return false;

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    // === Particle buffer: position(2) + velocity(2) + life(1) + size(1) = 6 floats per particle ===
    const PARTICLE_STRIDE = 6;
    const particleData = new Float32Array(NUM_PARTICLES * PARTICLE_STRIDE);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const o = i * PARTICLE_STRIDE;
      particleData[o + 0] = Math.random();      // x [0..1]
      particleData[o + 1] = Math.random();      // y [0..1]
      particleData[o + 2] = (Math.random() - 0.5) * 0.0008; // vx
      particleData[o + 3] = (Math.random() - 0.5) * 0.0008; // vy
      particleData[o + 4] = Math.random();      // life [0..1]
      particleData[o + 5] = 0.4 + Math.random() * 0.6; // size factor
    }

    const particleBuffer = device.createBuffer({
      size: particleData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(particleBuffer, 0, particleData);

    // === Uniform buffer: mouse(x,y), mouseActive, time, aspect ===
    const uniformBuffer = device.createBuffer({
      size: 6 * 4,    // 6 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    /* ---- COMPUTE SHADER ---- */
    const computeWGSL = `
      struct Particle {
        pos: vec2<f32>,
        vel: vec2<f32>,
        life: f32,
        size: f32,
      };

      struct Uniforms {
        mouse: vec2<f32>,
        mouseActive: f32,
        time: f32,
        aspect: f32,
        _pad: f32,
      };

      @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
      @group(0) @binding(1) var<uniform> u: Uniforms;

      @compute @workgroup_size(64)
      fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let i = gid.x;
        if (i >= arrayLength(&particles)) { return; }
        var p = particles[i];

        // Aspect-corrected positions
        let pos_corr = vec2<f32>(p.pos.x * u.aspect, p.pos.y);
        let mouse_corr = vec2<f32>(u.mouse.x * u.aspect, u.mouse.y);
        let to_mouse = mouse_corr - pos_corr;
        let dist = length(to_mouse);

        // Soft attraction when mouse is active
        var force = vec2<f32>(0.0, 0.0);
        if (u.mouseActive > 0.5 && dist > 0.001) {
          let pull_strength = 0.00018 * u.mouseActive;
          let pull = pull_strength / (dist * dist + 0.05);
          force = normalize(to_mouse) * pull;
        }

        // Ambient swirl — a gentle vortex field that keeps particles alive
        let angle = u.time * 0.15 + p.pos.x * 6.28 + p.pos.y * 4.0;
        let swirl = vec2<f32>(cos(angle), sin(angle)) * 0.00006;
        force = force + swirl;

        // Update velocity with friction
        p.vel = p.vel * 0.985 + force;

        // Cap velocity
        let speed = length(p.vel);
        if (speed > 0.012) {
          p.vel = p.vel * (0.012 / speed);
        }

        // Update position
        p.pos = p.pos + p.vel;

        // Soft wrap with margin
        if (p.pos.x < -0.05) { p.pos.x = 1.05; }
        if (p.pos.x > 1.05)  { p.pos.x = -0.05; }
        if (p.pos.y < -0.05) { p.pos.y = 1.05; }
        if (p.pos.y > 1.05)  { p.pos.y = -0.05; }

        // Life cycle (slow pulse)
        p.life = fract(p.life + 0.0018);

        particles[i] = p;
      }
    `;

    /* ---- RENDER SHADER ---- */
    const renderWGSL = `
      struct Particle {
        pos: vec2<f32>,
        vel: vec2<f32>,
        life: f32,
        size: f32,
      };

      struct VertexOut {
        @builtin(position) pos: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) life: f32,
        @location(2) speed: f32,
      };

      @group(0) @binding(0) var<storage, read> particles: array<Particle>;

      // Quad vertices: -1..1
      var<private> QUAD: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
      );

      @vertex
      fn vs_main(
        @builtin(vertex_index) vi: u32,
        @builtin(instance_index) ii: u32,
      ) -> VertexOut {
        let p = particles[ii];
        let quadPos = QUAD[vi];
        let baseSize = 0.025 * p.size;
        let lifeSize = 0.7 + 0.3 * sin(p.life * 6.28);
        let size = baseSize * lifeSize;
        // Convert particle pos (0..1) to NDC (-1..1), y flipped
        let center = vec2<f32>(p.pos.x * 2.0 - 1.0, -(p.pos.y * 2.0 - 1.0));
        let worldPos = center + quadPos * size;

        var out: VertexOut;
        out.pos = vec4<f32>(worldPos, 0.0, 1.0);
        out.uv = quadPos;
        out.life = p.life;
        out.speed = length(p.vel);
        return out;
      }

      @fragment
      fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
        let d = length(in.uv);
        if (d > 1.0) { discard; }
        let core = smoothstep(1.0, 0.0, d);
        let glow = exp(-d * 3.0);

        // Color: ink with subtle acid tint when moving fast
        let acid = vec3<f32>(0.57, 0.07, 0.19);
        let ink  = vec3<f32>(0.05, 0.05, 0.05);
        let speedFactor = clamp(in.speed * 80.0, 0.0, 1.0);
        let col = mix(ink, acid, speedFactor * 0.7);

        let alpha = (core * 0.55 + glow * 0.15) * (0.5 + 0.5 * sin(in.life * 6.28));
        return vec4<f32>(col * alpha, alpha);
      }
    `;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });

    const computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });

    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
      ],
    });

    const uniformData = new Float32Array(6);
    const t0 = performance.now();
    let visible = true;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

    const frame = () => {
      if (!visible) { requestAnimationFrame(frame); return; }
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      // Decay active flag
      if (mouse.active > 0) mouse.active = Math.max(0, mouse.active - 0.005);

      uniformData[0] = mouse.x;
      uniformData[1] = mouse.y;
      uniformData[2] = mouse.active;
      uniformData[3] = (performance.now() - t0) / 1000;
      uniformData[4] = canvas.width / canvas.height;
      uniformData[5] = 0;
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const encoder = device.createCommandEncoder();

      // === COMPUTE ===
      const cPass = encoder.beginComputePass();
      cPass.setPipeline(computePipeline);
      cPass.setBindGroup(0, computeBindGroup);
      cPass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
      cPass.end();

      // === RENDER ===
      const view = context.getCurrentTexture().createView();
      const rPass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      rPass.setPipeline(renderPipeline);
      rPass.setBindGroup(0, renderBindGroup);
      rPass.draw(6, NUM_PARTICLES);
      rPass.end();

      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(frame);
    };
    frame();

    return true;
  };

  /* ==========================================================
     CPU FALLBACK (canvas2D)
     ========================================================== */
  const startFallback = () => {
    const ctx = canvas.getContext('2d');
    const particles = Array.from({length: NUM_PARTICLES}, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0008,
      vy: (Math.random() - 0.5) * 0.0008,
      life: Math.random(),
      size: 0.4 + Math.random() * 0.6,
    }));

    let visible = true;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

    const frame = () => {
      if (!visible) { requestAnimationFrame(frame); return; }
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      if (mouse.active > 0) mouse.active = Math.max(0, mouse.active - 0.005);

      const w = canvas.width, h = canvas.height;
      const aspect = w / h;
      ctx.clearRect(0, 0, w, h);

      const t = performance.now() / 1000;

      for (const p of particles) {
        // Attraction
        const dx = (mouse.x - p.x) * aspect;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (mouse.active > 0.5 && dist > 0.001) {
          const pull = 0.00018 * mouse.active / (dist * dist + 0.05);
          p.vx += (dx / dist) * pull / aspect;
          p.vy += (dy / dist) * pull;
        }
        // Swirl
        const angle = t * 0.15 + p.x * 6.28 + p.y * 4;
        p.vx += Math.cos(angle) * 0.00006;
        p.vy += Math.sin(angle) * 0.00006;

        p.vx *= 0.985;
        p.vy *= 0.985;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 0.012) { p.vx *= 0.012/speed; p.vy *= 0.012/speed; }

        p.x += p.vx; p.y += p.vy;
        if (p.x < -0.05) p.x = 1.05; if (p.x > 1.05) p.x = -0.05;
        if (p.y < -0.05) p.y = 1.05; if (p.y > 1.05) p.y = -0.05;
        p.life = (p.life + 0.0018) % 1;

        const lifeSize = 0.7 + 0.3 * Math.sin(p.life * 6.28);
        const r = 0.025 * p.size * lifeSize * Math.min(w, h);
        const cx = p.x * w, cy = p.y * h;
        const speedFactor = Math.min(speed * 80, 1);
        const alpha = (0.5 + 0.5 * Math.sin(p.life * 6.28)) * 0.55;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const colMix = speedFactor * 0.7;
        const cr = Math.floor(13 + (146 - 13) * colMix);
        const cg = Math.floor(13 + (18 - 13) * colMix);
        const cb = Math.floor(13 + (48 - 13) * colMix);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }

      requestAnimationFrame(frame);
    };
    frame();
  };

  /* ==========================================================
     INIT: try WebGPU, then fallback
     ========================================================== */
  tryWebGPU().then(success => {
    if (success) {
      if (labelButton) labelButton.textContent = 'WEBGPU · LIVE';
      console.log('%c◉ WebGPU compute active', 'color:#921230;font-weight:bold');
    } else {
      startFallback();
      if (labelButton) labelButton.textContent = 'WEBGL2 · LIVE';
      console.log('%c◉ WebGPU unavailable — using canvas2D fallback', 'color:#666');
    }
  });
})();
