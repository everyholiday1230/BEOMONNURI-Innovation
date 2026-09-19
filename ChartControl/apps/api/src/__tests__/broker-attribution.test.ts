/*
   "왜 브로커 대시보드에 수수료가 안 쌓이나" 를 **진단할 수 있게** 만든 것을 잠근다.

   운영자 질문(2026-09-19): "BEOMONNURI 아이디로 매매하는데 왜 쿠코인 브로커 대시보드에
   로그나 거래 수수료가 안 쌓일까?"

   ★★★ 조사 결과: 우리 쪽은 정상이었다.
     · 실주문 감사기록에 `brokerAttached: true`
     · `KC-API-PARTNER-VERIFY: true` 를 보내는데 `400201` 이 **한 건도 없다**
       (서명이 틀리면 KuCoin 이 그 코드로 거절한다)

   ★★★ 그런데 `brokerAttached` 는 **우리 쪽 주장**이다 — "헤더를 넣었다" 는 뜻일 뿐이다.
     거래소의 판정은 브로커 API 의 `...WithTag` / `...WithoutTag` 다.
     그 데이터를 **조회하는 API 는 있었지만 화면이 부르지 않았다** — 그래서 원인을
     확인할 방법이 없었다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('브로커 귀속을 화면에서 확인할 수 있다', () => {
  const admin = read('src/pages-admin.jsx');

  /*
     ★★★ API 가 있는데 화면이 안 부르면 **없는 것과 같다.** 이 저장소에서 반복된 실패다
       (`/ai-strategies/my` 에 링크가 없던 일, 저장 목록이 두 곳으로 갈렸던 일).
  */
  it('거래자 목록을 조회한다', () => {
    expect(admin, '브로커 거래자 목록을 부르지 않는다').toMatch(/admin\.brokerUsers\(/u);
    /* ★ 실패를 "거래자 없음" 으로 위장하지 않는다 — null 을 유지한다. */
    expect(admin, '조회 실패를 빈 목록으로 위장한다')
      .toMatch(/brokerUsers\([\s\S]{0,200}catch\(\(\) => \{ \/\* 실패를 '거래자 없음' 으로 위장하지 않는다/u);
  });

  /*
     ★★★ **세 상태를 구분해야 한다 — 할 일이 전혀 다르다:**
       ① WithTag 에 값 → 정상 집계
       ② WithoutTag 에만 값 → 서명이 안 붙었다 (우리 코드 문제)
       ③ 목록에 UID 가 없다 → 그 계정이 우리 브로커에 귀속되지 않았다 (코드로 못 고친다)
  */
  it('태그 있는 거래와 없는 거래를 나눠 보여준다', () => {
    expect(admin, '태그 붙은 선물 거래량을 안 보여준다').toMatch(/futuresTradingVolumeWithTag/u);
    expect(admin, '태그 없는 선물 거래량을 안 보여준다').toMatch(/futuresTradingVolumeWithoutTag/u);
    /* ★ 태그 없는 거래는 **경고색**으로 — 수익이 새는 것이다. */
    expect(admin, '태그 없는 거래를 눈에 띄게 하지 않는다')
      .toMatch(/futuresTradingVolumeWithoutTag\) > 0 \? 'var\(--color-danger\)'/u);
  });

  /*
     ★★★ **거래자가 0명이면 그것이 답이다.** "수익 0" 과 "귀속된 거래자가 없다" 는
       다른 사실이고, 후자는 코드 문제가 아니다 — KuCoin 에 문의해야 한다.
       빈 표를 보여주면 운영자가 계속 코드를 의심한다.
  */
  it('거래자가 없으면 그 사실과 할 일을 말한다', () => {
    expect(admin, '거래자 0명을 빈 표로 보여준다').toMatch(/kcu_none_title/u);
    expect(admin, '무엇을 해야 하는지 말하지 않는다').toMatch(/kcu_none_2/u);
    const dir = join(ROOT, 'src/locales');
    const en = readFileSync(join(dir, 'en.js'), 'utf8');
    /* ★ 우리 주장과 거래소 판정이 다르다는 것을 문구가 설명해야 한다. */
    expect(en, '문구가 brokerAttached 와의 차이를 설명하지 않는다').toMatch(/brokerAttached: true/u);
    expect(en, '코드로 못 고친다는 사실을 말하지 않는다').toMatch(/cannot be fixed in code/u);
  });

  it('우리 초대로 온 계정인지 보여준다', () => {
    /* ★ ③ 판정의 근거다. 브로커 프로그램은 보통 우리 링크로 만든 계정만 집계한다. */
    expect(admin, '초대 여부를 보여주지 않는다').toMatch(/r\.invitedByMe/u);
  });

  it('조회 실패와 거래자 없음을 구분한다', () => {
    /* ★★ 둘을 같게 다루면 운영자가 엉뚱한 곳을 본다. */
    expect(admin, '조회 실패를 알리지 않는다').toMatch(/kcu_query_failed/u);
    expect(admin, '실패 원인 코드를 보여주지 않는다').toMatch(/kcUsers\.error/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('kcb_notag_com')) continue;
      for (const k of ['kcu_title', 'kcu_none_title', 'kcu_fut_notag', 'kcu_query_failed']) {
        if (!s.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('브로커 서명 검증 장치가 켜져 있다', () => {
  const sig = read('packages/exchange-kucoin/src/signature.ts');

  /*
     ★★★ `KC-API-PARTNER-VERIFY: true` 를 보내면 파트너 서명이 틀렸을 때 KuCoin 이
       **`400201` 로 거절한다.** 없으면 조용히 통과하고 리베이트만 0 이 된다 —
       정산일에야 안다.
     ★ 이번 조사에서 이 장치 덕분에 "서명은 정상" 을 빠르게 확정할 수 있었다
       (프로덕션 로그에 `400201` 이 0건).
  */
  it('파트너 서명 검증을 요구한다', () => {
    expect(sig, '서명 검증을 켜지 않았다').toMatch(/headers\['KC-API-PARTNER-VERIFY'\] = 'true'/u);
  });

  it('브로커 자격이 하나라도 없으면 헤더를 붙이지 않는다', () => {
    /* ★ 빈 값을 붙이면 거래소가 잘못된 파트너로 볼 수 있다. */
    expect(sig, '부분 설정에도 헤더를 붙인다')
      .toMatch(/Boolean\(broker && broker\.partner && broker\.key && broker\.name\)/u);
  });
});

describe('운영자 키가 실제로 되는지 확인한다', () => {
  const idx = read('apps/api/src/index.ts');

  /*
     ★★★ 2026-09-19 프로덕션 실측: 운영자 KuCoin 키가 **모든 도메인에서 `400003`** 이었다.
       그런데 부팅 로그는 `production credential readiness: OK` 였다 — 값이 "있으면"
       OK 라고 적었기 때문이다. 그래서 수익을 조회할 방법이 없는 상태가 드러나지 않았다.

     ★★ `brokerAttached: true` 와 **같은 종류의 결함**이다: 우리 쪽 주장을 확인으로
       착각했다. 상대가 심판인 값은 상대에게 물어야 한다.
  */
  it('부팅 때 거래소에 실제로 물어본다', () => {
    expect(idx, '운영자 키를 실제로 시험하지 않는다')
      .toMatch(/kucoin operator credential: VERIFIED/u);
    expect(idx, '실패를 알리지 않는다').toMatch(/kucoin operator credential FAILED/u);
    /* ★ 존재 확인만으로 끝내지 않고 실제 호출이 있어야 한다. */
    expect(idx, '실제 호출이 없다').toMatch(/await kucoinRebates\.fetchSpot\(/u);
  });

  /*
     ★★★ 이 키는 **수익 조회용**이고 고객 거래와 무관하다. 기동을 막으면 거래가
       멈추는데, 그것이 훨씬 큰 손해다 — fail-open 이어야 한다.
  */
  it('실패해도 기동을 막지 않는다', () => {
    const m = /if \(kucoinRebates\) \{\s*void \(async \(\) => \{[\s\S]*?\}\)\(\);/u.exec(idx);
    expect(m, '점검이 떼어내진 형태가 아니다').not.toBeNull();
    const body = m![0];
    expect(body, '점검 실패가 기동을 죽인다').not.toMatch(/process\.exit/u);
    expect(body, '점검 실패를 throw 한다').not.toMatch(/\bthrow\b/u);
  });

  /*
     ★★ 운영자가 무엇을 해야 하는지 로그가 말해야 한다. "FAILED" 만 적으면
       거래가 멈춘 줄 알고 당황한다 — 실제로는 거래와 무관하다.
  */
  it('거래는 무관하다는 사실과 할 일을 로그가 말한다', () => {
    expect(idx, '고객 거래가 무관하다고 말하지 않는다')
      .toMatch(/Customer trading is UNAFFECTED/u);
    expect(idx, '해결 방법을 말하지 않는다').toMatch(/set KUCOIN_API_KEY/u);
  });
});
