import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   감사에서 나온 P1 항목들.

   ★★ 공통점: **화면이나 로그가 사실과 다르게 말한다.**

     방향이 항상 롱으로 보이고, 레이트리밋이 없는데 다른 경로에는 있어서 있다고 믿고,
     킬스위치를 못 읽었는데 "enforced" 라고 찍고, 일일 손실 한도가 자기 신고 기반인데
     그 말이 없다. 전부 "믿었는데 아니었다" 유형이다.
*/

describe('AUDIT-P1 — 화면과 로그가 사실을 말한다', () => {
  it('[1] AI 신호 방향이 하드코딩되지 않는다', () => {
    /*
       ★★ `▲ LONG` 이 고정돼 있어 **숏 신호도 롱으로 표시**됐다. 고객이 방향을 반대로
         읽고 그 상태에서 주문 초안을 만든다. 초안은 서버가 준 방향으로 만들어지므로
         화면과 주문이 어긋난 채 확인 절차가 진행된다.
    */
    const src = read('src/ai-copilot.jsx');
    /* 주석은 제외 — 왜 고쳤는지 설명하려면 옛 문자열을 언급해야 한다. */
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, '방향이 여전히 하드코딩이다').not.toMatch(/badge--long">▲ LONG/);
    expect(code, '방향을 신호에서 읽지 않는다').toMatch(/signal\.direction/);
    /* ★ 색과 화살표도 방향을 따라야 한다 — 초록 위쪽 화살표가 숏에 붙으면 글자를 안 읽는다. */
    expect(code).toMatch(/badge--\$\{signal\.direction\}/);
    /* ★ JSX 텍스트로 들어가므로 따옴표가 없다. 중립 표시가 있는지만 본다. */
    expect(code, '방향이 없을 때 롱으로 단정한다').toMatch(/>—<\/span>/);
  });

  it('[2] 실주문 제출에 레이트리밋이 있다', () => {
    /*
       ★★ 관리자·MFA·주문검증에는 전달되는데 **제출만 빠져** 있었다. 가장 위험한 경로가
         가장 열려 있었다 — 멱등키가 다르면 반복 요청이 각각 별개 주문이 된다.
    */
    const routes = read('apps/api/src/trading-routes.ts');
    expect(routes, '레이트리미터를 받지 않는다').toMatch(/rateLimiter\?:/);
    const at = routes.indexOf("app.post('/trading/orders/submit'");
    expect(at, '제출 라우트가 없다').toBeGreaterThan(0);
    const next = routes.indexOf('app.post(', at + 10);
    const seg = routes.slice(at, next > 0 ? next : routes.length);
    expect(seg, '제출 라우트에 제한이 없다').toMatch(/rateLimiter/);
    /* ★ 사용자 기준이어야 한다. IP 로 세면 같은 사무실의 두 사람이 서로를 막는다. */
    expect(seg, 'IP 기준으로 센다').toMatch(/order-submit:user:/);
    /* ★ 언제 다시 시도할 수 있는지 말해야 한다. */
    expect(seg).toMatch(/Retry-After/);

    const idx = read('apps/api/src/index.ts');
    /*
       ★ 이 호출은 매우 길다(어댑터·게이트·정책이 전부 들어간다). 고정 길이로 자르면
         뒤쪽 인자를 놓친다 — 처음엔 1600자로 잡아 실제로 놓쳤다. 호출이 닫히는
         `\n        }),` 까지 잡는다.
    */
    const callAt = idx.indexOf('createTradingRouter({');
    const callEnd = idx.indexOf('\n        }),', callAt);
    expect(callEnd, 'createTradingRouter 호출의 끝을 찾지 못했다').toBeGreaterThan(callAt);
    const callSeg = idx.slice(callAt, callEnd);
    expect(callSeg, '레이트리미터를 전달하지 않는다').toMatch(/rateLimiter,/);
    expect(callSeg, '주문 제한 건수를 전달하지 않는다').toMatch(/orderRatePerMin/);
  });

  it('[3] 운영 스위치를 못 읽으면 조용하지 않다', () => {
    /*
       ★★ `catch { }` 였다. 첫 로드가 실패하면 loaded 가 false 로 남고 모든 판정이
         **기본값(허용)** 이 된다 — 킬스위치가 꺼진 것처럼 동작하는데 로그에 흔적이 없다.
         운영자는 걸어 두었다고 믿는다.
    */
    const ctl = read('apps/api/src/ops/operational-controls.ts');
    expect(ctl, '실패를 조용히 삼킨다').not.toMatch(/\} catch \{\s*\/\/[^\n]*\n\s*\}/);
    expect(ctl, '실패를 알리지 않는다').toMatch(/console\.error/);
    /* ★ 첫 실패와 이후 실패는 심각도가 다르다. */
    expect(ctl).toMatch(/failures/);
    expect(ctl, '로드 성공 여부를 알려주지 않는다').toMatch(/isLoaded\(\)/);

    /* ★ 부팅 로그가 "enforced" 라고 단정하면 안 된다 — 못 읽었을 수 있다. */
    const idx = read('apps/api/src/index.ts');
    const at = idx.indexOf('operationalControls.start()');
    const seg = idx.slice(at, at + 1200);
    expect(seg, '로드 여부를 확인하지 않고 enforced 라고 말한다').toMatch(/isLoaded\(\)/);
    expect(seg, '못 읽은 경우를 알리지 않는다').toMatch(/NOTHING WAS READ/);
  });

  it('[4] 일일 손실 한도의 출처를 숨기지 않는다', () => {
    /*
       ★★ 판정 근거가 **고객이 손으로 적는 거래 저널**이다. 거래소 원장이 아니다.
         적지 않은 손실은 한도에 반영되지 않는다 — 즉 자기 신고 기반이다.

         이 사실이 어디에도 없어서 "일일 손실 한도가 작동한다" 로 읽혔다. 운영자가
         한도를 걸고 안심하는 것이 가장 위험하다.
    */
    const idx = read('apps/api/src/index.ts');
    const at = idx.indexOf('dailyRealizedLoss: async');
    expect(at, 'dailyRealizedLoss 를 찾지 못했다').toBeGreaterThan(0);
    const before = idx.slice(Math.max(0, at - 1200), at);
    expect(before, '출처가 저널이라는 사실을 적지 않았다').toMatch(/저널/);
    expect(before, '거래소 원장이 아니라는 사실을 적지 않았다').toMatch(/거래소 원장이 아니다/);
    /* ★ 부팅 때 한 번 알려야 한다 — 코드 주석은 운영자가 읽지 않는다. */
    expect(idx, '부팅 로그에 출처 경고가 없다').toMatch(/직접 입력한 거래 저널/);
  });

  it('[5] 필수 동의를 키보드로 체크할 수 있다', () => {
    /*
       ★★ `.chk input { display: none }` 이면 Tab 순서에서 빠지고 화면 읽기 프로그램에도
         노출되지 않는다. 가입 화면의 필수 동의가 그 상태였다 — 마우스로는 되지만
         **키보드만 쓰는 사람은 가입을 완료할 수 없다.**

       ★ 시각적으로만 감춘다(clip-path). 요소가 남아 초점을 받고 값도 전달된다.
       ★ 초점 표시를 반드시 만든다 — 보이지 않는 입력에 초점이 가면 위치를 알 수 없다.
    */
    const css = read('src/components.css');
    const chkAt = css.indexOf('.chk input {');
    expect(chkAt, '.chk input 규칙을 찾지 못했다').toBeGreaterThan(0);
    const chkSeg = css.slice(chkAt, chkAt + 320);
    expect(chkSeg, '여전히 display:none 이다 — 키보드로 조작할 수 없다').not.toMatch(/display:\s*none/);
    expect(chkSeg, '시각적 숨김이 아니다').toMatch(/clip-path/);
    expect(css, '키보드 초점 표시가 없다').toMatch(/\.chk input:focus-visible \+ \.chk__box/);

    /* ★ 스위치도 같은 문제였다. */
    const swAt = css.indexOf('.switch input {');
    const swSeg = css.slice(swAt, swAt + 320);
    expect(swSeg, '스위치가 여전히 display:none 이다').not.toMatch(/display:\s*none/);
    expect(css, '스위치에 초점 표시가 없다').toMatch(/\.switch input:focus-visible/);
  });

  it('[6] eslint 가 빌드 산출물을 검사하지 않는다', () => {
    /*
       ★★ web-dist/ 가 검사 대상에 남아 있어 `npx eslint .` 가 7,635개 오류를 내뱉었다.
         README 가 지시한 배포 전 게이트가 무조건 실패하므로 사람이 우회하게 되고,
         그 안에 **진짜 소스 오류 16건이 묻혔다.** .gitignore 에는 있었다.
    */
    const cfg = read('eslint.config.mjs');
    expect(cfg, 'web-dist 를 제외하지 않는다').toMatch(/'\*\*\/web-dist\/\*\*'/);
    /* ★ 왜 제외하는지 적혀 있어야 한다 — 다음 사람이 되돌리지 않게. */
    expect(cfg).toMatch(/빌드 산출물/);
  });
});
