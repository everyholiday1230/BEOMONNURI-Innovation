import { db } from "./index.js";

// ── users ──────────────────────────────────────────────
export function createUser({ nickname, age = null, gender = null }) {
  const stmt = db.prepare(
    "INSERT INTO users (nickname, age, gender) VALUES (?, ?, ?)"
  );
  const info = stmt.run(nickname, age, gender);
  return getUser(info.lastInsertRowid);
}

export function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// ── profiles ───────────────────────────────────────────
export function createProfile({
  userId,
  ownerType = "self",
  label = null,
  answers,
  scores,
  attachment = null
}) {
  const stmt = db.prepare(`
    INSERT INTO profiles (user_id, owner_type, label, answers_json, scores_json, attachment)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    userId,
    ownerType,
    label,
    JSON.stringify(answers),
    JSON.stringify(scores),
    attachment
  );
  return getProfile(info.lastInsertRowid);
}

export function getProfile(id) {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
  return row ? hydrateProfile(row) : null;
}

export function listProfiles(userId) {
  return db
    .prepare("SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map(hydrateProfile);
}

function hydrateProfile(row) {
  return {
    ...row,
    answers: JSON.parse(row.answers_json),
    scores: JSON.parse(row.scores_json)
  };
}

// ── analyses ───────────────────────────────────────────
export function createAnalysis({
  userId,
  selfProfileId,
  partnerProfileId,
  overallScore,
  verdict,
  dimension,
  report,
  aiUsed
}) {
  const stmt = db.prepare(`
    INSERT INTO analyses
      (user_id, self_profile_id, partner_profile_id, overall_score, verdict, dimension_json, report_json, ai_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    userId,
    selfProfileId,
    partnerProfileId,
    overallScore,
    verdict,
    JSON.stringify(dimension),
    JSON.stringify(report),
    aiUsed ? 1 : 0
  );
  return getAnalysis(info.lastInsertRowid);
}

export function getAnalysis(id) {
  const row = db.prepare("SELECT * FROM analyses WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...row,
    dimension: JSON.parse(row.dimension_json),
    report: JSON.parse(row.report_json),
    ai_used: !!row.ai_used
  };
}

// ── messages ───────────────────────────────────────────
export function addMessage(analysisId, role, content) {
  const stmt = db.prepare(
    "INSERT INTO messages (analysis_id, role, content) VALUES (?, ?, ?)"
  );
  const info = stmt.run(analysisId, role, content);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
}

export function listMessages(analysisId) {
  return db
    .prepare("SELECT * FROM messages WHERE analysis_id = ? ORDER BY created_at ASC")
    .all(analysisId);
}

// ── customers (자유 상담 고객) ─────────────────────────
export function getOrCreateCustomer(clientKey) {
  let row = db.prepare("SELECT * FROM customers WHERE client_key = ?").get(clientKey);
  if (!row) {
    const info = db
      .prepare("INSERT INTO customers (client_key) VALUES (?)")
      .run(clientKey);
    row = db.prepare("SELECT * FROM customers WHERE id = ?").get(info.lastInsertRowid);
  } else {
    db.prepare("UPDATE customers SET last_seen = datetime('now') WHERE id = ?").run(row.id);
  }
  return row;
}

export function addConsultMessage(customerId, role, content) {
  const info = db
    .prepare("INSERT INTO consult_messages (customer_id, role, content) VALUES (?, ?, ?)")
    .run(customerId, role, content);
  return db.prepare("SELECT * FROM consult_messages WHERE id = ?").get(info.lastInsertRowid);
}

export function listConsultMessages(customerId, limit = 200) {
  return db
    .prepare(
      "SELECT * FROM consult_messages WHERE customer_id = ? ORDER BY created_at ASC LIMIT ?"
    )
    .all(customerId, limit);
}

export function clearConsultMessages(customerId) {
  return db.prepare("DELETE FROM consult_messages WHERE customer_id = ?").run(customerId);
}
