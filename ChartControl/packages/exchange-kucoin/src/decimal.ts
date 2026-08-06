/**
 * 십진 문자열 변환.
 *
 * @quantumtrade/schemas 의 DecimalString 은 `^-?\d+(\.\d+)?$` 를 요구한다.
 * 지수 표기를 허용하지 않는다. 그런데 JS 의 기본 문자열화는 작은 수에서
 * 지수 표기로 바뀐다:
 *
 *   (1e-5).toString()  === '0.00001'   (통과)
 *   (1e-7).toString()  === '1e-7'      (검증 실패)
 *
 * KuCoin 은 일부 알트코인의 tickSize 를 1e-8 규모로 준다. 그래서 그냥
 * String(n) 을 쓰면 계약 사양 파싱이 조용히 실패하고, 그 심볼의 주문
 * 반올림 규칙이 사라진다. 아래 변환기가 그것을 막는다.
 */

/** 지수 표기 없이 십진 문자열로 만든다. */
export function toDecimalString(value: number | string): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/u.test(trimmed)) return normalizeZeros(trimmed);
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return fromNumber(n);
  }
  if (!Number.isFinite(value)) return null;
  return fromNumber(value);
}

function fromNumber(n: number): string {
  const plain = String(n);
  if (!plain.includes('e') && !plain.includes('E')) return normalizeZeros(plain);

  // 지수 표기를 고정소수점으로 펼친다. toFixed 는 최대 100자리까지 지원한다.
  const parts = plain.split(/[eE]/);
  const mantissa = parts[0] ?? '';
  const exponent = Number(parts[1] ?? '0');
  if (exponent >= 0) {
    // 큰 수: 정수부가 길어질 뿐이므로 BigInt 경유가 안전하다.
    return normalizeZeros(BigInt(Math.round(n)).toString());
  }
  const decimals = Math.min(100, Math.abs(exponent) + fractionDigits(mantissa));
  return normalizeZeros(n.toFixed(decimals));
}

function fractionDigits(mantissa: string): number {
  const dot = mantissa.indexOf('.');
  return dot < 0 ? 0 : mantissa.length - dot - 1;
}

/** 소수부 끝의 불필요한 0 을 없앤다. '0.10000' -> '0.1', '5.000' -> '5' */
function normalizeZeros(s: string): string {
  if (!s.includes('.')) return s === '-0' ? '0' : s;
  const trimmed = s.replace(/0+$/u, '').replace(/\.$/u, '');
  return trimmed === '' || trimmed === '-' || trimmed === '-0' ? '0' : trimmed;
}

/** 필수 필드용. 변환 실패 시 '0' 대신 예외를 던져 조용한 오염을 막는다. */
export function requireDecimalString(value: number | string, field: string): string {
  const s = toDecimalString(value);
  if (s === null) throw new Error(`KuCoin 응답의 ${field} 를 십진 문자열로 변환할 수 없음: ${String(value)}`);
  return s;
}

/**
 * tickSize / stepSize 로부터 소수 자리수를 구한다.
 * 예: 0.1 -> 1, 0.001 -> 3, 1e-05 -> 5, 1 -> 0
 */
export function precisionFromStep(step: number | string): number {
  const s = toDecimalString(step);
  if (s === null) return 0;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** 나노초 타임스탬프를 밀리초로. 이미 ms 범위면 그대로 둔다. */
export function nanosToMs(ts: number | string): number {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // ms 는 1e12 규모(2001년 이후), ns 는 1e18 규모.
  return n > 1e15 ? Math.round(n / 1e6) : Math.round(n);
}

/** 초 타임스탬프를 밀리초로. 이미 ms 범위면 그대로 둔다. */
export function secondsToMs(ts: number | string): number {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000);
}
