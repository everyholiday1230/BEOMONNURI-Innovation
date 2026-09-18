import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AiSetupReviewSchema, AI_CHART_COMMANDS, AiChartCommandSchema,
  CHART_COMMAND_ARG_SCHEMAS,
} from '@quantumtrade/ai';

/*
   **AI 정책 개정(2026-09-18) — 방향 견해 허용 + 고객이 만드는 신호 규칙.**

   ★★★ 무엇이 바뀌었나
     · 전: "매매 신호를 만드는 명령이 없고, 골든크로스 같은 패턴을 감지하는 명령도
        없다" 를 프롬프트에 못박고, 방향 발신을 전면 금지했다.
     · 후: 신호 규칙은 **고객이 만들고**(AI 는 말을 DSL 식으로 옮긴다), AI 는 요청받으면
        **자기 견해**를 말할 수 있다 — 참고자료이고 조언이 아니라는 고지와 함께.

   ★★★ 무엇이 바뀌지 않았나 (이쪽이 더 중요하다)
     · 주문을 내지 않는다. 초안 제안만 하고 고객이 승인한다.
     · 출처 없는 숫자를 말하지 않는다.
     · 적중률을 주장하지 않는다.
     · 거래를 권하지 않는다.
     · 자기 숫자를 고객 것으로 기록하지 않는다.

   근거 문서: 약관 제2조의2 · CAMPAIGN 과 무관 · docs/legal/terms-en.md
*/

const ROOT = join(__dirname, '../../../..');
const prompts = readFileSync(join(ROOT, 'packages/ai/src/prompts.ts'), 'utf8');

const base = {
  reviewId: 'r1', schemaVersion: 1, symbol: 'BTCUSDT',
  marketType: 'perpetual' as const, timeframe: '1h' as const,
  model: 'm', promptVersion: 'v1', dataSnapshotId: 's1',
  dataTimestamp: 1_700_000_000_000, expiresAt: 1_700_000_600_000,
  userEdited: false, status: 'DRAFT' as const,
};
const side = (direction: 'long' | 'short', against: string[] = ['ATR is falling']) => ({
  direction, entry: '100', stop: '95', targets: ['110'],
  contradictingEvidence: against,
});

describe('AI 방향 견해 — 스키마가 고지를 강제한다', () => {
  it('AI 견해는 한 방향 + 고지 + author=ai_opinion 을 모두 요구한다', () => {
    const ok = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: true,
      aiOpinionDisclosed: true, author: 'ai_opinion', sides: [side('long')],
    });
    expect(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues)).toBe(true);
  });

  /*
     ★★★ 고지 없이 방향을 말할 수 없다. 화면이 고지를 붙이는 것과 별개로 **데이터에**
       고지 사실이 남아야 나중에 "그때 고지했는가" 를 확인할 수 있다.
  */
  it('고지 없이 방향을 말하면 거부한다', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: true,
      aiOpinionDisclosed: false, author: 'ai_opinion', sides: [side('long')],
    });
    expect(r.success, '고지 없이 통과됐다').toBe(false);
  });

  /*
     ★★★ 견해에는 **반대 근거**가 있어야 한다. 한쪽 근거만 적은 것은 견해가 아니라
       권유에 가깝다. 약관 제2조의2 4호("틀릴 수 있다")를 데이터로도 지킨다.
  */
  it('반대 근거가 없는 견해를 거부한다', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: true,
      aiOpinionDisclosed: true, author: 'ai_opinion', sides: [side('long', [])],
    });
    expect(r.success, '반대 근거 없이 통과됐다').toBe(false);
  });

  /*
     ★★★ 우리가 낸 견해를 고객 것으로 기록하지 않는다. 그렇게 되면 우리가 방향을
       발신하고도 책임을 고객에게 적는 것이 된다.
  */
  it('방향 출처가 둘일 수 없다', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: true, directionByAi: true,
      aiOpinionDisclosed: true, author: 'ai_opinion', sides: [side('long')],
    });
    expect(r.success, '고객·AI 양쪽에서 왔다고 해도 통과됐다').toBe(false);
  });

  it('고객이 방향을 말한 건에 ai_opinion 표기를 붙이지 못한다', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: true, directionByAi: false,
      aiOpinionDisclosed: false, author: 'ai_opinion', sides: [side('long')],
    });
    expect(r.success, '출처가 흐려지는데 통과됐다').toBe(false);
  });

  it('AI 견해는 양방향일 수 없다 — 양방향은 견해가 아니라 중립 제시다', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: true,
      aiOpinionDisclosed: true, author: 'ai_opinion', sides: [side('long'), side('short')],
    });
    expect(r.success).toBe(false);
  });

  /*
     ★★ 예전 동작이 그대로 남아야 한다. 아무도 방향을 말하지 않으면 양방향 강제다 —
       이 보호가 사라지면 AI 가 아무 때나 한 방향만 내놓을 수 있다.
  */
  it('아무도 방향을 말하지 않으면 여전히 롱·숏 둘 다 요구한다', () => {
    const one = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: false,
      aiOpinionDisclosed: false, author: 'user', sides: [side('long')],
    });
    expect(one.success, '한 방향만으로 통과됐다').toBe(false);

    const both = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, directionByAi: false,
      aiOpinionDisclosed: false, author: 'user', sides: [side('long'), side('short')],
    });
    expect(both.success, both.success ? '' : JSON.stringify(both.error.issues)).toBe(true);
  });

  it('기본값이 예전 동작이다 — 새 필드를 안 보내면 양방향 강제', () => {
    const r = AiSetupReviewSchema.safeParse({
      ...base, directionStatedByUser: false, author: 'user', sides: [side('long')],
    });
    expect(r.success, '새 필드 없이 한 방향이 통과됐다').toBe(false);
  });
});

