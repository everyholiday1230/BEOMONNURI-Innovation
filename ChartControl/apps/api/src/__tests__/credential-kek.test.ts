import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertProductionSigningKeys } from '../env';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   거래소 자격증명 암호화 키(KEK).

   ★★ 무엇이 잘못돼 있었는가

     `CREDENTIAL_KEK` 미설정 시 코드가 `Buffer.alloc(32, 7)` — 전 바이트 0x07 — 로
     폴백했다. 그 값은 소스에 적혀 있으므로 **공개된 키**다. 데이터베이스를 읽을 수
     있는 사람은 누구나 고객의 거래소 API 키를 복호화할 수 있다.

     운영에서 실제로 그 상태였다: 환경변수가 없었고 활성 자격증명 3건(고객 3명)이
     그 키로 감싸져 있었다.

   ★★ 순서가 중요하다

     KEK 를 먼저 바꾸면 옛 KEK 로 감싼 DEK 를 풀 수 없다. 고객의 키가 살아 있는데 우리가
     쓸 수 없고, 고객은 거래소에서 키를 새로 만들어야 한다 — 그냥 이탈한다. 그래서
     재래핑 스크립트가 먼저 있어야 하고, 그 존재를 이 검사가 확인한다.
*/

const KEK32 = Buffer.alloc(32, 1).toString('base64');
/*
   ★ MFA_KEK 도 fail-closed 목록에 추가됐다(TOTP 시드 래핑 키 — CREDENTIAL_KEK 와
     같은 부류의 결함이었다). 이 파일은 CREDENTIAL_KEK 를 검사하므로 MFA_KEK 는
     유효한 값으로 고정해 둔다. 그러지 않으면 모든 통과 사례가 MFA_KEK 때문에 실패한다.
*/
const base = {
  NODE_ENV: 'production',
  AUTH_CSRF_KEY: 'x'.repeat(40),
  MFA_KEK: Buffer.alloc(32, 3).toString('base64'),
} as NodeJS.ProcessEnv;

describe('CREDENTIAL-KEK — 공개된 고정 키로 고객 자격증명을 감싸지 않는다', () => {
  it('[1] 운영에서 KEK 가 없으면 부팅을 거부한다', () => {
    /*
       ★★ 조용히 약한 키로 도는 것보다 서지 않는 편이 안전하다. 서지 않으면 사람이
         알아채고, 조용히 돌면 아무도 모른다 — 실제로 아무도 몰랐다.
    */
    expect(() => assertProductionSigningKeys(base, true)).toThrow(/CREDENTIAL_KEK/);
  });

  it('[2] 32바이트가 아니면 거부한다', () => {
    /*
       ★ AES-256-GCM 은 32바이트만 받는다. 짧은 값을 넣으면 부팅은 되고 **암호화 시점에**
         터진다 — 고객이 키를 등록하는 순간이다. 부팅에서 막는다.
    */
    for (const bad of ['dG9vc2hvcnQ=', Buffer.alloc(16, 1).toString('base64'), 'not-base64!!']) {
      expect(() => assertProductionSigningKeys({ ...base, CREDENTIAL_KEK: bad }, true),
        `${bad} 가 통과했다`).toThrow(/CREDENTIAL_KEK/);
    }
  });

  it('[3] 올바른 KEK 가 있으면 통과한다', () => {
    expect(() => assertProductionSigningKeys({ ...base, CREDENTIAL_KEK: KEK32 }, true)).not.toThrow();
    /* ★ 읽는 쪽이 받는 대안 변수도 검사가 인정해야 한다 — 갈라지면 부팅이 거부된다. */
    expect(() => assertProductionSigningKeys({ ...base, BITMART_DEV_KEK: KEK32 }, true)).not.toThrow();
  });

  it('[4] 개발에서는 막지 않지만 조용하지도 않다', () => {
    /*
       ★ 개발 편의를 위해 폴백은 남긴다. 다만 **경고를 남긴다** — 조용한 폴백이
         이 문제의 원인이었다.
    */
    expect(() => assertProductionSigningKeys(base, false)).not.toThrow();
    const idx = read('apps/api/src/index.ts');
    const at = idx.indexOf('Buffer.alloc(32, 7)');
    expect(at, '폴백을 찾지 못했다').toBeGreaterThan(0);
    const seg = idx.slice(Math.max(0, at - 200), at + 700);
    expect(seg, '폴백이 조용하다 — 경고가 없다').toMatch(/console\.warn/);
    expect(seg, '경고가 공개된 키라는 사실을 말하지 않는다').toMatch(/공개된/);
  });

  it('[5] 재래핑 스크립트가 있고, 기본이 dry-run 이다', () => {
    /*
       ★★ KEK 교체 전에 기존 자격증명을 재래핑해야 한다. 스크립트가 없으면 검사만
         켜지고 운영은 부팅하지 못하는 상태가 된다.

       ★ 기본이 dry-run 이어야 한다. 실수로 한 번 돌려서 쓰기가 일어나면 되돌리기 어렵다.
    */
    const src = read('apps/api/scripts/rewrap-credentials.mts');
    expect(src).toMatch(/CredentialVault/);
    expect(src).toMatch(/rotate/);
    expect(src, '기본이 dry-run 이 아니다').toMatch(/const DRY = !process\.argv\.includes\('--apply'\)/);
    /* ★ 한 건이라도 실패하면 교체하지 말라고 말해야 한다. */
    expect(src, '부분 실패를 성공으로 보고한다').toMatch(/process\.exit\(1\)/);
    expect(src).toMatch(/KEK 를 교체하지 말 것/);
  });
});
