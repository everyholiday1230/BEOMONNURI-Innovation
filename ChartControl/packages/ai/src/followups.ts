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
 *
 * ★★ **서비스하는 9개 언어를 모두 담는다.**
 *
 *   한동안 이 목록은 영어·한국어 패턴뿐이었다. 그런데 화면은 영어·일본어·중국어에
 *   이어 신흥시장 6개(베트남·힌디·포르투갈·스페인·터키·필리핀)까지 늘어났다.
 *   패턴이 없는 언어는 **검사를 통과한 것이 아니라 검사를 받지 않은 것**이다.
 *   한국어 패턴이 남아 있는 이유: 한국어는 서비스 언어가 아니지만 이 저장소를
 *   쓰는 사람들의 모국어라서 초안이 한국어로 섞여 들어올 수 있다.
 *
 * ★ **부정문을 잡지 않도록 낱말 하나가 아니라 연어(collocation)로 적는다.**
 *
 *   영어의 `\bguaranteed\b` 하나만 보면 이 저장소가 반드시 유지해야 하는 정직한
 *   문장인 "No profit is guaranteed" 까지 걸린다. 다른 언어에서 같은 실수를
 *   반복하지 않기 위해 "이익+보장" 이 붙은 형태만 적는다. 예를 들어 포르투갈어는
 *   `lucro garantido`(보장된 이익)를 잡고 `lucro não é garantido`(이익은 보장되지
 *   않는다)는 잡지 않는다.
 *
 *   영어 두 패턴(`guaranteed`·`profit is`)은 그대로 둔다 — 검사 범위가 `ai_fu_*`
 *   제안 문구로 한정돼 있어서 면책 문장과 만나지 않고, 좁히면 오히려 놓친다.
 */
export const SOLICITATION_PATTERNS = [
  /* 영어 */
  /\bbuy now\b/i,
  /\bsell now\b/i,
  /\bshould I buy\b/i,
  /\bshould I sell\b/i,
  /\bguaranteed\b/i,
  /\bprofit is\b/i,

  /* 한국어 — 서비스 언어는 아니지만 초안이 섞여 들어올 수 있다 */
  /지금\s*사/,
  /지금\s*팔/,
  /매수하세요/,
  /매도하세요/,
  /수익\s*보장/,

  /* 일본어 */
  /今すぐ買/,
  /今すぐ売/,
  /買うべき/,
  /売るべき/,
  /利益[を]?保証/,
  /元本保証/,
  /必ず(儲|もうか)/,

  /* 중국어(간체) */
  /(立即|马上|现在)\s*买/,
  /(立即|马上|现在)\s*卖/,
  /该不该买/,
  /(保证|确保)\s*(收益|盈利|利润)/,
  /(收益|盈利|利润)\s*保证/,
  /稳赚/,
  /包赚/,

  /* 베트남어 */
  /\bmua ngay\b/i,
  /\bbán ngay\b/i,
  /\bnên mua\b/i,
  /\bnên bán\b/i,
  /lợi nhuận\s+(được\s+)?(đảm bảo|bảo đảm)/i,
  /(đảm bảo|bảo đảm|cam kết)\s+(có\s+)?lợi nhuận/i,

  /* 힌디어 */
  /अभी\s*खरीद/,
  /अभी\s*बेच/,
  /(मुनाफ़ा|मुनाफा|लाभ)\s*(की\s*)?गारंटी/,
  /गारंटीशुदा\s*(मुनाफ़ा|मुनाफा|लाभ)/,
  /निश्चित\s*(मुनाफ़ा|मुनाफा|लाभ)/,

  /* 포르투갈어(브라질) */
  /\bcompre?\s+agora\b/i,
  /\bvend[ae]\s+agora\b/i,
  /\bdeve(ria)?\s+comprar\b/i,
  /\bdeve(ria)?\s+vender\b/i,
  /(lucro|ganho|retorno)s?\s+garantid/i,
  /garantia\s+de\s+(lucro|ganho|retorno)/i,

  /* 스페인어(중남미) */
  /\bcompr[aeá]\s+ahora\b/i,
  /\bvend[eaé]\s+ahora\b/i,
  /\bdeber[íi]a\s+comprar\b/i,
  /\bdeber[íi]a\s+vender\b/i,
  /(ganancia|beneficio|rentabilidad|retorno)s?\s+garantizad/i,
  /garant[íi]a\s+de\s+(ganancia|beneficio|rentabilidad)/i,

  /*
     터키어.

     ★★ 두 가지 함정이 있어서 다른 언어와 다르게 적는다.

       ① `\b` 를 `ş` 앞에 쓸 수 없다. JS 의 `\b` 는 `\w`=`[A-Za-z0-9_]` 기준이라
          `ş` 는 낱말 문자가 아니고, 그래서 `/\bşimdi/` 는 "Şimdi" 를 **못 잡는다.**
       ② 터키어 대문자 `İ`(점 있는 I)는 `/i` 플래그로도 `i` 와 같아지지 않는다
          (`/i/i.test('İ')` === false). 그래서 전부 대문자로 쓴 "ŞİMDİ AL" 이
          빠져나간다. i 자리마다 `[iİ]` 로 적는다.

     ★ 두 함정 모두 실제로 걸렸다 — 처음 넣은 `/\bşimdi\s+al(ın)?\b/i` 가
       "Şimdi al" 을 놓쳐서 [11-b] 시험이 실패했다.
  */
  /ş[iİ]md[iİ]\s+al([ıI]n)?\b/i,
  /ş[iİ]md[iİ]\s+sat([ıI]n)?\b/i,
  /almal[ıI]\s*m[ıI]y[ıI]m/i,
  /satmal[ıI]\s*m[ıI]y[ıI]m/i,
  /garant[iİ]l[iİ]\s+(kâr|kar|get[iİ]r[iİ]|kazanç)/i,
  /(kâr|kar|get[iİ]r[iİ]|kazanç)\s+garant[iİ]s[iİ]/i,
  /kes[iİ]n\s+(kâr|kar|kazanç)/i,

  /* 필리핀어 */
  /\bbumili\s+(na|ngayon)\b/i,
  /\bmagbenta\s+(na|ngayon)\b/i,
  /\bdapat\s+(bang\s+)?bumili\b/i,
  /\bdapat\s+(bang\s+)?magbenta\b/i,
  /garantisadong\s+(kita|tubo|profit)/i,
  /(kita|tubo)\s+na\s+garantisado/i,
  /siguradong\s+(kita|tubo)/i,
];

