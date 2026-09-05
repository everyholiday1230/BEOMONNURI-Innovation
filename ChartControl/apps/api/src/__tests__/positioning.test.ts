import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   서비스 성격 표기 — 우리는 AI 분석 **소프트웨어**다.

   ★★ 왜 이 검사가 있는가

     결제대행(PG) 심사가 반복해서 막혔다. 원인은 기능이 아니라 **첫 화면이 우리를
     다른 업종으로 소개한 것**이었다. 고치기 전 문구:

       <title>          ChartControl AI — Trading Terminal
       meta description (없음)
       배지             AI-native trading terminal
       제목             Study your chart by conversation, / One approval to execute.
       본문             Bloomberg-grade information density · AI copilot ·
                        hundreds of live markets
                        Institutional-grade trading tools for individual traders.
       통계             Trading Pairs / Exchange Supported

     심사관이 읽으면 (1) 거래 실행 서비스 (2) 투자정보 제공 서비스로 분류된다.
     둘 다 우리가 하는 일이 아니다.

   ★★ 사실을 바꾼 것이 아니라 **무엇을 파는지 정확히** 적었다.

     우리가 파는 것은 차트 분석 소프트웨어다. 주문은 고객 자신의 거래소 계정에서
     실행되고, 우리는 자금을 보관하지 않으며, 예측·추천을 제공하지 않는다.
     이건 마케팅 수정이 아니라 정확성 수정이다 — 예전 문구가 우리를 실제보다 넓게
     소개하고 있었다.

   ★ 이 검사는 그 표기가 다시 흐려지는 것을 막는다. 문구를 바꿀 수는 있지만,
     "거래 터미널"·"투자정보" 로 되돌아가면 실패한다.
*/
describe('POSITIONING — AI 소프트웨어로 표기된다', () => {
  const html = read('index.html');
  const en = read('src/locales/en.js');
  const authEn = read('src/locales/auth.en.js');

  it('[1] 페이지 제목이 소프트웨어라고 말한다', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    /*
       ★★ 심사관과 검색엔진이 가장 먼저 읽는 한 줄이다. 여기서 업종이 정해진다.
    */
    expect(title).toMatch(/software/i);
    expect(title).not.toMatch(/trading terminal/i);
  });

  it('[2] meta description 이 있고, 우리가 아닌 것을 분명히 말한다', () => {
    const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
    /*
       ★ 예전에는 이 태그가 **아예 없었다.** 설명이 없으면 심사관은 제목과 본문에서
         업종을 추측하고, 추측은 보수적으로(=규제 업종으로) 기운다.
    */
    expect(desc.length).toBeGreaterThan(80);
    expect(desc).toMatch(/not an exchange, broker or investment adviser/i);
    expect(desc).toMatch(/never hold customer funds/i);
    // ★ 향후 확장을 적어 둔다 — 지금 암호화폐뿐이라는 사실도 함께.
    expect(desc).toMatch(/stocks and ETFs/i);
  });

  it('[3] 첫 화면 배지가 "거래 터미널" 이 아니다', () => {
    const badge = en.match(/landing_hero_badge: '([^']*)'/)?.[1] ?? '';
    expect(badge).toMatch(/software/i);
    expect(badge).not.toMatch(/terminal/i);
  });

  it('[4] 투자정보 제공으로 읽히는 표현이 없다', () => {
    /*
       ★★ 'Bloomberg-grade information density' 가 정확히 그 분류를 불렀다.
         우리는 정보를 판매하지 않는다 — 도구를 만든다.
    */
    for (const banned of [/Bloomberg/i, /information density/i, /trading tools/i, /Institutional-grade trading/i]) {
      expect(en, `금지 표현이 en.js 에 남아 있다: ${banned}`).not.toMatch(banned);
      expect(authEn, `금지 표현이 auth.en.js 에 남아 있다: ${banned}`).not.toMatch(banned);
    }
  });

  it('[5] 우리가 아닌 것을 첫 화면에서 밝힌다', () => {
    const stripe = en.match(/landing_stripe_note: '([^']*)'/)?.[1] ?? '';
    /*
       ★★ 이 한 줄이 심사에서 가장 중요하다. 무엇을 하지 않는지 먼저 말한다.
    */
    expect(stripe).toMatch(/not an exchange/i);
    expect(stripe).toMatch(/broker/i);
    expect(stripe).toMatch(/investment adviser/i);
    expect(stripe).toMatch(/your own exchange account/i);
  });

  it('[6] 조언·예측을 하지 않는다고 말한다', () => {
    const live = en.match(/landing_live_sub: '([^']*)'/)?.[1] ?? '';
    /*
       ★ 실시간 시세를 보여주는 자리에서 특히 필요하다. 시세 화면 옆에 아무 말이
         없으면 "시세·전망 제공 서비스" 로 읽힌다.
    */
    expect(live).toMatch(/no forecasts and no recommendations/i);
  });

  it('[7] 유료화가 열릴 때 파는 것이 무엇인지 미리 말한다', () => {
    const price = en.match(/landing_price_body_3: '([^']*)'/)?.[1] ?? '';
    /*
       ★★ PG 심사관은 "무엇에 대해 결제가 일어나는가" 를 확인한다. 그 답이 없으면
         결제 대상이 거래·투자로 추정된다. 소프트웨어 구독이라고 적는다.

       ★ 아닌 것도 함께 적는다 — 거래 수수료·일임운용·유료 조언이 아니다.
    */
    expect(price).toMatch(/subscription to this software/i);
    expect(price).toMatch(/not a trading fee/i);
    expect(price).toMatch(/not a managed account/i);
    expect(price).toMatch(/not paid advice/i);
  });

  it('[8] 통계 라벨이 거래 플랫폼처럼 읽히지 않는다', () => {
    /*
       ★ 'Trading Pairs' 는 거래소 용어다. 우리가 제공하는 것은 차트다.
       ★ 보관 자금 0 · 출금 권한 0 은 그대로 유지한다 — 심사에서 가장 강한 사실이다.
    */
    expect(en).toMatch(/landing_stat_pairs: 'Markets you can chart'/);
    expect(en).toMatch(/landing_stat_exchange: 'Chart data sources'/);
    expect(en).toMatch(/landing_stat_custody: 'Customer funds we hold'/);
    expect(en).toMatch(/landing_stat_withdraw: 'Withdrawal permissions we request'/);
    expect(en).not.toMatch(/landing_stat_pairs: 'Trading Pairs'/);
  });

  it('[9] 세 언어 모두 함께 바뀌었다 — 한 언어만 고치면 그 화면이 옛 주장을 계속한다', () => {
    for (const loc of ['ja', 'zh']) {
      const src = read(`src/locales/${loc}.js`);
      /*
         ★★ 일본어·중국어 화면이 예전 문구를 유지하면, 그 언어로 심사받거나 그
           화면을 캡처했을 때 다른 업종으로 보인다.
      */
      expect(src, `${loc}: 배지가 안 바뀜`).not.toMatch(/landing_hero_badge: ['"](?:AI-native trading terminal)/);
      expect(src, `${loc}: 우리가 아닌 것 표기 없음`).toMatch(/landing_stripe_note/);
    }
    // 히어로 제목은 auth.* 파일에 있다 — 그쪽도 함께 바뀌어야 한다.
    for (const loc of ['ja', 'zh']) {
      const src = read(`src/locales/auth.${loc}.js`);
      expect(src, `auth.${loc}: 히어로 제목이 안 바뀜`).not.toMatch(/One approval/);
    }
  });
});
