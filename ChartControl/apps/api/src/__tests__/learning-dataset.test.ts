import { describe, it, expect } from 'vitest';
import {
  toJsonl, toTrainingLine, describeContext, describeAction, describeOutcome,
} from '../learning/training-format';
import type { LearningSample } from '../db/learning-repo';

/**
 * 거래 학습 데이터 변환 검사.
 *
 * ★★ 이 검사가 지키려는 것은 "없는 사실을 만들지 않는다" 다.
 *
 *   학습 데이터의 잘못은 조용하다. 코드가 죽지 않고, 화면도 정상이고, 몇 달 뒤
 *   모델이 이상한 판단을 할 때 원인을 찾을 수 없다. 그래서 변환 단계에서
 *   "채워 넣기" 를 막는다.
 */

const base: LearningSample = {
  decisionId: 'dec_1',
  subject: 's_abc',
  market: 'futures',
  executionMode: 'live',
  symbol: 'BTCUSDT',
  side: 'long',
  orderType: 'limit',
  price: '60000',
  quantity: '0.01',
  leverage: '10',
  marginMode: 'isolated',
  reduceOnly: false,
  stopPrice: null,
  takeProfitPrice: null,
  uiContext: null,
  marketSnapshot: null,
  accountSnapshot: null,
  riskSnapshot: null,
  submitStatus: 'ACCEPTED',
  submitReason: null,
  decidedAt: '2026-08-15T00:00:00.000Z',
  outcome: null,
};

describe('LEARN-01 판단 근거를 있는 그대로 옮긴다', () => {
  it('[1] ★★ 지표 설정값이 살아 있다 — MA20 과 MA120 은 다른 판단이다', () => {
    const s: LearningSample = {
      ...base,
      uiContext: {
        timeframe: '15m',
        indicators: [
          { id: 'MA', params: { calcParams: [20, 60] } },
          { id: 'RSI', params: { calcParams: [14] } },
        ],
      },
    };
    const ctx = describeContext(s);
    /*
       설정값이 빠지면 20일선인지 120일선인지 알 수 없고, 학습에서 두 경우가
       한 덩어리가 된다.
    */
    expect(ctx).toContain('MA(calcParams=20,60)');
    expect(ctx).toContain('RSI(calcParams=14)');
    expect(ctx).toContain('timeframe: 15m');
  });

  it('[2] ★★ 지표를 모르는 것과 안 켠 것을 구분한다', () => {
    // 화면이 보고하지 않았다 (uiContext 자체가 없다)
    expect(describeContext(base)).toContain('indicators: unknown');
    // 화면이 "하나도 없다" 고 보고했다
    const reported: LearningSample = { ...base, uiContext: { indicators: [] } };
    expect(describeContext(reported)).toContain('indicators: none active');
    /*
       ★ 이 둘을 같게 적으면 모델이 "지표 없이 거래해도 결과가 같다" 를 배운다.
         한쪽은 우리가 모르는 것이고 다른 쪽은 실제로 없었던 것이다.
    */
  });

  it('[3] 손절을 걸지 않은 것도 사실로 남긴다', () => {
    /*
       ★ "손절 없이 들어갔다" 는 학습해야 할 행동이다. 빈칸으로 두면
         모델은 그 위험한 습관을 관찰할 수 없다.
    */
    expect(describeAction(base)).toContain('no stop attached');
    const withStop: LearningSample = { ...base, stopPrice: '58000' };
    expect(describeAction(withStop)).toContain('stop at 58000');
    expect(describeAction(withStop)).not.toContain('no stop attached');
  });

  it('[4] 숫자를 부동소수로 바꾸지 않는다', () => {
    const s: LearningSample = { ...base, quantity: '0.1', price: '0.00000123' };
    const line = toTrainingLine(
      { ...s, outcome: { ...outcomeOf(), realizedPnl: '0.30000000000000004' } },
      'jsonl_prompt',
    );
    /*
       ★ Number 로 통과시키면 0.1 이 0.1 로 보이더라도 합산 과정에서
         0.30000000000000004 같은 값이 학습 파일에 들어간다. 문자열 그대로 옮긴다.
    */
    expect(line).toContain('0.00000123');
    expect(line).toContain('0.30000000000000004');
  });
});

describe('LEARN-02 결과가 없는 표본을 만들어내지 않는다', () => {
  it('[1] ★★ 접수됐지만 결과 미관측이면 학습 줄을 만들지 않는다', () => {
    // 정답이 없는 표본이다. 손익 0 으로 채우면 "대부분 무손익" 을 배운다.
    expect(toTrainingLine(base, 'jsonl_prompt')).toBeNull();
    expect(describeOutcome(base)).toBeNull();
  });

  it('[2] ★ 제외한 개수를 숨기지 않는다', () => {
    const withOutcome: LearningSample = { ...base, outcome: outcomeOf() };
    const r = toJsonl([base, withOutcome, base], 'jsonl_prompt');
    expect(r.included).toBe(1);
    // 운영자가 "왜 표본이 줄었는가" 를 알 수 있어야 한다.
    expect(r.skippedNoOutcome).toBe(2);
  });

  it('[3] ★★ 차단·거부된 주문은 그것 자체가 결과다', () => {
    /*
       "이 상황에서 이런 주문은 한도에 걸린다" 는 학습 대상이다. 통과한 주문만
       남기면 모델은 위험한 주문이 존재했다는 사실 자체를 모른다.
    */
    const blocked: LearningSample = {
      ...base, submitStatus: 'BLOCKED', submitReason: 'RISK_GATE',
    };
    const out = describeOutcome(blocked);
    expect(out).toContain('not placed');
    expect(out).toContain('RISK_GATE');
    expect(toTrainingLine(blocked, 'jsonl_prompt')).not.toBeNull();
  });

  it('[4] ★ 전송 결과를 모르는 경우도 남는다', () => {
    const unknown: LearningSample = { ...base, submitStatus: 'SUBMIT_UNKNOWN' };
    // 가장 위험한 상태다. 데이터에서 빠지면 그 상황을 학습할 수 없다.
    expect(describeOutcome(unknown)).toContain('SUBMIT_UNKNOWN');
  });
});

