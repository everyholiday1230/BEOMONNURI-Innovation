/**
 * 지표·신호 수식 DSL — 샌드박스 평가기.
 *
 * 왜 존재하나
 * ----------
 * 고객이 AI에게 "이런 지표 만들어줘" 라고 말하면, AI 가 **임의 자바스크립트**를
 * 만들어 차트에 주입하는 것은 브라우저에서 임의 코드 실행이다. 그래서 AI(및
 * 사용자)의 지표 정의는 **이 DSL 표현식**으로만 받고, 화이트리스트 함수·변수만
 * 계산한다. 허용 목록 밖의 토큰은 파싱 단계에서 거부된다 — 평가를 시도조차
 * 하지 않는다.
 *
 * 문법
 *   · 변수: close open high low volume hl2 hlc3  (봉 단위 배열)
 *   · 기본 함수: SMA(x,n) EMA(x,n) STDDEV(x,n) REF(x,n) DELTA(x,n)
 *               ABS(x) MIN(x,y) MAX(x,y) POW(x,n) SQRT(x)
 *   · 집계·범위: SUM(x,n) HHV(x,n) LLV(x,n)
 *   · 지표: RSI(x,n) ATR(n)
 *           MACD_DIF(fast,slow) MACD_DEA(fast,slow,signal) MACD_HIST(fast,slow,signal)
 *   · 조건: CROSS_ABOVE(a,b) CROSS_BELOW(a,b) RISING(x,n) FALLING(x,n) COUNT(cond,n)
 *   · 연산: + - * / 괄호, 숫자 리터럴
 *   · 비교: >  >=  <  <=  ==  !=
 *   · 논리: AND  OR  NOT
 *   · 나누기 0 → NaN (예외를 던지지 않는다 — 한 봉이 터져도 전체가 죽지 않게)
 *
 * ★★ **참·거짓은 1/0 숫자다.** 계열 하나를 돌려주는 구조를 유지하기 위한 선택이다.
 *   조건식을 그대로 지표로 그릴 수도 있고(0/1 계단), 신호 규칙으로 쓸 수도 있다.
 *
 * ★★★ **모르는 값은 거짓이 아니다.** 웜업 구간이나 결측은 NaN 으로 남긴다.
 *   NaN 을 0(거짓)으로 접으면 "조건이 성립하지 않았다" 와 "아직 계산할 수 없다" 가
 *   구별되지 않는다. 신호 엔진이 그 둘을 다르게 다뤄야 하므로 여기서 섞지 않는다.
 *   단 `거짓 AND 모름 = 거짓` 처럼 결과가 확정되는 경우는 확정한다(논리적으로 맞다).
 *
 * 제한 (과부하·남용 방지)
 *   · 길이 600자 이하, 노드 160개 이하, 함수 인자 중첩 4단계 이하
 *
 * ★ 조건식은 지표식보다 길다(`CROSS_ABOVE(...) AND RSI(...) < 70`). 그래서 상한을
 *   400/80/3 에서 600/160/4 로 올렸다. 서버(indicator-formula.ts)도 같은 값이어야
 *   한다 — 한쪽만 올리면 화면에서 통과한 식이 서버에서 거부된다.
 */
