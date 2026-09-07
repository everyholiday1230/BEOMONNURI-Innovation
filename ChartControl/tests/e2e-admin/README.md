# tests/e2e-admin — 현재 실행할 수 없습니다 (의도된 상태)

이 스위트는 **지금 코드에 존재하지 않는 관리자 앱**을 대상으로 작성됐습니다.

## 무엇이 어긋났는가 (측정값)

| 항목 | 스펙이 기대하는 것 | 지금 코드 |
|---|---|---|
| 앱 패키지 | `@quantumtrade/admin` (build + preview) | **없음** |
| 요소 선택 | `getByTestId` **155곳** | `src/pages-admin.jsx` 의 `data-testid` **0개** |

`playwright.config.ts` 가 없는 패키지를 빌드하려 하므로 두 번째 `webServer` 가 즉시
죽고, Playwright 는 `Process from config.webServer exited early` 로 중단합니다. 즉
**한 번도 실행되지 않습니다.**

## 왜 지우지 않았는가

스펙 7개는 관리자 화면이 **무엇을 해야 하는지에 대한 기록**입니다(주문 조회, AI 운영,
게이트웨이, 반응형·접근성 등). 지우면 그 기록이 사라집니다.

## 왜 그냥 두지도 않았는가

`pnpm e2e:admin` 이 존재하면 커버리지가 있는 것처럼 보입니다. 실제로는 0입니다.
**있는 척하는 검증이 없는 검증보다 위험합니다** — 그래서 실행 시 이유를 말하고
즉시 멈추도록 했습니다.

## 되살리려면

1. `src/pages-admin*.jsx` 를 role/label 기준으로 검증할 수 있게 하거나(권장 — 접근성과
   테스트가 같은 것을 본다), 필요한 곳에 `data-testid` 를 넣는다.
2. `playwright.config.ts` 의 두 번째 `webServer` 를 제거하고 `BASE_URL` 을 API 서버로
   맞춘다. `tests/e2e` 와 `tests/e2e-mfa` 가 이미 그렇게 고쳐져 있으니 그 형태를 따른다.
3. 스펙을 하나씩 현재 화면에 맞게 옮긴다.

`tests/e2e-mfa` 가 같은 문제를 겪었고 다시 써서 되살렸습니다(6개 통과). 참고 사례로
쓰십시오. 다만 admin 은 155곳이라 규모가 다릅니다.

## 대신 무엇이 관리자 기능을 검증하는가

서버 API 수준에서 검증됩니다 — `apps/api/src/__tests__/admin-api.test.ts` 41개,
`admin-security-api.test.ts` 60개. **화면이 아니라 API 계약**을 봅니다. 권한, 감사기록,
낙관적 잠금 같은 성질은 여기서 지켜집니다. 비어 있는 것은 **화면 조작 경로**입니다.
