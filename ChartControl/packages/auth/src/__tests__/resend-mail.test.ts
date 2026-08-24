import { describe, it, expect, vi } from 'vitest';
import { MailSendError, ResendMailProvider, resendFromEnv, type ResendConfig } from '../resend-mail';
import { renderMail } from '../mail-templates';
import type { MailMessage } from '../mail';

/**
 * Resend mail provider.
 *
 * The gap this closed matters more than the transport: the existing call sites pass
 * `text: 'Use the enclosed token to verify your email.'` with the token only in `meta`. Sent verbatim that is
 * an e-mail containing no token and no link — the user cannot verify, and support has nothing to work with.
 * These tests pin that a real, clickable link is produced, and that a failed send is never silent.
 */

const VERIFY: MailMessage = {
  to: 'u@example.com',
  subject: 'Verify your email',
  text: 'Use the enclosed token to verify your email.',
  meta: { token: 'tok-abc-123', kind: 'verify' },
};

const RESET: MailMessage = {
  to: 'u@example.com',
  subject: 'Password reset',
  text: 'Use the enclosed token to reset your password.',
  meta: { token: 'tok-reset-789', kind: 'reset' },
};

const ok = () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'content-type': 'application/json' } });

function provider(fetchImpl: typeof fetch, over: Partial<ResendConfig> = {}) {
  return new ResendMailProvider({
    apiKey: 'test-key',
    from: 'QuantumTrade <no-reply@example.com>',
    appBaseUrl: 'https://app.example.com',
    fetchImpl,
    ...over,
  });
}

describe('MAIL-01 the body contains an actual link', () => {
  it('[1] a verification message renders a link to /verify-email?token=', () => {
    const r = renderMail(VERIFY, { appBaseUrl: 'https://app.example.com' });
    // Without this the e-mail said "use the enclosed token" and enclosed nothing.
    expect(r.text).toContain('https://app.example.com/#/verify-email?token=tok-abc-123');
    expect(r.html).toContain('https://app.example.com/#/verify-email?token=tok-abc-123');
    /* 서비스 언어는 영어·일본어·중국어다 — 기본은 영어(전에는 한국어뿐이었다). */
    expect(r.subject).toBe('Verify your email');
  });

  it('[2] a reset message renders a link to /password-reset?token=', () => {
    const r = renderMail(RESET, { appBaseUrl: 'https://app.example.com' });
    expect(r.text).toContain('https://app.example.com/#/password-reset?token=tok-reset-789');
    // A reset e-mail is the classic phishing pretext, so a user who did not request it must be told that
    // ignoring it is safe.
    expect(r.text).toMatch(/If you did not request this/u);
  });

  it('[3] a trailing slash on the base URL does not double up', () => {
    expect(renderMail(VERIFY, { appBaseUrl: 'https://app.example.com/' }).text).toContain('https://app.example.com/#/verify-email?');
  });

  it('[4] the token is URL-encoded', () => {
    const r = renderMail({ ...VERIFY, meta: { token: 'a b/c+d', kind: 'verify' } }, { appBaseUrl: 'https://x.com' });
    expect(r.text).toContain('token=a%20b%2Fc%2Bd');
  });

  it('[5] an unrecognised kind falls back to the caller text rather than a wrong template', () => {
    const r = renderMail({ to: 'a@b.c', subject: 'Notice', text: 'Hello', meta: { kind: 'something-new' } }, { appBaseUrl: 'https://x.com' });
    expect(r.subject).toBe('Notice');
    expect(r.text).toBe('Hello');
    // No invented link for a kind we do not know how to build one for.
    expect(r.text).not.toContain('http');
  });

  it('[6] a missing token falls back rather than producing a link to nothing', () => {
    const r = renderMail({ ...VERIFY, meta: { kind: 'verify' } }, { appBaseUrl: 'https://x.com' });
    // `?token=` with an empty value would look valid and fail on click.
    expect(r.text).not.toContain('token=');
    expect(r.text).toBe(VERIFY.text);
  });

  it('[7] HTML is escaped so a hostile subject cannot inject markup', () => {
    const r = renderMail({ to: 'a@b.c', subject: '<img src=x onerror=alert(1)>', text: 'x' }, { appBaseUrl: 'https://x.com' });
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;img');
  });
});

