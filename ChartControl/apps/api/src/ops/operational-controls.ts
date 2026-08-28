/*
   운영 컨트롤 게이트 — feature_flags + kill_switches 를 런타임에서 실제로 강제한다.

   왜 캐시하나
   ----------
   AI 실행/주문 제출 같은 뜨거운 경로가 매 요청마다 DB 를 읽으면 느리고 위험하다. 그래서
   관리자 저장소의 기존 listFlags()/listKill() 를 주기적으로(기본 15초) 한 번 읽어 메모리
   맵으로 유지한다. 관리자가 화면에서 스위치를 바꾸면 최대 refreshMs 안에 반영된다.

   실패 시 정책
   -----------
   갱신이 실패하면(예: 일시적 DB 오류) 마지막으로 성공한 값을 유지한다. 즉 조회 실패가
   기능을 갑자기 끄지 않는다(가용성 우선). 하드 세이프티(EMERGENCY_KILL_SWITCH env)는 별개다.

   중복 스코프
   ----------
   과거 시드 버그로 같은 스코프가 여러 행일 수 있으므로, 한 스코프라도 active=true 면
   그 스코프는 '차단'으로 본다(fail-safe: 하나라도 끄라고 하면 끈다).
*/

export interface ControlsRepo {
  listFlags(): Promise<unknown[]>;
  listKill(): Promise<unknown[]>;
}

export class OperationalControls {
  private flags = new Map<string, boolean>();
  private kills = new Map<string, boolean>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;

  constructor(
    private readonly repo: ControlsRepo,
    private readonly refreshMs = 15_000,
  ) {}

  /** 최초 1회 즉시 로드 + 주기 갱신 시작. 서버 부팅 시 호출. */
  async start(): Promise<void> {
    await this.refresh();
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refresh(); }, this.refreshMs);
    // 타이머가 프로세스 종료를 막지 않도록.
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async refresh(): Promise<void> {
    try {
      const [flagRows, killRows] = await Promise.all([this.repo.listFlags(), this.repo.listKill()]);
      const flags = new Map<string, boolean>();
      for (const raw of flagRows) {
        const r = raw as Record<string, unknown>;
        // enabled 는 boolean 또는 ::int(0/1) 로 올 수 있다.
        flags.set(String(r['key']), Boolean(Number(r['enabled'] ?? 0)));
      }
      const kills = new Map<string, boolean>();
      for (const raw of killRows) {
        const r = raw as Record<string, unknown>;
        const scope = String(r['scope']);
        const active = Boolean(Number(r['active'] ?? 0));
        // fail-safe: 한 행이라도 active 면 그 스코프는 차단.
        kills.set(scope, (kills.get(scope) ?? false) || active);
      }
      this.flags = flags;
      this.kills = kills;
      this.loaded = true;
    } catch {
      // 마지막으로 성공한 값을 유지한다(가용성 우선).
    }
  }

  /** 플래그가 켜져 있나. 알 수 없으면(아직 미로드/미시드) 기본 허용(true). */
  flagEnabled(key: string, dflt = true): boolean {
    if (!this.loaded) return dflt;
    const v = this.flags.get(key);
    return v === undefined ? dflt : v;
  }

  /** 이 스코프가 비상 차단됐나. 알 수 없으면 기본 미차단(false). */
  killActive(scope: string): boolean {
    if (!this.loaded) return false;
    return this.kills.get(scope) ?? false;
  }

  /** AI 를 지금 쓸 수 있나(마스터 플래그 + provider 킬스위치). */
  aiEnabled(): boolean {
    return this.flagEnabled('ai_enabled', true) && !this.killActive('ai_provider');
  }
}
