/**
 * 실주문 경로의 입력 검증과 킬스위치 예외.
 *
 * ★★★ 감사 지적 두 건을 못 박는다.
 *
 *   ⑦ 실주문(`/trading/orders/submit`)에 zod 검증이 **0건**이었다.
 *      `String()`/`Number()` 캐스팅만 있었다 — 잘못된 입력이 조용히 그럴듯한 값으로
 *      바뀌어 거래소까지 내려간다:
 *          String(undefined) → 'undefined' · Number('abc') → NaN
 *      수량이나 가격이 그렇게 들어가면 고객 돈이 걸린다.
 *      (OrderIntentSchema 는 draft/validate 전용이고 필드가 달라 재사용할 수 없다.)
 *
 *   ⑧ 킬스위치가 **청산 주문까지** 막았다.
 *      `new_positions` 스위치의 뜻은 이름 그대로 신규 포지션 차단인데, 실주문 경로는
 *      4스코프를 전면 OR 로 걸어 reduceOnly 주문도 막았다. 시장이 급변해 운영자가
 *      그 스위치를 걸면 **고객은 포지션을 닫을 수 없다** — 가장 위험한 순간에
 *      탈출구를 잠그는 셈이다. 검증 경로에는 이미 예외가 있었고 실주문에만 없었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../trading-routes.ts', import.meta.url), 'utf-8');
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** submit 라우트 본문만 잘라낸다. */
const submitSeg = (() => {
  const at = codeOnly.indexOf("app.post('/trading/orders/submit'");
  return at < 0 ? '' : codeOnly.slice(at, at + 9000);
})();

describe('⑦ 실주문 입력 검증', () => {
  it('submit 이 zod 로 body 를 검증한다', () => {
    expect(submitSeg, 'submit 라우트를 찾지 못했다').not.toBe('');
    expect(submitSeg, 'safeParse 가 없다 — 캐스팅만으로는 잘못된 입력이 통과한다')
      .toContain('SubmitOrderSchema.safeParse');
    expect(submitSeg, '실패를 400 으로 거부하지 않는다').toContain('INVALID_ORDER');
  });

  it('★ 검증이 주문 처리보다 앞에 있다', () => {
    /*
       ★★ 뒤에 있으면 이미 상태를 바꾼 뒤다. 검증은 가장 먼저여야 한다.
    */
    const parse = submitSeg.indexOf('SubmitOrderSchema.safeParse');
    const idem = submitSeg.indexOf('idem.run(');
    expect(parse).toBeGreaterThan(-1);
    expect(idem).toBeGreaterThan(-1);
    expect(parse, '검증이 주문 실행보다 뒤에 있다').toBeLessThan(idem);
  });

  it('★ 실패 이유를 필드 단위로 알려준다', () => {
    /* ★ "잘못된 요청" 만 주면 고객도 우리도 무엇을 고쳐야 하는지 모른다. */
    expect(submitSeg).toContain('parsedBody.error.issues');
    expect(submitSeg).toContain('is.path.join');
  });

  it('★★ 화면이 실제로 보내는 이름을 받는다 — quantity·price', () => {
    /*
       ★★★ 처음에는 서버 내부 이름(size·limitPrice)으로 스키마를 만들었다. 그런데
         화면은 `quantity`·`price` 를 보낸다(app.jsx 의 submitLive). 그대로 두면
         **정상 주문이 전부 400** 이 됐다 — 기존 시험 2건이 즉시 잡았다.
       ★ 서버가 `body.quantity ?? body.size` 로 둘 다 읽으므로 스키마도 둘 다 받는다.
    */
    const at = codeOnly.indexOf('const SubmitOrderSchema');
    expect(at).toBeGreaterThan(-1);
    const schema = codeOnly.slice(at, at + 2600);
    expect(schema, 'quantity 를 받지 않는다').toContain('quantity:');
    expect(schema, 'size 도 받아야 한다(서버가 둘 다 읽는다)').toContain('size:');
    expect(schema, 'price 를 받지 않는다').toContain('price:');
    expect(schema, 'orderType 을 받지 않는다').toContain('orderType:');
  });

  it('★ strict 를 쓰지 않는다 — 모르는 필드로 주문이 막히면 더 큰 사고다', () => {
    /*
       ★★ 화면이 보내는 필드는 앞으로 늘 수 있다. 모르는 필드 하나에 주문이 막히면
         그것이 더 큰 사고다. 대신 **아는 필드의 형식은 엄격하게** 본다.
    */
    const at = codeOnly.indexOf('const SubmitOrderSchema');
    const schema = codeOnly.slice(at, at + 2600);
    expect(schema).toContain('.passthrough()');
    expect(schema, 'strict 는 정상 주문을 막는다').not.toContain('.strict()');
  });

  it('지정가는 가격을, 스톱은 스톱가격을 요구한다', () => {
    const at = codeOnly.indexOf('const SubmitOrderSchema');
    const schema = codeOnly.slice(at, at + 3200);
    expect(schema).toContain("price required for limit orders");
    expect(schema).toContain("stopPrice required for stop orders");
    expect(schema, '수량 누락을 잡지 않는다').toContain('quantity is required');
  });
});

describe('⑧ 킬스위치가 청산 주문을 막지 않는다', () => {
  it('★★★ reduceOnly 면 new_positions 스코프를 뺀다', () => {
    /*
       ★★★ 이것이 없으면 시장이 급변할 때 고객이 **포지션을 닫을 수 없다.**
         new_positions 의 뜻은 신규 포지션 차단이지 청산 차단이 아니다.
    */
    expect(codeOnly, 'reduceOnly 예외가 없다').toContain("sc !== 'new_positions'");
    const at = codeOnly.indexOf('emergencyKillSwitch:');
    expect(at).toBeGreaterThan(-1);
    const seg = codeOnly.slice(at, at + 700);
    expect(seg, 'reduceOnly 를 보지 않는다').toContain('body.reduceOnly === true');
  });

  it('★ global·exchange 스위치는 예외 없이 막는다', () => {
    /*
       ★ 그 스위치들은 "이 거래소로 주문을 내지 말라" 는 뜻이므로 청산도 포함된다.
         reduceOnly 예외는 new_positions **하나만** 이어야 한다.
    */
    const at = codeOnly.indexOf('emergencyKillSwitch:');
    const seg = codeOnly.slice(at, at + 700);
    const excluded = [...seg.matchAll(/sc !== '([a-z_]+)'/g)].map((m) => m[1]);
    expect(excluded, 'new_positions 외의 스코프까지 빼면 스위치가 무력해진다').toEqual(['new_positions']);
  });

  it('★ reduceOnly 를 모르면 신규로 간주해 막는다', () => {
    /*
       ★★ 모르는 것을 청산으로 취급하면 스위치를 우회하는 길이 된다.
         `=== true` 이므로 필드가 없으면 false → 전면 차단이 유지된다.
    */
    const at = codeOnly.indexOf('emergencyKillSwitch:');
    const seg = codeOnly.slice(at, at + 700);
    expect(seg).toContain('body.reduceOnly === true');
    expect(seg, 'truthy 검사로 바뀌면 문자열 등이 청산으로 통과한다').not.toMatch(/if \(body\.reduceOnly\)/);
  });
});
