// ─────────────────────────────────────────────────────────────
// 마음맞춤 프론트엔드 (Vanilla JS SPA)
// 화면: landing → selfIntro → assess(self) → partnerIntro
//       → assess(partner) → analyzing → result → chat
// ─────────────────────────────────────────────────────────────

const view = document.getElementById("view");
const toastEl = document.getElementById("toast");
const aiBadge = document.getElementById("aiBadge");
const tabbar = document.getElementById("tabbar");
document.getElementById("brandHome").onclick = () => go("home");

const state = {
  dimensions: [],
  total: 0,
  user: null,
  selfProfile: null,
  partnerProfile: null,
  analysis: null,
  generalMsgs: [], // 자유 상담(진단 없이) 대화 기록
  activeTab: "home",
  // 진행 중 평가
  assess: { target: "self", answers: {}, flatQuestions: [], index: 0, meta: {} }
};

// ── 탭 라우팅 ─────────────────────────────────────────
function go(tab) {
  state.activeTab = tab;
  syncTabs();
  if (tab === "home") return renderLanding();
  if (tab === "diagnose") return renderSelfIntro();
  if (tab === "chat") return renderGeneralChat();
  if (tab === "result") {
    if (state.analysis) return renderResult();
    toast("먼저 궁합 진단을 완료해 주세요");
    return go("diagnose");
  }
}

function syncTabs() {
  tabbar.querySelectorAll(".tab").forEach((btn) => {
    const t = btn.dataset.tab;
    btn.classList.toggle("active", t === state.activeTab);
    if (t === "result") btn.disabled = !state.analysis;
  });
}

tabbar.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => go(btn.dataset.tab);
});

