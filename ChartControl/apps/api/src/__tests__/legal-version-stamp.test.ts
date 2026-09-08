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
  it('render.yaml 의 LEGAL_VERSION 이 **가장 최근** 문서 시행일 이상이다', async () => {
    /*
       ★★ 이 테스트가 재배포 회귀를 막는다. render.yaml 값이 낡으면 배포가 운영을
         구버전으로 되돌린다 — 실제로 그 상태였다(2026-08-22 vs 운영 2026-09-05b).

       ★★ 왜 "약관 본문과 같다" 가 아니라 "가장 최근 문서 이상" 인가

         LEGAL_VERSION 은 문서 15건 전체에 붙는 **배포 라벨 하나**다. 문서마다 시행일이
         다르므로(약관 2026-09-05, 개인정보 2026-09-08) 어느 한 문서와 같기를 요구하면
         다른 문서를 고칠 때마다 테스트가 틀린 실패를 낸다.

         정말 막아야 하는 것은 **라벨이 문서보다 낡은 상태**다. 그러면 고친 문서가
         게시되지 않고 고객은 옛 문서를 계속 본다 — 지금 개인정보처리방침을 고쳤으므로
         이 규칙이 실제로 걸린다.
    */
    const { readFileSync: rf, readdirSync } = await import('node:fs');
    const yaml = rf(new URL('../../../../render.yaml', import.meta.url), 'utf-8');
    const m = /- key:\s*LEGAL_VERSION\s*(?:\n\s*#[^\n]*)*\n\s*value:\s*"([^"]+)"/.exec(yaml);
    expect(m, 'render.yaml 에 LEGAL_VERSION 선언이 없다').toBeTruthy();
    const label = m![1]!;

    const dir = new URL('../../../../docs/legal/', import.meta.url);
    let newest = '0000-00-00';
    let newestFile = '';
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('draft-') || f === 'README.md') continue;
      const stamp = readBodyVersionStamp(rf(new URL(f, dir), 'utf-8'));
      if (stamp && stamp.isoDate > newest) { newest = stamp.isoDate; newestFile = f; }
    }
    expect(newest, '시행일 표기를 가진 문서가 하나도 없다').not.toBe('0000-00-00');
    expect(
      label >= newest,
      `LEGAL_VERSION="${label}" 이 ${newestFile} 의 시행일 ${newest} 보다 낡았다 — `
      + '고친 문서가 게시되지 않고 고객은 옛 문서를 본다.',
    ).toBe(true);
  });
});
