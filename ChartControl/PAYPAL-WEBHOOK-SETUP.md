# PayPal 웹훅 설정 — 운영자가 해야 하는 것

작성 2026-09-17 · 코드는 배포돼 있고 **설정만 남았다**.

---

## 지금 상태

엔드포인트는 살아 있다:

```
POST https://chartcontrol.onrender.com/api/payments/paypal/webhook
```

**설정이 없으면 503 으로 거부한다.** 검증할 수 없는 요청을 처리하면 아무나 우리 주소로
"분쟁이 열렸다"·"구독이 취소됐다" 를 보낼 수 있으므로, 일부러 열지 않았다(fail-closed).

확인:

```bash
curl -sS -X POST https://chartcontrol.onrender.com/api/payments/paypal/webhook \
  -H 'content-type: application/json' -d '{}' -w '\nHTTP %{http_code}\n'
# 지금:  HTTP 503  {"error":{"code":"WEBHOOK_NOT_CONFIGURED",...}}
# 설정 후: 서명 없는 요청은 HTTP 401 (정상이다 — PayPal 이 보낸 것만 통과한다)
```

---

## 왜 필요한가

구독 상태는 **15분 폴링**이 처리한다. 그건 그대로 둔다 — 유실되지 않고 PayPal 쪽 설정도
필요 없어서 의도적으로 고른 방식이다.

그런데 폴링으로 **절대 알 수 없는 것**이 하나 있다:

> 고객이 PayPal 에 이의를 제기하면(dispute / chargeback) **구독 상태는 ACTIVE 그대로다.**
> 우리 화면에는 아무 변화가 없고 PayPal 대시보드에만 나타난다.

즉 **돈이 빠져나가는데 우리는 모른다.** 분쟁에는 증빙 제출 기한이 있어서, 늦게 알면
다툴 기회 자체가 사라진다. 웹훅은 이것 하나를 위해 붙였다.

---

## 해야 할 일 (5분)

### 1. PayPal 대시보드에서 웹훅 만들기

1. <https://developer.paypal.com/dashboard/> 로그인
2. 좌상단에서 **Live** 선택 (Sandbox 아니다 — 우리는 live 로 돈다)
3. **Apps & Credentials** → 우리 앱 선택
4. 아래쪽 **Webhooks** → **Add Webhook**
5. **Webhook URL** 에 입력:
   ```
   https://chartcontrol.onrender.com/api/payments/paypal/webhook
   ```
6. **Event types** — 아래 항목만 체크한다. 전부 켜면 처리하지 않는 이벤트가 쏟아진다
   (거부하지는 않고 무시하지만, 로그가 지저분해진다).

   **분쟁·환불 (이게 핵심이다)**
   - `CUSTOMER.DISPUTE.CREATED`
   - `CUSTOMER.DISPUTE.UPDATED`
   - `CUSTOMER.DISPUTE.RESOLVED`
   - `PAYMENT.CAPTURE.REVERSED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.DENIED`

   **구독 생애주기 (폴링보다 빨리 알기 위한 보조)**
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`

7. 저장하면 목록에 **Webhook ID** 가 나온다 (`5ML55555LL555555L` 같은 모양).
   그 값을 복사한다.

### 2. Render 환경변수에 넣기

Render → 서비스 → **Environment** → Add Environment Variable

```
PAYPAL_WEBHOOK_ID = <복사한 Webhook ID>
```

저장하면 Render 가 재시작한다. 재시작 후 로그에 이렇게 나와야 한다:

```
[paypal-webhook] 마운트됨 (검증=가능)
```

`검증=불가 → 503 거부` 로 나오면 환경변수 이름·값을 다시 확인한다.

### 3. 동작 확인

PayPal 대시보드의 웹훅 상세 화면에 **Send test** 기능이 있다. 아무 이벤트나 보내고
Render 로그를 본다.

```bash
curl -s -G "https://api.render.com/v1/logs" -H "Authorization: Bearer $(cat /tmp/.rk)" \
  --data-urlencode "resource=srv-da4h43s9v7es7386a4a0" \
  --data-urlencode "limit=20" --data-urlencode "text=paypal-webhook"
```

- 서명이 맞으면 `200` 이고 처리 결과가 남는다.
- 서명이 안 맞으면 `401` 이다. **이것도 정상 동작이다** — 위조를 막고 있다는 뜻이다.

---

## 설정 후 분쟁이 오면 어디에 보이나

1. **관리자 화면의 운영 오류 목록** — 제목이 `결제 분쟁/환불: CUSTOMER.DISPUTE.CREATED`
   형태로 뜬다. `event_id` 와 PayPal 쪽 참조 id 가 함께 적힌다.
2. **`payment_webhook_events` 테이블** — 받은 모든 이벤트와 처리 결과가 남는다.

   ```sql
   SELECT event_id, event_type, resource_id, received_at, handled, note
   FROM payment_webhook_events ORDER BY received_at DESC LIMIT 20;
   ```

### ★ 한계 — 메일은 자동으로 가지 않는다

분쟁은 기록되고 관리자 화면에 뜨지만, **메일 발송은 이 경로에 배선되지 않았다**
(메일 알림 설정이 다른 곳에 있어서 그대로 두었다). 그래서 둘 중 하나가 필요하다:

- 관리자 화면을 주기적으로 보거나,
- **PayPal 자체 알림 메일을 켠다** (PayPal 계정 설정 → 알림). 이게 더 확실하다 —
  우리 시스템이 죽어 있어도 PayPal 이 직접 보낸다.

권장: 둘 다 켠다. 우리 기록은 "무슨 일이 있었는지" 추적용, PayPal 메일은 "놓치지
않기" 용이다.

---

## 알아둘 것

- **폴링은 그대로 돈다.** 웹훅이 유실되거나 설정이 빠져도 구독 상태는 15분 안에 맞는다.
  웹훅은 대체가 아니라 추가다.
- **웹훅 payload 로 기간을 연장하지 않는다.** 구독 사건이 오면 PayPal 에 다시 물어봐서
  판단한다. 위조된 요청 하나로 무료 구독이 열리는 것을 막기 위한 것이다.
- **같은 이벤트를 여러 번 받아도 한 번만 처리한다.** PayPal 은 재시도하는데,
  멱등하지 않으면 같은 분쟁 알림이 반복되고 구독 기간이 두 번 연장된다.
  DB 유니크 제약으로 막는다.
- 처리하지 않는 이벤트가 와도 `200` 으로 받고 무시한다. 4xx/5xx 를 주면 PayPal 이
  영원히 재시도한다.

---

## 아직 남은 결제 관련 항목

- **실제 결제 1건이 아직 없다** (구독 0건). 웹훅은 결제가 일어난 뒤에야 의미가 있으므로,
  본인 카드로 구독 1건을 만들어 전체 흐름을 한 번 지나가게 하는 것이 여전히 가장 급하다.
- VAT — 세무사 답변 대기 중(TODO §2). 답이 오기 전에는 "VAT 포함" 가격을 만들지 않는다.
