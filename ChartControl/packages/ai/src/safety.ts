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

/*
   ★★ 출처 없는 "현재 가격" 주장을 잡는다.

     예전 패턴은 `(current|now|live).{0,20}(price|is trading at|at $\d)` 였다 —
     "현재" 표현이 가격 **앞에** 올 때만 걸린다. 그래서 이런 문장이 통과했다:

       "BTC is at 68,000 right now."        ← 순서가 반대다
       "ETH is trading at 3,500 as of now." ← 마찬가지

     시세 도구를 쓰지 않고 모델이 기억으로 값을 말하면 **틀린 가격이 사실처럼 보인다.**
     고객이 그 값으로 판단하면 손해가 난다.

   ★ 문장 단위로, 순서와 무관하게 본다. 문장을 넘어 합치지 않는다 — 앞 문장의
     "지금" 과 뒤 문장의 숫자를 엮으면 정상 분석이 막힌다.

   ★ 일부러 좁게 잡는다. 지나치게 막으면 답변이 계속 회수되고, 고객에게는 기능이
     고장난 것으로 보인다. 그래서 **숫자를 동반한 가격 단정**과 **현재성 표현**이
     같은 문장에 함께 있을 때만 걸린다.
     "Support is at 67,500" (차트 레벨)은 걸리지 않는다 — 현재성 표현이 없다.
*/
const PRICE_NOWNESS = /\b(current(ly)?|now|right now|as of now|live|at the moment|at present)\b/i;
const PRICE_ASSERTION = /\b(is|are|sits?|stands?|trad(es|ing))\b[^.!?\n]{0,24}\b(at\s*\$?\d|price\s+(is|of)\s*\$?\d)|\bprice\s+is\s*\$?\d/i;

function claimsUnsourcedPrice(text: string): boolean {
  /* 문장으로 쪼갠다. 줄바꿈도 문장 경계로 본다(목록·표를 한 문장으로 합치지 않게). */
  for (const sentence of String(text).split(/[.!?\n]+/)) {
    if (PRICE_NOWNESS.test(sentence) && PRICE_ASSERTION.test(sentence)) return true;
  }
  return false;
}

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
    if (claimsUnsourcedPrice(text) && !ctx.hasMarketToolResult) violations.push('unsourced-price');
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
