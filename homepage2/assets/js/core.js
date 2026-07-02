
/* =========================================================
   BEOMONNURI — AI Interactive Layer
   ========================================================= */

/* ---------- CUSTOM CURSOR ---------- */
(() => {
  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  if (!dot || !ring || matchMedia('(hover: none)').matches) return;
  let mx = innerWidth/2, my = innerHeight/2, rx = mx, ry = my;
  addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
  });
  const tick = () => {
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(tick);
  };
  tick();
  document.querySelectorAll('a, .svc, .roll-row, .partner, button').forEach(el => {
    el.addEventListener('mouseenter', () => { dot.classList.add('hover'); ring.classList.add('hover');});
    el.addEventListener('mouseleave', () => { dot.classList.remove('hover'); ring.classList.remove('hover');});
  });
})();

/* ---------- LIVE HUD ---------- */
(() => {
  const pad = n => n.toString().padStart(2,'0');
  const t = document.getElementById('hud-time');
  const lat = document.getElementById('hud-lat');
  const tps = document.getElementById('hud-tps');
  if (!t) return;
  setInterval(() => {
    const d = new Date();
    t.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, 1000);
  setInterval(() => {
    lat.textContent = (130 + Math.floor(Math.random()*40)) + ' ms';
    tps.textContent = (3500 + Math.floor(Math.random()*900)).toLocaleString();
  }, 1400);
})();

/* ---------- DATA TICKER ---------- */
(() => {
  const items = [
    {sym:'KOSPI', val:'2,718.4', d:'+0.42%'},
    {sym:'KOSDAQ', val:'862.1', d:'+0.78%'},
    {sym:'USD/KRW', val:'1,362', d:'-0.11%', down:true},
    {sym:'WTI', val:'$76.2', d:'+1.24%'},
    {sym:'NICKEL', val:'$18,420', d:'-0.62%', down:true},
    {sym:'배추(상)', val:'₩4,820/kg', d:'+2.10%'},
    {sym:'GPU·H100', val:'avail.', d:'4 nodes'},
    {sym:'RAG·INDEX', val:'128,420 docs', d:'+312'},
    {sym:'AGENTS·LIVE', val:'27', d:'+3'},
    {sym:'PILOTS·Q2', val:'8 orgs', d:'active'},
    {sym:'LATENCY·P95', val:'186 ms', d:'-12ms'},
    {sym:'UPTIME·30D', val:'99.98%', d:'green'},
  ];
  const build = () => items.map(i => `
    <div class="tk-item">
      <span class="dot"></span>
      <span class="sym">${i.sym}</span>
      <span class="val">${i.val}</span>
      <span class="delta${i.down?' down':''}">${i.d}</span>
    </div>`).join('');
  const track = document.getElementById('ticker-track');
  if (track) track.innerHTML = build() + build();
})();

/* ---------- HERO 3D NEURAL NETWORK ---------- */
(() => {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('hero-canvas');
  const heroSect = document.querySelector('.hero');
  if (!canvas || !heroSect) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 18);

  const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const resize = () => {
    const w = heroSect.offsetWidth, h = heroSect.offsetHeight;
    camera.aspect = w/h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  addEventListener('resize', resize);

  // Create nodes (particles) — wine + ink palette
  const NODE_COUNT = 90;
  const nodes = [];
  const posArr = new Float32Array(NODE_COUNT * 3);
  for (let i = 0; i < NODE_COUNT; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / NODE_COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
    const r = 6 + Math.random() * 0.6;
    const x = r * Math.cos(theta) * Math.sin(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(phi);
    posArr[i*3]   = x;
    posArr[i*3+1] = y;
    posArr[i*3+2] = z;
    nodes.push({base: [x,y,z], phase: Math.random()*Math.PI*2});
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

  const nodeMat = new THREE.PointsMaterial({
    color: 0x921230, size: 0.13, transparent: true, opacity: 0.9,
    sizeAttenuation: true
  });
  const points = new THREE.Points(nodeGeo, nodeMat);
  scene.add(points);

  // Lines connecting nearby nodes
  const lineSegs = [];
  const lineThresh = 3.2;
  const linePositions = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    for (let j = i+1; j < NODE_COUNT; j++) {
      const dx = posArr[i*3]-posArr[j*3];
      const dy = posArr[i*3+1]-posArr[j*3+1];
      const dz = posArr[i*3+2]-posArr[j*3+2];
      const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (d < lineThresh) {
        linePositions.push(posArr[i*3], posArr[i*3+1], posArr[i*3+2]);
        linePositions.push(posArr[j*3], posArr[j*3+1], posArr[j*3+2]);
        lineSegs.push([i, j]);
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  const lineArr = new Float32Array(linePositions);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(lineArr, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x921230, transparent: true, opacity: 0.2
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lines);

  // Outer wireframe icosahedron
  const wireGeo = new THREE.IcosahedronGeometry(8, 1);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x0d0d0d, wireframe: true, transparent: true, opacity: 0.08
  });
  const wire = new THREE.Mesh(wireGeo, wireMat);
  scene.add(wire);

  // Mouse parallax
  const mouse = {x:0, y:0};
  heroSect.addEventListener('mousemove', e => {
    const r = heroSect.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left)/r.width - 0.5) * 2;
    mouse.y = ((e.clientY - r.top)/r.height - 0.5) * 2;
  });

  let t = 0;
  const posAttr = nodeGeo.getAttribute('position');
  const linePosAttr = lineGeo.getAttribute('position');

  const animate = () => {
    t += 0.005;
    // breathing nodes
    for (let i = 0; i < NODE_COUNT; i++) {
      const b = nodes[i].base;
      const wave = 1 + 0.05 * Math.sin(t*2 + nodes[i].phase);
      posAttr.array[i*3]   = b[0] * wave;
      posAttr.array[i*3+1] = b[1] * wave;
      posAttr.array[i*3+2] = b[2] * wave;
    }
    posAttr.needsUpdate = true;
    // update lines
    for (let k = 0; k < lineSegs.length; k++) {
      const [i,j] = lineSegs[k];
      linePosAttr.array[k*6]   = posAttr.array[i*3];
      linePosAttr.array[k*6+1] = posAttr.array[i*3+1];
      linePosAttr.array[k*6+2] = posAttr.array[i*3+2];
      linePosAttr.array[k*6+3] = posAttr.array[j*3];
      linePosAttr.array[k*6+4] = posAttr.array[j*3+1];
      linePosAttr.array[k*6+5] = posAttr.array[j*3+2];
    }
    linePosAttr.needsUpdate = true;

    points.rotation.y += 0.0018;
    points.rotation.x += 0.0006;
    lines.rotation.copy(points.rotation);
    wire.rotation.y -= 0.0008;
    wire.rotation.x += 0.0004;

    // parallax
    camera.position.x += (mouse.x * 2.5 - camera.position.x) * 0.04;
    camera.position.y += (-mouse.y * 1.8 - camera.position.y) * 0.04;
    camera.lookAt(0,0,0);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();
})();

/* ---------- PIPELINE CANVAS (flowing dots) ---------- */
(() => {
  const cv = document.getElementById('pipe-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W=0, H=0, dpr = Math.min(devicePixelRatio||1, 2);

  const resize = () => {
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = W*dpr; cv.height = H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  };
  resize();
  addEventListener('resize', resize);

  // 4 columns of nodes
  const cols = 4, perCol = 5;
  const nodes = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < perCol; r++) {
      nodes.push({
        x: (c+0.5) * (W/cols),
        y: (r+0.5) * (H/perCol),
        col: c, row: r
      });
    }
  }
  // resize node x/y on resize
  const replaceNodes = () => {
    let i = 0;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < perCol; r++) {
        nodes[i].x = (c+0.5) * (W/cols);
        nodes[i].y = (r+0.5) * (H/perCol);
        i++;
      }
    }
  };
  addEventListener('resize', replaceNodes);

  // packets travel left->right
  const packets = [];
  const spawnPacket = () => {
    const fromRow = Math.floor(Math.random()*perCol);
    const toRow = Math.floor(Math.random()*perCol);
    packets.push({fromRow, toRow, col: 0, t: 0});
  };
  setInterval(spawnPacket, 280);

  let frame = 0;
  const draw = () => {
    frame++;
    ctx.clearRect(0,0,W,H);

    // connections (all-to-all between adjacent cols)
    ctx.strokeStyle = 'rgba(146,18,48,0.10)';
    ctx.lineWidth = 1;
    for (let c = 0; c < cols-1; c++) {
      for (let r1 = 0; r1 < perCol; r1++) {
        for (let r2 = 0; r2 < perCol; r2++) {
          const n1 = nodes[c*perCol + r1];
          const n2 = nodes[(c+1)*perCol + r2];
          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.stroke();
        }
      }
    }

    // packets
    for (let i = packets.length-1; i >= 0; i--) {
      const p = packets[i];
      p.t += 0.018;
      if (p.t >= 1) {
        p.t = 0; p.col++;
        if (p.col >= cols-1) { packets.splice(i,1); continue;}
        p.fromRow = p.toRow;
        p.toRow = Math.floor(Math.random()*perCol);
      }
      const n1 = nodes[p.col*perCol + p.fromRow];
      const n2 = nodes[(p.col+1)*perCol + p.toRow];
      // ease
      const e = p.t*p.t*(3-2*p.t);
      const x = n1.x + (n2.x-n1.x)*e;
      const y = n1.y + (n2.y-n1.y)*e;
      ctx.fillStyle = 'rgba(146,18,48,0.85)';
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI*2); ctx.fill();
      // trail
      ctx.fillStyle = 'rgba(146,18,48,0.18)';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2); ctx.fill();
    }

    // nodes
    for (const n of nodes) {
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI*2); ctx.fill();
      // pulse
      const pulse = (Math.sin(frame*0.04 + n.col + n.row*0.5)+1)/2;
      ctx.strokeStyle = `rgba(146,18,48,${0.15 + pulse*0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, 8 + pulse*4, 0, Math.PI*2); ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  draw();
})();

/* ---------- PRODUCT CARD 3D TILT ---------- */
(() => {
  const cards = document.querySelectorAll('.svc');
  cards.forEach(c => {
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (py - 0.5) * -6;
      const ry = (px - 0.5) * 8;
      c.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
    });
    c.addEventListener('mouseleave', () => {
      c.style.transform = 'perspective(900px) rotateX(0) rotateY(0)';
    });
  });
})();

/* ---------- COUNTER + REVEAL ON SCROLL ---------- */
(() => {
  // counters
  const counters = document.querySelectorAll('[data-count]');
  const animateCounter = el => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const target = parseFloat(el.dataset.count);
    const unitEl = el.querySelector('.unit');
    const unit = unitEl ? unitEl.outerHTML : '';
    let cur = 0;
    const dur = 1400, start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start)/dur);
      const eased = 1 - Math.pow(1-t, 3);
      cur = target * eased;
      const display = Math.abs(target) >= 10 ? Math.round(cur) : cur.toFixed(1);
      el.innerHTML = display + unit;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // reveal — collect targets
  const revealSel = '.how-cell, .svc, .why-cell, .roll-row, .sec-item, .partner, .metric-cell, .product-row, .case-card, .pgrid > div';
  const revealEls = document.querySelectorAll(revealSel);
  revealEls.forEach(el => el.classList.add('reveal'));

  // Helper: reveal one element + run counter inside if any
  const revealOne = el => {
    el.classList.add('in');
    const cnt = el.matches('[data-count]') ? el : el.querySelector('[data-count]');
    if (cnt) animateCounter(cnt);
  };

  // Reduced-motion fast-path removed per client direction 2026-07 —
  // scroll-driven reveal animations always run for the branded experience.

  // Primary: IntersectionObserver — permissive threshold + rootMargin
  let ioFired = false;
  try {
    const io = new IntersectionObserver(entries => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          ioFired = true;
          setTimeout(() => revealOne(e.target), Math.min(i * 50, 300));
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });

    revealEls.forEach(el => io.observe(el));

    // Also observe lone [data-count] elements that aren't in revealSel
    document.querySelectorAll('[data-count]').forEach(el => {
      if (!el.classList.contains('reveal')) {
        const cIo = new IntersectionObserver(entries => {
          entries.forEach(e => { if (e.isIntersecting) { animateCounter(e.target); cIo.unobserve(e.target);} });
        }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });
        cIo.observe(el);
      }
    });
  } catch (err) {
    // IO unsupported — fall through to fallback
  }

  // SAFETY FALLBACK: if IO never fires within 900ms (sandboxed iframe / suppressed),
  // reveal everything currently in or near the viewport immediately, then reveal
  // the rest as the user scrolls past via plain scroll listener.
  setTimeout(() => {
    if (ioFired) {
      // IO is working — also force-reveal anything already past the viewport top (in case it loaded scrolled)
      revealEls.forEach(el => {
        if (!el.classList.contains('in')) {
          const r = el.getBoundingClientRect();
          if (r.top < innerHeight && r.bottom > 0) revealOne(el);
        }
      });
      return;
    }

    // IO did not fire — fully manual mode
    const checkAll = () => {
      revealEls.forEach(el => {
        if (el.classList.contains('in')) return;
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight * 0.95 && r.bottom > 0) revealOne(el);
      });
      document.querySelectorAll('[data-count]').forEach(el => {
        if (el.dataset.done) return;
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) animateCounter(el);
      });
    };
    checkAll();
    addEventListener('scroll', checkAll, { passive: true });
    addEventListener('resize', checkAll);
  }, 900);

  // ULTIMATE SAFETY: after 2.5s, force-reveal everything that's still hidden,
  // so users never see permanently blank slabs even if both IO and scroll listener fail.
  setTimeout(() => {
    revealEls.forEach(el => { if (!el.classList.contains('in')) revealOne(el);});
    document.querySelectorAll('[data-count]').forEach(el => { if (!el.dataset.done) animateCounter(el);});
  }, 2500);
})();
