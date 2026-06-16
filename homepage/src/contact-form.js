/**
 * 문의 폼: 클라이언트 유효성 검사 + 접근성 + 제출 처리.
 * - FORM_ENDPOINT 설정 시 fetch(POST) 전송
 * - 미설정 시 mailto 기반 graceful fallback
 */
import { siteConfig } from '../site.config.js';

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

  // consent
  const consent = form.querySelector('input[name="consent"]');
  if (consent) {
    const cField = consent.closest('.consent');
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
        `Company: ${data.company}`, `Name: ${data.name}`, `Email: ${data.email}`,
        `Phone: ${data.phone}`, `Product: ${data.product}`, `Data types: ${data.dataType}`,
        '', `Message:`, data.message
      ]
    : [
        `회사명: ${data.company}`, `담당자: ${data.name}`, `이메일: ${data.email}`,
        `연락처: ${data.phone}`, `관심 제품: ${data.product}`, `보유 데이터: ${data.dataType}`,
        '', `문의 내용:`, data.message
      ];
  return `mailto:${siteConfig.EMAIL}?subject=${subject}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function initContactForm() {
  const form = document.querySelector('#contact-form');
  if (!form) return;
  const lang = document.body.dataset.lang === 'en' ? 'en' : 'ko';
  const status = form.querySelector('.form-status');

  const showStatus = (type, text) => {
    if (!status) return;
    status.className = `form-status is-${type}`;
    status.textContent = text;
    status.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // 실시간 에러 해제
  form.querySelectorAll('input, select, textarea').forEach((control) => {
    control.addEventListener('input', () => {
      const field = control.closest('.field');
      if (field && field.dataset.invalid === 'true') setError(field, '');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form, lang)) return;

    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const endpoint = siteConfig.FORM_ENDPOINT;

    if (!endpoint) {
      // graceful fallback: 메일 클라이언트로 안내
      window.location.href = buildMailto(data, lang);
      showStatus('success', lang === 'en'
        ? 'Opening your email client. If it does not open, please email us directly.'
        : '메일 작성 화면을 엽니다. 열리지 않으면 이메일로 직접 보내주세요.');
      return;
    }

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Request failed');
      form.reset();
      showStatus('success', lang === 'en'
        ? 'Thank you. Your inquiry has been received and we will get back to you shortly.'
        : '문의가 정상적으로 접수되었습니다. 빠른 시일 내에 회신드리겠습니다.');
    } catch (err) {
      showStatus('error', lang === 'en'
        ? 'Submission failed. Please email us directly.'
        : '전송에 실패했습니다. 이메일로 직접 보내주세요.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', initContactForm);
