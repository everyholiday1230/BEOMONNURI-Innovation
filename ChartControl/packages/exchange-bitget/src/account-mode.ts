/**
 * Bitget 계정 모드 감지 — **UTA(v3) 냐 Classic(v2) 냐.**
 *
 * ★★★ **우리가 고를 수 없다.** 고객이 어떤 계정을 쓰는지에 달렸고, 키만 보고는 알 수 없다.
 *   틀린 API 를 부르면 전용 오류 코드가 온다(실측 2026-09-18, 실키로 확인):
 *
 *     40084  "You are in Classic Account mode, and the Unified Account API is not
 *             supported at this time"                      → Classic 키다. v2 를 쓴다.
 *     40085  "You are in Unified Account mode, and the Classic Account API is not
 *             supported at this time"                      → UTA 키다. v3 를 쓴다.
 *
 * ★★ 그래서 **UTA(v3)를 먼저 부르고 `40084` 일 때만 Classic(v2)으로 내려간다.**
 *   그 밖의 오류에서는 **모드를 정하지 않는다** — 추측해 엉뚱한 API 로 주문을 보내면
 *   가격·수량 단위가 어긋난다(`priceMultiplier` 항목 참고).
 *
 * ★ 판정 결과는 호출자가 저장한다. 매 요청마다 두 번 부르면 지연과 요청 수가 두 배다.
 */
export type BitgetAccountMode = 'unified' | 'classic';

export type ModeDetection =
  | { ok: true; mode: BitgetAccountMode }
  /*
     ★ 실패를 모드 추측으로 메우지 않는다. 호출자는 **연결을 거부**해야 한다 —
       모드를 모르는 채로 주문 경로를 열면 단위가 어긋난 주문이 나간다.
  */
  | { ok: false; reason: 'BAD_CREDENTIAL' | 'IP_BLOCKED' | 'NO_PERMISSION' | 'UPSTREAM'; detail: string };

/** UTA 를 먼저 시도했을 때 "Classic 이다" 를 뜻하는 코드. */
export const CODE_IS_CLASSIC = '40084';
/** Classic 을 시도했을 때 "UTA 다" 를 뜻하는 코드. */
export const CODE_IS_UNIFIED = '40085';

/**
 * 오류 코드 → 실패 종류.
 *
 * ★★ 실패를 한 덩어리로 다루지 않는다. 고객이 할 일이 다르다:
 *   키 확인 / 거래소에서 IP 제한 해제 / 읽기 권한 켜기 / 기다리기.
 * ★★★ **모르는 코드를 키 문제로 단정하지 않는다** — 그러면 고객이 멀쩡한 키를 지운다.
 */
export function classifyError(code: string): 'BAD_CREDENTIAL' | 'IP_BLOCKED' | 'NO_PERMISSION' | 'UPSTREAM' {
  const c = String(code);
  if (c === '40018') return 'IP_BLOCKED';
  if (c === '40014' || c === '40016') return 'NO_PERMISSION';
  if (['40006', '40037', '40009', '40012', '40011', '40013'].includes(c)) return 'BAD_CREDENTIAL';
  return 'UPSTREAM';
}
