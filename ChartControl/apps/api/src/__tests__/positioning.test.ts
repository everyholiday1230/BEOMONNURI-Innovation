import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
/*
   문구 파일이 **문법적으로 유효한가.**

   ★★ 왜 이 검사가 생겼나

     문구를 스크립트로 일괄 수정하다가 여러 줄 문자열 연결에서 한 줄을 남겨
     `+ '...'` 가 홀로 떠 버렸다. 브라우저는 `Unexpected token '+'` 로 그 파일을
     통째로 버리고, 그 파일에 든 **모든 문구가 사라진다** — 로그인·가입 화면이
     빈 라벨로 뜬다. 실서비스에 그 상태로 배포됐고, 페이지 오류를 잡는 검사가
     따로 있었기에 발견했다.

   ★ 문구 수정은 앞으로도 스크립트로 할 것이므로, 사람이 눈으로 확인하는 대신
     기계가 막는다. node --check 와 같은 판정을 vitest 안에서 한다.
*/
describe('LOCALES — 문구 파일이 유효하다', () => {
  const dir = join(ROOT, 'src', 'locales');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

  it('[0] 문구 파일이 모두 파싱된다', () => {
    expect(files.length).toBeGreaterThan(10);
    const broken: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      try {
        /*
           ★ 실행하지 않고 문법만 본다. new Function 은 본문을 컴파일하되
             호출하지 않으므로, window 같은 브라우저 전역이 없어도 검사할 수 있다.
        */
        // eslint-disable-next-line no-new-func
        new Function(src);
      } catch (e) {
        broken.push(`${f}: ${(e as Error).message}`);
      }
    }
    expect(broken, `문법 오류가 있는 문구 파일:\n${broken.join('\n')}`).toEqual([]);
  });

  it('[0b] 연결 연산자가 홀로 남은 줄이 없다', () => {
    /*
       ★★ 정확히 그 실수가 났던 형태다. 파싱은 위에서 잡지만, 이 검사는 **무엇이
         잘못됐는지** 바로 알려준다 — 오류 메시지가 'Unexpected token' 하나뿐이면
         어느 줄인지 찾는 데 시간이 걸린다.
    */
    const orphans: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/^\s*\+\s*['"]/.test(line)) return;
        const prev = (lines[i - 1] ?? '').trimEnd();
        // 앞 줄이 쉼표로 끝났으면 이 줄은 이어붙일 대상이 없다.
        if (prev.endsWith(',')) orphans.push(`${f}:${i + 1}`);
      });
    }
    expect(orphans, `이어붙일 대상이 없는 + 줄:\n${orphans.join('\n')}`).toEqual([]);
  });
});

