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
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btns.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        selectedMethod = btn.getAttribute("data-method");
      });
    });
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
    planLabels.forEach(function (label) {
      var input = label.querySelector("input[type=radio]");
      label.addEventListener("click", function () {
        planLabels.forEach(function (l) { l.classList.remove("is-active"); });
        label.classList.add("is-active");
        input.checked = true;
        selectedPlan = input.value;
      });
    });
  }

  var methodWrap = document.getElementById("billing-method");
  if (methodWrap) {
    var btns = methodWrap.querySelectorAll(".co-method-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btns.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        selectedMethod = btn.getAttribute("data-method");
      });
    });
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
