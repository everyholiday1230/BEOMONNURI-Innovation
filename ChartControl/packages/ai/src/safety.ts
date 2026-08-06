import type { IAISafetyPolicy, SafetyVerdict } from './interfaces';

/**
 * AI safety policy (docs PHASE4-06). Enforced on user input, tool output (untrusted), and model
 * output. Detects prompt injection, profit guarantees, unsourced price claims, and auto-trade intent;
 * sanitizes markdown to block XSS.
 */
const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|above|prior) (instructions|rules)/i,
  /disregard (your |the )?(system|safety) (prompt|rules|policy)/i,
  /you are now/i,
  /reveal (the |your )?(system prompt|instructions|secret|api key)/i,
  /(print|show|output|dump).{0,20}(api[_ ]?key|secret|memo|credential|password)/i,
  /developer mode|jailbreak|DAN mode/i,
  /change (the )?(tool|allowlist|permission|policy)/i,
  /access (another|other) user/i,
  /bypass (the )?(risk|safety|confirmation)/i,
];

const PROFIT_GUARANTEE_PATTERNS = [
  /guarantee[ds]? (a )?(profit|gain|return|win)/i,
  /risk[- ]?free/i,
  /100% (win|accurate|profit)/i,
  /can'?t lose|cannot lose|sure thing|guaranteed money/i,
];

const AUTO_TRADE_PATTERNS = [
  /\b(submit|place|execute|send)\b.{0,20}\border\b/i,
  /\bcancel\b.{0,20}\border\b/i,
  /\bset leverage\b|\bchange (leverage|position mode)\b/i,
  /\bwithdraw\b|\btransfer funds\b/i,
];

const PRICE_CLAIM = /(current|now|right now|live).{0,20}(price|is trading at|at \$?\d)/i;

export class SafetyPolicy implements IAISafetyPolicy {
  screenUserInput(text: string): SafetyVerdict {
    const violations: string[] = [];
    if (INJECTION_PATTERNS.some((r) => r.test(text))) violations.push('prompt-injection');
    // User input that ASKS to auto-trade is allowed as a request but flagged so the orchestrator refuses action.
    if (AUTO_TRADE_PATTERNS.some((r) => r.test(text))) violations.push('auto-trade-request');
    return { allowed: !violations.includes('prompt-injection'), violations };
  }

  screenToolOutput(text: string): SafetyVerdict {
    // Tool output is untrusted data; any embedded instruction is an injection attempt → neutralize.
    const violations: string[] = [];
    if (INJECTION_PATTERNS.some((r) => r.test(text))) violations.push('tool-output-injection');
    return { allowed: true, violations, sanitizedText: text };
  }

  screenModelOutput(text: string, ctx: { hasMarketToolResult: boolean; marketDataStale: boolean }): SafetyVerdict {
    const violations: string[] = [];
    if (PROFIT_GUARANTEE_PATTERNS.some((r) => r.test(text))) violations.push('profit-guarantee');
    if (AUTO_TRADE_PATTERNS.some((r) => r.test(text))) violations.push('auto-trade');
    if (PRICE_CLAIM.test(text) && !ctx.hasMarketToolResult) violations.push('unsourced-price');
    if (ctx.marketDataStale && /\bsignal\b|\bentry\b|\bstop\b/i.test(text)) violations.push('stale-data-signal');
    return { allowed: violations.length === 0, violations, sanitizedText: sanitizeMarkdown(text) };
  }
}

/**
 * Sanitize markdown for safe rendering (docs PHASE4-09). Strips <script>, event handlers, and
 * javascript:/data: URIs; neutralizes raw HTML tags. Not a full DOM sanitizer — the client also
 * renders with a hardened markdown renderer, but this is defense-in-depth on the server.
 */
export function sanitizeMarkdown(md: string): string {
  return md
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?\s*(iframe|object|embed|link|meta|style)\b[^>]*>/gi, '')
    .replace(/on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // markdown link/image targets: ](javascript:...) / ](data:...) -> ](#)
    .replace(/\]\(\s*(javascript|data|vbscript):[^)]*\)/gi, '](#)')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'\s>]*/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*("|')?\s*data:[^"'\s>]*/gi, '$1="#"')
    .replace(/<(?!\/?(a|b|i|em|strong|code|pre|ul|ol|li|p|br|h[1-6]|blockquote|table|thead|tbody|tr|td|th)\b)[^>]*>/gi, '');
}
