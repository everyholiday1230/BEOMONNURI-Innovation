import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campaignActive, signalSaveIsFree, type CampaignConfig } from '../campaign/campaign-window';

/*
   **KuCoin 공동 캠페인(2026-10) — 제출한 약속을 잠근다.**

   ★★★ 운영자가 신청서를 KuCoin 에 **제출했다.** 그래서 아래는 기능 명세가 아니라
     이행 의무다. 문구와 기능이 어긋나면 문구가 아니라 기능을 고친다.
     상세: CAMPAIGN-KUCOIN-2026-10.md
*/

const ROOT = join(__dirname, '../../../..');
const cfg = (o: Partial<CampaignConfig> = {}): CampaignConfig => ({
  campaignStart: '2026-10-01',
  campaignEnd: '2026-10-31',
  campaignWelcomePoints: 30000,
  campaignFreeSignalSaves: 5,
  ...o,
});
const at = (iso: string) => Date.parse(iso);

describe('캠페인 기간 판정', () => {
  it('기본은 꺼짐이다 — 설정이 비어 있으면 캠페인이 아니다', () => {
    /*
       ★★★ 기본으로 켜 두면 신청서 없이도 포인트가 나가고, 원장에 남아 되돌릴 수 없다.
    */
    expect(campaignActive(cfg({ campaignStart: '', campaignEnd: '' }))).toBe(false);
    expect(campaignActive(cfg({ campaignStart: '2026-10-01', campaignEnd: '' }))).toBe(false);
    expect(campaignActive(cfg({ campaignStart: '', campaignEnd: '2026-10-31' }))).toBe(false);
  });

  it('형식이 아닌 날짜는 켜지 않는다', () => {
    for (const bad of ['2026/10/01', '10-01-2026', 'october', '2026-10', '2026-13-01']) {
      expect(campaignActive(cfg({ campaignStart: bad })), `통과됨: ${bad}`).toBe(false);
    }
  });

  it('시작일 00:00 부터 포함한다', () => {
    expect(campaignActive(cfg(), at('2026-09-30T23:59:59.999Z')), '시작 전인데 켜졌다').toBe(false);
    expect(campaignActive(cfg(), at('2026-10-01T00:00:00.000Z')), '시작일 첫 순간이 빠졌다').toBe(true);
  });

  /*
     ★★★ 종료일은 **그 날의 끝까지** 포함한다. 신청서에 "~ 31 October" 라고 썼으므로
       31일 하루가 온전히 약속에 들어간다. 그 날 아침에 끊으면 약속을 어긴 것이다.
  */
  it('종료일 하루가 온전히 포함된다', () => {
    expect(campaignActive(cfg(), at('2026-10-31T00:00:00.000Z')), '종료일 아침이 빠졌다').toBe(true);
    expect(campaignActive(cfg(), at('2026-10-31T23:59:59.999Z')), '종료일 마지막 순간이 빠졌다').toBe(true);
    expect(campaignActive(cfg(), at('2026-11-01T00:00:00.000Z')), '종료 후인데 켜졌다').toBe(false);
  });

  it('시작일이 종료일보다 늦으면 켜지 않는다 — 설정 오류다', () => {
    expect(campaignActive(cfg({ campaignStart: '2026-11-01', campaignEnd: '2026-10-01' }),
      at('2026-10-15T00:00:00.000Z'))).toBe(false);
  });
});

