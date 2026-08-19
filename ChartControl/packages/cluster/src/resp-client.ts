import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/**
 * Minimal RESP2 Redis client (Phase 6 §4) — zero external dependencies so `--frozen-lockfile` stays
 * valid. Supports request/reply pipelining and a subscriber mode for pub/sub. Not a full client;
 * only the commands the cluster layer needs (GET/SET/DEL/INCR/EVAL/PUBLISH/SUBSCRIBE/PING).
 */
export type RespReply = string | number | null | RespReply[];

function encodeCommand(args: (string | number)[]): Buffer {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return Buffer.from(out);
}

/** Incremental RESP parser: returns [reply, bytesConsumed] or null when more data is needed. */
function parseReply(buf: Buffer, offset: number): [RespReply, number] | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]!);
  const nl = buf.indexOf('\r\n', offset);
  if (nl === -1) return null;
  const line = buf.toString('utf8', offset + 1, nl);
  const next = nl + 2;
  switch (type) {
    case '+': return [line, next];
    case '-': return [new RespError(line) as unknown as RespReply, next];
    case ':': return [Number(line), next];
    case '$': {
      const len = Number(line);
      if (len === -1) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString('utf8', next, next + len), next + len + 2];
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return [null, next];
      const arr: RespReply[] = [];
      let cur = next;
      for (let i = 0; i < count; i++) {
        const r = parseReply(buf, cur);
        if (!r) return null;
        arr.push(r[0]);
        cur = r[1];
      }
      return [arr, cur];
    }
    default:
      throw new Error(`unknown RESP type '${type}'`);
  }
}

export class RespError extends Error {}

export interface RedisClientOptions {
  host: string;
  port: number;
  connectTimeoutMs?: number;
  /** Use a TLS socket (ElastiCache in-transit encryption / rediss:// URLs). Additive; defaults off. */
  tls?: boolean;
  /** SNI/cert host for TLS; defaults to `host`. */
  tlsServerName?: string;
}

/** Parse a redis:// or rediss:// URL. `tls` is true for the rediss scheme (in-transit encryption). */
export function parseRedisUrl(url: string): { host: string; port: number; tls: boolean } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), tls: u.protocol === 'rediss:' };
}

export class RedisClient {
  private sock: Socket | null = null;
  private buf = Buffer.alloc(0);
  private queue: Array<{ resolve: (r: RespReply) => void; reject: (e: Error) => void }> = [];
  private messageHandler: ((channel: string, message: string) => void) | null = null;
  private closed = false;

  constructor(private readonly opts: RedisClientOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = this.opts.tls
        ? tlsConnect({ host: this.opts.host, port: this.opts.port, servername: this.opts.tlsServerName ?? this.opts.host })
        : createConnection({ host: this.opts.host, port: this.opts.port });
      const to = setTimeout(() => { sock.destroy(); reject(new Error('redis connect timeout')); }, this.opts.connectTimeoutMs ?? 2000);
      const onReady = () => { clearTimeout(to); this.sock = sock as Socket; resolve(); };
      sock.once(this.opts.tls ? 'secureConnect' : 'connect', onReady);
      sock.once('error', (e) => { clearTimeout(to); reject(e); });
      /*
         ★★ 핸들러를 **이 소켓에만** 묶는다.

           전에는 어느 소켓의 이벤트든 `this.closed` 를 건드렸다. 그래서 재연결
           직후 **이전 소켓의 'close' 가 늦게 도착해** 방금 연결한 상태를
           다시 닫힌 것으로 만들었다 — 실측: 재연결 검사가 `redis not connected`
           로 실패했다.

         ★ 지금 쓰는 소켓이 아니면 상태를 바꾸지 않는다. 남은 대기 요청도
           그 소켓의 것이 아니므로 깨우지 않는다.
      */
      sock.on('data', (d) => { if (this.sock === sock) this.onData(d); });
      sock.on('close', () => {
        if (this.sock !== sock) return;
        this.closed = true;
        this.flushError(new Error('redis connection closed'));
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      let parsed: [RespReply, number] | null;
      try { parsed = parseReply(this.buf, 0); } catch (e) { this.flushError(e as Error); this.buf = Buffer.alloc(0); return; }
      if (!parsed) return;
      const [reply, consumed] = parsed;
      this.buf = this.buf.subarray(consumed);
      // pub/sub push messages arrive as arrays without a pending request
      if (this.messageHandler && Array.isArray(reply) && reply[0] === 'message') {
        this.messageHandler(String(reply[1]), String(reply[2]));
        continue;
      }
      const waiter = this.queue.shift();
      if (!waiter) continue;
      if (reply instanceof RespError) waiter.reject(reply);
      else waiter.resolve(reply);
    }
  }

  private flushError(e: Error): void {
    while (this.queue.length) this.queue.shift()!.reject(e);
  }

  /**
   * 연결을 보장한다 (첫 명령에서 연결, 끊겼으면 재연결).
   *
   * ★★ 왜 필요했는가 — 실서비스가 통째로 멈추는 결함이었다.
   *
   *   `connect()` 를 부르는 곳이 없었다. 그래서 프로덕션 레이트리밋(Redis 필수)이
   *   모든 호출에서 `redis not connected` 로 실패했고, 그 위의
   *   `FailClosedRateLimiter` 가 **모든 요청을 거부**했다.
   *
   *   결과: 프로덕션 모드에서 **로그인 자체가 불가능**했다(모든 로그인 429).
   *   개발 모드는 메모리 리미터를 쓰므로 이 경로를 지나지 않아 드러나지 않았다.
   *
   * ★ 동시에 여러 명령이 오면 한 번만 연결한다(같은 Promise 를 공유).
   *   각자 연결하면 소켓이 여러 개 열리고 응답 큐가 섞인다.
   *
   * ★ 끊긴 뒤 재연결할 때 `closed` 를 내린다. 내리지 않으면 한 번 끊긴 뒤
   *   영구히 거부한다 — 재시작 전까지 서비스가 돌아오지 않는다.
   */
  private connecting: Promise<void> | null = null;

  private async ensureConnected(): Promise<void> {
    if (this.sock && !this.closed) return;
    if (!this.connecting) {
      /*
         ★★ 새 소켓을 만들기 전에 이전 것을 버린다.

           `connect()` 는 성공 시에만 `this.sock` 을 덮어쓴다. 닫힌 소켓을
           남겨 두면 아래 `if (!this.sock || this.closed)` 검사가 통과해도
           **죽은 소켓에 쓰게** 된다.

         ★ `closed` 를 여기서 내린다. 내리지 않으면 한 번 끊긴 뒤 영구히 거부한다 —
           Redis 재시작·네트워크 순단에서 재시작 전까지 서비스가 돌아오지 않는다.
      */
      this.sock = null;
      this.closed = false;
      this.connecting = this.connect().finally(() => { this.connecting = null; });
    }
    await this.connecting;
  }

  async command(...args: (string | number)[]): Promise<RespReply> {
    await this.ensureConnected();
    if (!this.sock || this.closed) throw new Error('redis not connected');
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.sock!.write(encodeCommand(args));
    });
  }

  onMessage(handler: (channel: string, message: string) => void): void {
    this.messageHandler = handler;
  }

  async quit(): Promise<void> {
    try { if (this.sock && !this.closed) await this.command('QUIT'); } catch { /* ignore */ }
    this.sock?.destroy();
    this.closed = true;
  }
}
