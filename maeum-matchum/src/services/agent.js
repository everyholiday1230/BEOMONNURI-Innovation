// ─────────────────────────────────────────────────────────────
// 의사결정 에이전트
// 흐름: 판단(verdict) → 근거(evidence) → 추천(recommend)
//       → 보완(improve) → 실행(action)
// 규칙 엔진으로 뼈대를 만들고, AI(SEED 0.5B)가 문장을 다듬는다.
// AI 없으면 규칙 엔진 결과만으로도 완결된 리포트를 제공.
// ─────────────────────────────────────────────────────────────
import { verdictOf, highlights } from "./scoring.js";
import { chat } from "./aiClient.js";

const DIM_ADVICE = {
  personality: {
    strength: "기본 기질이 잘 맞아 함께 있을 때 편안함을 느낍니다.",
    gap: "에너지 충전 방식이 달라 휴식·약속 조율이 필요합니다."
  },
  values: {
    strength: "삶의 우선순위가 비슷해 큰 결정에서 충돌이 적습니다.",
    gap: "가치관 차이는 장기적으로 누적되므로 초반에 솔직한 대화가 중요합니다."
  },
  lifestyle: {
    strength: "생활 리듬이 맞아 동거·결혼 후 마찰이 적습니다.",
    gap: "생활 패턴이 달라 함께 사는 규칙을 미리 정하는 게 좋습니다."
  },
  spending: {
    strength: "금전 감각이 비슷해 재정 갈등 위험이 낮습니다.",
    gap: "소비·저축 성향 차이는 부부 갈등 1순위이니 공동 규칙이 필요합니다."
  },
  future: {
    strength: "미래 그림이 겹쳐 함께 계획을 세우기 수월합니다.",
    gap: "결혼·자녀·거주 계획의 차이는 반드시 사전 합의가 필요합니다."
  },
  family: {
    strength: "가족관이 비슷해 양가 관계에서 스트레스가 적습니다.",
    gap: "가족·명절에 대한 기대가 달라 경계 설정 대화가 필요합니다."
  },
  job_stability: {
    strength: "커리어 리스크 수용도가 맞아 경제적 의사결정이 원활합니다.",
    gap: "직업 안정성에 대한 기대차는 생활 수준 갈등으로 이어질 수 있습니다."
  },
  communication: {
    strength: "대화 스타일이 통해 오해가 적고 소통이 즐겁습니다.",
    gap: "표현 방식·연락 빈도가 달라 서운함이 쌓이기 쉽습니다."
  },
  attachment: {
    strength: "애착 궁합이 안정적이라 관계가 흔들려도 회복이 빠릅니다.",
    gap: "애착유형 조합상 불안·회피 패턴이 반복될 수 있어 인식과 노력이 필요합니다."
  },
  conflict: {
    strength: "갈등 해결 방식이 비슷해 다툼이 길게 가지 않습니다.",
    gap: "갈등 대처 속도가 달라(즉시 vs 시간 필요) 다툼이 커질 수 있습니다."
  }
};

const ACTIONS_BY_DIM = {
  values: "다음 데이트에서 '10년 뒤 우리의 모습'을 각자 3줄로 적어 비교해 보세요.",
  future: "결혼·자녀·거주에 대한 서로의 기대를 체크리스트로 만들어 맞춰 보세요.",
  spending: "한 달 가계부를 공유하고 '공동 통장 규칙 3가지'를 함께 정해 보세요.",
  communication: "서운했던 순간을 '나 전달법(I-message)'으로 표현하는 연습을 해보세요.",
  attachment: "각자의 애착유형을 공유하고, 불안할 때 원하는 반응을 미리 알려주세요.",
  conflict: "다툰 뒤 '30분 쿨다운 후 다시 대화' 같은 우리만의 규칙을 만들어 보세요.",
  family: "명절·양가 방문 빈도에 대한 서로의 기준을 미리 합의해 두세요.",
  lifestyle: "주중/주말 생활 리듬을 공유하고 함께하는 시간을 캘린더에 고정하세요.",
  job_stability: "각자의 커리어 계획과 리스크 허용선을 솔직하게 공유해 보세요.",
  personality: "서로가 에너지를 얻는 방식을 존중하는 '따로 또 같이' 시간을 정하세요."
};

