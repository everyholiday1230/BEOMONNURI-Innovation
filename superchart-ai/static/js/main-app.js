import { ChartCore as mt } from "/static/chart-engine/chart-engine.js";
import {
  symbols as ze,
  _apiMap as He,
  loadSymbolsFromDB as ro,
  renderWL as Qe,
  loadWLPrices as so,
} from "./modules/watchlist.js";
import {
  renderRealtimeUI as Ge,
  updatePriceDisplay as Et,
} from "./modules/realtime.js";
import {
  escHtml as lo,
  showToast as X,
  fmtPrice as Ye,
} from "./modules/utils.js";
import "./modules/subscribe.js";
import "./modules/fetch-csrf.js";
import "./modules/strategy.js";
import { dedupFetch as q } from "./modules/fetch.js";
const t = window.t || ((s) => s);
((window.isLoggedIn = G),
  (window.isPremium = Z),
  (window.getAuthToken = Ze),
  (window.isAdmin = Tt),
  (window.buildAuthHeaders = Me),
  (window.clearAuthState = Oe),
  (window.refreshAuthState = Dt),
  (window.ChartCore = mt),
  (window.COS = window.COS || {
    auth: { token: null, userId: null, tier: "guest", role: "user" },
    features: { bimacoDelay: !0, realtimeBimaco: !1 },
    version: "20260504",
  }));
function C(e) {
  return (
    document.querySelector(`[data-ind="${e}"]`)?.classList.contains("on") || !1
  );
}
function J(e) {
  return !!(
    document.querySelector(`[data-sub="${e}"].on`) ||
    document.querySelector(`.sub-ind[data-sub="${e}"].on`)
  );
}
function $t() {
  return (
    typeof window._compVars < "u" &&
    Object.values(window._compVars).some(function (e) {
      return e === !0;
    })
  );
}
var qe = null,
  Ve = null,
  $e = "free";
const co = "5m";
function Ze() {
  return qe || null;
}
function G() {
  return !!Ze();
}
function Yo() {
  return Z();
}
function Tt() {
  return COS.auth.role === "admin";
}
function Me() {
  return {};
}
function Oe(e) {
  ((qe = null),
    (Ve = null),
    ($e = "free"),
    (window.authToken = null),
    (window.userName = null),
    (() => {
      try {
        localStorage.removeItem("userName");
      } catch {}
    })(),
    (window.userPlan = "free"),
    (COS.auth = { token: null, userId: null, tier: "guest", role: "user" }),
    (COS.features.realtimeBimaco = !1),
    (COS.features.bimacoDelay = !0));
  const n = document.getElementById("userBadge");
  n && (n.textContent = t("\uB85C\uADF8\uC778"));
  const a = document.getElementById("logoutBtn");
  a && (a.style.display = "none");
  const r = document.getElementById("settingsBtn");
  r && (r.style.display = "none");
  const i = document.getElementById("loginCta");
  if ((i && (i.style.display = ""), e?.resetChart)) {
    (localStorage.removeItem("chartOS_presetVer"),
      localStorage.removeItem("chartOS_indSettings"),
      localStorage.removeItem("chartOS_customMA"),
      localStorage.removeItem("chartOS_customSUB"),
      document
        .querySelectorAll(".ind-tag.on,.sub-ind.on")
        .forEach((y) => y.classList.remove("on")),
      typeof Q < "u" && (Q = !1),
      typeof oe < "u" && (oe = !1),
      typeof Ce < "u" && (Ce = !1),
      typeof ne < "u" && (ne = !1),
      typeof se < "u" && (se = !1),
      typeof le < "u" && (le = !1),
      typeof be < "u" && (be = !1),
      typeof Se < "u" && (Se = !1),
      typeof ye < "u" && (ye = !1),
      typeof ie < "u" && (ie = !1),
      typeof me < "u" && (me = !1),
      typeof Ae < "u" && (Ae = !1),
      typeof window.showBimacoTP < "u" && (window.showBimacoTP = !1),
      typeof de < "u" && (de = !1),
      typeof ce < "u" && (ce = !1),
      typeof ue < "u" && (ue = !1),
      typeof fe < "u" && (fe = !1),
      typeof ge < "u" && (ge = !1),
      typeof ae < "u" && (ae = []),
      typeof window._btpCache < "u" && (window._btpCache = null));
    try {
      _btpCache = null;
    } catch {}
    try {
      _btpLastIdx = -1;
    } catch {}
    try {
      _btpCacheKey = null;
    } catch {}
    (typeof o < "u" &&
      o &&
      ((o._uc = null), (o._bc = null), (o._uf = null), (o._dirty = !0)),
      typeof Y == "function" && Y(),
      typeof U == "function" && U());
  }
  try {
    const y = document.getElementById("beomAlertList");
    y && (y.innerHTML = "");
    const f = document.getElementById("alertList");
    f && (f.innerHTML = "");
    const m = document.getElementById("alertHistoryList");
    m && (m.innerHTML = "");
  } catch {}
  e?.reload && setTimeout(() => location.reload(), 500);
}
async function Dt(e) {
  if (
    (window.authToken && !qe && (qe = window.authToken),
    !(
      /(?:^|;\s*)csrf_token=/.test(document.cookie || "") ||
      /(?:^|;\s*)auth_token=/.test(document.cookie || "")
    ) && !e)
  ) {
    Oe();
    return;
  }
  try {
    const b = await _origFetch("/v1/auth/me");
    if (!b.ok) {
      Oe();
      return;
    }
    const v = await b.json();
    if (!v.data) {
      Oe();
      return;
    }
    ((Ve = v.data.nickname),
      ($e = v.data.tier || "free"),
      (window._beomAllowed = !!v.data.beom_allowed),
      (window._purchased = v.data.purchased || []),
      (window.authToken = "cookie"),
      (window.userName = Ve),
      (() => {
        try {
          if (Ve) {
            var _prev = localStorage.getItem("userName");
            localStorage.setItem("userName", Ve);
            // [FIX] 인증 완료 전(guest 시점)에 이미 _loadUserSettings가 1회 돌았을 수 있다.
            // 실제 로그인 유저가 확정됐고 직전 값과 다르면, 실유저 키로 설정을 다시 로드한다.
            if (_prev !== Ve && typeof window._loadUserSettings === "function") {
              window._loadUserSettings();
              // 복원된 지표 설정을 화면에 반영: 차트가 준비됐으면 지표 재계산.
              // (calcIndicators는 코드 전반에서 인자 없이 호출되는 안전한 갱신 경로)
              try {
                if (window.chart && typeof window.calcIndicators === "function") {
                  window.calcIndicators();
                }
              } catch (_) {}
            }
          }
        } catch {}
      })(),
      (window.userPlan = $e),
      (qe = "cookie"),
      (window.authToken = "cookie"));
  } catch {
    Oe();
    return;
  }
  ((COS.auth.tier = $e),
    (COS.auth.role = "user"),
    (COS.features.realtimeBimaco = Z()),
    (COS.features.bimacoDelay = !Z()));
  const r = $e === "premium" ? "VVIP" : Z() ? "VIP" : "",
    i = document.getElementById("userBadge");
  i && (i.textContent = (Ve || "") + (r ? " " + r : ""));
  const y = document.getElementById("logoutBtn");
  y && (y.classList.remove("d-none"), (y.style.display = ""));
  const f = document.getElementById("settingsBtn");
  f && (f.classList.remove("d-none"), (f.style.display = ""));
  const m = document.getElementById("loginCta");
  if ((m && (m.style.display = "none"), Tt())) {
    const b = document.getElementById("adminTools");
    b && (b.style.display = "block");
  }
  (Co(),
    window._initBeomAlertPanel && window._initBeomAlertPanel(),
    window._loadBeomAlerts && window._loadBeomAlerts(),
    window._renderFavSymbols && window._renderFavSymbols());
  try {
    typeof to == "function" &&
      typeof o < "u" &&
      o &&
      setTimeout(
        () =>
          to().catch((b) => {
            window.showToast &&
              X("\uC124\uC815 \uBCF5\uC6D0 \uC2E4\uD328", "#3B82F6");
          }),
        1500,
      );
  } catch {}
}
function Mt(e) {
  document.querySelectorAll(".tb[data-tf]").forEach((n) => {
    n.classList.toggle("active", n.dataset.tf === e);
  });
}
function Ft(e, n) {
  if (e && ((A = e), (window.curTf = e), Mt(e), !n?.skipLoad)) {
    const _manualBeforeTf =
      o && o.overlay && Array.isArray(o.overlay.drawings)
        ? o.overlay.drawings.filter((d) =>
            ["hline", "vline", "trendline", "fib", "text"].includes(d?.type),
          )
        : [];

    if (o) {
      o._uc = null;
      o._bc = null;
      o._uf = null;
      o._vpData = null;
      o._ichiCloud = null;
      if (o.overlay) {
        o.overlay.drawings = o.overlay.drawings.filter(
          (d) =>
            (!d._calcOwner || d._calcOwner === "ba2") &&
            !d._autoTrend &&
            !d._ob &&
            !d._alertLine &&
            d.type !== "signal" &&
            d.type !== "ob" &&
            d.type !== "ttr" &&
            d.type !== "buy_scan" &&
            d.type !== "strategy_signal" &&
            d.type !== "div_zone" &&
            d.type !== "ob_entry" &&
            d.type !== "autobot_entry" &&
            d.type !== "autobot_marker" &&
            d.type !== "demo_action" &&
            d.type !== "forecast" &&
            d.type !== "projection",
        );
      }
      o._dirty = true;
    }
    if (
      ((window._deP = De()) &&
        window._deP.then &&
        window._deP.then(() => {
          try {
            if (o && o.overlay) {
              o.overlay.drawings = o.overlay.drawings.filter(
                (d) =>
                  !["hline", "vline", "trendline", "fib", "text"].includes(
                    d.type,
                  ),
              );
            }
            window._loadDrawings && window._loadDrawings();

            // 복원 실패/누락 시 기존 수동 드로잉 안전 복원
            if (
              o &&
              o.overlay &&
              Array.isArray(o.overlay.drawings) &&
              _manualBeforeTf.length
            ) {
              const restored = o.overlay.drawings.filter((d) =>
                ["hline", "vline", "trendline", "fib", "text"].includes(d?.type),
              );
              if (!restored.length && typeof o.addDrawing === "function") {
                _manualBeforeTf.forEach((d) => {
                  try {
                    o.addDrawing(d);
                  } catch {}
                });
              }
            }
            o && (o._dirty = !0);
          } catch {}
        }),
      N && N.readyState === 1)
    ) {
      const a = [];
      (window._lastWsSub && a.push(window._lastWsSub),
        window._lastWsTickerSub && a.push(window._lastWsTickerSub),
        a.length &&
          N.send(JSON.stringify({ action: "unsubscribe", channels: a })),
        (window._lastWsSub = { name: "candle", symbolId: B, timeframe: A }),
        (window._lastWsTickerSub = { name: "ticker", symbolId: B }),
        N.send(
          JSON.stringify({
            action: "subscribe",
            channels: [window._lastWsSub, window._lastWsTickerSub],
          }),
        ));
    }
    (z(),
      window._autobotActive &&
        typeof window._autobotRun == "function" &&
        (clearTimeout(window._autobotRerunTimer),
        (window._autobotRerunTimer = setTimeout(
          () => window._autobotRun(!0),
          500,
        ))));
  }
}
const F = "";
window.API = F;
var B = "SNDKUSDT",
  A = "5m";
((window.curSymbol = B),
  (window.curTf = A),
  Object.defineProperty(window, "curSymbol", {
    get() {
      return B;
    },
    set(e) {
      B = e;
    },
    configurable: !0,
  }));
var o = null,
  N = null;
function j(e) {
  return !e || (e.id === wt && e.symbol === B && e.timeframe === A);
}
function et() {
  const e = document.getElementById("splashScreen");
  e && (e.classList.add("hide"), setTimeout(() => e.remove(), 600));
}
function Lt() {
  !o ||
    typeof o.resize != "function" ||
    requestAnimationFrame(() => {
      try {
        (o.resize(), (o._dirty = !0));
      } catch {}
    });
}
function yt(e, n) {
  if (o) {
    try {
      o.loadBars([]);
    } catch {}
    try {
      o.clearDrawings();
    } catch {}
    ((o.indicators = {}),
      (o.subCharts = {}),
      (o._uc = null),
      (o._bc = null),
      (o._uf = null),
      (o._watermark = (e || B || "").replace("USDT", "")),
      (o._dirty = !0));
  }
  const a = document.getElementById("chartLoading");
  (a && ((a.style.display = n ? "block" : "none"), n && (a.textContent = n)),
    Lt());
}
let gt = null;
function Pt() {
  gt ||
    (gt = setTimeout(() => {
      gt = null;
      const e = document.querySelector(".right-tab.active")?.dataset.p;
      e === "ai"
        ? (no(), G() && requestAI())
        : e === "mtf"
          ? loadMTF()
          : e === "heatmap" && loadHeatmap();
    }, 1e3));
}
let qt = localStorage.getItem("chartOS_chartType") || "candle",
  Re = !1;
((window.setChartType = function (e) {
  ((qt = e),
    localStorage.setItem("chartOS_chartType", e),
    o && o.candleRenderer && (o.candleRenderer._chartType = e),
    E && E.candleRenderer && (E.candleRenderer._chartType = e),
    o && (o._dirty = !0),
    E && (E._dirty = !0));
}),
  (window.toggleFullscreen = function () {
    ((Re = !Re),
      (document.querySelector(".left").style.display = Re ? "none" : ""),
      (document.querySelector(".right").style.display = Re ? "none" : ""),
      (document.getElementById("fsBtn").textContent = Re
        ? "\uCD95\uC18C"
        : "\uC804\uCCB4\uD654\uBA74"),
      document.getElementById("fsBtn").classList.toggle("active", Re),
      setTimeout(() => {
        (o && o.resize && o.resize(), E && E.resize && E.resize());
      }, 100));
  }));
function uo() {
  ((o = new mt(document.getElementById("chartWrap"))),
    (window.chart = o),
    qt !== "candle" &&
      (o.candleRenderer && (o.candleRenderer._chartType = qt),
      (o._dirty = !0),
      (() => {
        const _ct = document.getElementById("chartTypeSelect");
        _ct && (_ct.value = qt);
      })()),
    o.overlayCanvas.addEventListener("mousemove", (e) => {}),
    vo(),
    (o.onSubClose = function (e) {
      const n = {
        rsi: "rsi",
        macd: "macd",
        stoch: "stoch",
        adx: "adx",
        atr: "atr",
        cmf: "cmf",
        roc: "roc",
        imacd: "imacd",
        wr: "wr",
        cci: "cci",
        mfi: "mfi",
        _u: "_u",
        udstoch: "udstoch",
        rsimfi: "rsimfi",
        stc: "stc",
        pasrpvi: "pasrpvi",
      };
      for (const [a, r] of Object.entries(n))
        if (e === a || e === r) {
          const i =
            document.querySelector(`[data-ind="${r}"]`) ||
            document.querySelector(`[data-sub="${a}"]`);
          i && i.classList.contains("on") && i.click();
          return;
        }
      (e.startsWith("csub_") &&
        ((window._customSUB = (window._customSUB || []).filter(
          (a) => a.id !== e,
        )),
        Le(),
        Ne()),
        o.removeSubChart(e));
    }),
    (o.onSubSettings = function (e, n) {
      const a = o.subCharts[e];
      if (!a || !a.lines || !a.lines.length) return;
      let r = `<div style="font-weight:600;margin-bottom:8px;font-size:14px">${a.label || e} \uC124\uC815</div>`;
      (a.lines.forEach((y, f) => {
        const m = y.color || "#D8B66A",
          b = y.lineWidth || 1;
        r += `<div style="display:flex;align-items:center;gap:6px;margin:4px 0">
        <span style="font-size:14px;color:var(--muted);width:40px">\uC120${f + 1}</span>
        <input type="color" value="${m}" data-li="${f}" data-prop="color" style="width:28px;height:20px;border:none;cursor:pointer">
        <input type="range" min="0.5" max="4" step="0.5" value="${b}" data-li="${f}" data-prop="lw" style="width:60px">
        <span style="font-size:14px;color:var(--muted)">${b}px</span>
      </div>`;
      }),
        (r += `<button onclick="this.parentElement.style.display='none'" style="margin-top:8px;padding:4px 12px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">\uB2EB\uAE30</button>`));
      let i = document.getElementById("subSettingsPop");
      (i ||
        ((i = document.createElement("div")),
        (i.id = "subSettingsPop"),
        (i.style.cssText =
          "position:fixed;z-index:9999;background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:8px;padding:12px;min-width:200px;box-shadow:0 8px 24px rgba(106,30,51,0.1);color:var(--text);font-size:14px"),
        document.body.appendChild(i)),
        (i.innerHTML = r),
        (i.style.display = "block"),
        (i.style.left = Math.min(n.clientX, window.innerWidth - 220) + "px"),
        (i.style.top = Math.min(n.clientY, window.innerHeight - 200) + "px"),
        i.querySelectorAll("input").forEach((y) => {
          y.addEventListener("input", function () {
            const f = parseInt(this.dataset.li),
              m = a.lines[f];
            m &&
              (this.dataset.prop === "color" && (m.color = this.value),
              this.dataset.prop === "lw" &&
                ((m.lineWidth = parseFloat(this.value)),
                (this.nextElementSibling.textContent = this.value + "px")),
              (o._dirty = !0));
          });
        }));
    }));
}
function O(e, n) {
  if (!e || !e.length || !Number.isFinite(n) || n <= 0) return [];
  let a = -1;
  for (let y = 0; y < e.length; y++)
    if (Number.isFinite(e[y])) {
      a = y;
      break;
    }
  if (a < 0) return new Array(e.length).fill(NaN);
  const r = 2 / (n + 1),
    i = new Array(e.length);
  for (let y = 0; y < a; y++) i[y] = NaN;
  i[a] = e[a];
  for (let y = a + 1; y < e.length; y++) {
    const f = e[y];
    Number.isFinite(f) && Number.isFinite(i[y - 1])
      ? (i[y] = r * f + (1 - r) * i[y - 1])
      : (i[y] = i[y - 1]);
  }
  return i;
}
function Y() {
  if (!o || o.buffer.length < 2) return;
  if (!G()) {
    // 비로그인: 모든 지표 강제 OFF + 차트 비우기
    document
      .querySelectorAll(".ind-tag.on,.sub-ind.on")
      .forEach((s) => s.classList.remove("on"));
    for (const k of Object.keys(o.indicators || {})) o.removeIndicator(k);
    if (o.subCharts)
      for (const k of Object.keys(o.subCharts)) o.removeSubChart?.(k);
    o._uc = null;
    o._bc = null;
    o._uf = null;
    o._dirty = true;
    if (typeof Te === "function") Te();
    return;
  }
  (Z() ||
    (document
      .querySelectorAll(".ind-tag.pro-ind.on,.sub-ind.pro-ind.on")
      .forEach((s) => s.classList.remove("on")),
    o.subCharts &&
      ["kvo", "master", "udrsi", "udstoch", "rsimfi", "stc", "pasr"].forEach(
        (s) => {
          o.subCharts[s] && o.removeSubChart(s);
        },
      ),
    (o.overlay.drawings = o.overlay.drawings.filter(
      (s) =>
        !s._autoTrend && !s._ob && (!s._calcOwner || s._calcOwner === "ba2"),
    )),
    typeof Q < "u" && (Q = !1),
    typeof oe < "u" && (oe = !1),
    typeof ne < "u" && (ne = !1),
    typeof le < "u" && (le = !1),
    typeof ie < "u" && (ie = !1),
    typeof me < "u" && (me = !1),
    typeof window.showBimacoTP < "u" && (window.showBimacoTP = !1),
    typeof he < "u" && (he = !1),
    (o._uc = null),
    (o._bc = null),
    (o._dirty = !0)),
    G() ||
      (document
        .querySelectorAll(".ind-tag.member-ind.on")
        .forEach((s) => s.classList.remove("on")),
      typeof se < "u" && (se = !1),
      typeof we < "u" && (we = !1)));
  for (const s of Object.keys(o.indicators))
    s.startsWith("darak_ma") || o.removeIndicator(s);
  ((o.showVolume = C("vol")),
    (o.overlay.drawings = o.overlay.drawings.filter(
      (s) => !(s._calcOwner === "pivot" || s._calcOwner === "vp"),
    )));
  const e = [],
    n = [],
    a = [],
    r = [];
  for (let s = 0; s < o.buffer.length; s++)
    (e.push(o.buffer.close[s]),
      n.push(o.buffer.high[s]),
      a.push(o.buffer.low[s]),
      r.push(o.buffer.volume[s]));
  function i(s, l) {
    if (!s || !s.length || !Number.isFinite(l) || l <= 0) return [];
    const d = [];
    let p = 0,
      c = 0;
    for (let u = 0; u < s.length; u++) {
      const g = s[u];
      if ((Number.isFinite(g) && ((p += g), c++), u >= l)) {
        const w = s[u - l];
        Number.isFinite(w) && ((p -= w), c--);
      }
      d.push(
        c >= Math.min(l, u + 1)
          ? p / Math.min(l, c)
          : Number.isFinite(g)
            ? g
            : NaN,
      );
    }
    return d;
  }
  if (C("ema9")) {
    const s = S("ema9", "period", 9),
      l = O(e, s);
    o.setIndicator(
      "ema9",
      l.map((d, p) => ({ index: p, value: d })),
      S("ema9", "color", "#8E7D72"),
      S("ema9", "width", 1),
    );
  }
  if (C("ema20")) {
    const s = S("ema20", "period", 20),
      l = O(e, s);
    o.setIndicator(
      "ema20",
      l.map((d, p) => ({ index: p, value: d })),
      S("ema20", "color", "#D8B66A"),
      S("ema20", "width", 1),
    );
  }
  if (C("ema50")) {
    const s = S("ema50", "period", 50),
      l = O(e, s);
    o.setIndicator(
      "ema50",
      l.map((d, p) => ({ index: p, value: d })),
      S("ema50", "color", "#A31540"),
      S("ema50", "width", 1),
    );
  }
  if (C("ema200") && e.length >= 200) {
    const s = S("ema200", "period", 200),
      l = O(e, s);
    o.setIndicator(
      "ema200",
      l.map((d, p) => ({ index: p, value: d })),
      S("ema200", "color", "#3B82F6"),
      S("ema200", "width", 2),
    );
  }
  if (C("sma50")) {
    const s = S("sma50", "period", 50),
      l = i(e, s);
    o.setIndicator(
      "sma50",
      l.map((d, p) => ({ index: p, value: d })),
      S("sma50", "color", "#A31540"),
      S("sma50", "width", 1),
    );
  }
  if (C("sma200") && e.length >= 200) {
    const s = S("sma200", "period", 200),
      l = i(e, s);
    o.setIndicator(
      "sma200",
      l.map((d, p) => ({ index: p, value: d })),
      S("sma200", "color", "#3B82F6"),
      S("sma200", "width", 1),
    );
  }
  if (C("wma20")) {
    const s = S("wma20", "period", 20),
      l = [];
    for (let d = 0; d < e.length; d++) {
      if (d < s - 1) {
        l.push(e[d]);
        continue;
      }
      let p = 0,
        c = 0;
      for (let u = 0; u < s; u++) ((p += e[d - u] * (s - u)), (c += s - u));
      l.push(p / c);
    }
    o.setIndicator(
      "wma20",
      l.map((d, p) => ({ index: p, value: d })),
      S("wma20", "color", "#8E7D72"),
      S("wma20", "width", 1),
    );
  }
  if (C("hma20")) {
    const s = S("hma20", "period", 20),
      l = Math.floor(s / 2),
      d = Math.floor(Math.sqrt(s)),
      p = (h, _) => {
        const x = [];
        for (let k = 0; k < h.length; k++) {
          if (k < _ - 1) {
            x.push(h[k]);
            continue;
          }
          let $ = 0,
            W = 0;
          for (let R = 0; R < _; R++) (($ += h[k - R] * (_ - R)), (W += _ - R));
          x.push($ / W);
        }
        return x;
      },
      c = p(e, l),
      u = p(e, s),
      g = c.map((h, _) => 2 * h - u[_]),
      w = p(g, d);
    o.setIndicator(
      "hma20",
      w.map((h, _) => ({ index: _, value: h })),
      S("hma20", "color", "#ec4899"),
      S("hma20", "width", 1.5),
    );
  }
  if (C("bb")) {
    const s = S("bb", "period", 20),
      l = S("bb", "mult", 2),
      d = S("bb", "color", "rgba(59,130,246,0.6)"),
      bw = S("bb", "width", 1),
      p = [],
      c = [],
      u = [];
    for (let g = 0; g < e.length; g++) {
      if (g < s - 1) {
        (p.push({ index: g, value: e[g] }), c.push({ index: g, value: e[g] }));
        continue;
      }
      const w = e.slice(g - s + 1, g + 1),
        h = w.reduce((x, k) => x + k) / s,
        _ = Math.sqrt(w.reduce((x, k) => x + (k - h) ** 2, 0) / s);
      (p.push({ index: g, value: h + l * _ }),
        c.push({ index: g, value: h - l * _ }),
        u.push({ index: g, value: h }));
    }
    (o.setIndicator("bb_up", p, d, bw),
      o.setIndicator("bb_mid", u, d, Math.max(0.5, bw * 0.7)),
      o.setIndicator("bb_lo", c, d, bw));
  }
  if (C("vwap")) {
    const s = [];
    let l = 0,
      d = 0;
    const tf = window.curTf || "15m",
      isDayTf = tf === "1d" || tf === "1w";
    for (let p = 0; p < e.length; p++) {
      if (!isDayTf && p > 0) {
        const t0 = o.buffer.time[p - 1],
          t1 = o.buffer.time[p];
        if (t0 && t1) {
          const d0 = new Date(t0 * 1000).getUTCDate(),
            d1 = new Date(t1 * 1000).getUTCDate();
          if (d0 !== d1) {
            l = 0;
            d = 0;
          }
        }
      }
      const c = (n[p] + a[p] + e[p]) / 3;
      ((d += c * r[p]),
        (l += r[p]),
        s.push({ index: p, value: l > 0 ? d / l : c }));
    }
    o.setIndicator(
      "vwap",
      s,
      S("vwap", "color", "#8E7D72"),
      S("vwap", "width", 1.5),
    );
  }
  if (!C("ichimoku")) {
    [
      "ichi_tenkan",
      "ichi_kijun",
      "ichi_spanA",
      "ichi_spanB",
      "ichi_chikou",
    ].forEach((k) => o.removeIndicator(k));
    o._ichiCloud = null;
  }
  if (C("ichimoku")) {
    let h = function ($, W, R, T) {
      const P = [];
      for (let I = 0; I < $.length; I++) {
        if (I < T - 1) {
          P.push($[I]);
          continue;
        }
        let D = -1 / 0,
          M = 1 / 0;
        for (let L = I - T + 1; L <= I; L++)
          (W[L] > D && (D = W[L]), R[L] < M && (M = R[L]));
        P.push((D + M) / 2);
      }
      return P;
    };
    const s = S("ichimoku", "tenkan", 9),
      l = S("ichimoku", "kijun", 26),
      d = S("ichimoku", "senkou", 52),
      p = [],
      c = [],
      u = [],
      g = [],
      w = [],
      _ = h(e, n, a, s),
      x = h(e, n, a, l),
      k = h(e, n, a, d);
    for (let $ = 0; $ < e.length; $++)
      (p.push({ index: $, value: _[$] }),
        c.push({ index: $, value: x[$] }),
        $ + l < e.length &&
          (u.push({ index: $ + l, value: (_[$] + x[$]) / 2 }),
          g.push({ index: $ + l, value: k[$] })),
        $ >= l && w.push({ index: $ - l, value: e[$] }));
    (S("ichimoku", "show_tenkan", "on") === "on"
      ? o.setIndicator(
          "ichi_tenkan",
          p,
          S("ichimoku", "color_tenkan", "#e91e63"),
          1,
        )
      : o.removeIndicator("ichi_tenkan"),
      S("ichimoku", "show_kijun", "on") === "on"
        ? o.setIndicator(
            "ichi_kijun",
            c,
            S("ichimoku", "color_kijun", "#2196f3"),
            1,
          )
        : o.removeIndicator("ichi_kijun"),
      S("ichimoku", "show_spanA", "on") === "on"
        ? o.setIndicator(
            "ichi_spanA",
            u,
            S("ichimoku", "color_spanA", "#4CAF50"),
            1,
          )
        : o.removeIndicator("ichi_spanA"),
      S("ichimoku", "show_spanB", "on") === "on"
        ? o.setIndicator(
            "ichi_spanB",
            g,
            S("ichimoku", "color_spanB", "#FF5252"),
            1,
          )
        : o.removeIndicator("ichi_spanB"),
      S("ichimoku", "show_chikou", "on") === "on"
        ? o.setIndicator(
            "ichi_chikou",
            w,
            S("ichimoku", "color_chikou", "#9C27B0"),
            1,
          )
        : o.removeIndicator("ichi_chikou"));
    if (S("ichimoku", "cloud", "on") === "on") {
      o._ichiCloud = { spanA: u, spanB: g };
    } else {
      o._ichiCloud = null;
    }
  }
  if (C("psar")) {
    const s = S("psar", "step", 0.02),
      l = S("psar", "max", 0.2),
      cbuy = S("psar", "color_buy", "#C4384B"),
      csell = S("psar", "color_sell", "#3B82F6"),
      d = s,
      p = [];
    let c = !0,
      u = n[0],
      g = s,
      w = a[0];
    for (let h = 0; h < e.length; h++) {
      if (h === 0) {
        p.push({ index: h, value: w, color: c ? cbuy : csell });
        continue;
      }
      ((w = w + g * (u - w)),
        c
          ? ((w = Math.min(w, a[Math.max(0, h - 1)], a[Math.max(0, h - 2)])),
            a[h] < w
              ? ((c = !1), (w = u), (u = a[h]), (g = s))
              : n[h] > u && ((u = n[h]), (g = Math.min(g + d, l))))
          : ((w = Math.max(w, n[Math.max(0, h - 1)], n[Math.max(0, h - 2)])),
            n[h] > w
              ? ((c = !0), (w = u), (u = n[h]), (g = s))
              : a[h] < u && ((u = a[h]), (g = Math.min(g + d, l)))),
        p.push({ index: h, value: w, color: c ? cbuy : csell }));
    }
    o.setIndicator("psar", p, cbuy, S("psar", "width", 1.5), !0);
  }
  if (C("keltner")) {
    const s = S("keltner", "period", 20),
      l = S("keltner", "mult", 1.5),
      d = O(e, s),
      p = [],
      c = [];
    for (let w = 0; w < e.length; w++) {
      let h = 0;
      const _ = Math.min(10, w + 1);
      for (let x = w; x > w - _; x--) {
        const k =
          x > 0
            ? Math.max(
                n[x] - a[x],
                Math.abs(n[x] - e[x - 1]),
                Math.abs(a[x] - e[x - 1]),
              )
            : n[x] - a[x];
        h += k;
      }
      ((h /= _),
        p.push({ index: w, value: d[w] + l * h }),
        c.push({ index: w, value: d[w] - l * h }));
    }
    const u = S("keltner", "color", "#A31540"),
      g = S("keltner", "width", 1.5);
    (o.setIndicator(
      "kelt_mid",
      d.map((w, h) => ({ index: h, value: w })),
      u,
      g,
    ),
      o.setIndicator("kelt_up", p, u + "66", g * 0.7),
      o.setIndicator("kelt_lo", c, u + "66", g * 0.7));
  }
  if (C("envelope")) {
    const s = S("envelope", "period", 20),
      l = S("envelope", "pct", 5) / 100,
      d = S("envelope", "color", "#8B5CF6"),
      p = S("envelope", "width", 1.5),
      c = i(e, s),
      u = [],
      g = [];
    for (let w = 0; w < e.length; w++)
      (u.push({ index: w, value: c[w] * (1 + l) }),
        g.push({ index: w, value: c[w] * (1 - l) }));
    (o.setIndicator("env_up", u, d, p), o.setIndicator("env_lo", g, d, p));
  }
  if (C("dema")) {
    const dp = S("dema", "period", 21),
      s = O(e, dp),
      l = O(s, dp),
      d = s.map((p, c) => ({ index: c, value: 2 * p - l[c] }));
    o.setIndicator(
      "dema",
      d,
      S("dema", "color", "#C4384B"),
      S("dema", "width", 2),
    );
  }
  if (C("supertrend")) {
    const s = S("supertrend", "period", 10),
      l = S("supertrend", "mult", 3),
      d = [];
    for (let h = 0; h < e.length; h++) {
      if (h < s) {
        d.push(n[h] - a[h]);
        continue;
      }
      let _ = 0;
      for (let x = h - s + 1; x <= h; x++)
        _ += Math.max(
          n[x] - a[x],
          Math.abs(n[x] - e[x - 1]),
          Math.abs(a[x] - e[x - 1]),
        );
      d.push(_ / s);
    }
    const p = [];
    let fub = 0,
      flb = 0,
      u = 1;
    for (let h = 0; h < e.length; h++) {
      const _ = (n[h] + a[h]) / 2,
        bub = _ + l * d[h],
        blb = _ - l * d[h];
      fub = h > 0 && (bub < fub || e[h - 1] > fub) ? bub : h > 0 ? fub : bub;
      flb = h > 0 && (blb > flb || e[h - 1] < flb) ? blb : h > 0 ? flb : blb;
      if (h > 0) {
        if (u === 1 && e[h] < flb) u = -1;
        else if (u === -1 && e[h] > fub) u = 1;
      }
      const $ = u === 1 ? flb : fub;
      p.push({ index: h, value: $, color: u === 1 ? "#C4384B" : "#3B82F6" });
    }
    o.setIndicator(
      "supertrend",
      p,
      S("supertrend", "color", "#C4384B"),
      S("supertrend", "width", 2),
    );
  }
  if (C("pivot") && e.length > 1) {
    const tf = window.curTf || "15m",
      lookback =
        { "1m": 1440, "5m": 288, "15m": 96, "1h": 24, "4h": 6, "1d": 1 }[tf] ||
        288,
      sl = Math.max(0, e.length - lookback),
      s = Math.max(...n.slice(sl)),
      l = Math.min(...a.slice(sl)),
      d = e[e.length - 1],
      p = (s + l + d) / 3,
      rng = s - l,
      fib = S("pivot", "type", "classic") === "fibonacci",
      c = fib ? p + 0.382 * rng : 2 * p - l,
      u = fib ? p - 0.382 * rng : 2 * p - s,
      g = fib ? p + 0.618 * rng : p + rng,
      w = fib ? p - 0.618 * rng : p - rng,
      r3 = fib ? p + rng : s + 2 * (p - l),
      s3 = fib ? p - rng : l - 2 * (s - p);
    for (const [h, _, x, lw] of [
      ["P", p, "#D8B66A", 1.5],
      ["R1", c, "#3B82F6", 1],
      ["R2", g, "#3B82F6", 1],
      ["R3", r3, "#2563EB", 0.7],
      ["S1", u, "#C4384B", 1],
      ["S2", w, "#C4384B", 1],
      ["S3", s3, "#DC2626", 0.7],
    ])
      o.addDrawing({
        type: "hline",
        price: _,
        color: x,
        lineWidth: lw,
        label: h,
        dashed: lw < 1,
        _calcOwner: "pivot",
      });
  }
  if (C("emaribbon")) {
    Object.keys(o.indicators || {}).forEach((k) => {
      if (k.indexOf("ribbon") === 0) o.removeIndicator(k);
    });
    const s = S("emaribbon", "ma_type", "EMA"),
      len = S("emaribbon", "length", "\uB2E8\uAE30"),
      c = S("emaribbon", "width", 1),
      g =
        len === "\uC7A5\uAE30" ? [20, 50, 100, 150, 200] : [8, 13, 21, 34, 55];
    const w = [
      "#E53935",
      "#FF6D00",
      "#FFD600",
      "#43A047",
      "#1E88E5",
      "#8E24AA",
      "#00ACC1",
      "#F06292",
    ];
    g.forEach((h, _) => {
      let x;
      if (s === "SMA") x = i(e, h);
      else if (s === "WMA") {
        x = [];
        for (let k = 0; k < e.length; k++) {
          if (k < h - 1) {
            x.push(e[k]);
            continue;
          }
          let $ = 0,
            W = 0;
          for (let R = 0; R < h; R++) (($ += e[k - R] * (h - R)), (W += h - R));
          x.push($ / W);
        }
      } else if (s === "HMA") {
        const k = Math.floor(h / 2),
          $ = Math.floor(Math.sqrt(h)),
          W = O(e, k),
          R = O(e, h),
          T = W.map((P, I) => 2 * P - R[I]);
        x = O(T, $);
      } else if (s === "DEMA") {
        const k = O(e, h),
          $ = O(k, h);
        x = k.map((W, R) => 2 * W - $[R]);
      } else if (s === "TEMA") {
        const k = O(e, h),
          $ = O(k, h),
          W = O($, h);
        x = k.map((R, T) => 3 * R - 3 * $[T] + W[T]);
      } else x = O(e, h);
      o.setIndicator(
        "ribbon" + h,
        x.map((k, $) => ({ index: $, value: k })),
        w[_ % 8],
        c,
      );
    });
  }
  if (C("dema21") && e.length >= 42) {
    const s = S("dema21", "period", 21),
      l = O(e, s),
      d = O(l, s),
      p = l.map((c, u) => 2 * c - d[u]);
    o.setIndicator(
      "dema21",
      p.map((c, u) => ({ index: u, value: c })),
      S("dema21", "color", "#6366f1"),
      S("dema21", "width", 1),
    );
  }
  if (C("volprofile")) {
    const s = Math.max(0, e.length - S("volprofile", "lookback", 200)),
      l = Math.min(...a.slice(s)),
      d = Math.max(...n.slice(s)),
      p = S("volprofile", "rows", 30),
      c = (d - l) / p,
      u = new Array(p).fill(0),
      ub = new Array(p).fill(0);
    for (let h = s; h < e.length; h++) {
      const _ = Math.min(p - 1, Math.floor((e[h] - l) / c));
      u[_] += r[h];
      if (e[h] >= o.buffer.open[h]) ub[_] += r[h];
    }
    const g = Math.max(...u);
    o._vpData = { rows: p, low: l, step: c, vol: u, buyVol: ub, max: g };
  }
  function y(s, l) {
    const d = O(s, l),
      p = O(d, l),
      c = O(p, l);
    return d.map((u, g) => 3 * (u - p[g]) + c[g]);
  }
  if (C("tema20") || C("tema60")) {
    let l = function (d, p) {
      const c = [];
      for (let u = 1; u < d.length; u++) {
        const g = d[u] - d[u - 1],
          w = d[u] > s[u];
        let h;
        (g > 0 && w
          ? (h = "#3B82F6")
          : g < 0 && !w
            ? (h = "#921230")
            : (h = "#A31540"),
          c.push({ index: u, value: d[u], color: h }));
      }
      (o.setIndicator(p, c, "#A31540", S(p, "width", 2)),
        (o._temaColors = o._temaColors || {}),
        (o._temaColors[p] = c));
    };
    const s = y(e, 100);
    (C("tema20") && l(y(e, 20), "tema20"),
      C("tema60") && l(y(e, 60), "tema60"));
  }
  let f = null;
  if (window._customMA && window._customMA.some((s) => s.type === "TEMA")) {
    const s = O(e, 100),
      l = O(s, 100),
      d = O(l, 100);
    f = s.map((p, c) => 3 * p - 3 * l[c] + d[c]);
  }
  if (window._customMA)
    for (const s of window._customMA) {
      let l;
      if (s.type === "EMA") l = O(e, s.period);
      else if (s.type === "SMA") l = i(e, s.period);
      else if (s.type === "TEMA") {
        const d = O(e, s.period),
          p = O(d, s.period),
          c = O(p, s.period);
        if (((l = d.map((u, g) => 3 * u - 3 * p[g] + c[g])), f)) {
          const u = l.map((g, w) => {
            const h = w > 0 ? l[w] - l[w - 1] : 0,
              _ = l[w] > f[w];
            let x;
            return (
              h > 0 && _
                ? (x = "#3B82F6")
                : h < 0 && !_
                  ? (x = "#921230")
                  : (x = "#A31540"),
              { index: w, value: g, color: x }
            );
          });
          o.setIndicator(s.id, u, "#A31540", s.width || 2);
          continue;
        }
      } else if (s.type === "WMA") {
        l = [];
        for (let d = 0; d < e.length; d++) {
          if (d < s.period - 1) {
            l.push(e[d]);
            continue;
          }
          let p = 0,
            c = 0;
          for (let u = 0; u < s.period; u++)
            ((p += e[d - u] * (s.period - u)), (c += s.period - u));
          l.push(p / c);
        }
      } else if (s.type === "HMA") {
        const d = (h, _) => {
            const x = [];
            for (let k = 0; k < h.length; k++) {
              if (k < _ - 1) {
                x.push(h[k]);
                continue;
              }
              let $ = 0,
                W = 0;
              for (let R = 0; R < _; R++)
                (($ += h[k - R] * (_ - R)), (W += _ - R));
              x.push($ / W);
            }
            return x;
          },
          p = Math.floor(s.period / 2),
          c = Math.floor(Math.sqrt(s.period)),
          u = d(e, p),
          g = d(e, s.period),
          w = u.map((h, _) => 2 * h - g[_]);
        l = d(w, c);
      } else if (s.type === "DEMA") {
        const d = O(e, s.period),
          p = O(d, s.period);
        l = d.map((c, u) => 2 * c - p[u]);
      } else continue;
      o.setIndicator(
        s.id,
        l.map((d, p) => ({ index: p, value: d })),
        s.color || "#fff",
        s.width || 1,
      );
    }
  function m(s, l) {
    const d = [s[0]];
    for (let p = 1; p < s.length; p++) d.push((d[p - 1] * (l - 1) + s[p]) / l);
    return d;
  }
  function b(s, l, d, p) {
    const c = [s[0] - l[0]];
    for (let u = 1; u < d.length; u++)
      c.push(
        Math.max(
          s[u] - l[u],
          Math.abs(s[u] - d[u - 1]),
          Math.abs(l[u] - d[u - 1]),
        ),
      );
    return m(c, p);
  }
  if (!o.setSubChart) return;
  const v = {};
  if (J("rsi")) {
    const s = S("rsi", "period", 14),
      l = e.length,
      d = new Array(l).fill(NaN),
      p = new Array(l).fill(NaN);
    if (l > s) {
      let u = 0,
        g = 0;
      for (let w = 1; w <= s; w++) {
        const h = e[w] - e[w - 1];
        h > 0 ? (u += h) : (g += -h);
      }
      ((d[s] = u / s), (p[s] = g / s));
      for (let w = s + 1; w < l; w++) {
        const h = e[w] - e[w - 1],
          _ = h > 0 ? h : 0,
          x = h < 0 ? -h : 0;
        ((d[w] = (d[w - 1] * (s - 1) + _) / s),
          (p[w] = (p[w - 1] * (s - 1) + x) / s));
      }
    }
    const c = d.map((u, g) => {
      if (!Number.isFinite(u)) return { index: g, value: NaN };
      const w = p[g];
      if (w === 0) return { index: g, value: 100 };
      const h = u / w;
      return { index: g, value: 100 - 100 / (1 + h) };
    });
    v.rsi = {
      label: "RSI " + s,
      lines: [
        {
          data: c,
          color: S("rsi", "color", "#A31540"),
          lineWidth: S("rsi", "width", 1.5),
        },
      ],
      hlines: [
        { value: 70, color: "rgba(59,130,246,0.6)" },
        { value: 30, color: "rgba(196,56,75,0.6)" },
        { value: 50, color: "rgba(107,114,128,0.2)" },
      ],
      range: { min: 0, max: 100 },
    };
  }
  if (J("macd")) {
    const s = S("macd", "fast", 12),
      l = S("macd", "slow", 26),
      d = S("macd", "signal", 9),
      p = O(e, s),
      c = O(e, l),
      u = p.map((h, _) => h - c[_]),
      g = O(u, d),
      w = u.map((h, _) => ({ index: _, value: h - g[_] }));
    v.macd = {
      label: "MACD(" + s + "," + l + "," + d + ")",
      lines: [
        {
          data: u.map((h, _) => ({ index: _, value: h })),
          color: S("macd", "color1", "#921230"),
          lineWidth: S("macd", "width", 1.5),
        },
        {
          data: g.map((h, _) => ({ index: _, value: h })),
          color: S("macd", "color2", "#D8B66A"),
          lineWidth: 1,
        },
        { data: w, color: "#6b7280", lineWidth: 0, histogram: !0 },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("stoch")) {
    const s = S("stoch", "period", 14),
      l = S("stoch", "smooth", 3),
      d = [],
      p = [];
    for (let g = 0; g < e.length; g++) {
      const w = Math.max(0, g - s + 1);
      let h = -1 / 0,
        _ = 1 / 0;
      for (let x = w; x <= g; x++)
        (n[x] > h && (h = n[x]), a[x] < _ && (_ = a[x]));
      d.push(h === _ ? 50 : ((e[g] - _) / (h - _)) * 100);
    }
    const c = i(d, l),
      u = i(c, l);
    v.stoch = {
      label: "스토캐스틱 " + s + "," + l,
      lines: [
        {
          data: c.map((g, w) => ({ index: w, value: g })),
          color: S("stoch", "color1", "#921230"),
          lineWidth: S("stoch", "width", 1),
        },
        {
          data: u.map((g, w) => ({ index: w, value: g })),
          color: S("stoch", "color2", "#D8B66A"),
          lineWidth: 1,
        },
      ],
      hlines: [
        { value: 80, color: "rgba(59,130,246,0.6)" },
        { value: 20, color: "rgba(196,56,75,0.6)" },
      ],
      range: { min: 0, max: 100 },
    };
  }
  if (J("obv")) {
    const raw = [0];
    for (let l = 1; l < e.length; l++)
      raw.push(
        raw[l - 1] + (e[l] > e[l - 1] ? r[l] : e[l] < e[l - 1] ? -r[l] : 0),
      );
    const obvSm = S("obv", "smooth", 1),
      s = obvSm > 1 ? i(raw, obvSm) : raw;
    const obvEma = [];
    const obvP = S("obv", "period", 20);
    for (let l = 0; l < s.length; l++) {
      if (l < obvP) {
        obvEma.push(s[l]);
        continue;
      }
      obvEma.push(obvEma[l - 1] + ((s[l] - obvEma[l - 1]) * 2) / (obvP + 1));
    }
    v.obv = {
      label: "OBV (" + (obvSm > 1 ? obvSm + "," : "") + obvP + ")",
      lines: [
        {
          data: s.map((l, d) => ({ index: d, value: l })),
          color: S("obv", "color", "#8E7D72"),
          lineWidth: S("obv", "width", 1.5),
        },
        {
          data: obvEma.map((l, d) => ({ index: d, value: l })),
          color: S("obv", "color2", "#D8B66A"),
          lineWidth: 1,
        },
      ],
      hlines: [],
    };
  }
  if (
    (J("kvo") &&
      (Z() ? 1 : (X("멤버십 가입 후 이용 가능합니다", "#D8B66A", 3000), 0)) &&
      (clearTimeout(window._kvoTimer),
      (window._kvoTimer = setTimeout(() => {
        (async () => {
          try {
            const s = await (
              await q(
                `${F}/v1/charts/ind-kvo?symbolId=${B}&timeframe=${A}&limit=${e.length || 2e3}`,
              )
            ).json();
            if (!s.success || !s.data?.kvo) return;
            const l = s.data;
            o.setSubChart("kvo", {
              label: t("\uAC70\uB798\uB7C9\uBD84\uC11D"),
              lines: [
                {
                  data: l.kvo.map((d, p) => ({ index: p, value: d })),
                  color: S("kvo", "color", "#A31540"),
                  lineWidth: S("kvo", "width", 1.5),
                },
                {
                  data: l.sig.map((d, p) => ({ index: p, value: d })),
                  color: "#D8B66A",
                  lineWidth: 1,
                },
                {
                  data: l.hist.map((d, p) => ({
                    index: p,
                    value: d,
                    color:
                      d >= 0 ? "rgba(196,56,75,0.5)" : "rgba(59,130,246,0.5)",
                  })),
                  color: "#6b7280",
                  lineWidth: 0,
                  histogram: !0,
                },
              ],
              hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
            });
          } catch {}
        })();
      }, 300))),
    J("master") &&
      (Z() ? 1 : (X("멤버십 가입 후 이용 가능합니다", "#D8B66A", 3000), 0)) &&
      (clearTimeout(window._msTimer),
      (window._msTimer = setTimeout(() => {
        (async () => {
          try {
            const s = await (
              await q(
                `${F}/v1/charts/ind-ms?symbolId=${B}&timeframe=${A}&limit=${e.length || 2e3}`,
              )
            ).json();
            if (!s.success || !s.data) return;
            const l = s.data.score || [],
              d = l.map((c) => ({
                index: c.index,
                value: c.value,
                color:
                  c.value >= 3
                    ? "rgba(196,56,75,0.8)"
                    : c.value >= 1.5
                      ? "rgba(196,56,75,0.6)"
                      : c.value <= -3
                        ? "rgba(59,130,246,0.8)"
                        : c.value <= -1.5
                          ? "rgba(59,130,246,0.6)"
                          : "rgba(107,114,128,0.3)",
              }));
            o.setSubChart("master", {
              label: t("\uC885\uD569\uB9E4\uB9E4"),
              lines: [
                {
                  data: l,
                  color: S("master", "color", "#D8B66A"),
                  lineWidth: S("master", "width", 1.5),
                },
                { data: d, color: "#6b7280", lineWidth: 0, histogram: !0 },
              ],
              hlines: [
                { value: 3, color: "rgba(196,56,75,0.3)" },
                { value: -3, color: "rgba(59,130,246,0.3)" },
                { value: 0, color: "rgba(107,114,128,0.6)" },
              ],
            });
            const p = s.data.signals || [];
            o.overlay.drawings = o.overlay.drawings.filter(
              (c) => c._calcOwner !== "ms",
            );
            for (const c of p)
              c.type === "buy"
                ? o.addDrawing({
                    type: "buy_scan",
                    index: c.index,
                    price: c.price,
                    scanType: "buy",
                    color: "#C4384B",
                    size: 12,
                    _calcOwner: "ms",
                  })
                : c.type === "sell"
                  ? o.addDrawing({
                      type: "buy_scan",
                      index: c.index,
                      price: c.price,
                      scanType: "sell",
                      color: "#3B82F6",
                      size: 12,
                      _calcOwner: "ms",
                    })
                  : c.type === "close_long"
                    ? o.addDrawing({
                        type: "text",
                        index: c.index,
                        price: c.price * 1.001,
                        text: "\u2715 \uCCAD\uC0B0",
                        color: "#D8B66A",
                        _calcOwner: "ms",
                      })
                    : c.type === "close_short" &&
                      o.addDrawing({
                        type: "text",
                        index: c.index,
                        price: c.price * 0.999,
                        text: "\u2715 \uCCAD\uC0B0",
                        color: "#D8B66A",
                        _calcOwner: "ms",
                      });
            o._dirty = !0;
          } catch {}
        })();
      }, 500))),
    J("atr"))
  ) {
    const s = S("atr", "period", 14),
      l = b(n, a, e, s);
    v.atr = {
      label: "ATR " + s,
      lines: [
        {
          data: l.map((d, p) => ({ index: p, value: d })),
          color: S("atr", "color", "#D8B66A"),
          lineWidth: S("atr", "width", 1.5),
        },
      ],
    };
  }
  if (J("rs")) {
    const s = S("rs", "period", 14),
      l = [];
    for (let d = 0; d < e.length; d++) {
      if (d < s) {
        l.push(1);
        continue;
      }
      const p = (e[d] - e[d - s]) / e[d - s];
      l.push(1 + p);
    }
    v.rs = {
      label: "RS " + s,
      lines: [
        {
          data: l.map((d, p) => ({ index: p, value: d })),
          color: S("rs", "color", "#C4384B"),
          lineWidth: S("rs", "width", 1.5),
        },
      ],
      hlines: [{ value: 1, color: "rgba(107,114,128,0.4)" }],
    };
  }
  if (
    (C("dayband") ||
      (o.removeIndicator("dayHigh"),
      o.removeIndicator("dayLow"),
      o.removeIndicator("dayMid"),
      o.removeIndicator("day25"),
      o.removeIndicator("day75")),
    C("dayband") && o && o.buffer && o.buffer.length > 10)
  ) {
    (o.removeIndicator("dayHigh"),
      o.removeIndicator("dayLow"),
      o.removeIndicator("dayMid"),
      o.removeIndicator("day25"),
      o.removeIndicator("day75"));
    const s = o.buffer,
      l = s.length,
      p =
        ({ "1m": 24, "5m": 24, "15m": 72, "1h": 240, "4h": 960, "1d": 1440 }[
          A
        ] || 24) * 3600,
      c = Math.floor(Date.now() / 1e3) - p;
    let u = -1 / 0,
      g = 1 / 0,
      w = -1;
    for (let D = 0; D < l; D++)
      if (s.time[D] >= c) {
        w = D;
        break;
      }
    w < 0 && (w = Math.max(0, l - 100));
    const h = [],
      _ = [],
      x = [],
      k = [],
      $ = [];
    ((u = -1 / 0), (g = 1 / 0));
    for (let D = w; D < l; D++) {
      (s.high[D] > u && (u = s.high[D]), s.low[D] < g && (g = s.low[D]));
      const M = u - g;
      (h.push({ index: D, value: u }),
        _.push({ index: D, value: g }),
        x.push({ index: D, value: g + M * 0.5 }),
        k.push({ index: D, value: g + M * 0.25 }),
        $.push({ index: D, value: g + M * 0.75 }));
    }
    const W = S("dayband", "color_high", "#C4384B"),
      R = S("dayband", "color_low", "#3B82F6"),
      T = S("dayband", "color_mid", "#D8B66A"),
      P = S("dayband", "color_25", "#16A34A"),
      I = S("dayband", "color_75", "#9333EA");
    (o.setIndicator("dayHigh", h, W, 1.5),
      o.setIndicator("dayLow", _, R, 1.5),
      o.setIndicator("dayMid", x, T, 1),
      o.setIndicator("day25", k, P, 1),
      o.setIndicator("day75", $, I, 1));
  }
  if (
    (C("entry_sig") ||
      ((o.overlay.drawings = o.overlay.drawings.filter(
        (s) => s._calcOwner !== "entrySignal",
      )),
      (o._dirty = !0)),
    C("entry_sig") &&
      q(`${F}/v1/charts/entry-signal?symbolId=${B}&timeframe=${A}&limit=1000`)
        .then((s) => s.json())
        .then((s) => {
          s.success &&
            s.data?.signals &&
            o &&
            ((o.overlay.drawings = o.overlay.drawings.filter(
              (l) => l._calcOwner !== "entrySignal",
            )),
            s.data.signals.forEach((l) => {
              o.addDrawing({
                type: "strategy_signal",
                bar_idx: l.index,
                price: l.price,
                direction: l.side === "long" ? "long" : "short",
                label:
                  (l.side === "long" ? "\uB9E4\uC218" : "\uB9E4\uB3C4") +
                  " " +
                  l.score,
                _calcOwner: "entrySignal",
              });
            }),
            (o._dirty = !0));
        })
        .catch(() => {}),
    J("rsim"))
  ) {
    const s = S("rsim", "period", 14),
      l = 10,
      d = 5,
      p = 5,
      c = 50,
      u = 10,
      g = "#33c570",
      w = "#ae4ce6",
      h = [];
    for (let I = 0; I < e.length; I++) h.push(I < l ? 0 : e[I] - e[I - l]);
    const _ = [];
    {
      let I = 0,
        D = 0;
      for (let M = 0; M < h.length; M++) {
        const L = M > 0 ? h[M] - h[M - 1] : 0,
          H = L > 0 ? L : 0,
          ee = L < 0 ? -L : 0;
        if (M < s) {
          ((I += H / s), (D += ee / s), _.push(50));
          continue;
        }
        if (M === s) {
          _.push(D === 0 ? 100 : 100 - 100 / (1 + I / D));
          continue;
        }
        ((I = (I * (s - 1) + H) / s),
          (D = (D * (s - 1) + ee) / s),
          _.push(D === 0 ? 100 : 100 - 100 / (1 + I / D)));
      }
    }
    const x = [],
      k = [],
      $ = [],
      W = [];
    for (let I = d; I < _.length - d; I++) {
      let D = !0,
        M = !0;
      for (let L = I - d; L < I; L++)
        (_[L] <= _[I] && (D = !1), _[L] >= _[I] && (M = !1));
      for (let L = I + 1; L <= I + d; L++)
        (_[L] <= _[I] && (D = !1), _[L] >= _[I] && (M = !1));
      if (D) {
        for (let L = $.length - 1; L >= 0; L--) {
          const H = $[L],
            ee = I - H.idx;
          if (!(ee < p)) {
            if (ee > c) break;
            if (_[I] > H.rsi && a[I] < H.price) {
              x.push({ index: I, price: a[I], rsiVal: _[I] });
              break;
            }
          }
        }
        $.push({ idx: I, rsi: _[I], price: a[I] });
      }
      if (M) {
        for (let L = W.length - 1; L >= 0; L--) {
          const H = W[L],
            ee = I - H.idx;
          if (!(ee < p)) {
            if (ee > c) break;
            if (_[I] < H.rsi && n[I] > H.price) {
              k.push({ index: I, price: n[I], rsiVal: _[I] });
              break;
            }
          }
        }
        W.push({ idx: I, rsi: _[I], price: n[I] });
      }
    }
    const R = _.map((I, D) => ({ index: D, value: I })),
      T = [];
    (x
      .slice(-u)
      .forEach((I) =>
        T.push({ index: I.index, value: I.rsiVal, type: "bull", color: g }),
      ),
      k
        .slice(-u)
        .forEach((I) =>
          T.push({ index: I.index, value: I.rsiVal, type: "bear", color: w }),
        ),
      (v.rsim = {
        label: t("\uB2E4\uC774\uBC84\uC804\uC2A4") + " " + s,
        lines: [
          {
            data: R,
            color: S("rsim", "color", "#D8B66A"),
            lineWidth: S("rsim", "width", 1.5),
          },
        ],
        fill: {
          value: 50,
          above: "rgba(174,76,230,0.08)",
          below: "rgba(51,197,112,0.08)",
        },
        hlines: [
          { value: 50, color: "rgba(107,114,128,0.7)" },
          { value: 70, color: "rgba(196,56,75,0.4)" },
          { value: 30, color: "rgba(59,130,246,0.4)" },
        ],
        range: { min: 0, max: 100 },
        markers: T,
      }));
    const P = e.length - 1;
    (x.slice(-u).forEach((I) => {
      let D = P;
      for (let M = I.index + 1; M <= P; M++)
        if (n[M] > I.price) {
          D = M + 15;
          break;
        }
      o.addDrawing({
        type: "div_zone",
        price: I.price,
        startIdx: I.index - 5,
        endIdx: Math.min(D, P + 15),
        color: g,
        side: "bull",
        _calcOwner: "rsim",
      });
    }),
      k.slice(-u).forEach((I) => {
        let D = P;
        for (let M = I.index + 1; M <= P; M++)
          if (a[M] < I.price) {
            D = M + 15;
            break;
          }
        o.addDrawing({
          type: "div_zone",
          price: I.price,
          startIdx: I.index - 5,
          endIdx: Math.min(D, P + 15),
          color: w,
          side: "bear",
          _calcOwner: "rsim",
        });
      }));
  }
  if (J("cci")) {
    const s = S("cci", "period", 20),
      l = [];
    for (let d = 0; d < e.length; d++) {
      const p = (n[d] + a[d] + e[d]) / 3,
        c = Math.max(0, d - s + 1);
      let u = 0;
      for (let h = c; h <= d; h++) u += (n[h] + a[h] + e[h]) / 3;
      const g = u / (d - c + 1);
      let w = 0;
      for (let h = c; h <= d; h++) w += Math.abs((n[h] + a[h] + e[h]) / 3 - g);
      ((w /= d - c + 1), l.push(w === 0 ? 0 : (p - g) / (0.015 * w)));
    }
    v.cci = {
      label: "CCI " + s,
      lines: [
        {
          data: l.map((d, p) => ({ index: p, value: d })),
          color: S("cci", "color", "#ec4899"),
          lineWidth: S("cci", "width", 1.5),
        },
      ],
      hlines: [
        { value: 100, color: "rgba(59,130,246,0.6)" },
        { value: -100, color: "rgba(196,56,75,0.6)" },
        { value: 0, color: "rgba(107,114,128,0.2)" },
      ],
    };
  }
  if (J("adx")) {
    const s = S("adx", "period", 14),
      l = b(n, a, e, s),
      d = [0],
      p = [0];
    for (let x = 1; x < e.length; x++) {
      const k = n[x] - n[x - 1],
        $ = a[x - 1] - a[x];
      (d.push(k > $ && k > 0 ? k : 0), p.push($ > k && $ > 0 ? $ : 0));
    }
    const c = m(d, s),
      u = m(p, s),
      g = c.map((x, k) => (l[k] ? (x / l[k]) * 100 : 0)),
      w = u.map((x, k) => (l[k] ? (x / l[k]) * 100 : 0)),
      h = g.map((x, k) => {
        const $ = x + w[k];
        return $ ? (Math.abs(x - w[k]) / $) * 100 : 0;
      }),
      _ = m(h, s);
    v.adx = {
      label: "ADX/DMI(" + s + ")",
      lines: [
        {
          data: _.map((x, k) => ({ index: k, value: x })),
          color: S("adx", "color", "#D8B66A"),
          lineWidth: S("adx", "width", 2),
        },
        {
          data: g.map((x, k) => ({ index: k, value: x })),
          color: S("adx", "color_plus", "#C4384B"),
          lineWidth: S("adx", "width", 1),
        },
        {
          data: w.map((x, k) => ({ index: k, value: x })),
          color: S("adx", "color_minus", "#3B82F6"),
          lineWidth: S("adx", "width", 1),
        },
      ],
      hlines: [{ value: 25, color: "rgba(107,114,128,0.3)" }],
    };
  }
  if (J("willr")) {
    const s = S("willr", "period", 14),
      l = [];
    for (let d = 0; d < e.length; d++) {
      const p = Math.max(0, d - s + 1);
      let c = -1 / 0,
        u = 1 / 0;
      for (let g = p; g <= d; g++)
        (n[g] > c && (c = n[g]), a[g] < u && (u = a[g]));
      l.push({ index: d, value: c === u ? -50 : ((e[d] - c) / (c - u)) * 100 });
    }
    v.willr = {
      label: "윌리엄스%R " + s,
      lines: [
        {
          data: l,
          color: S("willr", "color", "#8E7D72"),
          lineWidth: S("willr", "width", 1.5),
        },
      ],
      hlines: [
        { value: -20, color: "rgba(59,130,246,0.6)" },
        { value: -80, color: "rgba(196,56,75,0.6)" },
      ],
      range: { min: -100, max: 0 },
    };
  }
  if (J("mfi")) {
    const s = S("mfi", "period", 14),
      l = [],
      d = [0],
      p = [0];
    for (let u = 0; u < e.length; u++) l.push((n[u] + a[u] + e[u]) / 3);
    for (let u = 1; u < e.length; u++) {
      const g = l[u] * r[u];
      l[u] > l[u - 1] ? (d.push(g), p.push(0)) : (d.push(0), p.push(g));
    }
    const c = [];
    for (let u = 0; u < e.length; u++) {
      if (u < s) {
        c.push({ index: u, value: 50 });
        continue;
      }
      let g = 0,
        w = 0;
      for (let h = u - s + 1; h <= u; h++) ((g += d[h]), (w += p[h]));
      c.push({ index: u, value: w === 0 ? 100 : 100 - 100 / (1 + g / w) });
    }
    v.mfi = {
      label: "MFI " + s,
      lines: [
        {
          data: c,
          color: S("mfi", "color", "#D8B66A"),
          lineWidth: S("mfi", "width", 1.5),
        },
      ],
      hlines: [
        { value: 80, color: "rgba(59,130,246,0.6)" },
        { value: 20, color: "rgba(196,56,75,0.6)" },
      ],
      range: { min: 0, max: 100 },
    };
  }
  if (J("cmf")) {
    const s = S("cmf", "period", 20),
      l = [];
    for (let d = 0; d < e.length; d++) {
      if (d < s - 1) {
        l.push({ index: d, value: 0 });
        continue;
      }
      let p = 0,
        c = 0;
      for (let u = d - s + 1; u <= d; u++) {
        const g = n[u] - a[u],
          w = g > 0 ? (e[u] - a[u] - (n[u] - e[u])) / g : 0;
        ((p += w * r[u]), (c += r[u]));
      }
      l.push({ index: d, value: c > 0 ? p / c : 0 });
    }
    v.cmf = {
      label: "CMF " + s,
      lines: [
        {
          data: l,
          color: S("cmf", "color", "#A31540"),
          lineWidth: S("cmf", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("roc")) {
    const s = S("roc", "period", 12),
      l = [];
    for (let d = 0; d < e.length; d++) {
      if (d < s) {
        l.push({ index: d, value: 0 });
        continue;
      }
      l.push({ index: d, value: ((e[d] - e[d - s]) / e[d - s]) * 100 });
    }
    v.roc = {
      label: "ROC " + s,
      lines: [
        {
          data: l,
          color: S("roc", "color", "#ec4899"),
          lineWidth: S("roc", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("imacd")) {
    let d = function (T, P) {
        const I = [T[0]];
        for (let D = 1; D < T.length; D++)
          I.push((I[D - 1] * (P - 1) + T[D]) / P);
        return I;
      },
      p = function (T, P) {
        const I = O(T, P),
          D = O(I, P);
        return I.map((M, L) => M + (M - D[L]));
      };
    const imL = S("imacd", "length", 34),
      imSig = S("imacd", "signal", 9),
      c = e.map((T, P) => (n[P] + a[P] + T) / 3),
      u = d(n, imL),
      g = d(a, imL),
      w = p(c, imL),
      h = [],
      _ = [],
      x = [];
    for (let T = 0; T < e.length; T++)
      w[T] > u[T]
        ? h.push(w[T] - u[T])
        : w[T] < g[T]
          ? h.push(w[T] - g[T])
          : h.push(0);
    const k = i(h, imSig);
    for (let T = 0; T < e.length; T++) x.push(h[T] - k[T]);
    const $ = h.map((T, P) => {
        let I;
        return (
          c[P] > w[P]
            ? (I = c[P] > u[P] ? "#C4384B" : "#D8B66A")
            : (I = c[P] < g[P] ? "#3B82F6" : "#D8B66A"),
          { index: P, value: T, color: I }
        );
      }),
      W = x.map((T, P) => ({ index: P, value: T })),
      R = k.map((T, P) => ({ index: P, value: T }));
    v.imacd = {
      label: t("범온 MACD"),
      lines: [
        { data: $, color: "#C4384B", lineWidth: 0, histogram: !0 },
        {
          data: W.map((T, P) => ({ ...T, color: "#921230" })),
          color: "#921230",
          lineWidth: 0,
          histogram: !0,
        },
        { data: R, color: "#991b1b", lineWidth: 2 },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("stochrsi") && e.length >= 28) {
    const T = S("stochrsi", "period", 14),
      P = S("stochrsi", "smooth", 3),
      I = [];
    let D = 0,
      M = 0;
    for (let V = 0; V < e.length; V++) {
      const te = V > 0 ? e[V] - e[V - 1] : 0;
      ((D = ((T - 1) * D + (te > 0 ? te : 0)) / T),
        (M = ((T - 1) * M + (te < 0 ? -te : 0)) / T),
        I.push(M === 0 ? 100 : 100 - 100 / (1 + D / M)));
    }
    const L = [];
    for (let V = T - 1; V < I.length; V++) {
      const te = I.slice(V - T + 1, V + 1),
        pt = Math.min(...te),
        Ct = Math.max(...te);
      L.push(Ct === pt ? 50 : ((I[V] - pt) / (Ct - pt)) * 100);
    }
    const Ls = P > 1 ? i(L, P) : L;
    const ee = [...Array(T - 1).fill(null), ...Ls];
    v.stochrsi = {
      label: "스토캐스틱RSI " + T,
      lines: [
        {
          data: ee.map((V, te) => ({ index: te, value: V })),
          color: S("stochrsi", "color", "#A31540"),
          lineWidth: S("stochrsi", "width", 1.5),
        },
      ],
      hlines: [
        { value: 80, color: "rgba(59,130,246,0.6)" },
        { value: 20, color: "rgba(196,56,75,0.6)" },
      ],
      range: { min: 0, max: 100 },
    };
  }
  if (J("mom")) {
    const T = S("mom", "period", 10),
      P = e.map((I, D) => ({ index: D, value: D >= T ? I - e[D - T] : null }));
    v.mom = {
      label: "모멘텀 " + T,
      lines: [
        {
          data: P,
          color: S("mom", "color", "#921230"),
          lineWidth: S("mom", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("tsi") && e.length >= 40) {
    const tL = S("tsi", "long", 25),
      tS = S("tsi", "short", 13),
      aL = 2 / (tL + 1),
      aS = 2 / (tS + 1),
      I = e.map((V, te) => (te > 0 ? V - e[te - 1] : 0));
    let D = 0,
      M = 0,
      L = 0,
      H = 0;
    const ee = [];
    for (let V = 0; V < I.length; V++) {
      ((D += (I[V] - D) * aL), (M += (D - M) * aS));
      const te = Math.abs(I[V]);
      ((L += (te - L) * aL),
        (H += (L - H) * aS),
        ee.push(H === 0 ? 0 : (M / H) * 100));
    }
    v.tsi = {
      label: "TSI(" + tL + "," + tS + ")",
      lines: [
        {
          data: ee.map((V, te) => ({ index: te, value: V })),
          color: S("tsi", "color", "#D8B66A"),
          lineWidth: S("tsi", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("trix")) {
    const T = S("trix", "period", 15),
      P = O(e, T),
      I = O(P, T),
      D = O(I, T),
      M = D.map((L, H) =>
        H > 0 && D[H - 1] !== 0 ? ((L - D[H - 1]) / D[H - 1]) * 1e4 : 0,
      );
    v.trix = {
      label: "TRIX(" + T + ")",
      lines: [
        {
          data: M.map((L, H) => ({ index: H, value: L })),
          color: S("trix", "color", "#8E24AA"),
          lineWidth: S("trix", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("ao")) {
    const af = S("ao", "fast", 5),
      asw = S("ao", "slow", 34),
      T = e.map((M, L) => (n[L] + a[L]) / 2),
      P = i(T, af),
      I = i(T, asw),
      D = P.map((M, L) => ({ index: L, value: M - I[L] }));
    v.ao = {
      label: "AO(" + af + "," + asw + ")",
      lines: [
        {
          data: D,
          color: S("ao", "color", "#43A047"),
          lineWidth: S("ao", "width", 1.5),
          histogram: !0,
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (J("volosc")) {
    const vf = S("volosc", "fast", 5),
      vs = S("volosc", "slow", 20),
      I = r.map((D, M) => {
        if (M < vs - 1) return { index: M, value: null };
        const L = r.slice(M - vf + 1, M + 1).reduce((ee, V) => ee + V, 0) / vf,
          H = r.slice(M - vs + 1, M + 1).reduce((ee, V) => ee + V, 0) / vs;
        return { index: M, value: H === 0 ? 0 : ((L - H) / H) * 100 };
      });
    v.volosc = {
      label: "거래량추세(" + vf + "," + vs + ")",
      lines: [
        {
          data: I,
          color: S("volosc", "color", "#8E7D72"),
          lineWidth: S("volosc", "width", 1.5),
        },
      ],
      hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
    };
  }
  if (o.subCharts) {
    for (const s of Object.keys(o.subCharts))
      if (!(s in v)) {
        const d = {
          equity: "v12sig",
          udrsi: "_u",
          udstoch: "udstoch",
          rsimfi: "rsimfi",
          stc: "stc",
          pasrpvi: "pasrpvi",
          udrsi_opt: "_uopt",
          udstoch_opt: "_uopt",
          udrsi_orig: "_u_orig",
          udrsi_1m: "_u_1m",
          udrsi_1y: "_u_1y",
          udstoch_orig: "udstoch_orig",
          udstoch_1m: "udstoch_1m",
          udstoch_1y: "udstoch_1y",
          rsimfi_orig: "rsimfi_orig",
          rsimfi_1m: "rsimfi_1m",
          rsimfi_1y: "rsimfi_1y",
          stc_orig: "stc_orig",
          stc_1m: "stc_1m",
          stc_1y: "stc_1y",
          pasr_orig: "pasr_orig",
          pasr_1m: "pasr_1m",
          pasr_1y: "pasr_1y",
          udrsi_1yo: "_u_1yo",
          udstoch_1yo: "udstoch_1yo",
          rsimfi_1yo: "rsimfi_1yo",
          stc_1yo: "stc_1yo",
          pasr_1yo: "pasr_1yo",
        }[s];
        d &&
          document
            .querySelector(`[data-ind="${d}"]`)
            ?.classList.contains("on") &&
          (v[s] = o.subCharts[s]);
      }
  }
  if (window._customSUB)
    for (const s of window._customSUB) {
      const l = s.period || 14;
      if (s.type === "RSI") {
        const d = [0],
          p = [0];
        for (let g = 1; g < e.length; g++) {
          const w = e[g] - e[g - 1];
          (d.push(w > 0 ? w : 0), p.push(w < 0 ? -w : 0));
        }
        const c = m(d, l),
          u = m(p, l);
        v[s.id] = {
          label: `RSI ${l}`,
          lines: [
            {
              data: c.map((g, w) => ({
                index: w,
                value: u[w] === 0 ? 100 : 100 - 100 / (1 + g / u[w]),
              })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [
            { value: 70, color: "rgba(59,130,246,0.6)" },
            { value: 30, color: "rgba(196,56,75,0.6)" },
          ],
          range: { min: 0, max: 100 },
        };
      } else if (s.type === "MACD") {
        const d = O(e, l),
          p = O(e, l * 2),
          c = d.map((g, w) => g - p[w]),
          u = O(c, _mg);
        v[s.id] = {
          label: `MACD ${l}`,
          lines: [
            {
              data: c.map((g, w) => ({ index: w, value: g })),
              color: s.color,
              lineWidth: 1.5,
            },
            {
              data: u.map((g, w) => ({ index: w, value: g })),
              color: "#D8B66A",
              lineWidth: 1,
            },
          ],
          hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
        };
      } else if (s.type === "STOCH") {
        const d = [];
        for (let c = 0; c < e.length; c++) {
          const u = Math.max(0, c - l + 1);
          let g = -1 / 0,
            w = 1 / 0;
          for (let h = u; h <= c; h++)
            (n[h] > g && (g = n[h]), a[h] < w && (w = a[h]));
          d.push(g === w ? 50 : ((e[c] - w) / (g - w)) * 100);
        }
        const p = i(d, 3);
        v[s.id] = {
          label: `Stoch ${l}`,
          lines: [
            {
              data: p.map((c, u) => ({ index: u, value: c })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [
            { value: 80, color: "rgba(59,130,246,0.6)" },
            { value: 20, color: "rgba(196,56,75,0.6)" },
          ],
          range: { min: 0, max: 100 },
        };
      } else if (s.type === "ATR") {
        const d = b(n, a, e, l);
        v[s.id] = {
          label: `ATR ${l}`,
          lines: [
            {
              data: d.map((p, c) => ({ index: c, value: p })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
        };
      } else if (s.type === "CCI") {
        const d = [];
        for (let p = 0; p < e.length; p++) {
          const c = (n[p] + a[p] + e[p]) / 3,
            u = Math.max(0, p - l + 1);
          let g = 0;
          for (let _ = u; _ <= p; _++) g += (n[_] + a[_] + e[_]) / 3;
          const w = g / (p - u + 1);
          let h = 0;
          for (let _ = u; _ <= p; _++)
            h += Math.abs((n[_] + a[_] + e[_]) / 3 - w);
          ((h /= p - u + 1), d.push(h === 0 ? 0 : (c - w) / (0.015 * h)));
        }
        v[s.id] = {
          label: `CCI ${l}`,
          lines: [
            {
              data: d.map((p, c) => ({ index: c, value: p })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [
            { value: 100, color: "rgba(59,130,246,0.6)" },
            { value: -100, color: "rgba(196,56,75,0.6)" },
          ],
        };
      } else if (s.type === "MFI") {
        const d = [],
          p = [0],
          c = [0];
        for (let g = 0; g < e.length; g++) d.push((n[g] + a[g] + e[g]) / 3);
        for (let g = 1; g < e.length; g++) {
          const w = d[g] * r[g];
          d[g] > d[g - 1] ? (p.push(w), c.push(0)) : (p.push(0), c.push(w));
        }
        const u = [];
        for (let g = 0; g < e.length; g++) {
          if (g < l) {
            u.push(50);
            continue;
          }
          let w = 0,
            h = 0;
          for (let _ = g - l + 1; _ <= g; _++) ((w += p[_]), (h += c[_]));
          u.push(h === 0 ? 100 : 100 - 100 / (1 + w / h));
        }
        v[s.id] = {
          label: `MFI ${l}`,
          lines: [
            {
              data: u.map((g, w) => ({ index: w, value: g })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [
            { value: 80, color: "rgba(59,130,246,0.6)" },
            { value: 20, color: "rgba(196,56,75,0.6)" },
          ],
          range: { min: 0, max: 100 },
        };
      } else if (s.type === "ROC") {
        const d = [];
        for (let p = 0; p < e.length; p++) {
          if (p < l) {
            d.push(0);
            continue;
          }
          d.push(((e[p] - e[p - l]) / e[p - l]) * 100);
        }
        v[s.id] = {
          label: `ROC ${l}`,
          lines: [
            {
              data: d.map((p, c) => ({ index: c, value: p })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
        };
      } else if (s.type === "WILLR") {
        const d = [];
        for (let p = 0; p < e.length; p++) {
          const c = Math.max(0, p - l + 1);
          let u = -1 / 0,
            g = 1 / 0;
          for (let w = c; w <= p; w++)
            (n[w] > u && (u = n[w]), a[w] < g && (g = a[w]));
          d.push(u === g ? -50 : ((e[p] - u) / (u - g)) * 100);
        }
        v[s.id] = {
          label: `W%R ${l}`,
          lines: [
            {
              data: d.map((p, c) => ({ index: c, value: p })),
              color: s.color,
              lineWidth: 1.5,
            },
          ],
          hlines: [
            { value: -20, color: "rgba(59,130,246,0.6)" },
            { value: -80, color: "rgba(196,56,75,0.6)" },
          ],
          range: { min: -100, max: 0 },
        };
      }
    }
  ((o.subCharts = v),
    o._recalcLayout && o._recalcLayout(),
    (o._dirty = !0),
    Te(),
    (function () {
      if (window._restoreSubRatios) {
        try {
          window.applyRestoredSubRatios && window.applyRestoredSubRatios();
        } catch (_) {}
      }
    })());
}
((window._updateActiveIndList = Te),
  (window._closeInd = function (e) {
    if (e && e.indexOf("strat_") === 0) {
      const s = document.querySelector(`[data-strategy="${e.slice(6)}"]`);
      s && s.classList.contains("on") && s.click();
      Te();
      return;
    }
    if (e && e.indexOf("cma_") === 0) {
      const p = e.replace("cma_", "").split("_"),
        ty = p[0],
        pe = parseInt(p[1]);
      const tgt = (window._customMA || []).find(
        (m) => m.type === ty && m.period === pe,
      );
      window._customMA = (window._customMA || []).filter(
        (m) => !(m.type === ty && m.period === pe),
      );
      if (window.saveCustomInds) saveCustomInds();
      if (tgt && o && o.removeIndicator) o.removeIndicator(tgt.id);
      if (window.renderCustomMA) renderCustomMA();
      if (window.calcIndicators) calcIndicators();
      Te();
      return;
    }
    if (e && e.indexOf("csub_") === 0) {
      const ty = e.replace("csub_", "");
      window._customSUB = (window._customSUB || []).filter(
        (s) => s.type !== ty,
      );
      if (window.saveCustomInds) saveCustomInds();
      if (window.renderCustomSUB) renderCustomSUB();
      if (window.calcIndicators) calcIndicators();
      Te();
      return;
    }
    const n =
      document.querySelector(`[data-ind="${e}"]`) ||
      document.querySelector(`[data-sub="${e}"]`);
    (n && n.classList.contains("on") && n.click(), Te());
  }));
function Te() {
  const e = document.getElementById("activeIndList");
  if (!e) return;
  const n = [],
    a = "#D8B66A",
    r = "#D8B66A",
    i = {
      ema9: "#921230",
      ema20: "#D8B66A",
      ema50: "#A31540",
      ema200: "#FF4C53",
      sma50: "#921230",
      sma200: "#FF4C53",
      dema: "#C4384B",
      bb: "#921230",
      vwap: "#D8B66A",
      ichimoku: "#D8B66A",
      psar: "#D8B66A",
      keltner: "#A31540",
      envelope: "#D8B66A",
    },
    y = (f, m, b) => {
      const s = document.body.classList.contains("dark")
        ? "rgba(20,56,69,0.92)"
        : "rgba(247,241,234,0.9)";
      return `<span data-indid="${f}" style="font-size:14px;color:${b};background:${s};padding:3px 8px;border-radius:4px;pointer-events:auto;cursor:pointer;border:1px solid ${b}55;position:relative" title="${m} \xB7 \uD074\uB9AD: \uC124\uC815" onmouseenter="this.querySelector('.ind-close').style.display='block'" onmouseleave="this.querySelector('.ind-close').style.display='none'">${m}<button class="ind-close" data-indclose="${f}" style="display:none;position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:${b};color:#fff;border:none;font-size:9px;line-height:14px;cursor:pointer;padding:0" onclick="event.stopPropagation();window._closeInd('${f}')">\u2715</button></span>`;
    };
  (document
    .querySelectorAll(
      ".ind-tag.on:not(.pro-ind):not(.member-ind):not(.sub-ind)",
    )
    .forEach((f) => {
      const m = f.dataset.ind;
      m &&
        n.push(
          y(m, f.textContent.replace(/[\s]+$/g, "").trim(), i[m] || "#8E7D72"),
        );
    }),
    document
      .querySelectorAll(".ind-tag.member-ind.on:not(.pro-ind)")
      .forEach((f) => {
        const m = f.dataset.ind;
        m && n.push(y(m, f.textContent.replace(/[\s]+$/g, "").trim(), r));
      }),
    document.querySelectorAll(".pro-ind.on").forEach((f) => {
      const m = f.dataset.ind || f.dataset.sub;
      n.push(y(m || "pro", f.textContent.replace(/[\s]+$/g, "").trim(), a));
    }),
    document
      .querySelectorAll(".sub-ind.on:not(.pro-ind):not(.member-ind)")
      .forEach((f) => {
        const m = f.dataset.sub;
        n.push(
          y(m || "sub", f.textContent.replace(/[\s]+$/g, "").trim(), "#921230"),
        );
      }),
    document
      .querySelectorAll(".sub-ind.member-ind.on:not(.pro-ind)")
      .forEach((f) => {
        const m = f.dataset.sub;
        n.push(y(m || "sub", f.textContent.replace(/[\s]+$/g, "").trim(), r));
      }),
    (window._customMA || []).forEach((f) =>
      n.push(
        y(
          "cma_" + f.type + "_" + f.period,
          f.type.toUpperCase() + " " + f.period,
          f.color || "#C4384B",
        ),
      ),
    ),
    (window._customSUB || []).forEach((f) =>
      n.push(y("csub_" + f.type, f.type.toUpperCase(), "#A31540")),
    ),
    document.querySelectorAll("[data-strategy].on").forEach((f) => {
      const m = f.dataset.strategy;
      m &&
        n.push(
          y(
            "strat_" + m,
            f.textContent.replace(/[\s]+$/g, "").trim(),
            "#6A1E33",
          ),
        );
    }),
    (e.innerHTML = n.join("")),
    e.querySelectorAll("span[data-indid]").forEach((f) =>
      f.addEventListener("click", (m) => {
        m.stopPropagation();
        const b = f.dataset.indid,
          v = (
            f.childNodes[0] && f.childNodes[0].nodeType === 3
              ? f.childNodes[0].textContent
              : f.textContent
          ).trim();
        if (b.startsWith("strat_")) {
          const sid = b.slice(6),
            sbtn = document.querySelector(`[data-strategy="${sid}"]`);
          sbtn &&
            window._openStrategySettings &&
            window._openStrategySettings(sbtn, !0);
          return;
        }
        if (b.startsWith("cma_")) {
          const u = b.replace("cma_", "").split("_")[0],
            g = document.querySelector(".ind-bar");
          (g &&
            (g.classList.add("open"),
            document
              .querySelectorAll("[data-drawer-group]")
              .forEach((w) => (w.style.display = "none")),
            document
              .querySelectorAll('[data-drawer-group="public"]')
              .forEach((w) => (w.style.display = ""))),
            window.openSettings && window.openSettings(v, u, null, null));
          return;
        }
        const s = document.querySelector(".ind-bar"),
          l = document.querySelector(`[data-sub="${b}"]`) ? b : null,
          d = document.querySelector(`[data-ind="${b}"]`) ? b : null,
          p = document.querySelector(`[data-ma-type="${b}"]`) ? b : null;
        (s &&
          (s.classList.add("open"),
          document
            .querySelectorAll("[data-drawer-group]")
            .forEach((c) => (c.style.display = "none")),
          document.querySelector(
            `.pro-ind[data-ind="${b}"],.pro-ind[data-sub="${b}"],.member-ind[data-ind="${b}"]`,
          )
            ? document
                .querySelectorAll('[data-drawer-group="beom"]')
                .forEach((c) => (c.style.display = ""))
            : document
                .querySelectorAll('[data-drawer-group="public"]')
                .forEach((c) => (c.style.display = ""))),
          window.openSettings && window.openSettings(v, p, l, d));
      }),
    ));
}
window._showCustomMASettings = fo;
function fo(e, n) {
  const a = e.replace("cma_", "").split("_"),
    r = a[0],
    i = parseInt(a[1]),
    y = window._customMA.find((m) => m.type === r && m.period === i);
  if (!y) return;
  let f = `<div style="font-weight:700;margin-bottom:6px;color:#032129">${n}</div>`;
  ((f += `<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0"><span>\uAE30\uAC04</span><input type="number" value="${y.period}" min="1" max="500" id="_cma_p" style="width:50px;background:#FFFDF9;border:1px solid var(--border);border-radius:6px;color:var(--text);padding:2px 4px;font-size:14px"></div>`),
    (f += `<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0"><span>\uC0C9\uC0C1</span><input type="color" value="${y.color || "#ffffff"}" id="_cma_c" style="width:30px;height:20px;border:none;cursor:pointer"></div>`),
    (f += `<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0"><span>\uAD75\uAE30</span><input type="number" value="${y.width || 1}" min="1" max="5" id="_cma_w" style="width:50px;background:#FFFDF9;border:1px solid var(--border);border-radius:6px;color:var(--text);padding:2px 4px;font-size:14px"></div>`),
    (f += `<div style="display:flex;gap:4px;margin-top:6px"><button onclick="const i=window._customMA.findIndex(m=>m.type==='${r}'&&m.period===${i});if(i>=0){window._customMA[i].period=parseInt(document.getElementById('_cma_p').value);window._customMA[i].color=document.getElementById('_cma_c').value;window._customMA[i].width=parseInt(document.getElementById('_cma_w').value);saveCustomInds();calcIndicators();_updateActiveIndList();}indSettingsPopup.style.display='none'" style="flex:1;padding:3px;background:#C4384B;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer">\uC801\uC6A9</button>`),
    (f += `<button onclick="window._customMA=window._customMA.filter(m=>!(m.type==='${r}'&&m.period===${i}));saveCustomInds();renderCustomMA();calcIndicators();_updateActiveIndList();indSettingsPopup.style.display='none'" style="flex:1;padding:3px;background:none;border:1px solid #3B82F6;color:#3B82F6;border-radius:6px;font-size:14px;cursor:pointer">\uC0AD\uC81C</button></div>`),
    (K.innerHTML = f),
    (K.style.left = "50%"),
    (K.style.top = "50%"),
    (K.style.transform = "translate(-50%,-50%)"),
    (K.style.display = "block"));
}
window._showCustomSUBSettings = po;
function po(e, n) {
  const a = e.replace("csub_", "");
  if (!window._customSUB.find((y) => y.type === a)) return;
  let i = `<div style="font-weight:700;margin-bottom:6px;color:#032129">${n}</div>`;
  ((i += `<button onclick="window._customSUB=window._customSUB.filter(s=>s.type!=='${a}');saveCustomInds();renderCustomSUB();calcIndicators();_updateActiveIndList();indSettingsPopup.style.display='none'" style="padding:3px 8px;background:none;border:1px solid #3B82F6;color:#3B82F6;border-radius:6px;font-size:14px;cursor:pointer;width:100%">\uC0AD\uC81C</button>`),
    (K.innerHTML = i),
    (K.style.left = "50%"),
    (K.style.top = "50%"),
    (K.style.transform = "translate(-50%,-50%)"),
    (K.style.display = "block"));
}
let tt = null;
async function mo(e) {
  if (!Q) {
    ht();
    return;
  }
  if (ae.length > 0 && ae[0] !== "ultra") {
    ht();
    return;
  }
  const n = e?.symbol || B,
    a = e?.timeframe || A;
  try {
    const i = await (
      await q(
        `${F}/v1/charts/ind-b?symbolId=${encodeURIComponent(n)}&timeframe=${encodeURIComponent(a)}&limit=${o.buffer.length || 2e3}`,
      )
    ).json();
    if (!j(e)) return;
    (i.success &&
      i.data?.d &&
      i.data.d.length >= o.buffer.length - 5 &&
      (o._uc = i.data.d),
      i.success && i.data?.t && ht(i.data.t.v),
      i.success &&
        i.data?._delay &&
        typeof Fe == "function" &&
        Fe(i.data._delay));
  } catch {}
}
function ht(e) {
  const n = document.getElementById("signalBadge");
  n && (n.style.display = "none");
}
async function yo(e) {
  if (!(!o || !o.overlay) && !(!o || !o.overlay || !G())) {
    o.overlay.drawings = o.overlay.drawings.filter(
      (n) => n.type !== "alert_line" && !n._alertLine,
    );
    try {
      const a = await (
        await q(`${F}/v1/alerts`, { headers: { ...Me() } })
      ).json();
      if (!j(e) || !a.success) return;
      for (const r of a.data?.items || a.data || [])
        r.symbol_code === B &&
          r.target_price &&
          r.is_active &&
          o.addDrawing({
            type: "horizontal",
            price: parseFloat(r.target_price),
            color: "#D8B66A",
            dash: [4, 4],
            label: `${r.rule_type}`,
            _alertLine: !0,
          });
    } catch {}
  }
}
function U() {
  if (!o) return;
  if (!G()) {
    o.overlay.drawings = [];
    o._dirty = true;
    return;
  }
  const e = { id: wt, symbol: B, timeframe: A };
  (mo(e),
    yo(e),
    (o.overlay.drawings = o.overlay.drawings.filter(
      (i) =>
        i.type === "demo_action" ||
        i.type === "autobot_marker" ||
        i.type === "autobot_entry" ||
        i.type === "forecast" ||
        i.type === "projection" ||
        (i._calcOwner === "ms" && ie) ||
        (i._calcOwner === "btp" &&
          typeof window.showBimacoTP < "u" &&
          window.showBimacoTP) ||
        i._calcOwner === "ba2",
    )),
    (o._dirty = !0),
    tt && clearTimeout(tt),
    (tt = setTimeout(async () => {
      if (((tt = null), !o || !j(e))) return;
      const n = document.getElementById("chartLoading");
      n &&
        ((n.style.display = "block"),
        (n.textContent = t("\uC9C0\uD45C \uACC4\uC0B0 \uC911...")));
      const a = o.overlay.drawings.filter(
        (i) =>
          i.type === "demo_action" ||
          i.type === "autobot_marker" ||
          i.type === "autobot_entry" ||
          i.type === "forecast" ||
          i.type === "projection" ||
          (i._calcOwner === "ms" && ie) ||
          (i._calcOwner === "btp" &&
            typeof window.showBimacoTP < "u" &&
            window.showBimacoTP) ||
          i._calcOwner === "ba2",
      );
      if (((o.overlay.drawings = [...a]), Q))
        try {
          const y = await (
            await q(
              `${F}/v1/charts/ind-b?symbolId=${encodeURIComponent(e.symbol)}&timeframe=${encodeURIComponent(e.timeframe)}&limit=${o.buffer.length || 2e3}`,
            )
          ).json();
          if (e.symbol !== B || e.timeframe !== A) return;
          if (y.success && y.data) {
            o._uc = y.data.d;
            const f = y.data.s || [],
              m = f.filter((l) => l.type === "ku" || l.type === "kd"),
              b = f.filter((l) => l.type === "buy" || l.type === "sell"),
              v = m.length ? m[m.length - 1] : null,
              s = b.length ? b[b.length - 1] : null;
            ((window._prevLastAIIdx = v ? v.index : -1),
              (window._prevLastBSIdx = s ? s.index : -1));
            for (const l of f)
              l.type === "ku"
                ? o.addDrawing({
                    type: "signal",
                    index: l.index,
                    price: l.price,
                    signalType: "ku",
                  })
                : l.type === "kd"
                  ? o.addDrawing({
                      type: "signal",
                      index: l.index,
                      price: l.price,
                      signalType: "kd",
                    })
                  : (l.type === "retest_up" || l.type === "retest_down") &&
                    o.addDrawing({
                      type: "signal",
                      index: l.index,
                      price: l.price,
                      signalType: "retest",
                    });
          }
        } catch {}
      if (
        (await Promise.all([
          Ot(e),
          Rt(e),
          Wt(e),
          Nt(e),
          Ut(e),
          jt(e),
          zt(e),
          Ht(e),
          Vt(e),
          Jt(e),
          bt(e),
          $t() ? loadAllComparisons(e) : Promise.resolve(),
          window.loadIndSignals ? window.loadIndSignals(e) : Promise.resolve(),
          window.loadBimacoTP ? window.loadBimacoTP(e) : Promise.resolve(),
          Kt(e),
          he ? ct(e) : Promise.resolve(),
          Be ? Ue(e) : Promise.resolve(),
          _e ? je(e) : Promise.resolve(),
          Ae ? At(e) : Promise.resolve(),
          we ? Ke(e) : Promise.resolve(),
          ve ? ft(ve, e) : Promise.resolve(),
        ]),
        !j(e))
      )
        return;
      (Y(), (o._dirty = !0));
      const r = document.getElementById("chartLoading");
      r &&
        ((r.style.display = "none"),
        (r.textContent = t("\uB85C\uB529 \uC911...")));
    }, 250)));
}
let wt = 0;
async function De() {
  ((window._prevLastAIIdx = void 0),
    (window._prevLastBSIdx = void 0),
    (window._lastObAlertKey = null));
  const e = B,
    n = A,
    r = { id: ++wt, symbol: e, timeframe: n },
    i = document.getElementById("chartLoading");
  try {
    i &&
      ((i.style.display = "block"),
      (i.textContent = t("\uB85C\uB529 \uC911...")));
    const y = window._chartDataContext || {};
    o &&
      (y.symbol !== e || y.timeframe !== n) &&
      (yt(e),
      i &&
        ((i.style.display = "block"),
        (i.textContent = t("\uB85C\uB529 \uC911..."))));
    const f = await q(
      `${F}/v1/charts/candles?symbolId=${encodeURIComponent(e)}&timeframe=${encodeURIComponent(n)}&limit=500`,
    );
    if (!j(r)) return;
    const m = await f.json();
    if (!j(r)) return;
    if (!m.success || !m.data?.candles?.length) {
      (yt(e, t("\uB370\uC774\uD130 \uC5C6\uC74C")), et());
      return;
    }
    (setTimeout(() => window._initReplay && _initReplay(), 3e3),
      localStorage.getItem("chartOS_firstVisitTip") ||
        setTimeout(() => {
          (window.showToast &&
            X(
              "\u{1F4A1} Shift+\uD074\uB9AD: \uC218\uD3C9\uC120 | \uB9C8\uC6B0\uC2A4 \uD720: \uC90C | \uB354\uBE14\uD074\uB9AD: \uCD08\uAE30\uD654",
              "#D8B66A",
              8e3,
            ),
            localStorage.setItem("chartOS_firstVisitTip", "1"));
        }, 5e3));
    const b = m.data.candles
      .map((l) => ({
        time:
          parseInt(l.openTime) > 1e12
            ? Math.floor(parseInt(l.openTime) / 1e3)
            : Math.floor(new Date(l.openTime).getTime() / 1e3),
        open: parseFloat(l.open),
        high: parseFloat(l.high),
        low: parseFloat(l.low),
        close: parseFloat(l.close),
        volume: parseFloat(l.volume || 0),
      }))
      .filter(
        (l) =>
          l.time > 0 &&
          Number.isFinite(l.open) &&
          Number.isFinite(l.high) &&
          Number.isFinite(l.low) &&
          Number.isFinite(l.close),
      );
    if (!j(r)) return;
    if (
      !b.length ||
      (b.length > 3 && new Set(b.map((x) => x.close)).size <= 1)
    ) {
      (yt(e, t("\uB370\uC774\uD130 \uC5C6\uC74C")), et());
      return;
    }
    if (!o) return;
    (o.loadBars(b),
      (o._watermark = e.replace("USDT", "")),
      (() => {
        try {
          if (o.overlay) {
            o.overlay.drawings = o.overlay.drawings.filter(
              (d) =>
                !["hline", "vline", "trendline", "fib", "text"].includes(
                  d.type,
                ),
            );
          }
          window._loadDrawings && window._loadDrawings();
        } catch {}
      })(),
      q("/v1/charts/ticker-24hr?symbol=" + e)
        .then((l) => l.json())
        .then((l) => {
          l &&
            l.lastPrice &&
            ((window._rt.lastPrice = parseFloat(l.lastPrice)),
            (window._rt.pct24h = parseFloat(l.priceChangePercent)),
            Ge());
        })
        .catch(() => {}));
    const s =
      y.symbol === e && y.timeframe === n
        ? o.overlay.drawings.filter(
            (l) =>
              (l.type === "fib" ||
                l.type === "hline" ||
                l.type === "trendline" ||
                l.type === "text") &&
              !l._autoTrend &&
              !l._ob &&
              !l._calcOwner &&
              !l._alertLine,
          )
        : [];
    o.clearDrawings();
    for (const l of s) o.addDrawing(l);
    if ((Lt(), Q))
      try {
        const d = await (
          await q(
            `${F}/v1/charts/ind-b?symbolId=${encodeURIComponent(e)}&timeframe=${encodeURIComponent(n)}&limit=${o.buffer.length || 2e3}`,
          )
        ).json();
        if (e !== B || n !== A) return;
        if (d.success && d.data?.d) {
          o._uc = d.data.d;
          for (const p of d.data.s || [])
            p.type === "ku"
              ? o.addDrawing({
                  type: "signal",
                  index: p.index,
                  price: p.price,
                  signalType: "ku",
                })
              : p.type === "kd"
                ? o.addDrawing({
                    type: "signal",
                    index: p.index,
                    price: p.price,
                    signalType: "kd",
                  })
                : (p.type === "retest_up" || p.type === "retest_down") &&
                  o.addDrawing({
                    type: "signal",
                    index: p.index,
                    price: p.price,
                    signalType: "retest",
                  });
        }
      } catch {}
    else o._uc = null;
    if (
      (Y(),
      await Promise.all([
        Ot(r),
        Rt(r),
        Wt(r),
        Nt(r),
        Ut(r),
        jt(r),
        zt(r),
        Ht(r),
        Vt(r),
        Jt(r),
        bt(r),
        $t() ? loadAllComparisons(r) : Promise.resolve(),
        window.loadIndSignals ? window.loadIndSignals(r) : Promise.resolve(),
        window.loadBimacoTP ? window.loadBimacoTP(r) : Promise.resolve(),
        Kt(r),
        he ? ct(r) : Promise.resolve(),
        Be ? Ue(r) : Promise.resolve(),
        _e ? je(r) : Promise.resolve(),
        Ae ? At(r) : Promise.resolve(),
        we ? Ke(r) : Promise.resolve(),
        ve ? ft(ve, r) : Promise.resolve(),
      ]),
      !j(r))
    )
      return;
    if (((window._chartDataContext = { symbol: e, timeframe: n }), !ye)) {
      const l = document.getElementById("v12Stats");
      l && (l.style.display = "none");
    }
    if (window._demoMarkers && window._demoMarkers.length) {
      const l = He[e] || e,
        d = window._demoMarkers.filter((p) => p.symbol === l || p.symbol === e);
      for (const p of d.slice(-20))
        o.addDrawing({
          type: "demo_action",
          price: p.price,
          index: p.idx,
          label: p.label,
          action:
            p.action === "long"
              ? "long_entry"
              : p.action === "short"
                ? "short_entry"
                : p.action,
          time_str: p.time_str,
        });
    }
    ((window._rt.timeframe = n),
      Et(b[b.length - 1].close, b[b.length - 1].open),
      i &&
        ((i.style.display = "none"),
        (i.textContent = t("\uB85C\uB529 \uC911..."))),
      et(),
      setTimeout(() => {
        const l = localStorage.getItem("chartOS_heroSeen");
      }, 800));
  } catch {
    const f = document.getElementById("chartLoading");
    (f &&
      ((f.style.display = "block"),
      (f.textContent = t("\uB370\uC774\uD130 \uB85C\uB4DC \uC2E4\uD328"))),
      X(t("\uCC28\uD2B8 \uB370\uC774\uD130 \uB85C\uB4DC \uC2E4\uD328")),
      et());
  }
}
async function Ot(e) {
  if (ne)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/orderblocks?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success) return;
      o.overlay.drawings = o.overlay.drawings.filter((i) => i.type !== "ob");
      const r = a.data;
      for (const i of r.bull || [])
        o.addDrawing({
          type: "ob",
          top: i.top,
          bottom: i.bottom,
          obType: "bull",
          breaker: i.breaker,
          volume: i.volume,
          buy_pct: i.buy_pct,
          sell_pct: i.sell_pct,
          start_idx: i.start_idx,
          break_idx: i.break_idx,
          obHighVolume: i.obHighVolume,
          obLowVolume: i.obLowVolume,
        });
      for (const i of r.bear || [])
        o.addDrawing({
          type: "ob",
          top: i.top,
          bottom: i.bottom,
          obType: "bear",
          breaker: i.breaker,
          volume: i.volume,
          buy_pct: i.buy_pct,
          sell_pct: i.sell_pct,
          start_idx: i.start_idx,
          break_idx: i.break_idx,
          obHighVolume: i.obHighVolume,
          obLowVolume: i.obLowVolume,
        });
      o.overlay.drawings = o.overlay.drawings.filter(
        (i) => i.type !== "ob_entry",
      );
    } catch {}
}
var se = !1,
  ne = !1;
async function Rt(e) {
  if (se)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/trendlines?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || a.data?._access) return;
      o.overlay.drawings = o.overlay.drawings.filter((y) => !y._autoTrend);
      const r = S("autotrend", "color", ""),
        i = S("autotrend", "width", 0);
      for (const y of Array.isArray(a.data) ? a.data : [])
        if (y.type === "horizontal") {
          const f = y.points[0].price,
            m = y.label || "";
          o.addDrawing({
            type: "hline",
            price: f,
            color: r || y.color,
            lineWidth: i || y.lineWidth || 1,
            label: m,
            _autoTrend: !0,
          });
        } else
          o.addDrawing({
            type: "trendline",
            points: y.points,
            color: r || y.color,
            lineWidth: i || 2,
            _autoTrend: !0,
          });
    } catch {}
}
var Q = !1;
async function Zo(e) {
  if (Q)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-b?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data;
      r.d && o.buffer.length > 0 && ((o._uc = r.d), (o._dirty = !0));
      for (const i of r.s || [])
        i.type === "buy"
          ? o.addDrawing({
              type: "signal",
              index: i.index,
              price: i.price,
              signalType: "trend_buy",
            })
          : i.type === "sell"
            ? o.addDrawing({
                type: "signal",
                index: i.index,
                price: i.price,
                signalType: "trend_sell",
              })
            : i.type === "ku"
              ? o.addDrawing({
                  type: "signal",
                  index: i.index,
                  price: i.price,
                  signalType: "ku",
                })
              : i.type === "kd" &&
                o.addDrawing({
                  type: "signal",
                  index: i.index,
                  price: i.price,
                  signalType: "kd",
                });
      if (r.t) {
        const i = r.t,
          y =
            i.v >= 7
              ? "var(--red)"
              : i.v <= -7
                ? "var(--accent)"
                : "var(--muted)";
        document.getElementById("aiResult").innerHTML = `
        <div class="ai-section"><h4>\uD1B5\uD569 \uD2B8\uB80C\uB4DC (${A})</h4>
        <p style="font-size:14px;color:${y}"><b>${i.v} / ${i.max_signals}</b></p></div>`;
      }
    } catch {}
}
var Ce = !1;
async function en(e) {
  if (Ce) {
    if (Z()) {
      ((Ce = !1),
        document
          .querySelector("[data-ind=ultra_free]")
          ?.classList.remove("on"));
      return;
    }
    try {
      const a = await (
        await q(`${F}/v1/charts/ind-b?symbolId=${B}&timeframe=${A}&limit=500`)
      ).json();
      if (!j(e) || !a.success || !a.data?.d) return;
      ((o._uf = a.data.d), (o._dirty = !0));
    } catch {}
  }
}
window._toggleBimacoFree = function () {
  if (Z()) {
    (X(
      "VIP\uD68C\uC6D0\uC740 \uBC94\uC628 \uCE94\uB4E4(VIP) \uC9C0\uD45C\uB97C \uC0AC\uC6A9\uD558\uC138\uC694",
      "#D8B66A",
    ),
      document.querySelector("[data-ind=ultra_free]")?.classList.remove("on"));
    return;
  }
  ((Ce = !Ce),
    document.querySelector("[data-ind=ultra_free]")?.classList.toggle("on", Ce),
    !Ce && o && ((o._uf = null), (o._dirty = !0)),
    U(),
    z());
};
function go() {
  const e = document.getElementById("ultraFreeTag");
  e &&
    (Z()
      ? ((e.style.display = "none"),
        Ce &&
          ((Ce = !1),
          document
            .querySelector("[data-ind=ultra_free]")
            ?.classList.remove("on"),
          o && ((o._uf = null), (o._dirty = !0))))
      : (e.style.display = ""));
}
var ot = !1,
  We = !1;
async function tn(e) {
  if (ot)
    try {
      const a = await (
        await q(`${F}/v1/charts/signals/pvi-nvi?symbolId=${B}&timeframe=${A}`)
      ).json();
      if (!j(e) || !a.success) return;
      for (const r of a.data || [])
        o.addDrawing({
          type: "signal",
          index: r.index,
          price: r.price,
          signalType: r.type,
        });
    } catch {}
}
async function on(e) {
  if (We)
    try {
      const a = await (
        await q(`${F}/v1/charts/signals/patterns?symbolId=${B}&timeframe=${A}`)
      ).json();
      if (!j(e) || !a.success) return;
      for (const r of a.data || [])
        o.addDrawing({
          type: "pattern",
          index: r.index,
          price: r.price,
          pattern: r.pattern,
          patternType: r.type,
          side: r.side,
          span: r.span,
        });
    } catch {}
}
var le = !1;
async function Wt(e) {
  if (le)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/signals/ttr?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      for (const r of a.data.signals || [])
        (r.type === "tp_buy" || r.type === "tp_sell") &&
          o.addDrawing({
            type: "ttr",
            index: r.index,
            price: r.price,
            ttrType: r.type,
          });
    } catch {}
}
var ie = !1,
  me = !1;
async function Nt(e) {
  if (ie)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/signals/buy-scanner?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&sma_fast=8&sma_slow=30&ema_long=100&_t=${Date.now()}`,
        )
      ).json();
      if (!j(e) || !a.success) return;
      for (const r of a.data || [])
        o.addDrawing({
          type: "buy_scan",
          index: r.index,
          price: r.price,
          cross: r.cross,
          scanType: r.type,
        });
    } catch {}
}
async function Ut(e) {
  if (me)
    try {
      o &&
        o.overlay &&
        (o.overlay.drawings = o.overlay.drawings.filter(
          (r) => r.type !== "alignment" || r.ver,
        ));
      const a = await (
        await q(
          `${F}/v1/charts/signals/alignment?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&con2=-30&con3=5&_t=${Date.now()}`,
        )
      ).json();
      if (!j(e) || !a.success) return;
      for (const r of a.data || [])
        o.addDrawing({
          type: "alignment",
          index: r.index,
          price: r.price,
          alignType: r.type,
        });
    } catch {}
}
async function jt(e) {
  if (oe && !(ae.length > 0 && ae[0] !== "bimaco2"))
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-d?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if ((e && (e.symbol !== B || e.timeframe !== A)) || !a.success || !a.data)
        return;
      a.data._delay && Fe(a.data._delay);
      const r = {
        maroon: "rgba(128,0,0,0.9)",
        red: "rgba(255,26,26,0.95)",
        purple: "rgba(128,0,128,0.9)",
        blue: "rgba(0,0,128,0.9)",
        yellow: "rgba(255,255,0,0.9)",
        orange: "rgba(255,165,0,0.9)",
      };
      o._bc = (a.data.d || []).map((y) => ({
        index: y.index,
        color: r[y.color] || "rgba(128,128,128,0.3)",
        border:
          y.border === "lime"
            ? "#C4384B"
            : y.border === "red_border"
              ? "#3B82F6"
              : "",
        ho: y.ho,
        hh: y.hh,
        hl: y.hl,
        hc: y.hc,
      }));
    } catch {}
}
async function zt(e) {
  const n = document.getElementById("entryState");
  if (!be) {
    n && (n.style.display = "none");
    return;
  }
  try {
    const r = await (
      await q(
        `${F}/v1/charts/ind-f?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
      )
    ).json();
    if (!j(e) || !r.success || !r.data) return;
    for (const y of r.data.signals || [])
      o.addDrawing({
        type: "entry_signal",
        index: y.index,
        price: y.price,
        side: y.type,
        pct: y.pct,
      });
    const i = r.data.states || [];
    if (i.length) {
      const y = i[i.length - 1];
      let f = document.getElementById("entryState");
      f ||
        ((f = document.createElement("div")),
        (f.id = "entryState"),
        (f.style.cssText =
          "position:absolute;top:50px;left:10px;background:rgba(13,18,32,0.9);border:1px solid rgba(234,179,8,0.3);border-radius:6px;padding:6px 10px;font-size:14px;z-index:100;color:#032129"),
        document.querySelector(".chart-wrap").appendChild(f));
      const m =
          y.direction === 1
            ? '<span style="color:#C4384B">\uB9E4\uC218\u25B2</span>'
            : y.direction === -1
              ? '<span style="color:#3B82F6">\uB9E4\uB3C4\u25BC</span>'
              : '<span style="color:#8E7D72">-</span>',
        b = [
          { name: "\uAC15\uB3C4", v: y.rsi },
          { name: "\uACFC\uC5F4", v: y.stoch },
          { name: "\uB9E4\uB9E4\uC555\uB825", v: y.rmfi },
          { name: "\uCD94\uC138\uC804\uD658", v: y.stc },
          { name: "\uC790\uAE08\uD750\uB984", v: y.pvi },
        ];
      let v = `<div style="font-weight:600;color:#D8B66A;margin-bottom:3px">Entry ${m} <span style="font-size:14px;color:#8E7D72">${y.bull_count}\u25B2 ${y.bear_count}\u25BC</span></div><div style="display:flex;gap:2px">`;
      for (const s of b) {
        const l = s.v === "\u25B2" ? "#C4384B" : "#3B82F6",
          d = (s.v === "\u25B2", "rgba(59,130,246,0.15)");
        v += `<span style="color:${l};background:${d};padding:1px 4px;border-radius:6px;font-size:14px">${s.name}${s.v}</span>`;
      }
      ((v += "</div>"), (f.innerHTML = v), (f.style.display = "block"));
    }
  } catch {}
  if (!be) {
    const a = document.getElementById("entryState");
    a && (a.style.display = "none");
  }
}
async function Ht(e) {
  if (Se)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-g?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      for (const r of a.data.signals || [])
        o.addDrawing({
          type: "entry_signal",
          index: r.index,
          price: r.price,
          side: r.type,
          pct: r.pct,
        });
    } catch {}
}
var ye = !1;
window._toggleV12sig = function () {
  if (requireLogin("v12")) {
    if (
      ((ye = !ye),
      document.querySelector('[data-ind="v12sig"]')?.classList.toggle("on", ye),
      !ye)
    ) {
      const e = document.getElementById("v12Stats");
      e && (e.style.display = "none");
    }
    (U(), z());
  }
};
async function Vt(e) {
  if (ye)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-l?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data,
        i =
          {
            "1m": 6e4,
            "3m": 18e4,
            "5m": 3e5,
            "15m": 9e5,
            "30m": 18e5,
            "1h": 36e5,
            "4h": 144e5,
            "1d": 864e5,
          }[A] || 3e5;
      for (const m of r.markers || []) {
        let b = m.index;
        if (m.ts && o.buffer) {
          const v = o.buffer.findIndex((s) => {
            const l = s.openTime || s.open_time || s.t || 0;
            return Math.abs(l - m.ts) < i * 0.9;
          });
          if (v >= 0) b = v;
          else continue;
        }
        o.addDrawing({
          type: "backtest_marker",
          index: b,
          price: m.price,
          label: m.label,
          action: m.type || m.action,
        });
      }
      const y = r.stats || {};
      if (y.total_trades > 0) {
        let m = document.getElementById("v12Stats");
        m ||
          ((m = document.createElement("div")),
          (m.id = "v12Stats"),
          (m.style.cssText =
            "position:absolute;top:50px;left:10px;background:rgba(255,253,249,0.95);border:1px solid rgba(216,182,106,0.35);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--color-text-primary);z-index:100;min-width:180px;box-shadow:0 2px 8px rgba(106,30,51,0.08)"),
          document.querySelector(".chart-wrap").appendChild(m));
        const b = y.return_pct >= 0 ? "#C4384B" : "#3B82F6";
        ((m.innerHTML = `<div style="font-weight:700;color:#A31540;margin-bottom:6px">VIP \uC2DC\uADF8\uB110</div>
        <div>\uAC70\uB798: ${y.total_trades}\uAC74 (${y.wins}W/${y.losses}L)</div>
        <div>\uC2B9\uB960: <span style="color:${y.win_rate >= 50 ? "#C4384B" : "#3B82F6"}">${y.win_rate}%</span></div>
        <div>\uC218\uC775\uB960: <span style="color:${b}">${y.return_pct >= 0 ? "+" : ""}${y.return_pct}%</span></div>
        <div>\uCD5C\uB300DD: <span style="color:#3B82F6">${y.max_drawdown}%</span></div>`),
          (m.style.display = "block"));
      }
      const f = r.equity || [];
      f.length > 0 &&
        o.setSubChart("equity", {
          lines: [{ data: f, color: "#A31540", lineWidth: 1.5 }],
          hlines: [{ value: 1e4, color: "rgba(107,114,128,0.3)" }],
          label: "VIP \uC790\uC0B0\uACE1\uC120",
        });
    } catch {}
}
var de = !1,
  ce = !1,
  ue = !1,
  fe = !1,
  ge = !1;
let ho = null;
((window._toggleUprsi = function () {
  requireLogin("\uAC15\uB3C4\uCE21\uC815") &&
    ((de = !de),
    document.querySelector('[data-ind="_u"]').classList.toggle("on", de),
    !de && o && o.removeSubChart("udrsi"),
    U(),
    z());
}),
  (window._toggleUdstoch = function () {
    requireLogin("\uACFC\uC5F4\uBD84\uC11D") &&
      ((ce = !ce),
      document.querySelector('[data-ind="udstoch"]').classList.toggle("on", ce),
      !ce && o && o.removeSubChart("udstoch"),
      U(),
      z());
  }),
  (window._toggleRsimfi = function () {
    requireLogin("\uB9E4\uB9E4\uC555\uB825") &&
      ((ue = !ue),
      document.querySelector('[data-ind="rsimfi"]').classList.toggle("on", ue),
      !ue && o && o.removeSubChart("rsimfi"),
      U(),
      z());
  }),
  (window._toggleStc = function () {
    requireLogin("\uCD94\uC138\uC804\uD658") &&
      ((fe = !fe),
      document.querySelector('[data-ind="stc"]').classList.toggle("on", fe),
      !fe && o && o.removeSubChart("stc"),
      U(),
      z());
  }));
var nt = !1;
window._toggleUprsiOpt = function () {
  ((nt = !nt),
    document.querySelector('[data-ind="_uopt"]')?.classList.toggle("on", nt),
    U(),
    z());
};
async function bt(e) {
  if (nt)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-a2?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data;
      (r.a &&
        r.b &&
        o.setSubChart("udrsi_opt", {
          label: "\uAC15\uB3C4\uCE21\uC815(14,200)",
          lines: [
            { data: r.a, color: "#C4384B", lineWidth: 1 },
            { data: r.b, color: "#3B82F6", lineWidth: 1 },
          ],
          hlines: [
            { value: 0, color: "rgba(107,114,128,0.7)" },
            { value: 0.1, color: "rgba(107,114,128,0.3)" },
            { value: -0.1, color: "rgba(107,114,128,0.3)" },
            { value: 0.4, color: "rgba(234,179,8,0.5)" },
            { value: -0.4, color: "rgba(234,179,8,0.5)" },
          ],
          range: { min: -0.55, max: 0.55 },
        }),
        r.c &&
          r.d &&
          o.setSubChart("udstoch_opt", {
            label: "\uACFC\uC5F4\uBD84\uC11D(\uCD5C\uC801\uD654)",
            lines: [
              { data: r.c, color: "#C4384B", lineWidth: 1 },
              { data: r.d, color: "#3B82F6", lineWidth: 1 },
            ],
            hlines: [
              { value: 0, color: "rgba(107,114,128,0.7)" },
              { value: 0.1, color: "rgba(107,114,128,0.3)" },
              { value: -0.1, color: "rgba(107,114,128,0.3)" },
              { value: 0.4, color: "rgba(234,179,8,0.5)" },
              { value: -0.4, color: "rgba(234,179,8,0.5)" },
            ],
            range: { min: -0.55, max: 0.55 },
          }));
    } catch {}
}
async function Jt(e) {
  if (!(!de && !ce && !ue && !fe))
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-a?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data;
      if (
        ((ho = r),
        de &&
          r.a &&
          r.b &&
          o.setSubChart("udrsi", {
            lines: [
              { data: r.a, color: "#C4384B", lineWidth: 1 },
              { data: r.b, color: "#3B82F6", lineWidth: 1 },
            ],
            hlines: [
              { value: 0, color: "rgba(107,114,128,0.7)" },
              { value: 0.1, color: "rgba(107,114,128,0.3)" },
              { value: -0.1, color: "rgba(107,114,128,0.3)" },
              { value: 0.4, color: "rgba(234,179,8,0.5)" },
              { value: -0.4, color: "rgba(234,179,8,0.5)" },
            ],
            label: t("\uAC15\uB3C4\uCE21\uC815"),
          }),
        ce &&
          r.c &&
          r.d &&
          o.setSubChart("udstoch", {
            lines: [
              {
                data: r.c,
                color: S("udstoch", "color", "#C4384B"),
                lineWidth: S("udstoch", "width", 1),
              },
              { data: r.d, color: "#3B82F6", lineWidth: 1 },
            ],
            hlines: [
              { value: 0, color: "rgba(107,114,128,0.7)" },
              { value: 0.1, color: "rgba(107,114,128,0.3)" },
              { value: -0.1, color: "rgba(107,114,128,0.3)" },
              { value: 0.4, color: "rgba(234,179,8,0.5)" },
              { value: -0.4, color: "rgba(234,179,8,0.5)" },
            ],
            label: t("\uACFC\uC5F4\uBD84\uC11D"),
          }),
        ue &&
          r.e &&
          r.f &&
          o.setSubChart("rsimfi", {
            lines: [
              {
                data: r.e,
                color: S("rsimfi", "color1", "#991b1b"),
                lineWidth: S("rsimfi", "width", 2.5),
              },
              {
                data: r.f,
                color: S("rsimfi", "color2", "#8E7D72"),
                lineWidth: S("rsimfi", "width", 2.5),
              },
            ],
            hlines: [
              { value: 0, color: "rgba(255,255,255,0.4)" },
              { value: 0.4, color: "rgba(59,130,246,0.3)" },
              { value: -0.4, color: "rgba(59,130,246,0.3)" },
            ],
            label: t("\uB9E4\uB9E4\uC555\uB825"),
          }),
        fe && r.g && r.h)
      )
        try {
          const y = await (
              await q(
                `${F}/v1/charts/ind-a?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&ver=1y_old`,
              )
            ).json(),
            f = y.success && y.data ? y.data : null,
            b = await (
              await q(
                `${F}/v1/charts/ind-a?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&ver=1y`,
              )
            ).json(),
            v = b.success && b.data ? b.data : null;
          o.setSubChart("stc", {
            lines: [
              ...(v && v.h
                ? [{ data: v.h, color: "#C4384B", lineWidth: 0.5 }]
                : []),
              ...(f && f.h
                ? [
                    {
                      data: f.h,
                      color: S("stc", "color", "#3B82F6"),
                      lineWidth: S("stc", "width", 1.5),
                    },
                  ]
                : []),
            ],
            hlines: [
              { value: 0, color: "rgba(255,255,255,0.3)" },
              { value: 0.25, color: "rgba(234,179,8,0.3)" },
              { value: -0.25, color: "rgba(234,179,8,0.3)" },
            ],
            range: { min: -0.55, max: 0.55 },
            label: t("\uCD94\uC138\uC804\uD658"),
          });
        } catch {
          o.setSubChart("stc", {
            lines: [{ data: r.g, color: "#3B82F6", lineWidth: 0.5 }],
            hlines: [
              { value: 0, color: "rgba(255,255,255,0.3)" },
              { value: 0.25, color: "rgba(234,179,8,0.3)" },
              { value: -0.25, color: "rgba(234,179,8,0.3)" },
            ],
            range: { min: -0.55, max: 0.55 },
            label: t("\uCD94\uC138\uC804\uD658"),
          });
        }
    } catch {}
}
window._togglePasrpvi = function () {
  requireLogin("\uC790\uAE08\uD750\uB984") &&
    ((ge = !ge),
    document.querySelector('[data-ind="pasrpvi"]').classList.toggle("on", ge),
    !ge && o && o.removeSubChart("pasrpvi"),
    U(),
    z());
};
async function Kt(e) {
  if (ge)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-c?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data;
      if (r.pn && r.pna) {
        const i = {};
        if (r.bg) for (const f of r.bg) i[f.index] = f.color;
        const y = r.pn.map((f, m) => ({ ...f, bg: i[m] || "sideways" }));
        o.setSubChart("pasrpvi", {
          lines: [
            {
              data: r.pn,
              color: S("pasrpvi", "color1", "#C4384B"),
              lineWidth: S("pasrpvi", "width", 2),
            },
            {
              data: r.pna,
              color: S("pasrpvi", "color2", "#3B82F6"),
              lineWidth: S("pasrpvi", "width", 2),
            },
          ],
          hlines: [],
          label: t("\uC790\uAE08\uD750\uB984"),
          bg: y,
        });
      }
    } catch {}
}
const xe = document.createElement("div");
((xe.style.cssText =
  "position:fixed;background:rgba(255,253,249,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(216,182,106,0.25);border-radius:8px;padding:4px 0;z-index:9999;display:none;min-width:150px;max-height:70vh;overflow-y:auto;font-size:14px;box-shadow:0 8px 24px rgba(106,30,51,0.1)"),
  document.body.appendChild(xe));
function wo(e, n, a) {
  return `<div style="padding:3px 12px;cursor:pointer;color:#032129;display:flex;justify-content:space-between;align-items:center;font-size:14px;gap:8px" onmouseover="this.style.background='rgba(216,182,106,0.1)'" onmouseout="this.style.background=''" onclick="${a};document.querySelector('[data-ctxmenu]').style.display='none'">${e}<span style="color:${n ? "#C4384B" : "#6b7280"};font-size:14px">${n ? "\u2713" : "\u25CB"}</span></div>`;
}
function nn(e) {
  return `<div style="padding:3px 12px;color:#8E7D72;font-size:14px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;border-top:1px solid rgba(216,182,106,0.2);margin-top:1px">${e}</div>`;
}
function _t(e) {
  (e.preventDefault(),
    xe.setAttribute("data-ctxmenu", "1"),
    (xe.style.display = "block"),
    (xe.style.left = e.clientX + "px"),
    (xe.style.top = e.clientY + "px"),
    requestAnimationFrame(() => {
      const n = xe.getBoundingClientRect();
      (n.bottom > window.innerHeight &&
        (xe.style.top = Math.max(4, window.innerHeight - n.height - 4) + "px"),
        n.right > window.innerWidth &&
          (xe.style.left =
            Math.max(4, window.innerWidth - n.width - 4) + "px"));
    }),
    (xe.innerHTML = wo(
      "\uB4DC\uB85C\uC789 \uC804\uCCB4 \uC0AD\uC81C",
      !1,
      "chart.clearDrawings()",
    )));
}
function bo() {
  o.overlayCanvas.addEventListener("contextmenu", _t);
  const e = document.getElementById("chart2Wrap");
  (e && e.addEventListener("contextmenu", _t),
    document.addEventListener("click", () => {
      xe.style.display = "none";
    }));
  let n = null;
  (o.overlayCanvas.addEventListener(
    "touchstart",
    (a) => {
      n = setTimeout(() => {
        const r = a.touches[0];
        _t({
          preventDefault: () => {},
          clientX: r.clientX,
          clientY: r.clientY,
        });
      }, 500);
    },
    { passive: !0 },
  ),
    o.overlayCanvas.addEventListener("touchend", () => clearTimeout(n), {
      passive: !0,
    }),
    o.overlayCanvas.addEventListener("touchmove", () => clearTimeout(n), {
      passive: !0,
    }));
}
((window._toggleOB = function () {
  requireLogin("\uAC70\uB798\uBC00\uC9D1\uAD6C\uAC04") &&
    ((ne = !ne),
    (window._obStyle = "gradient"),
    o && o.overlay && (o.overlay._obStyle = "gradient"),
    document.querySelector("[data-ind=ob]")?.classList.toggle("on", ne),
    U(),
    z());
}),
  (window._obStyle = "gradient"),
  o && o.overlay && (o.overlay._obStyle = "gradient"),
  (window._toggleAutoTrend = function () {
    requireLogin("\uCD94\uC138\uC120") &&
      ((se = !se),
      document
        .querySelector("[data-ind=autotrend]")
        ?.classList.toggle("on", se),
      U(),
      pe && E && loadChart2(),
      z());
  }),
  (window._togglePviNvi = function () {
    ((ot = !ot),
      document.querySelector("[data-ind=pvinvi]")?.classList.toggle("on", ot),
      U(),
      pe && E && loadChart2(),
      z());
  }),
  (window._togglePatterns = function () {
    requireLogin("\uD328\uD134 \uC778\uC2DD") &&
      ((We = !We),
      document.querySelector("[data-ind=patterns]")?.classList.toggle("on", We),
      U(),
      pe && E && loadChart2(),
      z());
  }),
  (window._toggleTTR = function () {
    requireLogin("TTR") &&
      ((le = !le),
      document.querySelector("[data-ind=ttr]")?.classList.toggle("on", le),
      U(),
      pe && E && loadChart2(),
      z());
  }));
var it = !1;
window._toggleTTROpt = function () {
  ((it = !it),
    document.querySelector("[data-ind=ttropt]")?.classList.toggle("on", it),
    U(),
    z());
};
async function _o(e) {
  if (((window.loadTTROpt = _o), !!it))
    try {
      const a = await (
        await q(
          `${F}/v1/charts/signals/ttr-opt?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      for (const r of a.data.signals || [])
        [
          "tp_buy",
          "tp_sell",
          "entry_buy",
          "entry_sell",
          "exit_buy",
          "exit_sell",
          "re_buy",
          "re_sell",
        ].includes(r.type) &&
          o.addDrawing({
            type: "ttr",
            index: r.index,
            price: r.price,
            ttrType: r.type,
            opt: !0,
          });
    } catch {}
}
((window._toggleBuyScan = function () {
  requireLogin("\uB9E4\uC218 \uC2A4\uCE90\uB108") &&
    ((ie = !ie),
    document.querySelector("[data-ind=buyscan]")?.classList.toggle("on", ie),
    U(),
    pe && E && loadChart2(),
    z());
}),
  (window._toggleAlignment = function () {
    requireLogin("\uC815/\uC5ED\uBC30\uC5F4") &&
      ((me = !me),
      document.querySelector("[data-ind=align]")?.classList.toggle("on", me),
      U(),
      pe && E && loadChart2(),
      z());
  }));
var be = !1;
window._toggleEntry = function () {
  requireLogin("Entry") &&
    ((be = !be),
    document.querySelector("[data-ind=entry]")?.classList.toggle("on", be),
    U(),
    z());
};
var Se = !1;
((window._toggleEntry2 = function () {
  ((Se = !Se),
    document.querySelector("[data-ind=entry2]")?.classList.toggle("on", Se),
    U(),
    z());
}),
  (window._toggleUltraTrend = function () {
    requireLogin("\uBC94\uC628 \uCE94\uB4E4") &&
      ((Q = !Q),
      document.querySelector("[data-ind=ultra]")?.classList.toggle("on", Q),
      Q
        ? (Xt("ultra"), typeof Fe == "function" && Fe())
        : (Qt("ultra"),
          o &&
            ((o._uc = null),
            (o.overlay.drawings = o.overlay.drawings.filter(
              (e) => e.type !== "signal",
            ))),
          typeof at == "function" && at()),
      (o._dirty = !0),
      U(),
      z());
  }));
var oe = !1;
window._toggleBimaco2 = function () {
  requireLogin("\uBC94\uC628 \uCE94\uB4E4 PRO") &&
    ((oe = !oe),
    document.querySelector("[data-ind=bimaco2]")?.classList.toggle("on", oe),
    oe
      ? (Xt("bimaco2"), typeof Fe == "function" && Fe())
      : (Qt("bimaco2"),
        o &&
          ((o._bc = null),
          o.removeIndicator && o.removeIndicator("bm2_ema"),
          (o._dirty = !0)),
        typeof at == "function" && at()),
    U(),
    z());
};
let ae = [];
function Fe(e) {
  var n = document.getElementById("bimacoDelayBadge");
  n && (n.style.display = "none");
}
function at() {
  var e = Q || oe;
  if (!e) {
    var n = document.getElementById("bimacoDelayBadge");
    n && (n.style.display = "none");
  }
}
function Xt(e) {
  ((ae = ae.filter((n) => n !== e)), ae.push(e));
}
function Qt(e) {
  ae = ae.filter((n) => n !== e);
}
function vo() {
  if (!o) return;
  function e() {
    const n = document.getElementById("goLatestBtn");
    if (n && o?.buffer?.length) {
      const a = o.timeScale.visibleTo < o.buffer.length - 1;
      n.style.display = a ? "inline-flex" : "none";
    }
  }
  if (
    ((o.onRenderSync = function () {
      (e(),
        o._replayBackup &&
          typeof _drawBimacoTP == "function" &&
          _drawBimacoTP());
    }),
    o.timeScale)
  ) {
    const n = o.timeScale.setVisibleRange?.bind(o.timeScale);
    n &&
      (o.timeScale.setVisibleRange = function () {
        (n(...arguments), setTimeout(e, 50));
      });
  }
  setInterval(() => {
    document.hidden || e();
  }, 1e3);
}
((window._selectSym = async function (e) {
  if (pe && lt === 2)
    ((re = e),
      (document.getElementById("symName").textContent = e.replace(
        "USDT",
        "/USDT",
      )),
      window._updateSymName && window._updateSymName(e),
      window._updateSymIcon && window._updateSymIcon(e),
      loadChart2());
  else {
    ((B = e),
      (window.curSymbol = e),
      (window._rt = {
        symbol: e,
        timeframe: A,
        lastPrice: 0,
        candleOpen: 0,
        lastCandleTime: 0,
        source: "",
        pct24h: null,
        updatedAt: 0,
      }),
      (() => {
        if (o) {
          o._uc = null;
          o._bc = null;
          o._uf = null;
          o._vpData = null;
          o._ichiCloud = null;
          if (o.overlay) {
            o.overlay.drawings = o.overlay.drawings.filter(
              (d) =>
                (!d._calcOwner || d._calcOwner === "ba2") &&
                !d._autoTrend &&
                !d._ob &&
                !d._alertLine &&
                d.type !== "signal" &&
                d.type !== "ob" &&
                d.type !== "ttr" &&
                d.type !== "buy_scan" &&
                d.type !== "strategy_signal" &&
                d.type !== "div_zone" &&
                d.type !== "ob_entry" &&
                d.type !== "autobot_entry" &&
                d.type !== "autobot_marker" &&
                d.type !== "demo_action" &&
                d.type !== "forecast" &&
                d.type !== "projection",
            );
          }
          o._dirty = true;
        }
      })(),
      q("/v1/charts/ticker-24hr?symbol=" + e)
        .then((f) => f.json())
        .then((f) => {
          f &&
            f.lastPrice &&
            ((window._rt.pct24h = parseFloat(f.priceChangePercent)),
            (window._rt.lastPrice = parseFloat(f.lastPrice)),
            Ge());
        })
        .catch(() => {}),
      (window._btpCache = null),
      (window._btpLastIdx = -1));
    const a = document.getElementById("mtfGrid");
    (a &&
      (a.innerHTML =
        '<div style="color:var(--muted);padding:8px;text-align:center">\uBD84\uC11D \uC911...</div>'),
      z(),
      o && (o._priceScaleLocked = !1),
      typeof dt == "function" && dt());
    const r = e.includes("KRW")
      ? e.replace("KRW-", "") + "/KRW"
      : e.replace("USDT", "") + "/USDT";
    ((document.getElementById("symName").textContent = r),
      window._updateSymName && window._updateSymName(e),
      window._updateSymIcon && window._updateSymIcon(e));
    const i = document.getElementById("mtfSymbol");
    i && (i.textContent = r);
    const y = document.getElementById("mtfSymbolSub");
    (y && (y.textContent = e),
      (document.getElementById("curPrice").textContent = "-"),
      Qe(),
      await De(),
      N &&
        N.readyState === 1 &&
        (() => {
          const _oldChannels = [];
          window._lastWsSub && _oldChannels.push(window._lastWsSub);
          window._lastWsTickerSub && _oldChannels.push(window._lastWsTickerSub);
          _oldChannels.length &&
            N.send(
              JSON.stringify({
                action: "unsubscribe",
                channels: _oldChannels,
              }),
            );

          window._lastWsSub = { name: "candle", symbolId: B, timeframe: A };
          window._lastWsTickerSub = { name: "ticker", symbolId: B };

          N.send(
            JSON.stringify({
              action: "subscribe",
              channels: [window._lastWsSub, window._lastWsTickerSub],
            }),
          );
        })());
  }
  (document.querySelector(".right-tab.active")?.dataset.p === "ai" &&
    G() &&
    Z() &&
    requestAI(),
    window._autobotActive &&
      typeof window._autobotRun == "function" &&
      (clearTimeout(window._autobotRerunTimer),
      (window._autobotRerunTimer = setTimeout(
        () => window._autobotRun(!0),
        600,
      ))));
}),
  document.querySelectorAll("[data-tf]").forEach(
    (e) =>
      (e.onclick = function () {
        pe && lt === 2
          ? (document
              .querySelectorAll(".c2tf")
              .forEach((n) => n.classList.remove("active")),
            this.classList.add("active"),
            (ke = this.dataset.tf),
            loadChart2())
          : ((window._btpCache = null),
            (window._btpLastIdx = -1),
            o && (o._priceScaleLocked = !1),
            Ft(this.dataset.tf),
            Pt());
      }),
  ),
  (window._indHistory = []));
function vt() {
  const e = [];
  (document
    .querySelectorAll(".ind-tag[data-ind].on,[data-ind].on.pro-ind")
    .forEach((n) => e.push({ type: "ind", id: n.dataset.ind })),
    document
      .querySelectorAll(".sub-ind[data-sub].on")
      .forEach((n) => e.push({ type: "sub", id: n.dataset.sub })),
    window._indHistory.push(e),
    window._indHistory.length > 30 && window._indHistory.shift());
}
function an() {
  if (!window._indHistory.length) return;
  const e = window._indHistory.pop();
  (document
    .querySelectorAll(".ind-tag[data-ind].on,[data-ind].on.pro-ind")
    .forEach((n) => n.classList.remove("on")),
    document
      .querySelectorAll(".sub-ind[data-sub].on")
      .forEach((n) => n.classList.remove("on")));
  for (const n of e)
    n.type === "ind"
      ? document.querySelector(`[data-ind="${n.id}"]`)?.classList.add("on")
      : document
          .querySelector(`.sub-ind[data-sub="${n.id}"]`)
          ?.classList.add("on");
  (Y(), X("\uB418\uB3CC\uB9AC\uAE30 \uC644\uB8CC", "#6b7280"));
}
document
  .querySelectorAll(
    ".ind-tag:not(.pro-ind):not(.member-ind):not([data-strategy]):not([data-draw]):not([data-action])",
  )
  .forEach(
    (e) =>
      (e.onclick = function () {
        if (
          !window.requireLogin ||
          !window.requireLogin(this.textContent.replace("", "").trim())
        )
          return;
        if (this.dataset.ind === "ultra_free") {
          window._toggleBimacoFree?.();
          return;
        }
        if (this.dataset.ind === "beom_free") {
          window._toggleBeomFree?.();
          return;
        }
        if ((vt(), this.classList.toggle("on"), !this.classList.contains("on")))
          document.getElementById("indSettingsPanel")?.classList.remove("open");
        else {
          const n = this.textContent.replace(/[\s]+$/g, "").trim();
          window.openSettings &&
            window.openSettings(
              n,
              this.dataset.maType || null,
              this.dataset.sub || null,
              this.dataset.ind || null,
            );
        }
        (Y(), Te(), z());
      }),
  );
let rn = null,
  rt = null;
function z() {
  G() &&
    (rt && clearTimeout(rt),
    (rt = setTimeout(() => {
      (eo().catch((e) => {}), (rt = null));
    }, 800)));
}
window.addEventListener("beforeunload", () => {
  try {
    if (G()) {
      const data = ko();
      navigator.sendBeacon &&
        navigator.sendBeacon(
          "/v1/site/chart-settings",
          new Blob([JSON.stringify(data)], { type: "application/json" }),
        );
    }
  } catch {}
});
window._debounceSaveChartSettings = z;
const Gt = new Set(["bimaco4", "b3_60"]),
  xo = new Set([
    "ultra",
    "bimaco2",
    "ob",
    "autotrend",
    "ttr",
    "align",
    "bimaco_tp",
    "udstoch",
    "_u",
    "ladder",
    "autobot",
    "obsig",
    "qsig_safe",
    "qsig_std",
    "qsig_aggr",
    "buyscan",
    "entry",
    "entry2",
    "v12sig",
    "pvinvi",
    "patterns",
  ]),
  So = new Set(["kvo", "master"]);
function Yt(e) {
  const n = Z();
  const _ok = (a) =>
    n ||
    (window._purchased || []).includes(a) ||
    (window.isAdmin && window.isAdmin()) ||
    window._beomAllowed;
  return (
    e.activeInds &&
      (e.activeInds = e.activeInds.filter(
        (a) => !Gt.has(a) && (!xo.has(a) || _ok(a)),
      )),
    e.activeSubs &&
      (e.activeSubs = e.activeSubs.filter(
        (a) => !Gt.has(a) && (!So.has(a) || _ok(a)),
      )),
    e
  );
}
function Zt(e) {
  if (
    ((e = Yt(e)),
    e.activeInds &&
      document.querySelectorAll(".ind-tag[data-ind]").forEach((n) => {
        e.activeInds.includes(n.dataset.ind)
          ? n.classList.add("on")
          : n.classList.remove("on");
      }),
    e.activeSubs &&
      document
        .querySelectorAll(".ind-tag[data-sub],.sub-ind[data-sub]")
        .forEach((n) => {
          e.activeSubs.includes(n.dataset.sub)
            ? n.classList.add("on")
            : n.classList.remove("on");
        }),
    Array.isArray(e.activeStrategies) &&
      document.querySelectorAll("[data-strategy]").forEach((n) => {
        const on = e.activeStrategies.includes(n.dataset.strategy);
        if (on && !n.classList.contains("on")) {
          n.click();
        } else if (!on && n.classList.contains("on")) {
          n.classList.remove("on");
        }
      }),
    e.customMA && (window._customMA = e.customMA),
    e.customSUB && (window._customSUB = e.customSUB),
    e.obStyle && (window._obStyle = e.obStyle),
    e.indSettings && (window._indSettings = e.indSettings),
    Array.isArray(e.favSymbols))
  ) {
    window._favSymbols = e.favSymbols;
    try {
      localStorage.setItem("chartOS_favSymbols", JSON.stringify(e.favSymbols));
    } catch {}
    typeof window._renderFavSymbols == "function" && window._renderFavSymbols();
  }
  if (Array.isArray(e.favInds)) {
    window._favInds = e.favInds;
    try {
      localStorage.setItem("chartOS_favInds", JSON.stringify(e.favInds));
    } catch {}
    typeof window._renderFavInds == "function" && window._renderFavInds();
  }
  if (
    (typeof ne < "u" && (ne = !!C("ob")),
    typeof se < "u" && (se = !!C("autotrend")),
    typeof Q < "u" && (Q = !!C("ultra")),
    typeof oe < "u" && (oe = !!C("bimaco2")),
    typeof le < "u" && (le = !!C("ttr")),
    typeof ie < "u" && (ie = !!C("buyscan")),
    typeof me < "u" && (me = !!C("align")),
    typeof be < "u" && (be = !!C("entry")),
    typeof Se < "u" && (Se = !!C("entry2")),
    typeof ye < "u" && (ye = !!C("v12sig")),
    typeof window.showBimacoTP < "u" &&
      (window.showBimacoTP = !!C("bimaco_tp")),
    typeof de < "u" && (de = !!C("_u")),
    typeof ce < "u" && (ce = !!C("udstoch")),
    typeof ue < "u" && (ue = !!C("rsimfi")),
    typeof fe < "u" && (fe = !!C("stc")),
    typeof ge < "u" && (ge = !!C("pasrpvi")),
    typeof he < "u" && (he = !!C("ladder")),
    typeof Be < "u" && (Be = !!C("autobot")),
    typeof _e < "u" && (_e = !!C("obsig")),
    typeof Ae < "u" && (Ae = !!C("beom_free")),
    typeof we < "u" && (we = !!C("darak")),
    typeof ae < "u" &&
      ((ae = []), Q && ae.push("ultra"), oe && ae.push("bimaco2")),
    go(),
    Array.isArray(e.workspaces) && e.workspaces.length)
  )
    try {
      localStorage.setItem("chartOS_workspaces", JSON.stringify(e.workspaces));
    } catch {}
  if (Array.isArray(e.mockPos))
    try {
      localStorage.setItem("mockPos", JSON.stringify(e.mockPos));
    } catch {}
  if (Array.isArray(e.mockHistory))
    try {
      localStorage.setItem("mockHistory", JSON.stringify(e.mockHistory));
    } catch {}
  if (typeof e.mockTotalPnl == "number")
    try {
      localStorage.setItem("mockTotalPnl", String(e.mockTotalPnl));
    } catch {}
  (typeof Y == "function" && Y(), typeof U == "function" && U());
}
function ko() {
  const e = [],
    n = [];
  (document
    .querySelectorAll(".ind-tag.on[data-ind]")
    .forEach((r) => e.push(r.dataset.ind)),
    document
      .querySelectorAll(".ind-tag.on[data-sub],.sub-ind.on[data-sub]")
      .forEach((r) => n.push(r.dataset.sub)));
  const _st = [];
  document
    .querySelectorAll("[data-strategy].on")
    .forEach((r) => _st.push(r.dataset.strategy));
  const _uniq = (arr) => [...new Set((arr || []).filter((v) => !!v))];
  const a = {
    activeInds: _uniq(e),
    activeSubs: _uniq(n),
    activeStrategies: _uniq(_st),
    customMA: window._customMA || [],
    customSUB: window._customSUB || [],
    obStyle: window._obStyle || "default",
    indSettings: window._indSettings || {},
    symbol: B,
    timeframe: A,
    favSymbols:
      window._favSymbols ||
      JSON.parse(localStorage.getItem("chartOS_favSymbols") || "[]"),
    favInds:
      window._favInds ||
      JSON.parse(localStorage.getItem("chartOS_favInds") || "[]"),
    workspaces: JSON.parse(localStorage.getItem("chartOS_workspaces") || "[]"),
    mockPos: JSON.parse(localStorage.getItem("mockPos") || "[]"),
    mockHistory: JSON.parse(localStorage.getItem("mockHistory") || "[]"),
    mockTotalPnl: parseFloat(localStorage.getItem("mockTotalPnl") || "0"),
  };
  return Yt(a);
}
async function eo() {
  if (G())
    try {
      await window.api.post("/v1/site/chart-settings", ko());
    } catch {}
}
window._saveChartSettingsToServer = eo;
async function to() {
  if (G())
    try {
      const n = await (
        await fetch("/v1/site/chart-settings", {
          headers: Me(),
          credentials: "include",
        })
      ).json();
      if (!n.data) return;
      const a = n.data;
      if (
        !a ||
        (!Array.isArray(a.activeInds) &&
          !Array.isArray(a.activeSubs) &&
          !a.symbol &&
          !a.timeframe &&
          !a.indSettings)
      ) {
        return;
      }
      const r = a.symbol && a.symbol !== B,
        i = a.timeframe && a.timeframe !== A;
      (i && ((A = a.timeframe), (window.curTf = A), Mt(A)),
        Zt(a),
        r ? await window._selectSym(a.symbol) : i && (await De()));
      try {
        window._saveUserSettings && window._saveUserSettings();
      } catch {}
    } catch {}
}
window._indSettings = JSON.parse(
  localStorage.getItem(
    "chartOS_indSettings_" + (localStorage.getItem("userName") || "guest"),
  ) || "{}",
);
function oo() {
  (localStorage.setItem(
    "chartOS_indSettings_" + (localStorage.getItem("userName") || "guest"),
    JSON.stringify(window._indSettings),
  ),
    z());
}
window.saveIndSettings = oo;
window._applyIndChange = function (e) {
  saveIndSettings();
  if (e === "darak") return window._loadDarak && window._loadDarak();
  [
    "align",
    "buyscan",
    "ttr",
    "ob",
    "autotrend",
    "ultra",
    "bimaco2",
    "entry",
    "entry2",
    "backtest",
    "_u",
    "udstoch",
    "rsimfi",
    "stc",
    "pasrpvi",
  ].includes(e)
    ? window._refreshOverlays && window._refreshOverlays()
    : window.calcIndicators && window.calcIndicators();
};
function S(e, n, a) {
  return window._indSettings[e]?.[n] ?? a;
}
window.getIndSetting = S;
const K = document.createElement("div");
((window.indSettingsPopup = K),
  (K.id = "indSettingsPopup"),
  (K.style.cssText =
    "display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:10px;padding:16px 18px;z-index:9999;min-width:200px;font-size:14px;color:var(--text);box-shadow:0 8px 24px rgba(106,30,51,0.1)"),
  document.body.appendChild(K));
const Io = {
  ema9: {
    label: "EMA 9",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 9,
        min: 1,
        max: 500,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#8E7D72" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  ema20: {
    label: "EMA 20",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 20,
        min: 1,
        max: 500,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  ema50: {
    label: "EMA 50",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 50,
        min: 1,
        max: 500,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#A31540" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  ema200: {
    label: "EMA 200",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 200,
        min: 1,
        max: 1e3,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#3B82F6" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 2,
        min: 1,
        max: 5,
      },
    ],
  },
  sma50: {
    label: "SMA 50",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 50,
        min: 1,
        max: 500,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#A31540" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  sma200: {
    label: "SMA 200",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 200,
        min: 1,
        max: 1e3,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#3B82F6" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  bb: {
    label: t("\uBCFC\uB9B0\uC800\uBC34\uB4DC"),
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 20,
        min: 5,
        max: 200,
      },
      {
        key: "mult",
        label: t("\uBC30\uC218"),
        type: "number",
        def: 2,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#921230" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  rsi: {
    label: "RSI",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#A31540" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  macd: {
    label: "MACD",
    params: [
      {
        key: "fast",
        label: t("\uBE60\uB978"),
        type: "number",
        def: 12,
        min: 2,
        max: 100,
      },
      {
        key: "slow",
        label: t("\uB290\uB9B0"),
        type: "number",
        def: 26,
        min: 2,
        max: 200,
      },
      {
        key: "signal",
        label: t("\uC2DC\uADF8\uB110"),
        type: "number",
        def: 9,
        min: 2,
        max: 50,
      },
      { key: "color1", label: "MACD\uC120", type: "color", def: "#921230" },
      {
        key: "color2",
        label: "\uC2DC\uADF8\uB110\uC120",
        type: "color",
        def: "#D8B66A",
      },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  stoch: {
    label: "스토캐스틱",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      {
        key: "smooth",
        label: t("\uC2A4\uBB34\uB529"),
        type: "number",
        def: 3,
        min: 1,
        max: 20,
      },
      { key: "color1", label: "%K\uC120", type: "color", def: "#921230" },
      { key: "color2", label: "%D\uC120", type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  atr: {
    label: "ATR",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  cci: {
    label: "CCI",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 20,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#ec4899" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  adx: {
    label: "ADX",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      { key: "color", label: "ADX\uC0C9", type: "color", def: "#D8B66A" },
      { key: "color_plus", label: "+DI\uC0C9", type: "color", def: "#C4384B" },
      { key: "color_minus", label: "-DI\uC0C9", type: "color", def: "#3B82F6" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  willr: {
    label: "윌리엄스 %R",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#8E7D72" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  mfi: {
    label: "MFI",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  roc: {
    label: "ROC",
    params: [
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 12,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#ec4899" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  tema20: {
    label: "TEMA 20",
    params: [
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  tema60: {
    label: "TEMA 60",
    params: [
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  stochrsi: {
    label: "스토캐스틱 RSI",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 14,
        min: 2,
        max: 100,
      },
      {
        key: "smooth",
        label: "\uC2A4\uBB34\uB529",
        type: "number",
        def: 3,
        min: 1,
        max: 20,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#A31540" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  mom: {
    label: "모멘텀",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 10,
        min: 1,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#921230" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  tsi: {
    label: "TSI",
    params: [
      { key: "long", label: "Long", type: "number", def: 25, min: 5, max: 100 },
      {
        key: "short",
        label: "Short",
        type: "number",
        def: 13,
        min: 2,
        max: 50,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  volosc: {
    label: "거래량추세",
    params: [
      {
        key: "fast",
        label: "\uBE60\uB978",
        type: "number",
        def: 5,
        min: 2,
        max: 50,
      },
      {
        key: "slow",
        label: "\uB290\uB9B0",
        type: "number",
        def: 20,
        min: 5,
        max: 100,
      },
      { key: "color", label: "\uC0C9", type: "color", def: "#8E7D72" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
      },
    ],
  },
  trix: {
    label: "TRIX",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 15,
        min: 2,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#8E24AA" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  ao: {
    label: "AO 오실레이터",
    params: [
      {
        key: "fast",
        label: "\uBE60\uB978",
        type: "number",
        def: 5,
        min: 2,
        max: 50,
      },
      {
        key: "slow",
        label: "\uB290\uB9B0",
        type: "number",
        def: 34,
        min: 10,
        max: 200,
      },
      { key: "color", label: "\uC0C9", type: "color", def: "#43A047" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
      },
    ],
  },
  psar: {
    label: "파라볼릭 SAR",
    params: [
      {
        key: "step",
        label: "Step",
        type: "number",
        def: 0.02,
        min: 0.01,
        max: 0.2,
        step: 0.01,
      },
      {
        key: "max",
        label: "Max",
        type: "number",
        def: 0.2,
        min: 0.05,
        max: 0.5,
        step: 0.05,
      },
      {
        key: "color_buy",
        label: "\uC0C1\uC2B9(\uB9E4\uC218) \uC0C9",
        type: "color",
        def: "#C4384B",
      },
      {
        key: "color_sell",
        label: "\uD558\uB77D(\uB9E4\uB3C4) \uC0C9",
        type: "color",
        def: "#3B82F6",
      },
      {
        key: "width",
        label: "\uD06C\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
      },
    ],
  },
  supertrend: {
    label: "슈퍼트렌드",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 10,
        min: 2,
        max: 100,
      },
      {
        key: "mult",
        label: "\uBC30\uC218",
        type: "number",
        def: 3,
        min: 0.5,
        max: 10,
        step: 0.5,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#C4384B" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  ichimoku: {
    label: "\uC77C\uBAA9\uADE0\uD615\uD45C",
    params: [
      {
        key: "show_tenkan",
        label: "\u2713 \uC804\uD658\uC120",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "show_kijun",
        label: "\u2713 \uAE30\uC900\uC120",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "show_spanA",
        label: "\u2713 \uC120\uD589\uC2A4\uD32CA",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "show_spanB",
        label: "\u2713 \uC120\uD589\uC2A4\uD32CB",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "show_chikou",
        label: "\u2713 \uD6C4\uD589\uC2A4\uD32C",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "cloud",
        label: "\u2713 \uAD6C\uB984",
        type: "select",
        options: ["on", "off"],
        def: "on",
      },
      {
        key: "tenkan",
        label: "\uC804\uD658\uC120 \uAE30\uAC04",
        type: "number",
        def: 9,
        min: 2,
        max: 100,
      },
      {
        key: "kijun",
        label: "\uAE30\uC900\uC120 \uAE30\uAC04",
        type: "number",
        def: 26,
        min: 2,
        max: 200,
      },
      {
        key: "senkou",
        label: "\uC120\uD589 \uAE30\uAC04",
        type: "number",
        def: 52,
        min: 2,
        max: 300,
      },
      {
        key: "color_tenkan",
        label: "\uC804\uD658\uC120 \uC0C9",
        type: "color",
        def: "#e91e63",
      },
      {
        key: "color_kijun",
        label: "\uAE30\uC900\uC120 \uC0C9",
        type: "color",
        def: "#2196f3",
      },
      {
        key: "color_spanA",
        label: "\uC120\uD589\uC2A4\uD32CA \uC0C9",
        type: "color",
        def: "#4CAF50",
      },
      {
        key: "color_spanB",
        label: "\uC120\uD589\uC2A4\uD32CB \uC0C9",
        type: "color",
        def: "#FF5252",
      },
      {
        key: "color_chikou",
        label: "\uD6C4\uD589\uC2A4\uD32C \uC0C9",
        type: "color",
        def: "#9C27B0",
      },
    ],
  },
  keltner: {
    label: "\uCF08\uD2B8\uB108\uCC44\uB110",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 20,
        min: 5,
        max: 100,
      },
      {
        key: "mult",
        label: "\uBC30\uC218",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#A31540" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  envelope: {
    label: "\uC5D4\uBCA8\uB85C\uD504",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 20,
        min: 5,
        max: 200,
      },
      {
        key: "pct",
        label: "%",
        type: "number",
        def: 5,
        min: 0.5,
        max: 20,
        step: 0.5,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#8B5CF6" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  _u: {
    label: "강도측정",
    params: [
      {
        key: "period",
        label: "기간",
        type: "number",
        def: 14,
        min: 5,
        max: 50,
      },
    ],
  },
  imacd: {
    label: "범온 MACD",
    params: [
      {
        key: "length",
        label: "\uAE30\uAC04",
        type: "number",
        def: 34,
        min: 5,
        max: 200,
      },
      {
        key: "signal",
        label: "\uC2DC\uADF8\uB110",
        type: "number",
        def: 9,
        min: 2,
        max: 50,
      },
    ],
  },
  stc: {
    label: "추세전환",
    params: [
      { key: "color", label: "색상", type: "color", def: "#C4384B" },
      { key: "width", label: "굵기", type: "number", def: 2, min: 1, max: 5 },
    ],
  },
  udstoch: {
    label: "과열분석",
    params: [
      { key: "color", label: "색상", type: "color", def: "#D8B66A" },
      { key: "width", label: "굵기", type: "number", def: 2, min: 1, max: 5 },
    ],
  },
  vol: {
    label: "거래량",
    params: [
      {
        key: "ma_period",
        label: "이동평균",
        type: "number",
        def: 20,
        min: 5,
        max: 100,
      },
      { key: "ma_color", label: "평균선 색", type: "color", def: "#D8B66A" },
      {
        key: "ma_width",
        label: "평균선 굵기",
        type: "number",
        def: 2.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  volprofile: {
    label: "거래량분포",
    params: [
      {
        key: "lookback",
        label: "분석봉수",
        type: "number",
        def: 200,
        min: 50,
        max: 500,
      },
      {
        key: "rows",
        label: "구간수",
        type: "number",
        def: 30,
        min: 10,
        max: 60,
      },
    ],
  },
  pivot: {
    label: "피봇",
    params: [
      {
        key: "type",
        label: "유형",
        type: "select",
        options: ["classic", "fibonacci"],
        def: "classic",
      },
    ],
  },
  dayband: {
    label: "고가저가",
    params: [
      { key: "color_high", label: "고가색", type: "color", def: "#C4384B" },
      { key: "color_low", label: "저가색", type: "color", def: "#3B82F6" },
      { key: "color_mid", label: "중심색", type: "color", def: "#D8B66A" },
      { key: "color_25", label: "25%색", type: "color", def: "#16A34A" },
      { key: "color_75", label: "75%색", type: "color", def: "#9333EA" },
    ],
  },
  wma20: {
    label: "WMA 20",
    params: [
      {
        key: "period",
        label: "기간",
        type: "number",
        def: 20,
        min: 2,
        max: 500,
      },
      { key: "color", label: "색상", type: "color", def: "#8E7D72" },
      { key: "width", label: "굵기", type: "number", def: 1, min: 1, max: 5 },
    ],
  },
  hma20: {
    label: "HMA 20",
    params: [
      {
        key: "period",
        label: "기간",
        type: "number",
        def: 20,
        min: 2,
        max: 500,
      },
      { key: "color", label: "색상", type: "color", def: "#ec4899" },
      { key: "width", label: "굵기", type: "number", def: 1.5, min: 1, max: 5 },
    ],
  },
  dema: {
    label: "DEMA",
    params: [
      {
        key: "period",
        label: "기간",
        type: "number",
        def: 21,
        min: 2,
        max: 500,
      },
      { key: "color", label: "색상", type: "color", def: "#C4384B" },
      { key: "width", label: "굵기", type: "number", def: 2, min: 1, max: 5 },
    ],
  },
  rsim: {
    label: "다이버전스",
    params: [
      {
        key: "period",
        label: "RSI기간",
        type: "number",
        def: 14,
        min: 5,
        max: 50,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  rs: {
    label: "상대강도",
    params: [
      {
        key: "period",
        label: "기간",
        type: "number",
        def: 14,
        min: 5,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#C4384B" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  vwap: {
    label: "VWAP",
    params: [
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 1,
        max: 5,
      },
    ],
  },
  emaribbon: {
    label: "MA\uB9AC\uBCF8",
    params: [
      {
        key: "ma_type",
        label: "\uC774\uB3D9\uD3C9\uADE0\uC120",
        type: "select",
        options: ["EMA", "SMA", "WMA", "HMA", "DEMA", "TEMA"],
        def: "EMA",
      },
      {
        key: "length",
        label: "\uB9AC\uBCF8\uAE38\uC774",
        type: "select",
        options: ["\uB2E8\uAE30", "\uC7A5\uAE30"],
        def: "\uB2E8\uAE30",
      },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1,
        min: 0.5,
        max: 3,
      },
    ],
  },
  cmf: {
    label: "CMF",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 20,
        min: 5,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#A31540" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  obv: {
    label: "OBV",
    params: [
      {
        key: "smooth",
        label: "OBV\uD3C9\uD65C\uAE30\uAC04",
        type: "number",
        def: 1,
        min: 1,
        max: 100,
      },
      {
        key: "period",
        label: "\uC2DC\uADF8\uB110\uAE30\uAC04",
        type: "number",
        def: 20,
        min: 2,
        max: 200,
      },
      { key: "color", label: "OBV\uC0C9", type: "color", def: "#8E7D72" },
      {
        key: "color2",
        label: "\uC2DC\uADF8\uB110\uC0C9",
        type: "color",
        def: "#D8B66A",
      },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1.5,
        min: 0.5,
        max: 5,
      },
    ],
  },
  dema21: {
    label: "DEMA 21",
    params: [
      {
        key: "period",
        label: "\uAE30\uAC04",
        type: "number",
        def: 21,
        min: 2,
        max: 500,
      },
      { key: "color", label: "\uC0C9\uC0C1", type: "color", def: "#6366f1" },
      {
        key: "width",
        label: "\uAD75\uAE30",
        type: "number",
        def: 1,
        min: 1,
        max: 5,
      },
    ],
  },
  darak: {
    label: "\uBC94\uC628 \uC774\uB3D9\uD3C9\uADE0\uC120",
    params: [
      {
        key: "mode",
        label: t("\uD504\uB9AC\uC14B"),
        type: "select",
        options: ["balanced", "fast", "smooth", "custom"],
        def: "balanced",
      },
      {
        key: "period",
        label: t("\uAE30\uAC04"),
        type: "number",
        def: 20,
        min: 5,
        max: 200,
      },
      {
        key: "w_basic",
        label: t("\uAE30\uBCF8MA \uAC00\uC911\uCE58"),
        type: "number",
        def: 25,
        min: 0,
        max: 100,
      },
      {
        key: "w_lowlag",
        label: t("\uC800\uC9C0\uC5F0MA \uAC00\uC911\uCE58"),
        type: "number",
        def: 30,
        min: 0,
        max: 100,
      },
      {
        key: "w_adaptive",
        label: t("\uC801\uC751\uD615MA \uAC00\uC911\uCE58"),
        type: "number",
        def: 30,
        min: 0,
        max: 100,
      },
      {
        key: "w_vol",
        label: t("\uAC70\uB798\uB7C9MA \uAC00\uC911\uCE58"),
        type: "number",
        def: 15,
        min: 0,
        max: 100,
      },
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 2.5,
        min: 1,
        max: 5,
      },
    ],
  },
  autotrend: {
    label: "\uC790\uB3D9 \uCD94\uC138\uC120",
    params: [
      { key: "color", label: t("\uC0C9\uC0C1"), type: "color", def: "#D8B66A" },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 1.5,
        min: 1,
        max: 5,
      },
    ],
  },
  align: {
    label: "\uC815/\uC5ED\uBC30\uC5F4",
    params: [
      {
        key: "ma_type",
        label: t("\uC774\uB3D9\uD3C9\uADE0\uC120"),
        type: "select",
        options: ["EMA", "SMA", "WMA"],
        def: "EMA",
      },
      {
        key: "short",
        label: t("\uB2E8\uAE30"),
        type: "number",
        def: 20,
        min: 5,
        max: 100,
      },
      {
        key: "mid",
        label: t("\uC911\uAE30"),
        type: "number",
        def: 50,
        min: 10,
        max: 200,
      },
      {
        key: "long",
        label: t("\uC7A5\uAE30"),
        type: "number",
        def: 200,
        min: 50,
        max: 500,
      },
    ],
  },
  rsimfi: {
    label: "\uB9E4\uB9E4\uC555\uB825",
    params: [
      {
        key: "color1",
        label: t("RSI \uC0C9\uC0C1"),
        type: "color",
        def: "#991b1b",
      },
      {
        key: "color2",
        label: t("MFI \uC0C9\uC0C1"),
        type: "color",
        def: "#8E7D72",
      },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 2.5,
        min: 1,
        max: 5,
      },
    ],
  },
  pasrpvi: {
    label: "\uC790\uAE08\uD750\uB984",
    params: [
      {
        key: "color1",
        label: t("PVI \uC0C9\uC0C1"),
        type: "color",
        def: "#C4384B",
      },
      {
        key: "color2",
        label: t("NVI \uC0C9\uC0C1"),
        type: "color",
        def: "#3B82F6",
      },
      {
        key: "width",
        label: t("\uAD75\uAE30"),
        type: "number",
        def: 2,
        min: 1,
        max: 5,
      },
    ],
  },
};
((window._openIndSettings = function (e) {
  xt(e);
}),
  (window._onIndRemoved = function (e) {
    (Y(), z());
  }),
  (window.showIndSettings = xt),
  (window.openSettings = function (e, n, a, r) {
    const i = r || a || n;
    i && xt(i);
  }));
function xt(e, n, a) {
  const r = Io[e];
  if (!r) {
    K.style.display = "none";
    return;
  }
  /* ▼▼ 범온지표 설정변경 잠금: 운영자만 변경 가능, 일반회원은 고정 ▼▼ */ if (
    [
      "ultra",
      "bimaco2",
      "darak",
      "autotrend",
      "ob",
      "obsig",
      "bimaco_tp",
      "ttr",
      "beom_auto",
      "_u",
      "udstoch",
      "stc",
      "rsimfi",
      "pasrpvi",
      "ladder",
      "imacd",
    ].includes(e) &&
    !(typeof Tt === "function" && Tt())
  ) {
    K.style.display = "none";
    return;
  }
  /* ▲▲ 범온지표 설정변경 잠금 끝 ▲▲ */ window._indSettings[e] ||
    (window._indSettings[e] = {});
  let i = `<div style="font-weight:700;margin-bottom:10px;color:#032129">${r.label}</div>`;
  for (const b of r.params) {
    const v = S(e, b.key, b.def);
    if (b.type === "color")
      i += `<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0"><span>${b.label}</span><input type="color" value="${v}" onchange="window._indSettings['${e}']['${b.key}']=this.value;window._applyIndChange('${e}')" style="width:30px;height:20px;border:none;cursor:pointer"></div>`;
    else if (b.type === "select") {
      i += `<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0"><span>${b.label}</span><select onchange="window._indSettings['${e}']['${b.key}']=this.value;window._applyIndChange('${e}')" style="padding:2px 4px;background:#FFFDF9;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px">`;
      for (const s of b.options || [])
        i += `<option value="${s}" ${v === s ? "selected" : ""}>${s}</option>`;
      i += "</select></div>";
    } else
      i += `<div style="display:flex;justify-content:space-between;align-items:center;margin:5px 0"><span>${b.label}</span><input type="number" value="${v}" min="${b.min || 1}" max="${b.max || 500}" step="${b.step || 1}" oninput="if(this.value!==''){window._indSettings['${e}']['${b.key}']=parseFloat(this.value);window._applyIndChange('${e}')}" style="width:70px;height:30px;background:#FFFDF9;border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;font-size:14px;box-sizing:border-box"></div>`;
  }
  const f = [
      "align",
      "buyscan",
      "ttr",
      "ob",
      "autotrend",
      "ultra",
      "bimaco2",
      "entry",
      "entry2",
      "backtest",
      "_u",
      "udstoch",
      "rsimfi",
      "stc",
      "pasrpvi",
    ].includes(e),
    m =
      e === "darak"
        ? "_loadDarak()"
        : f
          ? "_refreshOverlays()"
          : "calcIndicators()";
  ((i += '<div style="display:flex;gap:4px;margin-top:6px">'),
    (i += `<button onclick="saveIndSettings();${m};indSettingsPopup.style.display='none'" style="flex:1;padding:3px;background:#C4384B;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer">\uC801\uC6A9</button>`),
    (i += `<button onclick="delete window._indSettings['${e}'];saveIndSettings();${m};window.showIndSettings&&window.showIndSettings('${e}')" style="flex:1;padding:3px;background:none;border:1px solid #8E7D72;color:#8E7D72;border-radius:6px;font-size:14px;cursor:pointer">\uAE30\uBCF8\uAC12</button>`),
    (i += `<button onclick="delete window._indSettings['${e}'];saveIndSettings();var _btn=document.querySelector('[data-ind=${e}]')||document.querySelector('[data-sub=${e}]');if(_btn&&_btn.classList.contains('on'))_btn.click();indSettingsPopup.style.display='none'" style="flex:1;padding:3px;background:none;border:1px solid #3B82F6;color:#3B82F6;border-radius:6px;font-size:14px;cursor:pointer">\uC0AD\uC81C</button>`),
    (i += "</div>"),
    (K.innerHTML = i),
    (K.style.left = "50%"),
    (K.style.top = "50%"),
    (K.style.transform = "translate(-50%,-50%)"),
    (K.style.display = "block"));
}
(document.querySelectorAll(".ind-tag").forEach((e) => {
  e.addEventListener("contextmenu", (n) => {
    n.preventDefault();
    const a = e.dataset.ind || e.dataset.sub;
    a && window._addFav && window._addFav(a);
  });
}),
  document.addEventListener("click", (e) => {
    K.contains(e.target) || (K.style.display = "none");
  }),
  (window._customMA = JSON.parse(
    localStorage.getItem(
      "chartOS_customMA_" + (localStorage.getItem("userName") || "guest"),
    ) || "[]",
  )),
  (window._customSUB = JSON.parse(
    localStorage.getItem(
      "chartOS_customSUB_" + (localStorage.getItem("userName") || "guest"),
    ) || "[]",
  )),
  (window.saveCustomInds = Le));
function Le() {
  (localStorage.setItem(
    "chartOS_customMA_" + (localStorage.getItem("userName") || "guest"),
    JSON.stringify(window._customMA),
  ),
    localStorage.setItem(
      "chartOS_customSUB_" + (localStorage.getItem("userName") || "guest"),
      JSON.stringify(window._customSUB),
    ),
    z());
}
const st = [
  "#E53935",
  "#FF6D00",
  "#FFD600",
  "#43A047",
  "#1E88E5",
  "#3949AB",
  "#8E24AA",
  "#F06292",
  "#26A69A",
  "#FF8A65",
];
((window.addCustomMA = function () {
  document.getElementById("indPopup")?.remove();
  const e = document.createElement("div");
  ((e.id = "indPopup"),
    (e.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:10px;padding:14px;z-index:9999;min-width:250px;color:var(--text);font-size:14px;box-shadow:0 8px 24px rgba(106,30,51,0.1)"));
  const n = [
      { t: "EMA", l: "EMA" },
      { t: "SMA", l: "SMA" },
      { t: "TEMA", l: "TEMA" },
      { t: "WMA", l: "WMA" },
      { t: "HMA", l: "HMA" },
    ],
    a = [5, 9, 10, 13, 20, 21, 34, 50, 55, 60, 100, 120, 200, 224];
  let r = "EMA",
    i = new Set();
  function y() {
    let f =
      '<div style="font-weight:700;margin-bottom:8px;color:#C4384B">\uC774\uB3D9\uD3C9\uADE0\uC120 \uCD94\uAC00</div>';
    f +=
      '<div style="margin-bottom:8px"><span style="color:#8E7D72;font-size:14px">\uD0C0\uC785</span><div style="display:flex;gap:4px;margin-top:3px">';
    for (const m of n)
      f += `<div onclick="this.parentElement.querySelectorAll('div').forEach(d=>d.style.background='transparent');this.style.background='var(--accent)';document.querySelector('#maPopup')._selType='${m.t}'" style="padding:3px 10px;border:1px solid var(--border);border-radius:4px;cursor:pointer;${r === m.t ? "background:var(--accent);color:#fff" : "background:transparent"}">${m.l}</div>`;
    ((f += "</div></div>"),
      (f +=
        '<div style="margin-bottom:8px"><span style="color:#8E7D72;font-size:14px">\uAE30\uAC04 (\uC5EC\uB7EC\uAC1C \uC120\uD0DD \uAC00\uB2A5)</span><div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">'));
    for (const m of a)
      f += `<div class="ma-period-btn" data-p="${m}" onclick="this.classList.toggle('sel');this.style.background=this.classList.contains('sel')?'var(--accent)':'transparent'" style="padding:2px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px;${i.has(m) ? "background:var(--accent);color:#fff" : "background:transparent"}">${m}</div>`;
    ((f += "</div></div>"),
      (f +=
        '<div style="margin-bottom:6px"><span style="color:#8E7D72;font-size:14px">\uC9C1\uC811 \uC785\uB825</span> <input id="maCustomPeriod" type="number" min="1" max="1000" placeholder="\uAE30\uAC04" style="width:60px;padding:2px 4px;background:#FFFDF9;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px"></div>'),
      (f += `<div style="display:flex;gap:6px;justify-content:flex-end"><button onclick="document.getElementById('maPopup')?.remove()" style="padding:4px 12px;border:1px solid var(--border);background:none;color:var(--text);border-radius:4px;cursor:pointer;font-size:14px">\uCDE8\uC18C</button>`),
      (f +=
        '<button id="maAddBtn" style="padding:4px 12px;border:none;background:#C4384B;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600">\uCD94\uAC00</button></div>'),
      (e.innerHTML = f));
  }
  (y(),
    (e.id = "maPopup"),
    (e._selType = r),
    document.body.appendChild(e),
    (e.querySelector("#maAddBtn").onclick = function () {
      const f = e._selType || "EMA",
        m = [];
      e.querySelectorAll(".ma-period-btn.sel").forEach((v) =>
        m.push(parseInt(v.dataset.p)),
      );
      const b = parseInt(e.querySelector("#maCustomPeriod").value);
      if ((b > 0 && m.push(b), !m.length)) {
        X(t("\uAE30\uAC04\uC744 \uC120\uD0DD\uD558\uC138\uC694"), "#3B82F6");
        return;
      }
      for (const v of m) {
        const s = "custom_ma_" + Date.now() + "_" + v,
          l = st[_customMA.length % st.length];
        _customMA.push({ id: s, type: f, period: v, color: l, width: 1 });
      }
      (Le(),
        Je(),
        Y(),
        document.getElementById("indPopup")?.remove(),
        e.remove());
    }));
}),
  (window.addCustomSUB = function () {
    document.getElementById("indPopup")?.remove();
    const e = document.createElement("div");
    ((e.id = "indPopup"),
      (e.style.cssText =
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:10px;padding:14px;z-index:9999;min-width:250px;color:var(--text);font-size:14px;box-shadow:0 8px 24px rgba(106,30,51,0.1)"));
    const n = [
        { t: "RSI", l: "RSI" },
        { t: "MACD", l: "MACD" },
        { t: "STOCH", l: "Stoch" },
        { t: "ATR", l: "ATR" },
        { t: "CCI", l: "CCI" },
        { t: "ADX", l: "ADX" },
        { t: "MFI", l: "MFI" },
        { t: "ROC", l: "ROC" },
        { t: "WILLR", l: "W%R" },
        { t: "IMACD", l: "IMACD" },
      ],
      a = [7, 9, 12, 14, 20, 26, 50];
    let r =
      '<div style="font-weight:700;margin-bottom:8px;color:#A31540">\uC11C\uBE0C\uC9C0\uD45C \uCD94\uAC00</div>';
    r +=
      '<div style="margin-bottom:8px"><span style="color:#8E7D72;font-size:14px">\uD0C0\uC785</span><div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">';
    for (const i of n)
      r += `<div class="sub-type-btn" data-t="${i.t}" onclick="this.parentElement.querySelectorAll('div').forEach(d=>{d.style.background='transparent';d.style.color='var(--text)'});this.style.background='var(--accent)';this.style.color='#fff'" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px">${i.l}</div>`;
    ((r += "</div></div>"),
      (r +=
        '<div style="margin-bottom:8px"><span style="color:#8E7D72;font-size:14px">\uAE30\uAC04</span><div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">'));
    for (const i of a)
      r += `<div class="sub-period-btn" data-p="${i}" onclick="this.classList.toggle('sel');this.style.background=this.classList.contains('sel')?'var(--accent)':'transparent'" style="padding:2px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px">${i}</div>`;
    ((r += "</div></div>"),
      (r +=
        '<div style="margin-bottom:6px"><span style="color:#8E7D72;font-size:14px">\uC9C1\uC811 \uC785\uB825</span> <input id="subCustomPeriod" type="number" min="1" max="500" placeholder="\uAE30\uAC04" style="width:60px;padding:2px 4px;background:#FFFDF9;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px"></div>'),
      (r += `<div style="display:flex;gap:6px;justify-content:flex-end"><button onclick="document.getElementById('indPopup')?.remove()" style="padding:4px 12px;border:1px solid var(--border);background:none;color:var(--text);border-radius:4px;cursor:pointer;font-size:14px">\uCDE8\uC18C</button>`),
      (r +=
        '<button id="subAddBtn" style="padding:4px 12px;border:none;background:#A31540;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600">\uCD94\uAC00</button></div>'),
      (e.innerHTML = r),
      document.body.appendChild(e),
      (e.querySelector("#subAddBtn").onclick = function () {
        const i = e.querySelector('.sub-type-btn[style*="accent"]');
        if (!i) {
          X(t("\uD0C0\uC785\uC744 \uC120\uD0DD\uD558\uC138\uC694"), "#3B82F6");
          return;
        }
        const y = i.dataset.t,
          f = [];
        e.querySelectorAll(".sub-period-btn.sel").forEach((b) =>
          f.push(parseInt(b.dataset.p)),
        );
        const m = parseInt(e.querySelector("#subCustomPeriod").value);
        (m > 0 && f.push(m), f.length || f.push(14));
        for (const b of f) {
          const v = "custom_sub_" + Date.now() + "_" + b,
            s = st[_customSUB.length % st.length];
          _customSUB.push({ id: v, type: y, period: b, color: s });
        }
        (Le(),
          Ne(),
          Y(),
          document.getElementById("indPopup")?.remove(),
          e.remove());
      }));
  }));
function Bo(e) {
  ((_customMA = _customMA.filter((n) => n.id !== e)),
    (window._customMA = _customMA),
    Le(),
    o && o.removeIndicator(e),
    Je());
}
((window.removeCustomMA = Bo), (window.removeCustomSUB = Ao));
function Ao(e) {
  ((_customSUB = _customSUB.filter((n) => n.id !== e)),
    (window._customSUB = _customSUB),
    Le(),
    o && o.subCharts && delete o.subCharts[e],
    o && o._recalcLayout && o._recalcLayout(),
    Ne(),
    Y());
}
window.renderCustomMA = Je;
function Je() {
  const e = document.getElementById("customMAList");
  e &&
    ((e.innerHTML = ""),
    document.querySelectorAll("[data-ma-type]").forEach((n) => {
      const a = n.dataset.maType,
        r = (window._customMA || []).some((i) => i.type === a);
      n.classList.toggle("on", r);
    }),
    Te());
}
window.renderCustomSUB = Ne;
function Ne() {
  const e = document.getElementById("customSUBList");
  e && ((e.innerHTML = ""), Te());
}
(Je(),
  Ne(),
  document
    .querySelectorAll(
      ".ind-bar .ind-tag[data-ind],.ind-bar .ind-tag[data-sub],.ind-bar .sub-ind[data-sub]",
    )
    .forEach((el) => {
      if (el.dataset.strategy || el.dataset.draw || el.dataset.action) return;
      if (el.querySelector(".ind-gear")) return;
      const id = el.dataset.sub || el.dataset.ind;
      if (!id) return;
      const gear = document.createElement("span");
      gear.className = "ind-gear";
      gear.textContent = "";
      gear.style.cssText =
        "opacity:0;font-size:14px;color:#8E7D72;cursor:pointer;transition:opacity 0.15s;margin-left:4px";
      el.addEventListener("mouseenter", () => (gear.style.opacity = "1"));
      el.addEventListener("mouseleave", () => (gear.style.opacity = "0"));
      gear.addEventListener("click", function (ev) {
        ev.stopPropagation();
        window.openSettings &&
          window.openSettings(
            el.textContent.replace(/[\s]+$/g, "").trim(),
            null,
            id,
            id,
          );
      });
      el.appendChild(gear);
    }));
(document.querySelectorAll(".pro-ind,.member-ind").forEach(
  (e) =>
    (e.onclick = function () {
      vt();
      const a = {
        ob: window._toggleOB,
        autotrend: window._toggleAutoTrend,
        ultra: window._toggleUltraTrend,
        bimaco2: window._toggleBimaco2,
        ttr: window._toggleTTR,
        buyscan: window._toggleBuyScan,
        align: window._toggleAlignment,
        entry: window._toggleEntry,
        entry2: window._toggleEntry2,
        bimaco_tp: window._toggleBimacoTP,
        v12sig: window._toggleV12sig,
        _u: window._toggleUprsi,
        udstoch: window._toggleUdstoch,
        rsimfi: window._toggleRsimfi,
        stc: window._toggleStc,
        pasrpvi: window._togglePasrpvi,
        ladder: window._toggleLadder,
        autobot: window._toggleAutobot,
        obsig: window._toggleObsig,
        rsimfi_1y: window._toggle_rsimfi_1y,
        pasr_orig: window._toggle_pasr_orig,
        pasr_1m: window._toggle_pasr_1m,
        pasr_1y: window._toggle_pasr_1y,
        bs_orig: window._toggle_bs_orig,
        bs_1m: window._toggle_bs_1m,
        bs_1y: window._toggle_bs_1y,
        al_orig: window._toggle_al_orig,
        al_1m: window._toggle_al_1m,
        al_1y: window._toggle_al_1y,
        pasr_1yo: window._toggle_pasr_1yo,
        bs_1yo: window._toggle_bs_1yo,
        al_1yo: window._toggle_al_1yo,
        qsig_safe: window._toggleQSigSafe,
        qsig_std: window._toggleQSigStd,
        qsig_aggr: window._toggleQSigAggr,
        beom_free: window._toggleBeomFree,
        darak: window._toggleDarak,
        beom_auto: window._toggleBeomAuto,
        beom_auto2: window._toggleBeomAuto2,
      }[this.dataset.ind];
      if ((a && a(), !this.classList.contains("on")))
        document.getElementById("indSettingsPanel")?.classList.remove("open");
      Te();
    }),
),
  document.querySelectorAll(".sub-ind").forEach(
    (e) =>
      (e.onclick = function () {
        if (
          !window.requireLogin ||
          !window.requireLogin(this.textContent.replace("", "").trim())
        )
          return;
        if (
          !(
            this.classList.contains("pro-ind") &&
            !requireLogin(this.textContent)
          ) &&
          !(
            this.classList.contains("member-ind") &&
            !requireLogin(this.textContent)
          )
        ) {
          if (
            !this.classList.contains("on") &&
            document.querySelectorAll(".sub-ind.on").length >= 6
          ) {
            X(
              e(
                "\uC11C\uBE0C\uCC28\uD2B8\uB294 \uCD5C\uB300 6\uAC1C\uAE4C\uC9C0 \uD45C\uC2DC \uAC00\uB2A5\uD569\uB2C8\uB2E4",
              ),
              "#3B82F6",
            );
            return;
          }
          if (
            (vt(), this.classList.toggle("on"), !this.classList.contains("on"))
          )
            document
              .getElementById("indSettingsPanel")
              ?.classList.remove("open");
          else {
            const n = this.textContent.replace(/[\s]+$/g, "").trim();
            window.openSettings &&
              window.openSettings(
                n,
                null,
                this.dataset.sub || null,
                this.dataset.ind || null,
              );
          }
          (Y(), Te(), z());
        }
      }),
  ),
  function _showUnifiedNotice(kind, featureLabel) {
    const feature = String(featureLabel || "기능").trim();
    const esc = (s) =>
      String(s || "").replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[ch],
      );

    const configs = {
      member: {
        tone: "member",
        badge: "MEMBER ONLY",
        title: "회원 전용 기능입니다",
        desc: `<b>${esc(feature)}</b>은(는) 로그인 후 이용할 수 있습니다.<br>지금 로그인하고 모든 기능을 사용해보세요.`,
        actions: `<button type="button" class="pro-notice-btn ghost" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open')">닫기</button>
          <button type="button" class="pro-notice-btn" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window.showAuth?.()">로그인</button>
          <button type="button" class="pro-notice-btn secondary" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window.showAuth?.('register')">회원가입</button>`,
      },
      premium: {
        tone: "premium",
        badge: "PREMIUM",
        title: "VIP 전용 기능입니다",
        desc: `<b>${esc(feature)}</b>은(는) VIP 플랜에서 제공됩니다.<br>구독 플랜을 확인하고 기능을 활성화해보세요.`,
        actions: `<button type="button" class="pro-notice-btn ghost" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open')">닫기</button>
          <button type="button" class="pro-notice-btn secondary" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window._showSubscribePlans?.()">구독 플랜</button>
          <button type="button" class="pro-notice-btn" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window.showAuth?.()">로그인</button>`,
      },
      coming: {
        tone: "coming",
        badge: "COMING SOON",
        title: "결제 시스템 준비 중",
        desc: `현재 <b>${esc(feature)}</b> 기능은 고도화 중입니다.<br>오픈 시 가장 먼저 사용하실 수 있도록 안내해드릴게요.`,
        actions: `<button type="button" class="pro-notice-btn ghost" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open')">닫기</button>
          <button type="button" class="pro-notice-btn secondary" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window._showSubscribePlans?.()">플랜 확인</button>
          <button type="button" class="pro-notice-btn" onclick="document.getElementById('_unifiedNoticeModal')?.classList.remove('open');window.showAuth?.()">알림 받기</button>`,
      },
    };

    const cfg = configs[kind] || configs.member;

    let modal = document.getElementById("_unifiedNoticeModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "_unifiedNoticeModal";
      modal.className = "pro-notice-modal";
      modal.onclick = (ev) => {
        if (ev.target === modal) modal.classList.remove("open");
      };
      document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="pro-notice-card pro-notice-${cfg.tone}" role="dialog" aria-modal="true" aria-label="서비스 안내">
      <div class="pro-notice-badge pro-notice-badge-${cfg.tone}">${cfg.badge}</div>
      <h3 class="pro-notice-title">${cfg.title}</h3>
      <p class="pro-notice-desc">${cfg.desc}</p>
      <div class="pro-notice-actions">${cfg.actions}</div>
    </div>`;

    modal.classList.add("open");
  },

  window.showMemberOnlyNotice = function (featureLabel) {
    return _showUnifiedNotice("member", featureLabel);
  },
  window.showPremiumOnlyNotice = function (featureLabel) {
    return _showUnifiedNotice("premium", featureLabel);
  },
  window.showComingSoonNotice = function (featureLabel) {
    return _showUnifiedNotice("coming", featureLabel);
  },

  document.querySelectorAll(".right-tab").forEach(
    (e) =>
      (e.onclick = function () {
        const paneKey = this.dataset.p;
        const pane = document.getElementById(paneKey);
        if (!pane) {
          window._tabDiag = { missingPane: paneKey, at: Date.now() };
          X("탭 패널을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "#3B82F6");
          return;
        }

        const guestAllowedTabs = new Set([
          "llm",
          "ai",
          "mtf",
          "hot",
          "heatmap",
          "order",
          "position",
          "points",
        ]);
        if (!G() && !guestAllowedTabs.has(paneKey)) {
          window.showMemberOnlyNotice?.(
            this.textContent?.replace(/[\s]+$/g, "").trim() || "회원 전용 기능",
          );
          return;
        }

        (document
          .querySelectorAll(".right-tab")
          .forEach((a) => a.classList.remove("active")),
          document
            .querySelectorAll(".right-pane")
            .forEach((a) => a.classList.remove("active")),
          this.classList.add("active"),
          pane.classList.add("active"),
          paneKey === "mtf" && window.loadMTF?.(),
          paneKey === "heatmap" && window.loadHeatmap?.(),
          paneKey === "hot" && window._loadHotCoins?.(),
          paneKey === "position" && window._loadPositionData?.(),
          paneKey === "points" && window.PointsUI?.reload?.(),
          paneKey === "order" && window.PaperTrading?.refresh?.(),
          paneKey === "alerts" && window._initBeomAlertPanel?.(),
          paneKey === "ai" && G() && requestAI());
      }),
  ));
async function no() {
  const e = document.getElementById("aiUsageInfo");
  if (e)
    try {
      const a = await (
        await q(`${F}/v1/analysis/usage`, { headers: Me() })
      ).json();
      if (a.data?.tier === "free" && a.data?.usage?.ai_analysis) {
        const r = a.data.usage.ai_analysis;
        ((e.style.display = "block"),
          (e.innerHTML = `\uC624\uB298: ${r.used}/${r.limit}\uD68C \xB7 <a href="#" onclick="showExchangeVerify();return false" style="color:var(--accent)">\uBB34\uC81C\uD55C</a>`));
      } else if (a.data?.tier === "guest") {
        e.style.display = "block";
        const r = window.t || ((i) => i);
        e.innerHTML = `${r("\uCCB4\uD5D8: 1\uD68C/\uC77C \xB7")} <a href="#" onclick="showAuth();return false" style="color:var(--accent)">${r("\uAC00\uC785")}</a>`;
      } else e.innerHTML = "";
    } catch {}
}
let sn = 0;
window._manualAiRefresh = function () {
  (no(), requestAI());
};
let St = !1;
((window.requestAI = async function () {
  // AI 분석 탭 제거됨 — 대상 DOM(aiResult)이 없으면 아무 것도 하지 않는다.
  if (!document.getElementById("aiResult")) return;
  if (!St && requireLogin("AI \uBD84\uC11D")) {
    ((St = !0),
      (document.getElementById("aiResult").innerHTML =
        '<p style="color:var(--muted)">\uBD84\uC11D \uC911...</p>'));
    try {
      const n = await (
        await q(`${F}/v1/analysis/chart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol_id: B, timeframe: A }),
        })
      ).json();
      if (n.success && n.data?.summary) {
        const a = n.data.summary,
          r = lo;
        if (
          ((a.conclusion = r(a.conclusion)),
          (a.trend = r(a.trend)),
          (a.structure = r(a.structure)),
          (a.trendDetail = r(a.trendDetail)),
          (a.premiumDetail = r(a.premiumDetail)),
          (a.rsi = r(a.rsi)),
          (a.macd = r(a.macd)),
          (a.volatility = r(a.volatility)),
          (a.volumeAnalysis = r(a.volumeAnalysis)),
          (a.indicatorSummary = r(a.indicatorSummary)),
          (a.llmCommentary = r(a.llmCommentary)),
          a.consensus && (a.consensus.text = r(a.consensus.text)),
          a.orderBlocks && (a.orderBlocks = a.orderBlocks.map(r)),
          a.indicators)
        )
          for (const W in a.indicators) a.indicators[W] = r(a.indicators[W]);
        const i = a.signalSumRaw || 0,
          y = 12,
          f = Math.min(100, (Math.abs(i) / y) * 100),
          m = i >= 3 ? "#C4384B" : i <= -3 ? "#3B82F6" : "#6b7280",
          v = (((i + y) / (y * 2)) * 180 * Math.PI) / 180,
          s = 50 + 35 * Math.cos(Math.PI - v),
          l = 52 - 35 * Math.sin(Math.PI - v),
          d = `<svg width="120" height="70" viewBox="0 0 100 60" style="display:block;margin:4px auto">
        <path d="M10,52 A40,40 0 0,1 90,52" fill="none" stroke="#E8DDD0" stroke-width="8" stroke-linecap="round"/>
        <path d="M10,52 A40,40 0 0,1 50,12" fill="none" stroke="#3B82F6" stroke-width="8" stroke-linecap="round" opacity="0.4"/>
        <path d="M50,12 A40,40 0 0,1 90,52" fill="none" stroke="#C4384B" stroke-width="8" stroke-linecap="round" opacity="0.4"/>
        <circle cx="${s}" cy="${l}" r="4" fill="${m}"/>
        <line x1="50" y1="52" x2="${s}" y2="${l}" stroke="${m}" stroke-width="2" stroke-linecap="round"/>
        <text x="50" y="48" text-anchor="middle" fill="${m}" font-size="12" font-weight="700">${i}</text>
        <text x="10" y="58" text-anchor="middle" fill="#3B82F6" font-size="6">\uB9E4\uB3C4</text>
        <text x="90" y="58" text-anchor="middle" fill="#C4384B" font-size="6">\uB9E4\uC218</text>
      </svg>`,
          p =
            i >= 3
              ? "\uB9E4\uC218 \uC6B0\uC704"
              : i <= -3
                ? "\uB9E4\uB3C4 \uC6B0\uC704"
                : "\uC911\uB9BD/\uAD00\uB9DD",
          c = i >= 3 ? "#C4384B" : i <= -3 ? "#3B82F6" : "#8E7D72",
          u = Math.min(100, Math.round(f)),
          g = a.volatility?.includes("\uB192")
            ? "\uB192\uC74C"
            : a.volatility?.includes("\uB0AE")
              ? "\uB0AE\uC74C"
              : "\uBCF4\uD1B5",
          w = document.getElementById("mtfGrid");
        let h = 0,
          _ = 0;
        w &&
          w.querySelectorAll("span").forEach((W) => {
            (W.textContent.includes("\u25B2") && h++,
              W.textContent.includes("\u25BC") && _++);
          });
        const x =
            h >= 4
              ? "\uB2E4\uC911TF \uC0C1\uC2B9 \uD569\uC758"
              : _ >= 4
                ? "\uB2E4\uC911TF \uD558\uB77D \uD569\uC758"
                : "TF\uAC04 \uC758\uACAC \uBD84\uC0B0",
          k = window._lastAiScore || 0,
          $ = Math.abs(i - k) >= 3;
        ((window._lastAiScore = i),
          (document.getElementById("aiResult").innerHTML = `
        <div style="padding:6px;box-sizing:border-box;width:100%;max-width:100%;overflow:hidden">
          <!-- \uAC8C\uC774\uC9C0 + \uD589\uB3D9 \uC81C\uC548 -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${d}
            <div style="flex:1;text-align:center">
              <div style="font-size:14px;font-weight:800;color:${c}">${p}</div>
              <div style="font-size:14px;color:var(--muted);margin-top:2px">\uC2E0\uB8B0\uB3C4 ${u}% \xB7 ${g}</div>
            </div>
          </div>
          <!-- \uC885\uD569 \uD310\uB2E8 -->
          <div style="padding:6px 8px;border-radius:6px;margin-bottom:6px;background:${i >= 3 ? "rgba(196,56,75,0.08)" : i <= -3 ? "rgba(59,130,246,0.08)" : "rgba(142,125,114,0.06)"}">
            <div style="font-size:18px;font-weight:800;color:${m};margin-bottom:4px">${a.oneLineSummary || a.conclusion || "-"}</div><div style="font-size:13px;color:var(--text);line-height:1.4">${a.conclusion || ""}</div>
            <div style="font-size:14px;color:var(--muted);margin-top:2px">${a.trend || ""} \xB7 ${x}</div>
          </div>
          <!-- 5\uAC1C \uC9C0\uD45C -->
          ${
            a.indicators
              ? `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-bottom:6px">${Object.entries(
                  a.indicators,
                )
                  .map(
                    ([W, R]) =>
                      `<div style="text-align:center;padding:3px 1px;border-radius:4px;font-size:14px;background:${R === "\uB9E4\uC218" ? "rgba(196,56,75,0.12)" : R === "\uB9E4\uB3C4" ? "rgba(59,130,246,0.12)" : "rgba(107,114,128,0.06)"}"><div style="color:var(--muted)">${W}</div><div style="font-weight:700;color:${R === "\uB9E4\uC218" ? "#C4384B" : R === "\uB9E4\uB3C4" ? "#3B82F6" : "#8E7D72"}">${R}</div></div>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>`));
      }
    } catch {
      document.getElementById("aiResult").innerHTML =
        '<p style="color:var(--red)">\uBD84\uC11D \uC2E4\uD328</p>';
    } finally {
      St = !1;
    }
  }
}),
  (window._alertTypeChanged = function () {}));
function ln() {}
((window.createAlert = async function () {}),
  (window.deleteAlert = async function () {}));
async function Co() {}
((window.authToken = qe),
  (window.userName = Ve),
  (() => {
    try {
      Ve && localStorage.setItem("userName", Ve);
    } catch {}
  })(),
  (window.userPlan = $e));
function io(e) {
  if (!e || e === "cookie") return !1;
  try {
    return JSON.parse(atob(e.split(".")[1])).exp * 1e3 < Date.now();
  } catch {
    return !1;
  }
}
function ao() {
  (Oe(),
    X(
      t(
        "\uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694.",
      ),
      "#D8B66A",
    ),
    setTimeout(() => location.reload(), 1500));
}
(G() && io(Ze()) && ao(),
  setInterval(() => {
    G() && io(Ze()) && ao();
  }, 3e5));
function Z() {
  return $e === "pro" || $e === "premium";
}
let E = null,
  pe = !1,
  Ee = "column",
  lt = 1,
  re = "ETHUSDT",
  ke = "5m";
function dn(e) {
  ((lt = e),
    (document.getElementById("chart1Panel").style.outline =
      e === 1 ? "2px solid var(--accent)" : "none"));
  const n = document.getElementById("chart2Container");
  (n && (n.style.outline = e === 2 ? "2px solid var(--accent)" : "none"),
    e === 1
      ? ((document.getElementById("symName").textContent = B.replace(
          "USDT",
          "/USDT",
        )),
        window._updateSymName && window._updateSymName(B),
        window._updateSymIcon && window._updateSymIcon(B))
      : ((document.getElementById("symName").textContent = re.replace(
          "USDT",
          "/USDT",
        )),
        window._updateSymName && window._updateSymName(re),
        window._updateSymIcon && window._updateSymIcon(re)));
}
function kt() {
  requestAnimationFrame(() => {
    (o && o.resize && o.resize(), E && E.resize && E.resize());
  });
}
((window.toggleDualChart = function () {
  pe = !pe;
  const e = document.getElementById("chart2Container"),
    n = document.getElementById("chartsArea"),
    a = document.getElementById("dualBtn"),
    r = document.getElementById("dirBtn");
  if (pe) {
    ((e.style.display = "flex"),
      (n.style.flexDirection = Ee),
      a.classList.add("active"),
      (r.style.display = "inline-block"),
      (e.style.borderTop =
        Ee === "column" ? "2px solid var(--accent)" : "none"),
      (e.style.borderLeft = Ee === "row" ? "2px solid var(--accent)" : "none"));
    const i = B === "BTCUSDT" ? "ETHUSDT" : "BTCUSDT",
      y = document.getElementById("chart2Frame");
    ((y.src = `/?sym=${i}&tf=${A}&embed=1`),
      (document.getElementById("chart1Panel").style.outline =
        "2px solid var(--accent)"),
      (document.getElementById("chart1Panel").style.cursor = "pointer"),
      (e.style.cursor = "pointer"),
      (document.getElementById("chart1Panel").onclick = function () {
        ((this.style.outline = "2px solid var(--accent)"),
          (e.style.outline = "none"));
      }),
      (e.onclick = function () {
        ((document.getElementById("chart1Panel").style.outline = "none"),
          (this.style.outline = "2px solid var(--accent)"));
      }),
      setTimeout(kt, 200));
  } else {
    ((e.style.display = "none"),
      a.classList.remove("active"),
      (r.style.display = "none"),
      (document.getElementById("chart1Panel").style.outline = "none"));
    const i = document.getElementById("chart2Frame");
    ((i.src = ""), (lt = 1), setTimeout(kt, 100));
  }
}),
  (window.toggleDualDir = function () {
    if (!pe) return;
    Ee = Ee === "column" ? "row" : "column";
    const e = document.getElementById("chartsArea"),
      n = document.getElementById("chart2Container"),
      a = document.getElementById("dirBtn");
    ((e.style.flexDirection = Ee),
      (n.style.borderTop =
        Ee === "column" ? "2px solid var(--accent)" : "none"),
      (n.style.borderLeft = Ee === "row" ? "2px solid var(--accent)" : "none"),
      (a.textContent = Ee === "column" ? "\u21C4" : "\u21C5"),
      setTimeout(kt, 100));
  }),
  (window.loadChart2 = async function (_tgt, _symArg, _tfArg) {
    const _useTgt = !!_tgt;
    const e = _symArg || re,
      n = _tfArg || ke;
    ((function () {
      const a = document.getElementById("chart2SymName");
      a && (a.textContent = e.replace("USDT", "/USDT"));
    })(),
      document.querySelectorAll(".c2tf").forEach((a) => {
        (a.classList.remove("active"),
          a.dataset.c2tf === n && a.classList.add("active"));
      }));
    try {
      let s = function (c, u) {
          const g = 2 / (u + 1),
            w = [c[0]];
          for (let h = 1; h < c.length; h++)
            w.push(g * c[h] + (1 - g) * w[h - 1]);
          return w;
        },
        l = function (c, u) {
          const g = [];
          let w = 0;
          for (let h = 0; h < c.length; h++)
            ((w += c[h]),
              h >= u && (w -= c[h - u]),
              g.push(h >= u - 1 ? w / u : c[h]));
          return g;
        },
        d = function (c, u) {
          const g = [c[0]];
          for (let w = 1; w < c.length; w++)
            g.push((g[w - 1] * (u - 1) + c[w]) / u);
          return g;
        };
      const r = await (
        await q(
          `${F}/v1/charts/candles?symbolId=${e}&timeframe=${n}&limit=2000`,
        )
      ).json();
      if (!r.success || (!_useTgt && (e !== re || n !== ke))) return;
      const i = r.data.candles
          .map((_c) => ({
            time:
              parseInt(_c.openTime) > 1e12
                ? Math.floor(parseInt(_c.openTime) / 1e3)
                : Math.floor(new Date(_c.openTime).getTime() / 1e3),
            open: parseFloat(_c.open),
            high: parseFloat(_c.high),
            low: parseFloat(_c.low),
            close: parseFloat(_c.close),
            volume: parseFloat(_c.volume || 0),
          }))
          .filter((_c) => _c.time > 0 && !isNaN(_c.open)),
        y = document.getElementById("chart2Wrap");
      if (
        (_useTgt
          ? ((E = _tgt), E?.loadBars(i))
          : ((y.innerHTML = ""),
            (E = new mt(y)),
            E?.loadBars(i),
            E?.clearDrawings(),
            E?.linkTo &&
              window.chart &&
              window.chart.linkTo &&
              (E.linkTo(window.chart), window.chart.linkTo(E))),
        E && (E.showVolume = C("vol")),
        (window._chart2DataContext = { symbol: e, timeframe: n }),
        E.candleRenderer && (E.candleRenderer._chartType = qt),
        E?.onLoadMore(async () => {
          if (!E?.buffer.length) return;
          const c = E?.buffer.time[0],
            u = Math.floor(c * 1e3) - 1;
          try {
            const w = await (
              await q(
                `${F}/v1/charts/candles?symbolId=${re}&timeframe=${ke}&limit=2000&endTime=${u}`,
              )
            ).json();
            if (!w.success || !w.data?.candles?.length) return;
            const h = w.data.candles
              .map((_) => ({
                time:
                  parseInt(_.openTime) > 1e12
                    ? Math.floor(parseInt(_.openTime) / 1e3)
                    : Math.floor(new Date(_.openTime).getTime() / 1e3),
                open: parseFloat(_.open),
                high: parseFloat(_.high),
                low: parseFloat(_.low),
                close: parseFloat(_.close),
                volume: parseFloat(_.volume || 0),
              }))
              .filter((_) => _.time > 0 && !isNaN(_.open));
            h.length && E?.prependBars(h);
          } catch {}
        }),
        i.length)
      ) {
        const c = i[i.length - 1],
          u = parseFloat(c.close),
          g = parseFloat(c.open),
          w = ((u - g) / g) * 100,
          h = w > 0 ? "up" : w < 0 ? "down" : "flat";
        ((function () {
          const x = document.getElementById("chart2Price");
          x && (x.textContent = Ye(u));
        })(),
          (function () {
            const x = document.getElementById("chart2Price");
            x && (x.className = "price-big " + h);
          })());
        const _ = document.getElementById("chart2Change");
        _ &&
          ((_.textContent = (w > 0 ? "+" : "") + w.toFixed(2) + "%"),
          (_.className = "change-badge " + h));
      }
      if (Q)
        try {
          const u = await (
            await q(`${F}/v1/charts/ind-b?symbolId=${e}&timeframe=${n}`)
          ).json();
          if (u.success && u.data?.d) {
            E && (E._uc = u.data.d);
            for (const g of u.data.s || [])
              g.type === "ku"
                ? E?.addDrawing({
                    type: "signal",
                    index: g.index,
                    price: g.price,
                    signalType: "ku",
                  })
                : g.type === "kd" &&
                  E?.addDrawing({
                    type: "signal",
                    index: g.index,
                    price: g.price,
                    signalType: "kd",
                  });
          }
        } catch {}
      else E && (E._uc = null);
      const f = i.map((c) => parseFloat(c.close)),
        m = i.map((c) => parseFloat(c.high)),
        b = i.map((c) => parseFloat(c.low)),
        v = i.map((c) => parseFloat(c.volume || 0));
      if (C("ema9")) {
        const c = s(f, S("ema9", "period", 9));
        E?.setIndicator(
          "ema9",
          c.map((u, g) => ({ index: g, value: u })),
          S("ema9", "color", "#8E7D72"),
          S("ema9", "width", 1),
        );
      }
      if (C("ema20")) {
        const c = s(f, S("ema20", "period", 20));
        E?.setIndicator(
          "ema20",
          c.map((u, g) => ({ index: g, value: u })),
          S("ema20", "color", "#D8B66A"),
          S("ema20", "width", 1),
        );
      }
      if (C("ema50")) {
        const c = s(f, S("ema50", "period", 50));
        E?.setIndicator(
          "ema50",
          c.map((u, g) => ({ index: g, value: u })),
          S("ema50", "color", "#A31540"),
          S("ema50", "width", 1),
        );
      }
      if (C("ema200") && f.length >= 200) {
        const c = s(f, S("ema200", "period", 200));
        E?.setIndicator(
          "ema200",
          c.map((u, g) => ({ index: g, value: u })),
          S("ema200", "color", "#3B82F6"),
          S("ema200", "width", 2),
        );
      }
      if (C("sma50")) {
        const c = l(f, S("sma50", "period", 50));
        E?.setIndicator(
          "sma50",
          c.map((u, g) => ({ index: g, value: u })),
          S("sma50", "color", "#A31540"),
          S("sma50", "width", 1),
        );
      }
      if (C("sma200") && f.length >= 200) {
        const c = l(f, S("sma200", "period", 200));
        E?.setIndicator(
          "sma200",
          c.map((u, g) => ({ index: g, value: u })),
          S("sma200", "color", "#3B82F6"),
          S("sma200", "width", 1),
        );
      }
      if (C("bb")) {
        const bp = S("bb", "period", 20),
          bm = S("bb", "mult", 2),
          bc = S("bb", "color", "#921230"),
          bbw = S("bb", "width", 1),
          c = [],
          u = [],
          g = [];
        for (let w = 0; w < f.length; w++) {
          if (w < bp - 1) {
            (c.push({ index: w, value: f[w] }),
              u.push({ index: w, value: f[w] }));
            continue;
          }
          const h = f.slice(w - bp + 1, w + 1),
            _ = h.reduce((k, $) => k + $) / bp,
            x = Math.sqrt(h.reduce((k, $) => k + ($ - _) ** 2, 0) / bp);
          (c.push({ index: w, value: _ + bm * x }),
            u.push({ index: w, value: _ - bm * x }),
            g.push({ index: w, value: _ }));
        }
        (E?.setIndicator("bb_up", c, bc, bbw),
          E?.setIndicator("bb_mid", g, bc, Math.max(0.5, bbw * 0.7)),
          E?.setIndicator("bb_lo", u, bc, bbw));
      }
      if (C("wma20")) {
        const wp = S("wma20", "period", 20),
          wl = [];
        for (let z = 0; z < f.length; z++) {
          if (z < wp - 1) {
            wl.push(f[z]);
            continue;
          }
          let pp = 0,
            cc = 0;
          for (let q = 0; q < wp; q++)
            ((pp += f[z - q] * (wp - q)), (cc += wp - q));
          wl.push(pp / cc);
        }
        E?.setIndicator(
          "wma20",
          wl.map((z, p) => ({ index: p, value: z })),
          S("wma20", "color", "#8E7D72"),
          S("wma20", "width", 1),
        );
      }
      if (C("hma20")) {
        const hp = S("hma20", "period", 20),
          hl = Math.floor(hp / 2),
          hd = Math.floor(Math.sqrt(hp)),
          wma = (arr, nn) => {
            const x = [];
            for (let z = 0; z < arr.length; z++) {
              if (z < nn - 1) {
                x.push(arr[z]);
                continue;
              }
              let pp = 0,
                cc = 0;
              for (let q = 0; q < nn; q++)
                ((pp += arr[z - q] * (nn - q)), (cc += nn - q));
              x.push(pp / cc);
            }
            return x;
          },
          ha = wma(f, hl),
          hb = wma(f, hp),
          hg = ha.map((z, p) => 2 * z - hb[p]),
          hw = wma(hg, hd);
        E?.setIndicator(
          "hma20",
          hw.map((z, p) => ({ index: p, value: z })),
          S("hma20", "color", "#ec4899"),
          S("hma20", "width", 1.5),
        );
      }
      if (C("dema21") && f.length >= 42) {
        const dp = S("dema21", "period", 21),
          d1 = s(f, dp),
          d2 = s(d1, dp),
          dz = d1.map((z, p) => 2 * z - d2[p]);
        E?.setIndicator(
          "dema21",
          dz.map((z, p) => ({ index: p, value: z })),
          S("dema21", "color", "#6366f1"),
          S("dema21", "width", 1),
        );
      }
      if (C("dema")) {
        const dp = S("dema", "period", 21),
          e1 = s(f, dp),
          e2 = s(e1, dp),
          ez = e1.map((z, p) => 2 * z - e2[p]);
        E?.setIndicator(
          "dema",
          ez.map((z, p) => ({ index: p, value: z })),
          S("dema", "color", "#C4384B"),
          S("dema", "width", 2),
        );
      }
      if (C("envelope")) {
        const ep = S("envelope", "period", 20),
          epc = S("envelope", "pct", 5) / 100,
          ecol = S("envelope", "color", "#8B5CF6"),
          ew = S("envelope", "width", 1.5),
          ema_ = l(f, ep),
          eu = [],
          el = [];
        for (let z = 0; z < f.length; z++) {
          (eu.push({ index: z, value: ema_[z] * (1 + epc) }),
            el.push({ index: z, value: ema_[z] * (1 - epc) }));
        }
        (E?.setIndicator("env_up", eu, ecol, ew),
          E?.setIndicator("env_lo", el, ecol, ew));
      }
      if (C("psar")) {
        const ps = S("psar", "step", 0.02),
          pmx = S("psar", "max", 0.2),
          pcb = S("psar", "color_buy", "#C4384B"),
          pcs = S("psar", "color_sell", "#3B82F6"),
          pst = ps,
          pp = [];
        let pc = !0,
          pu = m[0],
          pg = ps,
          pw = b[0];
        for (let z = 0; z < f.length; z++) {
          if (z === 0) {
            pp.push({ index: z, value: pw, color: pc ? pcb : pcs });
            continue;
          }
          ((pw = pw + pg * (pu - pw)),
            pc
              ? ((pw = Math.min(
                  pw,
                  b[Math.max(0, z - 1)],
                  b[Math.max(0, z - 2)],
                )),
                b[z] < pw
                  ? ((pc = !1), (pw = pu), (pu = b[z]), (pg = ps))
                  : m[z] > pu && ((pu = m[z]), (pg = Math.min(pg + pst, pmx))))
              : ((pw = Math.max(
                  pw,
                  m[Math.max(0, z - 1)],
                  m[Math.max(0, z - 2)],
                )),
                m[z] > pw
                  ? ((pc = !0), (pw = pu), (pu = m[z]), (pg = ps))
                  : b[z] < pu && ((pu = b[z]), (pg = Math.min(pg + pst, pmx)))),
            pp.push({ index: z, value: pw, color: pc ? pcb : pcs }));
        }
        E?.setIndicator("psar", pp, pcb, S("psar", "width", 1.5), !0);
      }
      if (C("keltner")) {
        const kp = S("keltner", "period", 20),
          km = S("keltner", "mult", 1.5),
          kd = s(f, kp),
          ku = [],
          kl = [];
        for (let z = 0; z < f.length; z++) {
          let tr = 0;
          const w_ = Math.min(10, z + 1);
          for (let x = z; x > z - w_; x--) {
            const k_ =
              x > 0
                ? Math.max(
                    m[x] - b[x],
                    Math.abs(m[x] - f[x - 1]),
                    Math.abs(b[x] - f[x - 1]),
                  )
                : m[x] - b[x];
            tr += k_;
          }
          ((tr /= w_),
            ku.push({ index: z, value: kd[z] + km * tr }),
            kl.push({ index: z, value: kd[z] - km * tr }));
        }
        const kc = S("keltner", "color", "#A31540"),
          kw = S("keltner", "width", 1.5);
        (E?.setIndicator(
          "kelt_mid",
          kd.map((w, z) => ({ index: z, value: w })),
          kc,
          kw,
        ),
          E?.setIndicator("kelt_up", ku, kc + "66", kw * 0.7),
          E?.setIndicator("kelt_lo", kl, kc + "66", kw * 0.7));
      }
      if (E && !C("ichimoku")) {
        [
          "ichi_tenkan",
          "ichi_kijun",
          "ichi_spanA",
          "ichi_spanB",
          "ichi_chikou",
        ].forEach((k) => E.removeIndicator(k));
        E._ichiCloud = null;
      }
      if (C("ichimoku")) {
        const mid = (arr_, hi_, lo_, T) => {
            const P = [];
            for (let I = 0; I < arr_.length; I++) {
              if (I < T - 1) {
                P.push(arr_[I]);
                continue;
              }
              let D = -1 / 0,
                M = 1 / 0;
              for (let L = I - T + 1; L <= I; L++)
                (hi_[L] > D && (D = hi_[L]), lo_[L] < M && (M = lo_[L]));
              P.push((D + M) / 2);
            }
            return P;
          },
          it = S("ichimoku", "tenkan", 9),
          ik = S("ichimoku", "kijun", 26),
          is = S("ichimoku", "senkou", 52),
          ip = [],
          ic = [],
          iu = [],
          ig = [],
          iw = [],
          t_ = mid(f, m, b, it),
          k_ = mid(f, m, b, ik),
          s_ = mid(f, m, b, is);
        for (let z = 0; z < f.length; z++) {
          (ip.push({ index: z, value: t_[z] }),
            ic.push({ index: z, value: k_[z] }),
            z + ik < f.length &&
              (iu.push({ index: z + ik, value: (t_[z] + k_[z]) / 2 }),
              ig.push({ index: z + ik, value: s_[z] })),
            z >= ik && iw.push({ index: z - ik, value: f[z] }));
        }
        (S("ichimoku", "show_tenkan", "on") === "on"
          ? E?.setIndicator(
              "ichi_tenkan",
              ip,
              S("ichimoku", "color_tenkan", "#e91e63"),
              1,
            )
          : E?.removeIndicator("ichi_tenkan"),
          S("ichimoku", "show_kijun", "on") === "on"
            ? E?.setIndicator(
                "ichi_kijun",
                ic,
                S("ichimoku", "color_kijun", "#2196f3"),
                1,
              )
            : E?.removeIndicator("ichi_kijun"),
          S("ichimoku", "show_spanA", "on") === "on"
            ? E?.setIndicator(
                "ichi_spanA",
                iu,
                S("ichimoku", "color_spanA", "#4CAF50"),
                1,
              )
            : E?.removeIndicator("ichi_spanA"),
          S("ichimoku", "show_spanB", "on") === "on"
            ? E?.setIndicator(
                "ichi_spanB",
                ig,
                S("ichimoku", "color_spanB", "#FF5252"),
                1,
              )
            : E?.removeIndicator("ichi_spanB"),
          S("ichimoku", "show_chikou", "on") === "on"
            ? E?.setIndicator(
                "ichi_chikou",
                iw,
                S("ichimoku", "color_chikou", "#9C27B0"),
                1,
              )
            : E?.removeIndicator("ichi_chikou"),
          S("ichimoku", "cloud", "on") === "on" && E
            ? (E._ichiCloud = { spanA: iu, spanB: ig })
            : E && (E._ichiCloud = null));
      }
      if (C("pivot") && f.length > 1) {
        const plk =
            { "1m": 1440, "5m": 288, "15m": 96, "1h": 24, "4h": 6, "1d": 1 }[
              ke
            ] || 288,
          psl = Math.max(0, f.length - plk),
          ph = Math.max(...m.slice(psl)),
          plo = Math.min(...b.slice(psl)),
          pcl = f[f.length - 1],
          pv = (ph + plo + pcl) / 3,
          prng = ph - plo,
          pfib = S("pivot", "type", "classic") === "fibonacci",
          pr1 = pfib ? pv + 0.382 * prng : 2 * pv - plo,
          ps1 = pfib ? pv - 0.382 * prng : 2 * pv - ph,
          pr2 = pfib ? pv + 0.618 * prng : pv + prng,
          ps2 = pfib ? pv - 0.618 * prng : pv - prng,
          pr3 = pfib ? pv + prng : ph + 2 * (pv - plo),
          ps3 = pfib ? pv - prng : plo - 2 * (ph - pv);
        for (const [lab, val, col, lw] of [
          ["P", pv, "#D8B66A", 1.5],
          ["R1", pr1, "#3B82F6", 1],
          ["R2", pr2, "#3B82F6", 1],
          ["R3", pr3, "#2563EB", 0.7],
          ["S1", ps1, "#C4384B", 1],
          ["S2", ps2, "#C4384B", 1],
          ["S3", ps3, "#DC2626", 0.7],
        ])
          E?.addDrawing({
            type: "hline",
            price: val,
            color: col,
            lineWidth: lw,
            label: lab,
            dashed: lw < 1,
            _calcOwner: "pivot",
          });
      }
      if (C("tema20") || C("tema60")) {
        const tema = (arr, len) => {
            const e1 = s(arr, len),
              e2 = s(e1, len),
              e3 = s(e2, len);
            return e1.map((u, z) => 3 * (u - e2[z]) + e3[z]);
          },
          base = tema(f, 100),
          mkT = (arr, name) => {
            const out = [];
            for (let z = 1; z < arr.length; z++) {
              const up = arr[z] - arr[z - 1] > 0,
                above = arr[z] > base[z];
              let col;
              up && above
                ? (col = "#3B82F6")
                : !up && !above
                  ? (col = "#921230")
                  : (col = "#A31540");
              out.push({ index: z, value: arr[z], color: col });
            }
            (E?.setIndicator(name, out, "#A31540", S(name, "width", 2)),
              E &&
                ((E._temaColors = E._temaColors || {}),
                (E._temaColors[name] = out)));
          };
        (C("tema20") && mkT(tema(f, 20), "tema20"),
          C("tema60") && mkT(tema(f, 60), "tema60"));
      }
      if (C("volprofile") && E) {
        const vs_ = Math.max(0, f.length - S("volprofile", "lookback", 200)),
          vlo = Math.min(...b.slice(vs_)),
          vhi = Math.max(...m.slice(vs_)),
          vrows = S("volprofile", "rows", 30),
          vstep = (vhi - vlo) / vrows,
          vvol = new Array(vrows).fill(0),
          vbuy = new Array(vrows).fill(0);
        for (let z = vs_; z < f.length; z++) {
          const bi = Math.min(vrows - 1, Math.floor((f[z] - vlo) / vstep));
          vvol[bi] += v[z];
          E.buffer.open && f[z] >= E.buffer.open[z] && (vbuy[bi] += v[z]);
        }
        E._vpData = {
          rows: vrows,
          low: vlo,
          step: vstep,
          vol: vvol,
          buyVol: vbuy,
          max: Math.max(...vvol),
        };
      } else if (E) E._vpData = null;
      if (C("emaribbon")) {
        if (E && E.indicators)
          Object.keys(E.indicators).forEach((k) => {
            if (k.indexOf("ribbon") === 0) E.removeIndicator(k);
          });
        const rmt = S("emaribbon", "ma_type", "EMA"),
          rlen = S("emaribbon", "length", "\uB2E8\uAE30"),
          rw = S("emaribbon", "width", 1),
          rper =
            rlen === "\uC7A5\uAE30"
              ? [20, 50, 100, 150, 200]
              : [8, 13, 21, 34, 55];
        const rcol = [
          "#E53935",
          "#FF6D00",
          "#FFD600",
          "#43A047",
          "#1E88E5",
          "#8E24AA",
          "#00ACC1",
          "#F06292",
        ];
        rper.forEach((h, zi) => {
          let x;
          if (rmt === "SMA") x = l(f, h);
          else if (rmt === "WMA") {
            x = [];
            for (let k = 0; k < f.length; k++) {
              if (k < h - 1) {
                x.push(f[k]);
                continue;
              }
              let pp = 0,
                cc = 0;
              for (let q = 0; q < h; q++)
                ((pp += f[k - q] * (h - q)), (cc += h - q));
              x.push(pp / cc);
            }
          } else if (rmt === "HMA") {
            const k2 = Math.floor(h / 2),
              sq = Math.floor(Math.sqrt(h)),
              W = s(f, k2),
              R = s(f, h),
              T = W.map((P, I) => 2 * P - R[I]);
            x = s(T, sq);
          } else if (rmt === "DEMA") {
            const k = s(f, h),
              k2 = s(k, h);
            x = k.map((W, R) => 2 * W - k2[R]);
          } else if (rmt === "TEMA") {
            const k = s(f, h),
              k2 = s(k, h),
              k3 = s(k2, h);
            x = k.map((R, T) => 3 * R - 3 * k2[T] + k3[T]);
          } else x = s(f, h);
          E?.setIndicator(
            "ribbon" + h,
            x.map((k, z) => ({ index: z, value: k })),
            rcol[zi % 8],
            rw,
          );
        });
      }
      if (C("supertrend")) {
        const sp = S("supertrend", "period", 10),
          sm = S("supertrend", "mult", 3),
          atr = [];
        for (let z = 0; z < f.length; z++) {
          if (z < sp) {
            atr.push(m[z] - b[z]);
            continue;
          }
          let tr = 0;
          for (let q = z - sp + 1; q <= z; q++)
            tr += Math.max(
              m[q] - b[q],
              Math.abs(m[q] - f[q - 1]),
              Math.abs(b[q] - f[q - 1]),
            );
          atr.push(tr / sp);
        }
        const sl = [];
        let su = 1,
          sg = 0,
          sw = 0;
        for (let z = 0; z < f.length; z++) {
          const mid = (m[z] + b[z]) / 2;
          let lo = mid - sm * atr[z],
            hi = mid + sm * atr[z];
          ((lo = z > 0 && sg > 0 ? Math.max(lo, sg) : lo),
            (hi = z > 0 && sw > 0 ? Math.min(hi, sw) : hi),
            z > 0 && (f[z - 1] > sw ? (su = 1) : f[z - 1] < sg && (su = -1)),
            (sg = lo),
            (sw = hi));
          const sv = su === 1 ? lo : hi;
          sl.push({
            index: z,
            value: sv,
            color: su === 1 ? "#C4384B" : "#3B82F6",
          });
        }
        E?.setIndicator(
          "supertrend",
          sl,
          S("supertrend", "color", "#C4384B"),
          S("supertrend", "width", 2),
        );
      }
      if (C("vwap")) {
        const vs = [];
        let vl = 0,
          vd = 0;
        const vtf = ke,
          vDay = vtf === "1d" || vtf === "1w";
        for (let z = 0; z < f.length; z++) {
          if (!vDay && z > 0 && E?.buffer?.time) {
            const t0 = E.buffer.time[z - 1],
              t1 = E.buffer.time[z];
            if (
              t0 &&
              t1 &&
              new Date(t0 * 1000).getUTCDate() !==
                new Date(t1 * 1000).getUTCDate()
            ) {
              vl = 0;
              vd = 0;
            }
          }
          const tp = (m[z] + b[z] + f[z]) / 3;
          ((vd += tp * v[z]),
            (vl += v[z]),
            vs.push({ index: z, value: vl > 0 ? vd / vl : tp }));
        }
        E?.setIndicator(
          "vwap",
          vs,
          S("vwap", "color", "#8E7D72"),
          S("vwap", "width", 1.5),
        );
      }
      if (E.setSubChart) {
        if (E.subCharts)
          for (const c of Object.keys(E.subCharts)) J(c) || E.removeSubChart(c);
        if (J("rsi")) {
          const _rp = S("rsi", "period", 14),
            u = [0],
            g = [0];
          for (let x = 1; x < f.length; x++) {
            const k = f[x] - f[x - 1];
            (u.push(k > 0 ? k : 0), g.push(k < 0 ? -k : 0));
          }
          const w = d(u, _rp),
            h = d(g, _rp),
            _ = w.map((x, k) => ({
              index: k,
              value: h[k] === 0 ? 100 : 100 - 100 / (1 + x / h[k]),
            }));
          E?.setSubChart("rsi", {
            label: "RSI " + _rp,
            lines: [
              {
                data: _,
                color: S("rsi", "color", "#A31540"),
                lineWidth: S("rsi", "width", 1.5),
              },
            ],
            hlines: [
              { value: 70, color: "rgba(59,130,246,0.6)" },
              { value: 30, color: "rgba(196,56,75,0.6)" },
              { value: 50, color: "rgba(107,114,128,0.2)" },
            ],
            range: { min: 0, max: 100 },
          });
        }
        if (J("macd")) {
          const _mf = S("macd", "fast", 12),
            _ms = S("macd", "slow", 26),
            _mg = S("macd", "signal", 9),
            c = s(f, _mf),
            u = s(f, _ms),
            g = c.map((_, x) => _ - u[x]),
            w = s(g, _mg),
            h = g.map((_, x) => ({ index: x, value: _ - w[x] }));
          E?.setSubChart("macd", {
            label: "MACD(" + _mf + "," + _ms + "," + _mg + ")",
            lines: [
              {
                data: g.map((_, x) => ({ index: x, value: _ })),
                color: S("macd", "color1", "#921230"),
                lineWidth: 1.5,
              },
              {
                data: w.map((_, x) => ({ index: x, value: _ })),
                color: S("macd", "color2", "#D8B66A"),
                lineWidth: 1,
              },
              { data: h, color: "#6b7280", lineWidth: 0, histogram: !0 },
            ],
            hlines: [{ value: 0, color: "rgba(107,114,128,0.6)" }],
          });
        }
      }
      const p = [];
      (ne &&
        p.push(
          q(`${F}/v1/charts/orderblocks?symbolId=${e}&timeframe=${n}`)
            .then((c) => c.json())
            .then((c) => {
              if (c.success && c.data) {
                for (const u of c.data.bull || [])
                  E?.addDrawing({
                    type: "ob",
                    top: u.top,
                    bottom: u.bottom,
                    obType: "bull",
                    breaker: u.breaker,
                    volume: u.volume,
                    buy_pct: u.buy_pct,
                    sell_pct: u.sell_pct,
                  });
                for (const u of c.data.bear || [])
                  E?.addDrawing({
                    type: "ob",
                    top: u.top,
                    bottom: u.bottom,
                    obType: "bear",
                    breaker: u.breaker,
                    volume: u.volume,
                    buy_pct: u.buy_pct,
                    sell_pct: u.sell_pct,
                  });
              }
            })
            .catch(() => {}),
        ),
        se &&
          p.push(
            q(`${F}/v1/charts/trendlines?symbolId=${e}&timeframe=${n}`)
              .then((c) => c.json())
              .then((c) => {
                if (c.success)
                  for (const u of c.data || [])
                    if (u.type === "horizontal") {
                      const g = u.label || "";
                      E?.addDrawing({
                        type: "hline",
                        price: u.points[0].price,
                        color: u.color,
                        lineWidth: u.lineWidth || 1,
                        label: g,
                      });
                    } else
                      E?.addDrawing({
                        type: "trendline",
                        points: u.points,
                        color: u.color,
                        lineWidth: 2,
                      });
              })
              .catch(() => {}),
          ),
        le &&
          p.push(
            q(`${F}/v1/charts/signals/ttr?symbolId=${e}&timeframe=${n}`)
              .then((c) => c.json())
              .then((c) => {
                if (c.success && c.data)
                  for (const u of c.data.signals || [])
                    (u.type === "tp_buy" || u.type === "tp_sell") &&
                      E?.addDrawing({
                        type: "ttr",
                        index: u.index,
                        price: u.price,
                        ttrType: u.type,
                      });
              })
              .catch(() => {}),
          ),
        ie &&
          p.push(
            q(`${F}/v1/charts/signals/buy-scanner?symbolId=${e}&timeframe=${n}`)
              .then((c) => c.json())
              .then((c) => {
                if (c.success)
                  for (const u of c.data || [])
                    E?.addDrawing({
                      type: "buy_scan",
                      index: u.index,
                      price: u.price,
                      cross: u.cross,
                      scanType: u.type,
                    });
              })
              .catch(() => {}),
          ),
        await Promise.all(p));
    } catch {}
  }),
  (window.captureChart = function () {
    const e = document.getElementById("chartWrap");
    if (!e || !o) return;
    const n = e.querySelector("canvas");
    if (!n) return;
    const a = e.querySelectorAll("canvas"),
      r = document.createElement("canvas");
    ((r.width = n.width), (r.height = n.height));
    const i = r.getContext("2d"),
      y =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim() || "#FAF6F0";
    ((i.fillStyle = y), i.fillRect(0, 0, r.width, r.height));
    for (const m of a) i.drawImage(m, 0, 0);
    const f =
      document.documentElement.classList.contains("dark") ||
      document.body.dataset.theme === "dark";
    ((i.fillStyle = f ? "rgba(255,255,255,0.15)" : "rgba(61,43,31,0.15)"),
      (i.font = "bold 24px sans-serif"),
      i.fillText(
        "BitMart Korea",
        n.width / window.devicePixelRatio / 2 - 80,
        n.height / window.devicePixelRatio / 2,
      ),
      (i.fillStyle = f ? "rgba(255,255,255,0.4)" : "rgba(61,43,31,0.35)"),
      (i.font = "11px sans-serif"),
      i.fillText(
        `${B} ${A} \u2014 ${new Date().toLocaleString("ko-KR")}`,
        10,
        n.height / window.devicePixelRatio - 10,
      ),
      r.toBlob((m) => {
        const b = URL.createObjectURL(m),
          v = document.createElement("a");
        ((v.href = b),
          (v.download = `chart_${B}_${A}_${Date.now()}.png`),
          v.click(),
          URL.revokeObjectURL(b));
      }, "image/png"));
  }),
  (window.captureChart2 = function () {
    const e = document.getElementById("chart2Wrap");
    if (!e || !E) return;
    const n = e.querySelector("canvas");
    if (!n) return;
    const a = e.querySelectorAll("canvas"),
      r = document.createElement("canvas");
    ((r.width = n.width), (r.height = n.height));
    const i = r.getContext("2d"),
      y =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim() || "#FAF6F0";
    ((i.fillStyle = y), i.fillRect(0, 0, r.width, r.height));
    for (const m of a) i.drawImage(m, 0, 0);
    const f =
      document.documentElement.classList.contains("dark") ||
      document.body.dataset.theme === "dark";
    ((i.fillStyle = f ? "rgba(255,255,255,0.3)" : "rgba(61,43,31,0.3)"),
      (i.font = "12px sans-serif"),
      i.fillText(
        `\uBC94\uC628 AI \uC288\uD37C\uCC28\uD2B8 \u2014 ${re} ${ke} \u2014 ${new Date().toLocaleString("ko-KR")}`,
        10,
        n.height / window.devicePixelRatio - 10,
      ),
      r.toBlob((m) => {
        const b = URL.createObjectURL(m),
          v = document.createElement("a");
        ((v.href = b),
          (v.download = `chart_${re}_${ke}_${Date.now()}.png`),
          v.click(),
          URL.revokeObjectURL(b));
      }, "image/png"));
  }),
  (window.saveLayout = async function () {
    if (!G()) {
      showAuth();
      return;
    }
    const e = await _modal({
      title: "\uB808\uC774\uC544\uC6C3 \uC800\uC7A5",
      input: B + " " + A,
      placeholder: "\uC774\uB984",
    });
    if (!e) return;
    const n = [];
    document
      .querySelectorAll(".ind-tag.on")
      .forEach((a) => n.push(a.dataset.ind));
    try {
      (await window.api.post(F + "/v1/layouts", {
        name: e,
        symbol_id: B,
        timeframe: A,
        chart_type: "candles",
        theme: "dark",
        layout_json: { indicators: n },
      }),
        X(t("\uC800\uC7A5 \uC644\uB8CC"), "#C4384B"));
    } catch {
      X(t("\uC800\uC7A5 \uC2E4\uD328"), "#3B82F6");
    }
  }),
  (window.loadLayouts = async function () {
    if (!G()) {
      showAuth();
      return;
    }
    let e = [];
    try {
      e =
        (
          await (
            await fetch(F + "/v1/layouts", { headers: { ...Me() } })
          ).json()
        ).data?.items || [];
    } catch {
      X(t("\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328"), "#3B82F6");
      return;
    }
    if (!e.length) {
      X(
        t("\uC800\uC7A5\uB41C \uB808\uC774\uC544\uC6C3 \uC5C6\uC74C"),
        "#3B82F6",
      );
      return;
    }
    const n = await _modal({
      title: "\uB808\uC774\uC544\uC6C3 \uBD88\uB7EC\uC624\uAE30",
      desc: e.map((r, i) => i + 1 + ". " + r.name).join("<br>"),
      input: "",
      placeholder: "\uBC88\uD638 \uC785\uB825",
    });
    if (!n) return;
    const a = e[parseInt(n) - 1];
    a && window._selectSym(a.symbolId || B);
  }));
let Ie = 1e3;
function _wsSendSafe(payload) {
  try {
    if (!N || N.readyState !== 1) return !1;
    N.send(JSON.stringify(payload));
    return !0;
  } catch {
    return !1;
  }
}
if (G() && "Notification" in window && Notification.permission === "granted")
  try {
    navigator.serviceWorker?.ready?.then((e) => {
      e.pushManager?.getSubscription()?.then((n) => {
        n &&
          window.api
            .post(F + "/v1/auth/fcm-token", { token: JSON.stringify(n) })
            .catch(() => {});
      });
    });
  } catch {}
function It() {
  if (!window._wsConnecting) {
    window._wsConnecting = !0;
    try {
      if (N && N.readyState !== WebSocket.CLOSED) {
        ((N.onopen = null),
          (N.onmessage = null),
          (N.onclose = null),
          (N.onerror = null));
        try {
          N.close();
        } catch {}
      }
    } catch {}
    try {
      const e = location.protocol === "https:" ? "wss" : "ws";
      N = new WebSocket(`${e}://${location.host}/v1/ws`);
      const n = document.getElementById("wsDot");
      ((N.onopen = () => {
        ((window._wsConnecting = !1),
          (Ie = 1e3),
          (window._lastWsMsgAt = Date.now()),
          (window._lastWsPingAt = 0),
          n &&
            ((n.style.background = "#C4384B"),
            (n.title = "\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428")),
          (window._lastWsSub = { name: "candle", symbolId: B, timeframe: A }),
          (window._lastWsTickerSub = { name: "ticker", symbolId: B }));
        const _allTickers = (ze || [])
          .slice(0, 50)
          .map((s) => ({ name: "ticker", symbolId: s.code }));
        window._lastWsAllTickers = _allTickers;
        (N.readyState === 1 &&
          N.send(
            JSON.stringify({
              action: "subscribe",
              channels: [
                window._lastWsSub,
                window._lastWsTickerSub,
                ..._allTickers,
              ],
            }),
          ),
          pe &&
            re &&
            ((window._lastWsSubChart2 = {
              name: "candle",
              symbolId: re,
              timeframe: ke,
            }),
            N.readyState === 1 &&
              N.send(
                JSON.stringify({
                  action: "subscribe",
                  channels: [window._lastWsSubChart2],
                }),
              )),
          De(),
          "Notification" in window &&
            Notification.permission === "default" &&
            Notification.requestPermission());
      }),
        (N.onmessage = (a) => {
          try {
            const r = JSON.parse(a.data);
            if ((window._lastWsMsgAt = Date.now()), r.type === "pong") {
              window._lastWsPongAt = Date.now();
              return;
            }
            if (window._wsDebug && r.type === "candle.update") {
              const i = r.data || {};
            }
            if (r.type === "alert" && r.data) {
              const i = r.data,
                y = i.ruleType === "BEOM_SIGNAL",
                f = (i.symbol || "").replace("USDT", ""),
                m =
                  i.signalType === "buy"
                    ? "\uB9E4\uC218"
                    : i.signalType === "sell"
                      ? "\uB9E4\uB3C4"
                      : i.signalType === "ku"
                        ? "AI\u2191"
                        : i.signalType === "kd"
                          ? "AI\u2193"
                          : i.signalType || "",
                b = y
                  ? `${f} ${i.timeframe || ""} ${m}`
                  : `${i.symbol} ${i.ruleType} @ ${Ye(i.triggerPrice)}`;
              "Notification" in window &&
                Notification.permission === "granted" &&
                new Notification(
                  y
                    ? "AI \uC2DC\uADF8\uB110"
                    : "\uC54C\uB9BC \uD2B8\uB9AC\uAC70",
                  { body: b, icon: "/static/favicon.svg" },
                );
              try {
                (window._alertAudio ||
                  (window._alertAudio = new Audio("/static/tiger_roar.wav")),
                  (window._alertAudio.currentTime = 0),
                  window._alertAudio.play().catch(() => {}));
              } catch {}
              const v = document.createElement("div");
              ((v.style.cssText =
                "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:" +
                (y ? "rgba(106,30,51,0.95)" : "rgba(216,182,106,0.95)") +
                ";color:#fff;padding:16px 28px;border-radius:12px;font-size:14px;font-weight:700;z-index:9999;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fadeIn 0.3s"),
                (v.innerHTML =
                  (y
                    ? `<div style="font-size:14px;opacity:0.8;margin-bottom:4px">AI \uC2DC\uADF8\uB110</div><div>${f} ${i.timeframe || ""}</div><div style="font-size:14px;margin-top:4px">${m}</div>`
                    : `<div>${b}</div>`) +
                  '<button onclick="this.parentElement.remove()" style="position:absolute;top:6px;right:10px;background:none;border:none;color:rgba(255,255,255,0.7);font-size:14px;cursor:pointer">\u2715</button>'),
                document.body.appendChild(v),
                y && window.loadBeomSignals?.());
            }
            if (r.type === "ticker.update" && r.data) {
              const i = r.data,
                y = i.symbol,
                f = He[B] || B;
              if (y === B || y === f) {
                const m = parseFloat(i.last_price);
                m > 0 &&
                  ((window._rt.lastPrice = m),
                  (window._rt.symbol = B),
                  (window._rt.source = "server_ticker"),
                  Ge());
              }
              /* 왼쪽 종목 패널 실시간 갱신 */ const _wp =
                document.getElementById("wp_" + y);
              if (_wp && i.last_price) {
                const _p = parseFloat(i.last_price),
                  _o = parseFloat(i.open || 0),
                  _pct = _o > 0 ? ((_p - _o) / _o) * 100 : 0,
                  _clr = _pct >= 0 ? "#C4384B" : "#3B82F6",
                  _sn = _pct >= 0 ? "+" : "",
                  _fmt = window.fmtPrice ? window.fmtPrice(_p) : String(_p);
                _wp.innerHTML = `<div style="font-weight:600;font-size:14px;color:#D8B66A">${_fmt}</div><div style="color:${_clr};font-size:14px;font-weight:600;margin-top:1px">${_sn}${_pct.toFixed(2)}%</div>`;
                window._wlPriceCache = window._wlPriceCache || {};
                window._wlPriceCache[y] = { price: _p, pct: _pct };
              }
            }
            if (r.type === "candle.update" && r.data) {
              const i = r.data,
                y = parseFloat(i.close),
                f = i.timeframe || i.tf || "",
                m = He[B] || B,
                b = i.symbol === B || i.symbol === m,
                v = !f || !A || f === A,
                s = window._chartDataContext || {},
                l = s.symbol === B && s.timeframe === A;
              if (b && v && l) {
                if (i.isFinal || i.is_final) {
                  if (
                    (o.appendBar(
                      Math.floor(i.open_time / 1e3),
                      parseFloat(i.open),
                      parseFloat(i.high),
                      parseFloat(i.low),
                      y,
                      parseFloat(i.volume),
                    ),
                    o._uc && o._uc.length > 0)
                  ) {
                    for (
                      ;
                      o._uc.length < o.buffer.length - 1 && o._uc.length < 1e4;
                    )
                      o._uc.push({
                        v: 0,
                        color: "rgba(128,128,128,0.3)",
                        border: !1,
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      });
                    o._uc.push({
                      v: 0,
                      color: "rgba(128,128,128,0.3)",
                      border: !1,
                      ho: parseFloat(i.open),
                      hh: parseFloat(i.high),
                      hl: parseFloat(i.low),
                      hc: y,
                    });
                  }
                  if (o._bc && o._bc.length > 0) {
                    for (
                      ;
                      o._bc.length < o.buffer.length - 1 && o._bc.length < 1e4;
                    )
                      o._bc.push({
                        color: "rgba(128,128,128,0.3)",
                        border: "",
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      });
                    o._bc.push({
                      color: "rgba(128,128,128,0.3)",
                      border: "",
                      ho: parseFloat(i.open),
                      hh: parseFloat(i.high),
                      hl: parseFloat(i.low),
                      hc: y,
                    });
                  }
                  o.timeScale.visibleTo >= o.buffer.length - 3 &&
                    (Y(), U(), Pt());
                } else {
                  const w = Math.floor((i.open_time || 0) / 1e3);
                  if (
                    (o.updateOrAppend
                      ? o.updateOrAppend(
                          w,
                          parseFloat(i.open),
                          parseFloat(i.high),
                          parseFloat(i.low),
                          y,
                          parseFloat(i.volume),
                        )
                      : o.updateBar(
                          parseFloat(i.open),
                          parseFloat(i.high),
                          parseFloat(i.low),
                          y,
                          parseFloat(i.volume),
                        ),
                    o._uc && o._uc.length > 0)
                  ) {
                    const h = o.buffer.length - 1;
                    for (
                      ;
                      o._uc.length < o.buffer.length && o._uc.length < 1e4;
                    )
                      o._uc.push({
                        v: 0,
                        color: "rgba(128,128,128,0.3)",
                        border: !1,
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      });
                    const _ = o._uc[h];
                    _ &&
                      ((_.hh = Math.max(_.hh || 0, parseFloat(i.high))),
                      (_.hl = Math.min(
                        _.hl === void 0 || _.hl === null ? 1 / 0 : _.hl,
                        parseFloat(i.low),
                      )),
                      (_.hc = y));
                  }
                  if (o._bc && o._bc.length > 0) {
                    const h = o.buffer.length - 1;
                    for (
                      ;
                      o._bc.length < o.buffer.length && o._bc.length < 1e4;
                    )
                      o._bc.push({
                        color: "rgba(128,128,128,0.3)",
                        border: "",
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      });
                    const _ = o._bc[h];
                    _ &&
                      ((_.hh = Math.max(_.hh || 0, parseFloat(i.high))),
                      (_.hl = Math.min(
                        _.hl === void 0 || _.hl === null ? 1 / 0 : _.hl,
                        parseFloat(i.low),
                      )),
                      (_.hc = y));
                  }
                }
                window._rt.timeframe = f || A;
              }
              const d = He[re] || re,
                p = i.symbol === re || i.symbol === d,
                c = !f || !ke || f === ke,
                u = window._chart2DataContext || {},
                g = u.symbol === re && u.timeframe === ke;
              if (pe && E && p && c && g) {
                if (i.isFinal || i.is_final)
                  (E?.appendBar(
                    Math.floor(i.open_time / 1e3),
                    parseFloat(i.open),
                    parseFloat(i.high),
                    parseFloat(i.low),
                    y,
                    parseFloat(i.volume),
                  ),
                    E._uc &&
                      E._uc.length > 0 &&
                      E?._uc.push({
                        index: E?._uc.length,
                        v: 0,
                        color: "rgba(128,128,128,0.3)",
                        border: !1,
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      }),
                    loadChart2());
                else {
                  const x = Math.floor((i.open_time || 0) / 1e3);
                  if (
                    (E?.updateOrAppend
                      ? E.updateOrAppend(
                          x,
                          parseFloat(i.open),
                          parseFloat(i.high),
                          parseFloat(i.low),
                          y,
                          parseFloat(i.volume),
                        )
                      : E?.updateBar(
                          parseFloat(i.open),
                          parseFloat(i.high),
                          parseFloat(i.low),
                          y,
                          parseFloat(i.volume),
                        ),
                    E?._uc && E._uc.length > 0)
                  ) {
                    for (; E._uc.length < E.buffer.length; )
                      E._uc.push({
                        v: 0,
                        color: "rgba(128,128,128,0.3)",
                        border: !1,
                        ho: parseFloat(i.open),
                        hh: parseFloat(i.high),
                        hl: parseFloat(i.low),
                        hc: y,
                      });
                    const k = E._uc.length - 1,
                      $ = E._uc[k];
                    $ &&
                      E.buffer.length - 1 === k &&
                      (($.hh = Math.max($.hh || 0, parseFloat(i.high))),
                      ($.hl = Math.min($.hl || 1 / 0, parseFloat(i.low))),
                      ($.hc = y));
                  }
                }
                const w = ((y - parseFloat(i.open)) / parseFloat(i.open)) * 100,
                  h = w > 0 ? "up" : w < 0 ? "down" : "flat";
                ((function () {
                  const x = document.getElementById("chart2Price");
                  x && (x.textContent = Ye(y));
                })(),
                  (function () {
                    const x = document.getElementById("chart2Price");
                    x && (x.className = "price-big " + h);
                  })());
                const _ = document.getElementById("chart2Change");
                _ &&
                  ((_.textContent = (w > 0 ? "+" : "") + w.toFixed(2) + "%"),
                  (_.className = "change-badge " + h));
              }
            }
          } catch {}
        }),
        (N.onclose = (a) => {
          ((window._wsConnecting = !1),
            n &&
              ((n.style.background = "#3B82F6"),
              (n.title =
                "\uC5F0\uACB0 \uB04A\uAE40 \u2014 \uC7AC\uC5F0\uACB0 \uC911...")),
            a && a.code === 1013 && (Ie = Math.max(Ie, 5e3)));
          const r = Math.random() * Math.max(1e3, Ie * 0.5);
          (setTimeout(It, Ie + r), (Ie = Math.min(Ie * 2, 3e4)));
        }),
        (N.onerror = () => {}));
    } catch {
      window._wsConnecting = !1;
      const n = Math.random() * Math.max(1e3, Ie * 0.5);
      (setTimeout(It, Ie + n), (Ie = Math.min(Ie * 2, 3e4)));
    }
  }
}
setInterval(() => {
  if (!document.hidden)
    try {
      const e = document.getElementById("wsDot");
      if (!e || !N || N.readyState !== 1) return;
      const n = window._lastWsMsgAt || 0;
      if (!n) {
        ((e.style.background = "#D8B66A"),
          (e.title =
            "\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428 (\uC544\uC9C1 \uC218\uC2E0 \uC5C6\uC74C)"));
        return;
      }
      const a = Math.round((Date.now() - n) / 1e3);
      a < 30
        ? ((e.style.background = "#C4384B"),
          (e.title = `\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428 (${a}s \uC804 \uC218\uC2E0)`))
        : a < 90
          ? ((e.style.background = "#D8B66A"),
            (e.title = `\uC2E4\uC2DC\uAC04 (\uB9C8\uC9C0\uB9C9 ${a}s \uC804) \u2014 \uB2E4\uC18C \uC9C0\uC5F0`))
          : ((e.style.background = "#3B82F6"),
            (e.title = `\uC2E4\uC2DC\uAC04 \uB04A\uAE40 (${a}s \uC804 \uB9C8\uC9C0\uB9C9 \uC218\uC2E0) \u2014 \uC11C\uBC84 /v1/debug/ingest \uD655\uC778 \uAD8C\uC7A5`));

      // 네트워크는 살아 있지만 메시지가 멈춘 경우 자동 복구
      if (a >= 20 && Date.now() - (window._lastWsPingAt || 0) > 15000) {
        _wsSendSafe({ action: "ping" });
        window._lastWsPingAt = Date.now();
      }

      if (a >= 90 && Date.now() - (window._lastWsResubAt || 0) > 30000) {
        const channels = [];
        window._lastWsSub && channels.push(window._lastWsSub);
        window._lastWsTickerSub && channels.push(window._lastWsTickerSub);
        window._lastWsSubChart2 && channels.push(window._lastWsSubChart2);
        if (window._lastWsAllTickers?.length) {
          channels.push(...window._lastWsAllTickers.slice(0, 50));
        }
        channels.length && _wsSendSafe({ action: "subscribe", channels });
        window._lastWsResubAt = Date.now();
      }

      if (a >= 150 && !window._wsConnecting) {
        try {
          N.close(4000, "stale_connection");
        } catch {}
      }
    } catch {}
}, 5e3);
function Eo() {
  !o ||
    !o.overlayCanvas ||
    (window._mdSetup ||
      ((window._mdSetup = !0),
      document
        .querySelector(".chart-wrap")
        ?.addEventListener("mousedown", (e) => {
          window._mdPos = { x: e.clientX, y: e.clientY };
        })),
    o.onClick(async ({ price: e, barIdx: n }) => {
      if (
        window._mdPos &&
        (Math.abs(event?.clientX - window._mdPos.x) > 5 ||
          Math.abs(event?.clientY - window._mdPos.y) > 5)
      ) {
        window._mdPos = null;
        return;
      }
      if (((window._mdPos = null), window._trainMode && window.chart)) {
        if (!window._trainDragStart)
          n >= 0 &&
            n < o.buffer.length &&
            ((window._trainDragStart = { idx: n, price: o.buffer.close[n] }),
            o.addDrawing({
              type: "buy_scan",
              index: n,
              price: o.buffer.close[n],
              scanType: "buy",
              color: "#C4384B",
              size: 10,
            }),
            (o._dirty = !0),
            X(
              t(
                "\uC9C4\uC785 \uC120\uD0DD \uC644\uB8CC \u2014 \uCCAD\uC0B0 \uC9C0\uC810 \uD074\uB9AD",
              ),
              "#C4384B",
            ));
        else if (n >= 0 && n < o.buffer.length) {
          const a = window._trainDragStart.idx,
            r = window._trainDragStart.price,
            i = o.buffer.close[n],
            y = i > r ? "long" : "short",
            f = y === "long" ? ((i - r) / r) * 100 : ((r - i) / r) * 100;
          (o.addDrawing({
            type: "buy_scan",
            index: n,
            price: i,
            scanType: "sell",
            color: "#3B82F6",
            size: 10,
          }),
            (o._dirty = !0),
            q(
              `${F}/v1/charts/train-range?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&startIdx=${a}&endIdx=${n}`,
            )
              .then((m) => m.json())
              .then((m) => {
                (_trainPoints.push({
                  entry: a,
                  exit: n,
                  dir: y,
                  entryPrice: r,
                  exitPrice: i,
                  pnl: f,
                  indicators: m.success ? m.data : {},
                }),
                  X(
                    y.toUpperCase() +
                      " #" +
                      _trainPoints.length +
                      " " +
                      f.toFixed(2) +
                      "%",
                    y === "long" ? "#C4384B" : "#3B82F6",
                  ));
              })
              .catch(() => {
                _trainPoints.push({
                  entry: a,
                  exit: n,
                  dir: y,
                  entryPrice: r,
                  exitPrice: i,
                  pnl: f,
                  indicators: {},
                });
              }),
            (window._trainDragStart = null));
        }
        return;
      }
      if (window._lastClickAlt) {
        window._lastClickAlt = !1;
        try {
          const r = await (
            await q(
              `${F}/v1/charts/ind-h?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 2e3}&barIndex=${n}`,
            )
          ).json();
          if (!r.success || !r.data) return;
          const i = r.data,
            y = i.buy,
            f = i.sell,
            m = y.detail,
            b = (s) => (s ? "O" : "X");
          let v = document.getElementById("entryCheckPop");
          (v ||
            ((v = document.createElement("div")),
            (v.id = "entryCheckPop"),
            (v.style.cssText =
              "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,253,249,0.97);border:1px solid var(--border);border-radius:10px;padding:16px;z-index:9999;min-width:280px;font-size:14px;color:var(--text);box-shadow:0 8px 24px rgba(106,30,51,0.1);max-height:80vh;overflow-y:auto"),
            document.body.appendChild(v)),
            (window._checkedBars = window._checkedBars || []),
            window._checkedBars.push({
              index: n,
              price: i.price,
              buy: y,
              sell: f,
              detail: m,
              symbol: B,
              tf: A,
              time: o.buffer.time[n],
            }),
            (v.innerHTML = `
        <div style="font-weight:700;color:#D8B66A;margin-bottom:8px">\uC9C4\uC785 \uC870\uAC74 \uCCB4\uD06C (\uBD09 #${n})</div>
        <div style="color:#8E7D72;margin-bottom:6px">\uAC00\uACA9: ${i.price.toFixed(2)}</div>
        <div style="font-weight:700;color:#C4384B;margin:8px 0 4px">\uB9E4\uC218 ${y.result ? "\uC9C4\uC785 \uAC00\uB2A5" : "\uBD88\uAC00"}</div>
        <div>${b(y.udrsi)} \uAC15\uB3C4\uCE21\uC815: ${m.a > 0 ? "0\u2191" : "0\u2193"} ${m.a.toFixed(4)} (prev ${m.a_prev.toFixed(4)}) ${m.a > m.a_prev ? "\u2191\uC0C1\uC2B9" : "\u2193\uD558\uB77D"}</div>
        <div>${b(y.udstoch)} \uACFC\uC5F4\uBD84\uC11D: ${m.c > 0 ? "0\u2191" : "0\u2193"} ${m.c.toFixed(4)} (prev ${m.c_prev.toFixed(4)}) ${m.c > m.c_prev ? "\u2191\uC0C1\uC2B9" : "\u2193\uD558\uB77D"}</div>
        <div>${b(y.stc)} STC: \uC587${m.stc_thin.toFixed(4)} \uAD75${m.stc_thick.toFixed(4)} (prev ${m.stc_thick_prev.toFixed(4)})</div>
        <div>${b(y.rsimfi)} RSI/MFI: R${m.rsi.toFixed(4)} M${m.mfi.toFixed(4)} (prev R${m.rsi_prev.toFixed(4)} M${m.mfi_prev.toFixed(4)})</div>
        <div>${y.false_filter ? "\uAC70\uC9D3\uD544\uD130: RSI\u2191 MFI\u2193" : ""}</div>
        <div style="font-weight:700;color:#3B82F6;margin:8px 0 4px">\uB9E4\uB3C4 ${f.result ? "\uC9C4\uC785 \uAC00\uB2A5" : "\uBD88\uAC00"}</div>
        <div>${b(f.udrsi)} \uAC15\uB3C4\uCE21\uC815 ${b(f.udstoch)} \uACFC\uC5F4\uBD84\uC11D ${b(f.stc)} \uCD94\uC138\uC804\uD658 ${b(f.rsimfi)} \uB9E4\uB9E4\uC555\uB825</div>
        <div>${f.false_filter ? "\uAC70\uC9D3\uD544\uD130: RSI\u2193 MFI\u2191" : ""}</div>
        <div style="margin-top:4px;color:#8E7D72;font-size:14px">\uC800\uC7A5\uB428: ${window._checkedBars.length}\uAC1C</div>
        <div style="display:flex;gap:4px;margin-top:6px">
        <button onclick="this.parentElement.parentElement.style.display='none'" style="flex:1;padding:4px;border:1px solid var(--border);background:none;color:var(--text);border-radius:4px;cursor:pointer;font-size:14px">\uB2EB\uAE30</button>
        <button onclick="window._analyzeChecked&&window._analyzeChecked()" style="flex:1;padding:4px;border:1px solid #D8B66A;background:none;color:#D8B66A;border-radius:4px;cursor:pointer;font-size:14px">\uBD84\uC11D \uC694\uCCAD</button>
        <button onclick="window._checkedBars=[];showToast('\uCD08\uAE30\uD654\uB428')" style="flex:1;padding:4px;border:1px solid #3B82F6;background:none;color:#3B82F6;border-radius:4px;cursor:pointer;font-size:14px">\uCD08\uAE30\uD654</button>
        </div>`),
            (v.style.display = "block"));
        } catch {}
      }
    }));
}
((function () {
  // [FIX] 키를 로드 시점에 고정하지 않고 호출 시점의 현재 userName으로 계산한다.
  // 기존엔 IIFE 실행(=페이지 로드 직후, 인증 await 완료 전) 시점의 userName으로
  // 키가 고정되어, 저장은 _guest 키에/로드는 _실제유저 키에서 일어나 어긋났다.
  var _curUser = function () {
    return localStorage.getItem("userName") || "guest";
  };
  var _kSettings = function () {
    return "chartOS_settings_" + _curUser();
  };
  var _kDrawings = function () {
    return "chartOS_drawings_" + _curUser();
  };
  var _kIndSettings = function () {
    return "chartOS_indSettings_" + _curUser();
  };
  var _kSubRatios = function () {
    return "chartOS_subRatios_" + _curUser();
  };

  window._loadUserSettings = function () {
    try {
      // ver 마이그레이션: ver != "3"이면 기존 키 호환 유지하고 ver만 올림 (절대 데이터 삭제 금지)
      var ver = localStorage.getItem("chartOS_settings_ver");
      if (ver !== "3") {
        // 구버전 ver=2 데이터는 그대로 살림. 파괴적 마이그레이션 안 함.
        localStorage.setItem("chartOS_settings_ver", "3");
      }

      // 1) 기본 세팅 (symbol/timeframe/indicator on-off)
      var m = JSON.parse(localStorage.getItem(_kSettings()) || "{}");
      if (m.symbol) {
        B = m.symbol;
        window.curSymbol = B;
      }
      if (m.timeframe) {
        A = m.timeframe;
        window.curTf = A;
      }
      if (m.indicators) {
        for (var b in m.indicators) {
          var v = m.indicators[b];
          var el =
            document.querySelector('[data-ind="' + b + '"]') ||
            document.querySelector('[data-sub="' + b + '"]');
          if (el) el.classList.toggle("on", !!v);
        }
      }

      // 2) 지표 설정값 (RSI period, MACD params 등) 복원 — calcIndicators 전에 적용되어야 함
      try {
        var ind = JSON.parse(localStorage.getItem(_kIndSettings()) || "null");
        if (ind && typeof ind === "object") {
          window._indSettings = ind;
        }
      } catch (_) {}

      // 3) 서브차트 비율 (메인:서브, 서브 간 비율) 복원
      try {
        var rr = JSON.parse(localStorage.getItem(_kSubRatios()) || "null");
        if (rr && typeof rr === "object") {
          window._restoreSubRatios = rr; // 차트 생성 후 적용용 (apply는 setSubChart 호출 이후)
        }
      } catch (_) {}

      // 4) [FIX] 지표 세부설정/커스텀 MA·SUB 재로드.
      // 이 값들은 모듈 로드 시점(인증 await 완료 전, guest)에 초기화되므로,
      // 로그인 유저 확정 후 다시 호출되면 실유저 키로 갱신해야 한다.
      try {
        var _u = _curUser();
        var _is = JSON.parse(
          localStorage.getItem("chartOS_indSettings_" + _u) || "null",
        );
        if (_is && typeof _is === "object") window._indSettings = _is;
        window._customMA = JSON.parse(
          localStorage.getItem("chartOS_customMA_" + _u) || "[]",
        );
        window._customSUB = JSON.parse(
          localStorage.getItem("chartOS_customSUB_" + _u) || "[]",
        );
      } catch (_) {}
    } catch (_) {}
  };

  window._saveUserSettings = function () {
    try {
      var inds = {};
      document.querySelectorAll(".ind-tag").forEach(function (el) {
        var k = el.dataset.ind || el.dataset.sub;
        if (k) inds[k] = el.classList.contains("on");
      });
      localStorage.setItem(
        _kSettings(),
        JSON.stringify({
          symbol: B,
          timeframe: A,
          indicators: inds,
        }),
      );
    } catch (_) {}
  };

  // 지표 설정값 저장 (compare.js에서 호출)
  window.saveIndSettings = function () {
    try {
      if (window._indSettings) {
        localStorage.setItem(
          _kIndSettings(),
          JSON.stringify(window._indSettings),
        );
      }
    } catch (_) {}
  };

  // 서브차트 비율 저장 (드래그 리사이즈 후 호출)
  window.saveSubRatios = function () {
    try {
      if (!window.chart) return;
      var data = {
        mainRatio: window.chart._mainRatio || null,
        subRatios: window.chart._subRatios || null,
      };
      localStorage.setItem(_kSubRatios(), JSON.stringify(data));
    } catch (_) {}
  };

  // 저장된 비율을 차트에 적용 (서브차트 추가 후 호출)
  window.applyRestoredSubRatios = function () {
    try {
      var rr = window._restoreSubRatios;
      if (!rr || !window.chart) return;
      if (rr.mainRatio && window.chart._mainRatio !== undefined) {
        window.chart._mainRatio = rr.mainRatio;
      }
      if (rr.subRatios && typeof rr.subRatios === "object") {
        var current = window.chart._subRatios || {};
        // 현재 활성 서브차트에 해당하는 키만 적용
        for (var k in rr.subRatios) {
          if (current.hasOwnProperty(k)) {
            current[k] = rr.subRatios[k];
          }
        }
        window.chart._subRatios = current;
      }
      if (window.chart._recalcLayout) window.chart._recalcLayout();
      window.chart._dirty = true;
    } catch (_) {}
  };

  window._saveDrawings = function () {
    try {
      if (!window.chart || !window.chart.overlay) return;
      var f = window.chart.overlay.drawings.filter(function (b) {
        return (
          b.type === "hline" ||
          b.type === "trendline" ||
          b.type === "fib" ||
          b.type === "text"
        );
      });
      var key = _kDrawings() + "_" + B;
      localStorage.setItem(key, JSON.stringify(f));
    } catch (_) {}
  };

  window._loadDrawings = function () {
    try {
      var key = _kDrawings() + "_" + B;
      var arr = JSON.parse(localStorage.getItem(key) || "[]");
      for (var i = 0; i < arr.length; i++) window.chart.addDrawing(arr[i]);
    } catch (_) {}
  };

  // 초기 로드
  _loadUserSettings();

  // 타임프레임 active 표시
  document.querySelectorAll("[data-tf]").forEach(function (f) {
    f.classList.toggle("active", f.dataset.tf === A);
  });

  // 지표 변수 동기화 (기존)
  window._syncIndicatorVars = function () {
    if (typeof ne !== "undefined") ne = !!C("ob");
    if (typeof se !== "undefined") se = !!C("autotrend");
    if (typeof Q !== "undefined") Q = !!C("ultra");
    if (typeof le !== "undefined") le = !!C("ttr");
    if (typeof ie !== "undefined") ie = !!C("buyscan");
    if (typeof me !== "undefined") me = !!C("align");
    if (typeof be !== "undefined") be = !!C("entry");
    if (typeof Se !== "undefined") Se = !!C("entry2");
    if (typeof ye !== "undefined") ye = !!C("v12sig");
    if (typeof oe !== "undefined") oe = !!C("bimaco2");
    if (typeof de !== "undefined") de = !!C("_u");
    if (typeof ce !== "undefined") ce = !!C("udstoch");
    if (typeof ue !== "undefined") ue = !!C("rsimfi");
    if (typeof fe !== "undefined") fe = !!C("stc");
    if (typeof ge !== "undefined") ge = !!C("pasrpvi");
  };

  window.shareBT = function () {
    var url = location.origin + "/?sym=" + B + "&tf=" + A + "&bt=1";
    navigator.clipboard
      .writeText(url)
      .then(function () {
        X(t("\uB9C1\uD06C \uBCF5\uC0AC\uB428!"), "#D8B66A");
      })
      .catch(function () {});
  };

  // embed 모드 (생략 없이 그대로)
  if (new URLSearchParams(location.search).get("embed") === "1") {
    document.querySelector(".left").style.display = "none";
    document.querySelector(".right").style.display = "none";
    var sp = document.getElementById("splashScreen");
    if (sp) sp.remove();
    var tb = document.querySelector(".toolbar");
    if (tb) {
      var sel = document.createElement("select");
      sel.style.cssText =
        "background:#FFFDF9;color:#032129;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:14px;margin-left:4px;cursor:pointer";
      ze.forEach(function (v) {
        var op = document.createElement("option");
        op.value = v.code;
        op.textContent = v.code.replace("USDT", "");
        if (v.code === B) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = function () {
        B = this.value;
        De();
      };
      tb.insertBefore(sel, tb.children[1]);
    }
  }

  // 저장 트리거
  if (window.loadCandles) {
    window.addEventListener("beforeunload", function () {
      try {
        _saveUserSettings();
      } catch (_) {}
      try {
        saveIndSettings();
      } catch (_) {}
      try {
        saveSubRatios();
      } catch (_) {}
      try {
        _saveDrawings();
      } catch (_) {}
    });
    window.addEventListener("pagehide", function () {
      try {
        if (N && N.readyState !== WebSocket.CLOSED) N.close(1000, "page leave");
      } catch (_) {}
    });
    // visibilitychange로도 저장 (탭 전환 시)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        try {
          _saveUserSettings();
          saveIndSettings();
          saveSubRatios();
          _saveDrawings();
        } catch (_) {}
      }
    });
  }

  // 지표 토글 시 자동 저장
  var mo = new MutationObserver(function () {
    _saveUserSettings();
  });
  document.querySelectorAll(".ind-tag").forEach(function (f) {
    mo.observe(f, { attributes: true, attributeFilter: ["class"] });
  });
})(),
  (window.chart = null),
  (window.loadCandles = De),
  (window.calcIndicators = Y),
  (window._refreshOverlays = U),
  (window.loadUprsiStcOpt = bt));
const $o = ["vol"],
  To = [],
  Do = "3";
function Mo() {
  (document
    .querySelectorAll(".ind-tag.on,.sub-ind.on")
    .forEach((e) => e.classList.remove("on")),
    $o.forEach((e) => {
      const n = document.querySelector(`[data-ind="${e}"]`);
      n && n.classList.add("on");
    }),
    To.forEach((e) => {
      const n = document.querySelector(
        `[data-sub="${e}"],.sub-ind[data-sub="${e}"]`,
      );
      n && n.classList.add("on");
    }),
    localStorage.setItem("chartOS_presetVer", Do),
    Y(),
    U());
}
(async function () {
  const n = performance.now();
  window.__bootTimings = {};
  const a = (m) => {
    const b = Math.round(performance.now() - n);
    window.__bootTimings[m] = b;
  };
  ((window.onerror = function (m, b, v, s, l) {
    window.api
      .post(F + "/v1/analysis/track-click", {
        type: "js_error",
        detail: m + " at " + b + ":" + v,
      })
      .catch(() => {});
  }),
    window.addEventListener("unhandledrejection", (m) => {
      window.api
        .post(F + "/v1/analysis/track-click", {
          type: "js_error",
          detail: "Promise: " + (m.reason?.message || m.reason || "unknown"),
        })
        .catch(() => {});
    }),
    a("auth+symbols start"),
    await Promise.all([
      Dt().catch(() => {}),
      ro()
        .then(() => {
          (Qe(), Fo());
        })
        .catch((m) => {
          window.showToast &&
            X(
              "\uC885\uBAA9 \uB85C\uB4DC \uC2E4\uD328. \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.",
              "#3B82F6",
            );
        }),
    ]),
    a("auth+symbols done"));
  const r = new URLSearchParams(location.search);
  let i = r.get("sym") || null,
    y = r.get("tf") || null;
  if ((!i || !y) && G())
    try {
      a("settings start");
      const b = await (
        await fetch("/v1/site/chart-settings", {
          headers: Me(),
          credentials: "include",
        })
      ).json();
      (b.data &&
        (!i && b.data.symbol && (i = b.data.symbol),
        !y && b.data.timeframe && (y = b.data.timeframe),
        (window._pendingChartSettings = b.data)),
        a("settings done"));
    } catch {
      a("settings fail");
    }
  (i && ((B = i), (window.curSymbol = B)),
    (A = y || co),
    (window.curTf = A),
    Mt(A),
    a("chart init start"),
    uo(),
    Eo(),
    bo(),
    a("chart init done"),
    a("candles start"),
    await De(),
    a("candles done"));
  try {
    const m = B.includes("KRW")
        ? B.replace("KRW-", "") + "/KRW"
        : B.replace("USDT", "") + "/USDT",
      b = document.getElementById("symName");
    (b && (b.textContent = m),
      window._updateSymName && window._updateSymName(B),
      window._updateSymIcon && window._updateSymIcon(B));
    const v = document.getElementById("mtfSymbol");
    v && (v.textContent = m);
    const s = document.getElementById("mtfSymbolSub");
    (s && (s.textContent = B), typeof Qe == "function" && Qe());
  } catch {}
  if (window._pendingChartSettings) {
    const m = window._pendingChartSettings;
    (delete window._pendingChartSettings, Zt(m));
  } else Mo();
  (setTimeout(() => {
    const m = Date.now();
    if (!Z()) {
      const b = parseInt(localStorage.getItem("chartOS_proTipHide") || "0");
      if (m > b) {
        const v = document.getElementById("proTip");
        v && (v.style.display = "");
      }
    }
    if (!G()) {
      const b = parseInt(localStorage.getItem("chartOS_publicTipHide") || "0");
      if (m > b) {
        const v = document.getElementById("publicTip");
        v && (v.style.display = "");
      }
    }
  }, 2e3),
    document.querySelectorAll(".c2tf").forEach(
      (m) =>
        (m.onclick = function () {
          (document
            .querySelectorAll(".c2tf")
            .forEach((b) => b.classList.remove("active")),
            this.classList.add("active"),
            (ke = this.dataset.c2tf),
            loadChart2());
        }),
    ),
    a("bootstrap complete"));
  const f = document.createElement("script");
  if (
    ((f.src = "/static/js/drawing.js?v=" + Date.now()),
    document.body.appendChild(f),
    document.addEventListener("click", (m) => {
      const b = document.getElementById("langPanel");
      b &&
        b.style.display === "block" &&
        !b.contains(m.target) &&
        !m.target.closest('[data-action="toggleLang"]') &&
        (b.style.display = "none");
    }),
    o.onLoadMore(async () => {
      if (!o.buffer.length) return;
      const m = o.buffer.time[0],
        b = Math.floor(m * 1e3) - 1;
      try {
        const s = await (
          await q(
            `${F}/v1/charts/candles?symbolId=${B}&timeframe=${A}&limit=500&endTime=${b}`,
          )
        ).json();
        if (!s.success || !s.data?.candles?.length) return;
        const l = s.data.candles
          .map((d) => ({
            time:
              parseInt(d.openTime) > 1e12
                ? Math.floor(parseInt(d.openTime) / 1e3)
                : Math.floor(new Date(d.openTime).getTime() / 1e3),
            open: parseFloat(d.open),
            high: parseFloat(d.high),
            low: parseFloat(d.low),
            close: parseFloat(d.close),
            volume: parseFloat(d.volume || 0),
          }))
          .filter((d) => d.time > 0 && !isNaN(d.open));
        l.length &&
          (o.prependBars(l),
          Y(),
          U(),
          window._loadDarak && window._loadDarak(),
          window.calcStrategySignals && window.calcStrategySignals(),
          window._autobotActive &&
            typeof window._autobotRun == "function" &&
            (clearTimeout(window._autobotRerunTimer),
            (window._autobotRerunTimer = setTimeout(
              () => window._autobotRun(!0),
              400,
            ))));
      } catch {}
    }),
    setTimeout(() => {
      G() && Z() && requestAI();
    }, 2e3),
    G() && dt(),
    G() && It(),
    setInterval(() => {
      if (!G()) {
        return;
      }
      if (
        (window.loadBeomSignals &&
          window.isPremium &&
          window.isPremium() &&
          window.loadBeomSignals(),
        document.hidden)
      )
        return;
      (so(),
        dt(),
        o &&
          (window.loadMTF
            ? loadMTF()
            : setTimeout(() => window.loadMTF?.(), 1e3)),
        document.querySelector(".right-tab.active")?.dataset.p === "heatmap" &&
          loadHeatmap(),
        he && ct(),
        Be && Ue(),
        _e && je(),
        Pe && ut(),
        ve && ft(ve));
    }, 3e4),
    G())
  )
    try {
      const b = await (
        await q(`${F}/v1/portfolio/summary`, { headers: { ...Me() } })
      ).json();
      if (b.success && b.data?.total_trades > 0) {
        const v = document.getElementById("portfolioWidget");
        if (v) {
          v.style.display = "";
          const s = b.data.total_pnl;
          v.innerHTML = `${b.data.total_trades}\uAC70\uB798 <span style="color:${s >= 0 ? "#C4384B" : "#3B82F6"}">${s >= 0 ? "+" : ""}$${s.toFixed(0)}</span> (${b.data.win_rate}%)`;
        }
      }
    } catch {}
})();
async function dt() {
  try {
    const e = He[B] || B,
      n = await q(`/v1/charts/long-short?symbol=${e}`);
    if (!n.ok) return;
    const a = await n.json();
    if (a && a[0]) {
      const r = parseFloat(a[0].longShortRatio);
      if (!Number.isFinite(r)) return;
      const i = Math.round((r / (1 + r)) * 100),
        y = 100 - i,
        f = document.getElementById("lsLong"),
        m = document.getElementById("lsShort"),
        b = document.getElementById("lsBar");
      (f && (f.textContent = i + "%"),
        m && (m.textContent = y + "%"),
        b && (b.style.width = i + "%"));
    }
  } catch {}
}
window.applyPreset = function (e) {
  if (window.requireLogin && !window.requireLogin("프리셋")) return;
  if (
    (document
      .querySelectorAll(".ind-tag.on")
      .forEach((i) => i.classList.remove("on")),
    (window._customMA = []),
    (window._customSUB = []),
    Le(),
    Je(),
    Ne(),
    o)
  ) {
    for (const i of Object.keys(o.indicators)) o.removeIndicator(i);
    ((o.subCharts = {}),
      o._recalcLayout(),
      (o._uc = null),
      (o._bc = null),
      (o._dirty = !0));
  }
  ((ne = !1),
    (se = !1),
    (Q = !1),
    (le = !1),
    (ie = !1),
    (me = !1),
    (be = !1),
    (Se = !1),
    (ye = !1),
    (oe = !1),
    typeof de < "u" && (de = !1),
    typeof ce < "u" && (ce = !1),
    typeof ue < "u" && (ue = !1),
    typeof fe < "u" && (fe = !1),
    typeof ge < "u" && (ge = !1),
    typeof window.showBimacoTP < "u" && (window.showBimacoTP = !1),
    typeof We < "u" && (We = !1));
  const a = {
    scalp: {
      tf: "1m",
      ind: ["ema9", "ema20", "bb", "beom_free"],
      sub: ["rsi", "stoch"],
      pro: ["ultra", "obsig"],
    },
    swing: {
      tf: "1h",
      ind: ["ema50", "ema200", "supertrend", "beom_free"],
      sub: ["rsi", "adx", "macd"],
      pro: ["ultra", "ob", "autotrend"],
    },
    trend: {
      tf: "4h",
      ind: ["ema20", "ema50", "ema200", "emaribbon"],
      sub: ["adx", "macd"],
      pro: ["ultra", "align", "autotrend"],
    },
    clean: { tf: "5m", ind: [], sub: [], pro: [] },
    beom: {
      tf: "5m",
      ind: ["vol", "beom_free"],
      sub: ["rsi"],
      pro: ["ultra", "darak", "ob", "obsig"],
    },
    pro: {
      tf: "5m",
      ind: ["vol"],
      sub: ["rsi", "macd", "stoch"],
      pro: ["ultra", "bimaco2", "darak", "ob", "obsig", "ttr", "align"],
    },
  }[e];
  if (!a) return;
  const r = document.querySelector(`[data-tf="${a.tf}"]`);
  r && r.click();
  for (const i of [...a.ind, ...a.sub, ...a.pro]) {
    const y =
      document.querySelector(`[data-ind="${i}"]`) ||
      document.querySelector(`[data-sub="${i}"]`);
    y && !y.classList.contains("on") && y.click();
  }
  X(
    ({
      scalp: "스캘핑",
      swing: "스윙",
      trend: "추세",
      clean: "클린",
      beom: "범온 기본",
      pro: "프로",
    }[e] || e) + " 모드 적용",
    "#A31540",
  );
};
window._userPresetKey = function () {
  return (
    "chartOS_userPresets_" +
    (window.userName || localStorage.getItem("userName") || "guest")
  );
};
window._getUserPresets = function () {
  try {
    return JSON.parse(localStorage.getItem(window._userPresetKey()) || "[]");
  } catch {
    return [];
  }
};
window._saveUserPreset = function () {
  if (window.requireLogin && !window.requireLogin("프리셋")) return;
  const nm = (prompt("프리셋 이름:") || "").trim();
  if (!nm) return;
  const inds = [...document.querySelectorAll(".ind-tag.on[data-ind]")].map(
      (x) => x.dataset.ind,
    ),
    subs = [
      ...document.querySelectorAll(
        ".ind-tag.on[data-sub],.sub-ind.on[data-sub]",
      ),
    ].map((x) => x.dataset.sub),
    mas = [...document.querySelectorAll("[data-ma-type].on")].map(
      (x) => x.dataset.maType,
    ),
    p = window._getUserPresets().filter((x) => x.name !== nm);
  p.push({ name: nm, tf: window.curTf || A, inds, subs, mas });
  localStorage.setItem(window._userPresetKey(), JSON.stringify(p));
  window._renderUserPresets();
  X("프리셋 '" + nm + "' 저장됨", "#A31540");
};
window._applyUserPreset = function (nm) {
  const p = window._getUserPresets().find((x) => x.name === nm);
  if (!p) return;
  window.applyPreset("clean");
  setTimeout(() => {
    const r = document.querySelector(`[data-tf="${p.tf}"]`);
    r && r.click();
    for (const id of [...(p.inds || []), ...(p.subs || []), ...(p.mas || [])]) {
      const y =
        document.querySelector(`[data-ind="${id}"]`) ||
        document.querySelector(
          `.sub-ind[data-sub="${id}"],.ind-tag[data-sub="${id}"]`,
        ) ||
        document.querySelector(`[data-ma-type="${id}"]`);
      y && !y.classList.contains("on") && y.click();
    }
    X("프리셋 '" + nm + "' 적용", "#A31540");
  }, 60);
};
window._deleteUserPreset = function (nm) {
  const p = window._getUserPresets().filter((x) => x.name !== nm);
  localStorage.setItem(window._userPresetKey(), JSON.stringify(p));
  window._renderUserPresets();
};
window._renderUserPresets = function () {
  const el = document.getElementById("userPresetList");
  if (!el) return;
  const p = window._getUserPresets();
  el.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px";
  el.innerHTML = p.length
    ? p
        .map((x) => {
          const nm = (x.name + "").replace(/'/g, "");
          return `<div class="ind-tag" onclick="window._applyUserPreset('${nm}')" title="${lo(x.name)} (${x.tf}) — 클릭하여 적용" style="display:inline-flex;align-items:center;gap:6px"><span>${lo(x.name)} <span style="color:#8E7D72;font-size:11px">${x.tf}</span></span><span onclick="event.stopPropagation();window._deleteUserPreset('${nm}')" title="삭제" style="color:#3B82F6;cursor:pointer;font-weight:700;line-height:1">✕</span></div>`;
        })
        .join("")
    : '<div style="color:#8E7D72;padding:4px 0;width:100%">저장된 프리셋이 없습니다.</div>';
};
setTimeout(() => window._renderUserPresets && window._renderUserPresets(), 0);
function Fo() {
  if (!ze.length) return;
  const e = ze.filter(
    (y) =>
      (y.exchangeCode || "").toUpperCase() !== "UPBIT" &&
      (y.asset || "crypto") === "crypto" &&
      (y.apiCode || y.code).toUpperCase().endsWith("USDT"),
  );
  if (!e.length) return;
  const n = e
      .map((y) => (y.apiCode || y.code).toLowerCase() + "@ticker")
      .join("/"),
    a = {};
  ze.forEach((y) => {
    y.apiCode && (a[y.apiCode] = y.code);
  });
  let r;
  function i() {
    ((r = new WebSocket("wss://fstream.binance.com/stream?streams=" + n)),
      (r.onmessage = (y) => {
        try {
          const m = JSON.parse(y.data).data;
          if (!m) return;
          const b = a[m.s] || m.s,
            v = document.getElementById("wp_" + b);
          if (!v) return;
          const s = parseFloat(m.c),
            l = parseFloat(m.P),
            d = l >= 0 ? "#C4384B" : "#3B82F6",
            p = l >= 0 ? "+" : "",
            c = String(s).replace(/0+$/, "").replace(/\.$/, "");
          ((v.innerHTML = `<div style="font-weight:600">${c}</div><div style="color:${d};font-size:14px">${p}${l.toFixed(2)}%</div>`),
            b === B &&
              ((window._rt.lastPrice = s),
              (window._rt.pct24h = l),
              (window._rt.symbol = B),
              (window._rt.source = "binance_ticker"),
              Ge()));
        } catch {}
      }),
      (r.onclose = () => setTimeout(i, 3e3)));
  }
  i();
}
((window.chart = o),
  (window.chart2 = E),
  (window.ws = N),
  (window.curSymbol = B),
  (window.curTf = A),
  (window.showToast = X),
  (window.symbols = ze),
  (window.fmtPrice = Ye),
  (window.loadCandles = De),
  (window.calcIndicators = Y),
  window.calcStrategySignals && window.calcStrategySignals(),
  (window.setTimeframe = Ft),
  (window.isIndOn = C),
  (window.isSubOn = J));
var he = !1;
window._toggleLadder = function () {
  if (!requireLogin("\uB798\uB354\uC2DC\uADF8\uB110")) return;
  he = !he;
  const e = document.querySelector('[data-ind="ladder"]');
  e && e.classList.toggle("on", he);
  const n = document.getElementById("ladderBadge");
  (n && (n.style.display = he ? "block" : "none"),
    he && ct(),
    Be && Ue(),
    _e && je(),
    Pe ? ut() : o && o.clearDrawings("ladder_signal"));
};
async function ct(e) {
  if (he)
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ladder-signal?symbolId=${B}&timeframe=${A}&limit=${o && o.buffer ? o.buffer.length : 2e3}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data) return;
      const r = a.data,
        i = document.getElementById("ladderBadge");
      if (i) {
        const y = {
            TREND_BULL: "#C4384B",
            TREND_BEAR: "#3B82F6",
            RANGE: "#D8B66A",
            SHOCK_UP: "#A31540",
            SHOCK_DOWN: "#ec4899",
            BLOCKED: "#6b7280",
          },
          f = {
            TREND_BULL: "\uC0C1\uC2B9\uCD94\uC138",
            TREND_BEAR: "\uD558\uB77D\uCD94\uC138",
            RANGE: "\uD6A1\uBCF4",
            SHOCK_UP: "\uAE09\uB4F1\uCDA9\uACA9",
            SHOCK_DOWN: "\uAE09\uB77D\uCDA9\uACA9",
            BLOCKED: "\uCC28\uB2E8",
          },
          m = y[r.regime] || "#6b7280";
        let b = f[r.regime] || r.regime;
        if (r.action === "enter" || r.action === "shadow_enter") {
          const v = r.side === "long" ? "#C4384B" : "#3B82F6";
          b += ` <span style="color:${v}">${r.side === "long" ? "LONG" : "SHORT"}</span> ${r.grade} ${Math.round(r.total)}\uC810`;
        } else b += ` ${r.cluster_state || ""}`;
        ((i.style.display = "block"),
          (i.style.background = m + "20"),
          (i.style.color = m),
          (i.style.border = `1px solid ${m}40`),
          (i.innerHTML = b));
      }
      if (o && o.buffer && o.buffer.length > 0 && r.signals)
        for (const y of r.signals) {
          const f = y.index;
          if (f < 0 || f >= o.buffer.length) continue;
          const m = Math.abs(o.buffer.high[f] - o.buffer.low[f]) || 1,
            b = y.type,
            v = y.reason || "",
            s = y.side || "",
            l = s === "long";
          let d, p, c;
          if (b === "enter_long")
            ((d = o.buffer.low[f] - m * 0.45),
              (p = "L"),
              (c = "ladder_enter_long"));
          else if (b === "enter_short")
            ((d = o.buffer.high[f] + m * 0.45),
              (p = "S"),
              (c = "ladder_enter_short"));
          else if (b === "shadow_enter" && l)
            ((d = o.buffer.low[f] - m * 0.65),
              (p = "SL"),
              (c = "ladder_shadow_long"));
          else if (b === "shadow_enter" && !l)
            ((d = o.buffer.high[f] + m * 0.65),
              (p = "SS"),
              (c = "ladder_shadow_short"));
          else if (b === "partial" && v === "heat_tp1")
            ((d = l ? o.buffer.high[f] + m * 0.2 : o.buffer.low[f] - m * 0.2),
              (p = "TP1"),
              (c = "ladder_partial_heat"));
          else if (b === "partial" && v === "strength_fade")
            ((d = l ? o.buffer.high[f] + m * 0.2 : o.buffer.low[f] - m * 0.2),
              (p = "WF"),
              (c = "ladder_partial_strength"));
          else if (b === "close" && v === "struct_break")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "SB"),
              (c = "ladder_close_struct"));
          else if (b === "close" && v === "bimaco_reverse")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "BR"),
              (c = "ladder_close_bimaco"));
          else if (b === "close" && v === "vwap_fail")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "VW"),
              (c = "ladder_close_vwap"));
          else if (b === "close" && v === "imacd_cross")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "IMX"),
              (c = "ladder_close_imacd"));
          else if (b === "close" && v === "imacd_sl")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "IMS"),
              (c = "ladder_close_imacd"));
          else if (b === "close" && v === "trend_reverse")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "TR"),
              (c = "ladder_close_trend"));
          else if (b === "close" && (v === "force_reverse" || v === "force_sl"))
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = v === "force_reverse" ? "FR" : "FS"),
              (c = "ladder_close_force"));
          else if (b === "close" && v === "emergency_sl")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "ESL"),
              (c = "ladder_close_emergency"));
          else if (b === "close" && v === "momentum_fade")
            ((d = l ? o.buffer.high[f] + m * 0.3 : o.buffer.low[f] - m * 0.3),
              (p = "MF"),
              (c = "ladder_close_momentum"));
          else if (b === "hold")
            ((d = o.buffer.close[f]), (p = ""), (c = "ladder_hold"));
          else if (b === "gate")
            ((d = l ? o.buffer.low[f] - m * 0.3 : o.buffer.high[f] + m * 0.3),
              (p = ""),
              (c = "ladder_gate"));
          else continue;
          o.addDrawing({
            type: "ladder_signal",
            index: f,
            price: d,
            label: p,
            signalType: c,
            side: s,
            reason: v,
            score: y.score || 0,
            grade: y.grade || "",
          });
        }
    } catch {}
}
var Be = !1;
window._toggleAutobot = function () {
  if (!requireLogin("AI\uB9E4\uB9E4")) return;
  Be = !Be;
  const e = document.querySelector('[data-ind="autobot"]');
  (e && e.classList.toggle("on", Be),
    Be
      ? (Ue(),
        window.showToast &&
          window.showToast(
            "AI\uB9E4\uB9E4 \uC2DC\uADF8\uB110 ON (balanced)",
            "#921230",
          ))
      : o &&
        (o.clearDrawings("autobot_entry"),
        o.clearDrawings("autobot_sl"),
        o.clearDrawings("autobot_tp")));
};
async function Ue() {
  if (Be)
    try {
      const n = await (
        await q(
          `${F}/v1/charts/ind-autobot?symbolId=${B}&timeframe=${A}&limit=${o && o.buffer ? o.buffer.length : 2e3}&mode=balanced`,
        )
      ).json();
      if (!n.success || !n.data) return;
      const a = n.data.actions || [];
      o.overlay.drawings = o.overlay.drawings.filter(
        (r) =>
          r.type !== "autobot_entry" &&
          r.type !== "autobot_sl" &&
          r.type !== "autobot_tp",
      );
      for (const r of a)
        (r.action === "enter_long" || r.action === "enter_short") &&
          o.addDrawing({
            type: "autobot_entry",
            bar_idx: r.index,
            direction: r.dir,
            entry: r.entry,
            stop: r.stop,
            tp1: r.tp1,
            tp2: r.tp2,
            tp3: r.tp3,
            votes: r.votes,
            confidence: r.confidence,
          });
    } catch {}
}
window.loadAutobotSignal = Ue;
var _e = !1,
  Lo = -1,
  cn = null;
function Po(e) {
  const n = `${B}:${A}:${e.bar_idx}:${e.direction}`;
  if (window._lastObAlertKey === n) return;
  window._lastObAlertKey = n;
  const a = document.createElement("div");
  ((a.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:" +
    (e.direction === "long"
      ? "rgba(196,56,75,0.95)"
      : "rgba(59,130,246,0.95)") +
    ";color:#fff;padding:16px 28px;border-radius:12px;font-size:14px;font-weight:700;z-index:9999;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fadeIn 0.3s"),
    (a.innerHTML = `<div style="font-size:14px;opacity:0.8;margin-bottom:4px">\uBC94\uC628 \uCD94\uC138\uC2DC\uC791</div><div>${B.replace("USDT", "")} ${A}</div><div style="font-size:14px;margin-top:4px">${e.direction === "long" ? "\uB9E4\uC218" : "\uB9E4\uB3C4"}</div><button onclick="this.parentElement.remove()" style="position:absolute;top:6px;right:10px;background:none;border:none;color:rgba(255,255,255,0.7);font-size:14px;cursor:pointer">\u2715</button>`),
    document.body.appendChild(a));
  try {
    (window._alertAudio ||
      (window._alertAudio = new Audio("/static/tiger_roar.wav")),
      (window._alertAudio.currentTime = 0),
      window._alertAudio.play().catch(() => {}));
  } catch {}
  ("Notification" in window &&
    Notification.permission === "granted" &&
    new Notification("\uBC94\uC628 \uCD94\uC138\uC2DC\uC791", {
      body: `${B.replace("USDT", "")} ${A} ${e.direction === "long" ? "\uB9E4\uC218" : "\uB9E4\uB3C4"}`,
      icon: "/static/favicon.svg",
    }),
    Z() &&
      window.api
        .post(F + "/v1/alerts/beom-signal-trigger", {
          symbol: B,
          timeframe: A,
          signal_type: e.direction === "long" ? "buy" : "sell",
          price: e.price || 0,
        })
        .catch(() => {}));
}
window._toggleObsig = function () {
  if (!requireLogin("\uBC94\uC628 \uCD94\uC138\uC2DC\uC791")) return;
  _e = !_e;
  const e = document.querySelector('[data-ind="obsig"]');
  (e && e.classList.toggle("on", _e),
    _e
      ? ((Lo = -1),
        je(),
        window.showToast &&
          window.showToast(
            "\uBC94\uC628 \uCD94\uC138\uC2DC\uC791 \uC2DC\uADF8\uB110 ON (OB \uB2E8\uB3C5)",
            "#8B6914",
          ))
      : o && o.clearDrawings("obsig_entry"));
};
async function je() {
  if (_e)
    try {
      const n = await (
        await q(
          `${F}/v1/charts/orderblocks?symbolId=${B}&timeframe=${A}&limit=${o && o.buffer ? o.buffer.length : 2e3}`,
        )
      ).json();
      if (!n.success || !n.data) return;
      const a = n.data.entry_signals || [];
      o.overlay.drawings = o.overlay.drawings.filter(
        (r) => r.type !== "obsig_entry",
      );
      for (const r of a)
        o.addDrawing({
          type: "obsig_entry",
          bar_idx: r.bar_idx,
          direction: r.direction,
          entry: r.price,
          ob_top: r.ob_top,
          ob_bottom: r.ob_bottom,
        });
      if (a.length) {
        const r = a[a.length - 1],
          i = o && o.buffer ? o.buffer.length : 500;
        r.bar_idx >= i - 3 && Po(r);
      }
    } catch {}
}
window.loadObsigSignal = je;
var Pe = !1;
window._toggleBeomAuto = function () {
  if (!requireLogin("\uBC94\uC628 \uC790\uB3D9\uB9E4\uB9E4")) return;
  Pe = !Pe;
  const e = document.querySelector('[data-ind="beom_auto"]');
  (e && e.classList.toggle("on", Pe),
    Pe
      ? (_e || window._toggleObsig?.(),
        ne || window._toggleOB?.(),
        we || window._toggleDarak?.(),
        setTimeout(ut, 2e3))
      : ((o.overlay.drawings = o.overlay.drawings.filter(
          (n) => n.type !== "beom_auto_signal",
        )),
        (o._dirty = !0)),
    z());
};
async function ut() {
  if (!Pe || !o || !o.buffer || o.buffer.length < 50) return;
  o.overlay.drawings = o.overlay.drawings.filter(
    (a) => a.type !== "beom_auto_signal",
  );
  const e = o.indicators?.darak_ma_smooth || o.indicators?.darak_ma;
  let n = null;
  if (e && e.data && e.data.length) {
    n = new Array(o.buffer.length).fill(0);
    for (const a of e.data) a.index < n.length && (n[a.index] = a.value);
  }
  if (!n)
    try {
      const r = await (
        await q(
          `${F}/v1/charts/ind-darak?symbolId=${B}&timeframe=${A}&mode=smooth&limit=${o.buffer.length}`,
        )
      ).json();
      r.success && r.data?.ma && (n = r.data.ma);
    } catch {}
  !n || !n.length || qo(n);
}
function qo(e) {
  const n = o.buffer,
    a = n.length,
    r = o.overlay.drawings.filter((m) => m.type === "obsig_entry"),
    i = {};
  for (const m of r) i[m.bar_idx] = m;
  const y = o._uc || [];
  let f = null;
  for (let m = 0; m < a; m++) {
    const b = n.close[m],
      v = e[m];
    if (!(!v || !b || v === 0)) {
      if (f) {
        if (f.type === "long" && b < f.ob_bottom) {
          (o.addDrawing({
            type: "beom_auto_signal",
            bar_idx: m,
            direction: "close_long",
            price: b,
            label: "\uC190\uC808",
          }),
            (f = null));
          continue;
        }
        if (f.type === "short" && b > f.ob_top) {
          (o.addDrawing({
            type: "beom_auto_signal",
            bar_idx: m,
            direction: "close_short",
            price: b,
            label: "\uC190\uC808",
          }),
            (f = null));
          continue;
        }
        if (y[m]) {
          const s = y[m].v !== void 0 ? y[m].v : 0;
          (f.type === "long" && s > 0 && (f.redSeen = !0),
            f.type === "short" && s < 0 && (f.blueSeen = !0));
        }
        if (f.type === "long" && f.redSeen && b < v) {
          (o.addDrawing({
            type: "beom_auto_signal",
            bar_idx: m,
            direction: "close_long",
            price: b,
            label: "\uC775\uC808",
          }),
            (f = null));
          continue;
        }
        if (f.type === "short" && f.blueSeen && b > v) {
          (o.addDrawing({
            type: "beom_auto_signal",
            bar_idx: m,
            direction: "close_short",
            price: b,
            label: "\uC775\uC808",
          }),
            (f = null));
          continue;
        }
      }
      if (i[m] && !f) {
        const s = i[m].direction;
        ((f = {
          type: s,
          entry_idx: m,
          entry_price: b,
          ob_top: i[m].ob_top,
          ob_bottom: i[m].ob_bottom,
          redSeen: !1,
          blueSeen: !1,
        }),
          o.addDrawing({
            type: "beom_auto_signal",
            bar_idx: m,
            direction: s,
            price: b,
            label:
              s === "long"
                ? "\uB9E4\uC218\uC9C4\uC785"
                : "\uB9E4\uB3C4\uC9C4\uC785",
          }));
      }
    }
  }
  o._dirty = !0;
}
((window.loadBeomAutoSignals = ut),
  (function () {
    const e = window._indToggleFns || (window._indToggleFns = {});
    e.ladder = window._toggleLadder;
  })());
var ve = "",
  Oo = { safe: "Q\uC548\uC804", std: "Q\uD45C\uC900", aggr: "Q\uC801\uADF9" },
  Ro = { safe: "#FFD600", std: "#00E676", aggr: "#FF6D00" };
function Bt(e) {
  if (requireLogin("Q-Signal")) {
    (ve === e ? (ve = "") : (ve = e),
      ["safe", "std", "aggr"].forEach(function (a) {
        var r = document.querySelector('[data-ind="qsig_' + a + '"]');
        r && r.classList.toggle("on", ve === a);
      }));
    var n = document.getElementById("qsignalBadge");
    ve
      ? (o && o.clearDrawings("q_signal"), ft(ve))
      : (o && o.clearDrawings("q_signal"), n && (n.style.display = "none"));
  }
}
((window._toggleQSigSafe = function () {
  Bt("safe");
}),
  (window._toggleQSigStd = function () {
    Bt("std");
  }),
  (window._toggleQSigAggr = function () {
    Bt("aggr");
  }));
var Ae = !1;
window._toggleBeomFree = function () {
  ((Ae = !Ae),
    document.querySelector("[data-ind=beom_free]")?.classList.toggle("on", Ae),
    Ae ? At() : o && ((o._uf = null), (o._dirty = !0)));
};
async function At(e) {
  if (!(!Ae || !o))
    try {
      const a = await (
        await q(
          `${F}/v1/charts/ind-b-free?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 500}`,
        )
      ).json();
      if (!j(e) || !a.success || !a.data?.d) return;
      ((o._uf = a.data.d), (o._dirty = !0));
    } catch {}
}
var we = !1,
  Wo = "balanced";
((window._toggleDarak = function () {
  requireLogin("\uBC94\uC628 \uC774\uB3D9\uD3C9\uADE0\uC120") &&
    ((we = !we),
    document.querySelector("[data-ind=darak]")?.classList.toggle("on", we),
    we
      ? Ke()
      : o &&
        (o.removeIndicator("darak_ma"),
        o.removeIndicator("darak_ma_fast"),
        o.removeIndicator("darak_ma_smooth")),
    U());
}),
  (window._setDarakMode = function (e) {
    ((window._indSettings.darak = window._indSettings.darak || {}),
      (window._indSettings.darak.mode = e),
      (Wo = e),
      oo(),
      we && Ke());
  }),
  (window._loadDarak = Ke));
async function Ke() {
  if (!(!we || !o)) {
    (o.removeIndicator("darak_ma"),
      o.removeIndicator("darak_ma_fast"),
      o.removeIndicator("darak_ma_smooth"));
    try {
      const n = String(S("darak", "mode", "balanced"))
          .split(",")
          .map((i) => i.trim())
          .filter(Boolean),
        a = { balanced: "#00D084", fast: "#FF6B6B", smooth: "#4A90D9" },
        r = S("darak", "width", 2.5);
      for (const i of n) {
        const y = S("darak", "period", 20),
          m = await (
            await q(
              `${F}/v1/charts/ind-darak?symbolId=${B}&timeframe=${A}&limit=${o.buffer.length || 500}&mode=${i}&period=${y}`,
            )
          ).json();
        if (!m.success || !m.data?.ma || m.data._access) continue;
        const b = m.data.ma,
          v = S("darak", "color_" + i, a[i] || "#00D084");
        o.setIndicator(
          "darak_ma" + (i === "balanced" ? "" : "_" + i),
          b.map((s, l) => ({ index: l, value: s })),
          v,
          r,
        );
      }
    } catch {}
  }
}
async function ft(e, n) {
  if (e)
    try {
      var a = await q(
          `${F}/v1/charts/qsignal?symbolId=${B}&timeframe=${A}&limit=${o && o.buffer ? o.buffer.length : 2e3}&ver=${e}`,
        ),
        r = await a.json();
      if (!r.success || !r.data) return;
      var i = r.data,
        y = document.getElementById("qsignalBadge");
      if (y) {
        var f = i.debug || {},
          m = f.total_signals || 0,
          b = f.ver || e,
          v = Ro[b] || "#D8B66A";
        ((y.style.display = "block"),
          (y.style.background = v + "20"),
          (y.style.color = v),
          (y.style.border = "1px solid " + v + "40"),
          (y.innerHTML = (Oo[b] || b) + ": " + m + "\uAC1C \uC2E0\uD638"));
      }
      if (o && o.buffer && o.buffer.length > 0 && i.signals)
        for (var s = 0; s < i.signals.length; s++) {
          var l = i.signals[s],
            d = l.index;
          if (!(d < 0 || d >= o.buffer.length)) {
            var p = Math.abs(o.buffer.high[d] - o.buffer.low[d]) || 1,
              c = l.type,
              u = l.side || "",
              g = u === "long",
              w = l.grade || "",
              h = l.model || "",
              _,
              x,
              k;
            if (c === "q_trend_continuation" || c === "q_pullback_reentry")
              (w === "STRONG"
                ? ((_ = g
                    ? o.buffer.low[d] - p * 0.5
                    : o.buffer.high[d] + p * 0.5),
                  (k = g ? "q_strong_long" : "q_strong_short"))
                : ((_ = g
                    ? o.buffer.low[d] - p * 0.4
                    : o.buffer.high[d] + p * 0.4),
                  (k = g ? "q_valid_long" : "q_valid_short")),
                (x = l.label || "Q"));
            else if (c === "q_reversal")
              ((_ = g ? o.buffer.low[d] - p * 0.5 : o.buffer.high[d] + p * 0.5),
                (k = g ? "q_reversal_long" : "q_reversal_short"),
                (x = "Q REV"));
            else if (c === "q_exit")
              ((_ = g ? o.buffer.high[d] + p * 0.3 : o.buffer.low[d] - p * 0.3),
                (k = g ? "q_exit_long" : "q_exit_short"),
                (x = ""));
            else if (c === "q_watch")
              ((_ = g ? o.buffer.low[d] - p * 0.2 : o.buffer.high[d] + p * 0.2),
                (k = g ? "q_watch_long" : "q_watch_short"),
                (x = ""));
            else continue;
            o.addDrawing({
              type: "q_signal",
              index: d,
              price: _,
              label: x,
              signalType: k,
              side: u,
              score: l.score || 0,
              grade: w,
              tp1: l.tp1,
              tp2: l.tp2,
              sl: l.sl,
              invalidation: l.invalidation,
              reason: l.reason || "",
              model: h,
            });
          }
        }
    } catch {}
}
((function () {
  var e = window._indToggleFns || (window._indToggleFns = {});
  ((e.qsig_safe = window._toggleQSigSafe),
    (e.qsig_std = window._toggleQSigStd),
    (e.qsig_aggr = window._toggleQSigAggr));
})(),
  (window._loadBeomAlerts = async function () {}),
  (window._deleteAllBeomAlerts = async function () {}),
  (window._initBeomAlertPanel = function () {}),
  (window.loadBeomSignals = async function () {}));
const Xe = "?v=" + Date.now();
(await import("./auth.js" + Xe),
  Z() && window.loadBeomSignals?.(),
  await import("./compare.js" + Xe),
  await import("./demo.js" + Xe),
  await import("./favorites.js" + Xe),
  await import("./ui.js" + Xe),
  (window._handleAccessGate = function (e) {
    return e
      ? e._access === "purchase_required"
        ? (window.showToast?.(
            "\uC774 \uC9C0\uD45C\uB294 \uAD6C\uB9E4 \uD6C4 \uC774\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694",
            "#D8B66A",
          ),
          !0)
        : e._access === "pro_only"
          ? (window.showToast?.(
              "\uC774 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD558\uB824\uBA74 \uD504\uB9AC\uBBF8\uC5C4\uC774 \uD544\uC694\uD574\uC694",
              "#D8B66A",
            ),
            !0)
          : e._access === "login_required"
            ? (window.showToast?.(
                "\uC774 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD558\uB824\uBA74 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD574\uC694",
                "#921230",
              ),
              window.showAuthModal && window.showAuthModal(),
              !0)
            : !1
      : !1;
  }),
  (window._closeAllPanels = function () {
    const e = [
      "authModal",
      "helpPanel",
      "langPanel",
      "mdPanel",
      "autobotPanel",
      "indSettingsPanel",
    ];
    for (const a of e) {
      const r = document.getElementById(a);
      if (
        r &&
        (r.style.display === "block" ||
          r.style.display === "flex" ||
          r.classList.contains("open"))
      )
        return ((r.style.display = "none"), r.classList.remove("open"), !0);
    }
    const n = document.getElementById("indDrawer");
    return n && n.classList.contains("open")
      ? (n.classList.remove("open"), !0)
      : !1;
  }),
  document.addEventListener("keydown", function (e) {
    e.key === "Escape" && window._closeAllPanels();
  }),
  document.addEventListener("visibilitychange", () => {
    !document.hidden && window.chart && window._refreshOverlays && U();
  }),
  (window._showSettings = function () {
    const e = document.getElementById("settingsModal");
    if (!e) return;
    e.style.display = "flex";
    const n = document.getElementById("settingsContent");
    if (!n) return;
    const a = window.isLoggedIn && G();
    let r = "";
    if (a) {
      const i = document.getElementById("userBadge")?.textContent || "";
      ((r += `<div style="margin-bottom:16px"><div style="font-size:16px;font-weight:700">${i}</div><div style="font-size:12px;color:var(--muted)">\uB85C\uADF8\uC778 \uC911</div></div>`),
        (r += `<div style="margin-bottom:16px"><label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">\uBCC4\uBA85(\uB2C9\uB124\uC784)</label><div style="display:flex;gap:6px"><input id="myNick" value="${(window.userName || "").replace(/"/g, "")}" maxlength="20" style="flex:1;padding:8px;background:var(--color-surface-sunken);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-primary);font-size:14px"><button onclick="window._saveProfile()" style="padding:8px 14px;background:#921230;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">\uBCC0\uACBD</button></div></div>`),
        (r +=
          '<div id="referralDashboard" style="color:var(--muted);font-size:13px">\uB808\uD37C\uB7F4 \uC815\uBCF4 \uB85C\uB529 \uC911...</div>'));
    } else
      r =
        '<div style="text-align:center;padding:20px;color:var(--muted)">\uB85C\uADF8\uC778 \uD6C4 \uC124\uC815\uC744 \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4</div>';
    n.innerHTML = r;
  }),
  (window._initReplay = function () {
    if (
      !(document.getElementById("userBadge")?.textContent || "").includes(
        "popo",
      )
    )
      return;
    const n = document.getElementById("replayBtn");
    n && (n.style.display = "");
    let a = document.getElementById("replayBar");
    a ||
      ((a = document.createElement("div")),
      (a.id = "replayBar"),
      (a.style.cssText =
        "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:12px;z-index:300;display:none;align-items:center;gap:10px;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3)"),
      (a.innerHTML = `
    <button onclick="_replayStart()" style="background:#C4384B;color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:600">\u25B6 \uC2DC\uC791</button>
    <button onclick="_replayBack()" style="background:#333;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer">\u25C0\u25C0</button>
    <button onclick="_replayStep()" style="background:#333;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer">\u25B6</button>
    <button onclick="_replayFast()" style="background:#333;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer">\u25B6\u25B6</button>
    <button onclick="_replayPlay()" id="replayPlayBtn" style="background:#D8B66A;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer">\u25B6 \uC7AC\uC0DD</button>
    <button onclick="_replayPause()" style="background:#FF6B35;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer">\u23F8 \uC815\uC9C0</button>
    <select id="replaySpeed" onchange="_replaySetSpeed(this.value)" style="background:#333;color:#fff;border:none;padding:4px;border-radius:4px;font-size:12px">
      <option value="1000">0.5x</option>
      <option value="500">1x</option>
      <option value="300" selected>2x</option>
      <option value="150">4x</option>
      <option value="50">10x</option>
    </select>
    <span id="replayPos" style="min-width:80px;text-align:center">\uB300\uAE30</span>
    <span style="border-left:1px solid #555;height:20px;margin:0 4px"></span>
    <button onclick="_replayDraw('circle')" style="background:#555;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer" title="\uB3D9\uADF8\uB77C\uBBF8">\u2B55</button>
    <button onclick="_replayDraw('arrow')" style="background:#555;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer" title="\uD654\uC0B4\uD45C">\u2197</button>
    <button onclick="_replayDraw('line')" style="background:#555;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer" title="\uC218\uD3C9\uC120">\u2500</button>
    <button onclick="_replayEntry()" id="replayEntryBtn" style="background:#22A16B;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:600" title="\uC9C4\uC785 \uD45C\uC2DC">\u{1F4CD} \uC9C4\uC785</button>
    <span id="replayPnl" style="min-width:80px;font-weight:700"></span>
    <button onclick="_replayStop()" style="background:#3B82F6;color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:600">\u25A0 \uC885\uB8CC</button>
  `),
      document.body.appendChild(a));
  }),
  (window._replayStart = function () {
    !o ||
      !o.buffer ||
      ((window._replayWaiting = !0),
      (document.getElementById("replayPos").textContent =
        "\uCC28\uD2B8 \uD074\uB9AD..."),
      o.onClick(function e(n) {
        if (!window._replayWaiting) return;
        window._replayWaiting = !1;
        const a = Math.max(50, Math.round(n.barIdx));
        (o.startReplay(a),
          (document.getElementById("replayPos").textContent =
            a + "/" + o.buffer.length),
          (o._clickCallbacks = o._clickCallbacks.filter((r) => r !== e)));
      }));
  }),
  (window._replayStep = function () {
    o?.isReplaying &&
      (o.replayForward(1),
      (document.getElementById("replayPos").textContent =
        o.replayPosition + "/" + o.replayTotal));
  }),
  (window._replayFast = function () {
    o?.isReplaying &&
      (o.replayForward(10),
      (document.getElementById("replayPos").textContent =
        o.replayPosition + "/" + o.replayTotal));
  }),
  (window._replayBack = function () {
    o?.isReplaying &&
      (o.replayBack(10),
      (document.getElementById("replayPos").textContent =
        o.replayPosition + "/" + o.replayTotal));
  }),
  (window._replaySpeed = 300),
  (window._replayIv = null),
  (window._replayPlay = function () {
    o?.isReplaying &&
      (o.replayAutoPlay(window._replaySpeed),
      window._replayIv && clearInterval(window._replayIv),
      (window._replayIv = setInterval(() => {
        if (!o?.isReplaying) {
          clearInterval(window._replayIv);
          return;
        }
        document.getElementById("replayPos").textContent =
          o.replayPosition + "/" + o.replayTotal;
      }, 200)));
  }),
  (window._replayPause = function () {
    o &&
      (o.replayAutoStop(),
      window._replayIv &&
        (clearInterval(window._replayIv), (window._replayIv = null)));
  }),
  (window._replaySetSpeed = function (e) {
    ((window._replaySpeed = parseInt(e)),
      o?.isReplaying && window._replayIv && (_replayPause(), _replayPlay()));
  }),
  (window._replayStop = function () {
    o &&
      (o.stopReplay(),
      (document.getElementById("replayPos").textContent = "\uC885\uB8CC"));
  }),
  (window._replayToggle = function () {
    const e = document.getElementById("replayBar");
    if (!e) {
      window._initReplay();
      return;
    }
    e.style.display = e.style.display === "none" ? "flex" : "none";
  }),
  (window._replayDrawMode = null),
  (window._replayEntryPrice = null),
  (window._replayClickHandler = null),
  (window._replayDraw = function (e) {
    if (!o) return;
    document.getElementById("replayPos").textContent =
      "\uCC28\uD2B8 \uD074\uB9AD...";
    const n = o.overlayCanvas || document.querySelector("canvas");
    (window._replayClickHandler &&
      n.removeEventListener("click", window._replayClickHandler),
      (window._replayClickHandler = function (a) {
        const r = n.getBoundingClientRect(),
          i = a.clientX - r.left,
          y = a.clientY - r.top,
          f = o.priceScale.yToPrice(y),
          m = Math.round(o.timeScale.xToBar(i));
        (e === "circle"
          ? o.addDrawing({
              type: "signal",
              index: m,
              price: f,
              signalType: "retest",
            })
          : e === "arrow"
            ? o.addDrawing({
                type: "text",
                index: m,
                price: f,
                text: "\u2197",
                color: "#C4384B",
              })
            : e === "line" &&
              o.addDrawing({
                type: "hline",
                price: f,
                color: "#D8B66A",
                lineWidth: 1.5,
                dashed: !0,
              }),
          (o._dirty = !0),
          n.removeEventListener("click", window._replayClickHandler),
          (window._replayClickHandler = null));
        const b = document.getElementById("replayPos");
        b && (b.textContent = (o.replayPosition || "") + "/" + o.replayTotal);
      }),
      n.addEventListener("click", window._replayClickHandler, { once: !0 }));
  }),
  (window._replayEntry = function () {
    if (!o) return;
    const e = document.getElementById("replayEntryBtn");
    if (window._replayEntryPrice) {
      const n = o.isReplaying ? o.replayPosition - 1 : o.buffer.length - 1,
        a = o.buffer.close[n],
        r = window._replayEntryPrice,
        i = (((a - r) / r) * 100).toFixed(2),
        y = parseFloat(i) >= 0 ? "#22A16B" : "#C4384B";
      ((document.getElementById("replayPnl").textContent =
        (parseFloat(i) >= 0 ? "+" : "") + i + "%"),
        (document.getElementById("replayPnl").style.color = y),
        o.addDrawing({
          type: "hline",
          price: a,
          color: y,
          lineWidth: 2,
          label: "\uCCAD\uC0B0 " + (parseFloat(i) >= 0 ? "+" : "") + i + "%",
        }),
        (o._dirty = !0),
        (window._replayEntryPrice = null),
        (e.textContent = "\u{1F4CD} \uC9C4\uC785"),
        (e.style.background = "#22A16B"));
    } else {
      document.getElementById("replayPos").textContent =
        "\uC9C4\uC785 \uD074\uB9AD...";
      const n = o.overlayCanvas || document.querySelector("canvas");
      (window._replayClickHandler &&
        n.removeEventListener("click", window._replayClickHandler),
        (window._replayClickHandler = function (a) {
          const r = n.getBoundingClientRect(),
            i = a.clientY - r.top,
            y = o.priceScale.yToPrice(i);
          ((window._replayEntryPrice = y),
            o.addDrawing({
              type: "hline",
              price: y,
              color: "#22A16B",
              lineWidth: 2,
              label: "\uC9C4\uC785",
            }),
            (o._dirty = !0),
            (e.textContent = "\u{1F4CD} \uCCAD\uC0B0"),
            (e.style.background = "#C4384B"),
            n.removeEventListener("click", window._replayClickHandler),
            (window._replayClickHandler = null));
        }),
        n.addEventListener("click", window._replayClickHandler, { once: !0 }));
    }
  }),
  document.addEventListener("keydown", function (e) {
    o?.isReplaying &&
      (e.target.tagName === "INPUT" ||
        e.target.tagName === "SELECT" ||
        e.target.tagName === "TEXTAREA" ||
        ((e.key === "e" || e.key === "E") &&
          (e.preventDefault(),
          window._replayEntryData
            ? ((window._replayEntryMode = !0),
              (document.getElementById("replayPos").textContent =
                "E: \uCCAD\uC0B0 \uD074\uB9AD"))
            : ((window._replayEntryMode = !0),
              (window._replayEntrySide = "long"),
              (document.getElementById("replayPos").textContent =
                "E: \uB871 \uC9C4\uC785 \uD074\uB9AD"))),
        (e.key === "d" || e.key === "D") &&
          (e.preventDefault(),
          window._replayEntryData
            ? ((window._replayEntryMode = !0),
              (document.getElementById("replayPos").textContent =
                "D: \uCCAD\uC0B0 \uD074\uB9AD"))
            : ((window._replayEntryMode = !0),
              (window._replayEntrySide = "short"),
              (document.getElementById("replayPos").textContent =
                "D: \uC20F \uC9C4\uC785 \uD074\uB9AD"))),
        (e.key === "q" || e.key === "Q") &&
          (e.preventDefault(),
          (window._replayFreeDrawing = !0),
          (document.getElementById("replayPos").textContent =
            "Q: \uB4DC\uB85C\uC789 (\uC6B0\uD074\uB9AD+\uB4DC\uB798\uADF8)")),
        e.key === " " &&
          (e.preventDefault(),
          window._replayIv ? _replayPause() : _replayPlay()),
        e.key === "ArrowRight" &&
          (e.preventDefault(),
          o.replayForward(e.shiftKey ? 10 : 1),
          (document.getElementById("replayPos").textContent =
            o.replayPosition + "/" + o.replayTotal)),
        e.key === "ArrowLeft" &&
          (e.preventDefault(),
          o.replayBack(e.shiftKey ? 10 : 1),
          (document.getElementById("replayPos").textContent =
            o.replayPosition + "/" + o.replayTotal))));
  }),
  (window._replayEntryMode = !1),
  (window._replayFreeDrawing = !1),
  (window._replayEntryData = null),
  (function () {
    const e = document
      .querySelector("#chartWrap")
      ?.querySelector("canvas:last-child");
    if (!e) return;
    e.addEventListener("click", function (i) {
      if (!o?.isReplaying || !window._replayEntryMode) return;
      window._replayEntryMode = !1;
      const y = e.getBoundingClientRect(),
        f = i.clientY - y.top,
        m = i.clientX - y.left,
        b = o.priceScale.yToPrice(f),
        v = Math.round(o.timeScale.xToBar(m));
      if (window._replayEntryData) {
        const s = window._replayEntryData.price,
          d =
            (window._replayEntryData.side || "long") === "long"
              ? ((b - s) / s) * 100
              : ((s - b) / s) * 100,
          p = Math.round((1e7 * d) / 100),
          c = Math.round((1e7 * 10 * d) / 100),
          u = d >= 0 ? "+" : "",
          g = d >= 0 ? "#22A16B" : "#C4384B",
          w =
            u +
            d.toFixed(2) +
            "% (\uD604\uBB3C" +
            u +
            (p / 1e4).toFixed(0) +
            "\uB9CC/\uC120\uBB3C" +
            u +
            (c / 1e4).toFixed(0) +
            "\uB9CC)";
        (o.addDrawing({
          type: "hline",
          price: b,
          color: g,
          lineWidth: 2,
          label: "\uCCAD\uC0B0 " + w,
        }),
          o.addDrawing({
            type: "signal",
            index: v,
            price: b,
            signalType: "sell",
          }),
          (o._dirty = !0),
          (document.getElementById("replayPnl").innerHTML = w),
          (document.getElementById("replayPnl").style.color = g),
          window._replayPnlIv &&
            (clearInterval(window._replayPnlIv), (window._replayPnlIv = null)),
          (window._replayEntryData = null),
          (window._replayEntryMode = !1),
          (document.getElementById("replayPos").textContent =
            o.replayPosition + "/" + o.replayTotal));
      } else {
        const s = window._replayEntrySide || "long";
        window._replayEntryData = { price: b, idx: v, side: s };
        const l = s === "long" ? "\uB871 \uC9C4\uC785" : "\uC20F \uC9C4\uC785",
          d = s === "long" ? "#22A16B" : "#C4384B";
        (o.addDrawing({
          type: "hline",
          price: b,
          color: d,
          lineWidth: 2,
          label: l + " " + b.toFixed(2) + " (1000\uB9CC\uC6D0)",
        }),
          o.addDrawing({
            type: "signal",
            index: v,
            price: b,
            signalType: s === "long" ? "buy" : "sell",
          }),
          (o._dirty = !0),
          (window._replayEntryMode = !1),
          (document.getElementById("replayPos").textContent =
            l + " @" + b.toFixed(2)),
          window._replayPnlIv && clearInterval(window._replayPnlIv),
          (window._replayPnlIv = setInterval(() => {
            if (!o?.isReplaying || !window._replayEntryData) {
              (window._replayPnlIv && clearInterval(window._replayPnlIv),
                (o._demoPosition = null),
                (o._dirty = !0));
              return;
            }
            const p = o.buffer.close[o.replayPosition - 1] || 0,
              c = window._replayEntryData.price;
            if (!c) return;
            const u = window._replayEntryData.side || "long",
              g = u === "long" ? ((p - c) / c) * 100 : ((c - p) / c) * 100,
              w = Math.round((1e7 * g) / 100),
              h = Math.round((1e7 * 10 * g) / 100),
              _ = g >= 0 ? "+" : "",
              x = g >= 0 ? "#22A16B" : "#C4384B",
              k = document.getElementById("replayPnl");
            (k &&
              ((k.innerHTML =
                _ +
                g.toFixed(2) +
                '% <span style="font-size:11px">\uD604\uBB3C' +
                _ +
                (w / 1e4).toFixed(0) +
                "\uB9CC \uC120\uBB3C" +
                _ +
                (h / 1e4).toFixed(0) +
                "\uB9CC</span>"),
              (k.style.color = x)),
              (o._demoPosition = {
                side: u === "long" ? "long" : "short",
                entry: c,
                pnl: (g >= 0, w / 1e4),
                pnl_pct: g,
              }),
              (o._dirty = !0));
          }, 200)));
      }
    });
    let n = !1,
      a = 0,
      r = 0;
    (e.addEventListener("mousedown", function (i) {
      !o?.isReplaying ||
        !window._replayFreeDrawing ||
        i.button !== 2 ||
        (i.preventDefault(), (n = !0), (a = i.offsetX), (r = i.offsetY));
    }),
      e.addEventListener("mousemove", function (i) {
        if (!n) return;
        const y = o.overlayCtx;
        ((y.strokeStyle = "#FF6B35"),
          (y.lineWidth = 2),
          (y.lineCap = "round"),
          y.beginPath(),
          y.moveTo(a, r),
          y.lineTo(i.offsetX, i.offsetY),
          y.stroke(),
          (a = i.offsetX),
          (r = i.offsetY));
      }),
      e.addEventListener("mouseup", function (i) {
        i.button === 2 && (n = !1);
      }),
      e.addEventListener("contextmenu", function (i) {
        o?.isReplaying && window._replayFreeDrawing && i.preventDefault();
      }));
  })());

/* 좌측 툴바 첫 줄(가격/사용자메뉴 행) 하단 구분선과 우측 패널 탭(.right-tabs) 하단 구분선 높이 정렬 */
(function () {
  function _alignRightTabs() {
    var row =
        document.querySelector(".toolbar-row-primary") ||
        document.querySelector(".toolbar"),
      rt = document.querySelector(".right-tabs");
    if (!row || !rt) return;
    var rightEl = rt.parentElement; // .right
    if (!rightEl) return;
    // 모바일(우측 패널 오버레이)에서는 정렬 불필요
    if (window.matchMedia && window.matchMedia("(max-width:768px)").matches) {
      rightEl.style.paddingTop = "";
      return;
    }
    var gap = Math.round(
      row.getBoundingClientRect().bottom - rt.getBoundingClientRect().height,
    );
    rightEl.style.paddingTop = (gap > 0 ? gap : 0) + "px";
  }
  window._alignRightTabs = _alignRightTabs;
  window.addEventListener("resize", _alignRightTabs);
  try {
    var tb = document.querySelector(".toolbar");
    if (tb && window.ResizeObserver) {
      new ResizeObserver(_alignRightTabs).observe(tb);
    }
  } catch (e) {}
  // 초기 + 약간의 지연(레이아웃 안정화 후)
  _alignRightTabs();
  setTimeout(_alignRightTabs, 300);
  setTimeout(_alignRightTabs, 1200);
})();

/* ───────── 범온 자동매매 2 (OB autotrade 봇 실시간 표시) ───────── */
(function () {
  let _ba2_on = false;
  let _ba2_timer = null;
  let _ba2_lastEventCount = 0;
  let _ba2_lastKey = null; // symbol:tf 캐시 키
  let _ba2_mode = "retest"; // "retest"(되돌림 진입) | "instant"(즉시 진입)

  // 진입 모드 전환 — 차트 즉시 갱신
  window._setBeomAuto2Mode = function (mode) {
    _ba2_mode = mode === "instant" ? "instant" : "retest";
    _ba2_lastEventCount = 0; // 강제 재로드
    if (window.chart && window.chart.overlay) {
      window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
        (d) => d._calcOwner !== "ba2",
      );
      window.chart._dirty = true;
    }
    if (_ba2_on) window._loadBeomAuto2 && window._loadBeomAuto2();
    return _ba2_mode;
  };
  window._getBeomAuto2Mode = function () {
    return _ba2_mode;
  };

  window._toggleBeomAuto2 = function () {
    if (
      window.requireLogin &&
      !window.requireLogin("\uBC94\uC628 \uC790\uB3D9\uB9E4\uB9E4 2")
    )
      return;
    _ba2_on = !_ba2_on;
    const btn = document.querySelector('[data-ind="beom_auto2"]');
    if (btn) btn.classList.toggle("on", _ba2_on);
    if (_ba2_on) {
      _ba2_lastEventCount = 0;
      _ba2_lastKey = null;
      window._loadBeomAuto2 && window._loadBeomAuto2();
      // 2.5초마다 폴링 — 봇의 새 이벤트 + 심볼/TF 변경 감지
      if (_ba2_timer) clearInterval(_ba2_timer);
      _ba2_timer = setInterval(() => {
        try {
          window._loadBeomAuto2 && window._loadBeomAuto2();
        } catch (e) {}
      }, 2500);
    } else {
      if (_ba2_timer) {
        clearInterval(_ba2_timer);
        _ba2_timer = null;
      }
      // 차트에서 자동매매2 드로잉 제거
      if (window.chart && window.chart.overlay) {
        window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
          (d) => d._calcOwner !== "ba2",
        );
        window.chart._dirty = true;
      }
    }
    if (window._debounceSaveChartSettings) window._debounceSaveChartSettings();
  };

  window._loadBeomAuto2 = async function () {
    if (!_ba2_on) return;
    if (!window.chart || !window.chart.buffer || window.chart.buffer.length < 5)
      return;
    const sym = window.curSymbol;
    const tf = window.curTf;
    const key = sym + ":" + tf;
    // 심볼/TF 바뀌면 카운트 리셋
    if (_ba2_lastKey !== key) {
      _ba2_lastKey = key;
      _ba2_lastEventCount = 0;
      // 기존 ba2 드로잉도 클리어 (새 심볼·TF니까)
      if (window.chart && window.chart.overlay) {
        window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
          (d) => d._calcOwner !== "ba2",
        );
      }
      // ba2가 잠갔던 가격 스케일 플래그 해제 — 새 심볼·TF는 가격대가 다르므로
      // 엔진이 다음 렌더에서 봉 기준으로 스케일을 다시 계산하도록 _dirty 설정
      if (window.chart) {
        if (window.chart._priceScaleLocked)
          window.chart._priceScaleLocked = false;
        window.chart._dirty = true;
      }
    }
    try {
      const url = `/v1/charts/ind-beomauto2?symbolId=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}&limit=500&mode=${encodeURIComponent(_ba2_mode)}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!j.success || !j.data || !Array.isArray(j.data.events)) return;
      const events = j.data.events;
      if (events.length === _ba2_lastEventCount) {
        // 변경 없음
        return;
      }
      _ba2_lastEventCount = events.length;

      // 모든 ba2 드로잉 제거 후 재생성 (단순·안전)
      if (window.chart && window.chart.overlay) {
        window.chart.overlay.drawings = window.chart.overlay.drawings.filter(
          (d) => d._calcOwner !== "ba2",
        );
      }

      // 이벤트 ts(ms) → 차트 buffer index 매핑
      const buf = window.chart.buffer;
      const tfMs =
        {
          "1m": 60e3,
          "5m": 300e3,
          "15m": 900e3,
          "1h": 3600e3,
          "4h": 14400e3,
          "1d": 86400e3,
        }[tf] || 60e3;
      const findIdx = (tsMs) => {
        // buffer.time[i] 는 초 단위
        // 가장 가까운 봉 인덱스
        const sec = Math.floor(tsMs / 1000);
        let best = -1,
          bestDiff = Infinity;
        // 이진탐색 대신 끝에서 역방향 (최근 이벤트가 많을 것)
        for (let i = buf.length - 1; i >= Math.max(0, buf.length - 1000); i--) {
          const t = buf.time[i];
          if (!Number.isFinite(t)) continue;
          const diff = Math.abs(t - sec);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
          }
          if (t < sec - (tfMs / 1000) * 2) break;
        }
        // 1봉 시간 안에만
        if (bestDiff > (tfMs / 1000) * 1.5) return -1;
        return best;
      };

      // 청산된 pos_id 수집 — 이 진입의 SL/TP 라인은 그리지 않음
      const closedPos = new Set();
      for (const ev of events) {
        if (
          (ev.kind === "close_sl" ||
            ev.kind === "close_tp3" ||
            ev.kind === "opp_close") &&
          ev.pos_id
        ) {
          closedPos.add(ev.pos_id);
        }
      }
      // pos_id → 청산 시각(ts, ms). 같은 pos가 여러 번이면 마지막(가장 늦은) 청산 사용
      const closeTsByPos = {};
      for (const ev of events) {
        if (
          (ev.kind === "close_sl" ||
            ev.kind === "close_tp3" ||
            ev.kind === "opp_close") &&
          ev.pos_id
        ) {
          const t = ev.ts || 0;
          if (!(ev.pos_id in closeTsByPos) || t > closeTsByPos[ev.pos_id]) {
            closeTsByPos[ev.pos_id] = t;
          }
        }
      }

      // 같은 (idx, kind, side) 마커는 1개만 (개수만 라벨에 표시)
      const groupCounts = {}; // key → count
      const groupPnl = {}; // key → PnL 합계 (tp1/tp2: pnl, close_*: pnl_total)
      for (const ev of events) {
        const idx = findIdx(ev.ts);
        if (idx < 0) continue;
        const k = `${idx}|${ev.kind}|${ev.side || ""}`;
        groupCounts[k] = (groupCounts[k] || 0) + 1;
        const pv =
          ev.pnl_total !== undefined && ev.pnl_total !== null
            ? ev.pnl_total
            : ev.pnl !== undefined && ev.pnl !== null
              ? ev.pnl
              : null;
        if (pv !== null && Number.isFinite(pv)) {
          groupPnl[k] = (groupPnl[k] || 0) + pv;
        }
      }
      // $금액 라벨 포맷: +$1.23 / -$4.56 (소액은 소수 2자리)
      const fmtPnl = (v) => {
        if (v === undefined || v === null || !Number.isFinite(v)) return "";
        const sign = v >= 0 ? "+" : "-";
        return ` ${sign}$${Math.abs(v).toFixed(2)}`;
      };
      const drawnKeys = new Set();

      for (const ev of events) {
        const idx = findIdx(ev.ts);
        if (idx < 0) continue;
        const price = ev.price || 0;
        if (price <= 0) continue;
        const k = `${idx}|${ev.kind}|${ev.side || ""}`;
        if (drawnKeys.has(k)) continue;
        drawnKeys.add(k);
        const cnt = groupCounts[k] || 1;
        const cntSuffix = cnt > 1 ? ` ×${cnt}` : "";

        if (ev.kind === "open") {
          // 진입 — 화살표 + 라벨
          const isLong = ev.side === "long";
          const color = isLong ? "#C4384B" : "#3B82F6";
          const label = (isLong ? "▲ 매수" : "▼ 매도") + cntSuffix;
          window.chart.addDrawing({
            type: "buy_scan",
            index: idx,
            price: price,
            scanType: isLong ? "buy" : "sell",
            color: color,
            size: 9,
            _calcOwner: "ba2",
          });
          window.chart.addDrawing({
            type: "text",
            index: idx,
            price: price,
            text: label,
            color: color,
            _calcOwner: "ba2",
          });
          // SL · TP1 · TP2 · TP3 라인 — 진입 캔들 ~ 포지션 마감 캔들까지만
          {
            const _bufLen =
              (window.chart.buffer && window.chart.buffer.length) || idx + 50;
            // 이 진입(pos_id)이 청산됐으면 청산 캔들 인덱스까지, 아니면 차트 끝(활성)까지
            let _endIdx;
            const _closeTs = ev.pos_id ? closeTsByPos[ev.pos_id] : undefined;
            if (_closeTs) {
              const _ci = findIdx(_closeTs);
              // 청산 캔들을 못 찾으면(범위 밖) 진입+소량만, 찾으면 그 캔들까지
              _endIdx = _ci >= idx ? _ci : idx + 1;
            } else {
              // 활성 포지션: 현재 캔들까지만 (차트 끝 너머로 뻗지 않게)
              _endIdx = Math.max(idx + 1, _bufLen - 1);
            }
            const _lvl = [
              { price: ev.sl, text: "SL", color: "#8E7D72", dashed: true },
              { price: ev.tp1, text: "TP1", color: "#16A34A", dashed: true },
              { price: ev.tp2, text: "TP2", color: "#16A34A", dashed: true },
              { price: ev.tp3, text: "TP3", color: "#16A34A", dashed: false },
            ];
            for (const L of _lvl) {
              if (!Number.isFinite(L.price) || L.price <= 0) continue;
              window.chart.addDrawing({
                type: "trendline",
                points: [
                  { index: idx, price: L.price },
                  { index: _endIdx, price: L.price },
                ],
                color: L.color,
                lineWidth: 1,
                dashed: L.dashed,
                _calcOwner: "ba2",
              });
              window.chart.addDrawing({
                type: "text",
                index: idx,
                price: L.price,
                text:
                  L.text +
                  " " +
                  L.price.toFixed(price < 1 ? 4 : price < 100 ? 3 : 2),
                color: L.color,
                _calcOwner: "ba2",
              });
            }
          }
        } else if (ev.kind === "tp1" || ev.kind === "tp2") {
          const pnlStr = fmtPnl(groupPnl[k]);
          window.chart.addDrawing({
            type: "text",
            index: idx,
            price: price,
            text:
              "○ " +
              (ev.kind === "tp1" ? "TP1 익절" : "TP2 익절") +
              cntSuffix +
              pnlStr,
            color: "#16A34A",
            _calcOwner: "ba2",
          });
          window.chart.addDrawing({
            type: "buy_scan",
            index: idx,
            price: price,
            scanType: "buy",
            color: "#16A34A",
            size: 6,
            _calcOwner: "ba2",
          });
        } else if (ev.kind === "close_tp3") {
          const pnl = groupPnl[k];
          const win = !Number.isFinite(pnl) || pnl >= 0;
          const col = win ? "#16A34A" : "#DC2626";
          window.chart.addDrawing({
            type: "text",
            index: idx,
            price: price,
            text: "○ TP3 도달" + cntSuffix + fmtPnl(pnl),
            color: col,
            _calcOwner: "ba2",
          });
          window.chart.addDrawing({
            type: "buy_scan",
            index: idx,
            price: price,
            scanType: "buy",
            color: col,
            size: 9,
            _calcOwner: "ba2",
          });
        } else if (ev.kind === "close_sl") {
          const pnl = groupPnl[k];
          const win = Number.isFinite(pnl) && pnl > 0;
          const col = win ? "#16A34A" : "#8E7D72";
          window.chart.addDrawing({
            type: "text",
            index: idx,
            price: price,
            text: "✕ SL 도달" + cntSuffix + fmtPnl(pnl),
            color: col,
            _calcOwner: "ba2",
          });
          window.chart.addDrawing({
            type: "buy_scan",
            index: idx,
            price: price,
            scanType: "sell",
            color: col,
            size: 8,
            _calcOwner: "ba2",
          });
        } else if (ev.kind === "opp_close") {
          const pnl = groupPnl[k];
          window.chart.addDrawing({
            type: "text",
            index: idx,
            price: price,
            text: "↻ 반대블록" + cntSuffix + fmtPnl(pnl),
            color: "#D8B66A",
            _calcOwner: "ba2",
          });
          window.chart.addDrawing({
            type: "buy_scan",
            index: idx,
            price: price,
            scanType: "sell",
            color: "#D8B66A",
            size: 7,
            _calcOwner: "ba2",
          });
        }
      }
      window.chart._dirty = true;

      // 모든 진입의 SL/TP가 차트 가시 범위 밖이면 priceScale 확장
      try {
        const ps = window.chart.priceScale;
        if (
          ps &&
          Number.isFinite(ps.min) &&
          Number.isFinite(ps.max) &&
          ps.max > ps.min
        ) {
          let curMin = ps.min,
            curMax = ps.max;
          // 가시 영역 내 진입의 SL/TP만 고려 (너무 오래된 건 무시)
          const visFrom = window.chart.timeScale.visibleFrom;
          const visTo = window.chart.timeScale.visibleTo;
          for (const ev of events) {
            if (ev.kind !== "open") continue;
            const idx = findIdx(ev.ts);
            if (idx < visFrom - 10 || idx > visTo + 10) continue;
            for (const p of [ev.sl, ev.tp1, ev.tp2, ev.tp3]) {
              if (Number.isFinite(p) && p > 0) {
                if (p < curMin) curMin = p;
                if (p > curMax) curMax = p;
              }
            }
          }
          if (curMin < ps.min || curMax > ps.max) {
            // 약간 여유
            const pad = (curMax - curMin) * 0.03;
            ps.min = curMin - pad;
            ps.max = curMax + pad;
            window.chart._priceScaleLocked = true; // 자동 재조정 막기
            window.chart._dirty = true;
          }
        }
      } catch (e) {}
    } catch (e) {
      // 조용히 무시 (네트워크 일시 실패)
    }
  };

  // TF/심볼 변경 시 — 켜져있으면 자동 재로드
  if (typeof window._refreshOverlays === "function") {
    const _orig = window._refreshOverlays;
    window._refreshOverlays = function () {
      const r = _orig.apply(this, arguments);
      if (_ba2_on) {
        setTimeout(() => window._loadBeomAuto2 && window._loadBeomAuto2(), 800);
      }
      return r;
    };
  }
})();
