import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

/*
   ★★ **부분 수정이 오버레이를 통째로 날리지 않는지** 잠근다.

     `updateOverlay` 가 이랬다:

       (id, patch) => ... { symbol: o.symbol, ...patch }

     patch 에 없는 필드가 **전부 사라진다.** "이 선 색만 바꿔줘" 를 하면 결과가
     `{ symbol, color }` 가 되어 id·type·points 가 없어진다 → 선이 화면에서 사라지거나
     렌더가 깨진다.

     AI 의 updateOverlay 명령이 이 경로를 쓴다. 즉 고객이 AI 에게 **선 수정**을
     부탁하면 선이 **삭제**됐다. 부탁한 것과 다른 일이 일어난다.

   ★ patch 는 이름 그대로 부분 수정이다. 기존 값 위에 덮어써야 한다.
   ★ id 는 patch 가 덮어쓰지 못하게 고정해야 한다. id 가 바뀌면 다음 수정·삭제가
     대상을 찾지 못하고 화면에는 같은 선이 두 개로 보인다.
*/
describe('오버레이 부분 수정 — 기존 필드를 날리지 않는다', () => {
  it('patch 가 기존 오버레이를 펼쳐서 덮어쓴다', () => {
    const src = read('../../../../src/app.jsx');
    const at = src.indexOf('const updateOverlay =');
    expect(at, 'updateOverlay 가 없다').toBeGreaterThan(0);
    const line = src.slice(at, src.indexOf('\n', at));
    /* ★ 기존 오버레이(o)를 먼저 펼쳐야 한다. 안 하면 patch 밖 필드가 사라진다. */
    expect(line, '기존 오버레이를 펼치지 않는다 — patch 밖 필드가 사라진다').toMatch(/\{\s*\.\.\.o\s*,/);
    /* ★ id 를 patch 뒤에 고정해야 한다. */
    expect(line, 'id 를 고정하지 않는다 — patch 가 id 를 바꿀 수 있다').toMatch(/id:\s*o\.id/);
    /* ★ 옛 구현으로 되돌아가지 않았는지. */
    expect(line, '옛 구현(symbol 만 남기고 전부 버림)으로 되돌아갔다').not.toMatch(/\{\s*symbol:\s*o\.symbol\s*,\s*\.\.\.patch\s*\}/);
  });

  /* ★ 실제 동작을 값으로 확인한다. 문자열 검사만으로는 의미를 보장하지 못한다. */
  it('라벨만 바꿔도 id·type·points 가 남는다', () => {
    /*
       ★ 제네릭으로 둔다. `Record<string, unknown>` 을 그대로 펼치면 반환 타입에서
         원래 필드가 사라져 `r.type` 접근이 컴파일되지 않는다(typecheck 3건 실패).
         런타임 검증 내용은 그대로다 — 타입만 보존한다.
    */
    const upd = <T extends Record<string, unknown>>(o: T, patch: Record<string, unknown>): T =>
      ({ ...o, ...patch, id: o.id }) as T;
    const ov = { id: 'ai-1', type: 'horizontal', source: 'ai-draft', points: [{ price: 41800, time: 1 }], label: 'S' };
    const r = upd(ov, { label: '지지 41800' });
    expect(r.id).toBe('ai-1');
    expect(r.type).toBe('horizontal');
    expect(r.points).toHaveLength(1);
    expect(r.label).toBe('지지 41800');
  });

  it('patch 가 id 를 바꿀 수 없다', () => {
    const upd = (o: Record<string, unknown>, patch: Record<string, unknown>) => ({ ...o, ...patch, id: o.id });
    expect(upd({ id: 'ai-1' }, { id: 'other' }).id).toBe('ai-1');
  });
});