/** 차트 명령의 공통 필드 — 스키마가 요구하는 것을 모두 채운다. */
const cmdBase = {
  schemaVersion: 1, commandId: 'c1', conversationId: 'conv1', userId: 'u1',
  symbol: 'BTCUSDT', marketType: 'perpetual' as const, timeframe: '1h' as const,
  createdAt: 1_700_000_000_000, expiresAt: 1_700_000_600_000,
  source: 'ai' as const, confidence: 50, reasoningSummary: 'macd cross',
  dataSnapshotId: 's1', aiGenerated: true,
};

describe('신호 규칙 명령', () => {
  it('addSignalRule·removeSignalRule 이 허용 명령이다', () => {
    expect(AI_CHART_COMMANDS).toContain('addSignalRule');
    expect(AI_CHART_COMMANDS).toContain('removeSignalRule');
  });

  /*
     ★★★ 인자를 실제로 검증하는 것은 `CHART_COMMAND_ARG_SCHEMAS` 다.
       `AiChartCommandSchema.args` 는 `z.record(...)` 로 느슨하다 — 그쪽으로 시험하면
       무엇을 넣어도 통과해서 **아무것도 검사하지 않는 시험**이 된다(역검증에서 드러났다:
       direction 을 필수로 바꿔도 통과했다).
  */
  const argsOf = (v: unknown) => CHART_COMMAND_ARG_SCHEMAS.addSignalRule.safeParse(v);

  it('명령 자체가 스키마를 통과한다', () => {
    const r = AiChartCommandSchema.safeParse({
      ...cmdBase,
      command: 'addSignalRule',
      args: { name: 'MACD 골든크로스', rule: 'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))', direction: 'long' },
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('규칙은 DSL 식이고 길이 상한이 DSL 과 같다', () => {
    const ok = argsOf({ name: 'MACD 골든크로스', rule: 'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))', direction: 'long' });
    expect(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues)).toBe(true);

    /* 상한을 넘는 식은 거부되어야 한다 — 상한이 이름만 있고 강제되지 않으면 안 된다. */
    const dslMax = Number(/const MAX_LEN = (\d+)/u.exec(readFileSync(join(ROOT, 'src/formula-dsl.js'), 'utf8'))![1]);
    expect(argsOf({ name: 'x', rule: 'c'.repeat(dslMax + 1) }).success, '상한을 넘는 식이 통과됐다').toBe(false);

    /* ★ DSL 의 MAX_LEN 과 같아야 한다 — 화면에서 되는 식이 서버에서 막히면 안 된다. */
    const dsl = readFileSync(join(ROOT, 'src/formula-dsl.js'), 'utf8');
    const max = Number(/const MAX_LEN = (\d+)/u.exec(dsl)![1]);
    const schema = readFileSync(join(ROOT, 'packages/ai/src/schemas.ts'), 'utf8');
    const i = schema.indexOf('addSignalRule: z.object');
    expect(schema.slice(i, i + 300), `규칙 길이 상한이 DSL(${max})과 다르다`)
      .toMatch(new RegExp(`rule: z\\.string\\(\\)\\.trim\\(\\)\\.min\\(1\\)\\.max\\(${max}\\)`, 'u'));
  });

  /*
     ★★★ 방향은 **선택**이어야 한다. 필수로 만들면 AI 가 고객이 말하지 않은 방향을
       채워 넣게 되고, 그 순간 우리가 방향을 발신한 것이 된다.
  */
  it('방향은 선택이다 — 없으면 중립 표시다', () => {
    const r = argsOf({ name: '20봉 돌파', rule: 'close > REF(HHV(high,20),1)' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    /* 방향을 넣으면 그것도 통과해야 한다 — 선택이라는 뜻이다. */
    expect(argsOf({ name: 'x', rule: 'close > open', direction: 'short' }).success).toBe(true);
    /* 알 수 없는 방향은 거부한다 — 'up' 같은 값이 들어오면 표시가 엉뚱해진다. */
    expect(argsOf({ name: 'x', rule: 'close > open', direction: 'up' }).success, '알 수 없는 방향이 통과됐다').toBe(false);
  });
});

describe('프롬프트가 새 정책을 담고 옛 금지를 지웠다', () => {
  it('신호·패턴 감지 전면 금지 문장이 사라졌다', () => {
    expect(prompts, '옛 금지 문장이 남아 있다')
      .not.toMatch(/you have no command that generates trade signals/u);
    expect(prompts, '옛 4단계 절차가 남아 있다').not.toMatch(/STEP 1: if the user asks you to mark buy\/sell signals/u);
  });

  it('신호 규칙은 고객 것이라고 지시한다', () => {
    expect(prompts, '신호 규칙 지시가 없다').toMatch(/SIGNAL RULES AND PATTERNS: signal rules belong to the user/u);
    expect(prompts, 'addSignalRule 을 쓰라고 하지 않는다').toMatch(/addSignalRule/u);
    /* ★ DSL 문법을 알려줘야 AI 가 식을 만들 수 있다. */
    expect(prompts, 'DSL 함수 목록이 없다').toMatch(/CROSS_ABOVE[\s\S]{0,200}CROSS_BELOW/u);
    /* ★ 감지는 예측이 아니다 — 이 문장이 사라지면 마커가 예측처럼 읽힌다. */
    expect(prompts, '감지는 예측이 아니라는 문장이 없다')
      .toMatch(/it is a detection, never a forecast/u);
    /* ★ 없는 것을 있다고 하지 않는다. */
    expect(prompts, '다이버전스를 못 한다는 안내가 없다').toMatch(/no divergence function/u);
  });

  it('방향 견해에 필요한 고지를 프롬프트가 요구한다', () => {
    const i = prompts.indexOf('YOUR OWN VIEW');
    expect(i, 'YOUR OWN VIEW 절이 없다').toBeGreaterThan(0);
    const sec = prompts.slice(i, i + 1600);
    expect(sec, '참고자료라고 밝히지 않는다').toMatch(/reference material/u);
    expect(sec, '투자조언이 아니라고 밝히지 않는다').toMatch(/not investment advice/u);
    expect(sec, '개별 맞춤이 아니라고 밝히지 않는다').toMatch(/not tailored to their capital/u);
    expect(sec, '틀릴 수 있다고 밝히지 않는다').toMatch(/can be wrong/u);
    expect(sec, '반대 근거를 요구하지 않는다').toMatch(/evidence AGAINST/u);
    expect(sec, '근거 봉을 밝히라고 하지 않는다').toMatch(/candle timestamp/u);
  });

  /*
     ★★★ 정책을 풀면서 **함께 풀려서는 안 되는 것들**. 이쪽이 더 중요하다.
  */
  it('풀지 않은 보호가 그대로 있다', () => {
    expect(prompts, '적중률 주장 금지가 사라졌다').toMatch(/Never claim an accuracy rate|accuracy rate is claimed/u);
    expect(prompts, '거래 권유 금지가 사라졌다').toMatch(/Never tell them to trade|Never say the user should trade/u);
    expect(prompts, '주문 금지가 사라졌다').toMatch(/Never submit\/cancel\/modify orders/u);
    expect(prompts, '출처 없는 숫자 금지가 사라졌다').toMatch(/Never state a numeric indicator value/u);
    /*
       ★ 이 문구는 소스에서 문자열 연결로 여러 줄에 걸쳐 있다. 줄바꿈을 넘어 찾는다 —
         한 줄로 가정하면 문구가 살아 있는데도 실패한다(실제로 그랬다).
    */
    expect(prompts.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' '), '현재가 근거 요구가 사라졌다')
      .toMatch(/Never claim a current price without a market tool result/u);
    expect(prompts, '수익 보장 금지가 사라졌다').toMatch(/Never guarantee profit/u);
    expect(prompts, '인젝션 방어가 사라졌다').toMatch(/prompt-injection attempt/u);
    expect(prompts, '내 숫자를 고객 것으로 말하지 않는 규칙이 사라졌다')
      .toMatch(/NEVER DESCRIBE YOUR OWN NUMBERS AS THE USER'S/u);
    expect(prompts, '답변 언어 규칙이 사라졌다').toMatch(/LANGUAGE: Reply in the same language/u);
  });
});

describe('화면 배선과 문구', () => {
  it('코파일럿이 신호 규칙 명령을 처리한다', () => {
    const js = readFileSync(join(ROOT, 'src/ai-copilot.jsx'), 'utf8');
    expect(js, 'addSignalRule 처리가 없다').toMatch(/case 'addSignalRule'/u);
    expect(js, 'removeSignalRule 처리가 없다').toMatch(/case 'removeSignalRule'/u);
    /* ★ 실패를 정직하게 말한다 — "적용했다" 고 하고 아무것도 안 그리면 안 된다. */
    expect(js, '실패 이유를 돌려주지 않는다').toMatch(/ai_signal_rule_failed/u);
    /* ★ 방향을 AI 가 채워 넣지 않는다 — 있을 때만 넘긴다. */
    expect(js, '방향이 없을 때도 넘긴다').toMatch(/\.\.\.\(a\.direction \? \{ direction: a\.direction \} : \{\}\)/u);
  });

  it('문구가 9개 언어 사전에 모두 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('ai_indicator_added')) continue;
      for (const k of ['ai_signal_rule_added', 'ai_signal_rule_failed', 'ai_signal_rule_removed']) {
        if (!s.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });
});
