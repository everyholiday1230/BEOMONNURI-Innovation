/*
   SMTP 메일 발송기.

   왜 직접 만드는가
   -------------
   기존 발송 경로는 Resend(외부 서비스) 하나였다. 그래서 `RESEND_API_KEY` 가 없으면
   비밀번호 재설정·이메일 인증 메일이 **한 통도 나가지 않는다**(메모리 싱크에만 쌓인다).
   운영자가 이미 회사 메일 계정을 가지고 있다면, 그 계정의 SMTP 로 보내면 추가 비용도
   외부 의존도 없다.

   ★ 의존성을 늘리지 않는다. nodemailer 를 넣지 않고 node:tls / node:net 만 쓴다.
     우리가 보내는 메일은 **수신자 1명 · 평문 · 짧은 본문** 뿐이라 SMTP 의 필요한
     부분만 구현하면 된다(EHLO → STARTTLS? → AUTH → MAIL FROM → RCPT TO → DATA).

   ★★ 실패를 삼키지 않는다. 메일이 안 나가는데 성공으로 처리하면, 비밀번호를 잊은
     사용자는 오지 않는 메일을 기다린다. 서버 응답 코드를 확인하고 그대로 던진다.

   지원하는 서버
   -----------
   · 포트 465 — 처음부터 TLS (implicit TLS). Gmail·Workspace·대부분의 호스팅이 지원.
   · 포트 587 — 평문으로 열고 STARTTLS 로 승격. 사내 메일 서버에서 흔하다.
   · 포트 25 는 지원 목록에 두지 않는다 — 다수 클라우드(Render 포함)가 막는다.
*/

import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import type { MailMessage, MailProvider } from './mail';
import { renderMail } from './mail-templates';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** 보내는 주소. 서버가 인증 계정과 다른 주소를 거부할 수 있다. */
  from: string;
  /** 메일 본문의 링크를 만들 기준 주소. */
  appBaseUrl: string;
  replyTo?: string;
  /** 제목·본문에 넣는 브랜드 이름. */
  brandName?: string;
  /** 소켓 무응답 한도. 기본 15초 — 배포 환경에서 막힌 포트를 오래 붙들지 않는다. */
  timeoutMs?: number;
  /*
     TLS 방식.

     · 'implicit'  포트 465 — 처음부터 TLS
     · 'starttls'  포트 587 등 — 평문으로 열고 승격
     · 'disabled'  **테스트 전용.** 평문으로 대화한다.

     ★★ 'disabled' 는 환경변수로 만들 수 없다(smtpFromEnv 가 절대 이 값을 넣지 않는다).
       인증 정보를 평문으로 흘리는 설정을 운영자가 실수로 켜게 두지 않기 위해서다.
       기본값은 포트로 정한다(465 → implicit, 그 외 → starttls).
  */
  tls?: 'implicit' | 'starttls' | 'disabled';
}

/** 한 줄 응답의 코드. `250-` 처럼 이어지는 응답은 마지막 줄만 본다. */
function statusOf(reply: string): number {
  const lines = reply.trimEnd().split(/\r?\n/);
  const last = lines[lines.length - 1] ?? '';
  return Number(last.slice(0, 3));
}

/** 제목에 한글·일본어가 있으면 그대로 보낼 수 없다 — RFC 2047 인코딩. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * 본문의 점(.) 처리.
 *
 * ★ SMTP 는 `\r\n.\r\n` 으로 본문이 끝난다. 본문 줄이 '.' 로 시작하면 거기서 끊긴다 —
 *   점을 하나 더 붙여야 한다(dot stuffing). 빠뜨리면 링크가 잘린 메일이 나간다.
 */
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

class SmtpSession {
  private socket: Socket | TLSSocket | null = null;
  private buffer = '';
  private waiter: ((reply: string) => void) | null = null;

  constructor(private readonly cfg: SmtpConfig) {}

