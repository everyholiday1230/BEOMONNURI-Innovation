import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
/* 주석은 제외한다 — 왜 고쳤는지 설명하려면 옛 필드명을 언급해야 한다. */
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/*
   ★★ **옛 신호 필드를 읽는 코드가 남지 않았는지** 잠근다.

     신호 구조가 두 번 바뀌었다:

       entryZone / takeProfits / stopLoss        (1차)
         → entry / stop / targets / direction    (2차)
           → sides[].{entry,stop,targets,direction}  (3차, 양방향 대칭 제시)

     매번 화면 코드 일부가 뒤처졌고, **그때마다 조용히 망가졌다:**

       · 1→2차: applySignal 이 `!Array.isArray(sig.entryZone)` 로 전부 걸러냈는데
         대화에는 '📊 5 overlays created' 가 붙었다. 그리지 않은 것을 그렸다고 말했다.
         고객 문의로 돌아왔다.
       · 1→2차: app.jsx 의 `currentSignal.entryZone[0]` 이 TypeError 로 터져서
         '주문 초안' 을 누르면 화면이 죽었다.
       · 2→3차: 알림 설정 버튼이 `currentSignal.entryZone` 을 읽어 **절대 동작하지
         않았다.** 게다가 "알림 가격이 없다" 는 오류를 띄워서 고객은 자기 셋업에 문제가
         있는 줄 알았다.

   ★ 세 번 같은 실수를 했다. 사람이 눈으로 찾는 방식은 실패했으므로 테스트로 막는다.

   ★ JS 는 없는 필드를 읽어도 undefined 를 주고 조용히 넘어간다. 타입 검사도 이
     파일들을(plain JSX) 잡지 못한다. 그래서 문자열 검사가 유일한 방어다.
*/
describe('신호 구조 — 옛 필드를 읽는 코드가 남아 있지 않다', () => {
  const FILES = ['../../../../src/ai-copilot.jsx', '../../../../src/app.jsx', '../../../../src/widgets.jsx'];

  /* 3차 구조에서 **최상위에는 없는** 필드들. 이제 sides[] 안에 있다. */
  const REMOVED_TOP_LEVEL = [
    'entryZone',
    'takeProfits',
    'stopLoss',
    'direction',
    'targets',
    'riskReward',
    'contradictingEvidence',
    'confidence',
  ];

  const HOLDERS = ['currentSignal', 'ev.signal'];

  for (const file of FILES) {
    for (const holder of HOLDERS) {
      for (const field of REMOVED_TOP_LEVEL) {
        it(`${file.split('/').pop()}: ${holder}.${field} 을 읽지 않는다`, () => {
          const code = stripComments(read(file));
          const re = new RegExp(`${holder.replace('.', '\\.')}\\.${field}\\b`);
          expect(code, `${holder}.${field} 은 없는 필드다 — undefined 를 읽고 조용히 망가진다`).not.toMatch(re);
        });
      }
    }
  }

  /*
     ★ `signal.` 은 SignalCard 의 지역 인자라 별도로 본다. 여기서도 최상위 옛 필드를
       읽으면 안 된다.
  */
  it('SignalCard 가 signal.direction / signal.entry 를 읽지 않는다', () => {
    const code = stripComments(read('../../../../src/ai-copilot.jsx'));
    expect(code).not.toMatch(/\bsignal\.direction\b/);
    expect(code).not.toMatch(/\bsignal\.entry\b/);
    expect(code).not.toMatch(/\bsignal\.stop\b/);
    expect(code).not.toMatch(/\bsignal\.entryZone\b/);
  });

  /*
     ★★ 반대쪽도 확인한다 — 새 구조를 **실제로 쓰고 있는지**.

       위 검사만 있으면 필드를 전부 지워도 통과한다. 그러면 화면이 아무것도 안 그리는데
       테스트는 초록이 된다. 이 코드베이스에서 정확히 그런 사고가 났다.
  */
  it('새 구조(sides)를 실제로 읽는다', () => {
    const copilot = stripComments(read('../../../../src/ai-copilot.jsx'));
    const app = stripComments(read('../../../../src/app.jsx'));
    expect(copilot, 'ai-copilot 이 sides 를 읽지 않는다').toMatch(/\bsignal\.sides\b|\bcurrentSignal\.sides\b/);
    expect(app, 'app 이 sides 를 읽지 않는다').toMatch(/\bcurrentSignal\.sides\b/);
  });

  /*
     ★★ 양방향 제시일 때 방향을 골라야 하는 동작은 **막혀 있어야** 한다.

       주문 초안과 가격 알림이 그렇다. 코드가 방향을 하나 고르면 화면은 대칭인데
       주문·알림은 한쪽이 된다 — 고객이 고르지 않은 방향이다.
  */
  it('주문 초안과 알림이 양방향일 때 방향을 고르지 않는다', () => {
    const app = stripComments(read('../../../../src/app.jsx'));
    const copilot = stripComments(read('../../../../src/ai-copilot.jsx'));
    expect(app, '주문 초안이 sides 길이를 확인하지 않는다').toMatch(/sides\.length\s*!==\s*1/);
    expect(copilot, '알림이 sides 길이를 확인하지 않는다').toMatch(/alertSides\.length\s*!==\s*1/);
  });
});
