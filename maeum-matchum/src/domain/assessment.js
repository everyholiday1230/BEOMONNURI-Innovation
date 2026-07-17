// ─────────────────────────────────────────────────────────────
// 마음맞춤 평가 스키마
// 10개 핵심 차원 × 각 3문항 = 30문항
// 각 차원은 "궁합" 계산 방식을 가진다:
//   - similarity : 값이 비슷할수록 궁합↑ (가치관·생활패턴 등)
//   - complement : 애착유형처럼 조합 규칙표로 계산
// ─────────────────────────────────────────────────────────────

export const DIMENSIONS = [
  {
    key: "personality",
    name: "성향",
    icon: "🧭",
    match: "similarity",
    weight: 1.0,
    desc: "내향/외향, 계획형/즉흥형 등 기본 기질",
    questions: [
      {
        id: "personality_1",
        text: "주말에 에너지가 충전되는 방식은?",
        options: [
          { label: "집에서 혼자 조용히 쉰다", value: 1 },
          { label: "가까운 사람 1~2명과 시간을 보낸다", value: 3 },
          { label: "여럿이 모여 활발하게 논다", value: 5 }
        ]
      },
      {
        id: "personality_2",
        text: "여행 계획을 세울 때 나는?",
        options: [
          { label: "분 단위로 일정을 짠다", value: 1 },
          { label: "큰 틀만 정하고 나머진 즉흥", value: 3 },
          { label: "무계획이 최고의 계획", value: 5 }
        ]
      },
      {
        id: "personality_3",
        text: "새로운 환경에 놓였을 때?",
        options: [
          { label: "익숙해질 때까지 관찰한다", value: 1 },
          { label: "필요한 만큼만 적응한다", value: 3 },
          { label: "먼저 다가가 부딪혀 본다", value: 5 }
        ]
      }
    ]
  },
  {
    key: "values",
    name: "가치관",
    icon: "💎",
    match: "similarity",
    weight: 1.4,
    desc: "삶에서 중요하게 여기는 우선순위",
    questions: [
      {
        id: "values_1",
        text: "인생에서 가장 우선하는 것은?",
        options: [
          { label: "안정과 평온", value: 1 },
          { label: "성장과 성취", value: 3 },
          { label: "자유와 경험", value: 5 }
        ]
      },
      {
        id: "values_2",
        text: "중요한 결정을 내릴 때 기준은?",
        options: [
          { label: "현실적 손익", value: 1 },
          { label: "상황에 따라 유연하게", value: 3 },
          { label: "내 신념과 감정", value: 5 }
        ]
      },
      {
        id: "values_3",
        text: "돈과 시간 중 더 중요한 것은?",
        options: [
          { label: "돈 — 안정의 기반", value: 1 },
          { label: "둘 다 균형있게", value: 3 },
          { label: "시간 — 되돌릴 수 없으니까", value: 5 }
        ]
      }
    ]
  },
  {
    key: "lifestyle",
    name: "생활패턴",
    icon: "🌙",
    match: "similarity",
    weight: 1.0,
    desc: "생활 리듬, 정리정돈, 활동 성향",
    questions: [
      {
        id: "lifestyle_1",
        text: "나의 하루 리듬은?",
        options: [
          { label: "아침형 — 일찍 자고 일찍 일어남", value: 1 },
          { label: "유동적", value: 3 },
          { label: "저녁형 — 밤에 집중이 잘 됨", value: 5 }
        ]
      },
      {
        id: "lifestyle_2",
        text: "집 정리 상태는?",
        options: [
          { label: "항상 깔끔하게 유지", value: 1 },
          { label: "적당히 어질러도 괜찮음", value: 3 },
          { label: "정리보다 편함이 우선", value: 5 }
        ]
      },
      {
        id: "lifestyle_3",
        text: "이상적인 데이트는?",
        options: [
          { label: "집·근처에서 잔잔하게", value: 1 },
          { label: "맛집·카페 위주", value: 3 },
          { label: "액티비티·여행 위주", value: 5 }
        ]
      }
    ]
  },
  {
    key: "spending",
    name: "소비습관",
    icon: "💳",
    match: "similarity",
    weight: 1.3,
    desc: "저축/소비 성향, 금전 관리 방식",
    questions: [
      {
        id: "spending_1",
        text: "월급을 받으면?",
        options: [
          { label: "먼저 저축하고 남은 걸 쓴다", value: 1 },
          { label: "계획적으로 나눠 쓴다", value: 3 },
          { label: "쓰고 싶은 걸 먼저 쓴다", value: 5 }
        ]
      },
      {
        id: "spending_2",
        text: "큰 지출을 앞두고 나는?",
        options: [
          { label: "며칠 고민하고 비교한다", value: 1 },
          { label: "적당히 알아보고 결정", value: 3 },
          { label: "마음에 들면 바로 산다", value: 5 }
        ]
      },
      {
        id: "spending_3",
        text: "돈에 대한 나의 태도는?",
        options: [
          { label: "미래 대비가 최우선", value: 1 },
          { label: "현재와 미래 균형", value: 3 },
          { label: "지금의 행복이 중요", value: 5 }
        ]
      }
    ]
  },
  {
    key: "future",
    name: "미래계획",
    icon: "🚀",
    match: "similarity",
    weight: 1.4,
    desc: "결혼·자녀·거주·커리어에 대한 그림",
    questions: [
      {
        id: "future_1",
        text: "결혼에 대한 생각은?",
        options: [
          { label: "가능한 빨리 하고 싶다", value: 1 },
          { label: "좋은 사람이면 자연스럽게", value: 3 },
          { label: "꼭 해야 한다고 생각하진 않는다", value: 5 }
        ]
      },
      {
        id: "future_2",
        text: "자녀 계획은?",
        options: [
          { label: "꼭 갖고 싶다", value: 1 },
          { label: "상황에 따라 결정", value: 3 },
          { label: "원하지 않는다", value: 5 }
        ]
      },
      {
        id: "future_3",
        text: "5년 뒤 이상적인 삶은?",
        options: [
          { label: "안정된 가정과 내 집", value: 1 },
          { label: "커리어 성장과 안정의 균형", value: 3 },
          { label: "자유로운 라이프스타일", value: 5 }
        ]
      }
    ]
  },
  {
    key: "family",
    name: "가족관",
    icon: "🏡",
    match: "similarity",
    weight: 1.2,
    desc: "원가족·명절·부모 부양에 대한 관점",
    questions: [
      {
        id: "family_1",
        text: "결혼 후 양가 부모님과의 관계는?",
        options: [
          { label: "자주 왕래하며 가깝게", value: 1 },
          { label: "적당한 거리에서 화목하게", value: 3 },
          { label: "독립적으로, 필요할 때만", value: 5 }
        ]
      },
      {
        id: "family_2",
        text: "명절·집안 행사에 대한 생각은?",
        options: [
          { label: "전통을 지키는 게 중요", value: 1 },
          { label: "핵심만 챙기면 된다", value: 3 },
          { label: "형식보다 우리 부부가 우선", value: 5 }
        ]
      },
      {
        id: "family_3",
        text: "부모 부양에 대한 입장은?",
        options: [
          { label: "당연히 함께 책임진다", value: 1 },
          { label: "형편에 맞게 분담", value: 3 },
          { label: "각자 부모는 각자가", value: 5 }
        ]
      }
    ]
  },
  {
    key: "job_stability",
    name: "직업 안정성",
    icon: "💼",
    match: "similarity",
    weight: 1.1,
    desc: "커리어 리스크 수용도, 소득 안정성 선호",
    questions: [
      {
        id: "job_stability_1",
        text: "선호하는 커리어 형태는?",
        options: [
          { label: "안정적인 직장·고정 수입", value: 1 },
          { label: "안정과 도전의 균형", value: 3 },
          { label: "도전적인 창업·프리랜서", value: 5 }
        ]
      },
      {
        id: "job_stability_2",
        text: "이직·전직에 대한 생각은?",
        options: [
          { label: "한 곳에서 오래 일하고 싶다", value: 1 },
          { label: "기회가 좋으면 옮긴다", value: 3 },
          { label: "성장 위해 자주 바꿀 수 있다", value: 5 }
        ]
      },
      {
        id: "job_stability_3",
        text: "소득의 변동성에 대해?",
        options: [
          { label: "예측 가능해야 안심된다", value: 1 },
          { label: "어느 정도 변동은 괜찮다", value: 3 },
          { label: "크게 벌 수 있다면 감수한다", value: 5 }
        ]
      }
    ]
  },
  {
    key: "communication",
    name: "대화 스타일",
    icon: "💬",
    match: "similarity",
    weight: 1.2,
    desc: "감정 표현·직설/우회, 소통 빈도",
    questions: [
      {
        id: "communication_1",
        text: "속상한 일이 생기면 나는?",
        options: [
          { label: "혼자 정리한 뒤 말한다", value: 1 },
          { label: "상황 봐서 표현한다", value: 3 },
          { label: "바로 솔직하게 말한다", value: 5 }
        ]
      },
      {
        id: "communication_2",
        text: "연인과의 연락 빈도는?",
        options: [
          { label: "필요할 때만 간단히", value: 1 },
          { label: "하루 몇 번 적당히", value: 3 },
          { label: "수시로 자주 나누고 싶다", value: 5 }
        ]
      },
      {
        id: "communication_3",
        text: "의견이 다를 때 표현 방식은?",
        options: [
          { label: "돌려서 부드럽게", value: 1 },
          { label: "상황에 맞춰서", value: 3 },
          { label: "직설적으로 분명하게", value: 5 }
        ]
      }
    ]
  },
  {
    key: "attachment",
    name: "애착유형",
    icon: "🔗",
    match: "attachment",
    weight: 1.5,
    desc: "안정형/불안형/회피형 — 관계 안정성의 핵심",
    questions: [
      {
        id: "attachment_1",
        text: "연인이 답장이 늦으면?",
        options: [
          { label: "무슨 일 있나 조금 불안하다", value: "anxious" },
          { label: "바쁜가 보다 하고 넘긴다", value: "secure" },
          { label: "별로 신경 쓰지 않는다", value: "avoidant" }
        ]
      },
      {
        id: "attachment_2",
        text: "관계가 깊어질 때 나는?",
        options: [
          { label: "더 확인받고 싶어진다", value: "anxious" },
          { label: "편안하게 신뢰가 쌓인다", value: "secure" },
          { label: "가끔 거리감이 필요하다", value: "avoidant" }
        ]
      },
      {
        id: "attachment_3",
        text: "갈등 후 나의 상태는?",
        options: [
          { label: "빨리 풀지 않으면 초조하다", value: "anxious" },
          { label: "대화로 차분히 회복한다", value: "secure" },
          { label: "혼자만의 시간이 필요하다", value: "avoidant" }
        ]
      }
    ]
  },
  {
    key: "conflict",
    name: "갈등해결방식",
    icon: "🕊️",
    match: "similarity",
    weight: 1.3,
    desc: "다툼 시 접근 방식(대면/회피/타협)",
    questions: [
      {
        id: "conflict_1",
        text: "다툼이 생기면 나는?",
        options: [
          { label: "그 자리에서 바로 푼다", value: 1 },
          { label: "잠깐 식힌 뒤 대화한다", value: 3 },
          { label: "시간을 두고 천천히", value: 5 }
        ]
      },
      {
        id: "conflict_2",
        text: "의견 충돌 시 우선하는 것은?",
        options: [
          { label: "문제 해결이 먼저", value: 1 },
          { label: "해결과 감정 둘 다", value: 3 },
          { label: "서로의 감정이 먼저", value: 5 }
        ]
      },
      {
        id: "conflict_3",
        text: "사과에 대한 태도는?",
        options: [
          { label: "잘못이 있으면 바로 사과", value: 1 },
          { label: "대화하며 조율", value: 3 },
          { label: "시간이 필요한 편", value: 5 }
        ]
      }
    ]
  }
];

// 애착유형 조합 궁합표 (0~100)
export const ATTACHMENT_MATRIX = {
  secure:   { secure: 95, anxious: 80, avoidant: 78 },
  anxious:  { secure: 80, anxious: 55, avoidant: 35 },
  avoidant: { secure: 78, anxious: 35, avoidant: 50 }
};

export const ATTACHMENT_LABELS = {
  secure: "안정형",
  anxious: "불안형",
  avoidant: "회피형"
};

// id -> dimension 매핑 헬퍼
export function questionIndex() {
  const map = {};
  for (const dim of DIMENSIONS) {
    for (const q of dim.questions) map[q.id] = dim;
  }
  return map;
}

export function totalQuestions() {
  return DIMENSIONS.reduce((n, d) => n + d.questions.length, 0);
}
