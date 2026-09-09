import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

/*
   ★★ **AI 가 무엇을 어디에 그렸는지 말하는지** 잠근다.

     이 코드베이스에서 같은 사고가 두 번 났다:

       1) `ai_tool_signal` — '📊 5 overlays created · entry zone / SL / TP1-3 / long
          marker' 를 하드코딩했다. 서버 구조가 바뀐 뒤에는 **하나도 그리지 않았는데도**
          이 문구가 나갔다. 고객이 "안 그려졌다" 고 문의했다.

       2) `ai_tool_sr` — '📍 2 support/resistance levels added'. 이 명령은 선을
          **한 개** 그린다. 개수가 문구에 박혀 있어 항상 2라고 보고했다.

     둘 다 "화면이 하지 않은 일을 했다고 말한다" 는 같은 실패다. 이 저장소가 명시적으로
     금지한 것이고, 실주문이 붙어 있으므로 신뢰가 깨지면 되돌리기 어렵다.

   ★ 그래서 **문구에 숫자를 박지 않는다**는 것을 테스트로 고정한다.
*/
describe('AI 그림 보고 — 하지 않은 일을 했다고 말하지 않는다', () => {
  it('개수를 하드코딩한 문구가 사전에 없다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = read(`../../../../src/locales/copilot.${loc}.js`);
      /* 주석은 제외 — 왜 지웠는지 설명하려면 옛 문구를 언급해야 한다. */
      const code = dict.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, `${loc}: 개수를 박은 ai_tool_sr 이 살아 있다`).not.toMatch(/ai_tool_sr\s*:/);
    }
  });

  /*
     ★ 각 그림 명령이 **가격을 담은** 전용 문구를 쓰는지 본다.

       "차트에 적용했습니다" 만으로는 고객이 자기가 생각한 자리에 그려졌는지 확인할 수
       없다. 확인할 수 없는 보고는 보고가 아니다.
  */
  const DREW_KEYS = [
    'ai_drew_trendline',
    'ai_drew_level',
    'ai_drew_support',
    'ai_drew_resistance',
    'ai_drew_entry_zone',
    'ai_drew_stop',
    'ai_drew_target',
    'ai_drew_invalidation',
    'ai_drew_long_marker',
    'ai_drew_short_marker',
  ];

  it('그림 보고 문구가 3개 언어에 모두 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = read(`../../../../src/locales/copilot.${loc}.js`);
      for (const k of DREW_KEYS) {
        expect(dict, `${loc} 사전에 ${k} 가 없다`).toContain(`${k}:`);
      }
    }
  });

  /*
     ★★ 문구에 가격 자리(placeholder)가 있는지 확인한다.

       키만 있고 문구가 "그렸습니다" 뿐이면 이 테스트가 통과하면서도 고객은 가격을
       못 본다. 자리표시자가 있어야 실제 값이 들어간다.
  */
  it('그림 보고 문구가 실제 가격을 담는다 (자리표시자 존재)', () => {
    const dict = read('../../../../src/locales/copilot.en.js');
    const NEEDS: Record<string, string[]> = {
      ai_drew_trendline: ['{from}', '{to}'],
      ai_drew_level: ['{price}'],
      ai_drew_support: ['{price}'],
      ai_drew_resistance: ['{price}'],
      ai_drew_entry_zone: ['{lo}', '{hi}'],
      ai_drew_stop: ['{price}'],
      ai_drew_target: ['{n}', '{price}'],
      ai_drew_invalidation: ['{price}'],
      ai_drew_long_marker: ['{price}'],
      ai_drew_short_marker: ['{price}'],
    };
    for (const [k, holders] of Object.entries(NEEDS)) {
      const at = dict.indexOf(`${k}:`);
      expect(at, `${k} 가 없다`).toBeGreaterThan(0);
      const line = dict.slice(at, dict.indexOf('\n', at));
      for (const h of holders) {
        expect(line, `${k} 에 ${h} 자리표시자가 없다 — 가격이 표시되지 않는다`).toContain(h);
      }
    }
  });

  /*
     ★★ 화면 코드가 뭉뚱그린 문구로 되돌아가지 않았는지 본다.

       그림 명령이 `ai_cmd_applied`('Applied to chart') 를 돌려주면 고객은 무엇이
       어디에 그려졌는지 알 수 없다. 그림 명령 분기에서는 그 문구를 쓰지 않아야 한다.
  */
  it('그림 명령이 뭉뚱그린 문구를 쓰지 않는다', () => {
    const src = read('../../../../src/ai-copilot.jsx');
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const cmd of ['createStopLoss', 'createTakeProfit', 'createHorizontalLevel', 'createEntryZone', 'createInvalidationLevel']) {
      const at = code.indexOf(`case '${cmd}'`);
      expect(at, `${cmd} 분기가 없다`).toBeGreaterThan(0);
      /* 그 분기의 return 까지만 본다. */
      const seg = code.slice(at, code.indexOf('case ', at + 10));
      expect(seg, `${cmd} 가 무엇을 그렸는지 말하지 않는다`).toMatch(/ai_drew_/);
    }
  });
});
