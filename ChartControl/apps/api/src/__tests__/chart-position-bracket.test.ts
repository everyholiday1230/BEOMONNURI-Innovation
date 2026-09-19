/*
   차트의 **포지션 라인에서** TP/SL 을 거는 기능을 잠근다.

   운영자 요청(세 번 반복): "해당 종목 차트 보고 있는데 포지션이 있으면 현재 포지션
   라인이 나오잖아? 근데 그 라인에 tp 랑 sl 버튼 만들고 드래그로 끌어서 놓은 곳에
   tp sl 각각 설정되게 해달라고. (...) 가격 또는 %로 할 수 있도록"

   전까지는 버튼이 **포지션 패널(아래 표)** 에만 있었다. 차트를 보다가 손절을 걸려면
   시선을 아래로 옮겨 해당 행을 찾아야 했다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('차트 포지션 라인에 TP/SL 버튼이 있다', () => {
  const chart = read('src/chart-kline.jsx');

  it('버튼 층을 그린다', () => {
    expect(chart, '버튼 층이 없다').toMatch(/className="chart-posbtns"/u);
    expect(chart, 'TP 버튼이 없다').toMatch(/onPositionBracket\(b\.posId, 'tp'\)/u);
    expect(chart, 'SL 버튼이 없다').toMatch(/onPositionBracket\(b\.posId, 'sl'\)/u);
  });

  /*
     ★★★ 층 전체가 클릭을 먹으면 **차트를 끌 수 없다.** 층은 통과시키고 버튼만 받는다.
       이 저장소에서 이미 겪은 실패 방식이다.
  */
  it('버튼 층이 차트 조작을 막지 않는다', () => {
    const css = read('src/chart-kline.css');
    const i = css.indexOf('.chart-posbtns {');
    expect(i, '버튼 층 CSS 가 없다').toBeGreaterThan(-1);
    const layer = css.slice(i, css.indexOf('}', i));
    expect(layer, '층이 클릭을 먹는다 — 차트를 끌 수 없다').toMatch(/pointer-events:\s*none/u);
    const j = css.indexOf('.chart-posbtns__btn {');
    const btn = css.slice(j, css.indexOf('}', j));
    expect(btn, '버튼이 클릭을 못 받는다').toMatch(/pointer-events:\s*auto/u);
  });

  /*
     ★★ 이미 걸린 쪽은 버튼을 숨긴다. 두 개를 걸면 하나가 체결된 뒤 남은 하나가
       반대 포지션을 열 수 있다.
     ★★★ 판정을 **오버레이 목록**으로 한다. 주문 목록을 여기서 다시 해석하면 판정
       규칙이 두 곳으로 갈라져 차트와 포지션 표가 다른 말을 한다.
  */
  it('이미 걸린 쪽과 초안이 있는 쪽은 버튼을 숨긴다', () => {
    expect(chart, '기존 보호주문을 보지 않는다').toMatch(/ids\.has\(`posbr-\$\{ov\.posRef\.id\}-tp`\)/u);
    expect(chart, '진행 중인 초안을 보지 않는다').toMatch(/ids\.has\(`posdraft-\$\{ov\.posRef\.id\}-sl`\)/u);
  });

  /*
     ★ 차트를 끌거나 확대하면 선의 y 가 바뀐다. 크로스헤어 이벤트만 보면 마우스를
       움직이지 않고 확대할 때 버튼이 제자리에 남는다.
  */
  it('차트 이동·확대를 따라간다', () => {
    const i = chart.indexOf('const [posBtns, setPosBtns]');
    expect(i, '버튼 좌표 상태가 없다').toBeGreaterThan(-1);
    const block = chart.slice(i, i + 3200);
    expect(block, '주기적으로 좌표를 다시 읽지 않는다').toMatch(/setInterval\(tick/u);
    expect(block, '창 크기 변화를 무시한다').toMatch(/addEventListener\('resize'/u);
    /* ★ 보이는 범위를 벗어난 버튼은 그리지 않는다 — 패널 밖에 떠 있으면 오동작으로 보인다. */
    expect(block, '화면 밖 버튼을 걸러내지 않는다').toMatch(/if \(top < 6 \|\| top >/u);
  });

  it('포지션 선에만 붙인다', () => {
    const i = chart.indexOf('const [posBtns, setPosBtns]');
    const block = chart.slice(i, i + 3200);
    expect(block, '초안·보호 선에도 버튼을 단다').toMatch(/lv\.kind !== 'position'/u);
  });
});

describe('패널과 차트가 같은 함수를 쓴다', () => {
  const app = read('src/app.jsx');

  /*
     ★★★ 전에는 초안 생성 로직이 패널 JSX 안에 **인라인**으로 있어서 차트에서 쓸 수
       없었다. 복사하면 한쪽만 고치는 일이 생긴다 — 이 저장소에서 반복된 실패다.
  */
  it('초안 생성이 단일 함수다', () => {
    expect(app, '핸들러가 함수로 분리되지 않았다')
      .toMatch(/const setPositionBracket = \(posId, kind, pctFromEntry, absPrice\) =>/u);
    expect(app, '패널이 그 함수를 쓰지 않는다').toMatch(/onSetBracket=\{setPositionBracket\}/u);
    expect(app, '차트에 전달하지 않는다').toMatch(/onPositionBracket=\{setPositionBracket\}/u);
  });

  /*
     ★ 선언이 JSX 보다 뒤에 있으면 렌더 중 평가에서 TDZ 로 undefined 가 된다 —
       오류 없이 **아무 일도 안 하는 버튼**이 된다(이 저장소에서 세 번 겪었다).
  */
  it('핸들러 선언이 JSX 보다 앞에 있다', () => {
    const decl = app.indexOf('const setPositionBracket =');
    const use = app.indexOf('onSetBracket={setPositionBracket}');
    expect(decl, '선언이 없다').toBeGreaterThan(-1);
    expect(use, '사용처가 없다').toBeGreaterThan(-1);
    expect(decl, 'TDZ — 선언이 사용보다 뒤에 있다').toBeLessThan(use);
  });

  it('%와 절대가격이 같은 선 생성 경로를 쓴다', () => {
    expect(app, '선 생성이 함수로 분리되지 않았다')
      .toMatch(/const addDraftLine = \(pos, posId, kind, price\) =>/u);
    const n = (app.match(/addDraftLine\(pos, posId, kind/gu) || []).length;
    expect(n, `두 경로가 같은 함수를 쓰지 않는다 (호출 ${n}회)`).toBe(2);
  });

  /*
     ★★ 절대 가격에는 방향 계산을 하지 않는다. 고객이 "78,000" 이라고 했으면 그 가격이다.
       부호를 붙이면 지정한 자리와 다른 곳에 걸린다.
  */
  it('절대 가격은 그대로 쓴다', () => {
    const i = app.indexOf('const abs = Number(absPrice);');
    expect(i, '절대 가격 경로가 없다').toBeGreaterThan(-1);
    const block = app.slice(i, i + 500);
    expect(block, '절대 가격에 방향을 적용한다').not.toMatch(/\(up \? |1 \+ /u);
  });
});

describe('가격 또는 % 를 명시적으로 고른다', () => {
  const w = read('src/widgets.jsx');

  /*
     ★★★ **숫자만 보고 추측하지 않는다.** `2` 가 2% 인지 가격 2 인지 알 수 없고,
       값싼 코인에서는 둘 다 그럴듯하다. 잘못 읽으면 손절이 엉뚱한 자리에 걸린다.
  */
  it('단위를 전환하는 버튼이 있다', () => {
    expect(w, '단위 상태가 없다').toMatch(/const \[brUnit, setBrUnit\]/u);
    expect(w, '단위를 바꿀 수 없다').toMatch(/\(m\[p\.id\] \|\| '%'\) === '%' \? '\$' : '%'/u);
  });

  /* ★ 지금 무엇으로 읽히는지 버튼에 그 단위가 보여야 한다. */
  it('현재 단위를 버튼에 표시한다', () => {
    expect(w, '현재 단위가 보이지 않는다')
      .toMatch(/>\{\(brUnit\[p\.id\] \|\| '%'\) === '%' \? '%' : '\$'\}</u);
  });

  it('단위에 맞는 인자로 넘긴다', () => {
    expect(w, '% 와 가격을 구분해 넘기지 않는다')
      .toMatch(/ok && asPct \? raw : null,\s*\n\s*ok && !asPct \? raw : null,/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('pos_br_pct_hint')) continue;
      for (const k of ['pos_br_price_hint', 'pos_br_unit_hint']) {
        if (!s.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
