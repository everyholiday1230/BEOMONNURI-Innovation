import type { LearningSample } from '../db/learning-repo';

/**
 * 학습 표본 → 학습 파일 형식 변환.
 *
 * 왜 별도 모듈인가
 * --------------
 * 저장 형식(표)과 학습 형식(파일)은 수명이 다르다. 표는 오래 유지되고, 학습
 * 형식은 모델·공급자에 따라 바뀐다. 섞어 두면 학습 형식을 바꿀 때 저장 코드를
 * 건드려야 하고, 그때 이미 쌓인 기록의 의미가 흔들린다.
 *
 * ★★ 초기 공급자는 Bedrock 이다.
 *
 *   Bedrock 미세조정(fine-tuning)은 JSONL 을 받는다. 모델 계열에 따라 형태가
 *   다르다:
 *     · Titan / Llama 계열   {"prompt": "...", "completion": "..."}
 *     · Anthropic(Claude) 계열 {"system": "...", "messages":[{role,content}…]}
 *
 *   그래서 한 가지로 고정하지 않고 두 형태를 모두 만들 수 있게 한다.
 *   ★ 확인하지 않은 것: 실제 Bedrock 작업에 넣어 본 적은 없다(자격증명·모델
 *     선택이 아직 없다). 형식은 문서 기준이며, 넣기 전에 소량으로 검증해야 한다.
 *
 * 불변식
 * -----
 * 1. **없는 값을 만들지 않는다.** 결과가 없는 표본은 결과 문장을 쓰지 않는다.
 *    "손익 0" 으로 채우면 모델이 "대부분 무손익" 이라고 배운다.
 * 2. **가명만 나간다.** user_id·이메일은 애초에 표본에 없다.
 * 3. **손실도 나간다.** 성과로 걸러내지 않는다 — 이용자가 명시한 요구다.
 * 4. **숫자는 문자열 그대로.** 부동소수로 바꾸면 0.1 이 0.09999… 가 되어
 *    학습 파일에 사실과 다른 값이 들어간다.
 */

export type TrainingFormat = 'jsonl_prompt' | 'jsonl_messages' | 'jsonl_raw';

/** 모델에게 주는 역할 설명. 학습 파일마다 같은 문장이어야 한다. */
export const SYSTEM_PROMPT =
  'You are a trading assistant. Given the chart context, active indicators and market '
  + 'state at the moment of a decision, describe the trade the user took and its outcome. '
  + 'Losses are as informative as gains.';

/**
 * 표본을 사람이 읽을 수 있는 상황 설명으로 만든다.
 *
 * ★ 왜 문장으로 만드는가
 *   언어모델은 열 이름을 모른다. `lev=10` 보다 `leverage 10x` 가 학습에 쓰인다.
 *   다만 **숫자를 바꾸지는 않는다** — 표현만 바꾸고 값은 그대로 옮긴다.
 */
export function describeContext(s: LearningSample): string {
  const parts: string[] = [];

  parts.push(`market: ${s.market}`);
  parts.push(`execution: ${s.executionMode}`);
  parts.push(`symbol: ${s.symbol}`);
  if (s.uiContext?.timeframe) parts.push(`timeframe: ${s.uiContext.timeframe}`);

  /*
     지표. 이것이 이 데이터셋의 핵심이다 — "어떤 지표를 켜고 있었는가".

     ★ 화면이 보내지 않았으면 `indicators: unknown` 이라고 적는다.
       비워 두면 "지표를 켜지 않았다" 로 읽힌다. 모르는 것과 없는 것은 다르다.
  */
  if (s.uiContext?.indicators && s.uiContext.indicators.length > 0) {
    const list = s.uiContext.indicators.map((ind) => {
      const ps = ind.params && Object.keys(ind.params).length > 0
        ? `(${Object.entries(ind.params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`
        : '';
      return `${ind.id}${ps}`;
    });
    parts.push(`indicators: ${list.join(', ')}`);
  } else if (s.uiContext?.indicators) {
    parts.push('indicators: none active');
  } else {
    parts.push('indicators: unknown (not reported by the client)');
  }

  if (typeof s.uiContext?.drawings === 'number') parts.push(`drawings: ${s.uiContext.drawings}`);
  if (s.uiContext?.source) parts.push(`entered from: ${s.uiContext.source}`);

  const ms = s.marketSnapshot ?? {};
  const mv = (k: string): string | null => {
    const v = (ms as Record<string, unknown>)[k];
    return v === null || v === undefined ? null : String(v);
  };
  const last = mv('last'); if (last) parts.push(`last price: ${last}`);
  const bid = mv('bid'); const ask = mv('ask');
  if (bid && ask) parts.push(`bid/ask: ${bid}/${ask}`);
  const spread = mv('spreadBps'); if (spread) parts.push(`spread: ${spread} bps`);
  const chg = mv('changePct'); if (chg) parts.push(`24h change: ${chg}%`);
  const funding = mv('fundingRate'); if (funding) parts.push(`funding rate: ${funding}`);
  const mark = mv('markPrice'); if (mark) parts.push(`mark price: ${mark}`);

  const acc = s.accountSnapshot ?? {};
  const av = (k: string): string | null => {
    const v = (acc as Record<string, unknown>)[k];
    return v === null || v === undefined ? null : String(v);
  };
  const eq = av('equity'); if (eq) parts.push(`account equity: ${eq}`);
  const open = av('openPositions'); if (open) parts.push(`open positions: ${open}`);

  return parts.join('\n');
}

