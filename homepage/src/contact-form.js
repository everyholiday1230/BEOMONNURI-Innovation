/**
 * 문의 폼: 클라이언트 유효성 검사 + 접근성 + 제출 처리.
 * - FORM_ENDPOINT 설정 시 fetch(POST) 전송
 * - 미설정 시 mailto 기반 graceful fallback
 * - 전환율 개선: A/B 카피, 옵션 입력 접기/열기, 제출 후 안내 패널
 */
import { siteConfig } from '../site.config.js';
import { trackEvent } from './site.js';

const AB_VARIANTS = {
  ko: [
    {
      heroTitle: '성과 중심 도입 전략을 함께 설계합니다',
      heroLead: '관심 제품, 보유 데이터, 적용 업무를 알려주시면 검증 범위, 보안 기준, 운영 전환 계획까지 신뢰 가능한 실행안으로 정리해 드립니다.',
      submitLabel: '지금 도입안 제안받기'
    },
    {
      heroTitle: '우리 조직에 맞는 AI 도입 범위를 빠르게 정리합니다',
      heroLead: '핵심 정보만 남겨주시면 우선순위 과제와 적용 범위를 1차로 정리해 드립니다.',
      submitLabel: '적용 범위 빠르게 받기'
    }
  ],
  en: [
    {
      heroTitle: "Let's scope your rollout",
      heroLead: "Tell us the product you need, the data you hold, and the workflow you want to apply it to, and we'll outline a fitting scope and direction.",
      submitLabel: 'Send inquiry'
    },
    {
      heroTitle: 'Get a practical rollout scope, fast',
      heroLead: 'Share only essential context and we will propose a focused first-step scope for your team.',
      submitLabel: 'Get rollout scope'
    }
  ]
};

