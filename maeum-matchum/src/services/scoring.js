import {
  DIMENSIONS,
  ATTACHMENT_MATRIX,
  ATTACHMENT_LABELS,
  questionIndex
} from "../domain/assessment.js";

const QIDX = questionIndex();

// 응답 { questionId: value } → 차원별 점수 + 애착유형 산출
export function scoreAnswers(answers) {
  const buckets = {};
  const attachmentVotes = { secure: 0, anxious: 0, avoidant: 0 };

  for (const [qid, value] of Object.entries(answers)) {
    const dim = QIDX[qid];
    if (!dim) continue;
    if (dim.match === "attachment") {
      if (attachmentVotes[value] !== undefined) attachmentVotes[value] += 1;
      continue;
    }
    (buckets[dim.key] ||= []).push(Number(value));
  }

  const scores = {};
  for (const dim of DIMENSIONS) {
    if (dim.match === "attachment") continue;
    const vals = buckets[dim.key] || [];
    // 1~5 척도 평균 → 0~100 정규화
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3;
    scores[dim.key] = Math.round(((avg - 1) / 4) * 100);
  }

  // 애착유형: 최다 득표 (동점 시 secure > anxious > avoidant 우선)
  const attachment = Object.entries(attachmentVotes).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const order = { secure: 0, anxious: 1, avoidant: 2 };
    return order[a[0]] - order[b[0]];
  })[0][0];

  return { scores, attachment, attachmentVotes };
}

// 두 프로필의 궁합 계산
export function computeCompatibility(self, partner) {
  const dims = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const dim of DIMENSIONS) {
    let score;
    let selfVal;
    let partnerVal;

    if (dim.match === "attachment") {
      const a = self.attachment || "secure";
      const b = partner.attachment || "secure";
      score = ATTACHMENT_MATRIX[a][b];
      selfVal = ATTACHMENT_LABELS[a];
      partnerVal = ATTACHMENT_LABELS[b];
    } else {
      selfVal = self.scores[dim.key] ?? 50;
      partnerVal = partner.scores[dim.key] ?? 50;
      // 차이가 작을수록 궁합↑ (0 차이=100, 100 차이=0)
      score = 100 - Math.abs(selfVal - partnerVal);
    }

    weightedSum += score * dim.weight;
    weightTotal += dim.weight;

    dims.push({
      key: dim.key,
      name: dim.name,
      icon: dim.icon,
      weight: dim.weight,
      score: Math.round(score),
      self: selfVal,
      partner: partnerVal,
      match: dim.match,
      desc: dim.desc
    });
  }

  const overall = Math.round(weightedSum / weightTotal);
  return { overall, dimensions: dims };
}

export function verdictOf(score) {
  if (score >= 85) return { grade: "천생연분", tone: "green", emoji: "💚" };
  if (score >= 70) return { grade: "좋은 궁합", tone: "teal", emoji: "💙" };
  if (score >= 55) return { grade: "노력하면 충분", tone: "amber", emoji: "💛" };
  if (score >= 40) return { grade: "신중한 접근 필요", tone: "orange", emoji: "🧡" };
  return { grade: "차이가 큰 관계", tone: "red", emoji: "❤️‍🩹" };
}

// 상위/하위 차원 추출
export function highlights(dimensions) {
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);
  return {
    strengths: sorted.slice(0, 3),
    gaps: sorted.slice(-3).reverse()
  };
}