// ── API 헬퍼 ───────────────────────────────────────────
async function api(path, method = "GET", body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 고객 식별키: 브라우저에 영구 저장 → 대화 맥락이 고객별로 유지됨
function getClientKey() {
  let k = localStorage.getItem("mm_client_key");
  if (!k) {
    k = "mm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("mm_client_key", k);
  }
  return k;
}

// ── 초기화 ─────────────────────────────────────────────
async function init() {
  try {
    const [assessment, ai] = await Promise.all([
      api("/assessment"),
      api("/ai-status")
    ]);
    state.dimensions = assessment.dimensions;
    state.total = assessment.total;
    if (ai.enabled) {
      aiBadge.textContent = "AI 연결";
      aiBadge.className = "ai-badge on";
      aiBadge.title = `${ai.model} @ ${ai.baseUrl}`;
    } else {
      aiBadge.textContent = "규칙 엔진";
      aiBadge.className = "ai-badge off";
    }
  } catch (e) {
    aiBadge.textContent = "오프라인";
    aiBadge.className = "ai-badge off";
  }
  go("home");
}

function flatten() {
  const list = [];
  for (const dim of state.dimensions) {
    for (const q of dim.questions) list.push({ ...q, dim });
  }
  return list;
}

// ── 랜딩 ───────────────────────────────────────────────
function renderLanding() {
  view.innerHTML = `
    <div class="fadein">
      <section class="hero">
        <div class="hero-emoji">💗</div>
        <h1>연애의 모든 것,<br/><span class="grad">AI에게 물어보세요</span></h1>
        <p>성향부터 애착유형까지 10가지 핵심 영역을 분석해<br/>당신의 연애·결혼 의사결정을 도와드립니다.</p>
      </section>

      <div class="feature-grid">
        ${featureCard("🧭", "10대 궁합 진단", "성향·가치관·애착 등 핵심 영역 정밀 분석")}
        ${featureCard("🤖", "AI 에이전트", "판단→근거→추천→보완→실행까지 안내")}
        ${featureCard("💬", "1:1 상담 대화", "진단 없이도 지금 바로 물어보세요")}
        ${featureCard("🔒", "가벼운 시작", "회원가입 없이 지금 바로 진단")}
      </div>

      <button class="btn" id="startBtn">💘 궁합 진단 시작하기</button>
      <button class="btn ghost mt" id="askBtn">💬 AI에게 바로 물어보기</button>
      <p class="subtitle center mt">약 3분 · 30문항 · 나와 상대를 각각 진단</p>
    </div>
  `;
  document.getElementById("startBtn").onclick = () => go("diagnose");
  document.getElementById("askBtn").onclick = () => go("chat");
}

function featureCard(fi, ft, fd) {
  return `<div class="feature"><div class="fi">${fi}</div><div class="ft">${ft}</div><div class="fd">${fd}</div></div>`;
}

// ── 본인 소개 입력 ─────────────────────────────────────
function renderSelfIntro() {
  view.innerHTML = `
    <div class="fadein">
      <div class="who-tag who-self">STEP 1 · 나</div>
      <div class="title">먼저 당신을 알려주세요</div>
      <p class="subtitle">간단한 정보와 함께 진단을 시작합니다.</p>
      <div class="card mt">
        <div class="field">
          <label>닉네임</label>
          <input id="nickname" placeholder="예: 지민" maxlength="20" />
        </div>
        <div class="row">
          <div class="field">
            <label>나이 (선택)</label>
            <input id="age" type="number" inputmode="numeric" placeholder="예: 29" />
          </div>
          <div class="field">
            <label>성별 (선택)</label>
            <select id="gender">
              <option value="">선택 안함</option>
              <option value="female">여성</option>
              <option value="male">남성</option>
              <option value="other">기타</option>
            </select>
          </div>
        </div>
        <button class="btn mt" id="toAssess">나의 진단 시작 →</button>
      </div>
    </div>
  `;
  document.getElementById("toAssess").onclick = () => {
    const nickname = document.getElementById("nickname").value.trim();
    if (!nickname) return toast("닉네임을 입력해 주세요");
    state.assess = {
      target: "self",
      answers: {},
      flatQuestions: flatten(),
      index: 0,
      meta: {
        nickname,
        age: document.getElementById("age").value || null,
        gender: document.getElementById("gender").value || null
      }
    };
    renderQuestion();
  };
}

// ── 상대 소개 입력 ─────────────────────────────────────
function renderPartnerIntro() {
  view.innerHTML = `
    <div class="fadein">
      <div class="who-tag who-partner">STEP 2 · 상대</div>
      <div class="title">이제 상대방 차례예요</div>
      <p class="subtitle">상대의 성향을 당신이 아는 만큼 답해주세요.<br/>상대가 직접 응답하면 더 정확합니다.</p>
      <div class="card mt">
        <div class="field">
          <label>상대 별칭</label>
          <input id="pLabel" placeholder="예: 민준" maxlength="20" />
        </div>
        <button class="btn mt" id="toPAssess">상대 진단 시작 →</button>
      </div>
    </div>
  `;
  document.getElementById("toPAssess").onclick = () => {
    const label = document.getElementById("pLabel").value.trim() || "상대";
    state.assess = {
      target: "partner",
      answers: {},
      flatQuestions: flatten(),
      index: 0,
      meta: { label }
    };
    renderQuestion();
  };
}

// ── 문항 렌더 ──────────────────────────────────────────
function renderQuestion() {
  const a = state.assess;
  const q = a.flatQuestions[a.index];
  const progress = Math.round((a.index / a.flatQuestions.length) * 100);
  const selected = a.answers[q.id];
  const whoTag = a.target === "self"
    ? `<div class="who-tag who-self">나 · ${esc(a.meta.nickname)}</div>`
    : `<div class="who-tag who-partner">상대 · ${esc(a.meta.label)}</div>`;

  view.innerHTML = `
    <div class="fadein">
      ${whoTag}
      <div class="progress-wrap">
        <div class="progress-meta"><span>${a.index + 1} / ${a.flatQuestions.length}</span><span>${progress}%</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <div class="card">
        <div class="q-dim"><span class="qd-icon">${q.dim.icon}</span> ${q.dim.name}</div>
        <div class="q-text">${esc(q.text)}</div>
        <div class="options">
          ${q.options.map((o, i) => `
            <button class="option ${selected === o.value ? "selected" : ""}" data-val='${JSON.stringify(o.value)}'>
              ${esc(o.label)}
            </button>`).join("")}
        </div>
        <div class="q-nav">
          ${a.index > 0 ? `<button class="btn ghost" id="prevBtn">← 이전</button>` : ""}
        </div>
      </div>
    </div>
  `;

  view.querySelectorAll(".option").forEach((btn) => {
    btn.onclick = () => {
      a.answers[q.id] = JSON.parse(btn.dataset.val);
      if (a.index < a.flatQuestions.length - 1) {
        a.index++;
        renderQuestion();
      } else {
        finishAssessment();
      }
    };
  });
  const prev = document.getElementById("prevBtn");
  if (prev) prev.onclick = () => { a.index--; renderQuestion(); };
}

// ── 평가 완료 처리 ─────────────────────────────────────
async function finishAssessment() {
  const a = state.assess;
  try {
    if (a.target === "self") {
      renderLoader("당신의 프로필을 만들고 있어요...");
      const { user, profile } = await api("/users", "POST", {
        nickname: a.meta.nickname,
        age: a.meta.age ? Number(a.meta.age) : null,
        gender: a.meta.gender,
        answers: a.answers
      });
      state.user = user;
      state.selfProfile = profile;
      renderPartnerIntro();
    } else {
      renderLoader("상대 프로필을 만들고 있어요...");
      const { profile } = await api("/partners", "POST", {
        userId: state.user.id,
        label: a.meta.label,
        answers: a.answers
      });
      state.partnerProfile = profile;
      await runAnalysis();
    }
  } catch (e) {
    toast(e.message);
  }
}

async function runAnalysis() {
  renderLoader("두 분의 궁합을 분석하고 있어요 💗");
  try {
    const result = await api("/analyze", "POST", {
      userId: state.user.id,
      selfProfileId: state.selfProfile.id,
      partnerProfileId: state.partnerProfile.id
    });
    state.analysis = result;
    state.activeTab = "result";
    syncTabs();
    renderResult();
  } catch (e) {
    toast(e.message);
  }
}

function renderLoader(msg) {
  view.innerHTML = `<div class="loader"><div class="spinner"></div><div class="subtitle">${esc(msg)}</div></div>`;
}

// ── 결과 화면 ──────────────────────────────────────────
function renderResult() {
  const r = state.analysis;
  const rep = r.report;
  const v = rep.verdict;
  const circ = 2 * Math.PI * 78;
  const dash = (r.overall / 100) * circ;

  view.innerHTML = `
    <div class="fadein stack">
      <section class="card score-hero">
        <div class="subtitle">${esc(r.self.label)} 💗 ${esc(r.partner.label)}</div>
        <div class="gauge">
          <svg width="180" height="180">
            <circle cx="90" cy="90" r="78" fill="none" stroke="#ffe1e8" stroke-width="14"/>
            <circle cx="90" cy="90" r="78" fill="none" stroke="url(#g)" stroke-width="14"
              stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/>
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ff5a7a"/><stop offset="1" stop-color="#e63e63"/>
            </linearGradient></defs>
          </svg>
          <div class="gauge-center">
            <div class="gauge-score">${r.overall}</div>
            <div class="gauge-unit">/ 100</div>
          </div>
        </div>
        <div class="verdict-pill pill-${v.tone}">${v.emoji} ${v.grade}</div>
        ${rep.aiComment ? `
          <div class="ai-comment">
            <div class="aic-label">🤖 AI 코치의 종합 코멘트</div>
            ${esc(rep.aiComment)}
          </div>` : ""}
      </section>

      <section class="card">
        <div class="section-label">📊 10대 영역별 궁합</div>
        <div class="dim-list">
          ${r.dimensions.map(dimBar).join("")}
        </div>
      </section>

      <section class="card">
        ${reportBlock(1, "AI 판단", `<p style="font-size:15px">종합 <b>${r.overall}점</b> · <b>${v.grade}</b></p>`)}
        ${reportBlock(2, "근거 제시", `<ul class="report-list">${rep.evidence.map(li).join("")}</ul>`)}
        ${reportBlock(3, "추천", `<ul class="report-list"><li>${esc(rep.recommend)}</li></ul>`)}
        ${reportBlock(4, "보완 제시", `<ul class="report-list">${rep.improve.map(li).join("")}</ul>`)}
        ${reportBlock(5, "실행 가이드", `<ul class="report-list action">${rep.action.map(li).join("")}</ul>`)}
      </section>

      <button class="btn" id="toChat">💬 AI 에이전트와 상담하기</button>
      <button class="btn ghost" id="restart">처음부터 다시하기</button>
    </div>
  `;
  document.getElementById("toChat").onclick = renderChat;
  document.getElementById("restart").onclick = () => { resetState(); go("home"); };
}

function dimBar(d) {
  const color = d.score >= 75 ? "var(--green)" : d.score >= 55 ? "var(--amber)" : "var(--orange)";
  const vals = d.match === "attachment"
    ? `${d.self} ↔ ${d.partner}`
    : `나 ${d.self} ↔ 상대 ${d.partner}`;
  return `
    <div class="dim-item">
      <div class="dim-top">
        <span class="dim-name"><span class="di">${d.icon}</span>${d.name}</span>
        <span class="dim-score" style="color:${color}">${d.score}</span>
      </div>
      <div class="dim-track"><div class="dim-bar" style="width:${d.score}%;background:${color}"></div></div>
      <div class="dim-vals">${esc(vals)}</div>
    </div>`;
}

function reportBlock(num, title, inner) {
  return `<div class="report-block"><h3><span class="rb-num">${num}</span>${title}</h3>${inner}</div>`;
}
function li(text) { return `<li>${esc(text)}</li>`; }

// ── 채팅 화면 ──────────────────────────────────────────
function renderChat() {
  const r = state.analysis;
  view.innerHTML = `
    <div class="fadein">
      <div class="title">💬 AI 에이전트 상담</div>
      <p class="subtitle">${esc(r.self.label)} & ${esc(r.partner.label)} · 종합 ${r.overall}점 (${r.report.verdict.grade})</p>
      <div class="chat-wrap mt">
        <div class="suggest-chips" id="chips">
          ${["우리 결혼해도 될까요?", "가장 큰 걱정거리는?", "관계를 개선하려면?", "헤어져야 할까요?"]
            .map((s) => `<button data-s="${esc(s)}">${esc(s)}</button>`).join("")}
        </div>
        <div class="chat-scroll" id="chatScroll"></div>
        <div class="chat-input-bar">
          <input id="chatInput" placeholder="궁금한 점을 물어보세요..." />
          <button class="btn" id="sendBtn">전송</button>
        </div>
      </div>
      <button class="btn ghost mt" id="backResult">← 결과로 돌아가기</button>
    </div>
  `;

  const scroll = document.getElementById("chatScroll");
  addBubble(scroll, "assistant",
    `안녕하세요, 마음맞춤 AI 에이전트예요. 💗\n${r.self.label}님과 ${r.partner.label}님의 궁합은 종합 ${r.overall}점, "${r.report.verdict.grade}"으로 분석됐어요. 무엇이든 편하게 물어보세요.`);

  const send = async () => {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    addBubble(scroll, "user", msg);
    const typing = addBubble(scroll, "assistant typing", "생각 중이에요...");
    try {
      const { reply } = await api("/chat", "POST", { analysisId: r.analysisId, message: msg });
      typing.remove();
      addBubble(scroll, "assistant", reply);
    } catch (e) {
      typing.remove();
      addBubble(scroll, "assistant", "죄송해요, 응답 중 문제가 생겼어요. 다시 시도해 주세요.");
    }
  };

  document.getElementById("sendBtn").onclick = send;
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  document.querySelectorAll("#chips button").forEach((b) => {
    b.onclick = () => {
      document.getElementById("chatInput").value = b.dataset.s;
      send();
    };
  });
  document.getElementById("backResult").onclick = renderResult;
}

function addBubble(scroll, cls, text) {
  const el = document.createElement("div");
  el.className = `bubble ${cls}`;
  el.textContent = text;
  scroll.appendChild(el);
  scroll.scrollTop = scroll.scrollHeight;
  return el;
}

// ── 자유 상담(진단 없이) ───────────────────────────────
async function renderGeneralChat() {
  view.innerHTML = `
    <div class="fadein">
      <div class="title">💬 AI 상담</div>
      <p class="subtitle">진단 없이도 연애·결혼 고민을 바로 물어보세요. 대화는 이어서 기억됩니다.</p>
      <div class="chat-wrap mt">
        <div class="suggest-chips" id="gchips">
          ${["요즘 권태기인 것 같아요", "이 사람과 결혼해도 될까요?", "자꾸 같은 걸로 싸워요", "연락 문제로 서운해요"]
            .map((s) => `<button data-s="${esc(s)}">${esc(s)}</button>`).join("")}
        </div>
        <div class="chat-scroll" id="gScroll"></div>
        <div class="chat-input-bar">
          <input id="gInput" placeholder="어떤 고민이든 편하게 적어주세요..." />
          <button class="btn" id="gSend">전송</button>
        </div>
      </div>
      <div class="chat-actions mt">
        <button class="btn ghost" id="gToDiag">💘 정밀 궁합 진단 받기</button>
        <button class="btn ghost" id="gClear">🗑️ 대화 비우기</button>
      </div>
    </div>
  `;

  const scroll = document.getElementById("gScroll");
  const clientKey = getClientKey();

  // 서버에서 고객별 대화 이력 복원
  let restored = [];
  try {
    const data = await api(`/consult/history?clientKey=${encodeURIComponent(clientKey)}`);
    restored = data.messages || [];
  } catch (_) {}

  state.generalMsgs = restored;
  if (restored.length === 0) {
    addBubble(scroll, "assistant",
      "안녕하세요, 마음맞춤 AI 상담이에요. 💗\n연애·결혼에 대한 고민을 말씀해 주시면, 판단부터 실행까지 함께 결정을 도와드릴게요.");
  } else {
    restored.forEach((m) => addBubble(scroll, m.role === "user" ? "user" : "assistant", m.content));
  }

  const send = async () => {
    const input = document.getElementById("gInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    addBubble(scroll, "user", msg);
    const typing = addBubble(scroll, "assistant typing", "생각 중이에요...");
    try {
      const { reply } = await api("/chat/general", "POST", { clientKey, message: msg });
      typing.remove();
      addBubble(scroll, "assistant", reply);
    } catch (e) {
      typing.remove();
      addBubble(scroll, "assistant", "죄송해요, 응답 중 문제가 생겼어요. 다시 시도해 주세요.");
    }
  };

  document.getElementById("gSend").onclick = send;
  document.getElementById("gInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  document.querySelectorAll("#gchips button").forEach((b) => {
    b.onclick = () => { document.getElementById("gInput").value = b.dataset.s; send(); };
  });
  document.getElementById("gToDiag").onclick = () => go("diagnose");
  document.getElementById("gClear").onclick = async () => {
    try { await api("/consult/history", "DELETE", { clientKey }); } catch (_) {}
    renderGeneralChat();
  };
}

function resetState() {
  state.user = null;
  state.selfProfile = null;
  state.partnerProfile = null;
  state.analysis = null;
}

init();
