import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

  it('[7] 결제 대상이 무엇인지 요금제 자리에서 말한다', () => {
    /*
       ★★★ 예전에는 landing_price_body_3 을 검사했는데, 그 키는 **화면에 렌더되지
         않았다**(사용처 0곳). 시험은 통과했으므로 "고지했다" 고 착각하기 쉬웠다.
         **열려 있지 않은 문구는 고지가 아니다.**

       ★ 그래서 (1) 문구 내용과 (2) 그 키가 화면 코드에서 **실제로 쓰이는지**를
         함께 본다. 하나만 보면 같은 함정에 다시 빠진다.
    */
    const price = en.match(/landing_price_what: '([^']*)'/)?.[1] ?? '';
    const ui = readFileSync(resolve(__dirname, '../../../../src/pages-auth.jsx'), 'utf-8');
    expect(ui, 'landing_price_what 이 화면에서 쓰이지 않는다 — 열리지 않는 고지다')
      .toContain("t('landing_price_what')");
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

/*
   ═══ 랜딩 페이지 수치가 코드와 일치하는지 ═══

   ★★★ 운영자 요청으로 랜딩을 전수 감사했더니 **수치 다섯 개가 틀려 있었다**
     (2026-09-12). 전부 기능이 자란 뒤 문구를 따라 고치지 않은 경우다:

       · 레이아웃 열 수   랜딩 24  →  실제 96 (GRID_COLS)
       · 프리셋 개수      랜딩 7   →  실제 4 (LAYOUT_PRESETS), 없는 'Multi' 를 나열
       · 리스크 게이트    랜딩 9   →  실제 17 (domain 9 + risk-engine 8)
       · 매매일지         '시간대별 성과'·'자동 패턴 탐지' → **둘 다 코드에 없다**
       · 시장 개수        정확히 677 인데 '677+' 로 부풀림

   ★ 사람이 다시 세는 것으로는 막을 수 없다. **코드에서 수를 뽑아 문구와 맞춘다.**
   ★★ 반대 방향도 막는다 — 기능이 늘어 96→128 이 되면 이 시험이 깨져서
     문구를 고치라고 알려준다. 그것이 이 시험의 목적이다.
*/
describe('랜딩 수치는 코드와 일치해야 한다', () => {
  it('레이아웃 열 수: GRID_COLS 와 문구가 같다', () => {
    const engine = read('src/layout-engine.jsx');
    const cols = Number(engine.match(/GRID_COLS\s*=\s*(\d+)/)?.[1] ?? 0);
    expect(cols, 'GRID_COLS 를 읽지 못했다').toBeGreaterThan(0);

    const en = read('src/locales/en.js');
    for (const key of ['landing_feat_layout', 'landing_how_3_sub', 'auth_feat_layout']) {
      const v = en.match(new RegExp(`${key}: '([^']*)'`))?.[1] ?? '';
      expect(v, `${key} 를 찾지 못했다`).not.toBe('');
      /* ★ 열 수를 말하는 문구라면 그 수가 GRID_COLS 여야 한다. */
      const m = v.match(/(\d+)[- ]?(?:column|col)/i);
      expect(m, `${key} 에 열 수 표기가 없다: ${v}`).not.toBeNull();
      expect(Number(m![1]), `${key} 의 열 수가 GRID_COLS(${cols}) 와 다르다: ${v}`).toBe(cols);
    }
  });

  it('프리셋 개수: LAYOUT_PRESETS 와 문구가 같고, 없는 이름을 적지 않는다', () => {
    const md = read('src/mock-data.js');
    const i = md.indexOf('LAYOUT_PRESETS');
    expect(i, 'LAYOUT_PRESETS 를 찾지 못했다').toBeGreaterThan(-1);
    const names = [...md.slice(i, i + 30000).matchAll(/^ {6}name: '([^']+)',/gm)].map((m) => m[1]);
    expect(names.length, '프리셋 이름을 읽지 못했다').toBeGreaterThan(0);

    const auth = read('src/locales/auth.en.js');
    const v = auth.match(/landing_44cbb3: '([^']*)'/)?.[1] ?? '';
    expect(v, 'landing_44cbb3 를 찾지 못했다').not.toBe('');
    const claimed = Number(v.match(/(\d+)\s*presets?/i)?.[1] ?? -1);
    expect(claimed, `프리셋 개수가 실제(${names.length}) 와 다르다: ${v}`).toBe(names.length);
    /*
       ★★ 개수만 맞추면 부족하다. 예전 문구는 7개라 적고 **존재하지 않는 'Multi'**
         를 나열했다. 그래서 괄호 안 이름이 실제 프리셋인지도 본다.
    */
    const listed = v.match(/\(([^)]*)\)/)?.[1] ?? '';
    for (const part of listed.split('/').map((x) => x.trim()).filter(Boolean)) {
      expect(
        names.some((n) => (n ?? '').toLowerCase() === part.toLowerCase()),
        `문구에 적힌 프리셋 '${part}' 가 실제 목록에 없다: ${names.join(', ')}`,
      ).toBe(true);
    }
  });

  it('리스크 게이트 개수: 실제 게이트 수와 문구가 같다', () => {
    const domain = read('packages/domain/src/risk-gates.ts');
    const engine = read('apps/api/src/trading/risk-engine.ts');
    const ids = new Set<string>();
    for (const src of [domain, engine]) {
      for (const m of src.matchAll(/add2?\(\s*\n?\s*'([a-zA-Z.]+)'/g)) { if (m[1]) ids.add(m[1]); }
    }
    expect(ids.size, '게이트 id 를 읽지 못했다').toBeGreaterThan(5);

    const auth = read('src/locales/auth.en.js');
    const v = auth.match(/landing_40f668: '([^']*)'/)?.[1] ?? '';
    const claimed = Number(v.match(/(\d+)-gate/i)?.[1] ?? -1);
    expect(claimed, `게이트 수가 실제(${ids.size}) 와 다르다: ${v}`).toBe(ids.size);
  });

  it('매매일지 문구는 실제로 있는 기능만 말한다', () => {
    const auth = read('src/locales/auth.en.js');
    const v = (auth.match(/landing_69704c: '([^']*)'/)?.[1] ?? '').toLowerCase();
    expect(v, 'landing_69704c 를 찾지 못했다').not.toBe('');
    /*
       ★★★ 이 두 표현이 실제로 랜딩에 있었고 **둘 다 코드에 없는 기능**이었다.
         analytics 라우트는 `/analytics/journal` 과 `/analytics/daily-pnl` 뿐이다 —
         시간대별 집계도, 패턴 탐지도 없다.
       ★ 기능을 정말 만들면 이 시험을 함께 고치면 된다. 그때는 근거가 있다.
    */
    expect(v, '없는 기능(자동 패턴 탐지)을 광고한다').not.toMatch(/pattern detection/);
    expect(v, '없는 기능(시간대별 성과)을 광고한다').not.toMatch(/time of day/);
  });

  it('시장 개수에 부풀리는 + 를 붙이지 않는다', () => {
    /*
       ★ `/api/market/symbols` 는 **정확한 개수**를 준다(실측 677). 정확한 수에 `+` 를
         붙이면 "그보다 많다" 는 뜻이 되어 사실과 다르다.
    */
    const page = read('src/pages-auth.jsx');
    expect(page, "landingPairs 에 '+' 를 붙이고 있다")
      .not.toMatch(/landingPairs\.toLocaleString\(\)\s*\+\s*'\+'/);
  });
});

