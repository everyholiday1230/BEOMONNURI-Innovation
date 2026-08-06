/**
 * Redaction (docs PHASE5-09). Admin responses/audit logs must NEVER contain password hashes, session/
 * CSRF tokens, API secrets/memos, OpenAI keys, KMS data keys, or full auth headers. Access keys may be
 * shown masked. These helpers are applied server-side before persistence/response.
 */
const SENSITIVE_KEY = /(password|passwordHash|password_hash|secret|secretKey|secret_key|memo|token|csrf|authorization|apiKey|api_key|openai|kms|dataKey|data_key|sessionToken|session_token|wrappedDek|wrapped_dek|encrypted[_A-Za-z]*)/i;

/**
 * Exact key names that survive `SENSITIVE_KEY` on purpose.
 *
 * `SENSITIVE_KEY` matches the substring "token", which also catches AI token COUNTS — integers, not
 * credentials. Loosening the regex would weaken the deny-by-default posture for every future field, so
 * the exception is an explicit allow-list of exact names instead. Anything added here must be a
 * numeric counter with no credential value.
 */
const COUNTER_KEYS = new Set([
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'inputTokens',
  'outputTokens',
  'totalTokens',
]);

export function maskAccessKey(accessKey: string): string {
  if (!accessKey) return '';
  return accessKey.length <= 8 ? '****' : `${accessKey.slice(0, 4)}…${accessKey.slice(-4)}`;
}

/** Recursively redact sensitive keys from an object graph (returns a safe copy). */
export function redact<T>(value: T): T {
  return redactInner(value, 0) as T;
}

function redactInner(v: unknown, depth: number): unknown {
  if (depth > 12 || v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => redactInner(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'accessKey' || k === 'access_key') {
        out[`${k}Masked`] = typeof val === 'string' ? maskAccessKey(val) : '****';
        continue;
      }
      if (SENSITIVE_KEY.test(k)) {
        // A counter keeps its value only when it really is a number; a string under one of those names
        // is still treated as suspect.
        if (COUNTER_KEYS.has(k) && (typeof val === 'number' || val === null)) {
          out[k] = val;
          continue;
        }
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = redactInner(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** Sanitize a value for CSV export to prevent CSV injection (formula prefixes). */
export function csvSafe(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const dangerous = /^[=+\-@\t\r]/;
  const cleaned = dangerous.test(s) ? `'${s}` : s; // prefix with quote to neutralize formula
  return `"${cleaned.replace(/"/g, '""')}"`;
}

/** Basic HTML escape for any admin-rendered free-text (stored-XSS defense-in-depth). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
