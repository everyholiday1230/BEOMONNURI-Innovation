/*
   포인트 설정 검증 계약 — 빈 unitName 은 허용되어야 한다
   ------------------------------------------------------------
   ★★ 왜 이 검사가 필요한가

     `point_settings.unit_name` 의 빈 문자열은 잘못된 값이 아니라 **의미 있는
     값**이다: "이름을 따로 정하지 않았다 = 각 언어가 자기 기본값을 쓴다".

     이렇게 만든 이유가 있다. 전에는 관리자 화면이 **표시용 문구를 그대로 저장**해서
     저장 시점의 화면 언어를 DB 에 박아버렸다(한국어로 보던 관리자가 저장하자
     '포인트' 가 들어가, 영어·일본어 화면에도 그 단어가 나왔다). 그래서 저장값과
     표시값을 분리하고 저장값은 비울 수 있게 했다.

     그런데 라우트의 검증은 빈 값을 거부하고 있었다. 결과:
     **unit_name 이 '' 인 상태에서는 포인트 제도를 켜거나 끌 수 없었다**
     (제도 중단 버튼이 400 Bad Request). 데이터 모델이 허용하는 값을 API 가
     거부하면, 그 상태에 빠진 운영자는 화면에서 빠져나올 방법이 없다.

     이 결함은 tools/button-probe.mjs 가 잡았다. 사람이 눈으로 보는 검사에서는
     "버튼을 눌렀는데 아무 일도 없다" 로만 보여 놓치기 쉽다.

   ★ 이 검사의 한계를 밝힌다.

     이 파일은 라우트 **소스의 검증 조건**을 본다. 이 테스트 묶음에는 포인트
     저장소를 붙인 HTTP 앱 스캐폴딩이 없어서 요청을 실제로 보내지는 않는다.
     실행 확인은 운영 중인 서버에 직접 요청해서 마쳤다:
       빈 unitName + enabled=false → 200
       빈 unitName + enabled=true  → 200
       25자 unitName               → 400 BAD_REQUEST
     DB 에는 unit_name 이 빈 값으로 유지되었다.
*/

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'admin', 'admin-routes.ts'), 'utf8');

describe('PT-SETTINGS 검증 계약', () => {
  it('[1] 빈 unitName 을 거부하지 않는다', () => {
    /*
       `!unitName` 로 걸러내면 빈 문자열이 막힌다. 그 형태가 다시 들어오면
       제도 켜기/끄기가 400 이 되므로 검사로 고정한다.
    */
    expect(SRC).not.toMatch(/if \(!unitName \|\| unitName\.length > 24\)/u);
    expect(SRC).toMatch(/if \(unitName\.length > 24\)/u);
  });

  it('[2] 길이 상한은 유지한다', () => {
    // 화면에 그려지는 값이므로 길이는 제한해야 한다.
    expect(SRC).toMatch(/unitName\.length > 24/u);
  });

  it('[3] ★ 기본값으로 영어 단어를 넣지 않는다', () => {
    /*
       `body.unitName ?? 'Points'` 였다. 필드를 보내지 않은 요청이 영어 단어를
       DB 에 써 넣어, 저장값에 언어가 박히는 원래 문제가 되돌아온다.
    */
    expect(SRC).not.toMatch(/body\.unitName \?\? 'Points'/u);
    expect(SRC).toMatch(/body\.unitName \?\? ''/u);
  });
});
