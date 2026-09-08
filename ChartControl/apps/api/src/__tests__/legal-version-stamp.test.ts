/**
 * 법적 문서 버전 라벨 — 본문 표기와 배포 라벨의 어긋남을 잡는다.
 *
 * ★★ 무엇이 문제였나
 *
 *   동의 기록의 버전은 배포 환경변수(LEGAL_VERSION)에서 온다. 그런데 문서 본문에는
 *   자기 시행일·판번호가 따로 적혀 있다. 실제로 `render.yaml` 은 `2026-08-22` 였고
 *   운영은 `2026-09-05b` 였다 — 재배포하면 운영이 **구버전으로 되돌아가고**, 이미
 *   신버전에 동의한 고객이 구버전 재동의 대상으로 잡힌다.
 *
 * ★ 게시를 거부하지는 않는다. 문서마다 시행일이 다르고(약관 9/5, 개인정보 8/10)
 *   일부는 표기가 아예 없어 단일 라벨과 전부 일치시킬 수 없다. 드러내고 넘어간다.
 */
import { describe, it, expect } from 'vitest';
import { readBodyVersionStamp } from '../legal/seed-legal.js';

describe('본문 버전 표기 읽기', () => {
  it('영어 표기를 읽는다', () => {
    const r = readBodyVersionStamp('# Terms\n\nEffective: 5 September 2026 · Version 1.1\n\n본문');
    expect(r?.isoDate).toBe('2026-09-05');
    expect(r?.raw).toContain('Version 1.1');
  });

  it('한 자리 날짜와 두 자리 날짜를 모두 읽는다', () => {
    expect(readBodyVersionStamp('Effective: 5 September 2026 · Version 1.1')?.isoDate).toBe('2026-09-05');
    expect(readBodyVersionStamp('Effective: 10 August 2026 · Version 1.0')?.isoDate).toBe('2026-08-10');
  });

  it('중국어 표기를 읽는다', () => {
    const r = readBodyVersionStamp('# 服务条款\n\n生效日期：2026 年 9 月 5 日 · 版本 1.1\n');
    expect(r?.isoDate).toBe('2026-09-05');
  });

  it('표기가 없으면 null — 없는 것을 오늘 날짜로 바꾸지 않는다', () => {
    expect(readBodyVersionStamp('# Refund Policy\n\n환불은 …')).toBeNull();
    expect(readBodyVersionStamp('')).toBeNull();
  });

  it('배포 라벨이 접미사를 가져도 같은 날짜면 어긋남이 아니다', () => {
    /*
       운영은 `2026-09-05b` 를 쓴다 — 같은 날 문구를 다시 고칠 때 접미사를 붙인다.
       그래서 startsWith 로 비교한다. 여기서 그 규칙을 고정한다.
    */
    const stamp = readBodyVersionStamp('Effective: 5 September 2026 · Version 1.1');
    expect('2026-09-05b'.startsWith(stamp!.isoDate)).toBe(true);
    expect('2026-08-22'.startsWith(stamp!.isoDate)).toBe(false);
  });
});

describe('render.yaml 과 문서 본문', () => {
  it('render.yaml 의 LEGAL_VERSION 이 약관 본문 시행일과 맞는다', async () => {
    /*
       ★★ 이 테스트가 재배포 회귀를 막는다. render.yaml 값이 낡으면 배포가 운영을
         구버전으로 되돌린다 — 실제로 그 상태였다.
    */
    const { readFileSync } = await import('node:fs');
    const yaml = readFileSync(new URL('../../../../render.yaml', import.meta.url), 'utf-8');
    /*
       ★ `key: LEGAL_VERSION` 선언만 본다. 설명 주석에도 LEGAL_VERSION 이라는 말이
         나오므로 느슨하게 찾으면 엉뚱한 value 를 잡는다(실제로 "true" 를 잡았다).
    */
    const m = /- key:\s*LEGAL_VERSION\s*(?:\n\s*#[^\n]*)*\n\s*value:\s*"([^"]+)"/.exec(yaml);
    expect(m, 'render.yaml 에 LEGAL_VERSION 이 없다').toBeTruthy();

    const terms = readFileSync(new URL('../../../../docs/legal/terms-en.md', import.meta.url), 'utf-8');
    const stamp = readBodyVersionStamp(terms);
    expect(stamp, 'terms-en.md 에 시행일 표기가 없다').toBeTruthy();
    expect(m![1]!.startsWith(stamp!.isoDate)).toBe(true);
  });
});
