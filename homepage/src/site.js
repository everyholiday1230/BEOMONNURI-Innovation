/**
 * 공통 UI 런타임 (헤더 / 푸터 / 모션 / 폼 / FAQ).
 * 모든 페이지가 이 모듈 하나를 로드한다.
 *
 * 각 페이지는 <body data-page="home" data-lang="ko"> 처럼 컨텍스트를 주고,
 * 헤더/푸터는 여기서 일관되게 렌더링한다. (20페이지 중복 제거)
 */
import { siteConfig } from '../site.config.js';
import { mountIcons, iconSvg } from './icons.js';

/* ───────────────────────── i18n 라벨 ───────────────────────── */
const T = {
  ko: {
    skip: '본문 바로가기',
    company: 'AI Product Company',
    nav: { home: '홈', products: '제품', company: '회사', contact: '문의', cta: '상담하기' },
    menuOpen: '메뉴 열기',
    footerTagline: '산업 현장에서 신뢰할 수 있는 운영 지능 제품을 설계하고 운영합니다.',
    footerNavTitle: '바로가기',
    footerCompanyTitle: '회사 정보',
    footerContactTitle: '문의',
    privacy: '개인정보처리방침',
    rights: 'All rights reserved.',
    labels: {
      ceo: '대표자', addr: '주소', founded: '설립', email: '이메일'
    }
  },
  en: {
    skip: 'Skip to content',
    company: 'AI Product Company',
    nav: { home: 'Home', products: 'Products', company: 'Company', contact: 'Contact', cta: 'Get in touch' },
    menuOpen: 'Open menu',
    footerTagline: 'We design and operate dependable operating-intelligence products for real industrial environments.',
    footerNavTitle: 'Explore',
    footerCompanyTitle: 'Company',
    footerContactTitle: 'Contact',
    privacy: 'Privacy Policy',
    rights: 'All rights reserved.',
    labels: {
      ceo: 'CEO', addr: 'Address', founded: 'Founded', email: 'Email'
    }
  }
};

/* 경로 prefix (en 이면 /en) */
function base(lang) { return lang === 'en' ? '/en' : ''; }

/* 네비게이션 정의 */
function navItems(lang) {
  const b = base(lang);
  return [
    { key: 'home', href: `${b}/` },
    { key: 'products', href: `${b}/products/` },
    { key: 'company', href: `${b}/company/` },
    { key: 'contact', href: `${b}/contact/` }
  ];
}

/* 제품 드롭다운 항목 */
function productItems(lang) {
  const b = base(lang);
  const ko = [
    ['범온 프라이빗 AI', 'private-ai'],
    ['범온 슈퍼차트 AI', 'superchart-ai'],
    ['범온 에이전트 AI', 'agent-ai'],
    ['범온 농산물 출하 AI', 'farm-shipping-ai'],
    ['범온 원자재 조달 AI', 'commodity-procurement-ai'],
    ['범온 공동주택 관리 AI', 'apartment-management-ai']
  ];
  const en = [
    ['Beomon Private AI', 'private-ai'],
    ['Beomon SuperChart AI', 'superchart-ai'],
    ['Beomon Agent AI', 'agent-ai'],
    ['Beomon Farm Shipping AI', 'farm-shipping-ai'],
    ['Beomon Commodity Procurement AI', 'commodity-procurement-ai'],
    ['Beomon Apartment Management AI', 'apartment-management-ai']
  ];
  return (lang === 'en' ? en : ko).map(([label, slug]) => ({ label, href: `${b}/products/${slug}/` }));
}

