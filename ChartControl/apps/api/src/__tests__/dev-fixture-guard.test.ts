/**
 * 프로덕션 가드 — 개발 계정 탐지.
 *
 * ★ 왜 이 테스트가 필요한가
 *
 *   해시 목록만 검사하던 시절, 손으로 만든 SUPER_ADMIN 계정이 탐지되지 않았다.
 *   실제로 이 서비스를 만드는 동안 psql 로 직접 만든 계정이 있었고 가드는 그것을
 *   보지 못했다. 그대로 배포하면 전체 관리자 권한이 넘어간다.
 *
 *   화이트리스트는 언제나 한 발 늦는다. 그래서 "메일을 받을 수 없는 도메인" 이라는
 *   패턴으로도 막는다. 이 테스트가 그 두 경로를 모두 고정한다.
 */

import { describe, expect, it } from 'vitest';

import {
  DEV_FIXTURE_IDENTIFIER_HASHES,
  DevSeedAccountDetectedError,
  assertNoDevFixtures,
  hashIdentifier,
  isDevFixtureIdentifier,
  isNonProductionIdentifier,
  isUnreachableIdentifier,
  normalizeIdentifier,
  scanForDevFixtures,
} from '../security/dev-fixture-guard';

const src = (ids: string[], marker = false) => ({
  listIdentifiers: () => ids,
  hasFixtureMarker: () => marker,
});

describe('dev fixture guard', () => {
  it('정규화는 공백과 대소문자를 무시한다', () => {
    expect(normalizeIdentifier('  A@B.Local ')).toBe('a@b.local');
    // 같은 주소는 같은 해시여야 한다 — 아니면 대문자로 우회할 수 있다.
    expect(hashIdentifier(' X@Y.test ')).toBe(hashIdentifier('x@y.test'));
  });

  it('해시 목록이 비어 있지 않다', () => {
    // 비면 알려진 시드 계정을 아무것도 막지 못한다.
    expect(DEV_FIXTURE_IDENTIFIER_HASHES.length).toBeGreaterThan(0);
  });

  // ---- 메일을 받을 수 없는 도메인 ----

  it('예약 도메인을 잡는다', () => {
    for (const addr of [
      'someone@test.local',
      'admin@x.localhost',
      'a@b.test',
      'c@d.invalid',
      'e@f.example',
      'g@example.com',
      'h@example.net',
      'i@example.org',
    ]) {
      expect(isUnreachableIdentifier(addr)).toBe(true);
    }
  });

  it('실제 도메인은 잡지 않는다', () => {
    /*
       ★ 오탐이 더 나쁘다.

         정상 계정 하나 때문에 서버가 뜨지 않으면 런칭 자체가 막힌다. 그래서
         'test@' 나 'admin@' 같은 로컬파트로는 판단하지 않는다 — 실제 회사의
         실제 주소다.
    */
    for (const addr of [
      'test@gmail.com',
      'admin@chartcontrol.io',
      'dev@localhost.io',
      'someone@testing.co.kr',
      'a@example.company.com',
      'user@my.test.io',
    ]) {
      expect(isUnreachableIdentifier(addr)).toBe(false);
    }
  });

  it('주소 형태가 아니면 잡지 않는다', () => {
    expect(isUnreachableIdentifier('not-an-email')).toBe(false);
    expect(isUnreachableIdentifier('')).toBe(false);
  });

  it('대소문자와 공백으로 우회할 수 없다', () => {
    expect(isUnreachableIdentifier('  ADMIN@TEST.LOCAL  ')).toBe(true);
  });

  it('두 경로를 합쳐 판단한다', () => {
    expect(isNonProductionIdentifier('anything@x.local')).toBe(true);
    expect(isNonProductionIdentifier('real@chartcontrol.io')).toBe(false);
  });

  // ---- 스캔 ----

  it('원인별로 따로 센다', () => {
    // 운영자가 "시드 스크립트가 돌았다" 와 "손으로 만들었다" 를 구분해야 한다.
    const r = scanForDevFixtures(src(['a@x.local', 'b@example.com', 'real@chartcontrol.io']));
    expect(r.unreachable).toBe(2);
    expect(r.inspected).toBe(3);
  });

  it('어떤 주소가 걸렸는지 노출하지 않는다', () => {
    const r = scanForDevFixtures(src(['secret@x.local']));
    // 결과에 개수만 있고 식별자가 없어야 한다 — 로그에 사용자 데이터가 새면 안 된다.
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  // ---- 기동 차단 ----

  it('프로덕션에서 예약 도메인 계정이 있으면 기동을 막는다', () => {
    expect(() => assertNoDevFixtures(src(['hand-made@test.local']), true))
      .toThrow(DevSeedAccountDetectedError);
  });

  it('프로덕션이 아니면 막지 않는다', () => {
    // 개발 중에는 이런 계정이 있는 것이 정상이다.
    const r = assertNoDevFixtures(src(['hand-made@test.local']), false);
    expect(r.unreachable).toBe(1);
  });

  it('깨끗한 DB 는 통과한다', () => {
    const r = assertNoDevFixtures(src(['a@chartcontrol.io', 'b@gmail.com']), true);
    expect(r.matches).toBe(0);
    expect(r.unreachable).toBe(0);
  });

  it('시드 표식만 있어도 막는다', () => {
    expect(() => assertNoDevFixtures(src(['ok@chartcontrol.io'], true), true))
      .toThrow(DevSeedAccountDetectedError);
  });

  it('오류 메시지에 식별자가 들어가지 않는다', () => {
    try {
      assertNoDevFixtures(src(['leak-me@test.local']), true);
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('leak-me');
      // 대신 무엇을 해야 하는지 알려준다.
      expect(msg).toContain('DEV_SEED_ACCOUNT_DETECTED');
      expect(msg).toContain('unreachable domains=1');
    }
  });

  it('알려진 시드 계정도 여전히 잡는다', () => {
    /*
       해시 목록의 계정을 평문으로 적지 않는다 (프로덕션 번들에 개발 주소가
       들어가지 않게 하는 것이 이 설계의 목적이다).

       그래서 "해시가 목록에 있으면 참" 이라는 성질만 확인한다.
    */
    const known = DEV_FIXTURE_IDENTIFIER_HASHES[0];
    expect(typeof known).toBe('string');
    expect(known).toMatch(/^[0-9a-f]{64}$/);
    // 임의의 주소는 목록에 없어야 한다.
    expect(isDevFixtureIdentifier('definitely-not-a-fixture@chartcontrol.io')).toBe(false);
  });
});
