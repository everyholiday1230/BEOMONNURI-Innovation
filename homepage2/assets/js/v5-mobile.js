/* =========================================================
   BEOMONNURI — MOBILE NAV (hamburger + fullscreen menu)
   ========================================================= */

(() => {
  const initMobileNav = () => {
    const nav = document.querySelector('nav.top');
    if (!nav) return;
    // Avoid double-init
    if (nav.dataset.mobileInit) return;
    nav.dataset.mobileInit = '1';

    // Detect current active link from existing nav (so we can mirror it in mobile menu)
    const existingActive = nav.querySelector('.nav-links a.active');
    const activeHref = existingActive ? existingActive.getAttribute('href') : null;
    const isActive = (href) => activeHref === href ? ' class="active"' : '';

    // Build hamburger button
    const hamburger = document.createElement('button');
    hamburger.className = 'nav-hamburger';
    hamburger.setAttribute('aria-label', 'Toggle navigation menu');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.innerHTML = `<span class="bars">
      <span></span><span></span><span></span>
    </span>`;
    // Insert into nav row (after .nav-links so it sits at the right)
    const navRow = nav.querySelector('.row');
    navRow.appendChild(hamburger);

    // Build fullscreen mobile menu — mirrors the desktop nav 1:1
    // (Home / Products + its 4 sub-links / Why / Contact) so mobile users
    // reach the exact same destinations as desktop users.
    const menu = document.createElement('aside');
    menu.className = 'mobile-menu';
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <div class="mobile-menu-inner">
        <div class="mobile-menu-label">BEOMONNURI · MENU</div>
        <nav aria-label="Mobile primary">
          <a href="index.html"${isActive('index.html')}>
            <span>HOME</span><span class="num">01</span>
          </a>
          <a href="products.html"${isActive('products.html')}>
            <span>PRODUCTS</span><span class="num">02</span>
          </a>
          <a href="products-private.html" class="sub"${isActive('products-private.html')}>
            <span>· 범온 프라이빗 AI</span><span class="num">02-1</span>
          </a>
          <a href="products-agent.html" class="sub"${isActive('products-agent.html')}>
            <span>· 범온 에이전트 AI</span><span class="num">02-2</span>
          </a>
          <a href="products-superchart.html" class="sub"${isActive('products-superchart.html')}>
            <span>· 범온 슈퍼차트 AI</span><span class="num">02-3</span>
          </a>
          <a href="services-outsourcing.html" class="sub"${isActive('services-outsourcing.html')}>
            <span>· 외주·MVP 제작</span><span class="num">02-4</span>
          </a>
          <a href="why.html"${isActive('why.html')}>
            <span>WHY</span><span class="num">03</span>
          </a>
          <a href="contact.html"${isActive('contact.html')}>
            <span>CONTACT</span><span class="num">04</span>
          </a>
        </nav>
        <div class="cta-row">
          <a href="contact.html">
            <span>도입 진단 신청</span>
            <span>→</span>
          </a>
        </div>
        <div class="meta-row">
          <span class="live">SYSTEM LIVE · KR-PRIVATE · STATUS</span>
          <span>© 2026 BEOMONNURI INC. · v2.6</span>
        </div>
      </div>
    `;
    document.body.appendChild(menu);

    // Toggle logic
    const open = () => {
      document.body.classList.add('nav-open');
      hamburger.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
    };
    const close = () => {
      document.body.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    };
    const toggle = () => {
      document.body.classList.contains('nav-open') ? close() : open();
    };

    hamburger.addEventListener('click', toggle);

    // Close on nav link click (single-page apps would need slight delay before navigation)
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        // Let the navigation happen — close just before
        close();
      });
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) close();
    });

    // Close when resizing back to desktop
    let resizeTimer;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (innerWidth > 900 && document.body.classList.contains('nav-open')) close();
      }, 150);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNav);
  } else {
    initMobileNav();
  }
})();
