/*
   SMTP 발송기 테스트.

   ★★ 진짜 메일 서버로 보내지 않는다. 대신 **가짜 SMTP 서버**를 띄워 대화 내용을
     기록하고, 우리가 규약대로 말하는지 확인한다. 손으로 만든 프로토콜은 "보냈다고
     했는데 안 갔다" 가 가장 흔한 실패다 — 그것을 여기서 잡는다.

   ★ TLS 는 이 테스트에서 쓰지 않는다(자체 서명 인증서를 만들면 검증이 흐려진다).
     그래서 평문 포트로 붙이고, STARTTLS 를 광고하지 않는 서버로 흉내낸다.
     TLS 협상 자체는 Node 의 tls 모듈이 담당하는 부분이라 우리 코드의 책임이 아니다.
*/

import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { SmtpMailProvider, smtpFromEnv } from '../smtp-mail';

interface FakeServer {
  server: Server;
  port: number;
  log: string[];
  body: () => string;
  close: () => Promise<void>;
}

/** 최소 SMTP 서버. 명령을 받아 기록하고 정해진 코드로 답한다. */
async function fakeSmtp(opts: { failAuthPlain?: boolean } = {}): Promise<FakeServer> {
  const log: string[] = [];
  let inData = false;
  let dataLines: string[] = [];
  let authStep = 0;

  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 fake ESMTP\r\n');
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let idx = buf.indexOf('\r\n');
      while (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          } else {
            dataLines.push(line);
          }
        } else {
          log.push(line);
          const cmd = line.split(' ')[0]?.toUpperCase();
          /*
             ★ 명령 이름을 **먼저** 본다. 전에는 base64 판정을 앞에 두어 'DATA' 가
               base64 로 오인됐고(대문자 영숫자라서), 응답이 한 칸씩 밀렸다.
          */
          const KNOWN = ['EHLO', 'HELO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT', 'RSET', 'STARTTLS'];
          if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
          else if (cmd === 'AUTH') {
            const mech = (line.split(' ')[1] ?? '').toUpperCase();
            if (mech === 'PLAIN') socket.write(opts.failAuthPlain ? '535 no\r\n' : '235 ok\r\n');
            else { authStep = 1; socket.write('334 VXNlcm5hbWU6\r\n'); }
          } else if (cmd === 'MAIL' || cmd === 'RCPT') socket.write('250 ok\r\n');
          else if (cmd === 'DATA') { inData = true; dataLines = []; socket.write('354 send it\r\n'); }
          else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
          else if (authStep > 0 && !KNOWN.includes(cmd ?? '')) {
            /* AUTH LOGIN 의 사용자 → 비밀번호 두 단계 */
            authStep += 1;
            socket.write(authStep > 2 ? '235 ok\r\n' : '334 UGFzc3dvcmQ6\r\n');
          } else socket.write('250 ok\r\n');
        }
        idx = buf.indexOf('\r\n');
      }
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  return {
    server,
    port,
    log,
    body: () => dataLines.join('\n'),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

const base = (port: number) => ({
  host: '127.0.0.1',
  port,
  /* 테스트는 인증서를 만들지 않는다 — 규약 대화만 검증한다(운영에서는 env 가 이 값을 넣지 못한다). */
  tls: 'disabled' as const,
  user: 'ops@example.com',
  pass: 'app-password',
  from: 'ChartControl <ops@example.com>',
  appBaseUrl: 'https://example.com',
  timeoutMs: 5000,
});

describe('SMTP 발송기', () => {
  it('규약 순서대로 대화하고 본문을 전달한다', async () => {
    const fake = await fakeSmtp();
    const provider = new SmtpMailProvider(base(fake.port));
    await provider.send({ to: 'user@example.net', subject: '비밀번호 재설정', text: 'https://example.com/reset?token=abc' });

    const cmds = fake.log.map((l) => l.split(' ')[0]?.toUpperCase());
    expect(cmds).toContain('EHLO');
    expect(cmds).toContain('AUTH');
    expect(fake.log.some((l) => l.startsWith('MAIL FROM:<ops@example.com>'))).toBe(true);
    expect(fake.log.some((l) => l.startsWith('RCPT TO:<user@example.net>'))).toBe(true);
    expect(cmds).toContain('DATA');

    const body = fake.body();
    /* 제목이 한글이면 RFC 2047 로 인코딩돼야 한다 — 그대로 보내면 깨진다. */
    expect(body).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(body).toContain('To: user@example.net');
    expect(body).toContain('Content-Type: text/plain; charset=utf-8');
    expect(body).toContain('https://example.com/reset?token=abc');
    await fake.close();
  });

  it('AUTH PLAIN 을 거부하는 서버에서는 LOGIN 으로 넘어간다', async () => {
    const fake = await fakeSmtp({ failAuthPlain: true });
    const provider = new SmtpMailProvider(base(fake.port));
    await provider.send({ to: 'user@example.net', subject: 'hello', text: 'body' });
    expect(fake.log.filter((l) => l.toUpperCase().startsWith('AUTH')).length).toBe(2);
    await fake.close();
  });

  it('본문 첫 글자가 점이면 이스케이프한다 (본문이 잘리지 않게)', async () => {
    const fake = await fakeSmtp();
    const provider = new SmtpMailProvider(base(fake.port));
    await provider.send({ to: 'u@e.net', subject: 's', text: '.hidden\nsecond line' });
    expect(fake.body()).toContain('..hidden');
    expect(fake.body()).toContain('second line');
    await fake.close();
  });

  it('붙을 수 없는 주소면 오류를 던진다 (조용히 성공하지 않는다)', async () => {
    const provider = new SmtpMailProvider({ ...base(1), host: '127.0.0.1', port: 1, timeoutMs: 1500 });
    await expect(provider.send({ to: 'u@e.net', subject: 's', text: 'b' })).rejects.toThrow(/SMTP/);
  });

  it('환경변수가 부족하면 null 을 준다', () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u' })).toBeNull();
    const p = smtpFromEnv({
      SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p',
      MAIL_FROM: 'a@b.com', APP_BASE_URL: 'https://x.example',
    });
    expect(p).not.toBeNull();
    expect(p?.name).toBe('smtp:smtp.example.com:465');
  });

  it('appBaseUrl 이 절대 URL 이 아니면 만들 때 거부한다', () => {
    expect(() => new SmtpMailProvider({ ...base(25), appBaseUrl: 'example.com' })).toThrow(/appBaseUrl/);
  });
});

