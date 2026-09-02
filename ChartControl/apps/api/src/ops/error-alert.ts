import type { MailProvider } from '@quantumtrade/auth';
import type { PgOpsErrorStore, RecordErrorInput } from './error-store';

/*
   ============================================================
   오류 알림 (ops/error-alert)

   ★★ 왜 필요한가

     오류를 DB 에 쌓아도 **아무도 그 화면을 열지 않으면** 여전히 고객 신고로
     장애를 알게 된다. 그래서 새로운 오류는 운영자에게 밀어서 보낸다.

   ★★ 왜 메일인가

     이미 동작하는 발송 경로가 SMTP 하나뿐이다(가입·비밀번호 재설정에 쓰는 것).
     외부 관측 서비스를 붙이려면 가입·키·의존성이 필요한데, 그건 나중에 해도
     되고 지금 없는 것은 "장애를 아는 수단" 자체다. 있는 것으로 먼저 만든다.

   ★★ 왜 알림을 조절하는가

     오류는 폭주한다. 발생마다 보내면 수천 통이 나가고, 그러면 운영자는 알림을
     끄거나 무시한다 — 알림이 있으나 없느니 못한 상태가 된다. 그래서
     **지문당 시간창 1개**로 제한한다(error-store 의 shouldAlert).
   ============================================================ */

export interface ErrorAlerterDeps {
  store: PgOpsErrorStore;
  mail: MailProvider;
  /** 받는 사람. 비어 있으면 알림을 보내지 않는다(기록은 계속한다). */
  to: string;
  /** 링크에 쓰는 서비스 주소. */
  appBaseUrl: string;
  /** 어느 환경에서 난 오류인지 제목에 넣는다. */
  environment: string;
}

const oneLine = (v: string | null | undefined, n: number) =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * 오류를 기록하고, 필요하면 운영자에게 알린다.
 *
 * ★ 절대 던지지 않는다. 관측이 요청 처리를 깨뜨리면 관측 때문에 장애가 난다.
 */
export async function captureError(deps: ErrorAlerterDeps | null, input: RecordErrorInput): Promise<void> {
  if (!deps) return;
  let res = null;
  try {
    res = await deps.store.record(input);
  } catch (e) {
    console.error(`[ops-alert] 기록 실패: ${(e as Error).message}`);
    return;
  }
  if (!res || !res.shouldAlert) return;
  if (!deps.to.trim()) return;

  const kind = res.isNew ? '새 오류' : '반복 오류';
  const subject = `[${deps.environment}] ${kind} · ${oneLine(input.message, 90)}`;
  const lines = [
    `${kind}가 발생했습니다.`,
    '',
    `출처      ${input.source === 'server' ? '서버(API)' : '브라우저(고객 화면)'}`,
    `메시지    ${oneLine(input.message, 500)}`,
    input.url ? `위치      ${oneLine(input.url, 300)}` : null,
    input.method ? `요청      ${input.method}${input.status ? ` → ${input.status}` : ''}` : null,
    `누적      ${res.seenCount}회`,
    `지문      ${res.fingerprint}`,
    '',
    input.stack ? `스택\n${oneLine(input.stack, 1200)}` : null,
    '',
    `운영자 화면: ${deps.appBaseUrl.replace(/\/+$/, '')}/#/admin/system`,
    '',
    /*
       ★ 같은 오류로 계속 메일이 오지 않는다는 사실을 본문에 적는다. 그러지
         않으면 운영자가 "한 통 왔으니 한 번 났다" 고 오해한다.
    */
    '같은 오류는 1시간에 한 번만 알립니다. 실제 발생 횟수는 위 누적 값과 운영자 화면을 보십시오.',
  ].filter((l): l is string => l !== null);

  try {
    await deps.mail.send({ to: deps.to, subject, text: lines.join('\n') });
    await deps.store.markAlerted(res.fingerprint);
  } catch (e) {
    // 알림 실패도 삼킨다 — 기록은 이미 남았고, 요청을 깨뜨릴 이유는 없다.
    console.error(`[ops-alert] 발송 실패 fp=${res.fingerprint} err=${(e as Error).message}`);
  }
}

/*
   ★★ 처리되지 않은 서버 예외의 처리 계약을 **함수로 분리**한다.

     index.ts 안의 app.onError 인라인으로 두면 검증할 수 없다. 실제로 공개
     경로로는 500 을 유도할 수 없어서(입력 방어가 잘 돼 있다) 이 경로가
     검증되지 않은 채 남을 뻔했다. 관측 장치의 핵심 경로가 미검증이면
     관측이 죽어도 모른다.
*/
export interface ServerErrorOutcome {
  /** 응답에 넣는 추적 ID. 로그·기록과 응답을 잇는 유일한 끈이다. */
  correlationId: string;
  /** 고객에게 돌려줄 본문. */
  body: { error: { code: 'INTERNAL_ERROR'; message: string; correlationId: string } };
}

/**
 * 서버 예외를 기록하고 응답 본문을 만든다.
 *
 * ★★ 응답에 예외 메시지를 **넣지 않는다**. 쿼리문·경로·환경변수 이름 같은 내부
 *   사정이 그대로 새어나가고, 고객에게는 아무 도움이 되지 않는다. 추적 ID 만
 *   준다 — 그 ID 로 운영자가 기록을 찾을 수 있다.
 */
export function handleServerError(
  deps: ErrorAlerterDeps | null,
  e: unknown,
  req: { method: string; path: string },
  makeId: () => string,
): ServerErrorOutcome {
  const correlationId = makeId();
  const err = e as Error;
  void captureError(deps, {
    source: 'server',
    message: err?.message || 'unknown error',
    stack: err?.stack,
    url: req.path,
    method: req.method,
    status: 500,
  });
  return { correlationId, body: { error: { code: 'INTERNAL_ERROR', message: '', correlationId } } };
}
