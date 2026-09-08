/**
 * 안전 검사에 걸린 AI 답변이 **화면에 남지 않는지** 고정한다.
 *
 * ★★ 무엇이 문제였나
 *
 *   서버는 답변을 스트리밍한 뒤 `screenModelOutput` 으로 검사하고, 걸리면
 *   `unsafe-output` 이벤트를 보낸다. 그런데 클라이언트는 그때까지 쌓인 텍스트(`acc`)를
 *   비우지 않았고, 스트림이 끝나면 `onDone` 이 그것을 **그대로 대화에 추가**했다.
 *
 *   즉 "수익 보장" 같은 문구나 시세가 낡은 상태의 매매 견해가, **서버가 거부했는데도**
 *   고객 화면에 보였다. 경고 문구는 함께 떴지만 본문이 남아 있으면 고객은 본문을 읽는다.
 *
 * ★ 서버가 스트리밍 전에 막지 못하는 이유: 검사는 답변 **전체**를 봐야 한다. 문장
 *   중간까지로는 수익 보장 문구를 판정할 수 없다. 그래서 클라이언트가 회수해야 한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('거부된 AI 답변 회수', () => {
  it('unsafe-output 이면 누적 텍스트를 비운다', () => {
    const src = read('../../../../src/ai-copilot.jsx');
    const at = src.indexOf("if (ev.type === 'error')");
    expect(at, "error 처리부를 찾지 못했다").toBeGreaterThan(-1);
    const seg = src.slice(at, at + 1800);
    /* 코드를 알아야 회수할 수 있다. */
    expect(seg).toContain("'unsafe-output'");
    /*
       ★ acc = '' 이 없으면 onDone 이 거부된 본문을 그대로 추가한다.
         이 한 줄이 이 결함의 핵심이다.
    */
    expect(seg, '누적 텍스트를 비우지 않는다 — onDone 이 거부된 답변을 표시한다')
      .toMatch(/acc\s*=\s*''/);
  });

  it('거부 사유를 고객에게 설명한다 (3개 언어 모두)', () => {
    /*
       ★ 키가 없으면 화면에 `ai_unsafe_output` 이라는 키 문자열이 그대로 보인다.
         고객에게는 오류로 읽힌다.
    */
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = read(`../../../../src/locales/${loc}.js`);
      expect(dict, `${loc} 사전에 ai_unsafe_output 이 없다`).toContain('ai_unsafe_output');
    }
  });

  it('일반 오류와 포인트 부족은 여전히 구분한다', () => {
    const src = read('../../../../src/ai-copilot.jsx');
    const at = src.indexOf("if (ev.type === 'error')");
    const seg = src.slice(at, at + 1800);
    expect(seg).toContain('INSUFFICIENT_POINTS');
    expect(seg).toContain('ai_stream_error');
  });
});

describe('서버 안전 검사 — 무엇을 잡는가', () => {
  it('네 가지 위반을 모두 판정한다', async () => {
    const { SafetyPolicy } = await import('@quantumtrade/ai');
    const s = new SafetyPolicy();
    const ok = { hasMarketToolResult: true, marketDataStale: false };

    /* 수익 보장 — 가장 위험한 문구다. */
    expect(s.screenModelOutput('This will guarantee a profit.', ok).allowed).toBe(false);
    /* 자동매매 주장 — 우리는 주문을 자동으로 넣지 않는다. */
    expect(s.screenModelOutput('I will place the order for you automatically.', ok).allowed).toBe(false);
    /*
       출처 없는 현재 가격 주장.

       ★ 예전 패턴은 "현재" 표현이 가격 **앞에** 올 때만 잡았다. 그래서
         "BTC is at 68,000 right now" 처럼 순서가 반대면 통과했다 — 모델이 기억으로
         말한 틀린 가격이 사실처럼 보인다. 이제 문장 단위로 순서 무관하게 본다.
    */
    const noTool = { hasMarketToolResult: false, marketDataStale: false };
    for (const t of [
      'BTC is at 68,000 right now.',
      'ETH is trading at 3,500 as of now.',
      'The current price is 68,000.',
      'Bitcoin now sits at $67,900.',
      'At present BTC trades at 68,100.',
    ]) expect(s.screenModelOutput(t, noTool).allowed, t).toBe(false);

    /* ★ 시세 도구를 썼으면 같은 문장이 허용된다 — 근거가 있다. */
    expect(s.screenModelOutput('BTC is at 68,000 right now.', ok).allowed).toBe(true);
    /* 시세가 낡은데 매매 견해 */
    expect(s.screenModelOutput('Entry at support, stop below.',
      { hasMarketToolResult: true, marketDataStale: true }).allowed).toBe(false);

    /*
       ★★ 평범한 분석은 통과해야 한다. 지나치게 막으면 답변이 계속 회수되고
         고객에게는 기능이 고장난 것으로 보인다 — 오탐이 미탐보다 눈에 잘 띈다.
    */
    for (const t of [
      'The 20-period average is trending down.',
      'Support is at 67,500 and resistance near 69,000.',
      'If price breaks 68,000 the setup invalidates.',
      'RSI is above 70, which is often read as overbought.',
      'Your stop is at 66,000 based on the chart you shared.',
      'Momentum is weakening now.',
    ]) expect(s.screenModelOutput(t, noTool).allowed, `오탐: ${t}`).toBe(true);
  });
});
