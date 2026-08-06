/** 최소 구조화 로거. 비밀값 유출 방지를 위해 알려진 민감 키를 마스킹한다. */
import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/**
 * 마스킹 대상 키. 토큰 단위로 비교한다.
 *
 * 부분 문자열 매칭을 쓰면 오탐이 난다 (예: 'sign' 이 'signal' 을 잡아
 * 종료 시그널 이름이 ***redacted*** 로 찍혔다). 그래서 camelCase /
 * snake_case / kebab-case 를 토큰으로 쪼갠 뒤 정확히 일치하는지 본다.
 */
const SENSITIVE_TOKENS = new Set([
  'secret',
  'passphrase',
  'password',
  'pwd',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'brokerkey',
  'sign',
  'signature',
  'authorization',
  'auth',
  'cookie',
  'credential',
  'credentials',
]);

function isSensitiveKey(key) {
  const tokens = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);

  if (tokens.some((t) => SENSITIVE_TOKENS.has(t))) return true;
  // 'apiKey' -> ['api','key'] 처럼 쪼개지는 조합도 잡는다.
  const joined = tokens.join('');
  return SENSITIVE_TOKENS.has(joined);
}

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? '***redacted***' : redact(v, depth + 1);
  }
  return out;
}

function emit(level, msg, meta) {
  if (LEVELS[level] > threshold) return;
  const line = { t: new Date().toISOString(), level, msg };
  if (meta !== undefined) line.meta = redact(meta);
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const log = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};
