import { describe, it, expect, beforeEach } from 'vitest';
import { createRiskEmailAlerter, resetRiskEmailState } from '../trading/risk-email';
import { watchUserPositions, MemoryAlertState } from '../trading/risk-watch';

/*
   청산 경고 이메일.

   ★★ 왜 만들었나

     청산 위험 감시는 인앱 알림만 만들었다. 그 알림은 고객이 앱을 열 때 받은편지함
     에서 보게 된다. 그런데 청산은 **고객이 화면을 보고 있지 않을 때도 진행된다.**
     감시 코드 자신의 주석이 그 상황을 걱정하고 있었는데("사용자가 자는 동안 가격이
     청산가에 접근하면 알릴 방법이 없다"), 인앱 알림으로는 해결할 수 없었다.

     그리고 운영자 상태창은 "Running" 만 보여줬다 — 고객이 보호된다고 읽힌다.

   ★★ 이건 마케팅이 아니라 거래 알림이다

     고객 돈이 사라지는 것을 막기 위한 것이므로 수신 설정과 무관하게 보낸다.
     **그렇기 때문에 반드시 드물어야 한다** — 흔해지면 고객이 규칙을 만들어
     걸러버리고, 그러면 정말 급한 경고도 못 본다.
*/

const POS = [{ symbol: 'XRPUSDT', side: 'long', liquidationPrice: 97, markPrice: 100 }];

function harness(lookup: (u: string) => Promise<string | null>, clock = { t: 1_000_000 }) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const notified: Array<Record<string, unknown>> = [];
  const alerter = createRiskEmailAlerter({
    mail: { name: 'test', send: async (m: unknown) => { sent.push(m as never); } } as never,
    lookupEmail: lookup,
    appBaseUrl: 'https://x.test',
    now: () => clock.t,
    log: () => {},
  });
  const state = new MemoryAlertState();
  const deps = {
    notifications: { create: async (n: unknown) => { notified.push(n as never); } },
    state,
    emailAlert: alerter,
  };
  return { sent, notified, state, deps: deps as never, clock };
}

describe('RISK-EMAIL — 청산 경고가 고객에게 닿는다', () => {
  beforeEach(() => resetRiskEmailState());

  it('[1] 위험 포지션이면 인앱 알림과 이메일이 함께 나간다', async () => {
    const h = harness(async () => 'cust@example.com');
    const r = await watchUserPositions(h.deps, 'u1', POS as never);
    expect(r.notified).toBe(1);
    expect(h.notified.length).toBe(1);
    expect(h.sent.length).toBe(1);
    /*
       ★ 제목에 숫자를 넣는다. 알림창에서 제목만 보이는 경우가 많고, 그때 열지
         말지를 판단할 수 있어야 한다.
    */
    expect(h.sent[0]!.subject).toContain('XRPUSDT');
    expect(h.sent[0]!.subject).toMatch(/3\.0%/);
    expect(h.sent[0]!.subject).toContain('긴급'); // 3% → critical
  });

  it('[2] 같은 등급이 반복되면 메일이 쌓이지 않는다', async () => {
    const h = harness(async () => 'cust@example.com');
    await watchUserPositions(h.deps, 'u1', POS as never);
    const r = await watchUserPositions(h.deps, 'u1', POS as never);
    /*
       ★★ 메일이 흔해지면 고객이 걸러버린다. 그러면 정말 급한 경고도 못 본다 —
         알림 기능이 스스로를 무력화하는 방식이다.
    */
    expect(r.suppressed).toBe(1);
    expect(h.sent.length).toBe(1);
  });

  it('[3] 주소를 모르면 보내지 않는다 — 오배송이 최악이다', async () => {
    const h = harness(async () => null);
    await watchUserPositions(h.deps, 'u2', POS as never);
    /*
       ★★ 빈 주소나 운영자 주소로 대체하면 **다른 사람에게 고객의 포지션을
         보내는** 일이 된다. 알림을 놓치는 것보다 나쁘다.
    */
    expect(h.sent.length).toBe(0);
  });

  it('[4] 주소 조회가 실패해도 감시와 인앱 알림은 계속된다', async () => {
    const h = harness(async () => { throw new Error('DB 장애'); });
    const r = await watchUserPositions(h.deps, 'u3', POS as never);
    /*
       ★★ 메일 실패가 루프를 멈추면 **다른 고객의 경고까지** 사라진다. 한 명의
         메일 문제로 전체 감시를 잃을 수 없다.
    */
    expect(r.notified).toBe(1);
    expect(h.notified.length).toBe(1);
    expect(h.sent.length).toBe(0);
  });

  it('[5] 재발송 간격이 지나면 다시 보낸다 — 영구 침묵은 아니다', async () => {
    const clock = { t: 1_000_000 };
    const h = harness(async () => 'cust@example.com', clock);
    await watchUserPositions(h.deps, 'u5', POS as never);
    expect(h.sent.length).toBe(1);

    // 등급 상태를 지워 다시 알림 조건을 만든다(포지션이 사라졌다 돌아온 상황).
    h.state.delete('u5:XRPUSDT:long');
    clock.t += 31 * 60 * 1000;
    await watchUserPositions(h.deps, 'u5', POS as never);
    /*
       ★ 위험이 계속되는데 영구히 침묵하면 그것도 결함이다. 간격을 두되 다시 알린다.
    */
    expect(h.sent.length).toBe(2);
  });

  it('[6] 본문이 조치와 한계를 함께 말한다', async () => {
    const h = harness(async () => 'cust@example.com');
    await watchUserPositions(h.deps, 'u6', POS as never);
    const body = h.sent[0]!.text;

    /*
       ★★ 위험만 알리고 방법을 말하지 않으면 고객은 화면을 찾아 헤매고, 그 사이에
         청산될 수 있다.
    */
    expect(body).toMatch(/증거금을 추가/);
    expect(body).toMatch(/포지션을 일부 또는 전부 줄인다/);

    /*
       ★★ 이 숫자가 **거래소가 준 값**이라는 사실을 밝힌다. 우리가 추정한 숫자로
         고객이 자기 돈을 움직이게 만들 수 없다. 그리고 메일이 도착하기 전에
         청산될 수 있다는 한계도 숨기지 않는다.
    */
    expect(body).toMatch(/거래소가 제공한 값/);
    expect(body).toMatch(/도착하기 전에 청산될 수 있습니다/);

    // ★ 같은 등급으로 계속 오지 않는다는 사실 — 없으면 "한 통 = 한 번 위험" 으로 오해한다.
    expect(body).toMatch(/다시 보내지 않습니다/);

    // ★ 수신자는 그 사용자 본인이어야 한다.
    expect(h.sent[0]!.to).toBe('cust@example.com');
  });

  it('[7] 청산가·표시가를 모르면 아무것도 보내지 않는다', async () => {
    const h = harness(async () => 'cust@example.com');
    const r = await watchUserPositions(
      h.deps,
      'u7',
      [{ symbol: 'XRPUSDT', side: 'long', liquidationPrice: null, markPrice: 100 }] as never,
    );
    /*
       ★★ 판단 불가를 '위험' 으로도 '안전' 으로도 바꾸지 않는다. 모르는 상태로
         메일을 보내면 고객이 근거 없이 포지션을 정리한다.
    */
    expect(r.unknown).toBe(1);
    expect(h.sent.length).toBe(0);
  });
});