/*
   ═══ 죽은 버튼 감시 — 포지션 종료 ═══

   ★★★ 고객 보고(2026-09-14): "폰에서 포지션 클로즈가 안 된다".
     확인해 보니 **모바일 문제가 아니었다.** `PositionsPanel` 은 `onClose(p.id)` 를
     부르는데 `app.jsx` 가 `onClose` 를 **넘기지 않았다.** 즉
     `undefined && undefined(p.id)` 로 조용히 끝났다 — 데스크톱도 같았다.

     이 저장소가 금지한 죽은 버튼이고 그중 최악이다: 손실이 커지는 포지션을 닫으려고
     누르는 버튼이다. 고객은 닫았다고 믿고 기다린다.

   ★★ 고치는 과정에서 **같은 실수를 한 번 더 했다.** 안내 문구를 `props.onToast` 로
     띄우려 했는데 그 prop 은 존재하지 않았다(실제 이름은 `pushToast`). prop 목록을
     확인하지 않으면 "있는 것처럼 보이는 호출" 이 또 생긴다.

   ★ 그래서 시험은 **연결 자체**를 본다. 화면 시험으로는 잡기 어렵다 — 포지션이
     있어야 버튼이 렌더되고, 그러려면 실제 거래소 키가 필요하다.
*/
describe('포지션 종료 버튼은 실제로 배선돼 있어야 한다', () => {
  const src = (() => {
    const raw = read('src/app.jsx');
    /* ★ 주석을 먼저 없앤다 — 주석 안의 설명이 정규식에 걸리면 거짓 통과다. */
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  })();

  const panel = (() => {
    const i = src.indexOf('<window.PositionsPanel');
    expect(i, 'PositionsPanel 렌더 지점을 찾지 못했다').toBeGreaterThan(-1);
    const j = src.indexOf('/>', i);
    return src.slice(i, j);
  })();

  it('onClose 를 넘긴다', () => {
    /* ★★★ 이것이 빠져 있어서 버튼이 죽어 있었다. */
    expect(panel, 'PositionsPanel 에 onClose 가 전달되지 않는다 — 종료 버튼이 죽는다')
      .toMatch(/onClose=\{/);
  });

  it('reduceOnly 로 닫는다 — 없으면 반대 포지션이 열린다', () => {
    /*
       ★★★ `reduceOnly` 가 없으면 반대 방향 **신규 포지션**이 열릴 수 있다.
         닫으려다 노출이 두 배가 된다. 이건 고객 돈이 직접 걸린 조건이다.
    */
    expect(panel, '종료 주문에 reduceOnly 가 없다').toMatch(/reduceOnly:\s*true/);
  });

  it('시장가로 닫는다 — 지정가는 체결되지 않을 수 있다', () => {
    /*
       ★★ 고객이 "나가고 싶다" 고 누른 순간에 나가지 않는 것이 가장 위험하다.
         지정가로 닫으면 미체결로 남을 수 있다.
    */
    expect(panel, '종료 주문이 시장가가 아니다').toMatch(/type:\s*'market'/);
  });

  it('포지션 방향의 반대로 주문한다', () => {
    expect(panel, '방향을 반전시키지 않는다 — 같은 방향으로 주문하면 포지션이 커진다')
      .toMatch(/side:\s*pos\.side === 'long' \? 'short' : 'long'/);
  });

  it('존재하지 않는 prop 을 부르지 않는다 (onToast 는 없다)', () => {
    /*
       ★★★ 고치는 도중 실제로 한 실수다. `props.onToast` 는 존재하지 않아 또 조용히
         아무 일도 하지 않는 코드가 됐다. 이 시험은 그 재발을 막는다.
       ★ `WidgetContent` 에 전달되는 이름은 `pushToast` 다.
    */
    expect(panel, '존재하지 않는 props.onToast 를 부른다').not.toMatch(/props\.onToast/);
  });
});

/*
   ═══ 죽은 버튼 감시 — 핸들러 prop 전달 ═══

   ★★★ 오늘 **세 개**의 죽은 버튼을 찾았다. 전부 같은 방식이다:

     1. 포지션 「종료」   — `app.jsx` 가 `onClose` 를 넘기지 않았다
     2. 거래소 연결 완료 — `onSuccess` 가 `console.log` 만 했다(키가 저장되지 않았다)
     3. (고치는 도중) `props.onToast`, `loadKeys` — 존재하지 않는 이름을 불렀다

   ★★ 공통점: `onX && onX()` 가드나 옵셔널 호출 때문에 **오류가 나지 않는다.**
     화면은 성공처럼 닫히고 고객은 됐다고 믿는다. 눈으로는 못 찾는다.

   ★ 그래서 기계로 본다. 컴포넌트가 핸들러로 **실제 호출하는** prop 을 뽑고,
     렌더 지점에서 그것이 전달되는지 확인한다.
*/
describe('위젯 컴포넌트의 핸들러 prop 은 전달돼야 한다', () => {
  const FILES = ['src/widgets.jsx', 'src/app.jsx', 'src/pages-user.jsx', 'src/layout-engine.jsx'];

  it('핸들러로 호출되는 prop 이 렌더 지점에서 빠지지 않는다', () => {
    const src = new Map(FILES.map((f) => [f, read(f)]));

    /* 1) window.X = function X({ ... }) 에서 컴포넌트와 prop 목록 */
    const comps = new Map<string, { props: string[]; body: string }>();
    for (const s of src.values()) {
      const re = /window\.([A-Z][A-Za-z0-9]*)\s*=\s*function\s+[A-Za-z0-9]*\s*\(\s*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const props = (m[2] ?? '').split(',').map((x) => (x.split(/[:=]/)[0] ?? '').trim()).filter(Boolean);
        comps.set(m[1]!, { props, body: s.slice(m.index, m.index + 40000) });
      }
    }
    expect(comps.size, '컴포넌트를 하나도 찾지 못했다 — 검사가 무의미하다').toBeGreaterThan(5);

    /* 2) 그중 실제로 핸들러로 호출되는 것만 */
    const missing: string[] = [];
    for (const [name, c] of comps) {
      const used = c.props.filter((p) => {
        if (!/^on[A-Z]/.test(p)) return false;
        return new RegExp(`${p}\\s*&&\\s*${p}\\s*\\(|${p}\\s*\\(`).test(c.body);
      });
      if (used.length === 0) continue;

      /* 3) 렌더 지점에서 전달되는지 */
      for (const [file, s] of src) {
        const re = new RegExp(`<window\\.${name}\\b`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
          let depth = 0; let end = -1;
          for (let i = m.index; i < s.length; i += 1) {
            const ch = s[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (depth === 0 && ch === '>') { end = i; break; }
          }
          if (end < 0) continue;
          const tag = s.slice(m.index, end);
          /* ★ 스프레드가 있으면 정적으로 알 수 없다 — 판정하지 않는다(거짓 경보 방지). */
          if (/\{\s*\.\.\./.test(tag)) continue;
          const passed = new Set([...tag.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*=\s*[{"]/g)].map((x) => x[1]!));
          const gone = used.filter((p) => !passed.has(p));
          if (gone.length) {
            const line = s.slice(0, m.index).split('\n').length;
            missing.push(`${name} @ ${file}:${line} → ${gone.join(', ')}`);
          }
        }
      }
    }

    expect(missing, `핸들러 prop 이 전달되지 않는 렌더 지점이 있다:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });

  it('거래소 연결 마법사가 키를 실제로 저장한다', () => {
    /*
       ★★★ 이 자리가 `console.log('Connected', ...)` 만 했다. 고객이 API 키를 넣고
         「완료」를 눌러도 **저장되지 않았고**, 창은 성공처럼 닫혔다.
       ★ 지갑 등록과 **같은 경로**(`QTApi.credentials.save`)를 써야 한다 — 별도 경로를
         만들면 검증·감사기록이 갈라진다.
    */
    const s = read('src/pages-user.jsx');
    const i = s.indexOf('<window.ExchangeConnectWizard');
    expect(i, '연결 마법사 렌더 지점을 찾지 못했다').toBeGreaterThan(-1);
    const block = s.slice(i, i + 2600);
    expect(block, 'onSuccess 가 키를 저장하지 않는다').toMatch(/credentials\s*&&[\s\S]*?\.save\(|api\.save\(/);
    expect(block, 'console.log 만 하고 끝난다').not.toMatch(/onSuccess=\{\(ex, form\) => \{\s*console\.log/);
  });
});

/*
   ═══ 포지션 종료 — 부분 종료와 레버리지 ═══

   운영자 보고(2026-09-14):
     "클로즈도 지금 들어간 거의 몇 퍼센트를 종료할 건지 물어봐야 하지 않아?"
     "지금 클로즈 누르면 레버리지가 20 이렇게 나오는데.. 난 3배로 들어갔는데"

   ★★★ 레버리지 20 의 원인: `placeOrder` 가 `data.leverage || market.leverage || 10`
     으로 대체한다. 종료 주문에 레버리지를 넘기지 않으면 **시장 기본값(20)** 이 찍혔다.
     종료는 기존 포지션을 줄이는 것이므로 레버리지를 새로 정하는 행위가 아니다 —
     값을 지어내면 고객이 자기 포지션 조건을 잘못 읽는다.
*/
describe('포지션 종료 — 비율과 레버리지', () => {
  const src = (() => {
    const raw = read('src/app.jsx');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  })();
  const panel = (() => {
    const i = src.indexOf('<window.PositionsPanel');
    const j = src.indexOf('/>', i);
    return src.slice(i, j);
  })();

  it('종료 비율(pct)을 받는다', () => {
    /* ★ 전량만 닫을 수 있으면 절반 정리 같은 흔한 운용을 손으로 계산해야 한다. */
    expect(panel, 'onClose 가 비율을 받지 않는다').toMatch(/onClose=\{\(posId,\s*pct\)/);
  });

  it('수량을 내림한다 — 올리면 보유량을 넘는다', () => {
    /*
       ★★★ 올림하면 보유 수량보다 많아져 거래소가 거절하거나, reduceOnly 가 없다면
         반대 포지션이 열린다.
    */
    expect(panel, '종료 수량을 내림하지 않는다').toMatch(/Math\.floor\(/);
  });

  it('★★★ 레버리지를 시장 기본값으로 대체하지 않는다', () => {
    /*
       이것이 "3배로 들어갔는데 20 이 뜬다" 의 원인이었다. 포지션의 실제 값을 넘기고,
       없으면 1 을 넘긴다 — reduceOnly 에서 레버리지는 포지션을 바꾸지 않으므로
       안전하고, 20 같은 큰 수를 보여주는 것보다 정직하다.
    */
    expect(panel, '포지션 레버리지를 넘기지 않는다')
      .toMatch(/leverage:\s*Number\(pos\.leverage\)\s*>\s*0\s*\?\s*Number\(pos\.leverage\)\s*:\s*1/);
    /* ★ 조건부 전달(`...(pos.leverage ? {} : {})`)로 되돌아가면 다시 기본값이 끼어든다. */
    expect(panel, '레버리지를 조건부로 넘기고 있다 — 없으면 시장 기본값이 끼어든다')
      .not.toMatch(/\.\.\.\(pos\.leverage\s*\?/);
  });

  it('확인창이 종료 주문임을 밝힌다', () => {
    /*
       ★★ 종료는 반대 방향 주문으로 만들어진다. 롱을 닫는데 「숏 주문」 이라고만 뜨면
         고객은 새 숏을 여는 것으로 오해한다 — 운영자가 실제로 그렇게 물었다.
    */
    expect(src, '확인창에 종료 표시가 없다').toMatch(/order\.reduceOnly\s*\?\s*t\('op_title_close'\)/);
  });
});

/*
   ═══ 차트 포지션 오버레이 — 진입가·금액·손익%·TP/SL 드래그 ═══

   운영자 요청(2026-09-14):
     "내가 들어가면 들어간 금액이랑 차트에 금액이랑 퍼센트율 그리고 tp sl도
      차트에서 마우스로 드래그에서 설정할 수 있도록 해줄 수 있어?"

   ★★★ 조사 결과 **코드는 이미 있었지만 데이터가 오지 않았다.** 세 곳이 빈 테이블·
     하드코딩 null 을 읽고 있었다:

       1. `localPositions()`   → `positions` 테이블 = 프로덕션 **0행**(sim 전용)
       2. `localOpenOrders()`  → `orders` 테이블   = 프로덕션 **0행**(sim 전용)
       3. `account-data.js` 의 `trigger`/`tp`/`sl` = **하드코딩 null/undefined**

     그래서 진입가 선도, 미체결 주문 선도, TP/SL 선도 **한 번도 나타나지 않았다.**
     커밋 800336b(AI 가 포지션을 못 본 것)와 **같은 함정**이다.
*/
describe('차트 포지션 오버레이', () => {
  const app = (() => {
    const raw = read('src/app.jsx');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  })();

  it('★★★ 빈 sim 테이블을 읽지 않는다', () => {
    /*
       `positions` / `orders` 테이블은 sim-projection 만 쓴다. 실제 포지션은 거래소
       어댑터에서 오고 `QTAccount` 가 들고 있다 — 차트와 포지션 패널이 같은 소스를
       봐야 두 화면이 같은 진입가를 보여준다.
    */
    expect(app, 'localPositions(빈 테이블)를 아직 읽는다').not.toMatch(/api\.localPositions\s*\?/);
    expect(app, 'localOpenOrders(빈 테이블)를 아직 읽는다').not.toMatch(/api\.localOpenOrders\s*\?/);
    expect(app, 'QTAccount 에서 포지션을 읽지 않는다').toMatch(/QTAccount[\s\S]{0,200}getPositions\(\)/);
    expect(app, 'QTAccount 에서 미체결 주문을 읽지 않는다').toMatch(/QTAccount[\s\S]{0,200}getOpenOrders\(\)/);
  });

  it('진입가 필드 이름이 UI 행에 맞다', () => {
    /*
       ★★★ `QTAccount` 의 포지션 행은 **`entry`** 다(`toUiPositions`). `entryPrice` 는
         서버 응답의 이름으로 UI 행에는 없다 — 그대로 두면 모든 선이 조용히 사라진다.
    */
    expect(app, 'entry 필드를 쓰지 않는다').toMatch(/p\.entry\s*!==\s*undefined\s*\?\s*p\.entry/);
  });

  it('들어간 금액(증거금)과 평가손익을 넘긴다', () => {
    /* ★ % 만 보여주면 "그래서 얼마인가" 를 알 수 없다 — 운영자 요청의 핵심이다. */
    expect(app, '증거금을 넘기지 않는다').toMatch(/margin:\s*Number\(p\.margin\)\s*>\s*0/);
    expect(app, '평가손익을 넘기지 않는다').toMatch(/pnl:\s*Number\.isFinite\(Number\(p\.unPnl\)\)/);
  });

  it('포지션·주문이 바뀌면 선을 다시 만든다', () => {
    /*
       ★★★ 전에는 로그인 순간에 한 번만 불렀다. 새로 포지션을 열어도 선이 나타나지
         않고, 닫아도 남았다 — 거래는 로그인 뒤에 하므로 거의 항상 틀린 화면이었다.
    */
    expect(app, 'QTAccount 갱신을 구독하지 않는다').toMatch(/QTAccount\.subscribe\(\(\)\s*=>\s*load\(\)\)/);
  });

  it('파생된 선을 전부 걷어낸다 — 겹쳐 쌓이지 않게', () => {
    /* ★ position-tp/sl 을 목록에서 빼먹으면 새로 읽을 때마다 선이 쌓인다. */
    const m = app.match(/const DERIVED = \[([^\]]*)\]/);
    expect(m, 'DERIVED 목록이 없다').not.toBeNull();
    for (const src of ['order', 'position-long', 'position-short', 'position-tp', 'position-sl']) {
      expect(m![1], `DERIVED 에 ${src} 가 없다 — 선이 겹쳐 쌓인다`).toContain(src);
    }
  });

  it('★★★ TP/SL 드래그가 뒤집힌 방향을 막는다', () => {
    /*
       롱의 손절이 진입가보다 위에 있으면 즉시 체결된다 — 보호가 아니다. 거래소가
       받아줄 수도 있으므로 우리가 막아야 한다. 막은 뒤에는 선을 되돌린다 — 잘못된
       가격이 화면에 남으면 이용자는 그 가격에 보호주문이 걸렸다고 믿는다.
    */
    expect(app, '드래그 결과를 처리하지 않는다').toMatch(/id\.startsWith\('posbr-'\)/);
    expect(app, '방향 검증이 없다').toMatch(/const wrong =/);
    expect(app, 'reduceOnly 없이 보호주문을 낸다').toMatch(/type: 'stop'[\s\S]{0,200}reduceOnly: true/);
  });

  it('보호주문은 기존 주문 경로로 나간다', () => {
    /* ★ 전용 API 를 만들면 17개 리스크 게이트·확인창·감사기록을 다시 구현해야 한다. */
    /*
       ★ 선언 순서(TDZ) 때문에 ref 를 거친다 — `placeOrderRef.current` 를 호출한다.
         중요한 것은 **전용 API 가 아니라 기존 주문 경로**를 쓴다는 사실이다.
    */
    /*
       ★ 설계가 바뀌었다 — 드래그는 옮기기만 하고, 주문은 **확정 핸들러**에서 낸다.
         중요한 것은 전용 API 가 아니라 **기존 주문 경로**를 쓴다는 사실이다.
    */
    const j = app.indexOf('onConfirmBracket={(posId, kind, pct)');
    expect(j, '확정 핸들러가 없다').toBeGreaterThan(-1);
    const seg = app.slice(j, app.indexOf('onCancelBracket=', j));
    expect(seg, '기존 주문 경로(onPlaceOrder)를 쓰지 않는다').toMatch(/onPlaceOrder\(\{/);
  });
});

describe('account-data — 스톱 가격을 버리지 않는다', () => {
  it('★★★ trigger/tp/sl 이 하드코딩 null 이 아니다', () => {
    /*
       `trigger: null`, `tp: undefined`, `sl: undefined` 로 굳어 있었다. 어댑터는
       값을 주는데(`NormalizedOrder.takeProfitPrice`/`stopLossPrice`) 화면 변환에서
       버렸다 — 그래서 차트에 보호주문 선을 그릴 근거가 없었다.
    */
    const raw = read('src/account-data.js');
    const s = raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(s, 'trigger 가 아직 null 하드코딩이다').not.toMatch(/^\s*trigger:\s*null,\s*$/m);
    expect(s, '트리거 가격을 읽지 않는다').toMatch(/o\.stopPrice[\s\S]{0,80}o\.triggerPrice/);
    expect(s, '브래킷 익절가를 읽지 않는다').toMatch(/o\.takeProfitPrice/);
    expect(s, '브래킷 손절가를 읽지 않는다').toMatch(/o\.stopLossPrice/);
    expect(s, 'reduceOnly 를 싣지 않는다').toMatch(/reduceOnly:\s*o\.reduceOnly === true/);
  });
});

/*
   ═══ ★★★ 선언 순서 사고 — 앱 전체가 흰 화면이 됐다 ═══

   `handleOverlayChange` 는 `placeOrder` 보다 **위**에 선언된다. 의존성 배열에
   `placeOrder` 를 넣자 `const` 의 TDZ 에 걸려
     ReferenceError: Cannot access 'placeOrder' before initialization
   이 나고 **App 렌더 자체가 실패**했다. 프로덕션에서 실측했다.

   ★★★ **eslint 0, typecheck 0, 시험 1659 통과, 빌드 성공이었다.** 전부 통과했는데
     앱은 켜지지 않았다. 브라우저로 열어봐야 보였다 — "배포됐다" 와 "동작한다" 는 다르다.
   ★ 그래서 순서를 시험으로 고정한다. 다시 직접 참조로 돌아가면 같은 사고가 난다.
*/
describe('선언 순서 — placeOrder TDZ', () => {
  const app = read('src/app.jsx');

  it('handleOverlayChange 가 placeOrder 를 직접 의존하지 않는다', () => {
    const iH = app.indexOf('const handleOverlayChange');
    const iP = app.indexOf('const placeOrder = useCallback');
    expect(iH, 'handleOverlayChange 를 찾지 못했다').toBeGreaterThan(-1);
    expect(iP, 'placeOrder 를 찾지 못했다').toBeGreaterThan(-1);

    /* ★ 순서가 뒤바뀌었다면 직접 참조해도 안전하다 — 그 경우는 검사하지 않는다. */
    if (iP > iH) {
      const dep = app.slice(iH, app.indexOf('activeSymbolKey, overlays', iH) + 400);
      const depsMatch = dep.match(/\}, \[([^\]]*)\]\);/);
      expect(depsMatch, '의존성 배열을 찾지 못했다').not.toBeNull();
      expect(depsMatch![1], 'placeOrder 를 직접 의존한다 — TDZ 로 앱이 흰 화면이 된다')
        .not.toMatch(/\bplaceOrder\b/);
    }
  });

  it('ref 로 참조하고 정의 뒤에 대입한다', () => {
    const iRefDecl = app.indexOf('const placeOrderRef = useRef');
    const iDef = app.indexOf('const placeOrder = useCallback');
    const iAssign = app.indexOf('placeOrderRef.current = placeOrder');
    expect(iRefDecl, 'placeOrderRef 선언이 없다').toBeGreaterThan(-1);
    expect(iAssign, 'ref 대입이 없다').toBeGreaterThan(-1);
    /* ★★ 대입이 정의보다 앞이면 같은 TDZ 오류가 난다. */
    expect(iAssign, 'ref 대입이 placeOrder 정의보다 앞에 있다').toBeGreaterThan(iDef);
    expect(iRefDecl, 'ref 선언이 사용처보다 뒤에 있다').toBeLessThan(iDef);
  });
});

/*
   ═══ TP/SL 을 없을 때 새로 거는 경로 ═══

   운영자 요청은 "tp sl도 차트에서 마우스로 드래그해서 **설정**할 수 있도록" 이었다.
   앞선 커밋(d620fcc)은 **이미 걸린** 보호주문을 옮기는 것만 했다 — 없을 때 새로
   만드는 방법이 없었으므로 요청을 절반만 충족했다.

   ★ 포지션 행의 `+TP` / `+SL` 을 누르면 차트에 **점선** 초안이 현재가에 생기고,
     끌어서 놓으면 확인창을 거쳐 실제 보호주문이 나간다.
   ★★ 현재가에 두는 것은 가격 제안이 아니다 — 끌기 시작점이고, 놓지 않으면 아무
     주문도 나가지 않는다. ±2% 같은 값을 넣으면 우리가 손절 폭을 권한 것처럼 읽힌다.
*/
describe('TP/SL 신규 설정 — 초안 선', () => {
  const app = read('src/app.jsx');
  const wid = read('src/widgets.jsx');

  it('포지션 행에 +TP / +SL 버튼이 있다', () => {
    /* ★ tp/sl 을 배열로 돌려 두 버튼을 만든다 — 같은 코드가 두 번 있으면 한쪽만 고치게 된다. */
    expect(wid, 'TP/SL 버튼을 만들지 않는다').toMatch(/\['tp', 'sl'\]\.map/);
    expect(wid, 'onSetBracket 을 부르지 않는다').toMatch(/onSetBracket\(p\.id, k\)/);
  });

  it('★★★ onSetBracket 이 실제로 전달된다', () => {
    /* ★ 오늘 세 번 겪은 실패 — prop 을 부르지만 전달되지 않는다. */
    const i = app.indexOf('<window.PositionsPanel');
    expect(i, '렌더 지점을 찾지 못했다').toBeGreaterThan(-1);
    /* ★ 확정/취소/draftIds 가 앞에 끼어들었으므로 창을 넓게 본다. */
    const tag = app.slice(i, i + 12000);
    for (const nm of ['onSetBracket', 'onConfirmBracket', 'onCancelBracket', 'draftIds']) {
      expect(tag, `${nm} 이 전달되지 않는다`).toMatch(new RegExp(`${nm}=\\{`));
    }
  });

  it('★★★ 존재하지 않는 prop 을 부르지 않는다', () => {
    /*
       `props.setOverlays` 로 썼다가 고쳤다. `props.X` 는 eslint 도 typecheck 도
       잡지 못한다 — 조용히 아무 일도 안 하는 버튼이 된다. 실제 prop 은 addOverlay 다.
    */
    const i = app.indexOf('onSetBracket={(posId, kind) => {');
    const blk = app.slice(i, app.indexOf('onClose={(posId, pct)', i));
    expect(blk, '존재하지 않는 props.setOverlays 를 부른다').not.toMatch(/props\.setOverlays/);
    expect(blk, 'addOverlay 를 쓰지 않는다').toMatch(/props\.addOverlay\(\{/);
  });

  it('초안은 점선이다 — 걸린 주문과 구분된다', () => {
    const i = app.indexOf('onSetBracket={(posId, kind) => {');
    const blk = app.slice(i, app.indexOf('onClose={(posId, pct)', i));
    expect(blk, '초안이 점선이 아니다 — 이미 걸린 보호주문으로 읽는다')
      .toMatch(/style: \{ dashed: true \}/);
  });

  it('초안 드래그도 같은 검증 경로를 탄다', () => {
    /* ★ 갈라지면 한쪽에만 방향 검증이 남는다. */
    expect(app, '초안 id 를 처리하지 않는다')
      .toMatch(/id\.startsWith\('posbr-'\)\s*\|\|\s*id\.startsWith\('posdraft-'\)/);
    /* ★ 초안 선 제거는 **확정 후**에 일어난다 — 드래그 때 지우면 조정을 못 한다. */
    const j = app.indexOf('onConfirmBracket={(posId, kind, pct)');
    expect(app.slice(j, app.indexOf('onCancelBracket=', j)), '확정 후 초안 선을 지우지 않는다')
      .toMatch(/removeOverlay\(oid\)/);
  });

  it('이미 보호주문이 있으면 버튼을 숨긴다', () => {
    /*
       ★★ 두 개를 걸면 하나가 체결된 뒤 남은 하나가 위험해진다.
       ★★★ 포지션 행의 tp/sl 은 항상 비어 있다 — 미체결 reduceOnly 스톱으로 판단한다.
         근거를 못 읽으면 **있다고 본다**(없다고 보면 중복으로 걸게 된다).
    */
    expect(wid, 'hasGuard 판단이 없다').toMatch(/const hasGuard = \(pos, kind\)/);
    expect(wid, '주문 목록을 못 읽었을 때 있다고 보지 않는다')
      .toMatch(/if \(!Array\.isArray\(orders\)\) return true;/);
    expect(wid, 'reduceOnly 로 보호주문을 가리지 않는다').toMatch(/o\.reduceOnly !== true/);
  });
});

/*
   ═══ 모바일 위젯이 내용을 담는다 ═══

   운영자 "모든 버튼 확인해봐" 에 대한 모바일 점검 결과(iPhone 13 390×664, 프로덕션 실측).

   ★★★ **처음 보고한 "못 눌리는 버튼 9개" 중 7개는 내 측정 오류였다.**

     관심목록은 **678행 전부를 DOM 에 그린다.** 위젯 밖으로 넘어간 행은
     `overflow: hidden` 으로 잘려 **화면에 없다.** 그런데 `getBoundingClientRect` 는
     레이아웃 좌표를 그대로 돌려주므로, 그 좌표에서 `elementFromPoint` 를 부르면
     그 자리에 실제로 그려진 차트 캔버스가 나온다. 나는 그것을 "탭이 캔버스로 간다"
     고 읽었다. **잘린 요소를 제외하지 않은 것이 원인이다.**

   ★★ 진짜 문제는 2개였다 — 차트 도구(`Indicators`, `Lock drawings`)가 위젯 오른쪽
     끝(333px) 을 넘어 사이드바(337px) 아래로 들어가 못 눌렸다. 가로 스크롤로 고쳤다.
   ★ 고친 뒤 재측정: 모바일 0개, 데스크톱 0개.

   ★★★ 교훈 — 측정 도구가 틀리면 없는 결함을 보고하게 된다. 목록형 화면에서는
     **잘림(clip)을 반드시 제외**해야 한다.
*/
describe('모바일 — 위젯이 내용을 담는다', () => {
  const css = read('src/mobile.css');

  it('위젯이 내용을 밖으로 흘리지 않는다', () => {
    /* ★ 흘러나온 내용은 다음 위젯에 덮여 눌러도 반응하지 않는다. */
    const i = css.indexOf('.trade-body > .widget {');
    expect(i, '.trade-body > .widget 규칙이 없다').toBeGreaterThan(-1);
    const blk = css.slice(i, css.indexOf('}', i));
    expect(blk, '위젯이 내용을 담지 않는다').toMatch(/overflow:\s*hidden/);
  });

  it('★★ 차트 도구 줄이 가로 스크롤된다 — 사이드바 아래로 숨지 않게', () => {
    /*
       커밋 db3ebd2 는 "컨트롤을 숨기지 말고 넘치게 두자" 였다. 넘친 버튼이 사이드바
       아래로 들어가 **아예 못 눌리게** 됐다 — 숨긴 것보다 나쁘다. 내 판단이 틀렸다.
    */
    expect(css, '차트 도구 줄에 가로 스크롤이 없다')
      .toMatch(/chart-tool-wrap[\s\S]{0,200}overflow-x:\s*auto/);
  });

  it('규칙이 mobile.css 에 있다 — widgets.css 가 아니다', () => {
    /*
       ★★★ index.html 은 widgets.css(85행) 를 mobile.css(96행) **앞에** 로드한다.
         명시도가 같으면 나중 것이 이긴다 — widgets.css 에 넣으면 조용히 덮인다.
         실제로 한 번 겪었다(커밋 02f81b2).
    */
    const w = read('src/widgets.css');
    expect(w, 'widgets.css 에 모바일 위젯 담기 규칙이 들어갔다')
      .not.toMatch(/trade-body > \.widget[\s\S]{0,120}overflow:\s*hidden/);
  });
});

/*
   ═══ TP/SL 드래그 — 이동과 확정을 분리, 취소 경로, 라벨 폭 ═══

   운영자 보고(2026-09-14):
     "이동이 뭔가 안되요 위로 아래로 자유롭게 이동이되어야하는데"
     "sl tp 선을 추가했다가 취소하고싶은데 어떻게하죠?"
     "오른쪽 글씨들이 있는데 가려진건지"
     "tp sl도 추가하면 오픈오더에 추가되어야하는거아니에요?"

   ★★★ 드래그가 안 된 원인: `handleOverlayChange` 가 `updateOverlay` 를 부르지 않고
     곧바로 주문을 내고 `return` 했다. 오버레이 상태의 가격이 그대로 남아 **선이
     제자리로 튕겼다.** 게다가 살짝만 끌어도 주문 확인창이 떴다.
*/
describe('TP/SL — 이동·확정·취소', () => {
  const app = read('src/app.jsx');
  const wid = read('src/widgets.jsx');

  it('★★★ 드래그는 옮기기만 한다 — 주문을 내지 않는다', () => {
    const i = app.indexOf("id.startsWith('posbr-') || id.startsWith('posdraft-')");
    expect(i, '드래그 처리 분기가 없다').toBeGreaterThan(-1);
    const blk = app.slice(i, i + 300);
    expect(blk, 'updateOverlay 를 부르지 않는다 — 선이 제자리로 튕긴다')
      .toMatch(/updateOverlay\(id, ov\);/);
    expect(blk, '드래그에서 주문을 낸다 — 살짝 끌 때마다 확인창이 뜬다')
      .not.toMatch(/placeOrder|onPlaceOrder/);
  });

  it('확정은 버튼으로만 일어난다', () => {
    expect(app, 'onConfirmBracket 이 없다').toMatch(/onConfirmBracket=\{\(posId, kind, pct\)/);
    const i = app.indexOf('onConfirmBracket={(posId, kind, pct)');
    const blk = app.slice(i, app.indexOf('onCancelBracket=', i));
    expect(blk, '확정에서 주문을 내지 않는다').toMatch(/onPlaceOrder\(\{/);
    expect(blk, '방향 검증이 없다').toMatch(/const wrong =/);
  });

  it('★★★ 걸린 주문을 옮길 때 먼저 취소한다', () => {
    /*
       거래소에 "스톱 가격 수정" API 가 없다. 취소 없이 새로 걸면 **주문이 두 개**가
       되고, 하나가 체결된 뒤 남은 하나가 반대 포지션을 열 수 있다.
       ★★ 취소가 실패하면 새 주문을 내지 않는다 — 둘 다 살아 있는 상태가 가장 위험하다.
    */
    const i = app.indexOf('onConfirmBracket={(posId, kind, pct)');
    const blk = app.slice(i, app.indexOf('onCancelBracket=', i));
    /*
       ★★★ 역검증에서 이 시험이 `if (false)` 로 바꿔도 통과했다 — `ref.orderId` 라는
         문자열이 주석에도 있었기 때문이다. **조건 자체**를 확인해야 한다.
         (알려진 규칙: 소스 검사 시험은 주석을 지우고 **조건**을 본다.)
    */
    const bare = blk.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(bare, '기존 주문 id 로 분기하지 않는다 — 취소 없이 걸면 주문이 두 개가 된다')
      .toMatch(/if \(ref\.orderId\) \{/);
    expect(blk, '취소를 호출하지 않는다').toMatch(/api\.cancel\(/);
    expect(blk, '취소 실패 시에도 주문을 낸다').toMatch(/pos_br_cancel_failed[\s\S]{0,60}return;/);
    expect(app, '오버레이에 주문 id 를 담지 않는다').toMatch(/orderId: ordId \|\| null/);
  });

  it('★★ 초안을 취소할 수 있다', () => {
    /* 운영자 질문 — 방법이 없었다. 선만 생기고 없앨 수 없으면 막힌 화면이다. */
    expect(app, 'onCancelBracket 이 없다').toMatch(/onCancelBracket=\{\(posId, kind\)/);
    const i = app.indexOf('onCancelBracket={(posId, kind)');
    const blk = app.slice(i, i + 700);
    expect(blk, '초안 선을 지우지 않는다').toMatch(/removeOverlay\(oid\)/);
    /* ★ 걸린 주문(posbr-)은 지우지 않는다 — 주문은 남는데 선만 사라지면 더 위험하다. */
    expect(blk, '걸린 주문 선까지 지운다').not.toMatch(/posbr-/);
  });

  it('버튼이 세 상태를 구분한다', () => {
    expect(wid, 'draftIds 로 초안 상태를 보지 않는다').toMatch(/draftIds \|\| \[\]\)\.includes\(`posdraft-/);
    expect(app, 'draftIds 를 전달하지 않는다').toMatch(/draftIds=\{/);
  });

  it('★★ 오픈오더에 트리거 가격이 보인다', () => {
    /*
       스톱 주문은 `price` 가 없다. 가격 칸이 비어 있어 무슨 주문인지 알 수 없었다.
       ★ 청산 전용 배지도 붙인다 — 보호주문임을 알 수 있는 유일한 단서다.
    */
    expect(wid, '트리거 가격을 보여주지 않는다').toMatch(/o\.trigger \? \(/);
    expect(wid, '청산 전용 배지가 없다').toMatch(/o\.reduceOnly \? \([\s\S]{0,220}op_reduce_only/);
  });
});

describe('라벨 폭 — 한글에서 상자를 넘치지 않는다', () => {
  it('★★★ length * 5.6 을 쓰지 않는다', () => {
    /*
       10px 폰트에서 ASCII ≈ 5.6px 인데 **한글·CJK ≈ 10px** 이다. length 로 재면
       배경 상자가 글자보다 좁아 글자가 넘치고, 봉·다른 라벨과 겹쳐 **"글씨가 가려진"**
       것처럼 보인다(운영자 보고). `String.length` 는 표시 폭이 아니다.
    */
    /*
       ★★★ **주석을 먼저 지운다.** 이 시험이 처음에 실패했다 — 내가 쓴 주석에
         "`length * 5.6` 은 한글에서" 라는 설명이 들어 있어 정규식이 그것을 잡았다.
         알려진 함정(주석이 소스 검사를 깨뜨린다)을 또 밟았다.
    */
    const s = read('src/chart-kline.jsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(s, '아직 length * 5.6 으로 폭을 잰다').not.toMatch(/length\s*\*\s*5\.6/);
    expect(s, '폭 계산 함수가 없다').toMatch(/function textWidth\(text, size\)/);
    expect(s, '한글 범위를 보지 않는다').toMatch(/0xac00[\s\S]{0,40}0xd7a3/);
  });

  it('좁은 차트에서 라벨을 줄인다 — 숫자는 자르지 않는다', () => {
    const lv = read('src/chart-overlay-live.js');
    expect(lv, 'maxPx 를 받지 않는다').toMatch(/opts && opts\.maxPx/);
    expect(lv, '축약 단계가 없다').toMatch(/if \(width\(mid\) <= maxPx\) return mid;/);
    /* ★★★ 숫자를 자르면 틀린 숫자가 된다 — 손익을 작게 보여주는 방향의 거짓이다. */
    expect(lv, '숫자를 잘라서 줄인다').not.toMatch(/\.slice\(0,\s*\d+\)\s*\+\s*'…'/);
  });

  it('★★ bounding 을 넘긴다 — 없으면 축약이 한 번도 동작하지 않는다', () => {
    const s = read('src/chart-kline.jsx');
    expect(s, 'renderInfo 가 bounding 을 받지 않는다').toMatch(/function renderInfo\(overlay, bounding\)/);
    expect(s, 'bounding.width 를 쓰지 않는다').toMatch(/bounding && bounding\.width/);
  });
});

/*
   ═══ ★★★ 거래 모드 스트라이프가 페이퍼에서 거짓말을 했다 ═══

   운영자 질문: "여기에 페이퍼가 있는 페이퍼 버튼이요 이것도 제대로 작동하는걸까요? 스팟도요?"

   확인 결과 버튼 자체는 동작한다(프로덕션 실측):
     Spot    → QTMode=spot/live    관심목록 **200행**(현물 종목)
     Paper   → QTMode=paper/**sim**
     Futures → QTMode=futures/live 관심목록 678행

   ★★★ 그런데 스트라이프가 **세 모드 모두** 이렇게 표시했다:

       "LIVE  REAL ORDERS GO TO THE EXCHANGE · YOUR OWN FUNDS ARE AT RISK"

     모의 거래 중인데 실거래 경고가 뜬다. **방향이 정반대인 거짓**이다.
     원인 — 스트라이프가 서버 설정(`liveOrdersEnabled`, `tradingMode`)만 보고
     `QTMode` 를 보지 않았다.

   ★★ 이것이 위험한 이유는 틀린 경고가 **습관을 만든다**는 데 있다. 페이퍼에서 이
     문구를 무시하는 습관이 생기면 실거래로 돌아왔을 때도 무시한다. 경고는 틀리면
     경고가 아니라 소음이 된다.
*/
describe('거래 모드 스트라이프', () => {
  const app = (() => {
    const raw = read('src/app.jsx');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  })();

  it('★★★ 페이퍼 모드를 실거래로 표시하지 않는다', () => {
    expect(app, '페이퍼 판정이 없다').toMatch(/const paperMode = tradeMode === 'paper';/);
    expect(app, '페이퍼 배지가 없다').toMatch(/badge = t\('stripe_paper'\)/);
  });

  it('★ 페이퍼 판정이 실거래 판정보다 먼저 온다', () => {
    /*
       뒤에 두면 `liveOrders` 가 true 인 서버(우리 프로덕션)에서 **영원히 LIVE** 로
       표시된다 — 고치기 전과 같아진다.
    */
    const iPaper = app.indexOf("badge = t('stripe_paper')");
    const iLive = app.indexOf("badge = t('stripe_live')");
    expect(iPaper, '페이퍼 분기가 없다').toBeGreaterThan(-1);
    expect(iLive, '실거래 분기가 없다').toBeGreaterThan(-1);
    expect(iPaper, '페이퍼 판정이 실거래 판정보다 뒤에 있다 — 영원히 LIVE 가 된다')
      .toBeLessThan(iLive);
  });

  it('★★ 상태를 본다 — window 를 직접 읽으면 다시 그리지 않는다', () => {
    /*
       `window.QTMode.isPaper()` 를 렌더 중에 직접 읽으면 모드를 바꿔도 React 가
       다시 그리지 않아 스트라이프가 그대로 남는다. 조용히 안 되는 코드가 된다.
    */
    const i = app.indexOf('const paperMode =');
    expect(app.slice(i, i + 120), 'window 를 직접 읽는다')
      .not.toMatch(/window\.QTMode/);
  });

  it('현물은 레버리지·펀딩을 감춘다', () => {
    /* ★ 현물에 레버리지·펀딩·청산가는 존재하지 않는다. 보이면 잘못된 상품으로 읽는다. */
    const wid = read('src/widgets.jsx');
    expect(wid, '현물 판정이 없다').toMatch(/const isSpot = window\.QTMode/);
    expect(wid, '현물에서 레버리지를 1 로 두지 않는다').toMatch(/const effLev = isSpot \? 1 :/);
    expect(wid, '현물에서 TP·SL 브래킷을 막지 않는다').toMatch(/tpslOn && !isSpot/);
  });
});

/*
   ═══ ★★★ 페이퍼(모의) 모드는 동작하지 않는다 — 사실을 기록한다 ═══

   운영자 요청("tp sl도 제대로 작동하나 확인바랍니다")으로 페이퍼 모드에서 끝까지
   주문을 시도했다. 프로덕션 실측 결과:

     ① 주문 검증이 "Connect your exchange account first" 로 막았다
        → 모의 거래인데 실거래 키를 요구했다. 이 가드는 고쳤다.
     ② 고쳐도 낼 수 없다 — `account_balances` 프로덕션 **0행**.
        모의 시작 잔고를 지급하는 코드가 **시험 파일에만** 있다.
     ③ `pg-sim-projection` 은 orders·positions·executions 만 쓰고 잔고를 안 건드린다.
     ④ `simulation_orders` 0행, `orders` 0행 — 페이퍼 주문 성공 기록이 **0건**.

   ★★ 그래서 `available: false` 로 두었다. 동작하지 않는 버튼을 눌러도 되는 것처럼
     두지 않는다. 이 시험은 **되살릴 때 함께 고치도록** 사실을 고정한다.
*/
describe('페이퍼 모드 — 준비되지 않았음을 정직하게 표시한다', () => {
  const tm = read('src/trade-mode.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

  it('★★ 페이퍼가 사용 가능하다 — 세 조건이 갖춰졌을 때만', () => {
    /*
       ★★★ 2026-09-14 되살렸다. 사용 가능으로 두려면 아래가 모두 있어야 한다.
         하나라도 없으면 "눌러도 주문이 안 되는 버튼" 으로 돌아간다.
    */
    const i = tm.indexOf('paper: {');
    expect(i, 'paper 모드 정의를 찾지 못했다').toBeGreaterThan(-1);
    expect(tm.slice(i, i + 300), '페이퍼가 막혀 있다').toMatch(/available:\s*true/);

    /* ① 시작 잔고 지급 경로 */
    const idx = read('apps/api/src/index.ts');
    expect(idx, '모의 잔고 지급 라우트가 없다').toMatch(/\/api\/sim\/balance\/ensure/);
    /* ② 체결 시 잔고 갱신 */
    const proj = read('apps/api/src/portfolio/pg-sim-projection.ts');
    expect(proj, '체결이 잔고를 갱신하지 않는다').toMatch(/applySimFill\(/);
    /* ③ 화면이 페이퍼일 때 시뮬레이터를 읽는다 */
    const acct = read('src/account-data.js');
    expect(acct, '페이퍼에서도 실거래소를 읽는다').toMatch(/QTMode\.isPaper\(\)[\s\S]{0,80}pollPaper/);
  });

  it('실거래 모드는 그대로 사용 가능하다', () => {
    for (const m of ['spot', 'futures']) {
      const i = tm.indexOf(`${m}: {`);
      expect(tm.slice(i, i + 200), `${m} 이 막혔다`).toMatch(/available:\s*true/);
    }
  });

  it('★★ 페이퍼가 되살아나면 거래소 키를 요구하지 않는다', () => {
    /*
       모의 거래에 실거래 키를 요구하는 것은 모순이다. 페이퍼는 주문이 시뮬레이터로
       가므로 자격증명이 쓰이지 않는다. 이 가드는 미리 고쳐 두었다 — 되살릴 때
       같은 곳에서 또 막히지 않도록.
    */
    const wid = read('src/widgets.jsx');
    expect(wid, '페이퍼 판정이 없다').toMatch(/const isPaperMode = Boolean\(window\.QTMode/);
    expect(wid, '페이퍼에서도 거래소 키를 요구한다')
      .toMatch(/needsExchange = !isPaperMode && !acctLive/);
  });

  it('★★★ 청산 전용 체결이 반대쪽 포지션을 줄인다', () => {
    /*
       ★★★ TP/SL 은 항상 청산 주문이다. 이것을 구분하지 않으면 롱을 닫는 손절(숏)이
         **새 숏 포지션**을 만들어 노출이 두 배가 된다. 실거래에서는 거래소가 막아
         주지만, 모의에서 그렇게 계산되면 연습이 실거래와 다른 것을 가르친다.
       ★ 새 개념을 만들지 않고 기존 `positionAction`('open' | 'close')을 쓴다.
    */
    const proj = read('apps/api/src/portfolio/pg-sim-projection.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(proj, '청산 판정이 없다').toMatch(/o\.positionAction === 'close'/);
    expect(proj, '반대쪽을 줄이지 않는다').toMatch(/oppositeSide = o\.side === 'long' \? 'short' : 'long'/);
    expect(proj, '전량 종료 시 행을 지우지 않는다 — 0 수량 포지션이 화면에 남는다')
      .toMatch(/DELETE FROM positions WHERE id = \$1/);

    /* ★★ 서버가 청산 여부를 전달해야 한다. 빼먹으면 위 판정이 영원히 거짓이다. */
    const idx = read('apps/api/src/index.ts');
    expect(idx, 'positionAction 을 투영에 넘기지 않는다')
      .toMatch(/positionAction: o\.positionAction === undefined \? 'open'/);
  });
});

/*
   ═══ ★★★ 스톱 주문이 시뮬레이터에 닿지 않았다 (조용한 실패) ═══

   페이퍼로 TP/SL 을 검증하다 발견했다. 차트에서 확정을 누르면 **모달도 토스트도
   뜨지 않고** 아무 일도 일어나지 않았다. 원인은 두 겹이었다:

     ① `app.jsx` 가 `stopPrice` 를 **`type === 'trigger'` 일 때만** 넘겼다.
        차트 TP/SL 은 `type: 'stop'` 이므로 트리거 가격이 사라졌다.
     ② `api-client.js` 가 스톱 트리거를 `stopPrice` 로 보냈다. 그런데 시뮬레이터
        초안 스키마에는 `stopPrice` 가 **없다** — 검증은 "limit/stop/tp_sl 은 price 가
        필요하다" 다. 실측:

          stopPrice 만 → 400 VALIDATION_FAILED
          price 로     → 200, positionAction:'close' 까지 정상

   ★★ 400 이 화면에 드러나지 않은 것이 더 큰 문제다. 실패를 삼키면 이용자는 보호주문이
     걸렸다고 믿는다 — 손절이 걸리지 않은 채 포지션을 들고 있는 상태가 된다.
*/
describe('스톱 주문이 시뮬레이터까지 도달한다', () => {
  const app = read('src/app.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const api = read('src/api-client.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

  it("★★★ stopPrice 를 'trigger' 에서만 넘기지 않는다", () => {
    /* 차트 TP/SL 은 `type: 'stop'` 이다. 이 조건이 좁으면 트리거 가격이 사라진다. */
    expect(app, "stopPrice 가 아직 'trigger' 전용이다")
      .not.toMatch(/stopPrice:\s*data\.type === 'trigger' \? data\.stopPrice : undefined/);
    expect(app, '스톱 계열을 모두 받지 않는다')
      .toMatch(/data\.type === 'trigger' \|\| data\.type === 'stop'/);
  });

  it('★★★ 시뮬레이터에는 트리거를 price 로 보낸다', () => {
    /*
       초안 스키마에 `stopPrice` 가 없다. 이름을 맞추지 않으면 400 이 되고, 그 400 이
       삼켜져 **조용히 아무 일도 일어나지 않는다.**
    */
    expect(api, '스톱 트리거를 price 로 채우지 않는다')
      .toMatch(/body\.orderType === 'stop' \|\| body\.orderType === 'tp_sl'/);
    expect(api, 'stopPrice 를 price 로 옮기지 않는다')
      .toMatch(/body\.price = decStr\(o\.stopPrice\)/);
    /* ★★ 이미 price 가 있으면 덮지 않는다 — stop_limit 에서 두 값이 다르다. */
    /*
       ★ 조건 블록 안에서 확인한다. 문자 간격으로 재면 코드를 조금 고칠 때마다
         시험이 깨져 실제 회귀와 구분되지 않는다.
    */
    const i = api.indexOf("body.orderType === 'stop'");
    const blk = api.slice(Math.max(0, i - 200), i + 300);
    expect(blk, '기존 price 를 덮어쓴다 — stop_limit 에서 두 값이 다르다')
      .toMatch(/body\.price === undefined/);
  });

  it('초안 스키마에 stopPrice 가 없다는 사실을 고정한다', () => {
    /*
       ★ 스키마에 `stopPrice` 가 추가되면 이 시험이 실패한다. 그때 위 우회를 지우고
         제대로 보내도록 고치라는 신호다 — 우회가 영구히 남지 않게 한다.
    */
    const sch = read('packages/schemas/src/order.ts');
    const i = sch.indexOf('OrderDraftSchema');
    const blk = sch.slice(i, i + 1400);
    expect(blk, '초안 스키마에 stopPrice 가 생겼다 — api-client 의 우회를 정리하라')
      .not.toMatch(/^\s*stopPrice:/m);
  });
});

/*
   ═══ TP/SL 기준가와 부분 익절/손절 ═══

   운영자 지적(2026-09-14):
     "sl tp가 현재가격기준되는거같은데..? 내가 진입한 기준으로 되어야할 것 같은데"
     "올 sl tp랑 부분 sl tp도 필요한데 다른 코인 거 처럼말이야."

   ★★★ 첫 번째 지적이 맞았다. 초안 선이 **현재가**에서 시작하고, 라벨의 %도 현재가
     대비였다(`kind: 'away'`). 손절·익절에서 알아야 하는 것은 "지금 가격에서 얼마
     떨어졌나" 가 아니라 **"거기 닿으면 내 손익이 얼마인가"** 이고, 그 기준은 진입가다.
     현재가 대비로 적으면 가격이 움직일 때마다 숫자가 바뀌어 같은 손절이 −1% 로도,
     −3% 로도 보인다 — 위험을 잘못 읽는다.
*/
describe('TP/SL — 진입가 기준', () => {
  const app = read('src/app.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const lv = read('src/chart-overlay-live.js');

  it('★★★ 초안이 진입가에서 시작한다', () => {
    const i = app.indexOf('onSetBracket={(posId, kind) => {');
    const blk = app.slice(i, app.indexOf('onClose={(posId, pct)', i));
    expect(blk, '초안이 아직 현재가에서 시작한다')
      .toMatch(/const px = Number\(pos\.entry\) \|\| Number\(pos\.mark\)/);
    /* ★ ±2% 같은 기본 폭을 넣으면 우리가 손절 폭을 권한 것으로 읽힌다. */
    expect(blk, '기본 폭을 넣었다 — 조언으로 읽힌다').not.toMatch(/\*\s*1\.02|\*\s*0\.98/);
  });

  it('★★★ 두 선 모두 진입가 기준 라벨을 쓴다', () => {
    /* 초안과 걸린 주문이 서로 다른 기준을 쓰면 확정 전후로 숫자가 바뀐다. */
    const cnt = (app.match(/kind: 'bracket'/g) || []).length;
    expect(cnt, "kind:'bracket' 이 두 곳(초안·걸린 선)에 없다").toBeGreaterThanOrEqual(2);
    expect(app, "아직 kind:'away' 로 보호주문 라벨을 만든다")
      .not.toMatch(/kind: 'away', symbol: String\(p(os)?\.symbol/);
  });

  it('라벨이 변동%·ROE·금액을 진입가로 계산한다', () => {
    const i = lv.indexOf("live.kind === 'bracket'");
    expect(i, 'bracket 라벨 계산이 없다').toBeGreaterThan(-1);
    const blk = lv.slice(i, i + 1800);
    expect(blk, '진입가를 쓰지 않는다').toMatch(/const entry = Number\(live\.entry\)/);
    expect(blk, '방향을 반영하지 않는다').toMatch(/live\.side === 'short' \? -1 : 1/);
    /* ★★ 레버리지를 모르면 ROE 를 적지 않는다 — 1배 가정은 손실을 작게 보이게 한다. */
    expect(blk, '레버리지 없이 ROE 를 적는다')
      .toMatch(/Number\.isFinite\(lev\) && lev > 0\) \? ` · ROE/);
    /* ★ 수량을 모르면 금액을 적지 않는다. */
    expect(blk, '수량 없이 금액을 적는다').toMatch(/Number\.isFinite\(qty\) && qty > 0/);
  });
});

describe('부분 익절/손절', () => {
  const app = read('src/app.jsx');
  const wid = read('src/widgets.jsx');

  it('★★ 비율 버튼(25/50/100%)이 확정 동작이다', () => {
    /* 확정을 따로 두면 클릭이 두 번이 되고 종료 버튼과 방식이 달라져 헷갈린다. */
    /*
       ★★★ 역검증에서 이 시험이 `[100]` 으로 줄여도 통과했다 — 넓은 정규식이 앞부분만
         보고 지나갔다. 비율 목록을 **각각** 확인한다. 부분 익절이 사라지면 잡혀야 한다.
    */
    expect(wid, '비율 버튼이 확정을 부르지 않는다')
      .toMatch(/onConfirmBracket && onConfirmBracket\(p\.id, k, pct\)/);

    /*
       ★★★ **개수로 센다.** 처음에는 비율 목록을 문자열로만 확인했는데, 같은
         `[25, 50, 100]` 이 **종료 버튼에도** 있어서 보호주문 쪽을 `[100]` 으로 줄여도
         시험이 통과했다(역검증에서 두 번 놓쳤다). 두 곳 모두 있어야 한다:
           ① 포지션 종료 비율
           ② 부분 익절/손절 비율
    */
    const lists = (wid.match(/\[25, 50, 100\]\.map/g) || []).length;
    expect(lists, '비율 목록이 두 곳(종료·보호주문)에 없다 — 부분 익절/손절이 사라졌다')
      .toBeGreaterThanOrEqual(2);
  });

  it('★★★ 수량을 내림한다 — 보유량을 넘으면 거절된다', () => {
    const i = app.indexOf('const guardQty = (() => {');
    expect(i, '보호주문 수량 계산이 없다').toBeGreaterThan(-1);
    expect(app.slice(i, i + 900), '내림하지 않는다').toMatch(/Math\.floor\(/);
  });

  it('★★★ 옮길 때는 원래 주문 수량을 유지한다', () => {
    /*
       옮기는 것은 가격을 바꾸는 일이다. 수량까지 바뀌면 **부분 익절이 조용히 전량이
       된다** — 고객이 남겨 두려던 포지션이 전부 닫힌다.
    */
    const i = app.indexOf('const guardQty = (() => {');
    const blk = app.slice(i, i + 900);
    expect(blk, 'pct 가 없을 때 원래 수량을 쓰지 않는다')
      .toMatch(/pct === null \|\| pct === undefined[\s\S]{0,160}ref0\.orderQty/);
    expect(wid, '옮기기가 비율을 넘긴다').toMatch(/onConfirmBracket\(p\.id, k, null\)/);
    expect(app, '오버레이에 주문 수량을 담지 않는다').toMatch(/orderQty: ordQty \|\| null/);
  });

  it('부분 보호주문의 금액은 주문 수량으로 계산한다', () => {
    /* ★ 포지션 수량으로 계산하면 부분 익절의 예상 이익이 실제보다 크게 보인다. */
    expect(app, '주문 수량을 라벨에 쓰지 않는다').toMatch(/size: ordQty \|\| p\.size/);
  });
});
