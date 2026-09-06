/**
 * 후속 행동 제안 (follow-up suggestions).
 *
 * 답변이 끝나면 "다음에 무엇을 물어볼 수 있는지" 를 2~3개 제시한다. 고객이 매번
 * 무엇을 물어야 할지 스스로 떠올려야 하는 부담을 없애는 것이 목적이다.
 *
 * ★★ 왜 LLM 이 만들지 않는가
 *
 *   모델에게 제안을 만들게 하면 **없는 기능이나 해서는 안 되는 것을 제안한다.**
 *   이 제품은 절대로 주문을 대신 넣지 않는데("주문 넣어줘" 같은 제안이 나오면
 *   그 칩은 눌러도 아무 일이 없는 죽은 버튼이 된다), 모델은 그 경계를 모른다.
 *   또 규제 경계도 모른다 — 개별 종목 매수 권유는 우리가 할 수 없는 말이다.
 *
 *   그래서 규칙으로 만든다. 실제로 실행된 도구, 화면에 올라간 지표, 고객이 그린
 *   선, 보유 포지션 같은 **확인된 사실**만 근거로 쓴다. 부수 효과로 토큰을 전혀
 *   쓰지 않는다.
 *
 * ★★ 무엇을 제안하지 않는가
 *
 *   매수·매도 권유를 하지 않는다. 사업자 유형이 소프트웨어 개발·공급이고 투자자문
 *   등록이 없다. 제안은 **검증·위험 점검·복기·차트 조작** 범위로 제한한다. 즉
 *   "이걸 사라" 가 아니라 "당신의 판단을 이렇게 더 확인해 보라" 쪽이다.
 */

/** 제안 한 건. `key` 는 UI 사전 키이고, 눌렀을 때 보낼 문장은 `promptKey` 로 찾는다. */
export interface AiFollowUp {
  /** 칩에 표시할 문구의 사전 키. */
  key: string;
  /** 눌렀을 때 실제로 전송할 질문의 사전 키. */
  promptKey: string;
  /** 사전 문구에 끼울 값(심볼 등). 문구를 서버에서 만들지 않는 이유는 언어가 4종이기 때문이다. */
  params?: Record<string, string>;
  /**
   * 이 제안이 나온 근거. 임의로 만든 제안이 아니라는 것을 검사할 수 있게 남긴다.
   * 로그와 테스트에서 쓰고 UI 에는 보여주지 않는다.
   */
  because: string;
}

export interface FollowUpContext {
  /** 이번 답변에서 실제로 실행된 읽기 도구 이름. */
  toolsUsed: string[];
  /** 화면에 올라가 있는 지표 이름. */
  indicators: string[];
  /** 고객이 그린(또는 AI 초안) 오버레이 종류. */
  drawingTypes: string[];
  /** 보유 포지션 수. 모르면 null — 0 과 구별한다. */
  positionCount: number | null;
  /** 미체결 주문 수. 모르면 null. */
  openOrderCount: number | null;
  /** 과거에 체결된 주문이 있는지. 모르면 null. */
  hasTradeHistory: boolean | null;
  symbol: string;
  timeframe: string;
  mode: 'copilot' | 'chart-analysis' | 'signal';
}

/** 제안 상한. 너무 많으면 고르는 것 자체가 일이 된다. */
export const MAX_FOLLOW_UPS = 3;

/** 상위 주기를 권할 만한 낮은 주기. */
const LOW_TFS = ['1m', '3m', '5m', '15m'];

/**
 * 제안 후보. 위에서부터 조건을 만족하는 것을 고른다.
 *
 * ★ 순서가 우선순위다. 위험 점검을 분석 심화보다 앞에 둔다 — 고객이 돈을 잃는
 *   경로를 줄이는 쪽이 먼저다.
 */
interface Rule {
  key: string;
  promptKey: string;
  because: string;
  /** 이 제안을 낼 수 있는가. 확인된 사실만 본다. */
  when: (c: FollowUpContext) => boolean;
  /** 심볼을 문구에 끼울지. */
  withSymbol?: boolean;
}

