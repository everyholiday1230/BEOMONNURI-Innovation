import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RegisterInputSchema } from '@quantumtrade/auth';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   가입 시 국가.

   ★★ 고치기 전 상태: 묻고서 듣지 않는 입력

     가입 화면에는 국가 선택 칸이 있었고 목록도 195개국이었다. 클라이언트도 그 값을
     `register(email, pw, { country })` 로 서버에 보냈다. 그런데

       · RegisterInputSchema 가 email·password 만 통과시켜 country 를 버렸고
       · service.register() 가 User 객체에 country 를 넣지 않았고
       · users 테이블에 컬럼조차 없었다(실 Postgres 확인)

     즉 고객이 고른 값이 **어디에도 남지 않았다.** 화면은 물어보고, 우리는 듣지
     않았다. 죽은 버튼을 만들지 않는다는 규칙이 입력에도 그대로 적용된다.

   ★★ 초기값 'KR' 하드코딩

     선택 칸의 초기값이 `'KR'` 로 박혀 있었다. 그건 선택이 아니라 가정이다 —
     한국어를 UI 에서 뺀 뒤에도 모든 신규 가입자가 한국으로 기록될 상태였다.
     나중에 국가별 평균이나 언어 확장을 판단하려면 그 값은 쓸 수 없다.

   ★★ 추정과 선언을 구분한다

     브라우저 언어·시간대로 추정해 미리 채우면 편하지만, 그 값과 사용자가 직접 고른
     값은 사실의 성질이 다르다. country_source('user' | 'inferred') 로 나눠 저장한다.
     추정치를 선언으로 취급하면 나중에 숫자가 조용히 왜곡된다.

   ★ 실측으로 확인한 것(실 Postgres + 브라우저)
       · 직접 선택 → country=BR, source=user
       · 독일 로케일로 두고 방치 → country=DE, source=inferred
       · 소문자 'kr', 3글자 'KOR', 잘못된 source 는 DB CHECK 제약이 거부
       · 검색 196개 → 'germ' 1개, 코드 'BR' 로도 찾힘, 없는 검색어는 이유를 표시
