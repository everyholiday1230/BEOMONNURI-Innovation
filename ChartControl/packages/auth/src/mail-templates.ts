/*
   메일 본문 만들기 — 발송 경로(SMTP·Resend)가 함께 쓴다.

   왜 따로 두는가
   -------------
   호출부는 `text: 'Use the enclosed token to verify your email.'` 과 `meta.token`
   만 넘긴다. 그대로 보내면 **토큰도 링크도 없는 메일**이 나가서 사용자가 아무것도
   할 수 없다. 그래서 알고 있는 `meta.kind` 는 여기서 진짜 링크가 있는 본문으로
   만든다.

   전에는 이 로직이 Resend 파일 안에만 있었다. SMTP 경로를 추가하면서 같은 본문을
   써야 했고, 복사하면 한쪽만 고치는 일이 생긴다. 그래서 한 곳으로 옮겼다.

   ★★ 언어. 서비스 언어는 영어·일본어·중국어다. 전에는 본문이 한국어뿐이어서,
     일본 사용자가 읽을 수 없는 메일을 받았다. 이제 locale 을 받아 그 언어로
     쓰고, 모르면 영어로 쓴다(기본 언어).

   ★ 브랜드 이름을 본문과 제목에 넣는다. 발신자 이름만으로는 무슨 서비스의
     메일인지 알기 어렵고, 브랜드가 없는 인증 메일은 피싱처럼 보인다.
*/

import type { MailMessage } from './mail';

export interface MailRenderOptions {
  /** 링크를 만들 기준 주소. */
  appBaseUrl: string;
  /** 화면에 쓰는 브랜드 이름. 없으면 이름 없이 쓴다. */
  brandName?: string;
  /** 'en' | 'ja' | 'zh'. 그 외/미지정이면 영어. */
  locale?: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

type Lang = 'en' | 'ja' | 'zh';

function normalizeLang(locale: string | undefined): Lang {
  const v = (locale ?? '').toLowerCase();
  if (v.startsWith('ja')) return 'ja';
  if (v.startsWith('zh')) return 'zh';
  return 'en';
}

interface Copy {
  verifySubject: string;
  verifyLead: string;
  verifyButton: string;
  resetSubject: string;
  resetLead: string;
  resetButton: string;
  onceOnly: string;
  ignoreVerify: string;
  ignoreReset: string;
  fallbackLink: string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    verifySubject: 'Verify your email',
    verifyLead: 'Open the link below to finish verifying your email address.',
    verifyButton: 'Verify email',
    resetSubject: 'Reset your password',
    resetLead: 'Open the link below to set a new password.',
    resetButton: 'Reset password',
    onceOnly: 'This link can be used once and expires after a short time.',
    ignoreVerify: 'If you did not request this, ignore this email — nothing will change.',
    ignoreReset: 'If you did not request this, ignore this email — your password stays the same.',
    fallbackLink: 'If the button does not work, paste this address into your browser:',
  },
  ja: {
    verifySubject: 'メールアドレスの確認',
    verifyLead: '下のリンクを開いてメールアドレスの確認を完了してください。',
    verifyButton: 'メールを確認する',
    resetSubject: 'パスワードの再設定',
    resetLead: '下のリンクを開いて新しいパスワードを設定してください。',
    resetButton: 'パスワードを再設定',
    onceOnly: 'このリンクは一度だけ使用でき、一定時間で期限が切れます。',
    ignoreVerify: 'ご自身で申請していない場合は、このメールを無視してください。何も変わりません。',
    ignoreReset: 'ご自身で申請していない場合は、このメールを無視してください。パスワードは変更されません。',
    fallbackLink: 'ボタンが動作しない場合は、次のアドレスをブラウザに貼り付けてください:',
  },
  zh: {
    verifySubject: '验证你的邮箱',
    verifyLead: '打开下面的链接以完成邮箱验证。',
    verifyButton: '验证邮箱',
    resetSubject: '重置你的密码',
    resetLead: '打开下面的链接以设置新密码。',
    resetButton: '重置密码',
    onceOnly: '该链接只能使用一次，并会在一段时间后失效。',
    ignoreVerify: '如果不是你本人申请的，请忽略这封邮件 — 不会有任何变化。',
    ignoreReset: '如果不是你本人申请的，请忽略这封邮件 — 你的密码不会改变。',
    fallbackLink: '如果按钮无法使用，请把下面的地址粘贴到浏览器中:',
  },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:5px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

function layout(title: string, parts: string[], brandName?: string): string {
  const head = brandName
    ? `<div style="font-size:12px;letter-spacing:1px;color:#667;margin:0 0 12px">${escapeHtml(brandName.toUpperCase())}</div>`
    : '';
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1a1d23">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">',
    head,
    `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h1>`,
    ...parts,
    '</div></body></html>',
  ].join('');
}

