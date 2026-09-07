import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p: string) => existsSync(join(ROOT, p));

/*
   조용히 무력화되는 배선들.

   ★★ 이 파일이 막는 것들은 공통점이 있다: **오류 없이 아무 일도 일어나지 않는다.**
     로그도, 예외도, 화면 표시도 없다. 그래서 아무도 모른 채로 오래 남는다. 실제로
     운영에서 그 상태였다.
*/

describe('SILENT-WIRING — 조용히 아무 일도 일어나지 않는 경로를 막는다', () => {
  it('[1] 구글로 처음 들어온 사람도 가입 처리를 받는다', () => {
    /*
       ★★ `loginWithVerifiedEmail` 은 계정이 없으면 그 자리에서 만든다. 즉 "로그인"
         처럼 보이지만 가입이다. 그런데 구글 콜백은 `onRegistered` 를 부르지 않았다.

         결과: 구글로 가입한 고객은 **포인트를 받지 못해 AI 를 한 번도 쓸 수 없고**
         (최소 300pt 필요), 초대 코드 귀속도 되지 않는다. 오류는 나지 않는다 —
         로그인은 정상적으로 성공하니까.

         운영 DB 확인 결과 아직 구글로 생성된 계정은 없었다(federated 0건). 즉 첫
         구글 가입 고객이 이 결함을 맞을 예정이었다.
    */
    const routes = read('apps/api/src/auth-routes.ts');
    const at = routes.indexOf("loginWithVerifiedEmail(payload.email, 'google'");
    expect(at, '구글 로그인 호출을 찾지 못했다').toBeGreaterThan(0);
    const seg = routes.slice(at, at + 1400);
    expect(seg, '가입 처리를 부르지 않는다').toMatch(/deps\.onRegistered/);
    expect(seg, '새로 만든 경우인지 구별하지 않는다').toMatch(/r\.created/);
    /* ★ 지급 로직을 여기에 복사하면 한쪽만 고쳐지는 일이 생긴다. */
    expect(seg, '지급 로직이 복사됐다 — 단일 경로를 써야 한다').not.toMatch(/signupGrantPoints/);
  });

  it('[2] 계정을 새로 만들었는지 호출자가 알 수 있다', () => {
    const svc = read('packages/auth/src/service.ts');
    expect(svc, 'LoginResult 에 created 가 없다').toMatch(/created\?: boolean/);
    const at = svc.indexOf('async loginWithVerifiedEmail');
    const seg = svc.slice(at, at + 2600);
    expect(seg, 'created 를 설정하지 않는다').toMatch(/created = true/);
    expect(seg, '반환에 created 가 없다').toMatch(/\n\s+created,/);
  });

  it('[3] ai_enabled 플래그 불일치를 알린다', () => {
    /*
       ★★ 씨딩은 최초 1회만 값을 정한다(INSERT OR IGNORE). AI_ENABLED=false 로 한 번
         부팅한 데이터베이스는 플래그가 false 로 박히고, 나중에 환경변수를 true 로
         바꿔도 **영원히 꺼진 채로 남는다.**

         유일한 단서는 고객이 코파일럿에서 "운영자가 AI를 껐습니다" 를 보는 것이다.
         환경변수를 바꾼 사람은 자기가 켰다고 믿는다. 실제로 로컬에서 이 함정에
         걸렸다.

       ★ 값을 덮어쓰지 않는다 — 그러면 관리자 화면의 스위치가 무의미해진다. 대신
         불일치와 **결과와 고칠 위치**를 함께 알린다.
    */
    const idx = read('apps/api/src/index.ts');
    const at = idx.indexOf("seedFlag('ai_enabled'");
    expect(at, 'ai_enabled 씨딩을 찾지 못했다').toBeGreaterThan(0);
    const seg = idx.slice(at, at + 1800);
    expect(seg, '불일치를 검사하지 않는다').toMatch(/ai_enabled 불일치/);
    expect(seg, '어느 쪽이 적용되는지 말하지 않는다').toMatch(/데이터베이스/);
    expect(seg, '무엇을 해야 하는지 말하지 않는다').toMatch(/관리자 화면/);
    /* ★ 진단이 부팅을 막아서는 안 된다. */
    expect(seg).toMatch(/catch/);
  });

  it('[4] point_settings 기본 행을 마이그레이션이 보장한다', () => {
    /*
       ★★ 행이 없으면 `getSettings()` 가 enabled:false 로 떨어지고 **모든 포인트 기능이
         조용히 아무 일도 하지 않는다** — 가입 지급, 초대 보상, 차감, 구매 전부.
         오류도 로그도 없다. 로컬 Postgres 를 새로 만들었을 때 실제로 겪었다.
    */
    const f = 'infrastructure/postgres/0043_point_settings_default.postgres.sql';
    expect(exists(f), '마이그레이션이 없다').toBe(true);
    const sql = read(f);
    expect(sql).toMatch(/INSERT INTO point_settings/);
    /* ★ 이미 운영 중인 배포의 설정을 되돌리면 안 된다. */
    expect(sql, '기존 설정을 덮어쓴다').toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    /* ★ 제도를 켜는 것은 운영자의 결정이다. 마이그레이션이 대신하지 않는다. */
    expect(sql, '마이그레이션이 제도를 켜버린다').toMatch(/VALUES \('default', FALSE/);
    expect(exists('infrastructure/postgres/0043_point_settings_default.down.postgres.sql')).toBe(true);
  });

  it('[5] 거래소 중립 계약이 BitMart 패키지 밖에 있다', () => {
    /*
       ★★ KuCoin 어댑터가 `@quantumtrade/exchange-bitmart` 에서 계약 타입을 가져오고
         있었다. BitMart 는 연결조차 되지 않는 거래소다. 그래서 "쓰지 않는 거래소니
         지우자" 는 판단을 부르는데, **지우면 KuCoin 거래가 멈춘다.**

       ★ 타입과 순수 함수만 옮겼으므로 동작은 바뀌지 않는다.
    */
    expect(exists('packages/exchange-core/src/interfaces.ts'), '중립 계약이 옮겨지지 않았다').toBe(true);
    expect(exists('packages/exchange-core/src/modes.ts')).toBe(true);
    expect(exists('packages/exchange-bitmart/src/interfaces.ts'), 'BitMart 패키지에 계약이 남아 있다').toBe(false);

    /* ★ 살아 있는 거래 경로가 중립 패키지를 쓴다. */
    for (const f of ['apps/api/src/trading/kucoin-trading-adapter.ts', 'apps/api/src/trading/kucoin-spot-trading-adapter.ts']) {
      expect(read(f), `${f} 가 여전히 BitMart 패키지에서 계약을 가져온다`).toMatch(/@quantumtrade\/exchange-core/);
    }

    /* ★ 기존 import 가 깨지지 않도록 재내보낸다. */
    expect(read('packages/exchange-bitmart/src/index.ts')).toMatch(/export \* from '@quantumtrade\/exchange-core'/);

    /* ★ 지우면 거래가 멈춘다는 사실이 적혀 있어야 한다. */
    expect(exists('packages/exchange-bitmart/README.md'), '오해를 막는 설명이 없다').toBe(true);
    expect(read('packages/exchange-bitmart/README.md')).toMatch(/거래가 멈춥니다/);
  });

  it('[6] 실행할 수 없는 e2e 스위트가 커버리지처럼 보이지 않는다', () => {
    /*
       ★★ tests/e2e-admin 은 존재하지 않는 `@quantumtrade/admin` 앱과 data-testid 155곳을
         기대한다. 현재 관리자 화면에는 testid 가 0개다. 그래서 스위트가 시작조차 못
         하는데, 실패 메시지는 "webServer exited early" 라서 원인을 말해주지 않는다.

       ★ 있는 척하는 검증이 없는 검증보다 위험하다. 이유를 말하고 즉시 멈춘다.
    */
    const cfg = read('tests/e2e-admin/playwright.config.ts');
    expect(cfg, '원인을 말하지 않는다').toMatch(/실행할 수 없습니다/);
    expect(cfg, '고치는 중 강제 실행 수단이 없다').toMatch(/E2E_ADMIN_FORCE/);
    expect(exists('tests/e2e-admin/README.md'), '되살리는 방법이 없다').toBe(true);

    /* ★ MFA 스위트는 반대로 되살렸다 — 죽은 채로 두지 않았다는 것을 고정한다. */
    /*
       ★ 주석은 제외한다. 무엇을 왜 고쳤는지 설명하려면 없어진 패키지 이름을
         **언급**해야 하는데, 문자열만 찾으면 그 설명이 위반으로 잡힌다.
    */
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const mfa = stripComments(read('tests/e2e-mfa/playwright.config.ts'));
    expect(mfa, '검사 대상 코드를 못 남겼다').toMatch(/webServer/);
    expect(mfa, 'MFA 설정이 아직 없는 패키지를 띄우려 한다').not.toMatch(/@quantumtrade\/web/);
    const spec = read('tests/e2e-mfa/mfa.spec.ts');
    /*
       ★ 주석은 제외한다. 왜 다시 썼는지 설명하려면 옛 선택자를 **언급**해야 하는데,
         문자열만 찾으면 그 설명이 위반으로 잡힌다.
    */
    const code = stripComments(spec);
    expect(code, '검사 대상 코드를 못 남겼다').toMatch(/test\(/);
    expect(code, '스펙이 없는 testid 를 다시 쓴다').not.toMatch(/getByTestId\(/);
    /* ★ 코드 생성은 서버와 같은 구현을 써야 한다. 다르면 무엇도 증명하지 못한다. */
    expect(spec).toMatch(/@quantumtrade\/mfa/);
  });
});