/*
   본문 렌더링. 이것이 틀리면 메일은 나가지만 사용자가 아무것도 할 수 없다 —
   전에 실제로 "동봉된 토큰을 사용하세요" 라고만 적힌 메일이 나갔다.
*/
describe('메일 본문', () => {
  const VERIFY = {
    to: 'user@example.net',
    subject: 'Verify your email',
    text: 'Use the enclosed token to verify your email.',
    meta: { token: 'tok-123', kind: 'verify' },
  };

  it('자리표시자 대신 실제 링크를 보낸다', async () => {
    const fake = await fakeSmtp();
    await new SmtpMailProvider({ ...base(fake.port), appBaseUrl: 'https://app.example.com' }).send(VERIFY);
    const body = fake.body();
    expect(body).toContain('https://app.example.com/verify-email?token=tok-123');
    expect(body).not.toContain('Use the enclosed token');
    await fake.close();
  });

  it('평문과 HTML 을 함께 보낸다', async () => {
    const fake = await fakeSmtp();
    await new SmtpMailProvider({ ...base(fake.port), appBaseUrl: 'https://app.example.com' }).send(VERIFY);
    const body = fake.body();
    expect(body).toContain('multipart/alternative');
    expect(body).toContain('Content-Type: text/plain; charset=utf-8');
    expect(body).toContain('Content-Type: text/html; charset=utf-8');
    await fake.close();
  });

  it('브랜드 이름을 제목에 붙인다', async () => {
    const fake = await fakeSmtp();
    await new SmtpMailProvider({ ...base(fake.port), brandName: 'ChartControl AI' }).send(VERIFY);
    /* 제목은 RFC 2047 로 인코딩될 수 있으니 디코딩해서 확인한다. */
    const line = fake.log.length >= 0 ? fake.body().split('\n').find((l) => l.startsWith('Subject:')) ?? '' : '';
    const decoded = /=\?UTF-8\?B\?(.+)\?=/.exec(line);
    const subject = decoded ? Buffer.from(decoded[1] ?? '', 'base64').toString('utf8') : line;
    expect(subject).toContain('ChartControl AI');
    await fake.close();
  });

  it('사용자 언어로 쓴다 (일본어 요청이면 일본어 본문)', async () => {
    const fake = await fakeSmtp();
    await new SmtpMailProvider({ ...base(fake.port) }).send({
      ...VERIFY,
      meta: { ...VERIFY.meta, locale: 'ja' },
    });
    expect(fake.body()).toContain('メールアドレスの確認');
    await fake.close();
  });
});