(function () {
  'use strict';
  const MAX_LEN = 600;
  const MAX_NODES = 160;
  /** 함수 인자 중첩 상한 — 머리말이 선언한 값. 서버도 같은 값을 센다. */
  const MAX_CALL_DEPTH = 4;
  const FUNCS = new Set([
    'SMA', 'EMA', 'STDDEV', 'REF', 'DELTA', 'ABS', 'MIN', 'MAX', 'POW', 'SQRT',
    'SUM', 'HHV', 'LLV',
    'RSI', 'ATR', 'MACD_DIF', 'MACD_DEA', 'MACD_HIST',
    'CROSS_ABOVE', 'CROSS_BELOW', 'RISING', 'FALLING', 'COUNT',
  ]);
  const VARS = new Set(['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3']);
  /*
     함수별 인자 개수 — 아래 evalNode 가 실제로 쓰는 값이다.

     ★ 개수를 확인해야 하는 이유: `MIN(close)` 처럼 인자가 빠지면 evalNode 가
       `node.args[1]` 이 undefined 인 채로 재귀해 터진다. 파싱 단계에서 막는다.
     ★ POW 는 지수를 생략하면 2 로 본다 — 1 또는 2 를 받는다.
     ★ ATR 은 인자가 기간 하나다. high·low·close 를 내부에서 함께 쓰므로 계열
       인자를 받지 않는다 — `ATR(close,14)` 처럼 쓰면 close 를 무시하게 되어
       사용자가 무엇이 계산됐는지 오해한다.
  */
  const ARITY = {
    SMA: [2], EMA: [2], STDDEV: [2], REF: [2], DELTA: [2],
    MIN: [2], MAX: [2],
    ABS: [1], SQRT: [1],
    POW: [1, 2],
    SUM: [2], HHV: [2], LLV: [2],
    RSI: [2], ATR: [1],
    MACD_DIF: [2], MACD_DEA: [3], MACD_HIST: [3],
    CROSS_ABOVE: [2], CROSS_BELOW: [2],
    RISING: [2], FALLING: [2], COUNT: [2],
  };

  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n') { i += 1; continue; }
      /*
         ★★ **두 글자 연산자를 한 글자보다 먼저 본다.** `>=` 를 `>` 와 `=` 로 쪼개면
           뒤의 `=` 가 BAD_CHAR 가 되어 "왜 거부되는지 알 수 없는" 오류가 된다.
         ★ `=` 하나만 쓰는 대입은 없다. `==` 만 받는다 — 조건식에서 `=` 를 대입으로
           오해하는 실수를 문법 단계에서 드러낸다.
      */
      const two = src.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
        toks.push({ t: two }); i += 2; continue;
      }
      if (c === '>' || c === '<') { toks.push({ t: c }); i += 1; continue; }
      if (c === '=' || c === '!') return { err: 'BAD_OPERATOR', at: i };
      if ('+-*/(),'.includes(c)) { toks.push({ t: c }); i += 1; continue; }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
        let j = i;
        while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j += 1;
        const num = Number(src.slice(i, j));
        if (!Number.isFinite(num)) return { err: 'BAD_NUMBER' };
        toks.push({ t: 'num', v: num }); i = j; continue;
      }
      if (isIdentStart(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
        toks.push({ t: 'ident', v: src.slice(i, j) }); i = j; continue;
      }
      return { err: 'BAD_CHAR', at: i };
    }
    return { toks };
  }

  /** 비교 연산자 토큰. */
  const CMP = new Set(['>', '>=', '<', '<=', '==', '!=']);
  /** 논리 낱말. 식별자로 들어오므로 대소문자를 무시하고 본다. */
  const LOGIC = { AND: 'and', OR: 'or', NOT: 'not' };
  const logicOf = (tk) => (tk && tk.t === 'ident' ? LOGIC[String(tk.v).toUpperCase()] : undefined);

  /**
   * 재귀 하강 파서.
   *
   * ★★ 우선순위 사슬(낮은 것부터). 조건식을 넣으면서 세 단계가 늘었다.
   *
   *     orExpr   := andExpr (OR andExpr)*
   *     andExpr  := notExpr (AND notExpr)*
   *     notExpr  := NOT notExpr | cmpExpr
   *     cmpExpr  := addExpr ((> >= < <= == !=) addExpr)?     ← 연쇄 금지
   *     addExpr  := mulExpr (('+'|'-') mulExpr)*
   *     mulExpr  := factor (('*'|'/') factor)*
   *
   * ★★★ **비교를 연쇄시키지 않는다.** `a < b < c` 는 수학처럼 읽히지만 왼쪽부터
   *   접으면 `(a<b) < c` = `0또는1 < c` 가 되어 **조용히 엉뚱한 값**이 나온다.
   *   그래서 비교는 한 번만 허용하고, 두 번째가 오면 거부한다. 의도를 쓰려면
   *   `a < b AND b < c` 로 명시해야 한다.
   *
   * ★ 함수 인자 안에서는 orExpr 부터 파싱한다 — `COUNT(close > open, 20)` 처럼
   *   조건을 인자로 받는 함수가 있다.
   */
  function parseTokens(toks) {
    let p = 0;
    let nodes = 0;
    let callDepth = 0;
    const node = (n) => { nodes += 1; if (nodes > MAX_NODES) throw new Error('TOO_COMPLEX'); return n; };

    function orExpr() {
      let left = andExpr();
      while (logicOf(toks[p]) === 'or') {
        p += 1;
        left = node({ k: 'logic', op: 'or', a: left, b: andExpr() });
      }
      return left;
    }
    function andExpr() {
      let left = notExpr();
      while (logicOf(toks[p]) === 'and') {
        p += 1;
        left = node({ k: 'logic', op: 'and', a: left, b: notExpr() });
      }
      return left;
    }
    function notExpr() {
      if (logicOf(toks[p]) === 'not') {
        p += 1;
        return node({ k: 'not', a: notExpr() });
      }
      return cmpExpr();
    }
    function cmpExpr() {
      const left = addExpr();
      if (toks[p] && CMP.has(toks[p].t)) {
        const op = toks[p].t; p += 1;
        const right = addExpr();
        if (toks[p] && CMP.has(toks[p].t)) throw new Error('CHAINED_COMPARISON');
        return node({ k: 'cmp', op, a: left, b: right });
      }
      return left;
    }
    function addExpr() {
      let left = mulExpr();
      while (toks[p] && (toks[p].t === '+' || toks[p].t === '-')) {
        const op = toks[p].t; p += 1;
        left = node({ k: 'bin', op, a: left, b: mulExpr() });
      }
      return left;
    }
    function mulExpr() {
      let left = factor();
      while (toks[p] && (toks[p].t === '*' || toks[p].t === '/')) {
        const op = toks[p].t; p += 1;
        left = node({ k: 'bin', op, a: left, b: factor() });
      }
      return left;
    }
    function factor() {
      const tk = toks[p];
      if (!tk) throw new Error('UNEXPECTED_END');
      if (tk.t === 'num') { p += 1; return node({ k: 'num', v: tk.v }); }
      if (tk.t === '(') {
        p += 1;
        const e = orExpr();
        if (!toks[p] || toks[p].t !== ')') throw new Error('EXPECTED_PAREN');
        p += 1; return e;
      }
      if (tk.t === '-') { p += 1; return node({ k: 'neg', a: factor() }); }
      if (tk.t === 'ident') {
        /*
           ★ 논리 낱말이 값 자리에 오면 문법 오류다. `close AND` 처럼 뒤가 빈 경우
             UNKNOWN_NAME:AND 로 나가면 원인을 짐작하기 어렵다.
        */
        if (logicOf(tk)) throw new Error('UNEXPECTED_LOGIC:' + tk.v);
        const name = tk.v.toUpperCase();
        if (FUNCS.has(name)) {
          p += 1;
          if (!toks[p] || toks[p].t !== '(') throw new Error('EXPECTED_LPAREN');
          p += 1;
          /*
             ★★ 중첩 단계를 **실제로 센다.**

               파일 머리말은 함수 인자 중첩 상한을 선언해 두었는데, 이 자리에 있던
               `let depth = 1;` 은 읽는 곳이 없어 아무것도 막지 않았다(eslint 이
               미사용 변수로 잡고 있었다). 선언한 제한이 강제되지 않으면 문서가
               사실과 달라진다 — 서버(indicator-formula.ts)도 같은 값을 센다.
          */
          callDepth += 1;
          if (callDepth > MAX_CALL_DEPTH) throw new Error('TOO_DEEP');
          const args = [orExpr()];
          while (toks[p] && toks[p].t === ',') { p += 1; args.push(orExpr()); }
          if (!toks[p] || toks[p].t !== ')') throw new Error('EXPECTED_RPAREN');
          p += 1;
          callDepth -= 1;
          const allowed = ARITY[name];
          if (allowed && allowed.indexOf(args.length) === -1) throw new Error('BAD_ARITY:' + name);
          return node({ k: 'call', name, args });
        }
        const lv = tk.v.toLowerCase();
        if (VARS.has(lv)) { p += 1; return node({ k: 'var', v: lv }); }
        throw new Error('UNKNOWN_NAME:' + tk.v);
      }
      throw new Error('UNEXPECTED_TOKEN');
    }
    const ast = orExpr();
    if (p !== toks.length) throw new Error('TRAILING_TOKENS');
    return ast;
  }

  const shift = (arr, n) => (n === 0 ? arr.slice() : Array.from({ length: n }, () => NaN).concat(arr.slice(0, arr.length - n)));

  /** 이동평균 — SMA·RSI 등이 공유한다. */
  function smaOf(a, w, len) {
    const out = new Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += a[i];
      if (i >= w) sum -= a[i - w];
      out[i] = i >= w - 1 ? sum / w : NaN;
    }
    return out;
  }
  /**
   * 지수이동평균.
   *
   * ★★★ **웜업 구간은 NaN 이다 — 값을 지어내지 않는다.**
   *
   *   처음 구현은 첫 봉부터 값을 내놓았다(`prev = a[0]`). 그러면 26봉 EMA 가 3번째
   *   봉에서도 숫자를 돌려주고, 그 숫자로 만든 MACD 가 "아는 값" 으로 보고된다.
   *   실측으로 드러났다 — 20봉만 주고 MACD 골든크로스를 평가했을 때 "모름 1봉" 이
   *   나왔다. 26봉 EMA 를 계산할 데이터가 없는데 19봉이 유효값으로 잡힌 것이다.
   *
   *   교과서 정의대로 **처음 w개의 SMA 로 씨앗을 만들고** 그 전은 NaN 으로 둔다.
   *   그러면 MACD_DIF 는 slow 기간이, MACD_DEA 는 거기에 signal 기간이 더 지나야
   *   값이 나온다 — 실제로 계산할 수 있는 시점과 일치한다.
   *
   * ★ SMA 도 같은 규칙이다(i >= w-1). 두 함수가 다르게 동작하면 고객이 EMA 로 바꿨을
   *   때만 앞쪽에 값이 생기는 것을 보고 EMA 가 더 좋다고 오해한다.
   */
  function emaOf(a, w, len) {
    const out = new Array(len).fill(NaN);
    const k = 2 / (w + 1);
    let seed = 0;
    let n = 0;
    let prev = NaN;
    for (let i = 0; i < len; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (!Number.isFinite(prev)) {
        seed += v; n += 1;
        if (n >= w) { prev = seed / n; out[i] = prev; }
        continue;
      }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  /**
   * Wilder 평활 — RSI·ATR 이 쓴다.
   *
   * ★ 단순 EMA 와 다르다(k = 1/w 대 2/(w+1)). RSI·ATR 의 통상 정의는 Wilder 이고,
   *   EMA 로 계산하면 값이 다르게 나온다. 화면의 klinecharts RSI 와 어긋나면
   *   고객은 어느 쪽이 맞는지 알 수 없다.
   */
  function wilderOf(a, w, len) {
    const out = new Array(len).fill(NaN);
    let acc = 0;
    let n = 0;
    let prev = NaN;
    for (let i = 0; i < len; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (!Number.isFinite(prev)) {
        acc += v; n += 1;
        if (n === w) { prev = acc / w; out[i] = prev; }
        continue;
      }
      prev = (prev * (w - 1) + v) / w;
      out[i] = prev;
    }
    return out;
  }

  /*
     ★★★ **참·거짓 삼값 논리.** 1 = 참, 0 = 거짓, NaN = 아직 모른다(웜업·결측).

       NaN 을 거짓으로 접으면 "조건이 성립하지 않았다" 와 "계산할 수 없다" 가
       구별되지 않고, 신호 엔진이 웜업 구간을 "신호 없음" 으로 오해한다.

     ★ 결과가 확정되는 경우는 확정한다 — 논리적으로 맞고, 불필요한 NaN 을 줄인다.
         거짓 AND 모름 = 거짓        참 OR 모름 = 참
         참  AND 모름 = 모름        거짓 OR 모름 = 모름
  */
  const T = 1; const F = 0;
  const truth = (v) => (Number.isFinite(v) ? (v > 0.5 ? T : F) : NaN);
  function andOf(x, y) {
    if (x === F || y === F) return F;
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
    return T;
  }
  function orOf(x, y) {
    if (x === T || y === T) return T;
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
    return F;
  }

  function evalNode(node, series, len) {
    const out = new Array(len);
    switch (node.k) {
      case 'num': out.fill(node.v); return out;
      case 'var': return series[node.v] || new Array(len).fill(NaN);
      case 'neg': { const a = evalNode(node.a, series, len); for (let i = 0; i < len; i++) out[i] = -a[i]; return out; }
      case 'cmp': {
        const a = evalNode(node.a, series, len);
        const b = evalNode(node.b, series, len);
        for (let i = 0; i < len; i++) {
          const x = a[i]; const y = b[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) { out[i] = NaN; continue; }
          switch (node.op) {
            case '>': out[i] = x > y ? T : F; break;
            case '>=': out[i] = x >= y ? T : F; break;
            case '<': out[i] = x < y ? T : F; break;
            case '<=': out[i] = x <= y ? T : F; break;
            case '==': out[i] = x === y ? T : F; break;
            default: out[i] = x !== y ? T : F; break;
          }
        }
        return out;
      }
      case 'logic': {
        const a = evalNode(node.a, series, len);
        const b = evalNode(node.b, series, len);
        for (let i = 0; i < len; i++) {
          const x = truth(a[i]); const y = truth(b[i]);
          out[i] = node.op === 'and' ? andOf(x, y) : orOf(x, y);
        }
        return out;
      }
      case 'not': {
        const a = evalNode(node.a, series, len);
        for (let i = 0; i < len; i++) {
          const x = truth(a[i]);
          out[i] = Number.isNaN(x) ? NaN : (x === T ? F : T);
        }
        return out;
      }
      case 'bin': {
        const a = evalNode(node.a, series, len);
        const b = evalNode(node.b, series, len);
        for (let i = 0; i < len; i++) {
          const x = a[i]; const y = b[i];
          out[i] = node.op === '+' ? x + y : node.op === '-' ? x - y : node.op === '*' ? x * y : (y === 0 ? NaN : x / y);
        }
        return out;
      }
      case 'call': {
        const name = node.name;
        if (name === 'MIN' || name === 'MAX') {
          const a = evalNode(node.args[0], series, len);
          const b = evalNode(node.args[1], series, len);
          for (let i = 0; i < len; i++) out[i] = name === 'MIN' ? Math.min(a[i], b[i]) : Math.max(a[i], b[i]);
          return out;
        }
        /*
           ★★ **교차는 두 계열을 함께 봐야 한다.** 기간 인자를 마지막 값으로 접는
             기존 경로(아래 `n`)에 넣으면 두 번째 인자가 계열인 함수가 망가진다.
             그래서 계열 두 개를 받는 함수는 여기서 먼저 처리한다.
        */
        if (name === 'CROSS_ABOVE' || name === 'CROSS_BELOW') {
          const a = evalNode(node.args[0], series, len);
          const b = evalNode(node.args[1], series, len);
          const above = name === 'CROSS_ABOVE';
          /*
             ★★★ **처음 비교할 수 있게 된 봉은 교차가 아니다 — 모름이다.**

               웜업이 끝나 두 계열이 처음 함께 유효해진 봉에서는, 그 **직전 관계를
               알 수 없다.** 그런데도 판정하면 "무엇이 무엇을 넘었다" 를 말하게 된다.

               실측으로 드러났다: MACD_DEA 가 처음 유효해지는 봉(34)에서 골든크로스가
               1건 잡혔다. 실제로 넘은 것이 아니라 **DEA 씨앗값과 아직 수렴 중인 DIF**
               를 비교한 결과였다. 추세가 계속 하락하던 구간인데 상향 교차가 나온다.

             ★ 그래서 유효한 쌍을 한 번 본 뒤부터 판정한다. 잡음 있는 실데이터에서는
               차이가 없다(400봉에서 11건 그대로) — 사라지는 것은 인공물뿐이다.
          */
          let sawValidPair = false;
          for (let i = 0; i < len; i++) {
            if (i === 0) { out[i] = NaN; continue; }
            const x0 = a[i - 1]; const y0 = b[i - 1];
            const x1 = a[i]; const y1 = b[i];
            if (![x0, y0, x1, y1].every(Number.isFinite)) { out[i] = NaN; continue; }
            if (!sawValidPair) { sawValidPair = true; out[i] = NaN; continue; }
            /*
               ★★★ **같았다가 벌어지는 것도 교차다.**

                 처음에는 `x0 !== y0` 를 조건에 넣어 "직전 봉에서 같았던 경우는
                 교차로 세지 않는다" 고 했다. 이유는 "접점이 방향을 확정하지 못하고,
                 세면 횡보 구간에서 신호가 쏟아진다" 였다. **둘 다 틀렸다.**

                 실측으로 드러났다: 합성 캔들에서 하락이 일정하면 DIF 와 DEA 가
                 **정확히 같아지고**(둘 다 -7.000), 추세가 돌아 위로 벌어지는
                 봉에서 교차가 걸러졌다 — MACD 골든크로스가 0건이 됐다.

                 쏟아지지도 않는다. 같은 상태가 여러 봉 이어져도 `x1 > y1` 이
                 참인 봉은 벌어지는 첫 봉 하나뿐이다(실측: 평평한 40봉 뒤 상승 →
                 정확히 1건).

               ★ 그래서 표준 정의를 쓴다: 직전에 **작거나 같았고** 지금 크다.
                 모든 차트 도구가 이렇게 판정한다.
            */
            out[i] = above
              ? (x0 <= y0 && x1 > y1 ? T : F)
              : (x0 >= y0 && x1 < y1 ? T : F);
          }
          return out;
        }
        if (name === 'MACD_DIF' || name === 'MACD_DEA' || name === 'MACD_HIST') {
          /*
             ★ 기간 인자는 상수여야 한다 — 계열을 받으면 봉마다 기간이 달라져
               계산이 정의되지 않는다. 마지막 값을 정수로 읽는다(기존 관례와 같다).
          */
          const intArg = (k, dflt) => {
            if (!node.args[k]) return dflt;
            const v = evalNode(node.args[k], series, len)[len - 1];
            return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : dflt;
          };
          const fast = intArg(0, 12);
          const slow = intArg(1, 26);
          const close = series.close;
          const dif = new Array(len);
          const ef = emaOf(close, fast, len);
          const es = emaOf(close, slow, len);
          for (let i = 0; i < len; i++) dif[i] = ef[i] - es[i];
          if (name === 'MACD_DIF') return dif;
          const sig = intArg(2, 9);
          const dea = emaOf(dif, sig, len);
          if (name === 'MACD_DEA') return dea;
          /* ★ 히스토그램은 (DIF-DEA)×2 가 관례다(klinecharts 도 그렇다). */
          for (let i = 0; i < len; i++) out[i] = (dif[i] - dea[i]) * 2;
          return out;
        }
        if (name === 'ATR') {
          const v = evalNode(node.args[0], series, len)[len - 1];
          const w = Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 14;
          const tr = new Array(len);
          const { high, low, close } = series;
          for (let i = 0; i < len; i++) {
            if (i === 0) { tr[i] = high[i] - low[i]; continue; }
            tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
          }
          return wilderOf(tr, w, len);
        }

        const a = evalNode(node.args[0], series, len);
        const n = node.args[1] ? evalNode(node.args[1], series, len)[len - 1] : null;
        const N = Number.isFinite(n) ? Math.floor(n) : 0;
        if (name === 'ABS') { for (let i = 0; i < len; i++) out[i] = Math.abs(a[i]); return out; }
        if (name === 'SQRT') { for (let i = 0; i < len; i++) out[i] = a[i] < 0 ? NaN : Math.sqrt(a[i]); return out; }
        if (name === 'POW') { const e = node.args[1] ? N : 2; for (let i = 0; i < len; i++) out[i] = Math.pow(a[i], e); return out; }
        if (name === 'REF') { return shift(a, Math.max(0, N)); }
        if (name === 'DELTA') { const s = shift(a, Math.max(0, N)); for (let i = 0; i < len; i++) out[i] = a[i] - s[i]; return out; }
        if (name === 'SMA') { return smaOf(a, Math.max(1, N), len); }
        if (name === 'EMA') { return emaOf(a, Math.max(1, N), len); }
        if (name === 'SUM') {
          const w = Math.max(1, N);
          let sum = 0;
          for (let i = 0; i < len; i++) {
            sum += a[i];
            if (i >= w) sum -= a[i - w];
            out[i] = i >= w - 1 ? sum : NaN;
          }
          return out;
        }
        if (name === 'HHV' || name === 'LLV') {
          const w = Math.max(1, N);
          const hi = name === 'HHV';
          for (let i = 0; i < len; i++) {
            if (i < w - 1) { out[i] = NaN; continue; }
            let best = NaN;
            for (let j = i - w + 1; j <= i; j++) {
              const v = a[j];
              if (!Number.isFinite(v)) continue;
              best = Number.isFinite(best) ? (hi ? Math.max(best, v) : Math.min(best, v)) : v;
            }
            out[i] = best;
          }
          return out;
        }
        if (name === 'RISING' || name === 'FALLING') {
          /*
             ★ "n봉 연속 상승" 은 **n번의 비교**를 뜻한다(봉 n+1개가 필요하다).
               운영자가 "3봉 연속 올랐다" 고 말할 때 뜻하는 것이 이것이다.
          */
          const w = Math.max(1, N);
          const up = name === 'RISING';
          for (let i = 0; i < len; i++) {
            if (i < w) { out[i] = NaN; continue; }
            let ok = T;
            for (let j = i - w + 1; j <= i; j++) {
              const cur = a[j]; const prv = a[j - 1];
              if (!Number.isFinite(cur) || !Number.isFinite(prv)) { ok = NaN; break; }
              if (up ? !(cur > prv) : !(cur < prv)) { ok = F; break; }
            }
            out[i] = ok;
          }
          return out;
        }
        if (name === 'COUNT') {
          /*
             ★ 조건이 참인 봉의 개수. 모르는 봉(NaN)은 세지 않는다 — 참으로도
               거짓으로도 세지 않는다. 창 안이 전부 모름이면 결과도 모름이다.
          */
          const w = Math.max(1, N);
          for (let i = 0; i < len; i++) {
            if (i < w - 1) { out[i] = NaN; continue; }
            let cnt = 0; let known = 0;
            for (let j = i - w + 1; j <= i; j++) {
              const t = truth(a[j]);
              if (Number.isNaN(t)) continue;
              known += 1;
              if (t === T) cnt += 1;
            }
            out[i] = known === 0 ? NaN : cnt;
          }
          return out;
        }
        if (name === 'RSI') {
          const w = Math.max(1, N);
          const gain = new Array(len).fill(NaN);
          const loss = new Array(len).fill(NaN);
          for (let i = 1; i < len; i++) {
            const d = a[i] - a[i - 1];
            if (!Number.isFinite(d)) continue;
            gain[i] = d > 0 ? d : 0;
            loss[i] = d < 0 ? -d : 0;
          }
          const ag = wilderOf(gain, w, len);
          const al = wilderOf(loss, w, len);
          for (let i = 0; i < len; i++) {
            const g = ag[i]; const l = al[i];
            if (!Number.isFinite(g) || !Number.isFinite(l)) { out[i] = NaN; continue; }
            out[i] = l === 0 ? 100 : 100 - (100 / (1 + g / l));
          }
          return out;
        }
        if (name === 'STDDEV') {
          const w = Math.max(2, N);
          for (let i = 0; i < len; i++) {
            if (i < w - 1) { out[i] = NaN; continue; }
            let mean = 0;
            for (let j = i - w + 1; j <= i; j++) mean += a[j];
            mean /= w;
            let acc = 0;
            for (let j = i - w + 1; j <= i; j++) acc += (a[j] - mean) * (a[j] - mean);
            out[i] = Math.sqrt(acc / w);
          }
          return out;
        }
        throw new Error('UNKNOWN_FUNC:' + name);
      }
      default: throw new Error('BAD_NODE');
    }
  }

  window.QTFmla = {
    MAX_LEN,
    MAX_NODES,
    MAX_CALL_DEPTH,
    /*
       ★★ 문법 목록을 **하나의 출처**로 내보낸다. 화면 도움말·AI 프롬프트·서버 검증이
         각자 목록을 들고 있으면 하나를 늘릴 때 나머지가 조용히 뒤처진다 —
         지표 27종 목록에서 실제로 그 일이 있었다(8종이 빠져 있었다).
    */
    FUNCS: Array.from(FUNCS),
    VARS: Array.from(VARS),
    ARITY,
    OPERATORS: ['+', '-', '*', '/', '>', '>=', '<', '<=', '==', '!=', 'AND', 'OR', 'NOT'],
    /** 파싱. 성공 { ok:true, ast } · 실패 { ok:false, error } */
    parse(src) {
      const s = String(src || '').trim();
      if (!s) return { ok: false, error: 'EMPTY' };
      if (s.length > MAX_LEN) return { ok: false, error: 'TOO_LONG' };
      const t = tokenize(s);
      if (t.err) return { ok: false, error: t.err };
      if (t.toks.length === 0) return { ok: false, error: 'EMPTY' };
      try { return { ok: true, ast: parseTokens(t.toks) }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    /** 평가. bars: [{open,high,low,close,volume}] → number[] (NaN 허용) */
    eval(ast, bars) {
      const len = bars.length;
      const series = {
        close: bars.map((b) => b.close), open: bars.map((b) => b.open),
        high: bars.map((b) => b.high), low: bars.map((b) => b.low),
        volume: bars.map((b) => b.volume),
        hl2: bars.map((b) => (b.high + b.low) / 2),
        hlc3: bars.map((b) => (b.high + b.low + b.close) / 3),
      };
      return evalNode(ast, series, len);
    },
    /** 편의: 파싱+평가 한 번에. */
    compute(src, bars) {
      const r = window.QTFmla.parse(src);
      if (!r.ok) return r;
      try { return { ok: true, values: window.QTFmla.eval(r.ast, bars) }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
  };
})();
