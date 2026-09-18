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
 *   · 길이 600자 이하, 괄호 균형, 빈 식 금지
 *   · 이름은 표시용 짧은 문자열(1-16자), pane 은 price|separate
 *
 * ★★★ **문법을 늘릴 때는 반드시 양쪽을 함께 늘린다.**
 *   여기와 `src/formula-dsl.js` 는 같은 문법을 파싱해야 한다. 한쪽만 늘리면
 *   화면에서 통과한 식이 서버에서 거부되거나(고객은 이유를 알 수 없다), 반대로
 *   서버를 통과한 식을 화면이 그리지 못한다. 동기화는 시험이 지킨다
 *   (indicator-formula.test.ts, formula-dsl-parity.test.ts).
 *
 * 2026-09-18: 조건식 지원을 넣었다 — 고객이 **자기 신호 규칙**을 쓸 수 있게 하기
 *   위해서다. 비교(> >= < <= == !=)·논리(AND OR NOT)와 지표·조건 함수 13개를
 *   추가하고, 상한을 400/80/3 → 600/160/4 로 올렸다(조건식이 지표식보다 길다).
 */
export const ALLOWED_FUNCS = [
  'SMA', 'EMA', 'STDDEV', 'REF', 'DELTA', 'ABS', 'MIN', 'MAX', 'POW', 'SQRT',
  /* 집계·범위 */
  'SUM', 'HHV', 'LLV',
  /* 지표 */
  'RSI', 'ATR', 'MACD_DIF', 'MACD_DEA', 'MACD_HIST',
  /* 조건 — 고객이 쓰는 신호 규칙의 핵심 */
  'CROSS_ABOVE', 'CROSS_BELOW', 'RISING', 'FALLING', 'COUNT',
] as const;
export const ALLOWED_VARS = ['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3'] as const;

export const IndicatorFormulaSchema = z.object({
  name: z.string().trim().min(1).max(16),
  shortName: z.string().trim().min(1).max(8).optional(),
  expression: z.string().trim().min(1).max(600),
  pane: z.enum(['price', 'separate']).default('separate'),
});

export type IndicatorFormulaInput = z.infer<typeof IndicatorFormulaSchema>;
export type IndicatorFormulaResult =
  | { ok: true; descriptor: IndicatorFormulaInput & { ast: unknown } }
  | { ok: false; code: string; message: string };

const TOKEN_RE = /^[A-Za-z0-9_+\-*/(),.\s<>=!]+$/u;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/gu;

/**
 * 함수별 인자 개수 — 평가기(`src/formula-dsl.js` evalNode)가 실제로 쓰는 값이다.
 *
 * ★★ 개수를 서버가 확인해야 하는 이유: 평가기는 `MIN(x)` 처럼 인자가 빠지면
 *   `node.args[1]` 이 undefined 인 채로 재귀해 **터진다.** "화이트리스트 이름만
 *   확인" 으로는 그 입력을 막지 못한다.
 *
 * ★ POW 는 지수를 생략하면 2 로 본다(평가기가 그렇게 동작한다) — 1 또는 2.
 */
const ARITY: Record<string, readonly number[]> = {
  SMA: [2], EMA: [2], STDDEV: [2], REF: [2], DELTA: [2],
  MIN: [2], MAX: [2],
  ABS: [1], SQRT: [1],
  POW: [1, 2],
  SUM: [2], HHV: [2], LLV: [2],
  /* ★ ATR 은 기간 하나만 받는다 — high·low·close 를 내부에서 쓰므로 계열 인자가 없다. */
  RSI: [2], ATR: [1],
  MACD_DIF: [2], MACD_DEA: [3], MACD_HIST: [3],
  CROSS_ABOVE: [2], CROSS_BELOW: [2],
  RISING: [2], FALLING: [2], COUNT: [2],
};

