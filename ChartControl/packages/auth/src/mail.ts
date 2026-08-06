/**
 * Mail provider seam (req §2). Real SMTP/SES providers implement MailProvider; the dev MailSink
 * captures messages in memory (Mock) so verification/reset flows are testable without sending mail.
 * Tokens are delivered by the caller — the mail layer never logs raw tokens beyond the sink.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** structured payload for tests (e.g. the verification/reset link or token). */
  meta?: Record<string, unknown>;
}

export interface MailProvider {
  readonly name: string;
  send(msg: MailMessage): Promise<void>;
}

/** Dev/test sink — Mock. Captures messages; NEVER used in production. */
export class MailSink implements MailProvider {
  readonly name = 'mail-sink-dev';
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
  last(): MailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
  clear(): void {
    this.sent.length = 0;
  }
}