describe('LEARN-03 손실을 걸러내지 않는다', () => {
  it('[1] ★★ 손실 표본이 그대로 나가고 방향이 말로 적힌다', () => {
    const loss: LearningSample = {
      ...base,
      outcome: { ...outcomeOf(), realizedPnl: '-125.5', roiPct: '-12.3', closeReason: 'stop_loss' },
    };
    const out = describeOutcome(loss)!;
    /*
       ★ 부호만 두면 모델이 놓친다. 'loss' 라고 말로 적는다.
       ★ 그리고 걸러내지 않는다 — 이용자가 명시한 요구다("돈을 버는 것만
         학습하는 게 아니다").
    */
    expect(out).toContain('loss of -125.5');
    expect(out).toContain('closed by stop_loss');
    expect(toJsonl([loss], 'jsonl_prompt').included).toBe(1);
  });

  it('[2] 청산도 남는다', () => {
    const liq: LearningSample = {
      ...base,
      outcome: { ...outcomeOf(), kind: 'liquidated', closeReason: 'liquidation' },
    };
    const out = describeOutcome(liq)!;
    expect(out).toContain('the order liquidated');
    expect(out).toContain('closed by liquidation');
  });

  it('[3] ★ 청산 이유를 모르면 적지 않는다', () => {
    const unknownReason: LearningSample = {
      ...base, outcome: { ...outcomeOf(), closeReason: 'unknown' },
    };
    /*
       추측해서 'stop_loss' 로 적으면 모델이 "손절이 잘 작동한다" 는 없던
       사실을 배운다. 모르면 문장에 넣지 않는다.
    */
    expect(describeOutcome(unknownReason)).not.toContain('closed by');
  });
});

describe('LEARN-04 개인을 특정할 수 있는 값이 나가지 않는다', () => {
  it('[1] ★★ 내보내는 줄에 가명 외의 식별자가 없다', () => {
    const s: LearningSample = { ...base, outcome: outcomeOf() };
    for (const fmt of ['jsonl_prompt', 'jsonl_messages'] as const) {
      const line = toTrainingLine(s, fmt)!;
      /*
         표본에는 애초에 user_id·이메일이 없다(SELECT 목록에서 뺐다).
         변환 단계에서도 가명조차 넣지 않는다 — 학습 입력에 개인 식별자가
         들어갈 이유가 없다.
      */
      expect(line).not.toContain('s_abc');
      expect(line).not.toMatch(/@/);
      expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });

  it('[2] 원본 형식은 가명을 담지만 그것뿐이다', () => {
    const s: LearningSample = { ...base, outcome: outcomeOf() };
    const raw = JSON.parse(toTrainingLine(s, 'jsonl_raw')!) as Record<string, unknown>;
    // 원본은 재가공을 위해 보존한다. 그래도 user_id 는 없다.
    expect(raw.subject).toBe('s_abc');
    expect(raw).not.toHaveProperty('userId');
    expect(raw).not.toHaveProperty('user_id');
  });
});

describe('LEARN-05 JSONL 형식', () => {
  it('[1] 줄바꿈으로 끝난다 (마지막 줄 포함)', () => {
    const s: LearningSample = { ...base, outcome: outcomeOf() };
    const r = toJsonl([s, s], 'jsonl_prompt');
    expect(r.body.endsWith('\n')).toBe(true);
    expect(r.body.trimEnd().split('\n')).toHaveLength(2);
  });

  it('[2] 표본이 없으면 빈 문자열이다 (빈 줄이 아니다)', () => {
    /*
       ★ '\n' 하나를 주면 학습 작업이 "빈 표본 1개" 로 읽고 실패한다.
    */
    expect(toJsonl([], 'jsonl_prompt').body).toBe('');
  });

  it('[3] messages 형식은 system 을 따로 담는다', () => {
    const s: LearningSample = { ...base, outcome: outcomeOf() };
    const j = JSON.parse(toTrainingLine(s, 'jsonl_messages')!) as {
      system: string; messages: Array<{ role: string; content: string }>;
    };
    // Anthropic 계열은 system 을 messages 안에 넣지 않는다.
    expect(typeof j.system).toBe('string');
    expect(j.messages).toHaveLength(2);
    expect(j.messages[0]!.role).toBe('user');
    expect(j.messages[1]!.role).toBe('assistant');
  });
});

/** 결과가 있는 표본을 만든다. */
function outcomeOf(): NonNullable<LearningSample['outcome']> {
  return {
    kind: 'closed',
    entryPrice: '60000',
    exitPrice: '61000',
    filledQuantity: '0.01',
    fees: '0.72',
    realizedPnl: '9.28',
    roiPct: '1.55',
    holdingSeconds: 3600,
    closeReason: 'take_profit',
    observedAt: '2026-08-15T01:00:00.000Z',
  };
}
