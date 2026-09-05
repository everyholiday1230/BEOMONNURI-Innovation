import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   대역폭 — 화면이 쓰지 않는 데이터를 반복해서 보내지 않는다.

   ★★ 왜 이 검사가 생겼나 (운영자가 Render 사용량 경고를 받았다)

     Hobby 요금제 월 5GB 중 70% 를 소진했고, 초과분은 100GB 당 $15 다. 원인을
     실측했다:

       · 브라우저가 5초마다 `/api/market/tickers` + `/api/market/symbols` 를 받는다
         (live-market 의 MARKETS_POLL_MS = 5000)
       · /tickers 는 **669종목 전체**를 돌려줬다 — brotli 적용 후 30.7KB,
         무압축 190KB. 그런데 화면이 쓰는 것은 QT.MARKETS 의 **21종목**이다.
         96% 가 버려졌다.
       · /symbols 는 7.5KB 를 5초마다 받았는데, 서버는 그 카탈로그를 **10분마다**
         갱신한다 — 120번 중 119번은 같은 내용이다.

     접속 1명이 8시간 열어두면 이 폴링만 210MB, 3명이면 630MB 다.

   ★ 압축과 캐시는 이미 정상이었다(brotli 적용, ETag 로 304·0바이트 확인). 낭비는
     "필요 없는 것을 요청하는 것" 이었고, 그건 압축으로 줄일 수 없다.

   ★ 실측 결과: tickers 평균 30.7KB → 5.7KB(81% 감소), /symbols 요청 10회 → 2회.
     시세는 그대로 5초마다 갱신되고 QT.MARKETS 21종목 중 20개가 live 로 남았다.
*/
describe('BANDWIDTH — 쓰지 않는 데이터를 반복 전송하지 않는다', () => {
  const api = read('apps/api/src/index.ts');
  const client = read('src/api-client.js');

  it('[1] 서버가 종목 필터를 지원한다', () => {
    const start = api.indexOf("app.get('/api/market/tickers'");
    expect(start).toBeGreaterThan(0);
    const block = api.slice(start, start + 3500);
    expect(block).toMatch(/c\.req\.query\('symbols'\)/);
    expect(block).toMatch(/wantedSet/);
  });

  it('[2] 필터가 없으면 전체를 준다 — 기존 호출자를 깨뜨리지 않는다', () => {
    const start = api.indexOf("app.get('/api/market/tickers'");
    const block = api.slice(start, start + 3500);
    /*
       ★ 운영 화면·스크립트가 이 엔드포인트를 파라미터 없이 쓴다. 필터를 필수로
         만들면 그쪽이 조용히 빈 목록을 받는다.
    */
    expect(block).toMatch(/wanted\.length > 0 \? new Set\(wanted\) : null/);
    expect(block).toMatch(/wantedSet \? tickers\.filter/);
  });

  it('[3] 요청했는데 못 받은 종목을 보고한다', () => {
    const start = api.indexOf("app.get('/api/market/tickers'");
    const block = api.slice(start, start + 4000);
    /*
       ★★ 조용히 빠지면 화면은 줄어든 목록을 전체로 읽고, "시세가 사라졌다" 를
         정상으로 받아들인다. 이 프로젝트가 반복해서 겪은 실패 방식이다
         (조회 실패를 빈 목록으로 렌더).
    */
    expect(block).toMatch(/missing: wanted\.filter/);
    expect(block).toMatch(/requested: wanted\.length/);
  });

  it('[4] total 은 돌려준 개수, available 은 전체 개수', () => {
    const start = api.indexOf("app.get('/api/market/tickers'");
    const block = api.slice(start, start + 4000);
    /*
       ★ 필터를 쓸 때 total 에 전체 개수를 주면 화면이 "받은 것보다 많다" 고
         오해한다. 두 수를 분리한다.
    */
    expect(block).toMatch(/total: selected\.length/);
    expect(block).toMatch(/available: tickers\.length/);
  });

  it('[5] 클라이언트가 필요한 종목만 요청한다', () => {
    expect(client).toMatch(/tickers\?symbols=/);
    expect(client).toMatch(/window\.QT && window\.QT\.MARKETS/);
  });

  it('[6] 목록을 못 구하면 전체를 받는다 — 빈 화면보다 낫다', () => {
    const start = client.indexOf('var tickerPath');
    expect(start).toBeGreaterThan(0);
    /*
       ★ 목록이 비었다고 시세를 0개 요청하면 화면이 텅 빈다. 그건 대역폭을 아끼려다
         기능을 잃는 것이다.
    */
    expect(client).toMatch(/want\.length > 0 \? '\/tickers\?symbols=' \+ encodeURIComponent\(want\.join\(','\)\) : '\/tickers'/);
  });

  it('[7] 심볼 규격을 캐시한다 — 5초마다 다시 받을 값이 아니다', () => {
    expect(client).toMatch(/var _specCache = \{ at: 0, symbols: \[\] \};/);
    expect(client).toMatch(/SPEC_TTL_MS/);
    /*
       ★ 서버가 10분마다 갱신하므로 그보다 짧게 캐시할 이유가 없다.
    */
    expect(client).toMatch(/SPEC_TTL_MS = 10 \* 60 \* 1000/);
  });

  it('[8] 빈 규격 응답을 캐시하지 않는다', () => {
    /*
       ★★ 빈 목록을 캐시하면 10분 동안 규격이 없다. 규격이 없으면 주문 폼이
         최소수량·단위를 모르게 되고, 그 배선이 끊겨 실제로 고객 주문이 막힌 적이
         있다(08-30, 주문 2건).
    */
    expect(client).toMatch(/if \(list\.length > 0\) \{ _specCache = /);
  });

  it('[9] 규격 조회가 실패하면 이전 값을 유지한다', () => {
    const start = client.indexOf('var SPEC_TTL_MS');
    const block = client.slice(start, start + 1800);
    // ★ 실패를 "규격 없음" 으로 바꾸지 않는다.
    expect(block).toMatch(/_specCache\.symbols\.length > 0\) return \{ symbols: _specCache\.symbols \}/);
  });

  it('[10] 시세는 캐시하지 않는다 — 그게 폴링의 목적이다', () => {
    const start = client.indexOf('var SPEC_TTL_MS');
    const block = client.slice(start, start + 1800);
    /*
       ★ 대역폭을 아끼려고 시세까지 캐시하면 화면의 가격이 멈춘다. 고객이 멈춘
         가격을 보고 주문하면 그게 훨씬 큰 손해다.
    */
    expect(block).not.toMatch(/_tickerCache|tickersCache/);
  });
});
