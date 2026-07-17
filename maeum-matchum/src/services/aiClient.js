// ─────────────────────────────────────────────────────────────
// HyperCLOVA X SEED 0.5B 연동 (OpenAI 호환 API)
// - vLLM / Ollama / sglang 등 OpenAI 호환 서버를 가리킴
// - 서버가 없거나 오류 시 null 반환 → 규칙 엔진으로 폴백
// ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.AI_BASE_URL || "http://localhost:8000/v1";
const API_KEY = process.env.AI_API_KEY || "not-needed-for-local";
const MODEL = process.env.AI_MODEL || "HyperCLOVAX-SEED-Text-Instruct-0.5B";
const DISABLED = String(process.env.AI_DISABLED || "false") === "true";

export function aiEnabled() {
  return !DISABLED;
}

export function aiInfo() {
  return { model: MODEL, baseUrl: BASE_URL, disabled: DISABLED };
}

/**
 * OpenAI 호환 chat completion 호출.
 * @returns {Promise<string|null>} 성공 시 텍스트, 실패 시 null
 */
export async function chat(messages, { temperature = 0.6, maxTokens = 700 } = {}) {
  if (DISABLED) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`[AI] 응답 오류 ${res.status} — 규칙 엔진으로 폴백`);
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.warn(`[AI] 호출 실패(${err.name}) — 규칙 엔진으로 폴백`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
