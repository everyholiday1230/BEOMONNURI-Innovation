/**
 * 지표 수식 DSL — 샌드박스 평가기.
 *
 * 왜 존재하나
 * ----------
 * 고객이 AI에게 "이런 지표 만들어줘" 라고 말하면, AI 가 **임의 자바스크립트**를
 * 만들어 차트에 주입하는 것은 브라우저에서 임의 코드 실행이다. 그래서 AI(및
 * 사용자)의 지표 정의는 **이 DSL 표현식**으로만 받고, 화이트리스트 함수·변수만
 * 계산한다. 허용 목록 밖의 토큰은 파싱 단계에서 거부된다 — 평가를 시도조차
 * 하지 않는다.
 *
 * 문법 (단일 결과 계열을 반환하는 표현식)
 *   · 변수: close open high low volume hl2 hlc3  (봉 단위 배열)
 *   · 함수: SMA(x,n) EMA(x,n) STDDEV(x,n) REF(x,n) DELTA(x,n)
 *           ABS(x) MIN(x,y) MAX(x,y) POW(x,n) SQRT(x)
 *   · 연산: + - * / 괄호, 숫자 리터럴
 *   · 나누기 0 → NaN (예외를 던지지 않는다 — 한 봉이 터져도 전체가 죽지 않게)
 *
 * 제한 (과부하·남용 방지)
 *   · 길이 400자 이하, 노드 80개 이하, 함수 인자 중첩 3단계 이하
 */
(function () {
  'use strict';
  const MAX_LEN = 400;
  const MAX_NODES = 80;
  /** 함수 인자 중첩 상한 — 머리말이 선언한 값. 서버도 같은 값을 센다. */
  const MAX_CALL_DEPTH = 3;
  const FUNCS = new Set(['SMA', 'EMA', 'STDDEV', 'REF', 'DELTA', 'ABS', 'MIN', 'MAX', 'POW', 'SQRT']);
  const VARS = new Set(['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3']);
  /*
     함수별 인자 개수 — 아래 evalNode 가 실제로 쓰는 값이다.

     ★ 개수를 확인해야 하는 이유: `MIN(close)` 처럼 인자가 빠지면 evalNode 가
       `node.args[1]` 이 undefined 인 채로 재귀해 터진다. 파싱 단계에서 막는다.
     ★ POW 는 지수를 생략하면 2 로 본다 — 1 또는 2 를 받는다.
  */
  const ARITY = {
    SMA: [2], EMA: [2], STDDEV: [2], REF: [2], DELTA: [2],
    MIN: [2], MAX: [2],
    ABS: [1], SQRT: [1],
    POW: [1, 2],
  };

  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n') { i += 1; continue; }
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

  /** 재귀 하강 파서. grammar: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* */
  function parseTokens(toks) {
    let p = 0;
    let nodes = 0;
    let callDepth = 0;
    const node = (n) => { nodes += 1; if (nodes > MAX_NODES) throw new Error('TOO_COMPLEX'); return n; };
    function expr() {
      let left = term();
      while (toks[p] && (toks[p].t === '+' || toks[p].t === '-')) {
        const op = toks[p].t; p += 1;
        left = node({ k: 'bin', op, a: left, b: term() });
      }
      return left;
    }
    function term() {
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
        const e = expr();
        if (!toks[p] || toks[p].t !== ')') throw new Error('EXPECTED_PAREN');
        p += 1; return e;
      }
      if (tk.t === '-') { p += 1; return node({ k: 'neg', a: factor() }); }
      if (tk.t === 'ident') {
        const name = tk.v.toUpperCase();
        if (FUNCS.has(name)) {
          p += 1;
          if (!toks[p] || toks[p].t !== '(') throw new Error('EXPECTED_LPAREN');
          p += 1;
          /*
             ★★ 중첩 단계를 **실제로 센다.**

               파일 머리말은 "함수 인자 중첩 3단계 이하" 를 제한으로 선언해 두었는데,
               이 자리에 있던 `let depth = 1;` 은 읽는 곳이 없어 아무것도 막지 않았다
               (eslint 이 미사용 변수로 잡고 있었다). 선언한 제한이 강제되지 않으면
               문서가 사실과 달라진다 — 서버(indicator-formula.ts)도 같은 값을 센다.
          */
          callDepth += 1;
          if (callDepth > MAX_CALL_DEPTH) throw new Error('TOO_DEEP');
          const args = [expr()];
          while (toks[p] && toks[p].t === ',') { p += 1; args.push(expr()); }
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
    const ast = expr();
    if (p !== toks.length) throw new Error('TRAILING_TOKENS');
    return ast;
  }

  const shift = (arr, n) => (n === 0 ? arr.slice() : Array.from({ length: n }, () => NaN).concat(arr.slice(0, arr.length - n)));

  function evalNode(node, series, len) {
    const out = new Array(len);
    switch (node.k) {
      case 'num': out.fill(node.v); return out;
      case 'var': return series[node.v] || new Array(len).fill(NaN);
      case 'neg': { const a = evalNode(node.a, series, len); for (let i = 0; i < len; i++) out[i] = -a[i]; return out; }
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
        const a = evalNode(node.args[0], series, len);
        const n = node.args[1] ? evalNode(node.args[1], series, len)[len - 1] : null;
        const N = Number.isFinite(n) ? Math.floor(n) : 0;
        if (name === 'ABS') { for (let i = 0; i < len; i++) out[i] = Math.abs(a[i]); return out; }
        if (name === 'SQRT') { for (let i = 0; i < len; i++) out[i] = a[i] < 0 ? NaN : Math.sqrt(a[i]); return out; }
        if (name === 'POW') { const e = node.args[1] ? N : 2; for (let i = 0; i < len; i++) out[i] = Math.pow(a[i], e); return out; }
        if (name === 'REF') { return shift(a, Math.max(0, N)); }
        if (name === 'DELTA') { const s = shift(a, Math.max(0, N)); for (let i = 0; i < len; i++) out[i] = a[i] - s[i]; return out; }
        if (name === 'SMA') {
          const w = Math.max(1, N);
          let sum = 0;
          for (let i = 0; i < len; i++) {
            sum += a[i];
            if (i >= w) sum -= a[i - w];
            out[i] = i >= w - 1 ? sum / w : NaN;
          }
          return out;
        }
        if (name === 'EMA') {
          const w = Math.max(1, N);
          const k = 2 / (w + 1);
          let prev = NaN;
          for (let i = 0; i < len; i++) {
            prev = Number.isFinite(prev) ? a[i] * k + prev * (1 - k) : a[i];
            out[i] = prev;
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
