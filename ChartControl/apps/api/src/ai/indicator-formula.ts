import { z } from 'zod';

/**
 * 커스텀 지표 수식 검증 — 서버가 유일한 관문이다.
 *
 * 왜 서버인가
 * ----------
 * 고객이 코파일럿에게 말한 지표 요청 → AI 가 만든 후보 정의 → **서버 검증 통과** →
 * 화면 렌더. AI 출력을 그대로 믿지 않는 것은 이 코드베이스의 기존 원칙(좌표·가격도
 * 서버가 검증)과 같다. 사용자가 직접 수식 입력창에 넣는 경우도 같은 검증을 통과한다.
 *
 * 검증 규칙 (클라이언트 DSL(src/formula-dsl.js)과 짝을 이룬다)
 *   · 표현식은 화이트리스트 토큰(함수·변수·숫자·연산자)만 허용
 *   · 길이 400자 이하, 괄호 균형, 빈 식 금지
 *   · 이름은 표시용 짧은 문자열(1-16자), pane 은 price|separate
 */
export const ALLOWED_FUNCS = ['SMA', 'EMA', 'STDDEV', 'REF', 'DELTA', 'ABS', 'MIN', 'MAX', 'POW', 'SQRT'] as const;
export const ALLOWED_VARS = ['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3'] as const;

export const IndicatorFormulaSchema = z.object({
  name: z.string().trim().min(1).max(16),
  shortName: z.string().trim().min(1).max(8).optional(),
  expression: z.string().trim().min(1).max(400),
  pane: z.enum(['price', 'separate']).default('separate'),
});

export type IndicatorFormulaInput = z.infer<typeof IndicatorFormulaSchema>;
export type IndicatorFormulaResult =
  | { ok: true; descriptor: IndicatorFormulaInput & { ast: unknown } }
  | { ok: false; code: string; message: string };

const TOKEN_RE = /^[A-Za-z0-9_+\-*/(),.\s]+$/u;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/gu;

export function validateIndicatorFormula(input: unknown): IndicatorFormulaResult {
  const parsed = IndicatorFormulaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'BAD_FORMULA', message: 'name(1-16)·expression(1-400)·pane(price|separate) 을 확인하십시오' };
  }
  const { name, shortName, expression, pane } = parsed.data;
  if (!TOKEN_RE.test(expression)) {
    return { ok: false, code: 'BAD_CHAR', message: '허용되지 않는 문자가 있다' };
  }
  let depth = 0;
  for (const ch of expression) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return { ok: false, code: 'UNBALANCED_PAREN', message: '괄호가 맞지 않다' };
  }
  if (depth !== 0) return { ok: false, code: 'UNBALANCED_PAREN', message: '괄호가 맞지 않다' };
  const idents = expression.match(IDENT_RE) ?? [];
  for (const raw of idents) {
    const u = raw.toUpperCase();
    const l = raw.toLowerCase();
    if (!(ALLOWED_FUNCS as readonly string[]).includes(u) && !(ALLOWED_VARS as readonly string[]).includes(l)) {
      return { ok: false, code: 'UNKNOWN_NAME', message: `알 수 없는 이름: ${raw}` };
    }
  }
  // ★ 실제 파싱 검증은 클라이언트 DSL 이 렌더 직전에 한 번 더 한다(이중 방어).
  //   서버는 구조적 윤곽(토큰·균형·화이트리스트)을 책임진다.
  return { ok: true, descriptor: { name, shortName, expression, pane, ast: null } };
}