*/
describe('SIGNUP-COUNTRY — 고른 국가가 실제로 저장된다', () => {
  it('[1] 스키마가 country 를 받는다 — 예전에는 버렸다', () => {
    const ok = RegisterInputSchema.safeParse({
      email: 'a@example.com', password: 'a-long-password-1', country: 'KR', countrySource: 'user',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.country).toBe('KR');
      expect(ok.data.countrySource).toBe('user');
    }
  });

  it('[2] 국가는 선택 항목이다 — 없다고 가입이 막히면 안 된다', () => {
    /*
       ★ 국가를 고르지 않아 계정을 만들 수 없다면 그 손해가 이 정보의 가치보다 크다.
    */
    const r = RegisterInputSchema.safeParse({ email: 'a@example.com', password: 'a-long-password-1' });
    expect(r.success).toBe(true);
  });

  it('[3] 소문자·3글자 코드는 정규화되거나 거부된다', () => {
    // 소문자는 대문자로 정규화한다 — 저장 모양이 하나여야 집계가 깨지지 않는다.
    const lower = RegisterInputSchema.safeParse({
      email: 'a@example.com', password: 'a-long-password-1', country: 'kr',
    });
    expect(lower.success).toBe(true);
    if (lower.success) expect(lower.data.country).toBe('KR');

    // 3글자는 ISO alpha-2 가 아니다.
    const three = RegisterInputSchema.safeParse({
      email: 'a@example.com', password: 'a-long-password-1', country: 'KOR',
    });
    expect(three.success).toBe(false);
  });

  it('[4] OTHER 는 허용한다 — 목록에 없는 나라를 막지 않는다', () => {
    const r = RegisterInputSchema.safeParse({
      email: 'a@example.com', password: 'a-long-password-1', country: 'OTHER',
    });
    expect(r.success).toBe(true);
  });

  it('[5] countrySource 는 두 값만 받는다', () => {
    const bad = RegisterInputSchema.safeParse({
      email: 'a@example.com', password: 'a-long-password-1', country: 'KR', countrySource: 'guessed',
    });
    expect(bad.success).toBe(false);
  });

  it('[6] 저장 경로가 두 백엔드 모두에 배선돼 있다', () => {
    /*
       ★★ 한쪽만 고치면 배포에 따라 저장되고 안 되고가 갈린다. 실제로 이 프로젝트가
         겪은 실패 방식이다(주문 카운트가 SQLite 만 세어 Postgres 배포에서 0이었다).
    */
    for (const p of ['apps/api/src/db/pg-repos.ts', 'apps/api/src/db/repos.ts']) {
      const src = read(p);
      expect(src, `${p}: INSERT 에 country 가 없다`).toMatch(/country,country_source/);
      expect(src, `${p}: 읽기 매핑에 country 가 없다`).toMatch(/country: row\.country \?\? null|country: r\.country \?\? null/);
    }
    // 서비스가 User 객체에 넣어야 저장 경로에 도달한다 — 스키마만 고쳐도 부족하다.
    const svc = read('packages/auth/src/service.ts');
    expect(svc).toMatch(/country: parsed\.data\.country \?\? null/);
  });

  it('[7] 근거를 모르면 inferred 로 본다 — 직접 골랐다고 단정하지 않는다', () => {
    const svc = read('packages/auth/src/service.ts');
    /*
       ★★ 사용자가 골랐다고 단정하는 쪽이 위험하다. 나중에 국가별 평균을 낼 때
         추정치가 선언으로 섞인다.
    */
    expect(svc).toMatch(/countrySource: parsed\.data\.country/);
    expect(svc).toMatch(/\?\? 'inferred'/);
  });

  it('[8] 초기값 하드코딩이 없다', () => {
    const page = read('src/pages-auth.jsx');
    /*
       ★★ `country: 'KR'` 은 선택이 아니라 가정이었다. 한국어를 UI 에서 뺀 뒤에도
         모든 신규 가입자가 한국으로 기록될 상태였다.
    */
    expect(page).not.toMatch(/country: 'KR'/);
    expect(page).toMatch(/country: guessCountry\(\)/);
  });

  it('[9] 검색 가능한 선택기이고 역할이 선언돼 있다', () => {
    const page = read('src/pages-auth.jsx');
    /*
       ★★ 195개를 기본 select 로 두면 스크롤로 찾아야 한다. 나라 이름이 보는 사람의
         언어로 번역되므로 정렬도 언어마다 달라 더 어렵다.

       ★ 역할을 선언해야 키보드·스크린리더 사용자가 쓸 수 있다. 마우스로만 되는
         선택기는 이 화면을 못 쓰게 만든다.
    */
    expect(page).toMatch(/role="combobox"/);
    expect(page).toMatch(/role="listbox"/);
    expect(page).toMatch(/role="option"/);
    expect(page).toMatch(/aria-expanded=\{open\}/);
    // 키보드 조작.
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      expect(page, `${key} 처리가 없다`).toContain(`'${key}'`);
    }
  });

  it('[10] 코드로도 검색된다', () => {
    const page = read('src/pages-auth.jsx');
    /*
       ★ 'KR' 을 입력하는 사람도 있고, 번역된 이름을 모르는 경우도 있다
         (중국어 화면에서 독일을 찾을 때).
    */
    expect(page).toMatch(/c\.toLowerCase\(\)\.includes\(needle\)/);
  });

  it('[11] 결과가 없으면 이유를 말한다 — 빈 상자는 고장으로 읽힌다', () => {
    const page = read('src/pages-auth.jsx');
    expect(page).toMatch(/country_no_match/);
  });

  it('[12] 추정값임을 화면에서 밝힌다', () => {
    const page = read('src/pages-auth.jsx');
    /*
       ★★ 미리 채워 두고 아무 말도 하지 않으면 사용자는 자기가 고른 것으로 착각한다.
         확인해 달라고 말해야 이 데이터를 나중에 신뢰할 수 있다.
    */
    expect(page).toMatch(/form\.countrySource === 'inferred'/);
    expect(page).toMatch(/country_guessed/);
  });

  it('[13] 새 문구가 남아 있는 모든 언어에 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${loc}.js`);
      for (const key of ['country_search_ph', 'country_search_open', 'country_no_match', 'country_guessed']) {
        expect(src, `${loc} 에 ${key} 가 없다`).toContain(`${key}: '`);
      }
    }
  });

  it('[14] 목록이 100개를 넘는다', () => {
    const page = read('src/pages-auth.jsx');
    const start = page.indexOf('const COUNTRY_CODES');
    const end = page.indexOf('.split(', start);
    const codes = (page.slice(start, end).match(/\b[A-Z]{2}\b/g) ?? []).filter((c) => c !== 'AD' || true);
    expect(codes.length).toBeGreaterThan(100);
  });

  it('[15] DB 제약이 값의 모양을 지킨다 — 코드가 바뀌어도 집계가 깨지지 않게', () => {
    const sql = read('infrastructure/postgres/0042_user_country.postgres.sql');
    expect(sql).toMatch(/CHECK \(country IS NULL OR country = 'OTHER' OR country ~ '\^\[A-Z\]\{2\}\$'\)/);
    expect(sql).toMatch(/country_source IN \('user', 'inferred'\)/);
  });
});