  private attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.cfg.timeoutMs ?? 15_000);
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      /* 응답은 `250 OK\r\n` 또는 여러 줄(`250-...`)로 온다. 마지막 줄이 `NNN ` 이면 완료. */
      if (/\r\n$/.test(this.buffer) && /^\d{3} [^\r\n]*\r\n$/m.test(this.buffer.split(/(?<=\r\n)/).slice(-1)[0] ?? '')) {
        const reply = this.buffer;
        this.buffer = '';
        const w = this.waiter;
        this.waiter = null;
        if (w) w(reply);
      }
    });
  }

  private read(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) { reject(new Error('SMTP: 소켓이 없다')); return; }
      const socket = this.socket;
      const onTimeout = () => reject(new Error(`SMTP: ${this.cfg.host}:${this.cfg.port} 응답 없음(시간 초과)`));
      const onError = (e: Error) => reject(new Error(`SMTP: 연결 오류 — ${e.message}`));
      socket.once('timeout', onTimeout);
      socket.once('error', onError);
      this.waiter = (reply) => {
        socket.off('timeout', onTimeout);
        socket.off('error', onError);
        resolve(reply);
      };
    });
  }

  private async say(line: string, expect: number[]): Promise<string> {
    if (!this.socket) throw new Error('SMTP: 소켓이 없다');
    this.socket.write(line + '\r\n');
    const reply = await this.read();
    const code = statusOf(reply);
    if (!expect.includes(code)) {
      /* 비밀번호는 절대 로그에 남기지 않는다 — 명령 이름만 남긴다. */
      const cmd = line.split(' ')[0];
      throw new Error(`SMTP: ${cmd} 실패 (${code}) ${reply.trim().slice(0, 160)}`);
    }
    return reply;
  }

  async send(msg: MailMessage): Promise<void> {
    const { host, port, user, pass, from } = this.cfg;
    const mode = this.cfg.tls ?? (port === 465 ? 'implicit' : 'starttls');
    const implicitTls = mode === 'implicit';

    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => reject(new Error(`SMTP: ${host}:${port} 접속 실패 — ${e.message}`));
      if (implicitTls) {
        const s = tlsConnect({ host, port, servername: host }, () => resolve());
        s.once('error', onError);
        this.attach(s);
      } else {
        const s = netConnect({ host, port }, () => resolve());
        s.once('error', onError);
        this.attach(s);
      }
    });

    await this.read();                                  // 220 인사
    await this.say(`EHLO ${hostnameFor(from)}`, [250]);

    if (mode === 'starttls') {
      await this.say('STARTTLS', [220]);
      /* 평문 소켓을 TLS 로 감싸고 다시 EHLO — 승격 후에는 세션이 초기화된다. */
      const plain = this.socket as Socket;
      await new Promise<void>((resolve, reject) => {
        const secure = tlsConnect({ socket: plain, servername: host }, () => resolve());
        secure.once('error', (e) => reject(new Error(`SMTP: STARTTLS 실패 — ${e.message}`)));
        this.attach(secure);
      });
      await this.say(`EHLO ${hostnameFor(from)}`, [250]);
    }

    /*
       AUTH PLAIN. LOGIN 만 받는 서버를 위해 실패 시 한 번 더 시도한다.
       ★ 인증 정보는 base64 이지 암호화가 아니다 — 반드시 TLS 위에서만 보낸다(위에서 보장).
    */
    const plainToken = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
    try {
      await this.say(`AUTH PLAIN ${plainToken}`, [235]);
    } catch {
      await this.say('AUTH LOGIN', [334]);
      await this.say(Buffer.from(user, 'utf8').toString('base64'), [334]);
      await this.say(Buffer.from(pass, 'utf8').toString('base64'), [235]);
    }

    await this.say(`MAIL FROM:<${addressOf(from)}>`, [250]);
    await this.say(`RCPT TO:<${addressOf(msg.to)}>`, [250, 251]);
    await this.say('DATA', [354]);

    /*
       ★★ 호출부의 msg.text 를 그대로 보내면 안 된다 — 그것은 '동봉된 토큰을
         사용하세요' 같은 자리표시자이고 링크가 없다. 공용 템플릿이 실제 링크가
         있는 본문을 만든다(Resend 경로와 같은 본문).
    */
    const rendered = renderMail(msg, {
      appBaseUrl: this.cfg.appBaseUrl,
      ...(this.cfg.brandName ? { brandName: this.cfg.brandName } : {}),
      ...(msg.meta && typeof msg.meta.locale === 'string' ? { locale: msg.meta.locale } : {}),
    });

    /*
       평문과 HTML 을 함께 보낸다(multipart/alternative). 메일 앱이 둘 중 하나를
       고른다. 평문만 보내면 링크가 눌리지 않는 앱이 있고, HTML 만 보내면
       평문 전용 환경에서 아무것도 읽히지 않는다.
    */
    const boundary = `ccai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const headers = [
      `From: ${from}`,
      `To: ${msg.to}`,
      `Subject: ${encodeHeader(rendered.subject)}`,
      ...(this.cfg.replyTo ? [`Reply-To: ${this.cfg.replyTo}`] : []),
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].join('\r\n');

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      dotStuff(rendered.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      dotStuff(rendered.html),
      `--${boundary}--`,
    ].join('\r\n');

    if (!this.socket) throw new Error('SMTP: 소켓이 없다');
    this.socket.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    const reply = await this.read();
    if (statusOf(reply) !== 250) {
      throw new Error(`SMTP: 본문 전송 실패 (${statusOf(reply)}) ${reply.trim().slice(0, 160)}`);
    }

    try { await this.say('QUIT', [221]); } catch { /* 종료 인사 실패는 발송 성공을 무르지 않는다 */ }
    this.socket.end();
  }
}

/** EHLO 에 쓸 이름. 도메인만 뽑고, 없으면 localhost. */
function hostnameFor(from: string): string {
  const parts = addressOf(from).split('@');
  const domain = parts.length > 1 ? parts[parts.length - 1] : '';
  return domain && domain.length > 0 ? domain : 'localhost';
}

/** `이름 <a@b.com>` 에서 주소만. */
function addressOf(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return ((m && m[1]) ? m[1] : value).trim();
}

export class SmtpMailProvider implements MailProvider {
  readonly name: string;

  constructor(private readonly cfg: SmtpConfig) {
    if (!cfg.host.trim()) throw new Error('SmtpMailProvider: host is required');
    if (!cfg.from.trim()) throw new Error('SmtpMailProvider: from is required');
    if (!/^https?:\/\//.test(cfg.appBaseUrl)) {
      throw new Error('SmtpMailProvider: appBaseUrl must be an absolute http(s) URL');
    }
    this.name = `smtp:${cfg.host}:${cfg.port}`;
  }

  async send(msg: MailMessage): Promise<void> {
    await new SmtpSession(this.cfg).send(msg);
  }
}

/**
 * 환경변수로 발송기를 만든다. 설정이 없으면 null.
 *
 * SMTP_HOST · SMTP_USER · SMTP_PASS · MAIL_FROM · APP_BASE_URL 이 모두 있어야 한다.
 * SMTP_PORT 는 기본 465(처음부터 TLS). 587 을 주면 STARTTLS 로 승격한다.
 */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpMailProvider | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS ?? '';
  const from = env.MAIL_FROM?.trim();
  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!host || !user || !pass || !from || !appBaseUrl) return null;
  const port = Number(env.SMTP_PORT ?? 465);
  return new SmtpMailProvider({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 465,
    user,
    pass,
    from,
    appBaseUrl,
    ...(env.MAIL_REPLY_TO?.trim() ? { replyTo: env.MAIL_REPLY_TO.trim() } : {}),
    ...(env.BRAND_NAME?.trim() ? { brandName: env.BRAND_NAME.trim() } : { brandName: 'ChartControl AI' }),
    ...(env.SMTP_TIMEOUT_MS ? { timeoutMs: Number(env.SMTP_TIMEOUT_MS) } : {}),
  });
}
