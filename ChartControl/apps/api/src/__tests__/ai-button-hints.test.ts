import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

/*
   ★★ 버튼이 무엇을 하는지 — 그리고 **하지 않는지** — 적혀 있는지 잠근다.

     '주문 초안 만들기(Create Order Draft)' 는 이름에 '주문' 이 들어 있는데 실제로는
     주문이 아니다. 주문 패널 입력칸에 숫자를 채우는 것뿐이고, 거래소로 가는 것은
     고객이 수량을 넣고 확인창까지 통과한 뒤다.

     설명이 없으면 두 방향으로 다 틀린다:
       · 주문인 줄 알고 안 누른다  → 기능을 못 쓴다
       · 주문인 줄 알고 누른다      → 의도하지 않은 주문 흐름에 들어간다

     실주문이 붙어 있는 서비스(TRADING_MODE=KUCOIN_LIVE)에서 둘 다 위험하다.

   ★ 이 테스트가 없으면 문구가 조용히 사라져도 아무도 모른다. 화면 문구는 코드가
     동작하는지와 무관해서 테스트가 없으면 지워진 것을 알 수 없다.
*/
describe('AI 버튼 안내 — 버튼이 무엇을 하고 하지 않는지 적혀 있다', () => {
  it('신호 카드가 안내 문구를 렌더한다', () => {
    const src = read('../../../../src/ai-copilot.jsx');
    /* 주석은 제외 — 왜 넣었는지 설명하려면 키 이름을 언급해야 한다. */
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, '주문 초안 버튼 안내가 없다').toContain('ai_draft_btn_hint');
    expect(code, '저장 버튼 안내가 없다').toContain('ai_approve_btn_hint');
  });

  /*
     ★★ 문구가 "주문이 들어가지 않는다" 는 것을 **명시**하는지 본다.

       '채워집니다' 만 적으면 고객은 "채워진 다음 자동으로 나가나?" 를 여전히 모른다.
       하지 않는 일을 분명히 말하는 것이 하는 일을 말하는 것보다 중요하다.

     ★ 언어마다 표현이 달라 부정 표현을 각각 확인한다. 영어만 확인하면 번역에서
       그 문장이 빠져도 통과한다 — 실제로 이 코드베이스에서 번역 누락이 반복됐다.
  */
  const NEGATION: Record<string, RegExp> = {
    en: /No order is placed/i,
    ja: /注文は出ません/,
    zh: /不会下单/,
  };

  for (const [loc, re] of Object.entries(NEGATION)) {
    it(`${loc} 사전이 "주문이 들어가지 않는다" 를 명시한다`, () => {
      const dict = read(`../../../../src/locales/${loc}.js`);
      expect(dict, `${loc} 사전에 ai_draft_btn_hint 가 없다`).toContain('ai_draft_btn_hint');
      const at = dict.indexOf('ai_draft_btn_hint');
      /* 해당 항목 한 줄만 본다 — 다른 문구가 우연히 일치하는 것을 배제한다. */
      const line = dict.slice(at, dict.indexOf('\n', at));
      expect(line, `${loc}: 주문이 나가지 않는다는 사실이 문구에 없다`).toMatch(re);
    });
  }

  /*
     ★ 안내가 초보자 모드에만 걸려 있지 않은지 확인한다. 이것은 팁이 아니라 오해를
       막는 사실 안내이고, 오해는 숙련자도 한다.
  */
  it('안내가 초보자 모드에만 갇혀 있지 않다', () => {
    const src = read('../../../../src/ai-copilot.jsx');
    const at = src.indexOf('ai_draft_btn_hint');
    expect(at, 'ai_draft_btn_hint 가 없다').toBeGreaterThan(0);
    /* 같은 JSX 블록 앞쪽에 isBeginner 조건이 붙어 있지 않은지 본다. */
    const before = src.slice(Math.max(0, at - 400), at);
    expect(before, '초보자 모드에만 보인다').not.toMatch(/isBeginner\s*\?[^}]*$/);
  });
});
