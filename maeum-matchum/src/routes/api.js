import { Router } from "express";
import { DIMENSIONS, totalQuestions } from "../domain/assessment.js";
import { scoreAnswers, computeCompatibility, highlights } from "../services/scoring.js";
import {
  buildRuleReport,
  polishWithAI,
  agentChat,
  ruleChatFallback,
  generalChat,
  generalRuleFallback
} from "../services/agent.js";
import { aiEnabled, aiInfo } from "../services/aiClient.js";
import * as repo from "../db/repo.js";

export const api = Router();

// 평가 문항 및 차원 메타 제공
api.get("/assessment", (_req, res) => {
  res.json({
    dimensions: DIMENSIONS,
    total: totalQuestions()
  });
});

api.get("/ai-status", (_req, res) => {
  res.json({ enabled: aiEnabled(), ...aiInfo() });
});

// 사용자 생성 + 본인 프로필 등록
// body: { nickname, age, gender, answers }
api.post("/users", (req, res) => {
  try {
    const { nickname, age, gender, answers } = req.body;
    if (!nickname || !answers) {
      return res.status(400).json({ error: "nickname과 answers는 필수입니다." });
    }
    const user = repo.createUser({ nickname, age, gender });
    const { scores, attachment } = scoreAnswers(answers);
    const profile = repo.createProfile({
      userId: user.id,
      ownerType: "self",
      label: nickname,
      answers,
      scores,
      attachment
    });
    res.json({ user, profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "사용자 생성 실패" });
  }
});

// 상대 프로필 등록
// body: { userId, label, answers }
api.post("/partners", (req, res) => {
  try {
    const { userId, label, answers } = req.body;
    if (!userId || !answers) {
      return res.status(400).json({ error: "userId와 answers는 필수입니다." });
    }
    const { scores, attachment } = scoreAnswers(answers);
    const profile = repo.createProfile({
      userId,
      ownerType: "partner",
      label: label || "상대",
      answers,
      scores,
      attachment
    });
    res.json({ profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "상대 프로필 생성 실패" });
  }
});

// 궁합 분석 실행 (판단>근거>추천>보완>실행)
// body: { userId, selfProfileId, partnerProfileId }
api.post("/analyze", async (req, res) => {
  try {
    const { userId, selfProfileId, partnerProfileId } = req.body;
    const self = repo.getProfile(selfProfileId);
    const partner = repo.getProfile(partnerProfileId);
    if (!self || !partner) {
      return res.status(404).json({ error: "프로필을 찾을 수 없습니다." });
    }

    const { overall, dimensions } = computeCompatibility(self, partner);
    const report = buildRuleReport(overall, dimensions, self, partner);
    const { strengths, gaps } = highlights(dimensions);

    let aiUsed = false;
    if (aiEnabled()) {
      const before = report.aiComment;
      await polishWithAI(report, {
        overall,
        strengths: strengths.map((d) => `${d.name}(${d.score})`).join(", "),
        gaps: gaps.map((d) => `${d.name}(${d.score})`).join(", ")
      });
      aiUsed = report.aiComment && report.aiComment !== before;
    }

    const analysis = repo.createAnalysis({
      userId,
      selfProfileId,
      partnerProfileId,
      overallScore: overall,
      verdict: report.verdict.grade,
      dimension: dimensions,
      report,
      aiUsed
    });

    res.json({
      analysisId: analysis.id,
      overall,
      dimensions,
      report,
      aiUsed,
      self: { label: self.label, attachment: self.attachment },
      partner: { label: partner.label, attachment: partner.attachment }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "분석 실패" });
  }
});

api.get("/analysis/:id", (req, res) => {
  const analysis = repo.getAnalysis(Number(req.params.id));
  if (!analysis) return res.status(404).json({ error: "분석을 찾을 수 없습니다." });
  const messages = repo.listMessages(analysis.id);
  res.json({ analysis, messages });
});

// 에이전트 대화
// body: { analysisId, message }
api.post("/chat", async (req, res) => {
  try {
    const { analysisId, message } = req.body;
    const analysis = repo.getAnalysis(Number(analysisId));
    if (!analysis) return res.status(404).json({ error: "분석을 찾을 수 없습니다." });
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "메시지가 비어 있습니다." });
    }

    repo.addMessage(analysis.id, "user", message);

    const ctx =
      `종합점수 ${analysis.overall_score}점, 판단 "${analysis.verdict}". ` +
      `차원별 점수: ${analysis.dimension
        .map((d) => `${d.name} ${d.score}`)
        .join(", ")}.`;

    const history = repo
      .listMessages(analysis.id)
      .map((m) => ({ role: m.role, content: m.content }));

    let reply = null;
    if (aiEnabled()) {
      reply = await agentChat(history, ctx);
    }
    if (!reply) {
      reply = ruleChatFallback(message, analysis.report);
    }

    repo.addMessage(analysis.id, "assistant", reply);
    res.json({ reply, aiUsed: aiEnabled() && !!reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "대화 처리 실패" });
  }
});

// 자유 상담 대화 이력 조회 (고객별)
// query: ?clientKey=xxx
api.get("/consult/history", (req, res) => {
  try {
    const clientKey = String(req.query.clientKey || "").trim();
    if (!clientKey) return res.status(400).json({ error: "clientKey가 필요합니다." });
    const customer = repo.getOrCreateCustomer(clientKey);
    const messages = repo
      .listConsultMessages(customer.id)
      .map((m) => ({ role: m.role, content: m.content }));
    res.json({ customerId: customer.id, messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "이력 조회 실패" });
  }
});

// 자유 상담 대화 이력 삭제 (고객별)
// body: { clientKey }
api.delete("/consult/history", (req, res) => {
  try {
    const clientKey = String(req.body?.clientKey || "").trim();
    if (!clientKey) return res.status(400).json({ error: "clientKey가 필요합니다." });
    const customer = repo.getOrCreateCustomer(clientKey);
    repo.clearConsultMessages(customer.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "이력 삭제 실패" });
  }
});

// 진단 없이 자유 상담 (AI 상담 탭) — 고객별 맥락 영구 유지 + 의사결정
// body: { clientKey, message }
api.post("/chat/general", async (req, res) => {
  try {
    const { clientKey, message } = req.body;
    if (!clientKey || !String(clientKey).trim()) {
      return res.status(400).json({ error: "clientKey가 필요합니다." });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "메시지가 비어 있습니다." });
    }

    const customer = repo.getOrCreateCustomer(String(clientKey).trim());

    // 사용자 메시지 저장
    repo.addConsultMessage(customer.id, "user", message);

    // 저장된 전체 대화에서 최근 16턴을 맥락으로 사용
    const stored = repo.listConsultMessages(customer.id);
    const history = stored
      .slice(-16)
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    let reply = null;
    if (aiEnabled()) {
      reply = await generalChat(history);
    }
    if (!reply) {
      reply = generalRuleFallback(message);
    }

    repo.addConsultMessage(customer.id, "assistant", reply);
    res.json({ reply, aiUsed: aiEnabled() && !!reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "대화 처리 실패" });
  }
});