function setError(field, message) {
  field.dataset.invalid = message ? 'true' : 'false';
  const control = field.querySelector('input, select, textarea');
  const errEl = field.querySelector('.error-text');
  if (errEl) errEl.textContent = message || '';
  if (control) {
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
}

function validate(form, lang) {
  const msgs = lang === 'en'
    ? { req: 'This field is required.', email: 'Enter a valid email.', consent: 'Please agree to the privacy policy.' }
    : { req: '필수 입력 항목입니다.', email: '올바른 이메일을 입력해 주세요.', consent: '개인정보 수집·이용에 동의해 주세요.' };

  let firstInvalid = null;
  let ok = true;

  form.querySelectorAll('.field').forEach((field) => {
    const control = field.querySelector('input, select, textarea');
    if (!control || control.type === 'checkbox') return;
    let message = '';
    if (control.required && !control.value.trim()) {
      message = msgs.req;
    } else if (control.type === 'email' && control.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(control.value)) {
      message = msgs.email;
    }
    setError(field, message);
    if (message && !firstInvalid) firstInvalid = control;
    if (message) ok = false;
  });

  const consent = form.querySelector('input[name="consent"]');
  if (consent) {
    const cErr = form.querySelector('[data-consent-error]');
    if (!consent.checked) {
      if (cErr) cErr.textContent = msgs.consent;
      consent.setAttribute('aria-invalid', 'true');
      if (!firstInvalid) firstInvalid = consent;
      ok = false;
    } else {
      if (cErr) cErr.textContent = '';
      consent.setAttribute('aria-invalid', 'false');
    }
  }

  if (firstInvalid) firstInvalid.focus();
  return ok;
}

function buildMailto(data, lang) {
  const subject = encodeURIComponent(
    (lang === 'en' ? 'AI product inquiry — ' : 'AI 제품 도입 문의 — ') + (data.company || '')
  );
  const lines = lang === 'en'
    ? [
        `Company: ${data.company}`,
        `Name: ${data.name}`,
        `Email: ${data.email}`,
        `Phone: ${data.phone || ''}`,
        `Product: ${data.product}`,
        `Data types: ${data.dataType || ''}`,
        '',
        'Message:',
        data.message
      ]
    : [
        `회사명: ${data.company}`,
        `담당자: ${data.name}`,
        `이메일: ${data.email}`,
        `연락처: ${data.phone || ''}`,
        `관심 제품: ${data.product}`,
        `보유 데이터: ${data.dataType || ''}`,
        '',
        '문의 내용:',
        data.message
      ];
  return `mailto:${siteConfig.EMAIL}?subject=${subject}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function pickVariant(lang) {
  const key = `contact_ab_v1_${lang}`;
  const stored = window.localStorage.getItem(key);
  if (stored === '0' || stored === '1') return Number(stored);
  const idx = Math.random() < 0.5 ? 0 : 1;
  window.localStorage.setItem(key, String(idx));
  return idx;
}

function applyAbCopy(form, lang) {
  const variants = AB_VARIANTS[lang] || AB_VARIANTS.ko;
  const variantIndex = pickVariant(lang);
  const chosen = variants[variantIndex] || variants[0];
  const hero = document.querySelector('.contact-hero');
  const heroTitle = hero?.querySelector('h1');
  const heroLead = hero?.querySelector('.lead');
  const submitBtn = form.querySelector('[type="submit"]');

  if (heroTitle) heroTitle.textContent = chosen.heroTitle;
  if (heroLead) heroLead.textContent = chosen.heroLead;
  if (submitBtn) submitBtn.textContent = chosen.submitLabel;

  form.dataset.abVariant = String(variantIndex);
  trackEvent('contact_ab_variant_assigned', {
    lang,
    ab_variant: String(variantIndex)
  });
}

function showSuccessPanel(form, lang, endpointEnabled) {
  const panel = form.querySelector('.form-success-panel');
  if (!panel) return;

  const title = lang === 'en'
    ? 'Inquiry received — next steps'
    : '문의 접수 완료 — 다음 단계 안내';
  const desc = endpointEnabled
    ? (lang === 'en' ? 'Our team will review your request and reply shortly.' : '요청 내용을 검토 후 빠르게 회신드리겠습니다.')
    : (lang === 'en' ? 'Your email client has been opened. If needed, send directly to our team email.' : '메일 작성 화면이 열렸습니다. 필요 시 운영 메일로 직접 전송해 주세요.');
  const items = lang === 'en'
    ? ['We review your use case and constraints.', 'We send a scoped rollout proposal.', 'We align pilot timeline and success metrics.']
    : ['적용 업무와 제약 조건을 우선 검토합니다.', '조직 맞춤 적용 범위를 제안드립니다.', '파일럿 일정과 검증 지표를 함께 확정합니다.'];

  panel.innerHTML = `
    <h3>${title}</h3>
    <p>${desc}</p>
    <ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>
  `;
  panel.hidden = false;
}

function initContactForm() {
  const form = document.querySelector('#contact-form');
  if (!form) return;

  const lang = document.body.dataset.lang === 'en' ? 'en' : 'ko';
  const status = form.querySelector('.form-status');

  applyAbCopy(form, lang);

  const showStatus = (type, text) => {
    if (!status) return;
    status.className = `form-status is-${type}`;
    status.textContent = text;
    status.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  let formStarted = false;
  const markFormStarted = () => {
    if (formStarted) return;
    formStarted = true;
    trackEvent('contact_form_start', {
      lang,
      ab_variant: form.dataset.abVariant || '0'
    });
  };

  form.querySelectorAll('input, select, textarea').forEach((control) => {
    control.addEventListener('focus', markFormStarted, { once: true });
    control.addEventListener('input', () => {
      const field = control.closest('.field');
      if (field && field.dataset.invalid === 'true') setError(field, '');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form, lang)) {
      trackEvent('contact_form_validation_error', {
        lang,
        ab_variant: form.dataset.abVariant || '0'
      });
      return;
    }

    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const endpoint = siteConfig.FORM_ENDPOINT;

    trackEvent('contact_form_submit_attempt', {
      lang,
      ab_variant: form.dataset.abVariant || '0',
      product: String(data.product || '').slice(0, 60)
    });

    if (!endpoint) {
      showSuccessPanel(form, lang, false);
      showStatus('success', lang === 'en'
        ? 'Opening your email client. If it does not open, please email us directly.'
        : '메일 작성 화면을 엽니다. 열리지 않으면 이메일로 직접 보내주세요.');
      trackEvent('contact_form_mailto_fallback', {
        lang,
        ab_variant: form.dataset.abVariant || '0',
        product: String(data.product || '').slice(0, 60)
      });
      window.location.href = buildMailto(data, lang);
      return;
    }

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Request failed');
      form.reset();
      showSuccessPanel(form, lang, true);
      showStatus('success', lang === 'en'
        ? 'Thank you. Your inquiry has been received and we will get back to you shortly.'
        : '문의가 정상적으로 접수되었습니다. 빠른 시일 내에 회신드리겠습니다.');
      trackEvent('contact_form_submit_success', {
        lang,
        ab_variant: form.dataset.abVariant || '0',
        product: String(data.product || '').slice(0, 60)
      });
    } catch (err) {
      showStatus('error', lang === 'en'
        ? 'Submission failed. Please email us directly.'
        : '전송에 실패했습니다. 이메일로 직접 보내주세요.');
      trackEvent('contact_form_submit_failure', {
        lang,
        ab_variant: form.dataset.abVariant || '0',
        error: 'request_failed'
      });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', initContactForm);
