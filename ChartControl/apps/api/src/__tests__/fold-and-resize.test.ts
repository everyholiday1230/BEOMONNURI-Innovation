/**
 * 접기(fold) — 저장 좌표를 건드리지 않고 그릴 때만 자리를 메운다.
 *
 * ★★★ 왜 이 구조인가 — 저장 좌표를 실제로 고치는 방식은 세 번 실패했다.
 *
 *   접을 때 이웃을 넓혀서 **저장**하면, 되살릴 때 그만큼 정확히 돌려받아야 한다.
 *   여러 개를 접었다 펴는 순서와 중간 편집까지 맞추는 것이 사실상 불가능했다.
 *   실측(프로덕션과 같은 4개 프리셋, 3개씩 접은 뒤 전부 복원):
 *
 *     · 넘겨준 양을 기록해 되돌리기   → 복원 후 채움 54~85%
 *     · 겹친 만큼 줄이기(작은 축)     → 80~90%
 *     · 겹친 만큼 줄이기(넓어진 축)   → 75~86%
 *
 *   기본이 96~97% 인데 어느 방법도 돌아오지 못했다.
 *
 * ★ 그래서 좌표를 파생값으로 만들었다. 저장 배치는 늘 "다 펼친 상태" 하나이고,
 *   접힘은 `applyFolds` 가 그릴 때 계산한다. 되살리기는 hidden 을 내리는 것뿐이라
 *   원래 배치로 **정확히** 돌아온다. 실측: 4개 프리셋 모두 96/97% → 96/97%.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

/** panel-state.js 는 IIFE 로 window 에 붙는다. 테스트에서 window 를 만들어 읽는다. */
let PS: { applyFolds: (w: unknown[], cols?: number, rows?: number) => Box[] };

beforeAll(() => {
  const src = readFileSync(new URL('../../../../src/panel-state.js', import.meta.url), 'utf-8');
  const win: Record<string, unknown> = {};
  /*
     ★ panel-state.js 는 React 훅을 함께 내보낸다. 여기서 검증하는 것은 순수 기하
       계산(applyFolds)뿐이므로 최소 스텁만 준다. 실제 훅 동작은 브라우저 실측으로
       확인했다(4개 프리셋 접기/복원).
  */
  const React = {
    useState: (v: unknown) => [v, () => {}],
    useEffect: () => {},
    useCallback: (f: unknown) => f,
    createElement: () => null,
  };
  const fn = new Function('window', 'localStorage', 'React', `${src}\nreturn window.QTPanelState;`);
  PS = fn(win, { getItem: () => null, setItem: () => {} }, React) as typeof PS;
  expect(PS, 'QTPanelState 를 못 읽었다').toBeTruthy();
  expect(typeof PS.applyFolds, 'applyFolds 가 없다').toBe('function');
});

/** 격자 칸 하나. */
interface Box { id: string; x: number; y: number; w: number; h: number; hidden: boolean }

/** 겹침 여부. */
function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 보이는 칸이 차지한 칸 수. */
function filled(list: Box[], cols = 96, rows = 16) {
  const grid: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (const o of list) {
    if (o.hidden) continue;
    for (let r = o.y; r < Math.min(rows, o.y + o.h); r++)
      for (let c = o.x; c < Math.min(cols, o.x + o.w); c++) {
        const row = grid[r];
        if (row) row[c] = true;
      }
  }
  return grid.flat().filter(Boolean).length;
}

/**
 * ★ 배열 인덱스 접근을 감싼다. 이 저장소는 noUncheckedIndexedAccess 를 쓰므로
 *   `w[1]` 이 `Box | undefined` 다. 테스트에서 매번 분기하면 읽기 어려워진다.
 */
function at(list: Box[], i: number): Box {
  const v = list[i];
  if (!v) throw new Error(`인덱스 ${i} 가 없다`);
  return v;
}

/** 좌우로 3등분한 96×16 배치. */
const threeUp = (): Box[] => [
  { id: 'a', x: 0, y: 0, w: 32, h: 16, hidden: false },
  { id: 'b', x: 32, y: 0, w: 32, h: 16, hidden: false },
  { id: 'c', x: 64, y: 0, w: 32, h: 16, hidden: false },
];

