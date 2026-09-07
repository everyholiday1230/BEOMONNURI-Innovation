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

/**
 * 수량을 계약 승수로 나눈 **정확한 계약 수**를 돌려준다(내림).
 *
 * ★★ 왜 필요한가
 *
 *   `Number(qty) / multiplier` 후 `Math.floor` 를 하면 부동소수 오차 때문에 계약이
 *   하나 적게 나간다. 실측:
 *     0.043 / 0.001 = 42.99999999999999 → floor 42 (정답 43)
 *     0.3   / 0.1   = 2.9999999999999996 → floor 2  (정답 3)
 *     2.9   / 0.1   = 28.999999999999996 → floor 28 (정답 29)
 *
 *   고객이 요청한 것보다 **적은 수량이 거래소로 나간다.** 곱셈은 이미 십진 문자열로
 *   처리하고 있었는데 이 나눗셈만 float 로 남아 있었다.
 *
 * ★ 정수 산술로 계산한다. 두 값을 같은 소수 자리수로 확장해 정수로 만든 뒤 나눈다 —
 *   BigInt 를 쓰므로 자리수가 커져도 오차가 없다.
 *
 * ★ 승수가 0 이하이거나 값이 숫자가 아니면 null 을 돌려준다. 호출자가 그것을 오류로
 *   다뤄야 한다 — 0 을 돌려주면 "최소 미달" 로 읽혀 원인을 찾기 어렵다.
 */
export function contractsFromQuantity(
  quantity: number | string,
  multiplier: number | string,
): number | null {
  const q = toDecimalString(quantity);
  const m = toDecimalString(multiplier);
  if (q === null || m === null) return null;

  /** '1.230' → { int: 1230n, scale: 3 } */
  const parse = (v: string): { int: bigint; scale: number } | null => {
    if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
    const neg = v.startsWith('-');
    const body = neg ? v.slice(1) : v;
    const [ip, fp = ''] = body.split('.');
    const digits = `${ip}${fp}`.replace(/^0+(?=\d)/, '');
    let int = BigInt(digits === '' ? '0' : digits);
    if (neg) int = -int;
    return { int, scale: fp.length };
  };

  const pq = parse(q);
  const pm = parse(m);
  if (!pq || !pm) return null;
  if (pm.int <= 0n || pq.int <= 0n) return null;

  /* 같은 자리수로 맞춘다 — 그 뒤로는 순수 정수 나눗셈이다. */
  const scale = Math.max(pq.scale, pm.scale);
  const pow = (n: number) => 10n ** BigInt(n);
  const qi = pq.int * pow(scale - pq.scale);
  const mi = pm.int * pow(scale - pm.scale);

  const contracts = qi / mi;   // BigInt 나눗셈은 0 방향 절단 = 양수에서 내림
  /*
     ★ 계약 수는 정수이고 현실적으로 Number 범위 안이다. 그래도 넘치면 null 로 —
       조용히 정밀도를 잃는 것보다 실패가 낫다.
     ★ Number.MAX_SAFE_INTEGER 로 검사한다.
  */
  if (contracts > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(contracts);
}