/* ───────────────────────── 헤더 ───────────────────────── */
function renderHeader(lang, page) {
  const t = T[lang];
  const b = base(lang);
  const items = navItems(lang)
    .map((it) => {
      const active = it.key === page ? ' aria-current="page" class="active"' : '';
      if (it.key === 'products') {
        const sub = productItems(lang)
          .map((pi) => `<li><a href="${pi.href}">${pi.label}</a></li>`)
          .join('');
        const allLabel = lang === 'en' ? 'All products' : '전체 제품';
        return `<li class="has-dropdown">
          <a${active} href="${it.href}" aria-haspopup="true" aria-expanded="false">${t.nav[it.key]}
            <span class="caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg></span>
          </a>
          <ul class="dropdown" role="menu">
            <li><a href="${it.href}" class="dropdown-all">${allLabel}</a></li>
            ${sub}
          </ul>
        </li>`;
      }
      return `<li><a${active} href="${it.href}">${t.nav[it.key]}</a></li>`;
    })
    .join('');

  // 언어 토글: 현재 경로에서 언어만 교체
  const path = window.location.pathname;
  const koPath = path.replace(/^\/en(\/|$)/, '/');
  const enPath = path.startsWith('/en') ? path : `/en${path === '/' ? '/' : path}`;
  const koActive = lang === 'ko' ? ' class="active"' : '';
  const enActive = lang === 'en' ? ' class="active"' : '';

  return `
<a class="skip-link" href="#main-content">${t.skip}</a>
<header class="site-header">
  <nav class="nav-shell" aria-label="${lang === 'en' ? 'Primary' : '주요 메뉴'}">
    <a class="brand" href="${b}/" aria-label="${siteConfig.COMPANY_NAME_KR}">
      <img src="/assets/logo.png" alt="${lang === 'en' ? siteConfig.COMPANY_NAME_EN : siteConfig.COMPANY_NAME_KR} logo" width="46" height="64" />
      <span><strong>${lang === 'en' ? 'BEOMON NURI' : siteConfig.COMPANY_NAME_KR}</strong><small>${t.company}</small></span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation">
      <span class="sr-only">${t.menuOpen}</span><span></span><span></span><span></span>
    </button>
    <ul class="nav-links" id="primary-navigation">
      ${items}
      <li><a class="nav-cta" href="${b}/contact/">${t.nav.cta}</a></li>
      <li class="language-switch" aria-label="Language selection">
        <a${koActive} href="${koPath}" hreflang="ko">KR</a><a${enActive} href="${enPath}" hreflang="en">EN</a>
      </li>
    </ul>
  </nav>
</header>`;
}

/* ───────────────────────── 푸터 ───────────────────────── */
function renderFooter(lang) {
  const t = T[lang];
  const b = base(lang);
  const L = t.labels;
  const company = lang === 'en' ? siteConfig.COMPANY_NAME_EN : siteConfig.COMPANY_NAME_KR;
  const ceo = lang === 'en' ? (siteConfig.CEO_NAME_EN || siteConfig.CEO_NAME) : siteConfig.CEO_NAME;
  const addr = lang === 'en' ? siteConfig.ADDRESS_EN : siteConfig.ADDRESS_KR;
  const year = new Date().getFullYear();

  return `
<footer class="site-footer">
  <div class="footer-inner">
    <section class="footer-col footer-about">
      <a class="footer-brand" href="${b}/"><img src="/assets/logo.png" alt="" width="34" height="48" />${company}</a>
      <p>${t.footerTagline}</p>
    </section>
    <nav class="footer-col" aria-label="${t.footerNavTitle}">
      <h2>${t.footerNavTitle}</h2>
      <a href="${b}/products/">${t.nav.products}</a>
      <a href="${b}/company/">${t.nav.company}</a>
      <a href="${b}/contact/">${t.nav.contact}</a>
      <a href="${b}/privacy/">${t.privacy}</a>
    </nav>
    <section class="footer-col footer-company">
      <h2>${t.footerCompanyTitle}</h2>
      <dl class="footer-meta">
        <div><dt>${L.ceo}</dt><dd>${ceo}</dd></div>
        <div><dt>${L.addr}</dt><dd>${addr}</dd></div>
        <div><dt>${L.founded}</dt><dd>${siteConfig.FOUNDED_YEAR}</dd></div>
      </dl>
    </section>
    <section class="footer-col footer-contact">
      <h2>${t.footerContactTitle}</h2>
      <a class="footer-email" href="mailto:${siteConfig.EMAIL}">${siteConfig.EMAIL}</a>
    </section>
  </div>
  <div class="footer-legal">
    <p class="copyright">© ${year} ${siteConfig.COMPANY_NAME_EN}. ${t.rights}</p>
  </div>
</footer>`;
}

