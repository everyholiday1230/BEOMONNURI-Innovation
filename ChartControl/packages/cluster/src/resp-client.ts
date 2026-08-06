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
      sock.on('data', (d) => this.onData(d));
      sock.on('close', () => { this.closed = true; this.flushError(new Error('redis connection closed')); });
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

  command(...args: (string | number)[]): Promise<RespReply> {
    if (!this.sock || this.closed) return Promise.reject(new Error('redis not connected'));
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