/** 제목에 브랜드를 붙인다 — 받은 편지함에서 어느 서비스인지 바로 보이게. */
function withBrand(subject: string, brandName?: string): string {
  return brandName ? `[${brandName}] ${subject}` : subject;
}

export function renderMail(msg: MailMessage, opts: MailRenderOptions): RenderedMail {
  const base = opts.appBaseUrl.replace(/\/+$/u, '');
  const brand = opts.brandName?.trim() || undefined;
  const c = COPY[normalizeLang(opts.locale)];
  const kind = typeof msg.meta?.kind === 'string' ? msg.meta.kind : '';
  const token = typeof msg.meta?.token === 'string' ? msg.meta.token : '';

  if (kind === 'verify' && token !== '') {
    /* ★ 해시 라우터(SPA)다 — 경로형 링크(/verify-email)는 라우팅되지 않는다.
         반드시 #/ 형식으로 만들어야 클릭 시 인증 화면이 토큰을 받는다. */
    const link = `${base}/#/verify-email?token=${encodeURIComponent(token)}`;
    return {
      subject: withBrand(c.verifySubject, brand),
      text: [c.verifyLead, '', link, '', c.onceOnly, c.ignoreVerify, ...(brand ? ['', `— ${brand}`] : [])].join('\n'),
      html: layout(
        c.verifySubject,
        [
          `<p>${escapeHtml(c.verifyLead)}</p>`,
          button(link, c.verifyButton),
          `<p style="font-size:12px;color:#667">${escapeHtml(c.fallbackLink)}<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>`,
          `<p style="font-size:12px;color:#667">${escapeHtml(c.onceOnly)} ${escapeHtml(c.ignoreVerify)}</p>`,
        ],
        brand,
      ),
    };
  }

  if (kind === 'reset' && token !== '') {
    const link = `${base}/#/password-reset?token=${encodeURIComponent(token)}`;
    return {
      subject: withBrand(c.resetSubject, brand),
      text: [c.resetLead, '', link, '', c.onceOnly, c.ignoreReset, ...(brand ? ['', `— ${brand}`] : [])].join('\n'),
      html: layout(
        c.resetSubject,
        [
          `<p>${escapeHtml(c.resetLead)}</p>`,
          button(link, c.resetButton),
          `<p style="font-size:12px;color:#667">${escapeHtml(c.fallbackLink)}<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>`,
          /* 재설정 메일은 피싱의 전형적인 구실이다 — 요청하지 않은 사람은 무시해도 안전하다는 것을 알아야 한다. */
          `<p style="font-size:12px;color:#667">${escapeHtml(c.ignoreReset)}</p>`,
        ],
        brand,
      ),
    };
  }

  /* 모르는 종류 — 호출자가 준 문장을 그대로 보낸다. 없는 템플릿을 지어내지 않는다. */
  return {
    subject: withBrand(msg.subject, brand),
    text: msg.text,
    html: layout(msg.subject, [`<p>${escapeHtml(msg.text)}</p>`], brand),
  };
}