describe('MAIL-02 transport', () => {
  it('[1] posts to Resend with bearer auth and both bodies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const spy = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return ok();
    });
    await provider(spy as unknown as typeof fetch).send(VERIFY);

    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as { to: string[]; text: string; html: string; from: string };
    expect(body.to).toEqual(['u@example.com']);
    // Both parts: a text-only mail lands in spam more often, an HTML-only one breaks in plain-text clients.
    expect(body.text).toContain('/#/verify-email?token=');
    expect(body.html).toContain('/#/verify-email?token=');
    expect(body.from).toContain('no-reply@example.com');
  });

  it('[2] a vendor rejection throws with the status and vendor code', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'validation_error', message: 'from is not verified' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const p = provider(spy as unknown as typeof fetch);
    await expect(p.send(VERIFY)).rejects.toThrow(MailSendError);
    await expect(p.send(VERIFY)).rejects.toThrow(/from is not verified/u);
    try {
      await p.send(VERIFY);
    } catch (e) {
      expect((e as MailSendError).status).toBe(422);
      expect((e as MailSendError).vendorCode).toBe('validation_error');
    }
  });

  it('[3] the raw token never appears in the thrown error', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ name: 'e', message: 'boom' }), { status: 500 }));
    try {
      await provider(spy as unknown as typeof fetch).send(VERIFY);
      throw new Error('should have thrown');
    } catch (e) {
      // Errors reach logs. A verification token in a log is a takeover primitive.
      expect((e as Error).message).not.toContain('tok-abc-123');
      expect((e as Error).message).toContain('u@example.com');
    }
  });

  it('[4] a transport failure is thrown, not swallowed', async () => {
    const spy = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    // Swallowing would show the user "check your email" for a message that was never sent.
    await expect(provider(spy as unknown as typeof fetch).send(VERIFY)).rejects.toThrow(/ECONNREFUSED/u);
  });

  it('[5] reply-to is sent only when configured', async () => {
    const bodies: Record<string, unknown>[] = [];
    const spy = vi.fn(async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return ok();
    });
    await provider(spy as unknown as typeof fetch).send(VERIFY);
    expect(bodies[0]!.reply_to).toBeUndefined();
    await provider(spy as unknown as typeof fetch, { replyTo: 'help@example.com' }).send(VERIFY);
    expect(bodies[1]!.reply_to).toBe('help@example.com');
  });
});

describe('MAIL-03 configuration fails fast', () => {
  it('[1] an empty key or sender is refused at construction', () => {
    // Not at the first send: a deployment missing this would look healthy until a user tried to register.
    expect(() => provider(fetch, { apiKey: '' })).toThrow(/apiKey/u);
    expect(() => provider(fetch, { from: '' })).toThrow(/from/u);
  });

  it('[2] a relative or missing base URL is refused', () => {
    // A link built on a relative base is unusable in an e-mail client.
    expect(() => provider(fetch, { appBaseUrl: '/app' })).toThrow(/absolute/u);
    expect(() => provider(fetch, { appBaseUrl: '' })).toThrow(/absolute/u);
  });

  it('[3] resendFromEnv returns null when anything is missing', () => {
    expect(resendFromEnv({})).toBeNull();
    expect(resendFromEnv({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(resendFromEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' })).toBeNull();
    // Null, not a silent sink: the caller logs the gap so an operator can see mail is not going out.
    expect(
      resendFromEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', APP_BASE_URL: 'https://x.com' }),
    ).not.toBeNull();
  });

  it('[4] whitespace-only values count as missing', () => {
    expect(resendFromEnv({ RESEND_API_KEY: '   ', MAIL_FROM: 'a@b.c', APP_BASE_URL: 'https://x.com' })).toBeNull();
  });
});
