/* checkout-common.js
 * 토스페이먼츠 결제창(단건) / 자동결제(빌링) 예시 연동 스크립트
 * 심사·테스트 목적으로 "문서용 테스트 클라이언트 키"를 사용합니다.
 * @docs https://docs.tosspayments.com/guides/v2/payment-window/integration
 * @docs https://docs.tosspayments.com/guides/v2/billing/integration
 *
 * 실서비스 전환 시:
 * 1) TOSS_CLIENT_KEY 값을 개발자센터에서 발급받은 라이브(또는 발급받은 테스트) 클라이언트 키로 교체하세요.
 * 2) 결제 승인(confirm) / 빌링키 발급(issue-billing-key) 단계는 시크릿 키가 필요하므로
 *    반드시 서버(백엔드)에서 처리해야 합니다. 클라이언트에 시크릿 키를 절대 넣지 마세요.
 */

// 문서용 테스트 클라이언트 키 (토스페이먼츠 공식 제공, 회원가입 없이 테스트 가능)
var TOSS_CLIENT_KEY = "test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq";

function generateRandomKey() {
  return window.btoa(String(Math.random())).slice(0, 20);
}

function formatWon(n) {
  return Number(n).toLocaleString("ko-KR");
}

// ------ 단건 결제(결제창) ------
function initSingleCheckout(opts) {
  var selectedMethod = "CARD";
  var methodWrap = document.getElementById("payment-method");
  if (methodWrap) {
    var btns = methodWrap.querySelectorAll(".co-method-btn");
    // 선택 상태를 배경색뿐 아니라 aria-pressed로도 전달한다(WCAG 4.1.2/1.4.1).
    var syncMethod = function (active) {
      btns.forEach(function (b) {
        var on = b === active;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        syncMethod(btn);
        selectedMethod = btn.getAttribute("data-method");
      });
    });
    // 초기 상태(마크업의 .is-active) 반영
    var initialMethod = methodWrap.querySelector(".co-method-btn.is-active") || btns[0];
    if (initialMethod) {
      syncMethod(initialMethod);
      selectedMethod = initialMethod.getAttribute("data-method");
    }
  }

  var payBtn = document.getElementById("pay-btn");
  if (!payBtn) return;

  var customerKey = generateRandomKey();
  var tossPayments = window.TossPayments ? window.TossPayments(TOSS_CLIENT_KEY) : null;
  var payment = tossPayments ? tossPayments.payment({ customerKey: customerKey }) : null;

  payBtn.addEventListener("click", async function () {
    if (!payment) {
      alert("결제 SDK를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
      return;
    }
    var basePayload = {
      amount: { currency: "KRW", value: opts.amountValue },
      orderId: generateRandomKey(),
      orderName: opts.orderName,
      successUrl: window.location.origin + opts.successPath,
      failUrl: window.location.origin + opts.failPath,
      customerEmail: "test@beomonnuri.com",
      customerName: "심사테스트"
    };
    try {
      if (selectedMethod === "CARD") {
        await payment.requestPayment(Object.assign({}, basePayload, {
          method: "CARD",
          card: { useEscrow: false, flowMode: "DEFAULT", useCardPoint: false, useAppCardOnly: false }
        }));
      } else if (selectedMethod === "TRANSFER") {
        await payment.requestPayment(Object.assign({}, basePayload, {
          method: "TRANSFER",
          transfer: { cashReceipt: { type: "미발행" }, useEscrow: false }
        }));
      } else if (selectedMethod === "VIRTUAL_ACCOUNT") {
        await payment.requestPayment(Object.assign({}, basePayload, {
          method: "VIRTUAL_ACCOUNT",
          virtualAccount: { cashReceipt: { type: "미발행" }, useEscrow: false, validHours: 24 }
        }));
      }
    } catch (err) {
      console.error(err);
    }
  });
}

// ------ 정기결제(자동결제/빌링) ------
function initBillingCheckout(opts) {
  var selectedPlan = "basic";
  var selectedMethod = "CARD";

  var planWrap = document.getElementById("plan-select");
  if (planWrap) {
    var planLabels = planWrap.querySelectorAll(".co-plan");
    // change 이벤트 기반으로 전환한다. 라디오는 opacity:0로 숨겨져 있어 키보드 방향키로
    // 선택을 옮기면 click은 발생하지 않고 change만 발생하는데, 기존 label click 핸들러는
    // 이를 놓쳐 시각적 선택 표시(.is-active)가 갱신되지 않았다(WCAG 2.1.1/1.4.1).
    // change에서 현재 checked 상태를 기준으로 표시를 동기화하며, click 핸들러는 두지 않아
    // 이중 처리를 피한다(라벨 클릭은 라디오 change를 자동 유발).
    var syncPlan = function () {
      planLabels.forEach(function (l) {
        var radio = l.querySelector("input[type=radio]");
        var on = !!(radio && radio.checked);
        l.classList.toggle("is-active", on);
        if (on) selectedPlan = radio.value;
      });
    };
    planLabels.forEach(function (label) {
      var input = label.querySelector("input[type=radio]");
      if (input) input.addEventListener("change", syncPlan);
    });
    // 초기 상태(미리 checked된 라디오) 반영
    syncPlan();
  }

  var methodWrap = document.getElementById("billing-method");
  if (methodWrap) {
    var btns = methodWrap.querySelectorAll(".co-method-btn");
    // 선택 상태를 배경색뿐 아니라 aria-pressed로도 전달한다(WCAG 4.1.2/1.4.1).
    var syncMethod = function (active) {
      btns.forEach(function (b) {
        var on = b === active;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        syncMethod(btn);
        selectedMethod = btn.getAttribute("data-method");
      });
    });
    // 초기 상태(마크업의 .is-active) 반영
    var initialMethod = methodWrap.querySelector(".co-method-btn.is-active") || btns[0];
    if (initialMethod) {
      syncMethod(initialMethod);
      selectedMethod = initialMethod.getAttribute("data-method");
    }
  }

  var billingBtn = document.getElementById("billing-btn");
  if (!billingBtn) return;

  var customerKey = generateRandomKey();
  var tossPayments = window.TossPayments ? window.TossPayments(TOSS_CLIENT_KEY) : null;
  var payment = tossPayments ? tossPayments.payment({ customerKey: customerKey }) : null;

  billingBtn.addEventListener("click", async function () {
    if (!payment) {
      alert("결제 SDK를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
      return;
    }
    try {
      await payment.requestBillingAuth({
        method: selectedMethod,
        successUrl: window.location.origin + opts.successPath + "?plan=" + encodeURIComponent(selectedPlan),
        failUrl: window.location.origin + opts.failPath,
        customerEmail: "test@beomonnuri.com",
        customerName: "심사테스트"
      });
    } catch (err) {
      console.error(err);
    }
  });
}