/*
   법적 문서가 업종과 일치하는가.

   ★★ 사업자 업종은 **소프트웨어 개발·공급**이다(운영자 확인). 그런데 약관 제1조는
     서비스를 "암호화폐 파생상품 거래를 위한 차트·분석·주문중계 도구" 로 정의하고
     있었다. 심사관이 가장 먼저 읽는 정의 조항이 규제 업종을 가리키면, 아래에 붙은
     면책 조항(투자자문 아님·자금 미보관)이 아무리 강해도 분류가 그쪽으로 간다.

   ★ 제2조("당사가 하지 않는 것")는 원래도 정확했으므로 손대지 않았다. 고친 것은
     정의뿐이고, 고객 보호 문구는 하나도 약화시키지 않았다.

   ★★ 주문 중계 사실을 **숨기지 않는다.** 실제로 그 기능이 있으므로, 없다고 적으면
     그게 더 큰 문제가 된다. 대신 성격을 정확히 적는다: 고객이 입력·승인한 주문을
     고객 자신의 계정으로 보내는 보조 기능이고, 거래 자체는 고객과 거래소 사이의
     거래다.
*/
describe('LEGAL — 법적 문서가 업종(소프트웨어 개발·공급)과 일치한다', () => {
  const terms = ['en', 'ja', 'zh'].map((l) => ({ loc: l, src: read(`docs/legal/terms-${l}.md`) }));

  it('[L1] 약관 제1조가 소프트웨어라고 말한다', () => {
    for (const { loc, src } of terms) {
      const head = src.slice(0, 2200);
      const saysSoftware = /develop and supply software|ソフトウェアの開発・提供|软件开发与供应/.test(head);
      expect(saysSoftware, `terms-${loc}: 제1조가 소프트웨어 공급이라고 말하지 않는다`).toBe(true);
    }
  });

  it('[L2] "암호화폐 파생상품 거래 도구" 라는 정의가 남아 있지 않다', () => {
    for (const { loc, src } of terms) {
      /*
         ★★ 이 문장이 정확히 심사에서 걸린 정의다. 기능 설명이 아니라 **업종 선언**으로
           읽힌다.
      */
      for (const banned of [
        /order-routing tool\*\* for cryptocurrency derivatives trading/,
        /注文中継ツール\*\*です/,
        /委托转发工具\*\*/,
      ]) {
        expect(src, `terms-${loc}: 옛 정의가 남아 있다`).not.toMatch(banned);
      }
    }
  });

  it('[L3] 우리가 아닌 것을 정의 조항에서 열거한다', () => {
    for (const { loc, src } of terms) {
      const head = src.slice(0, 2600);
      const disclaims = /not a securities exchange|証券取引所|不是证券交易所/.test(head);
      expect(disclaims, `terms-${loc}: 정의 조항에 업종 부인이 없다`).toBe(true);
    }
  });

  it('[L3b] 브로커 여부를 약관이 주장하지 않는다', () => {
    /*
       ★★ 운영자 지시로 브로커 표현을 뺐다.

         "브로커가 아니다" 라고 쓰면 KuCoin API Broker 제휴(리베이트를 받는 관계)와
         어긋날 수 있고, "브로커다" 라고 쓰면 규제 업종을 자칭하게 된다. 어느 쪽도
         우리가 단정할 사안이 아니므로 **주장을 하지 않는다.**

       ★★ 다만 리베이트 고지(제5조 "broker arrangements with exchanges")는 남긴다.
         그건 업종 주장이 아니라 **우리가 어떻게 돈을 버는지에 대한 사실 고지**다.
         그것까지 지우면 수익 구조를 숨기는 것이 되고, 심사에서 오히려 불리하다.
    */
    const en = read('docs/legal/terms-en.md');
    /*
       ★ 범위를 **제1조로 정확히 자른다.** 처음에 앞 2,600자로 봤는데 제5조의 수익
         고지(2,569자 지점)가 그 안에 들어와 잘못 실패했다 — 검사 범위가 틀리면
         통과·실패 어느 쪽도 신뢰할 수 없다.
    */
    const clause1 = en.slice(en.indexOf('## 1.'), en.indexOf('## 2.'));
    expect(clause1.length).toBeGreaterThan(300);
    expect(clause1, '정의 조항에 브로커 주장이 남아 있다').not.toMatch(/\bbroker\b/i);
    // 수익 고지는 살아 있어야 한다.
    expect(en).toMatch(/Fee rebates\*\* under broker arrangements with exchanges/);
  });

  it('[L4] 고객 보호 조항은 그대로 남아 있다 — 표현을 바꾸며 약화시키지 않는다', () => {
    /*
       ★★ 포지셔닝을 고치다가 면책·보호 문구를 지우면 그게 더 큰 문제다. 제2조의
         핵심 7개가 유지되는지 확인한다.
    */
    const en = read('docs/legal/terms-en.md');
    for (const must of [
      /We do not hold your funds/,
      /We do not provide deposits or withdrawals/,
      /We do not make trading decisions for you/,
      /We do not provide automated trading/,
      /We do not provide investment advice, discretionary asset management or collective investment services/,
      /We do not charge trading fees/,
      /We do not guarantee or forecast your results/,
    ]) {
      expect(en, `제2조 항목이 사라졌다: ${must}`).toMatch(must);
    }
  });

  it('[L5] 환불정책이 "소프트웨어 이용"을 판다고 말한다', () => {
    const en = read('docs/legal/refund-en.md');
    /*
       ★★ PG 심사관은 "무엇에 대해 결제가 일어나는가" 를 본다. 답이 금융상품·거래로
         읽히면 막힌다.
    */
    expect(en).toMatch(/is software\. What you can buy here is \*\*use of that software\*\*/);
    expect(en).toMatch(/not buying a financial product, an investment, or a trading service/);
  });

  it('[L6] 제거된 결제수단을 약관이 아직 언급하지 않는다', () => {
    /*
       ★ Toss 는 신청이 반려돼 제거했다. 약관이 남은 수단을 말하면 심사관이 실제와
         다른 결제 구조를 본다.
    */
    for (const loc of ['en', 'ja', 'zh']) {
      expect(read(`docs/legal/refund-${loc}.md`), `refund-${loc}: Toss 언급이 남아 있다`).not.toMatch(/Toss/i);
    }
  });

  it('[L7] 개정했으면 시행일·버전이 함께 올라간다', () => {
    /*
       ★★ 내용을 바꾸고 시행일을 그대로 두면, 이용자는 언제 바뀌었는지 알 수 없고
         동의 이력과도 어긋난다.
    */
    for (const { loc, src } of terms) {
      expect(src, `terms-${loc}: 버전이 1.0 그대로다`).not.toMatch(/(Version|バージョン|版本) ?1\.0/);
    }
  });
});

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
