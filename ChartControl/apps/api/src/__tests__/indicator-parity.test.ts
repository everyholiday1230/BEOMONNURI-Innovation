import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_INDICATORS } from '@quantumtrade/ai';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   지표 목록 일치 — 차트·AI·라이브러리가 같은 것을 말한다.

   ★★ 왜 이 검사가 생겼나

     세 곳이 따로 관리돼 어긋나 있었다:

       차트 화면(src/chart-indicators.jsx)   27종
       AI 허용 목록(AI_INDICATORS)           21종
       KLineCharts 라이브러리                27종

     두 가지 잘못이 실제로 있었다:

       1. 차트에는 있는데 AI 가 못 다루는 지표 8종
          (AO AVP BRAR CR DMA EMV PSY PVT).
          고객이 화면에서 PSY 를 켜놓고 "이거 해석해줘" 라고 해도 AI 는 그 지표를
          다룰 수 없었다.

       2. AI 목록에만 있던 ATR·STOCH 는 **라이브러리에 없다.**
          AI 가 추가를 제안하면 차트가 렌더하지 못한다. 고객에게는 "AI 가 넣었다는데
          안 보인다" 가 된다 — 이 프로젝트에서 removeIndicator 가 정확히 그렇게
          거짓 보고한 적이 있다(제거하지 않고 제거했다고 답했다).

   ★★ 사람이 세 곳을 같이 고치는 방식은 이미 실패했다. 그래서 기계가 막는다.

   ★ 기준은 **벤더 번들 실측**이다. 주석이나 문서가 아니라 실제 라이브러리에서
     등록된 이름을 읽는다. 라이브러리를 올리면 이 검사가 먼저 알려준다.
*/

/** 벤더 번들에서 실제로 등록된 지표 이름을 읽는다. */
function libraryIndicators(): string[] {
  const src = read('vendor/klinecharts/klinecharts.min.js');
  /*
     ★ KLineCharts 는 지표를 `name:"RSI"` 형태로 등록한다. 두 글자 이상 대문자만
       추리면 지표 이름이 남는다 — 다른 문자열(색·모양 등)은 이 형태를 쓰지 않는다.
  */
  return [...new Set(src.match(/name:"([A-Z]{2,6})"/g)?.map((m) => m.slice(6, -1)) ?? [])].sort();
}

/** 차트 화면이 목록에 올리는 지표. */
function screenIndicators(): string[] {
  const src = read('src/chart-indicators.jsx');
  /*
     ★ 키와 여는 중괄호 사이에 **정렬용 공백**이 들어간다(`MA:   { overlay: ...`).
       공백을 한 칸으로 가정해서 27개 중 5개만 잡혔고, 그러면 비교가 통과해도
       의미가 없다 — 측정 도구의 오차가 검사 결과를 무의미하게 만든다.
  */
  return [...new Set(src.match(/^\s{2,}([A-Z0-9]{2,8}):\s*\{\s*overlay:/gm)?.map((m) => m.trim().split(':')[0]!) ?? [])].sort();
}

describe('INDICATOR-PARITY — 지표 목록이 세 곳에서 같다', () => {
  const lib = libraryIndicators();
  const screen = screenIndicators();
  const ai = [...AI_INDICATORS].sort();

  it('[1] 라이브러리에서 27종을 읽어낸다 — 측정 자체가 되는지 먼저 본다', () => {
    /*
       ★★ 이 검사가 0개를 읽으면 아래 비교가 모두 "빈 목록끼리 같다" 로 통과한다.
         측정 도구가 망가진 채 초록불이 켜지는 것이 가장 위험하다.
    */
    expect(lib.length).toBe(27);
    expect(lib).toContain('RSI');
    expect(lib).toContain('MACD');
  });

  it('[2] AI 허용 목록이 라이브러리와 정확히 같다', () => {
    /*
       ★★ AI 가 라이브러리에 없는 지표를 제안하면 차트가 렌더하지 못한다.
         반대로 라이브러리에 있는데 목록에 없으면 고객이 쓰는 지표를 AI 가 못 다룬다.
         어느 쪽도 조용히 실패한다 — 오류가 아니라 "안 보임" 으로 나타난다.
    */
    expect(ai).toEqual(lib);
  });

  it('[3] 차트 화면 목록도 라이브러리와 같다', () => {
    expect(screen.length).toBe(27);
    expect(screen).toEqual(lib);
  });

  it('[4] 라이브러리에 없는 지표가 AI 목록에 없다', () => {
    /*
       ★ 고치기 전 상태를 명시적으로 막는다: ATR·STOCH 는 KLineCharts 에 없다.
         계산 도구(tools.ts)의 'atr' 은 별개다 — 그건 값을 계산해 설명하는 것이고,
         차트에 그리는 것이 아니다.
    */
    for (const absent of ['ATR', 'STOCH']) {
      expect(ai, `${absent} 는 라이브러리에 없는데 AI 목록에 있다`).not.toContain(absent);
    }
  });

  it('[5] 예전에 빠져 있던 8종이 들어왔다', () => {
    for (const added of ['AO', 'AVP', 'BRAR', 'CR', 'DMA', 'EMV', 'PSY', 'PVT']) {
      expect(ai, `${added} 가 AI 목록에 없다 — 차트는 이 지표를 그릴 수 있다`).toContain(added);
    }
  });
});