/** 표본을 "무엇을 했는가" 문장으로 만든다. */
export function describeAction(s: LearningSample): string {
  const parts: string[] = [];
  parts.push(`${s.side} ${s.quantity} ${s.symbol} as ${s.orderType}`);
  if (s.price) parts.push(`at ${s.price}`);
  if (s.leverage) parts.push(`leverage ${s.leverage}x`);
  if (s.marginMode) parts.push(`${s.marginMode} margin`);
  if (s.reduceOnly) parts.push('reduce-only');
  if (s.stopPrice) parts.push(`stop at ${s.stopPrice}`);
  if (s.takeProfitPrice) parts.push(`take profit at ${s.takeProfitPrice}`);
  /*
     ★ 보호 주문이 없으면 그것도 사실로 적는다.
       "손절 없이 들어갔다" 는 학습해야 할 행동이다.
  */
  if (!s.stopPrice) parts.push('no stop attached');
  return parts.join(', ');
}

/** 표본을 "그래서 어떻게 됐는가" 문장으로 만든다. 결과가 없으면 null. */
export function describeOutcome(s: LearningSample): string | null {
  /*
     ★★ 전송 자체가 거부·차단된 표본도 결과다.

       "이 상황에서 이런 주문은 위험 한도에 걸린다" 는 학습 대상이다.
       그래서 결과가 없다고 버리지 않고, 전송 단계 결과를 적는다.
  */
  if (s.submitStatus !== 'ACCEPTED') {
    return `the order was not placed (${s.submitStatus})`
      + (s.submitReason ? `: ${s.submitReason}` : '');
  }

  const o = s.outcome;
  // 접수됐지만 아직 결과가 관측되지 않았다. 없는 결과를 만들지 않는다.
  if (!o) return null;

  const parts: string[] = [`the order ${o.kind}`];
  if (o.entryPrice) parts.push(`entry ${o.entryPrice}`);
  if (o.exitPrice) parts.push(`exit ${o.exitPrice}`);
  if (o.filledQuantity) parts.push(`filled ${o.filledQuantity}`);
  if (o.fees) parts.push(`fees ${o.fees}`);
  if (o.realizedPnl !== null) {
    const n = Number(o.realizedPnl);
    // 손익의 방향을 말로 밝힌다 — 부호만 두면 모델이 놓친다.
    const dir = Number.isFinite(n) ? (n > 0 ? 'profit' : n < 0 ? 'loss' : 'break-even') : 'result';
    parts.push(`${dir} of ${o.realizedPnl}`);
  }
  if (o.roiPct !== null) parts.push(`ROI ${o.roiPct}%`);
  if (o.holdingSeconds !== null) parts.push(`held ${o.holdingSeconds}s`);
  if (o.closeReason && o.closeReason !== 'unknown') parts.push(`closed by ${o.closeReason}`);
  return parts.join(', ');
}

/**
 * 표본 하나를 학습 한 줄로 만든다.
 *
 * ★ 결과가 없는 표본은 `null` 이다 — 학습 파일에 넣지 않는다.
 *   "무엇을 했다" 만 있고 "어떻게 됐다" 가 없으면 지도학습의 정답이 없다.
 *   버리는 것이 아니라 **표에 그대로 남아 있고**, 결과가 관측되면 다음
 *   내보내기에 포함된다.
 */
export function toTrainingLine(s: LearningSample, format: TrainingFormat): string | null {
  if (format === 'jsonl_raw') {
    // 가공 없이 그대로. 나중에 다른 형태로 다시 만들 수 있게 원본을 보존한다.
    return JSON.stringify(s);
  }

  const outcome = describeOutcome(s);
  if (!outcome) return null;

  const context = describeContext(s);
  const action = describeAction(s);
  const completion = `Action: ${action}\nOutcome: ${outcome}`;

  if (format === 'jsonl_messages') {
    // Anthropic(Claude) 계열 미세조정 형태.
    return JSON.stringify({
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: context },
        { role: 'assistant', content: completion },
      ],
    });
  }

  // Titan / Llama 계열 미세조정 형태.
  return JSON.stringify({
    prompt: `${SYSTEM_PROMPT}\n\n${context}`,
    completion,
  });
}

/**
 * 표본 묶음을 JSONL 로 만든다.
 *
 * @returns 파일 내용과, 결과가 없어 제외된 표본 수. 제외 수를 숨기지 않는다 —
 *   운영자가 "왜 표본이 줄었는가" 를 알아야 한다.
 */
export function toJsonl(
  samples: LearningSample[],
  format: TrainingFormat,
): { body: string; included: number; skippedNoOutcome: number } {
  const lines: string[] = [];
  let skipped = 0;
  for (const s of samples) {
    const line = toTrainingLine(s, format);
    if (line === null) { skipped += 1; continue; }
    lines.push(line);
  }
  return {
    // JSONL 은 줄바꿈으로 끝난다(마지막 줄 포함).
    body: lines.length > 0 ? `${lines.join('\n')}\n` : '',
    included: lines.length,
    skippedNoOutcome: skipped,
  };
}
