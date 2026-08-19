/*
   KuCoin Fast API (OAuth) — 상태 검증과 fail-closed
   ------------------------------------------------------------
   왜 이 검사가 필요한가

   ★★ state 검증이 이 기능의 유일한 방어다.

     콜백은 KuCoin 이 이용자의 브라우저를 보내는 주소이므로 CSRF 토큰을 받을 수
     없다. state 를 검증하지 않으면 공격자가 자기 KuCoin 계정으로 인증한 뒤 그
     콜백 주소를 피해자에게 열게 해서 **피해자 계정에 공격자의 거래소 키를
     연결**할 수 있다. 그 뒤 피해자가 내는 주문은 공격자 계정에서 실행된다.

     그래서 아래 네 가지가 하나라도 느슨해지면 그 자체가 계정 탈취 경로다.
       · 위조한 state 는 거부
       · 같은 state 는 두 번 쓸 수 없다
       · 만료된 state 는 거부
       · 다른 세션에서 시작한 state 는 거부

   ★ 이 검사는 순수 함수와 상태 규칙만 본다. KuCoin 과의 왕복은 client_id 가
     없어 확인할 수 없다(그 한계는 라우터 파일 머리에 적어 두었다).
*/

import { describe, it, expect } from 'vitest';
import { isKucoinOauthConfigured } from '../kucoin-oauth-routes';

describe('KUCOIN-OAUTH 설정 판정 (fail-closed)', () => {
  it('[C1] 둘 다 있어야 켜진다', () => {
    expect(isKucoinOauthConfigured({ kucoinOauthClientId: 'abc', kucoinOauthRedirectUri: 'https://x/cb' })).toBe(true);
  });

  it('[C2] ★ 하나라도 없으면 꺼진다 — 반쯤 설정된 상태로 켜지 않는다', () => {
    /*
       반쯤 설정된 채로 켜면 이용자가 KuCoin 승인 화면까지 갔다가 콜백에서
       실패하고, 그 사이 KuCoin 계정에는 우리 이름의 키가 만들어져 남는다.
       "있는데 안 되는" 상태보다 "없는" 상태가 낫다.
    */
    expect(isKucoinOauthConfigured({ kucoinOauthClientId: '', kucoinOauthRedirectUri: 'https://x/cb' })).toBe(false);
    expect(isKucoinOauthConfigured({ kucoinOauthClientId: 'abc', kucoinOauthRedirectUri: '' })).toBe(false);
    expect(isKucoinOauthConfigured({ kucoinOauthClientId: '', kucoinOauthRedirectUri: '' })).toBe(false);
  });
});

describe('KUCOIN-OAUTH state 소비 규칙 (SQL 계약)', () => {
  /*
     실제 DB 없이도 고정해야 하는 것: state 를 소비하는 SQL 이 세 조건을 모두
     담고 있는지. 하나라도 빠지면 재사용·만료 우회가 가능해진다.

     ★ 소스를 읽어 확인한다. 조건을 나중에 누가 지우면 이 검사가 실패한다.
       (실행 검증은 실서버에서 4가지 공격 시나리오로 확인했다:
        위조 state → invalid_state / 재사용 → invalid_state /
        다른 세션 → session_mismatch / 파라미터 없음 → missing_params)
  */
  it('[S1] UPDATE 로 원자적으로 소비하며 used_at·expires_at 을 함께 확인한다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'kucoin-oauth-routes.ts'),
      'utf8',
    );

    /*
       ★ 조회 후 갱신을 따로 하면 그 사이에 같은 state 로 두 번 들어올 수 있다.
         UPDATE … RETURNING 한 번으로 처리해야 두 번째 요청이 아무 행도 받지 못한다.
    */
    expect(src).toMatch(/UPDATE kucoin_oauth_states/u);
    expect(src).toMatch(/SET used_at = now\(\)/u);
    expect(src).toMatch(/used_at IS NULL/u);      // 재사용 차단
    expect(src).toMatch(/expires_at > now\(\)/u); // 만료 차단
    expect(src).toMatch(/RETURNING user_id, session_hash/u);

    // 세션 지문 비교가 남아 있어야 한다(state 를 훔쳐 다른 브라우저에서 여는 것 차단).
    expect(src).toMatch(/session_hash !== sessionHash\(c\)/u);
  });

  it('[S2] ★★ 출금 권한을 요구하지 않는다', () => {
    /*
       우리는 자금을 보관하지 않고 입출금을 취급하지 않는다(이용약관 제2조).
       이 값이 true 로 바뀌면 약관과 정면으로 어긋나고, 우리 서버가 침해될 때
       피해가 이용자 자산 전체로 번진다. 그래서 코드에 고정하고 검사로 묶는다.
    */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'kucoin-oauth-routes.ts'),
      'utf8',
    ) as string;
    expect(src).toMatch(/API_WITHDRAW_OAUTH:\s*false/u);
    expect(src).not.toMatch(/API_WITHDRAW_OAUTH:\s*true/u);
    // 이체·마진·예치도 요구하지 않는다(제공하지 않는 기능이다).
    expect(src).toMatch(/API_TRANSFER:\s*false/u);
    expect(src).toMatch(/API_MARGIN:\s*false/u);
    expect(src).toMatch(/API_EARN:\s*false/u);
  });

  it('[S3] 토큰을 저장하지 않는다', () => {
    /*
       우리 용도는 키를 한 번 발급받는 것이다. 발급 후 토큰은 필요하지 않으므로
       저장하지 않는다 — 리프레시 토큰을 3일간 들고 있는 편이 훨씬 위험하다.
    */
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'kucoin-oauth-routes.ts'),
      'utf8',
    ) as string;
    // 토큰을 DB 에 넣는 문장이 없어야 한다.
    expect(src).not.toMatch(/INSERT[\s\S]{0,200}(access_token|refresh_token)/u);
    expect(src).not.toMatch(/refresh_token/u);
  });
});