const RULES: Rule[] = [
  /* ---------- 위험 점검 먼저 ---------- */
  {
    key: 'ai_fu_risk_open_position',
    promptKey: 'ai_fu_risk_open_position_q',
    because: 'positionCount>0',
    /*
       ★ 포지션을 들고 있으면 그것부터 본다. 새 분석보다 지금 열린 위험이 급하다.
         청산 감시는 켜져 있지만, 고객이 스스로 확인할 창구도 필요하다.
    */
    when: (c) => (c.positionCount ?? 0) > 0,
  },
  {
    key: 'ai_fu_invalidation',
    promptKey: 'ai_fu_invalidation_q',
    because: 'entry/stop drawn without invalidation',
    /*
       ★ 진입·손절을 그렸는데 무효화 레벨이 없으면 "언제 틀린 것으로 인정할지" 가
         정해지지 않은 상태다. 그것을 정하지 않은 계획이 손실을 키운다.
    */
    when: (c) =>
      (c.drawingTypes.includes('entryZone') || c.drawingTypes.includes('stopLoss'))
      && !c.drawingTypes.includes('invalidationLevel'),
  },
  {
    key: 'ai_fu_no_stop',
    promptKey: 'ai_fu_no_stop_q',
    because: 'entry drawn without stopLoss',
    when: (c) => c.drawingTypes.includes('entryZone') && !c.drawingTypes.includes('stopLoss'),
  },
  {
    key: 'ai_fu_open_orders',
    promptKey: 'ai_fu_open_orders_q',
    because: 'openOrderCount>0',
    when: (c) => (c.openOrderCount ?? 0) > 0,
  },

  /* ---------- 반대 논거 — 확증 편향 대응 ---------- */
  {
    key: 'ai_fu_counter_case',
    promptKey: 'ai_fu_counter_case_q',
    because: 'analysis performed — ask for the opposite case',
    /*
       ★★ 이 제안이 이 목록에서 가장 중요하다.

         언어 모델은 이용자가 원하는 답으로 기운다(아첨). 그리고 한 번 낸 판단을
         반대 증거 앞에서도 유지하는 경향이 보고돼 있다(확증 편향). 그 두 성향이
         합쳐지면 "롱 가고 싶은데 어때?" 에 동의하는 답이 나오고, 그것이 고객
         돈을 잃게 한다.

       ★ 그래서 반대 논거를 **묻기 쉽게** 만든다. 고객이 스스로 떠올리기를
         기대하지 않는다.
    */
    /*
       ★★ 조건을 좁게 잡으면 이 제안이 거의 안 나온다.

         처음에는 "도구를 호출한 경우" 로 제한했다. 그런데 모델이 도구를 쓰지 않고
         답하는 경우가 흔해서, 정작 가장 중요한 제안이 대부분 사라졌다(실측: 두 번의
         대화에서 한 번도 나오지 않았다).

       ★ 차트 문맥(지표·그린 선)이 있으면 반박할 대상이 있다는 뜻이다. 그때도 낸다.
    */
    when: (c) => c.toolsUsed.length > 0
      || c.mode === 'chart-analysis'
      || c.indicators.length > 0
      || c.drawingTypes.length > 0,
  },

  /* ---------- 복기 ---------- */
  {
    key: 'ai_fu_review_trades',
    promptKey: 'ai_fu_review_trades_q',
    because: 'hasTradeHistory',
    when: (c) => c.hasTradeHistory === true,
  },

  /* ---------- 분석 심화 ---------- */
  {
    key: 'ai_fu_higher_tf',
    promptKey: 'ai_fu_higher_tf_q',
    because: 'candles read on a low timeframe',
    /*
       ★ 낮은 주기만 보면 큰 흐름을 놓친다. 상위 주기를 함께 보라는 제안은
         특정 매매를 권하는 것이 아니라 확인 절차를 늘리는 것이다.
    */
    when: (c) => c.toolsUsed.includes('get_candles') && LOW_TFS.includes(c.timeframe),
    withSymbol: false,
  },
  {
    key: 'ai_fu_add_indicator',
    promptKey: 'ai_fu_add_indicator_q',
    because: 'no indicator on screen',
    when: (c) => c.indicators.length === 0,
  },
  {
    key: 'ai_fu_funding',
    promptKey: 'ai_fu_funding_q',
    because: 'funding not read yet',
    when: (c) => c.toolsUsed.length > 0 && !c.toolsUsed.includes('get_funding_rate'),
  },
  {
    key: 'ai_fu_order_book',
    promptKey: 'ai_fu_order_book_q',
    because: 'order book not read yet',
    when: (c) => c.toolsUsed.length > 0 && !c.toolsUsed.includes('get_order_book_summary'),
  },

  /* ---------- 최후 보루 ---------- */
  {
    key: 'ai_fu_explain_levels',
    promptKey: 'ai_fu_explain_levels_q',
    because: 'fallback — always answerable',
    /*
       ★★ 조건 없이 참인 규칙을 하나 둔다.

         제안이 0개면 이 기능은 있으나 없으나 마찬가지다. 그리고 "제안이 비지
         않는다" 는 성질을 테스트로 고정할 수 있어야 한다.
    */
    when: () => true,
    withSymbol: true,
  },
];

/**
 * 대화 흐름에 맞는 후속 제안을 고른다.
 *
 * ★ 같은 제안이 매번 같은 순서로 나오면 지겹다. 그러나 무작위로 섞으면 재현이
 *   안 되고 테스트할 수 없다. 그래서 순서는 고정하고, 조건이 상황에 따라 달라지는
 *   것으로 변화를 만든다.
 */
export function suggestFollowUps(ctx: FollowUpContext): AiFollowUp[] {
  const out: AiFollowUp[] = [];
  for (const r of RULES) {
    if (out.length >= MAX_FOLLOW_UPS) break;
    let ok = false;
    try {
      ok = r.when(ctx);
    } catch {
      /*
         ★ 규칙 하나가 터져도 제안 전체를 잃지 않는다. 이건 보조 기능이고,
           답변을 막을 이유가 되어서는 안 된다.
      */
      ok = false;
    }
    if (!ok) continue;
    out.push({
      key: r.key,
      promptKey: r.promptKey,
      because: r.because,
      ...(r.withSymbol ? { params: { symbol: ctx.symbol } } : {}),
    });
  }
  return out;
}

/**
 * 제안 문구에 매수·매도 권유가 섞이지 않았는지 확인할 때 쓰는 금지 표현.
 *
 * ★★ 사전 문구는 사람이 쓴다. 그래서 시간이 지나면 누군가 "지금 사세요" 같은
 *   문구를 넣을 수 있다. 그 순간 이 제품은 투자권유를 하는 것이 된다 — 등록
 *   없이는 할 수 없는 일이다. 테스트가 사전 파일을 직접 훑어 막는다.
 */
export const SOLICITATION_PATTERNS = [
  /\bbuy now\b/i,
  /\bsell now\b/i,
  /\bshould I buy\b/i,
  /\bshould I sell\b/i,
  /\bguaranteed\b/i,
  /\bprofit is\b/i,
  /지금\s*사/,
  /지금\s*팔/,
  /매수하세요/,
  /매도하세요/,
  /수익\s*보장/,
];
