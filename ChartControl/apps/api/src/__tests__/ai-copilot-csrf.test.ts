import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

/*
   ★★ **AI 가 403 으로 아예 안 됐다.** 이 회귀를 잠근다.

     증상: 로그인은 되어 있는데 `/api/ai/copilot` 이 403(CSRF_FAILED)만 돌려줬다.
     다른 기능은 전부 멀쩡했다.

     원인: `sendJSON` 은 두 가지를 한다 —
       1) CSRF 토큰이 없으면 먼저 `auth.csrf()` 로 받아온다
       2) 403 이 오면 한 번 갱신하고 재시도한다 (세션은 살아있고 토큰만 만료된 경우)

     그런데 `aiCopilotStream` 은 스트리밍 때문에 fetch 를 **직접** 쓰면서 그 둘을 모두
     놓쳤다. `if (csrfToken) headers[...] = csrfToken` — 있으면 붙이고 없으면 그냥 보냈다.

       · 새로고침 직후 첫 질문 → 토큰 없음 → 헤더 없이 전송 → 403
       · 오래 켜 둔 탭      → 토큰 만료 → 403, 재시도 없음 → 계속 실패

     서버 판정은 `originAllowed(...) && verifyCsrf(...)` 이고 토큰이 없으면 거짓이다.

   ★ 스트리밍 경로가 공통 경로(sendJSON)를 우회할 때 이런 누락이 생긴다. 우회 자체는
     필요하지만(SSE 를 sendJSON 으로 못 읽는다), 그때 무엇을 잃는지 확인해야 한다.
*/
describe('AI 코파일럿 스트림 — CSRF 를 준비하고 만료 시 재시도한다', () => {
  const src = () => read('../../../../src/api-client.js');

  it('토큰이 없으면 먼저 받아온 뒤 보낸다', () => {
    const s = src();
    const at = s.indexOf('aiCopilotStream:');
    expect(at, 'aiCopilotStream 이 없다').toBeGreaterThan(0);
    /* 함수 본문만 본다 — 다음 최상위 메서드 앞까지. */
    const body = s.slice(at, s.indexOf('\n    redeemPoints:', at));
    expect(body, 'CSRF 토큰을 미리 받아오지 않는다 — 새로고침 직후 첫 질문이 403 이 된다')
      .toMatch(/if\s*\(!csrfToken\)[\s\S]{0,200}auth\.csrf\(\)/);
  });

  it('403 이면 토큰을 갱신하고 한 번 재시도한다', () => {
    const s = src();
    const at = s.indexOf('aiCopilotStream:');
    const body = s.slice(at, s.indexOf('\n    redeemPoints:', at));
    expect(body, '403 재시도가 없다 — 토큰 만료 후 계속 실패한다')
      .toMatch(/res\.status\s*===\s*403[\s\S]{0,160}auth\.csrf\(\)/);
  });

  /*
     ★★ 무한 재시도를 막는지 확인한다. 서버가 정말로 거부할 때(권한 없음 등) 재시도를
       반복하면 요청이 증폭된다.
  */
  it('재시도는 한 번만 한다', () => {
    const s = src();
    const at = s.indexOf('aiCopilotStream:');
    const body = s.slice(at, s.indexOf('\n    redeemPoints:', at));
    expect(body, '재시도 여부를 추적하지 않는다 — 무한 재시도가 될 수 있다')
      .toMatch(/!retried/);
  });

  /*
     ★ 옛 구현으로 되돌아가지 않았는지. 토큰을 조건부로만 붙이고 준비를 안 하는 형태다.
  */
  it('옛 구현(준비 없이 바로 fetch)으로 되돌아가지 않았다', () => {
    const s = src();
    const at = s.indexOf('aiCopilotStream:');
    const body = s.slice(at, s.indexOf('\n    redeemPoints:', at));
    /* 옛 코드: 함수 시작 직후 곧바로 fetch('/api/ai/copilot' 을 호출했다. */
    const head = body.slice(0, body.indexOf('function send('));
    expect(head, '준비 단계 없이 바로 fetch 를 호출한다').not.toMatch(/fetch\('\/api\/ai\/copilot'/);
  });

  /*
     ★★ 중단(abort)을 오류로 보고하지 않는지 확인한다.

       고객이 답변을 멈추면 fetch 가 reject 되는데, 그것을 네트워크 오류로 띄우면
       "내가 멈췄는데 왜 오류가 뜨나" 가 된다.
  */
  it('사용자 중단을 오류로 보고하지 않는다', () => {
    const s = src();
    const at = s.indexOf('aiCopilotStream:');
    const body = s.slice(at, s.indexOf('\n    redeemPoints:', at));
    expect(body, '중단 여부를 구분하지 않는다').toMatch(/aborted/);
  });
});
