# e2e 상태 — 하네스는 살렸고, 스펙은 옛 앱을 대상으로 쓰여 있다

## 무엇이 고쳐졌나

`pnpm e2e` 는 **시작조차 못 하고 있었다.**

```
Error: Process from config.webServer exited early.
```

설정이 두 번째 웹 서버로 `pnpm --filter @quantumtrade/web dev` 를 띄우려 했는데 **그 패키지는 존재하지 않는다**. 프론트엔드는 이제 API 서버가 직접 서빙한다(`apps/api/src/static-web.ts` 가 `index.html`·`src`·`vendor`·`web-dist` 를 연다).

고친 것:

- 없는 웹 서버 항목 제거, `BASE_URL` 을 API 서버로
- `CORS_ALLOWED_ORIGINS` 를 API 오리진으로(브라우저가 그 오리진에서 요청한다)
- 포트 점검에서 5173(Vite) 제거 — 아무도 쓰지 않는 포트를 검사하면 무관한 프로세스 때문에 실패한다
- 스펙 134개 `goto('/x')` → `goto('/#/x')` (이 앱은 해시 라우터다)
- `getByLabel('email')` → `getByLabel('Email', { exact: true })` — 부분 일치가 체크박스 라벨 문구까지 잡아 strict 위반이 되고, 그것이 타임아웃으로 보였다

이제 하네스가 실제로 돌고 **테스트가 진짜 이유로 실패한다.** 그 차이가 이 작업의 목적이다.

## 부수 효과: 접근성 결함이 드러났다

인증 화면 입력칸에 `aria-label` 도 `htmlFor` 도 **하나도 없었다**. 라벨이 `<span>` 으로만 있어 input 과 연결되지 않았다.

- 스크린리더 사용자는 어느 칸이 이메일인지 알 수 없다
- `getByLabel` 이 칸을 찾지 못해 인증 흐름 테스트가 전부 실패한다

`src/pages-auth.jsx` 의 16곳에 `aria-label={t('키')}` 를 붙였다. 사전 키를 그대로 쓰므로 번역이 함께 따라온다.

**아직 남은 곳**: `pages-user.jsx` 15개, `pages-more.jsx` 16개, `widgets.jsx` 15개 입력칸에 접근성 라벨이 없다.

## 남은 격차 — 스펙이 존재하지 않는 UI 를 기대한다

| 기대 | 실제 |
|---|---|
| `getByTestId(...)` 11곳 | 앱에 `data-testid` **0개** |
| `.card button.btn--primary` 3곳 | 현재 마크업과 다름 |
| `/trade/ai` `/trade/order` `/trade/layout` `/status` | 존재하지 않는 라우트 |

즉 스펙 24개는 **구조가 다른 예전 앱**을 대상으로 쓰였다. 선택자를 하나씩 맞추는 것은 스펙을 새로 쓰는 일에 가깝고, 그 전에 결정이 필요하다.

## 결정이 필요한 것

`data-testid` 를 앱에 넣을지가 갈림길이다.

- **넣는다**: 스펙이 안정된 선택자를 갖는다. 대신 마크업에 테스트 전용 속성이 늘고, 어떤 요소에 붙일지 기준이 필요하다.
- **넣지 않는다**: 스펙을 역할·라벨 기반(`getByRole`, `getByLabel`)으로 다시 쓴다. 접근성이 함께 개선되지만(위에서 본 것처럼) 작업량이 크다.

두 번째가 더 낫다고 보는 이유: `getByLabel` 을 고치는 과정에서 실제 접근성 결함이 드러났다. 역할·라벨로 테스트를 쓰면 **테스트가 접근성을 강제한다.** 다만 24개 스펙을 다시 쓰는 일이므로 별도 작업으로 잡아야 한다.

## 다른 두 스위트

`tests/e2e-admin` 은 `@quantumtrade/admin` 패키지를 빌드·프리뷰하려 하는데 그 패키지도 없다. `tests/e2e-mfa` 는 `@quantumtrade/web` 을 쓴다. 둘 다 같은 이유로 돌지 않는다. 이 문서의 첫 수정과 같은 방식으로 고칠 수 있지만, 스펙 격차는 위와 동일하게 남는다.

## 지금 돌려보는 방법

```bash
# 남아 있는 테스트 서버가 포트를 잡고 있으면 먼저 정리한다
for pid in $(pgrep -f "[s]rc/index.ts"); do kill -9 "$pid"; done

pnpm e2e                                    # 전체
npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/flow-k-auth.spec.ts
```