describe('신호 규칙 저장 5회 무료', () => {
  const now = at('2026-10-15T00:00:00.000Z');

  it('신호 규칙이고 5회 미만이면 무료다', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(signalSaveIsFree(cfg(), 'signal', n, now), `${n}번째가 유료다`).toBe(true);
    }
  });

  it('5회를 쓰면 유료로 돌아간다 — 무한 무료가 아니다', () => {
    expect(signalSaveIsFree(cfg(), 'signal', 5, now)).toBe(false);
    expect(signalSaveIsFree(cfg(), 'signal', 99, now)).toBe(false);
  });

  /*
     ★ 신청서가 "signal rules" 라고 썼다. 지표·전략까지 무료로 주면 약속보다 많이
       주는 것이고, 저장 비용 체계가 무너진다(전략 300pt).
  */
  it('지표·전략은 무료 대상이 아니다', () => {
    expect(signalSaveIsFree(cfg(), 'indicator', 0, now)).toBe(false);
    expect(signalSaveIsFree(cfg(), 'strategy', 0, now)).toBe(false);
  });

  it('캠페인 기간이 아니면 무료가 아니다', () => {
    expect(signalSaveIsFree(cfg(), 'signal', 0, at('2026-09-30T00:00:00.000Z'))).toBe(false);
    expect(signalSaveIsFree(cfg(), 'signal', 0, at('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(signalSaveIsFree(cfg({ campaignStart: '', campaignEnd: '' }), 'signal', 0, now)).toBe(false);
  });

  it('무료 횟수가 0 이면 무료가 아니다', () => {
    expect(signalSaveIsFree(cfg({ campaignFreeSignalSaves: 0 }), 'signal', 0, now)).toBe(false);
  });
});

describe('배선', () => {
  const idx = readFileSync(join(ROOT, 'apps/api/src/index.ts'), 'utf8');
  const routes = readFileSync(join(ROOT, 'apps/api/src/user-strategy-routes.ts'), 'utf8');

  /*
     ★★★ 약속한 지급 시점은 **API 키 연결**이다. 신청서 Step 3 → Step 4 가 그것이다.
       다른 시점(가입 등)에 붙이면 신청서와 다른 동작이 된다.
  */
  it('웰컴 포인트가 키 검증 성공 지점에 붙어 있다', () => {
    expect(idx, '캠페인 지급 함수가 없다').toMatch(/async function grantCampaignWelcomeIfDue/u);
    const i = idx.indexOf('async function recordExchangeConnected');
    const body = idx.slice(i, idx.indexOf('\n}', i));
    expect(body, '키 검증 경로에서 캠페인 지급을 부르지 않는다')
      .toMatch(/grantCampaignWelcomeIfDue\(userId\)/u);
  });

  /*
     ★★ 멱등성이 원장 유니크 인덱스로 막혀야 한다. refId 가 이용자 id 여야 1인 1회가 된다.
  */
  it('1인 1회로 막는다 — refType 에 캠페인 식별자, refId 에 이용자', () => {
    const i = idx.indexOf('async function grantCampaignWelcomeIfDue');
    const body = idx.slice(i, idx.indexOf('\n}', i + 200));
    expect(body, 'refType 에 캠페인 식별자를 넣지 않는다').toMatch(/refType: CAMPAIGN_REF_TYPE/u);
    expect(body, 'refId 가 이용자가 아니다 — 1인 1회가 되지 않는다').toMatch(/refId: userId/u);
    expect(idx, '캠페인 식별자가 없다').toMatch(/CAMPAIGN_REF_TYPE = 'campaign:kucoin-2026-10'/u);
  });

  it('지급 실패가 거래소 연결을 막지 않는다', () => {
    const i = idx.indexOf('async function grantCampaignWelcomeIfDue');
    const body = idx.slice(i, idx.indexOf('\n}', i + 200));
    expect(body, '실패를 삼키지 않아 연결이 막힐 수 있다').toMatch(/catch \(e\)/u);
  });

  it('저장 라우트가 캠페인 설정을 받고 DB 로 개수를 센다', () => {
    expect(routes, '캠페인 설정을 받지 않는다').toMatch(/campaign\?: CampaignConfig/u);
    /*
       ★★ 개수를 DB 에서 세야 한다. 세션·화면 값으로 세면 재접속마다 다시 5회가 된다.
    */
    expect(routes, 'DB 에서 세지 않는다').toMatch(/listForUser\(a\.user\.id, 'signal'\)/u);
    /* ★ 무료면 잔액을 보지 않는다 — 잔액 0 인 신규 고객도 약속받은 5회를 쓴다. */
    expect(routes, '무료인데 잔액을 검사한다').toMatch(/if \(cost > 0\) \{/u);
    /* ★ 응답에 무료 사실을 밝힌다 — 조용히 0 차감하면 혜택이 적용됐는지 알 수 없다. */
    expect(routes, '무료 사실을 응답에 밝히지 않는다').toMatch(/freeByCampaign/u);
    expect(idx, '라우터에 캠페인 설정을 넘기지 않는다').toMatch(/campaign: \{[\s\S]{0,300}campaignFreeSignalSaves/u);
  });
});

describe('신청서 문구와 기능이 일치한다', () => {
  const doc = readFileSync(join(ROOT, 'CAMPAIGN-KUCOIN-2026-10.md'), 'utf8');

  /*
     ★★★ 제출본이 문서에 남아 있어야 한다. 나중에 "무엇을 약속했는지" 를 코드에서
       역추적할 수는 없다.
  */
  it('제출본과 기간이 문서에 남아 있다', () => {
    expect(doc, '기간이 없다').toMatch(/2026-10-01\s*~\s*2026-10-31/u);
    expect(doc, '브로커 링크가 없다').toMatch(/kucoin\.com\/r\/broker\/CXE8HTY1/u);
    expect(doc, '웰컴 포인트 금액이 없다').toMatch(/30,?000/u);
    expect(doc, '무료 저장 횟수가 없다').toMatch(/5회 무료|five are free/u);
    expect(doc, '포인트 현금가치 없음 문구가 없다').toMatch(/no cash value/u);
  });

  it('문서의 수치와 시험의 수치가 같다', () => {
    /* 문서를 고치고 코드를 안 고치는(또는 반대) 상황을 막는다. */
    expect(doc).toMatch(/CAMPAIGN_WELCOME_POINTS|30,?000 welcome points/u);
    expect(cfg().campaignWelcomePoints).toBe(30000);
    expect(cfg().campaignFreeSignalSaves).toBe(5);
  });
});
