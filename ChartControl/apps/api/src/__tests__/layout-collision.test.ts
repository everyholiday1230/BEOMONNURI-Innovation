import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   패널이 서로 겹치지 않는다.

   ★★ 조사로 밝힌 사실

     충돌 검사 함수(overlaps · hasCollision · findFreeSpot)는 **처음부터 이 파일에
     있었다.** 그런데 위젯을 새로 켤 때와 복제할 때만 쓰였고, 드래그·리사이즈가
     지나는 updateWidget 은 좌표를 그대로 저장했다.

     실측: 프리셋 6개의 초기 배치는 모두 겹침 0쌍인데, 편집 모드에서 창 하나를
     다른 창 위로 끌면 겹침 2쌍이 됐다. 설계 결함이 아니라 이미 있는 검사를
     부르지 않은 것이었다.

   ★★ 첫 시도가 창을 갇히게 만들었다 — 그래서 방식을 바꿨다.

     처음에는 updateWidget 의 모든 호출을 검사했다. 그러자 창이 아예 움직이지
     않았다(실측: 아래로 700px 끌어도 좌표가 그대로). 드래그는 픽셀마다 onChange 를
     부르고, 경로가 다른 창을 스치는 순간부터 좌표가 전부 거부된다. 기준점
     (drag.ox/oy)은 그대로이므로 이후 이동도 같은 절대 좌표를 계산해 계속 거부된다 —
     한 번 막히면 영구히 지나갈 수 없다.

     그래서 **이동 중에는 통과시키고, 놓는 순간에만 판정한다.** 겹쳤으면 조작
     시작 위치로 되돌린다. 화면에서는 창이 원래 자리로 돌아가므로 "여기는 놓을 수
     없다" 가 분명히 보인다.

   ★ 실측 결과: 위젯이 드래그 중 y 319→455 로 따라오고, 겹치는 자리여서 놓을 때
     321 로 되돌아갔으며 최종 겹침은 0 이었다. 원본 코드와 비교해, 움직이지 않는
     위젯이 있는 것은 이 변경 때문이 아님도 확인했다(원본에서도 동일).

   ★★ 자동 재배치(밀어내기)는 운영자 판단으로 하지 않는다. 연쇄 이동·최소 크기
     충돌·되돌리기 범위를 먼저 정해야 하고, 잘못 만들면 지금 되는 배치까지 깨진다.
*/
describe('LAYOUT-COLLISION — 창이 겹치지 않는다', () => {
  const src = read('src/layout-engine.jsx');

  it('[1] 놓는 순간에 충돌을 검사한다', () => {
    expect(src).toMatch(/const isEnding = partial\._dragging === false \|\| partial\._resizing === false;/);
    expect(src).toMatch(/if \(target && isEnding\) \{/);
    expect(src).toMatch(/hasCollision\(others, target\)/);
  });

  it('[2] 이동 중에는 막지 않는다 — 막으면 창이 갇힌다', () => {
    /*
       ★★ 이것이 첫 시도의 실패였다. 경로가 다른 창을 스치면 그 뒤로 영구히 지나갈
         수 없었다. 조작 중 통과는 기능이 아니라 **필수 조건**이다.
    */
    expect(src).toMatch(/const isTransient = partial\._dragging === true \|\| partial\._resizing === true;/);
    // 조작 중 분기에서 좌표를 버리지 않는다(시작 위치만 기억한다).
    const start = src.indexOf('} else if (target && isTransient');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 400);
    expect(block).toMatch(/geomStartRef\.current = \{ id, x: target\.x/);
  });

  it('[3] 겹치면 조작 시작 위치로 되돌린다', () => {
    /*
       ★ 임의의 빈자리로 옮기면 사용자가 창을 잃어버린다. 시작 위치는 조작 전이므로
         겹치지 않는 것이 보장된다.
    */
    expect(src).toMatch(/applied = \{ \.\.\.partial, x: start\.x, y: start\.y, w: start\.w, h: start\.h \};/);
  });

  it('[4] 되돌릴 자리를 기억한다', () => {
    expect(src).toMatch(/const geomStartRef = useRef\(null\);/);
    // 조작이 끝나면 비운다 — 남겨두면 다음 조작이 엉뚱한 자리로 되돌아간다.
    expect(src).toMatch(/geomStartRef\.current = null;/);
  });

  it('[5] 숨긴 창은 충돌 대상이 아니다', () => {
    /*
       ★ 숨긴 창은 화면에 없으므로 그 자리를 비워 둘 이유가 없다. 포함하면 보이지
         않는 것에 막혀 사용자가 이유를 알 수 없다.
    */
    expect(src).toMatch(/prev\.widgets\.filter\(w => !w\.hidden && w\.id !== id\)/);
  });

  it('[6] 충돌 검사 함수가 그대로 있다', () => {
    /*
       ★ 이 검사들은 원래 있었고 새로 만든 것이 아니다. 위젯을 켜고 복제할 때 쓰는
         findFreeSpot 도 계속 필요하다.
      */
    expect(src).toMatch(/function overlaps\(a, b\)/);
    expect(src).toMatch(/function hasCollision\(widgets, target\)/);
    /*
       ★ 열 수를 박지 않는다. 24 → 48 로 올렸고(한 칸 71px → 35px) 앞으로도 바뀔 수
         있다. 함수가 있는지만 본다 — 기본값을 검사하면 틀린 실패를 낸다.
    */
    expect(src).toMatch(/function findFreeSpot\(widgets, w, h, cols = \d+\)/);
  });

  it('[7] 자동 재배치를 넣지 않았다 — 운영자 판단', () => {
    /*
       ★ 밀어내기는 연쇄 이동·최소 크기 충돌·되돌리기 범위를 먼저 정해야 한다.
         지금은 겹침만 막는다.
    */
    expect(src).not.toMatch(/pushWidgets|reflow|autoArrange/);
  });
});