/* ───────────────────────── 모바일 내비 / 모션 ───────────────────────── */
function initNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('#primary-navigation');
  if (!navToggle || !navLinks) return;

  const setOpen = (open) => {
    navToggle.setAttribute('aria-expanded', String(open));
    navLinks.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
  };
  navToggle.addEventListener('click', () => {
    setOpen(navToggle.getAttribute('aria-expanded') !== 'true');
  });
  navLinks.querySelectorAll('a').forEach((link) =>
    link.addEventListener('click', () => setOpen(false))
  );
  // Esc 로 닫기 + 포커스 복귀
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
      setOpen(false);
      navToggle.focus();
    }
  });

  // 모바일 메뉴 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    const shell = document.querySelector('.nav-shell');
    if (!shell) return;
    if (navLinks.classList.contains('is-open') && !shell.contains(e.target)) {
      setOpen(false);
    }
  });

  // 제품 드롭다운: 모바일/터치/키보드 토글 (데스크톱 hover는 CSS)
  const dd = navLinks.querySelector('.has-dropdown');
  if (dd) {
    const trigger = dd.querySelector('a[aria-haspopup]');
    const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
    trigger.addEventListener('click', (e) => {
      // 모바일에서는 첫 탭에 펼치기(바로 이동 방지), 데스크톱은 그대로 이동
      if (isMobile()) {
        const open = dd.classList.toggle('open');
        trigger.setAttribute('aria-expanded', String(open));
        if (open) e.preventDefault();
      }
    });
    // 데스크톱 키보드 접근: 포커스 시 열기, blur 시 닫기
    dd.addEventListener('focusin', () => trigger.setAttribute('aria-expanded', 'true'));
    dd.addEventListener('focusout', (e) => {
      if (!dd.contains(e.relatedTarget)) trigger.setAttribute('aria-expanded', 'false');
    });
    // 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (!dd.contains(e.target)) { dd.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }
    });

    // 뷰포트 변경 시 메뉴 상태 정리
    window.addEventListener('resize', () => {
      if (!window.matchMedia('(max-width: 760px)').matches) {
        setOpen(false);
        dd.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

function initReveal() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('[data-reveal], .reveal-item');
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.01, rootMargin: '0px 0px -8% 0px' }
  );
  targets.forEach((el) => {
    el.classList.add('reveal-item');
    io.observe(el);
  });
  // 안전장치: 어떤 이유로든 3초 내 표시 안 된 요소는 강제로 표시
  window.setTimeout(() => {
    targets.forEach((el) => el.classList.add('is-visible'));
  }, 3000);
}

/* ───────────────────────── FAQ 아코디언 ───────────────────────── */
function initFaq() {
  document.querySelectorAll('.faq-item > button.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = expanded;
    });
  });
}

/* ───────────────────────── 부트스트랩 ───────────────────────── */
export function mountLayout() {
  const body = document.body;
  const lang = body.dataset.lang === 'en' ? 'en' : 'ko';
  const page = body.dataset.page || '';

  const headerMount = document.querySelector('[data-layout="header"]');
  const footerMount = document.querySelector('[data-layout="footer"]');
  if (headerMount) headerMount.outerHTML = renderHeader(lang, page);
  if (footerMount) footerMount.outerHTML = renderFooter(lang);

  initNav();
  initReveal();
  initFaq();
  mountIcons();
}

document.addEventListener('DOMContentLoaded', mountLayout);
