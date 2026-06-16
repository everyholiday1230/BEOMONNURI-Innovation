/* ═══════════════════════════════════════════
   범온 AI 슈퍼차트 — Landing Page JS
   ═══════════════════════════════════════════ */
(function() {
  'use strict';

  // === Nav scroll effect ===
  const nav = document.getElementById('nav');
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    lastScroll = window.scrollY;
  }, { passive: true });

  // === Mobile nav toggle ===
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('active');
      navLinks.classList.toggle('open');
      const actions = document.querySelector('.nav-actions');
      if (actions) actions.classList.toggle('open');
    });
    // Close on link click
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navToggle.classList.remove('active');
        navLinks.classList.remove('open');
        const actions = document.querySelector('.nav-actions');
        if (actions) actions.classList.remove('open');
      });
    });
  }

  // === Scroll animations (Intersection Observer) ===
  const animateEls = document.querySelectorAll('[data-animate]');
  if (animateEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const delay = parseInt(entry.target.dataset.delay || '0');
          setTimeout(() => entry.target.classList.add('visible'), delay);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    animateEls.forEach(el => observer.observe(el));
  }

  // === Counter animation ===
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseInt(el.dataset.count);
          let current = 0;
          const step = Math.max(1, Math.floor(target / 40));
          const timer = setInterval(() => {
            current += step;
            if (current >= target) { current = target; clearInterval(timer); }
            el.textContent = current;
          }, 30);
          counterObserver.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(el => counterObserver.observe(el));
  }

  // === Hero chart animation (Canvas) ===
  const canvas = document.getElementById('heroChart');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let W, H;

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    // Generate fake OHLC data
    const bars = 80;
    const data = [];
    let price = 67500;
    for (let i = 0; i < bars; i++) {
      const change = (Math.random() - 0.48) * 800;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * 400;
      const low = Math.min(open, close) - Math.random() * 400;
      data.push({ o: open, h: high, l: low, c: close, v: Math.random() });
      price = close;
    }

    let animOffset = 0;
    function drawChart() {
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0F0F12');
      bg.addColorStop(1, '#1A1A22');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 5; i++) {
        const y = (H / 5) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Price range
      let minP = Infinity, maxP = -Infinity;
      data.forEach(d => { if (d.l < minP) minP = d.l; if (d.h > maxP) maxP = d.h; });
      const range = maxP - minP;
      const padY = H * 0.1;
      const chartH = H - padY * 2;
      const toY = (p) => padY + chartH * (1 - (p - minP) / range);
      const barW = (W - 40) / bars;

      // Volume bars
      data.forEach((d, i) => {
        const x = 20 + i * barW;
        const vH = d.v * H * 0.15;
        const up = d.c >= d.o;
        ctx.fillStyle = up ? 'rgba(196,56,75,0.2)' : 'rgba(59,130,246,0.2)';
        ctx.fillRect(x - barW * 0.3, H - vH, barW * 0.6, vH);
      });

      // Candles
      data.forEach((d, i) => {
        const x = 20 + i * barW;
        const up = d.c >= d.o;
        const color = up ? '#C4384B' : '#3B82F6';
        // Wick
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, toY(d.h)); ctx.lineTo(x, toY(d.l)); ctx.stroke();
        // Body
        ctx.fillStyle = color;
        const bodyTop = toY(Math.max(d.o, d.c));
        const bodyBot = toY(Math.min(d.o, d.c));
        ctx.fillRect(x - barW * 0.35, bodyTop, barW * 0.7, Math.max(1, bodyBot - bodyTop));
      });

      // Moving average line
      ctx.strokeStyle = 'rgba(216,182,106,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 7; i < bars; i++) {
        let sum = 0;
        for (let j = i - 7; j <= i; j++) sum += data[j].c;
        const ma = sum / 8;
        const x = 20 + i * barW;
        const y = toY(ma);
        i === 7 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Current price line
      const lastClose = data[data.length - 1].c;
      const lastY = toY(lastClose);
      ctx.strokeStyle = 'rgba(146,18,48,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(W, lastY); ctx.stroke();
      ctx.setLineDash([]);

      // Price label
      ctx.fillStyle = '#921230';
      ctx.fillRect(W - 80, lastY - 10, 80, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('$' + lastClose.toFixed(0), W - 74, lastY + 4);

      // Animate last candle
      animOffset++;
      if (animOffset % 60 === 0) {
        const last = data[data.length - 1];
        const change = (Math.random() - 0.48) * 200;
        last.c += change;
        last.h = Math.max(last.h, last.c);
        last.l = Math.min(last.l, last.c);
      }

      requestAnimationFrame(drawChart);
    }
    drawChart();
  }

  // === Smooth scroll for anchor links ===
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = nav ? nav.offsetHeight : 0;
        window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
      }
    });
  });

})();