/** 비교 연산자 — 조건식의 핵심. */
const CMP_OPS = new Set(['>', '>=', '<', '<=', '==', '!=']);
/** 논리 낱말. 식별자로 들어오므로 대소문자를 무시한다. */
const LOGIC_WORDS: Record<string, 'and' | 'or' | 'not'> = { AND: 'and', OR: 'or', NOT: 'not' };

/** 노드 총수 상한 — 클라이언트 DSL 의 MAX_NODES 와 같은 값이다. */
const MAX_NODES = 160;
/** 함수 인자 중첩 상한 — 클라이언트 DSL 문서가 선언한 값(4단계)과 같다. */
const MAX_CALL_DEPTH = 4;
/** 식 길이 상한 — 스키마의 max 와 같은 값이다. */
export const MAX_EXPRESSION_LEN = 600;

type Tok = { t: string; v?: number | string };

/**
 * 표현식을 **실제로 파싱한다.**
 *
 * ★★ 예전에는 토큰 문자·괄호 균형·이름 화이트리스트만 보고 통과시켰다. 그래서
 *   `close+close+...+close+` 처럼 **문법이 깨진 식이 서버를 통과**했고, 문법 검증은
 *   "클라이언트가 렌더 직전에 한 번 더 한다" 는 주석에 맡겨져 있었다. 그것은 이
 *   모듈이 스스로 적어 둔 "서버가 유일한 관문" 과 어긋난다. AI 가 만든 후보가
 *   서버를 통과했다는 사실이 곧 "그릴 수 있는 식" 을 뜻해야 한다.
 *
 * ★ 평가하지 않는다 — 문법·이름·인자 개수·복잡도만 본다. 값 계산은 화면에서 한다.
 */
