/**
 * 언어 사전 지연 로드 — 언어 선택이 사라지지 않는지 고정한다.
 *
 * ★★ 무엇을 막는 테스트인가
 *
 *   en·ja·zh 사전을 무조건 세 개 다 싣던 것을 지연 로드로 바꿨다(첫 로드 434 KB 절감).
 *   그런데 `available()` 이 **등록된 사전만** 돌려주면 첫 화면의 언어 목록이 영어 하나가
 *   되고, 순환 버튼에 다른 언어가 나타나지 않아 **일본어·중국어 고객이 자기 언어로 갈
 *   방법이 사라진다.** 실제로 그렇게 될 수 있었고, 그래서 아직 로드되지 않은 언어도
 *   목록에 넣는다.
 *
 * ★ index.html 이 ja·zh 를 다시 정적으로 싣지 않는지도 확인한다 — 늘리면 절감이 사라진다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('언어 사전 지연 로드', () => {
  it('index.html 은 영어만 정적으로 싣는다', () => {
    const html = read('../../../../index.html');
    const tags = html.match(/<script src="src\/locales\/[^"]+"><\/script>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    /* ja·zh 를 정적으로 실으면 절감이 사라진다. */
    const lazy = tags.filter((t) => /\bja\b|\bzh\b/.test(t));
    expect(lazy, `정적으로 실린 지연 대상: ${lazy.join(', ')}`).toEqual([]);
    /* 영어(폴백)는 반드시 정적으로 있어야 한다 — 없으면 첫 화면이 키 문자열이 된다. */
    expect(tags.some((t) => t.includes('locales/en.js'))).toBe(true);
  });

  it('i18n 이 지연 언어의 표시 이름을 사전 없이도 안다', () => {
    const src = read('../../../../src/i18n.js');
    /*
       ★ label 을 모르면 순환 버튼에 코드('ja')가 그대로 찍힌다. 사전보다 먼저
         알아야 하는 값이므로 별도 상수로 둔다.
    */
    expect(src).toContain('LAZY_LOCALE_META');
    expect(src).toMatch(/ja:\s*\{\s*label:\s*'日本語'/);
    expect(src).toMatch(/zh:\s*\{\s*label:\s*'简体中文'/);
  });

  it('available() 이 아직 로드되지 않은 언어도 포함한다', () => {
    const src = read('../../../../src/i18n.js');
    const fn = src.slice(src.indexOf('function available()'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    /* LAZY_LOCALE_META 를 훑지 않으면 목록이 en 하나가 된다. */
    expect(body).toContain('LAZY_LOCALE_META');
    /* keys: 0 으로 미로드 상태를 구분할 수 있어야 한다. */
    expect(body).toMatch(/keys:\s*0/);
  });

  it('setLocale 이 사전 없는 언어를 만나면 내려받기를 건다', () => {
    const src = read('../../../../src/i18n.js');
    const fn = src.slice(src.indexOf('function setLocale(locale)'));
    const body = fn.slice(0, fn.indexOf('\n  function '));
    /*
       ★ 이 호출이 없으면 지연 언어가 "등록되지 않은 언어" 로 취급돼 곧바로 영어로
         정규화된다. 사용자가 일본어를 골라도 영어가 남고 버튼만 JA 가 된다.
    */
    expect(body).toContain('ensureLocaleLoaded');
  });

  it('로드 실패를 조용히 넘기지 않는다', () => {
    const src = read('../../../../src/i18n.js');
    const fn = src.slice(src.indexOf('function ensureLocaleLoaded'));
    const body = fn.slice(0, fn.indexOf('\n  function available'));
    expect(body).toContain('console.warn');
    /* 같은 언어를 두 번 내려받지 않는다. */
    expect(body).toContain("'loading'");
  });
});