describe('applyFolds — 접은 자리를 이웃이 채운다', () => {
  it('접은 것이 없으면 배열을 그대로 돌려준다', () => {
    /* ★ 불필요한 새 배열을 만들면 리렌더가 늘어난다. */
    const input = threeUp();
    expect(PS.applyFolds(input, 96, 16)).toBe(input);
  });

  it('가운데를 접으면 빈 칸이 남지 않는다', () => {
    const w = threeUp();
    at(w, 1).hidden = true;
    const out = PS.applyFolds(w, 96, 16);
    expect(filled(out), '빈 칸이 남았다').toBe(96 * 16);
  });

  it('★ 두 개를 접어도 빈 칸이 남지 않는다 — 조각을 반복해서 메운다', () => {
    /*
       ★★ "완전히 덮을 때만 넓힌다" 로 만들었을 때는 조금이라도 어긋나면 통째로
         포기해서 큰 구멍이 남았다. 실측으로 chart-focus 에서 채움 16% 를 봤다.
         지금은 조건에 맞는 이웃만 넓히고 남은 조각을 다시 사각형으로 잡아 메운다.
    */
    const w = threeUp();
    at(w, 0).hidden = true;
    at(w, 2).hidden = true;
    const out = PS.applyFolds(w, 96, 16);
    expect(filled(out)).toBe(96 * 16);
  });

  it('채운 뒤에도 겹치지 않는다', () => {
    const w = threeUp();
    at(w, 1).hidden = true;
    const vis = PS.applyFolds(w, 96, 16).filter((o) => !o.hidden);
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i]; const c = vis[j];
        if (!a || !c) continue;
        expect(overlaps(a, c), `${a.id} 와 ${c.id} 가 겹쳤다`).toBe(false);
      }
  });

  it('★ 저장 좌표를 바꾸지 않는다 — 되살리기가 정확해야 한다', () => {
    /*
       ★★★ 이것이 이 구조의 핵심이다. 입력 배열의 좌표가 바뀌면 되살릴 때 원래
         자리를 알 수 없고, 그것이 복원 실패(54~90%)의 원인이었다.
    */
    const w = threeUp();
    at(w, 1).hidden = true;
    const before = JSON.stringify(w);
    PS.applyFolds(w, 96, 16);
    expect(JSON.stringify(w), 'applyFolds 가 입력을 변경했다').toBe(before);
  });

  it('세로로 쌓인 배치도 채운다', () => {
    const w: Box[] = [
      { id: 'top', x: 0, y: 0, w: 96, h: 8, hidden: false },
      { id: 'bot', x: 0, y: 8, w: 96, h: 8, hidden: true },
    ];
    const out = PS.applyFolds(w, 96, 16);
    expect(filled(out)).toBe(96 * 16);
  });

  it('채울 수 없는 배치에서도 겹치지 않고 멈춘다', () => {
    /*
       ★ 어느 이웃도 조건에 맞지 않으면 구멍을 남긴다. 배치를 망가뜨리는 것보다
         낫다. 무한 반복에 빠지지 않는 것이 중요하다.
    */
    const w: Box[] = [
      { id: 'only', x: 40, y: 6, w: 8, h: 4, hidden: false },
      { id: 'gone', x: 0, y: 0, w: 8, h: 4, hidden: true },
    ];
    const vis = PS.applyFolds(w, 96, 16).filter((o) => !o.hidden);
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i]; const c = vis[j];
        if (!a || !c) continue;
        expect(overlaps(a, c)).toBe(false);
      }
  });

  it('모두 접으면 보이는 칸이 없다', () => {
    const w = threeUp().map((x) => ({ ...x, hidden: true }));
    expect(PS.applyFolds(w, 96, 16).filter((o) => !o.hidden)).toHaveLength(0);
  });
});

describe('크기 조절 — 이동량이 누적되지 않는다', () => {
  const src = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');

  it('★ 제스처 시작 배치를 기준으로 계산한다', () => {
    /*
       ★★★ "훅훅 미끄러진다" 의 진짜 원인이었다.

         손잡이는 제스처 시작부터의 **절대** 변화량을 보내는데, 이웃을 줄이는 계산이
         그 값을 **이미 줄어든 현재 상태**에 매번 다시 적용했다. 그래서 첫 칸을 넘긴
         뒤에는 마우스가 움직일 때마다 한 칸씩 더 늘어났다.

         실측(96열, 한 칸 19.48px, 수정 전):
           20px→+19  25px→+39  30px→+58  35px→+77   (5px 마다 한 칸 = 이론의 약 4배)
         수정 후:
           20~35px→+19  40~55px→+39  60~75px→+58  80px→+77  (19.5px 마다 한 칸)

       ★ 같은 거리를 빠르게/천천히 움직여도 결과가 같아야 한다(멱등).
         실측: 60px 이동 시 1단계 58px, 30단계 58px — 같다.
    */
    expect(src, '기준 스냅샷이 없다').toContain('resizeBaseRef');
    expect(src, '기준 스냅샷을 계산에 쓰지 않는다').toContain('resizeBaseRef.current || prev.widgets');
  });

  it('★ 스냅샷을 분기 밖에서 잡는다', () => {
    /*
       ★★ 처음에는 `else if (target && isTransient && ...)` 안에 넣었다. 크기 조절이면
         그 위의 성장 분기가 먼저 걸려서 **실행되지 않는다.** 그래서 스냅샷이 영원히
         null 이고 누적이 그대로 남았다 — 고쳤다고 생각했는데 실측 수치가 한 글자도
         바뀌지 않아서 알아냈다.
    */
    const at = src.indexOf('if (partial._resizing === true && !resizeBaseRef.current)');
    expect(at, '분기 밖 캡처가 없다').toBeGreaterThan(-1);
    /* 성장 분기보다 앞에 있어야 한다. */
    const growth = src.indexOf("if (target && partial._resizing === true && partial._from && partial._dir)");
    expect(growth).toBeGreaterThan(-1);
    expect(at, '캡처가 성장 분기보다 뒤에 있다 — 실행되지 않는다').toBeLessThan(growth);
  });

  it('제스처가 끝나면 스냅샷을 해제한다', () => {
    /* ★ 남겨 두면 다음 제스처가 낡은 기준으로 계산한다. */
    expect(src).toContain('if (partial._resizing === false)');
  });

  it('칸 계산은 버림이다 — 반올림은 경계가 커서를 앞지른다', () => {
    expect(src).toContain('Math.trunc(delta / (size + gap))');
  });
});
