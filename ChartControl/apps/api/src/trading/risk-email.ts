import type { MailProvider } from '@quantumtrade/auth';
import type { RiskLevel } from './risk-watch';

/*
   청산 경고 이메일.

   ★★ 왜 이 파일이 있는가

     청산 위험 감시는 인앱 알림만 만들었다(notifications.create). 그 알림은
     고객이 앱을 열 때 받은편지함에서 보게 된다. 그런데 청산은 **고객이 화면을
     보고 있지 않을 때도 진행된다.** 감시 코드 자신의 주석이 그 상황을 걱정하고
     있었는데("사용자가 자는 동안 가격이 청산가에 접근하면 알릴 방법이 없다"),
     인앱 알림으로는 그 걱정을 해결할 수 없다.

     상태창에 "Running" 이 뜨면 운영자는 고객이 보호된다고 읽는다. 그 표시를
     사실로 만들려면 고객에게 닿는 경로가 필요하다.

   ★★ 이건 마케팅 메일이 아니다

     고객 돈이 사라지는 것을 막기 위한 거래 알림이다. 그래서 수신 거부 설정과
     무관하게 보낸다. 다만 그렇기 때문에 **반드시 드물어야 한다** — 흔해지면
     고객이 규칙을 만들어 걸러버리고, 그러면 정말 급한 경고도 못 본다.
     드물게 유지하는 장치는 두 겹이다:
       1. 감시 쪽 억제 — 등급이 나빠질 때만 알린다(warning→critical 은 알리고,
          호전은 알리지 않는다)
       2. 이 파일의 재발송 간격 — 같은 포지션·같은 등급은 정해진 시간 안에
          다시 보내지 않는다(프로세스가 재시작돼도 폭주하지 않도록)
*/

export interface RiskEmailDeps {
  mail: MailProvider;
  /** 사용자 이메일 조회. 없거나 실패하면 null — 그때는 보내지 않는다. */
  lookupEmail: (userId: string) => Promise<string | null>;
  appBaseUrl: string;
  /** 같은 포지션·같은 등급을 다시 보내지 않는 최소 간격(ms). */
  resendAfterMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface RiskEmailInput {
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  level: RiskLevel;
  distancePct: number;
  /** 문자열로 받는다 — 여기서 반올림하면 고객이 거래소에서 보는 값과 어긋난다. */
  markPrice: string;
  liquidationPrice: string;
}

const DEFAULT_RESEND_AFTER_MS = 30 * 60 * 1000;

/** 마지막 발송 시각. 프로세스 메모리 — 재시작하면 한 번 더 보낼 수 있다(안전한 방향). */
const lastSentAt = new Map<string, number>();

/** 테스트용. 상태를 비운다. */
export function resetRiskEmailState(): void {
  lastSentAt.clear();
}

/**
 * 청산 경고 메일 발송기를 만든다.
 *
 * ★ 예외를 던지지 않는다. 메일 실패가 감시 루프를 멈추면 **다른 고객의 경고까지**
 *   사라진다. 실패는 로그로만 남긴다.
 */
export function createRiskEmailAlerter(
  deps: RiskEmailDeps,
): (input: RiskEmailInput) => Promise<void> {
  const resendAfter = deps.resendAfterMs ?? DEFAULT_RESEND_AFTER_MS;
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((m: string) => console.warn(m));

  return async function sendRiskEmail(input: RiskEmailInput): Promise<void> {
    try {
      const key = `${input.userId}:${input.symbol}:${input.side}:${input.level}`;
      const prev = lastSentAt.get(key);
      const t = now();
      if (prev !== undefined && t - prev < resendAfter) return;

      const to = await deps.lookupEmail(input.userId);
      /*
         ★★ 주소를 모르면 보내지 않는다. 빈 문자열이나 운영자 주소로 대체하면
           **다른 사람에게 고객의 포지션을 보내는** 일이 된다.
      */
      if (!to || !to.includes('@')) {
        log(`[risk-email] 주소를 알 수 없어 보내지 않는다 (userId=${input.userId})`);
        return;
      }

      const side = input.side === 'short' ? 'SHORT' : 'LONG';
      const urgent = input.level === 'critical';
      /*
         ★ 제목에 숫자를 넣는다. 알림창에서 제목만 보이는 경우가 많고, 그때
           열지 말지를 판단할 수 있어야 한다.
      */
      const subject = `${urgent ? '[긴급] ' : ''}${input.symbol} ${side} — 청산가까지 ${input.distancePct.toFixed(1)}%`;

      const lines = [
        urgent
          ? '보유 포지션이 청산가에 매우 가까워졌습니다.'
          : '보유 포지션이 청산가에 접근하고 있습니다.',
        '',
        `종목        ${input.symbol} ${side}`,
        `청산가까지  ${input.distancePct.toFixed(2)}%`,
        input.markPrice ? `현재 표시가 ${input.markPrice}` : null,
        input.liquidationPrice ? `청산가      ${input.liquidationPrice}` : null,
        '',
        /*
           ★★ 무엇을 할 수 있는지 적는다. 위험만 알리고 방법을 말하지 않으면
             고객은 화면을 찾아 헤매고, 그 사이에 청산될 수 있다.
        */
        '할 수 있는 조치',
        '  · 증거금을 추가한다',
        '  · 포지션을 일부 또는 전부 줄인다',
        '  · 레버리지를 낮춘다',
        '',
        `포지션 화면: ${deps.appBaseUrl.replace(/\/+$/, '')}/#/trade`,
        '',
        /*
           ★★ 이 값이 우리 계산이 아니라 **거래소가 준 청산가**라는 사실을 밝힌다.
             우리가 추정한 숫자로 고객이 자기 돈을 움직이게 만들 수는 없다.
        */
        '※ 청산가와 표시가는 거래소가 제공한 값입니다. 실제 청산은 거래소가 결정하며,',
        '   가격이 빠르게 움직이면 이 메일이 도착하기 전에 청산될 수 있습니다.',
        '',
        /*
           ★ 같은 등급으로 계속 메일이 오지 않는다는 사실을 적는다. 그러지 않으면
             고객은 "한 통 왔으니 한 번 위험했다" 고 오해한다.
        */
        `※ 같은 포지션·같은 위험 등급은 ${Math.round(resendAfter / 60000)}분 안에 다시 보내지 않습니다.`,
        '   위험이 더 커지면(경고 → 긴급) 즉시 다시 알립니다.',
      ].filter((l) => l !== null) as string[];

      await deps.mail.send({ to, subject, text: lines.join('\n') });
      lastSentAt.set(key, t);
    } catch (e) {
      /*
         ★★ 삼키되 조용히 넘기지 않는다. 메일이 안 나가는 상태를 아무도 모르면,
           운영자는 감시가 고객에게 닿는다고 계속 믿는다 — 이 기능을 만든 이유가
           바로 그런 착각을 없애는 것이었다.
      */
      log(`[risk-email] 발송 실패 — 인앱 알림은 남았다: ${(e as Error).message}`);
    }
  };
}
