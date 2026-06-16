function _modal(e) {
  return new Promise((o) => {
    let i = document.getElementById("_sysModal");
    i ||
      ((i = document.createElement("div")),
      (i.id = "_sysModal"),
      (i.className = "notice-modal"),
      document.body.appendChild(i));
    const n = e.input !== void 0,
      s = e.confirm;
    ((i.onclick = (a) => {
      a.target === i && (i.classList.remove("open"), o(null));
    }),
      (i.innerHTML = `<div class="notice-modal-inner" style="max-width:340px">
      <h3 style="color:#921230;font-size:14px;margin:0 0 8px">${e.title || ""}</h3>
      ${e.desc ? `<p style="font-size:14px;color:var(--muted);margin-bottom:10px;line-height:1.5">${e.desc}</p>` : ""}
      ${n ? `<input id="_sysModalInput" value="${_escHtml(e.input || "")}" placeholder="${_escHtml(e.placeholder || "")}" ${e.inputType ? 'type="' + e.inputType + '"' : ""} style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;margin-bottom:8px;box-sizing:border-box">` : ""}
      <div style="display:flex;gap:6px">
        <button onclick="document.getElementById('_sysModal').classList.remove('open')" style="flex:1;padding:8px;background:var(--border);color:var(--text);border:none;border-radius:6px;cursor:pointer;font-size:14px">\uCDE8\uC18C</button>
        <button id="_sysModalOk" style="flex:1;padding:8px;background:${e.danger ? "#3B82F6" : "#921230"};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">${e.ok || "\uD655\uC778"}</button>
      </div>
    </div>`),
      i.classList.add("open"));
    const r = document.getElementById("_sysModalInput");
    (r && r.focus(),
      (document.getElementById("_sysModalOk").onclick = () => {
        (i.classList.remove("open"), o(n ? (r?.value ?? "") : !0));
      }),
      r &&
        (r.onkeydown = (a) => {
          a.key === "Enter" && (i.classList.remove("open"), o(r.value));
        }));
  });
}
(async function () {
  window.isAdmin &&
    window.isAdmin() &&
    (document.getElementById("adminTools").style.display = "block");
  let e = null;
  window.chart &&
    (window.chart.onReplayChange = function (o, i) {
      const n = document.getElementById("replayInfo");
      (n && (n.textContent = o >= 0 ? `${o}/${i}` : ""),
        clearTimeout(e),
        (e = setTimeout(() => {
          (window.calcIndicators && window.calcIndicators(),
            window._drawBimacoTP && window._drawBimacoTP());
        }, 50)));
    });
})();
function startReplayMode() {
  if (!window.chart || !window.chart.buffer.length) return;
  const e = Math.min(
    Math.ceil(window.chart.timeScale.visibleTo),
    window.chart.buffer.length,
  );
  (window.chart.startReplay(e),
    (document.getElementById("replayControls").style.display = "flex"),
    (document.getElementById("replayStartBtn").style.display = "none"),
    (_btpCache = null),
    (_btpLastIdx = -1),
    typeof loadBimacoTP == "function" && loadBimacoTP());
}
function stopReplayMode() {
  window.chart &&
    (window.chart.stopReplay(),
    (document.getElementById("replayControls").style.display = "none"),
    (document.getElementById("replayStartBtn").style.display = ""),
    window.calcIndicators && window.calcIndicators(),
    window._refreshOverlays && window._refreshOverlays());
}
let _forecastMode = !1,
  _forecastPoints = [];
function startForecast() {
  ((_forecastMode = "forecast"),
    (_forecastPoints = []),
    window.showToast(
      t(
        "\uCC28\uD2B8\uB97C \uD074\uB9AD\uD558\uC5EC \uC2DC\uC791\uC810 \u2192 \uBAA9\uD45C\uC810\uC744 \uCC0D\uC73C\uC138\uC694. \uB354\uBE14\uD074\uB9AD\uC73C\uB85C \uC644\uB8CC.",
      ),
      "#C4384B",
    ));
}
function startProjection() {
  ((_forecastMode = "projection"),
    (_forecastPoints = []),
    window.showToast(
      t(
        "\uCC28\uD2B8\uB97C \uD074\uB9AD\uD558\uC5EC \uACBD\uB85C \uD3EC\uC778\uD2B8\uB97C \uCC0D\uC73C\uC138\uC694. \uB354\uBE14\uD074\uB9AD\uC73C\uB85C \uC644\uB8CC.",
      ),
      "#A31540",
    ));
}
function clearForecast() {
  window.chart &&
    ((window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
      (e) => e.type !== "forecast" && e.type !== "projection",
    )),
    (window.chart._dirty = !0),
    (_forecastMode = !1),
    (_forecastPoints = []));
}
(window.chart &&
  window.chart.overlayCanvas &&
  (window.chart.overlayCanvas.addEventListener("click", function (e) {
    if (!_forecastMode || !window.chart) return;
    e.stopPropagation();
    const o = e.offsetX,
      i = e.offsetY,
      n = Math.round(window.chart.timeScale.xToBar(o)),
      s = window.chart.priceScale.yToPrice(i);
    (_forecastPoints.push({ index: n, price: s }),
      _forecastPoints.length >= 2 &&
        ((window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
          (r) => r._preview !== !0,
        )),
        window.chart.addDrawing({
          type: _forecastMode,
          points: [..._forecastPoints],
          _preview: !0,
        })),
      (window.chart._dirty = !0));
  }),
  window.chart.overlayCanvas.addEventListener("dblclick", function (e) {
    !_forecastMode ||
      _forecastPoints.length < 2 ||
      (e.stopPropagation(),
      e.preventDefault(),
      (window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
        (o) => o._preview !== !0,
      )),
      window.chart.addDrawing({
        type: _forecastMode,
        points: [..._forecastPoints],
      }),
      (window.chart._dirty = !0),
      window.showToast(t("\uC644\uB8CC"), "#C4384B"),
      (_forecastMode = !1),
      (_forecastPoints = []));
  })),
  (async () => {
    try {
      const o = (await window.api.get("/v1/site/notices")).data || [];
      if (((window._noticeCache = o), !o.length)) return;
      const i = JSON.parse(
          localStorage.getItem("chartOS_hiddenNotices") || "{}",
        ),
        n = JSON.parse(localStorage.getItem("chartOS_readNotices") || "[]"),
        s = Date.now();
      for (const [a, p] of Object.entries(i)) p < s && delete i[a];
      localStorage.setItem("chartOS_hiddenNotices", JSON.stringify(i));
      const r = o.find((a) => a.is_pinned);
      if (r) {
        const a = document.getElementById("noticeBannerText");
        a && (a.textContent = "\uACF5\uC9C0: " + r.title);
      }
    } catch {}
  })(),
  (window.showNoticePopup = function (o) {
    const i = String(o.id);
    let n = document.getElementById("noticePopup");
    (n ||
      ((n = document.createElement("div")),
      (n.id = "noticePopup"),
      (n.className = "notice-modal"),
      (n.onclick = (s) => {
        s.target === n && _closeNoticePopup(i);
      }),
      document.body.appendChild(n)),
      (n.innerHTML = `<div class="notice-modal-inner" style="max-width:420px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="color:#921230;font-size:14px">${o.is_pinned ? "[\uACF5\uC9C0] " : ""} ${_escHtml(o.title)}</h3>
      <span onclick="_closeNoticePopup('${i}')" style="cursor:pointer;color:var(--muted);font-size:14px;line-height:1;padding:4px">&#x2715;</span>
    </div>
    <div style="font-size:14px;color:#032129;line-height:1.6;margin-bottom:16px">${_escHtml(o.content).replace(/\n/g, "<br>")}</div>
    <div style="font-size:14px;color:#8E7D72;margin-bottom:12px">${o.created_at?.slice(0, 10) || ""}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button onclick="window._hideNotice('${i}',86400000)" style="flex:1;padding:8px;background:#F3ECE4;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#032129">\uC624\uB298 \uD558\uB8E8 \uBCF4\uC9C0 \uC54A\uAE30</button>
      <button onclick="window._hideNotice('${i}',604800000)" style="flex:1;padding:8px;background:#F3ECE4;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#032129">7\uC77C\uAC04 \uBCF4\uC9C0 \uC54A\uAE30</button>
      <button onclick="_closeNoticePopup('${i}')" style="flex:1;padding:8px;background:#921230;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">\uD655\uC778</button>
    </div>
  </div>`),
      n.classList.add("open"));
  }),
  (window._closeNoticePopup = function (e) {
    (markNoticeRead(String(e)),
      document.getElementById("noticePopup")?.classList.remove("open"));
  }),
  (window._hideNotice = function (e, o) {
    const i = String(e),
      n = JSON.parse(localStorage.getItem("chartOS_hiddenNotices") || "{}");
    ((n[i] = Date.now() + o),
      localStorage.setItem("chartOS_hiddenNotices", JSON.stringify(n)),
      markNoticeRead(i),
      document.getElementById("noticePopup")?.classList.remove("open"));
  }));
function showNoticeToast(e, o, i) {
  let n = document.querySelector(".toast-container");
  n ||
    ((n = document.createElement("div")),
    (n.className = "toast-container"),
    document.body.appendChild(n));
  const s = document.createElement("div");
  s.className = "toast";
  const r = (a) =>
    String(a || "").replace(
      /[&<>"']/g,
      (p) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[p],
    );
  ((s.innerHTML = `<div class="toast-title">${r(e)}</div>${r(o)}<span class="toast-close" onclick="event.stopPropagation();this.parentElement.remove()">\u2715</span>`),
    (s.onclick = () => {
      (i && markNoticeRead(i), s.remove(), showNoticeModal());
    }),
    n.appendChild(s),
    setTimeout(() => {
      s.parentElement &&
        ((s.style.animation = "toastOut 0.3s ease forwards"),
        setTimeout(() => s.remove(), 300));
    }, 8e3));
}
((window.showNoticeModal = async function () {
  let o = document.getElementById("noticeModal");
  (o ||
    ((o = document.createElement("div")),
    (o.id = "noticeModal"),
    (o.className = "notice-modal"),
    (o.onclick = (i) => {
      i.target === o && o.classList.remove("open");
    }),
    (o.innerHTML =
      '<div class="notice-modal-inner"><div id="noticeModalContent"></div></div>'),
    document.body.appendChild(o)),
    o.classList.add("open"));
  try {
    const n = (await window.api.get("/v1/site/notices")).data || [];
    window._noticeCache = n;
    const s = JSON.parse(localStorage.getItem("chartOS_readNotices") || "[]");
    document.getElementById("noticeModalContent").innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="color:#921230;font-size:14px">\uACF5\uC9C0\uC13C\uD130</h3><span onclick="document.getElementById('noticeModal').classList.remove('open')" style="cursor:pointer;color:var(--muted);font-size:14px">\u2715</span></div>` +
      (n.length
        ? n
            .map((r) => {
              const a = !s.includes(r.id);
              return `<div onclick="markNoticeRead('${r.id}');document.getElementById('noticeModal').classList.remove('open');const _n=window._noticeCache?.find(x=>x.id==='${r.id}');if(_n)showNoticePopup(_n)" style="padding:12px;margin-bottom:8px;background:#FFFDF9;border-radius:8px;border:1px solid ${a ? "#921230" : "rgba(216,182,106,0.25)"};cursor:pointer;box-shadow:0 1px 3px rgba(106,30,51,0.04)">
          <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:600;font-size:14px;color:#032129">${(r.is_pinned, "")} ${_escHtml(r.title)}</span>${a ? '<span style="background:#921230;color:#fff;font-size:14px;padding:2px 6px;border-radius:8px">NEW</span>' : ""}</div>
          <div style="font-size:14px;color:#8E7D72;margin-top:6px;line-height:1.5">${_escHtml(r.content).replace(/\\n/g, "<br>")}</div>
          <div style="font-size:14px;color:#8E7D72;margin-top:6px">${r.created_at?.slice(0, 10) || ""}</div></div>`;
            })
            .join("")
        : '<div style="color:#8E7D72;text-align:center;padding:24px">\uACF5\uC9C0 \uC5C6\uC74C</div>');
  } catch {}
}),
  (window.markNoticeRead = function (o) {
    const i = String(o),
      n = JSON.parse(localStorage.getItem("chartOS_readNotices") || "[]");
    n.includes(i) ||
      (n.push(i),
      localStorage.setItem("chartOS_readNotices", JSON.stringify(n)));
  }),
  (window.toggleMobilePanel = toggleMobilePanel));
function toggleMobilePanel(e) {
  const o = document.querySelector(".left"),
    i = document.querySelector(".right"),
    n = document.getElementById("mobileOverlay");
  !o ||
    !i ||
    !n ||
    (o.classList.remove("open"),
    i.classList.remove("open"),
    n.classList.remove("open"),
    document
      .querySelectorAll(".mobile-nav button")
      .forEach((s) => s.classList.remove("active")),
    e === "left"
      ? (o.classList.add("open"),
        n.classList.add("open"),
        document.getElementById("mnLeft")?.classList.add("active"))
      : e === "right"
        ? (i.classList.add("open"),
          n.classList.add("open"),
          document.getElementById("mnRight")?.classList.add("active"))
        : e === "tools"
          ? (document.getElementById("indDrawer")?.classList.add("open"),
            n.classList.add("open"),
            document
              .querySelector('[aria-label="\uB3C4\uAD6C"]')
              ?.classList.add("active"))
          : e === "settings"
            ? (window._showFeedback?.() || window.showAuth?.(),
              document
                .querySelector('[aria-label="\uC124\uC815"]')
                ?.classList.add("active"))
            : document.getElementById("mnChart")?.classList.add("active"));
}
((window._showFeedback = function () {
  let e = document.getElementById("feedbackModal");
  (e ||
    ((e = document.createElement("div")),
    (e.id = "feedbackModal"),
    (e.className = "notice-modal"),
    (e.onclick = (o) => {
      o.target === e && e.classList.remove("open");
    }),
    document.body.appendChild(e)),
    (e.innerHTML = `<div class="notice-modal-inner" style="max-width:380px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="color:#921230;font-size:14px">\uD53C\uB4DC\uBC31 / \uBC84\uADF8 \uB9AC\uD3EC\uD2B8</h3>
      <span onclick="document.getElementById('feedbackModal').classList.remove('open')" style="cursor:pointer;color:var(--muted);font-size:14px">\u2715</span>
    </div>
    <input id="fbEmail" placeholder="\uC774\uBA54\uC77C (\uC120\uD0DD)" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;margin-bottom:8px">
    <select id="fbCategory" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;margin-bottom:8px">
      <option value="feedback">\uD53C\uB4DC\uBC31</option><option value="bug">\uBC84\uADF8 \uB9AC\uD3EC\uD2B8</option><option value="feature">\uAE30\uB2A5 \uC694\uCCAD</option>
    </select>
    <textarea id="fbMessage" placeholder="\uB0B4\uC6A9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694" rows="4" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;resize:vertical;margin-bottom:8px"></textarea>
    <button id="fbSubmit" onclick="window._submitFeedback()" style="width:100%;padding:10px;background:#921230;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">\uC804\uC1A1</button>
  </div>`),
    e.classList.add("open"));
}),
  (window._submitFeedback = async function () {
    const e = document.getElementById("fbMessage")?.value?.trim();
    if (!e) {
      window.showToast(
        "\uB0B4\uC6A9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694",
        "#3B82F6",
      );
      return;
    }
    const o = document.getElementById("fbSubmit");
    ((o.textContent = "\uC804\uC1A1 \uC911..."), (o.disabled = !0));
    try {
      (
        await window.api.raw(API + "/v1/site/support", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("fbEmail")?.value || "",
            subject: document.getElementById("fbCategory")?.value || "feedback",
            message: e,
            category:
              document.getElementById("fbCategory")?.value || "feedback",
          }),
        })
      ).ok
        ? (window.showToast(
            "\uD53C\uB4DC\uBC31\uC774 \uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
            "#C4384B",
          ),
          document.getElementById("feedbackModal").classList.remove("open"))
        : window.showToast(
            "\uC804\uC1A1 \uC2E4\uD328. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694",
            "#3B82F6",
          );
    } catch {
      window.showToast("\uB124\uD2B8\uC6CC\uD06C \uC624\uB958", "#3B82F6");
    }
    ((o.textContent = "\uC804\uC1A1"), (o.disabled = !1));
  }),
  (window.showFaqCenter = async function () {
    let e = document.getElementById("faqModal");
    (e ||
      ((e = document.createElement("div")),
      (e.id = "faqModal"),
      (e.className = "notice-modal"),
      (e.onclick = (o) => {
        o.target === e && e.classList.remove("open");
      }),
      (e.innerHTML =
        '<div class="notice-modal-inner" style="max-width:500px"><div id="faqContent"></div></div>'),
      document.body.appendChild(e)),
      e.classList.add("open"));
    try {
      const i = (await window.api.get("/v1/site/faqs")).data || [];
      let n = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="color:#921230;font-size:14px">FAQ \xB7 \uB3C4\uC6C0\uB9D0</h3>
      <span onclick="document.getElementById('faqModal').classList.remove('open')" style="cursor:pointer;color:var(--muted);font-size:14px">\u2715</span>
    </div>
    <input id="faqSearch" placeholder="\uAC80\uC0C9..." oninput="document.querySelectorAll('.faq-item').forEach(f=>f.style.display=f.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')" style="width:100%;padding:8px 12px;background:#FFFDF9;border:1px solid rgba(216,182,106,0.3);border-radius:6px;color:#032129;font-size:14px;margin-bottom:12px;outline:none">`;
      (i.length
        ? (n += i
            .map(
              (s) => `<div class="faq-item" style="margin-bottom:6px">
        <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block';this.querySelector('span').textContent=this.nextElementSibling.style.display==='block'?'\u2212':'+'" style="padding:10px 12px;background:#FFFDF9;border:1px solid rgba(216,182,106,0.25);border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:600;color:#032129">${_escHtml(s.question)}</span>
          <span style="color:#D8B66A;font-size:14px;font-weight:700;flex-shrink:0;margin-left:8px">+</span>
        </div>
        <div style="display:none;padding:10px 12px;font-size:14px;color:#8E7D72;line-height:1.6;border-left:2px solid #D8B66A;margin:4px 0 4px 12px">${_escHtml(s.answer).replace(/\n/g, "<br>")}</div>
      </div>`,
            )
            .join(""))
        : (n +=
            '<div style="color:#8E7D72;text-align:center;padding:24px">FAQ\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4</div>'),
        (n += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(216,182,106,0.2);text-align:center">
      <button onclick="window._showSupport();document.getElementById('faqModal').classList.remove('open')" style="padding:8px 20px;background:#921230;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">\uBB38\uC758\uD558\uAE30</button>
      <button onclick="window._startTour&&_startTour();document.getElementById('faqModal').classList.remove('open')" style="padding:8px 20px;background:#F3ECE4;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#032129;margin-left:6px">\uD035 \uD22C\uC5B4 \uB2E4\uC2DC \uBCF4\uAE30</button>
    </div>`),
        (document.getElementById("faqContent").innerHTML = n));
    } catch {}
  }),
  (function () {
    let e = 0,
      o = 0;
    (document.addEventListener(
      "touchstart",
      (i) => {
        ((e = i.touches[0].clientX), (o = i.touches[0].clientY));
      },
      { passive: !0 },
    ),
      document.addEventListener(
        "touchend",
        (i) => {
          if (window.innerWidth > 768) return;
          const n = i.changedTouches[0].clientX - e,
            s = i.changedTouches[0].clientY - o;
          if (Math.abs(n) < 60 || Math.abs(s) > Math.abs(n)) return;
          const r = document.querySelector(".left"),
            a = document.querySelector(".right"),
            p = document.getElementById("mobileOverlay");
          n > 0 && e < 40
            ? (r.classList.add("open"), p.classList.add("open"))
            : n < 0 && e > window.innerWidth - 40
              ? (a.classList.add("open"), p.classList.add("open"))
              : n < 0 && r.classList.contains("open")
                ? (r.classList.remove("open"), p.classList.remove("open"))
                : n > 0 &&
                  a.classList.contains("open") &&
                  (a.classList.remove("open"), p.classList.remove("open"));
        },
        { passive: !0 },
      ));
  })(),
  "serviceWorker" in navigator &&
    (navigator.serviceWorker
      .getRegistrations()
      .then((e) => {
        for (const o of e) o.unregister().catch(() => {});
      })
      .catch(() => {}),
    "caches" in self &&
      caches
        .keys()
        .then((e) => {
          for (const o of e) caches.delete(o).catch(() => {});
        })
        .catch(() => {})),
  (function () {
    function n() {
      return (
        "chartOS_tour" + (typeof userId < "u" && userId ? "_" + userId : "")
      );
    }
    function s() {
      try {
        const d = JSON.parse(localStorage.getItem(n()) || "{}");
        return d.done && !d.version
          ? { version: 2, completed_at: Date.now() }
          : d.until && !d.version
            ? { version: 2, snooze_until: d.until }
            : d;
      } catch {
        return {};
      }
    }
    function r(d) {
      localStorage.setItem(n(), JSON.stringify(d));
    }
    async function a() {
      try {
        return (
          await window.api.get(
            (typeof API < "u" ? API : "") + "/v1/charts/server-time",
          )
        ).data.ts;
      } catch {
        return Date.now();
      }
    }
    function p() {
      if (window.isPremium && window.isPremium()) return !1;
      const d = s();
      return !(
        (d.version >= 2 && d.completed_at) ||
        (d.version >= 2 && d.snooze_until && d.snooze_until > Date.now())
      );
    }
    p() &&
      (window._startTour = function () {
        const d = [
          {
            el: "#chartWrap",
            text:
              "<b>" +
              t("\uC2E4\uC2DC\uAC04 \uCC28\uD2B8") +
              "</b><br>" +
              (window.BeomApp?.stats?.fill(
                "{\uCF54\uC778\uC218}\uAC1C \uC554\uD638\uD654\uD3D0\uB97C {\uD0C0\uC784\uD504\uB808\uC784\uC218}\uAC1C \uD0C0\uC784\uD504\uB808\uC784\uC73C\uB85C \uC2E4\uC2DC\uAC04 \uBD84\uC11D",
              ) || "\uC2E4\uC2DC\uAC04 \uCC28\uD2B8 \uBD84\uC11D"),
            pos: "bottom",
          },
          {
            el: "#watchlist",
            text:
              "<b>" +
              t("\uC6CC\uCE58\uB9AC\uC2A4\uD2B8") +
              "</b><br>" +
              t(
                "\uAD00\uC2EC \uCF54\uC778\uC744 \uD074\uB9AD\uD558\uBA74 \uC989\uC2DC \uCC28\uD2B8\uAC00 \uC804\uD658\uB429\uB2C8\uB2E4",
              ),
            pos: "right",
          },
          {
            el: '[data-p="ai"]',
            text:
              "<b>" +
              t("AI \uBD84\uC11D") +
              "</b><br>" +
              t(
                "AI\uAC00 \uCC28\uD2B8\uB97C \uBD84\uC11D\uD558\uACE0 \uB9E4\uB9E4 \uC2DC\uC810\uC744 \uC81C\uC548\uD569\uB2C8\uB2E4",
              ),
            pos: "left",
          },
          {
            el: '[data-p="alerts"]',
            text:
              "<b>" +
              t("\uC54C\uB9BC") +
              "</b><br>" +
              t(
                "\uBAA9\uD45C \uAC00\uACA9\uC5D0 \uB3C4\uB2EC\uD558\uBA74 \uC989\uC2DC \uC54C\uB824\uB4DC\uB9BD\uB2C8\uB2E4",
              ),
            pos: "left",
          },
          {
            el: null,
            text: window.isLoggedIn()
              ? "<b>" +
                t("\uAC70\uB798\uC18C \uC778\uC99D") +
                "</b> " +
                t("\uC73C\uB85C VIP \uAE30\uB2A5 \uC774\uC6A9 \uAC00\uB2A5!")
              : "<b>" +
                t("\uD68C\uC6D0\uAC00\uC785") +
                "</b> " +
                t(
                  "\uD6C4 \uAC70\uB798\uC18C \uC778\uC99D\uD558\uBA74 VIP \uAE30\uB2A5 \uC774\uC6A9 \uAC00\uB2A5!",
                ),
            pos: "center",
            cta: !0,
          },
        ];
        let w = 0;
        const y = document.createElement("div");
        ((y.id = "tourOverlay"),
          (y.style.cssText =
            "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(61,43,31,0.4);z-index:9998;transition:opacity 0.3s"),
          document.body.appendChild(y));
        const u = document.createElement("div");
        ((u.style.cssText =
          "position:fixed;border:2px solid #D8B66A;border-radius:8px;z-index:9999;pointer-events:none;transition:all 0.3s ease;box-shadow:0 0 0 9999px rgba(61,43,31,0.5)"),
          document.body.appendChild(u));
        const c = document.createElement("div");
        ((c.style.cssText =
          "position:fixed;background:#FFFDF9;border:1px solid rgba(216,182,106,0.3);color:#032129;padding:16px;border-radius:10px;font-size:14px;max-width:320px;z-index:10000;box-shadow:0 8px 24px rgba(106,30,51,0.12);line-height:1.6"),
          document.body.appendChild(c));
        function x() {
          (y.remove(), u.remove(), c.remove());
        }
        function h() {
          if (w >= d.length) {
            (x(), r({ version: 2, completed_at: Date.now() }));
            return;
          }
          const f = d[w],
            v = d.length,
            S = d
              .map(
                (_, l) =>
                  `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${l === w ? "#921230" : "#E8DDD0"};margin:0 2px"></span>`,
              )
              .join("");
          let k;
          if (
            (f.cta
              ? (k = `<div style="margin-top:12px">
          <button onclick="${window.isLoggedIn() ? "showExchangeVerify()" : "showAuth()"};_completeTour()" style="width:100%;padding:10px;background:#921230;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;margin-bottom:6px">${window.isLoggedIn() ? t("\uAC70\uB798\uC18C \uC778\uC99D \uC694\uCCAD") : t("\uD68C\uC6D0\uAC00\uC785 / \uB85C\uADF8\uC778")}</button>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button onclick="_skipTour()" style="flex:1;padding:5px;background:#F3ECE4;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#8E7D72">${t("\uAC74\uB108\uB6F0\uAE30")}</button>
            <button onclick="_snoozeTour(86400000)" style="flex:1;padding:5px;background:#F3ECE4;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#8E7D72">${t("\uC624\uB298\uB9CC \uB2EB\uAE30")}</button>
            <button onclick="_snoozeTour(604800000)" style="flex:1;padding:5px;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;color:#b08d57">${t("1\uC8FC\uC77C\uAC04 \uC548 \uBCF4\uAE30")}</button>
          </div></div>`)
              : (k = `<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center">
          <div>${S}</div>
          <div style="display:flex;gap:4px;align-items:center">
            <button onclick="_skipTour()" style="padding:4px 8px;background:none;border:1px solid var(--border);color:#8E7D72;border-radius:5px;cursor:pointer;font-size:14px">${t("\uAC74\uB108\uB6F0\uAE30")}</button>
            <button onclick="_nextTour()" style="padding:4px 10px;background:#921230;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:14px;font-weight:600">${w < v - 1 ? t("\uB2E4\uC74C \u2192") : t("\uC2DC\uC791\uD558\uAE30")}</button>
          </div></div>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button onclick="_snoozeTour(86400000)" style="flex:1;padding:3px;background:none;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px;color:#8E7D72">${t("\uC624\uB298\uB9CC \uB2EB\uAE30")}</button>
            <button onclick="_snoozeTour(604800000)" style="flex:1;padding:3px;background:none;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px;color:#b08d57">${t("1\uC8FC\uC77C\uAC04 \uC548 \uBCF4\uAE30")}</button>
          </div></div>`),
            (c.innerHTML = `<div>${f.text}</div>${k}`),
            !f.el)
          )
            ((u.style.display = "none"),
              (c.style.left = "50%"),
              (c.style.top = "50%"),
              (c.style.transform = "translate(-50%,-50%)"),
              (c.style.maxHeight = "80vh"),
              (c.style.overflowY = "auto"));
          else {
            const _ = document.querySelector(f.el);
            if (!_) {
              (w++, h());
              return;
            }
            const l = _.getBoundingClientRect();
            ((u.style.display = "block"),
              (u.style.left = l.left - 4 + "px"),
              (u.style.top = l.top - 4 + "px"),
              (u.style.width = l.width + 8 + "px"),
              (u.style.height = l.height + 8 + "px"),
              (c.style.transform = "none"));
            const E = c.getBoundingClientRect(),
              I = E.width || 320,
              L = E.height || 200,
              b = 12;
            let m, g;
            (f.pos === "right"
              ? ((m = l.right + b), (g = l.top))
              : f.pos === "left"
                ? ((m = l.left - I - b), (g = l.top))
                : f.pos === "top"
                  ? ((m = l.left), (g = l.top - L - b))
                  : ((m = l.left), (g = l.bottom + b)),
              (m = Math.max(8, Math.min(m, window.innerWidth - I - 8))),
              (g = Math.max(8, Math.min(g, window.innerHeight - L - 8))),
              (c.style.left = m + "px"),
              (c.style.top = g + "px"),
              (c.style.maxHeight = window.innerHeight - 16 + "px"),
              (c.style.overflowY = "auto"));
          }
        }
        ((window._nextTour = function () {
          (w++, h());
        }),
          (window._skipTour = function () {
            x();
          }),
          (window._completeTour = function () {
            (x(), r({ version: 2, completed_at: Date.now() }));
          }),
          (window._snoozeTour = async function (f) {
            x();
            var v = await a();
            r({ version: 2, snooze_until: v + (f || 6048e5) });
          }),
          h());
      });
  })(),
  (window._modal = _modal),
  (function () {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const o = document.querySelector(
        '.notice-modal.open, #helpPanel[style*="display: flex"], #authModal[style*="display: flex"], #feedbackModal.open, #supportModal[style*="display: flex"]',
      );
      o &&
        (o.classList.contains("open")
          ? o.classList.remove("open")
          : (o.style.display = "none"),
        e.stopPropagation());
    });
  })());