// 규칙 기반 리포트 골격 생성
export function buildRuleReport(overall, dimensions, selfProfile, partnerProfile) {
  const v = verdictOf(overall);
  const { strengths, gaps } = highlights(dimensions);

  const evidence = [
    ...strengths.map(
      (d) => `✅ ${d.icon} ${d.name} (${d.score}점): ${DIM_ADVICE[d.key].strength}`
    ),
    ...gaps
      .filter((d) => d.score < 70)
      .map((d) => `⚠️ ${d.icon} ${d.name} (${d.score}점): ${DIM_ADVICE[d.key].gap}`)
  ];

  const recommend =
    overall >= 70
      ? "전반적으로 잘 맞는 관계입니다. 강점을 살리며 관계를 진전시켜도 좋습니다."
      : overall >= 55
      ? "가능성이 충분한 관계입니다. 아래 차이점을 함께 다루면 안정성이 크게 올라갑니다."
      : "차이가 있는 관계입니다. 감정만으로 결정하기보다 핵심 차이를 반드시 확인하세요.";

  const improve = gaps
    .filter((d) => d.score < 75)
    .map((d) => `${d.icon} ${d.name}: ${DIM_ADVICE[d.key].gap}`);

  const action = gaps
    .filter((d) => d.score < 75)
    .slice(0, 3)
    .map((d) => ACTIONS_BY_DIM[d.key]);

  if (action.length === 0) {
    action.push(strengths[0] ? ACTIONS_BY_DIM[strengths[0].key] : "함께하는 시간을 꾸준히 쌓아가세요.");
  }

  return {
    verdict: { score: overall, ...v },
    evidence,
    recommend,
    improve: improve.length ? improve : ["뚜렷한 취약점이 없습니다. 강점을 꾸준히 유지하세요."],
    action
  };
}

// AI로 리포트 문장을 자연스럽게 재작성 (실패 시 원본 유지)
export async function polishWithAI(report, ctx) {
  const sys = {
    role: "system",
    content:
      "너는 '마음맞춤'의 따뜻하고 현실적인 연애·결혼 상담 코치다. " +
      "제공된 분석 데이터에 근거해 한국어로 간결하고 공감 어린 조언을 한다. " +
      "과장하지 않고, 데이터에 없는 사실을 지어내지 않는다."
  };
  const user = {
    role: "user",
    content:
      `아래는 두 사람의 궁합 분석 데이터다.\n` +
      `- 종합점수: ${ctx.overall}점 (${report.verdict.grade})\n` +
      `- 강점: ${ctx.strengths}\n- 차이점: ${ctx.gaps}\n\n` +
      `이 데이터를 바탕으로 3~4문장의 따뜻한 '종합 코멘트'를 작성해줘. ` +
      `마지막 문장은 실천을 응원하는 한 마디로 마무리해줘.`
  };

  const text = await chat([sys, user], { temperature: 0.7, maxTokens: 300 });
  if (text) report.aiComment = text;
  return report;
}

// 자유 대화(에이전트 채팅)
export async function agentChat(history, analysisContext) {
  const sys = {
    role: "system",
    content:
      "너는 '마음맞춤' 연애·결혼 의사결정 에이전트다. " +
      "사용자의 궁합 분석 결과를 알고 있으며, 이에 근거해 현실적이고 따뜻하게 조언한다. " +
      "판단→근거→추천→보완→실행 순서로 생각하되, 답변은 자연스러운 대화체로 한다. " +
      `\n\n[분석 컨텍스트]\n${analysisContext}`
  };
  const text = await chat([sys, ...history], { temperature: 0.7, maxTokens: 500 });
  return text;
}

// AI 서버가 없을 때 규칙 기반으로 채팅 응답 생성(간단 폴백)
export function ruleChatFallback(userText, report) {
  const t = userText.toLowerCase();
  if (t.includes("헤어") || t.includes("이별")) {
    return `결정을 서두르기 전에, 지금 가장 점수가 낮은 영역이 대화로 좁혀질 수 있는 차이인지 확인해 보세요. 종합 판단은 "${report.verdict.grade}"입니다. 아래 [실행] 항목을 한 가지라도 시도해 본 뒤 다시 판단해도 늦지 않습니다.`;
  }
  if (t.includes("결혼") || t.includes("프로포즈")) {
    return `결혼은 미래계획·가치관·가족관의 합의가 핵심입니다. 현재 이 영역들의 궁합과 [보완] 항목을 함께 확인해 보세요. 종합 판단은 "${report.verdict.grade}"이며, [실행] 단계를 함께 밟아보는 걸 추천합니다.`;
  }
  return `현재 분석 기준 종합 판단은 "${report.verdict.grade}"입니다. ${report.recommend} 구체적으로는 아래 [실행] 항목부터 시작해 보세요. (더 자세한 대화는 AI 모델 연결 시 가능합니다.)`;
}

// 진단 없이 하는 자유 상담 (홈 → AI 상담 탭)
export async function generalChat(history) {
  const sys = {
    role: "system",
    content:
      "너는 '마음맞춤'의 연애·결혼 의사결정 에이전트다. 단순 위로가 아니라 '결정'을 도와준다.\n" +
      "사용자의 고민에 대해 반드시 다음 흐름으로 답한다:\n" +
      "1) 판단 — 질문에 대한 명확한 방향/입장을 한 문장으로 먼저 제시한다(모호하게 회피하지 않는다).\n" +
      "2) 근거 — 그렇게 판단한 이유를 사용자가 말한 내용에 근거해 짚는다.\n" +
      "3) 추천 — 지금 취하면 좋은 선택을 제안한다.\n" +
      "4) 보완 — 관계에서 개선하거나 확인해야 할 점을 말한다.\n" +
      "5) 실행 — 오늘 당장 할 수 있는 구체적 행동 1~2가지를 준다.\n" +
      "대화는 한국어 대화체로 자연스럽게 이어가고, 이전 대화 맥락을 반드시 반영한다.\n" +
      "정보가 부족하면 판단을 위해 꼭 필요한 것 1가지만 되묻는다. " +
      "단정적 강요는 피하되, 최종 결정은 사용자가 하도록 근거와 함께 방향을 분명히 제시한다. " +
      "더 정밀한 분석이 필요하면 '10대 영역 궁합 진단'을 권한다."
  };
  const text = await chat([sys, ...history], { temperature: 0.7, maxTokens: 600 });
  return text;
}

