import type { MailMessage, MailProvider } from './mail';
import { renderMail } from './mail-templates';

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
  /** 제목·본문에 넣는 브랜드 이름. 없으면 넣지 않는다. */
  brandName?: string;
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
    const rendered = renderMail(msg, {
        appBaseUrl: this.cfg.appBaseUrl,
        ...(this.cfg.brandName ? { brandName: this.cfg.brandName } : {}),
        ...(msg.meta && typeof msg.meta.locale === 'string' ? { locale: msg.meta.locale } : {}),
      });
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
    brandName: env.BRAND_NAME?.trim() || 'ChartControl AI',
    ...(env.MAIL_REPLY_TO?.trim() ? { replyTo: env.MAIL_REPLY_TO.trim() } : {}),
  });
}
