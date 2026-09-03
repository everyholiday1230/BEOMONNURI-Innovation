import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

/*
   청산 위험 감시의 상태가 운영자에게 정확히 보이는가.

   ★★ 실서비스에서 확인한 상태

     `RISK_WATCH_ENABLED` 이 설정돼 있지 않다 = 감시가 꺼져 있다. 그런데
     `LIVE_TRADING_ENABLED=true` 이고 실제로 선물 주문 18건을 낸 고객이 있다.

     그 조합의 뜻: 고객이 레버리지 포지션을 들고 화면을 닫으면, 청산가에
     접근하는 동안 **아무 계산도 되지 않는다.**

     기본값이 꺼짐인 이유는 코드 주석에 적혀 있다 — "실주문이 없는 배포에서
     사용자 키로 거래소를 주기 호출할 이유가 없다". 맞는 이유지만, 실주문이
     켜진 배포에서는 **그 전제가 깨진다.** 그런데 예전 로그와 상태창은 중립적인
     'Off' 한 줄이라, 운영자가 이게 중요한 상태인지 알 수 없었다.

   ★★ 더 중요한 한계: 켜도 인앱 전용이다.

     risk-watch 는 notifications.create() 만 호출한다 — 이메일도 푸시도 없다.
     즉 자고 있는 고객에게는 도달하지 않고, 앱을 열 때 받은편지함에서 본다.
     "감시 중" 표시만 보고 고객이 보호된다고 믿으면 안 되므로, 상태창이 전달
     수단을 함께 밝힌다.
*/
describe('RISK-WATCH-VISIBILITY — 감시 상태가 정확히 드러난다', () => {
  it('[1] 실주문이 켜진 채 감시가 꺼져 있으면 경고로 남긴다', () => {
    const i = src.indexOf('청산 위험 감시가 꺼져 있는데 실주문은 켜져 있다');
    expect(i, '경고 문구가 없다').toBeGreaterThan(0);
    const block = src.slice(i - 500, i + 300);
    /*
       ★ console.log 로 남기면 다른 부팅 로그에 묻힌다. 이 조합은 고객이 청산
         경고를 못 받는 상태이므로 경고 수준이어야 한다.
    */
    expect(block).toMatch(/console\.warn/);
    // ★ 두 조건을 함께 본다 — 하나만 보면 실주문이 닫힌 배포에서도 겁을 준다.
    expect(block).toMatch(/env\.liveTradingEnabled && env\.liveOrdersEnabled/);
  });

  it('[2] 실주문이 닫힌 배포에서는 겁주지 않는다', () => {
    /*
       ★ 실주문이 없으면 감시 대상이 0명이고 위험도 0이다. 그때도 경고를 내면
         경고가 흔해져서 진짜 경고를 무시하게 된다.
    */
    expect(src).toMatch(/청산 위험 감시: 꺼짐 \(RISK_WATCH_ENABLED=true 로 켠다\)/);
  });

  it('[3] 상태창이 실주문 무장 상태를 함께 말한다', () => {
    const i = src.indexOf("OFF while live orders are ARMED");
    expect(i, '상태창 문구가 없다').toBeGreaterThan(0);
    // ★ 무엇이 안 되는지 적는다. 'OFF' 만으로는 결과를 알 수 없다.
    const line = src.slice(i, i + 220);
    expect(line).toMatch(/closes the screen/);
    expect(line).toMatch(/RISK_WATCH_ENABLED=true/);
  });

  it('[4] 전달 수단을 사실대로 말한다 — 발송기가 있을 때와 없을 때가 다르다', () => {
    /*
       ★★ 감시가 도는 것과 고객에게 닿는 것은 다른 문제다. "Running" 만 보면
         운영자는 고객이 보호된다고 읽는다.

       ★ MailSink 는 메모리에만 쌓는다. 그걸 "이메일 발송" 으로 표시하면 같은
         착각을 새로 만들기 때문에, 실제 발송기 여부로 갈라야 한다.
    */
    expect(src).toMatch(/in-app \+ email to the customer/);
    expect(src).toMatch(/mail provider not configured/);
    expect(src).toMatch(/const delivery = mailConfigured/);
  });

  it('[5] 실제 발송기와 메모리 싱크를 구분한다', () => {
    /*
       ★★ MailSink 로 보내면서 "이메일 켜짐" 이라고 말하면, 이 기능이 없애려던
         착각을 그대로 재현한다.
    */
    expect(src).toMatch(/const mailConfigured = Boolean\(smtpProvider \?\? resendProvider\)/);
  });
});
