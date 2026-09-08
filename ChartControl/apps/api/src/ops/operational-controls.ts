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
  /* ★ 갱신 실패 횟수. 첫 실패와 반복 실패를 구별해 로그를 낸다. */
  private failures = 0;

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
    } catch (e) {
      /*
         ★★ 조용히 삼키면 안 된다.

           예전에는 `catch { }` 였다. 그래서 **첫 로드가 실패하면** loaded 가 false 로
           남고, flagEnabled/killActive 가 기본값(허용)을 돌려준다 — 즉 킬스위치가
           꺼진 것처럼 동작하는데 부팅 로그에 아무 흔적이 없다. 운영자는 스위치가
           걸려 있다고 믿는다.

         ★ 첫 실패와 이후 실패를 구별한다. 첫 실패는 **아무 값도 없는 상태**라 심각하고,
           이후 실패는 마지막 성공값을 쓰므로 덜 심각하다(가용성 우선이 맞다).
         ★ 반복 실패를 매번 찍으면 로그가 묻힌다. 첫 실패와 그 뒤 10회마다만 찍는다.
      */
      this.failures += 1;
      const first = !this.loaded;
      if (first || this.failures % 10 === 1) {
        const what = first
          ? '★ 운영 스위치를 한 번도 읽지 못했다 — 기능 플래그와 킬스위치가 **기본값(허용)** 으로 동작한다. '
            + '스위치를 걸어 두었다고 믿으면 안 된다.'
          : `운영 스위치 갱신 실패(${this.failures}회) — 마지막으로 읽은 값을 계속 쓴다.`;
        console.error(`[ops-controls] ${what} 원인: ${(e as Error).message}`);
      }
    }
  }

  /** 지금까지의 갱신 실패 횟수. 상태 패널이 이 값을 보여준다. */
  failureCount(): number { return this.failures; }

  /** 한 번이라도 성공적으로 읽었는가. false 면 모든 판정이 기본값이다. */
  isLoaded(): boolean { return this.loaded; }

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

  /**
   * 판정 근거가 **아예 없는** 상태인가. 이때 주문을 내보내면 안 된다.
   *
   * ★★ 왜 killActive() 로는 부족한가
   *
   *   한 번도 읽지 못했으면 `killActive()` 는 false(차단 아님)를 돌려준다. 그래서
   *   운영자가 관리자 화면에서 `global_live_trading` 을 걸어 뒀는데도 주문이 계속
   *   나가는 상태가 가능했다. "스위치를 걸었다" 와 "스위치 상태를 모른다" 는 전혀
   *   다른데, 두 경우가 똑같이 통과됐다.
   *
   * ★ 첫 실패와 이후 실패를 다르게 다룬다. 한 번이라도 읽었으면 마지막 성공값을 쓴다
   *   (가용성 우선) — DB 가 잠깐 흔들릴 때마다 주문을 막을 이유는 없다. 그러나 한 번도
   *   못 읽었으면 근거가 없으므로 **막는다**.
   *
   * ★ 조회(포지션·잔고·주문내역)는 이 값으로 막지 않는다. 막을 이유가 없고, DB 일시
   *   장애 때 화면이 통째로 죽는다.
   */
  controlsUnknown(): boolean {
    return !this.loaded;
  }

  /** AI 를 지금 쓸 수 있나(마스터 플래그 + provider 킬스위치). */
  aiEnabled(): boolean {
    return this.flagEnabled('ai_enabled', true) && !this.killActive('ai_provider');
  }
}
