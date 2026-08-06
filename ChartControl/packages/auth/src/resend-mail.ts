import type { MailMessage, MailProvider } from './mail';

/**
 * Resend mail provider.
 *
 * Implemented against Resend's REST API with `fetch` rather than the `resend` SDK. The SDK would add a
 * dependency and a vendor-shaped surface for what is one POST; keeping it at the REST boundary means swapping
 * to SES or SMTP later touches this file only.
 *
 * Two properties matter more than the transport:
 *
 *  1. **The raw token never appears in a log or an error.** `MailMessage.meta` carries it for the templates
 *     below, and nothing else reads it. A failed send reports the recipient and the vendor's error id — not
 *     the body.
 *  2. **A send failure is thrown, not swallowed.** A user who never receives a verification link and gets a
 *     "check your email" screen anyway has no way to recover, and support has no record. The caller decides
 *     whether that is fatal.
 */

export interface ResendConfig {
  apiKey: string;
  /** Verified sender, e.g. `QuantumTrade <no-reply@example.com>`. Resend rejects unverified domains. */
  from: string;
  /**
   * Public base URL of the web app, used to build the links users click.
   *
   * Required: a verification e-mail whose link points at `localhost` is useless in production, and one with
   * no link at all — which is what the current templates produced — is worse.
   */
  appBaseUrl: string;
  /** Optional reply-to. */
  replyTo?: string;
  fetchImpl?: typeof fetch;
  /** Milliseconds before a send is abandoned. */
  timeoutMs?: number;
}

export class MailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Resend's own error name/id when present, for correlating with their dashboard. */
    readonly vendorCode?: string,
  ) {
    super(message);
    this.name = 'MailSendError';
  }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Builds the user-facing body for a message.
 *
 * The existing call sites pass `text: 'Use the enclosed token to verify your email.'` with the token only in
 * `meta`. Sent verbatim that is an e-mail with no token and no link — the user cannot act on it. So known
 * `meta.kind` values are rendered into a real body with a real link here, and anything unrecognised falls
 * back to the caller's text.
 */
export function renderMail(
  msg: MailMessage,
  appBaseUrl: string,
): { subject: string; text: string; html: string } {
  const base = appBaseUrl.replace(/\/+$/u, '');
  const kind = typeof msg.meta?.kind === 'string' ? msg.meta.kind : '';
  const token = typeof msg.meta?.token === 'string' ? msg.meta.token : '';

  if (kind === 'verify' && token !== '') {
    const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
    return {
      subject: '이메일 인증',
      text: [
        '이메일 인증을 완료하려면 아래 링크를 여세요.',
        '',
        link,
        '',
        '이 링크는 한 번만 사용할 수 있습니다.',
        '본인이 요청하지 않았다면 이 메일을 무시하세요. 계정은 생성되지 않은 상태로 남습니다.',
      ].join('\n'),
      html: layout('이메일 인증', [
        '<p>이메일 인증을 완료하려면 아래 버튼을 누르세요.</p>',
        button(link, '이메일 인증'),
        `<p style="font-size:12px;color:#667">버튼이 동작하지 않으면 이 주소를 붙여넣으세요:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>`,
        '<p style="font-size:12px;color:#667">이 링크는 한 번만 사용할 수 있습니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>',
      ]),
    };
  }

  if (kind === 'reset' && token !== '') {
    const link = `${base}/password-reset?token=${encodeURIComponent(token)}`;
    return {
      subject: '비밀번호 재설정',
      text: [
        '비밀번호를 재설정하려면 아래 링크를 여세요.',
        '',
        link,
        '',
        '이 링크는 한 번만 사용할 수 있으며 일정 시간 후 만료됩니다.',
        '본인이 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 변경되지 않습니다.',
      ].join('\n'),
      html: layout('비밀번호 재설정', [
        '<p>비밀번호를 재설정하려면 아래 버튼을 누르세요.</p>',
        button(link, '비밀번호 재설정'),
        `<p style="font-size:12px;color:#667">버튼이 동작하지 않으면 이 주소를 붙여넣으세요:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>`,
        // Stated because a reset e-mail is the classic phishing pretext; a user who did not ask must know
        // that ignoring it is safe.
        '<p style="font-size:12px;color:#667">본인이 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 변경되지 않습니다.</p>',
      ]),
    };
  }

  // Unrecognised kind: send the caller's text as-is rather than inventing a template for it.
  return { subject: msg.subject, text: msg.text, html: layout(msg.subject, [`<p>${escapeHtml(msg.text)}</p>`]) };
}

function escapeHtml(s: string): string {
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

function layout(title: string, parts: string[]): string {
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1a1d23">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">',
    `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h1>`,
    ...parts,
    '</div></body></html>',
  ].join('');
}

export class ResendMailProvider implements MailProvider {
  readonly name = 'resend';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: ResendConfig) {
    if (cfg.apiKey.trim() === '') throw new Error('ResendMailProvider: apiKey is required');
    if (cfg.from.trim() === '') throw new Error('ResendMailProvider: from is required');
    // Fail at construction, not at the first send: a deployment missing this would otherwise look healthy
    // until the first user tried to register.
    if (!/^https?:\/\//u.test(cfg.appBaseUrl)) {
      throw new Error('ResendMailProvider: appBaseUrl must be an absolute http(s) URL');
    }
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  async send(msg: MailMessage): Promise<void> {
    const rendered = renderMail(msg, this.cfg.appBaseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: [msg.to],
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          ...(this.cfg.replyTo ? { reply_to: this.cfg.replyTo } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
        // The recipient and the vendor code, never the body — the body contains the token.
        throw new MailSendError(
          `resend rejected the message for ${msg.to}: ${body?.message ?? `HTTP ${res.status}`}`,
          res.status,
          body?.name,
        );
      }
    } catch (e) {
      if (e instanceof MailSendError) throw e;
      // A timeout or transport failure is still a failure to deliver. Swallowing it would show the user a
      // "check your email" screen for a message that was never sent.
      throw new MailSendError(
        `resend send failed for ${msg.to}: ${(e as Error).message}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Builds a provider from the environment, or returns null when mail is not configured.
 *
 * Null rather than a silent sink: the caller logs the fact so an operator can see that verification e-mails
 * are not going out, instead of discovering it from a user complaint.
 */
export function resendFromEnv(env: NodeJS.ProcessEnv = process.env): ResendMailProvider | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!apiKey || !from || !appBaseUrl) return null;
  return new ResendMailProvider({
    apiKey,
    from,
    appBaseUrl,
    ...(env.MAIL_REPLY_TO?.trim() ? { replyTo: env.MAIL_REPLY_TO.trim() } : {}),
  });
}