// 자유 상담 규칙 폴백 (AI 미연결 시) — 의사결정 구조로 응답
export function generalRuleFallback(userText) {
  const t = (userText || "").toLowerCase();
  if (t.includes("헤어") || t.includes("이별") || t.includes("그만")) {
    return [
      "【판단】 지금 바로 이별을 결정하기보다, '반복되는 근본 차이인지'부터 가려보는 게 맞습니다.",
      "【근거】 이별 후회의 대부분은 '해결 가능한 갈등'을 근본 문제로 오해할 때 생깁니다.",
      "【추천】 최근 힘들었던 3가지를 적고, 각각 '대화로 좁혀질 수 있는가'로 나눠보세요.",
      "【보완】 반복되는 항목이 가치관·미래계획이면 관계 지속이 어렵고, 소통 방식이면 개선 가능합니다.",
      "【실행】 오늘 상대에게 '요즘 내가 힘든 지점'을 비난 없이 한 가지만 솔직히 전해보세요. 정확한 판단이 필요하면 '진단' 탭을 이용하세요."
    ].join("\n");
  }
  if (t.includes("결혼") || t.includes("프로포즈")) {
    return [
      "【판단】 결혼 가능 여부는 '설렘'이 아니라 가치관·미래계획·가족관·소비습관의 합의 수준으로 판단해야 합니다.",
      "【근거】 이혼 사유 상위는 대부분 이 4개 영역의 불일치에서 시작됩니다.",
      "【추천】 이 4가지에 대해 서로의 기대를 각자 적어 비교해 보세요.",
      "【보완】 한 항목이라도 크게 어긋나면, 결정을 미루고 그 주제를 먼저 깊게 대화하세요.",
      "【실행】 '10년 뒤 우리 모습'을 각자 3줄로 써서 오늘 맞춰보세요. '진단' 탭에서 두 분 궁합을 수치로 확인할 수도 있습니다."
    ].join("\n");
  }
  if (t.includes("싸움") || t.includes("싸워") || t.includes("싸우") || t.includes("갈등") || t.includes("다툼") || t.includes("다퉈") || t.includes("서운") || t.includes("권태")) {
    return [
      "【판단】 문제는 '싸운다'가 아니라 '같은 걸로 반복해서' 싸운다는 점입니다. 패턴을 끊는 게 우선입니다.",
      "【근거】 반복 갈등은 대개 표면 주제가 아니라 그 밑의 '충족되지 않은 기대' 때문입니다.",
      "【추천】 다음 다툼 때 '무엇 때문에'가 아니라 '내가 진짜 원했던 건'을 말해보세요.",
      "【보완】 서로의 대화 스타일·애착 차이를 이해하면 같은 갈등이 크게 줄어듭니다.",
      "【실행】 '30분 쿨다운 후 다시 대화' 같은 우리만의 규칙을 오늘 하나 정하세요."
    ].join("\n");
  }
  if (t.includes("소개팅") || t.includes("썸") || t.includes("호감") || t.includes("연애 시작")) {
    return [
      "【판단】 초반 호감 단계에선 '설렘'보다 '생활 리듬·대화 스타일·가치관'이 맞는지를 봐야 관계가 오래 갑니다.",
      "【근거】 설렘은 몇 달이면 안정화되고, 그 뒤엔 일상의 결이 관계를 결정합니다.",
      "【추천】 다음 만남에서 주말을 보내는 방식과 돈·미래에 대한 가벼운 대화를 나눠보세요.",
      "【보완】 대화가 편하고 회복이 빠른 사람인지 관찰하세요.",
      "【실행】 상대에 대해 알고 싶은 3가지를 정해 자연스럽게 물어보세요. '진단' 탭으로 궁합을 미리 볼 수도 있습니다."
    ].join("\n");
  }
  return [
    "【판단】 어떤 고민이든, 먼저 '무엇을 결정하고 싶은지'를 분명히 하는 게 첫걸음입니다.",
    "【근거】 목표가 뚜렷해야 근거를 모으고 방향을 정할 수 있습니다.",
    "【추천】 지금 상황을 한 문장으로 정리해 다시 들려주세요(예: 'A와 계속할지 말지 고민').",
    "【보완】 관련해 반복되는 감정이나 사건이 있으면 함께 알려주세요.",
    "【실행】 한 줄로 고민을 정리해 보내주시면, 판단부터 실행까지 함께 짚어드릴게요. 더 정밀한 분석은 '진단' 탭에서 가능합니다."
  ].join("\n");
}