function parseExpression(src: string): { ok: true; ast: unknown } | { ok: false; code: string; message: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    /*
       ★★ **두 글자 연산자를 한 글자보다 먼저 본다.** `>=` 를 `>` 와 `=` 로 쪼개면
         뒤의 `=` 가 BAD_CHAR 가 되어 원인을 알 수 없는 오류가 된다.
       ★ `=` 하나만 쓰는 대입은 없다. `==` 만 받는다 — 조건식에서 `=` 를 대입으로
         오해하는 실수를 문법 단계에서 드러낸다.
    */
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      toks.push({ t: two }); i += 2; continue;
    }
    if (c === '>' || c === '<') { toks.push({ t: c }); i += 1; continue; }
    if (c === '=' || c === '!') {
      return { ok: false, code: 'BAD_OPERATOR', message: `연산자를 확인하십시오: ${c} (같음은 == 로 쓴다)` };
    }
    if ('+-*/(),'.includes(c)) { toks.push({ t: c }); i += 1; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] !== undefined && src[i + 1]! >= '0' && src[i + 1]! <= '9')) {
      let j = i;
      while (j < src.length && ((src[j]! >= '0' && src[j]! <= '9') || src[j] === '.')) j += 1;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) return { ok: false, code: 'BAD_NUMBER', message: `숫자로 읽을 수 없다: ${src.slice(i, j)}` };
      toks.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[A-Za-z_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/u.test(src[j]!)) j += 1;
      toks.push({ t: 'ident', v: src.slice(i, j) }); i = j; continue;
    }
    return { ok: false, code: 'BAD_CHAR', message: `허용되지 않는 문자: ${c}` };
  }

  let p = 0;
  let nodes = 0;
  let callDepth = 0;

  class Bad extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  const node = <T>(n: T): T => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Bad('TOO_COMPLEX', `식이 너무 복잡하다 — 노드 ${MAX_NODES}개 이하`);
    return n;
  };

  const logicOf = (tk: Tok | undefined): 'and' | 'or' | 'not' | undefined =>
    (tk && tk.t === 'ident' ? LOGIC_WORDS[String(tk.v).toUpperCase()] : undefined);

  /*
     ★★ 우선순위 사슬(낮은 것부터) — 클라이언트 DSL 과 같아야 한다.

         expr    := andExpr (OR andExpr)*
         andExpr := notExpr (AND notExpr)*
         notExpr := NOT notExpr | cmpExpr
         cmpExpr := addExpr ((> >= < <= == !=) addExpr)?     ← 연쇄 금지
         addExpr := mulExpr (('+'|'-') mulExpr)*
         mulExpr := factor (('*'|'/') factor)*

     ★★★ **비교를 연쇄시키지 않는다.** `a < b < c` 는 수학처럼 읽히지만 왼쪽부터
       접으면 `(a<b) < c` = `0또는1 < c` 가 되어 **조용히 엉뚱한 값**이 나온다.
       의도를 쓰려면 `a < b AND b < c` 로 명시해야 한다.
  */
  function expr(): unknown {
    let left = andExpr();
    while (logicOf(toks[p]) === 'or') {
      p += 1;
      left = node({ k: 'logic', op: 'or', a: left, b: andExpr() });
    }
    return left;
  }
  function andExpr(): unknown {
    let left = notExpr();
    while (logicOf(toks[p]) === 'and') {
      p += 1;
      left = node({ k: 'logic', op: 'and', a: left, b: notExpr() });
    }
    return left;
  }
  function notExpr(): unknown {
    if (logicOf(toks[p]) === 'not') {
      p += 1;
      return node({ k: 'not', a: notExpr() });
    }
    return cmpExpr();
  }
  function cmpExpr(): unknown {
    const left = addExpr();
    if (toks[p] && CMP_OPS.has(toks[p]!.t)) {
      const op = toks[p]!.t; p += 1;
      const right = addExpr();
      if (toks[p] && CMP_OPS.has(toks[p]!.t)) {
        throw new Bad('CHAINED_COMPARISON', '비교를 잇지 않는다 — `a < b AND b < c` 로 쓰십시오');
      }
      return node({ k: 'cmp', op, a: left, b: right });
    }
    return left;
  }
  /** addExpr := mulExpr (('+'|'-') mulExpr)* */
  function addExpr(): unknown {
    let left = mulExpr();
    while (toks[p] && (toks[p]!.t === '+' || toks[p]!.t === '-')) {
      const op = toks[p]!.t; p += 1;
      left = node({ k: 'bin', op, a: left, b: mulExpr() });
    }
    return left;
  }
  /** mulExpr := factor (('*'|'/') factor)* */
  function mulExpr(): unknown {
    let left = factor();
    while (toks[p] && (toks[p]!.t === '*' || toks[p]!.t === '/')) {
      const op = toks[p]!.t; p += 1;
      left = node({ k: 'bin', op, a: left, b: factor() });
    }
    return left;
  }
  function factor(): unknown {
    const tk = toks[p];
    if (!tk) throw new Bad('UNEXPECTED_END', '식이 중간에 끊겼다');
    if (tk.t === 'num') { p += 1; return node({ k: 'num', v: tk.v }); }
    if (tk.t === '(') {
      p += 1;
      const e = expr();
      if (!toks[p] || toks[p]!.t !== ')') throw new Bad('UNBALANCED_PAREN', '괄호가 맞지 않다');
      p += 1; return e;
    }
    if (tk.t === '-') { p += 1; return node({ k: 'neg', a: factor() }); }
    if (tk.t === 'ident') {
      const raw = String(tk.v);
      /*
         ★ 논리 낱말이 값 자리에 오면 문법 오류다. `close AND` 처럼 뒤가 빈 경우
           UNKNOWN_NAME:AND 로 나가면 원인을 짐작하기 어렵다.
      */
      if (LOGIC_WORDS[raw.toUpperCase()]) {
        throw new Bad('UNEXPECTED_LOGIC', `${raw} 가 값 자리에 있다`);
      }
      const upper = raw.toUpperCase();
      if ((ALLOWED_FUNCS as readonly string[]).includes(upper)) {
        p += 1;
        if (!toks[p] || toks[p]!.t !== '(') throw new Bad('EXPECTED_LPAREN', `${raw} 뒤에 '(' 가 없다`);
        p += 1;
        callDepth += 1;
        if (callDepth > MAX_CALL_DEPTH) throw new Bad('TOO_DEEP', `함수 중첩이 ${MAX_CALL_DEPTH}단계를 넘는다`);
        const args: unknown[] = [expr()];
        while (toks[p] && toks[p]!.t === ',') { p += 1; args.push(expr()); }
        if (!toks[p] || toks[p]!.t !== ')') throw new Bad('UNBALANCED_PAREN', '괄호가 맞지 않다');
        p += 1;
        callDepth -= 1;
        const allowed = ARITY[upper]!;
        if (!allowed.includes(args.length)) {
          throw new Bad('BAD_ARITY', `${upper} 의 인자는 ${allowed.join(' 또는 ')}개다 — ${args.length}개 받았다`);
        }
        return node({ k: 'call', name: upper, args });
      }
      const lower = raw.toLowerCase();
      if ((ALLOWED_VARS as readonly string[]).includes(lower)) { p += 1; return node({ k: 'var', v: lower }); }
      throw new Bad('UNKNOWN_NAME', `알 수 없는 이름: ${raw}`);
    }
    throw new Bad('UNEXPECTED_TOKEN', `예상하지 못한 기호: ${tk.t}`);
  }

  try {
    const ast = expr();
    if (p !== toks.length) throw new Bad('TRAILING_TOKENS', '식 뒤에 남는 기호가 있다');
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

export function validateIndicatorFormula(input: unknown): IndicatorFormulaResult {
  const parsed = IndicatorFormulaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'BAD_FORMULA', message: 'name(1-16)·expression(1-400)·pane(price|separate) 을 확인하십시오' };
  }
  const { name, shortName, expression, pane } = parsed.data;
  if (!TOKEN_RE.test(expression)) {
    return { ok: false, code: 'BAD_CHAR', message: '허용되지 않는 문자가 있다' };
  }
  /*
     ★ 이름 화이트리스트를 파싱 **전에** 한 번 본다.

       파서도 같은 판정을 하지만, 파서는 문법 오류를 먼저 만나면 그것을 돌려준다.
       `process.exit` 같은 입력에 'UNEXPECTED_TOKEN' 이 아니라 'UNKNOWN_NAME' 이
       나오는 편이 로그를 읽는 사람에게 정확하다.
  */
  const idents = expression.match(IDENT_RE) ?? [];
  for (const raw of idents) {
    const u = raw.toUpperCase();
    const l = raw.toLowerCase();
    /*
       ★★★ **논리 낱말도 허용 이름이다.** 이 검사를 넣을 때 `AND`·`OR`·`NOT` 을
         빠뜨리면 조건식이 전부 `UNKNOWN_NAME: AND` 로 거부된다 — 문법은 맞는데
         관문 앞에서 죽는다. 실제로 조건식 지원을 넣으면서 이 자리를 놓쳤다.
    */
    if (LOGIC_WORDS[u]) continue;
    if (!(ALLOWED_FUNCS as readonly string[]).includes(u) && !(ALLOWED_VARS as readonly string[]).includes(l)) {
      return { ok: false, code: 'UNKNOWN_NAME', message: `알 수 없는 이름: ${raw}` };
    }
  }
  /*
     ★★ 문법·인자 개수·복잡도를 서버가 직접 확인한다. 예전에는 이 자리에
       "실제 파싱은 클라이언트가 한다" 는 주석만 있었다 — 그래서 문법이 깨진 식이
       서버를 통과했다. 클라이언트의 렌더 직전 파싱은 이제 **이중 방어**이고,
       유일한 방어가 아니다.
  */
  const p = parseExpression(expression);
  if (!p.ok) return { ok: false, code: p.code, message: p.message };

  return { ok: true, descriptor: { name, shortName, expression, pane, ast: p.ast } };
}

