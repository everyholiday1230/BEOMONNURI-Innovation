/*
   운영 지시 (2026-09-18 세 번째 묶음):
     · "만료든 고객이 삭제하든 우리 서버에는 항상 저장되어야 해"
     · "레버리지도 제대로 나오게 해줘, 안 나오게 하지 말고"
     · "차트가 1M 도 있더라 — 쿠코인에 있는 거 다 그대로"
     · "히스토리에 %까지 넣어줘, 금액이랑 +- 얼마 했는지"
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TIMEFRAMES, TIMEFRAME_MS } from '@quantumtrade/config';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('차트 주기가 KuCoin 이 주는 것과 같다', () => {
  /*
     ★★★ **실제 API 로 확인한 값이다**(2026-09-18). 추측하지 않았다.
       선물 granularity: 1·3·5·15·30·60·120·240·480·720·1440·10080·43200
         ★ 360(6h) 은 `Unsupported granularity` — 선물에 6시간은 없다
       현물 type: 1min…4hour·**6hour**·8hour·12hour·1day·1week·**1month**
  */
  it('새 주기가 목록에 있다', () => {
    for (const tf of ['8h', '12h', '1M', '6h'] as const) {
      expect(TIMEFRAMES as readonly string[], `${tf} 가 없다`).toContain(tf);
    }
  });

  it('모든 주기에 밀리초가 있다', () => {
    /* ★ 빠지면 갭 보정이 `undefined` 로 계산해 조용히 어긋난다. */
    for (const tf of TIMEFRAMES) {
      expect(Number(TIMEFRAME_MS[tf]), `${tf} 의 밀리초가 없다`).toBeGreaterThan(0);
    }
  });

  it('1M 은 한 달이고 1m 과 다르다', () => {
    /* ★ 대문자 하나로만 구별된다 — 같은 값이면 어딘가에서 섞인 것이다. */
    expect(TIMEFRAME_MS['1M']).toBeGreaterThan(TIMEFRAME_MS['1w']);
    expect(TIMEFRAME_MS['1M']).not.toBe(TIMEFRAME_MS['1m']);
  });

  it('KuCoin 선물 매핑이 확인된 값과 같다', () => {
    const src = read('packages/exchange-kucoin/src/symbols.ts');
    for (const [tf, g] of [['3m', 3], ['8h', 480], ['12h', 720], ['1M', 43200]] as const) {
      expect(src, `${tf} → ${g} 매핑이 없다`).toMatch(new RegExp(`'${tf}': ${g},`, 'u'));
    }
    /* ★ 6h 는 선물에 없다 — 매핑에 넣으면 거래소가 거절한다. */
    expect(src, '6h 를 선물 매핑에 넣었다 — 거래소가 거절한다').not.toMatch(/'6h': 360/u);
    const um = /UNSUPPORTED_TIMEFRAMES[^=]*=\s*new Set\(\[([^\]]*)\]\)/u.exec(src);
    expect(um && um[1], '6h 를 미지원으로 표시하지 않았다').toMatch(/'6h'/u);
  });


  /*
     ★★★ **`1M`(한 달)을 소문자로 바꾸면 `1m`(1분)이 된다.**

       주기에 한 달을 추가하자마자 `normalizeTimeframe` 이 그것을 1분으로 바꿨다.
       고객이 월봉을 골랐는데 1분봉이 오고, **오류도 없이** 조용히 일어난다 —
       차트가 그럴듯하게 그려지므로 알아채기 어렵다.
  */
  it('1M 을 소문자로 바꾸지 않는다', () => {
    const client = read('src/api-client.js');
    const i = client.indexOf('function normalizeTimeframe(tf)');
    expect(i, 'normalizeTimeframe 이 없다').toBeGreaterThan(-1);
    const body = client.slice(i, i + 1400);
    expect(body, '1M 예외가 없다 — 월봉이 1분봉이 된다').toMatch(/if \(raw === '1M'\) return '1M';/u);
    /* 나머지는 소문자로 바꿔야 한다 — 대문자를 보내면 서버가 400 을 준다. */
    expect(body, '소문자 변환이 사라졌다').toMatch(/return raw\.toLowerCase\(\);/u);
  });

  it('화면 주기 목록이 서버 목록과 어긋나지 않는다', () => {
    /*
       ★ 화면은 대문자(`4H`), 서버는 소문자(`4h`)를 쓴다. `1M` 만 양쪽이 대문자다.
       ★ 화면에만 있는 주기를 고르면 서버가 400 을 준다 — 빈 차트가 된다.
    */
    const app = read('src/app.jsx');
    const m = /\[('1m'[^\]]*)\]\.map\(tf =>/u.exec(app);
    expect(m, '차트 툴바 주기 목록을 찾지 못했다').not.toBeNull();
    const shown = (m![1]!.match(/'([^']+)'/gu) || []).map((x) => x.replace(/'/gu, ''));
    const serverSet = new Set(TIMEFRAMES as readonly string[]);
    /*
       ★★★ **소문자로 바꿔서 비교하면 `3M` 이 `3m` 으로 통과한다.**

         역검증에서 화면에 `3M`(석 달)을 넣어 봤는데 잡히지 않았다 — `toLowerCase()` 가
         `3m`(3분)으로 만들었고 그것은 서버 목록에 있다. **다른 주기로 바뀌어 통과한
         것이다.** 실제로 그 상태라면 고객이 석 달을 골랐는데 3분봉이 온다.

       ★ 그래서 `normalizeTimeframe` 과 **똑같은 규칙**으로 변환한다: `1M` 만 그대로,
         나머지는 소문자. 그 결과가 서버 목록에 있어야 한다.
       ★ 화면 표기가 대문자 `M` 으로 끝나면서 `1M` 이 아니면 그 자체로 잘못이다 —
         소문자 변환이 분(minute)으로 바꿔 버린다.
    */
    const bad = shown.filter((tf) => {
      if (/^\d+M$/u.test(tf) && tf !== '1M') return true;   // 3M 같은 것 — 분으로 오인된다
      const norm = tf === '1M' ? '1M' : tf.toLowerCase();
      return !serverSet.has(norm);
    });
    expect(bad, `서버가 모르거나 분으로 오인되는 주기가 화면에 있다: ${bad.join(', ')}`).toEqual([]);
  });

  it('3m 을 더는 미지원으로 표시하지 않는다', () => {
    /* ★★ 실제로 지원된다(granularity=3 이 봉 200개를 준다). 못 하는 것과 안 만든 것은 다르다. */
    const src = read('packages/exchange-kucoin/src/symbols.ts');
    /*
       ★ **주석이 아니라 실제 Set 내용을 본다.** 처음에는 `UNSUPPORTED_TIMEFRAMES` 부터
         120자를 봤는데 그 범위에 "3m 을 뺐다" 는 **설명 주석**이 들어가 헛실패했다.
         `new Set([...])` 안쪽만 잘라서 본다.
    */
    const m = /UNSUPPORTED_TIMEFRAMES[^=]*=\s*new Set\(\[([^\]]*)\]\)/u.exec(src);
    expect(m, '미지원 목록 선언을 찾지 못했다').not.toBeNull();
    const inside = m![1]!;
    expect(inside, `3m 이 여전히 미지원 목록에 있다: ${inside}`).not.toMatch(/'3m'/u);
    expect(inside, '6h 가 미지원 목록에 없다').toMatch(/'6h'/u);
  });
});

describe('레버리지를 정의대로 구한다', () => {
  const rest = read('packages/exchange-kucoin/src/private-rest.ts');

  /*
     ★★★ KuCoin 은 **크로스 포지션에 `realLeverage` 를 주지 않는다.** 그래서 화면에
       `×` 만 나오거나 종료 확인창이 `1×` 로 떴다. 운영자가 두 번 지적했다.
     ★ 레버리지는 정의상 `포지션 가치 ÷ 증거금` 이다. 지어내는 것이 아니라 정의대로
       구하는 것이다 — KuCoin 이 `posMargin`·`markPrice`·`currentQty` 를 준다.
  */
  it('거래소 값이 있으면 그것을 쓴다', () => {
    const i = rest.indexOf('leverage: (() => {');
    expect(i, '레버리지 계산이 없다').toBeGreaterThan(-1);
    const body = rest.slice(i, i + 1800);
    expect(body, '거래소 값을 우선하지 않는다')
      .toMatch(/const given = Number\(r\.realLeverage \?\? 0\);[\s\S]{0,140}return given;/u);
  });

  it('없으면 증거금으로 역산한다', () => {
    const i = rest.indexOf('leverage: (() => {');
    const body = rest.slice(i, i + 1800);
    expect(body, '명목가를 구하지 않는다').toMatch(/const notional = mark \* qty \* mult;/u);
    expect(body, '증거금으로 나누지 않는다').toMatch(/const lev = notional \/ margin;/u);
  });

  it('구할 수 없으면 0 이다 — 1 로 두지 않는다', () => {
    /* ★★ 1배라고 말하면 청산 위험을 실제보다 작게 보이게 한다. */
    const i = rest.indexOf('leverage: (() => {');
    const body = rest.slice(i, i + 1800);
    expect(body, '모를 때 0 을 주지 않는다')
      .toMatch(/if \(!\(mark > 0\) \|\| !\(qty > 0\) \|\| !\(margin > 0\) \|\| mult === undefined\) return 0;/u);
    /* ★ 터무니없는 값도 버린다 — 승수를 잘못 알면 1000배 같은 수가 나온다. */
    expect(body, '상한 검사가 없다').toMatch(/lev > 300\) return 0;/u);
  });
});

describe('히스토리에 손익과 수익률이 나온다', () => {
  const adapter = read('apps/api/src/trading/kucoin-account-adapter.ts');
  const routes = read('apps/api/src/trading-routes.ts');
  const widgets = read('src/widgets.jsx');

  /*
     ★★★ 체결(fill)에는 손익이 없다 — 포지션이 닫힐 때 확정된다. 수익률은 그 거래에
       넣은 증거금을 알아야 구할 수 있고, 그것은 **청산 내역에만** 있다(레버리지·진입가).
  */
  it('청산 내역에서 레버리지와 가격을 읽는다', () => {
    const rest = read('packages/exchange-kucoin/src/private-rest.ts');
    for (const f of ['leverage', 'openPrice', 'closePrice']) {
      expect(rest, `청산 내역에 ${f} 가 없다`).toMatch(new RegExp(`${f}: `, 'u'));
    }
  });

  it('수익률은 순손익÷증거금이다', () => {
    const i = adapter.indexOf('async closedTrades(');
    expect(i, 'closedTrades 가 없다').toBeGreaterThan(-1);
    const body = adapter.slice(i, i + 4200);
    /* ★ 수수료·펀딩비를 반영한 순손익을 쓴다. */
    expect(body, '순손익을 계산하지 않는다')
      .toMatch(/D\(r\.pnl\)\.minus\(D\(r\.tradeFee\)\)\.plus\(D\(r\.fundingFee\)\)/u);
    expect(body, '증거금을 구하지 않는다').toMatch(/const margin = \(open \* qty\) \/ lev;/u);
    /* ★★ 가격 변화율로 근사하지 않는다 — 패널 숫자와 어긋난다. */
    expect(body, '수익률을 증거금 기준으로 내지 않는다')
      .toMatch(/\(Number\(net\.toString\(\)\) \/ margin\) \* 100/u);
  });

  it('구할 수 없으면 null 이다', () => {
    /* ★ 0% 로 적으면 본전이라는 뜻이 되어 거짓이다. */
    const i = adapter.indexOf('async closedTrades(');
    const body = adapter.slice(i, i + 4200);
    expect(body, '레버리지가 없을 때 null 을 주지 않는다').toMatch(/if \(!\(lev > 0\) \|\| !\(open > 0\)\) return null;/u);
    expect(body, '터무니없는 값을 걸러내지 않는다').toMatch(/Math\.abs\(pct\) > 10_000\) return null;/u);
  });

  it('라우트가 있고 없는 기능을 위장하지 않는다', () => {
    expect(routes, '청산 내역 라우트가 없다').toMatch(/app\.get\('\/trading\/closed-trades'/u);
    /* ★ 없는 기능을 빈 목록으로 주면 화면이 "거래가 없다" 로 읽는다. */
    expect(routes, '미지원을 빈 목록으로 위장한다').toMatch(/credentialStatus: 'UNSUPPORTED'/u);
  });

  it('화면이 금액과 %를 함께 보여준다', () => {
    expect(widgets, '청산 거래 표가 없다').toMatch(/closed\.map\(\(x\) =>/u);
    expect(widgets, '수익률을 보여주지 않는다').toMatch(/pct === null \? '—' :/u);
    expect(widgets, '금액을 보여주지 않는다').toMatch(/Number\.isFinite\(net\) \? `\$\{net >= 0 \? '\+' : ''\}/u);
    /* ★ 레버리지가 없으면 비운다 — 1× 로 적으면 위험을 작게 보이게 한다. */
    expect(widgets, '레버리지가 없을 때도 적는다').toMatch(/Number\(x\.leverage\) > 0 \? `\$\{x\.leverage\}×` : '—'/u);
  });

  it('조회 실패를 빈 목록으로 두지 않는다', () => {
    /* ★ 거래가 없는 것과 못 읽은 것은 다르다. */
    expect(widgets, '실패를 알리지 않는다').toMatch(/th_closed_failed/u);
  });
});

describe('삭제해도 서버에는 남는다', () => {
  const strategyRepo = read('apps/api/src/db/user-strategy-repo.ts');
  const savedRepo = read('apps/api/src/db/saved-item-repo.ts');

  /*
     ★★★ 운영 지시: "만료든 고객이 삭제하든 우리 서버에는 항상 저장되어야 해.
       대화기록이나 매매기록은 필수고. 우리가 다 학습시킬 거야."
  */
  it('삭제가 실제 삭제가 아니다', () => {
    expect(strategyRepo, '규칙을 실제로 지운다').toMatch(/UPDATE user_strategies SET deleted_at = now\(\)/u);
    expect(strategyRepo, 'DELETE 가 남아 있다').not.toMatch(/DELETE FROM user_strategies WHERE id = \$1/u);
    expect(savedRepo, '저장 항목을 실제로 지운다').toMatch(/UPDATE saved_items SET deleted_at = now\(\)/u);
    expect(savedRepo, 'DELETE 가 남아 있다').not.toMatch(/DELETE FROM saved_items WHERE id=\$1/u);
  });

  it('두 번 지우면 실패한다', () => {
    /* ★ 조건이 없으면 화면이 "지웠다" 를 두 번 말한다. */
    for (const src of [strategyRepo, savedRepo]) {
      expect(src, '이미 지운 것을 다시 지운다').toMatch(/deleted_at IS NULL/u);
    }
  });

  it('목록에서 삭제된 것을 뺀다', () => {
    for (const [name, src] of [['규칙', strategyRepo], ['저장 항목', savedRepo]] as const) {
      expect(src, `${name} 목록이 삭제된 것을 보여준다`)
        .toMatch(/deleted_at IS NULL AND \(expires_at IS NULL OR expires_at > now\(\)\)/u);
    }
  });

  it('마이그레이션이 멱등하다', () => {
    const up = read('infrastructure/postgres/0053_soft_delete_retain.postgres.sql');
    expect(up, '열 추가가 멱등하지 않다').toMatch(/ADD COLUMN IF NOT EXISTS deleted_at/u);
    expect(up, '색인이 멱등하지 않다').toMatch(/CREATE INDEX IF NOT EXISTS/u);
    expect(read('infrastructure/postgres/0053_soft_delete_retain.down.postgres.sql'), '되돌리기가 없다')
      .toMatch(/DROP COLUMN IF EXISTS deleted_at/u);
  });

  /*
     ★★★ **거래소 API 키는 보관 대상이 아니다.** 키를 지웠다는데 서버에 남겨 두면
       고객 자산에 접근할 수 있는 비밀을 계속 들고 있는 것이다.
  */
  it('거래소 API 키에는 적용하지 않는다', () => {
    const files = readdirSync(join(ROOT, 'apps/api/src/db'))
      .filter((f) => /credential|exchange/iu.test(f) && f.endsWith('.ts'));
    for (const f of files) {
      const s = readFileSync(join(ROOT, 'apps/api/src/db', f), 'utf8');
      if (!/DELETE FROM|deleted_at/u.test(s)) continue;
      expect(s, `${f}: API 키를 soft delete 로 남긴다 — 비밀을 계속 보관하게 된다`)
        .not.toMatch(/SET deleted_at = now\(\)/u);
    }
  });

  /*
     ★★★ **약관 자기모순을 없앤다.** 문서가 "기간 지나면 삭제" 만 적고 있었는데
       삭제해도 남긴다면 우리 문서가 우리 동작과 다르다.
  */
  it('개인정보 문서가 삭제 후 보관을 밝힌다', () => {
    /*
       ★★★ **§6(보관·삭제) 안쪽만 본다.**

         처음에는 문서 전체에서 "5 years" 를 찾았다. 그런데 그 문구는 위쪽 보관 표에도
         여러 번 나온다 — **삭제 후 보관 문장을 전부 지워도 통과했다**(역검증이 잡았다).
         절을 잘라서 그 안에서 확인한다.
    */
    for (const loc of ['en', 'ja', 'zh']) {
      const s = read(`docs/legal/privacy-${loc}.md`);
      const sec = /\n## 6\.[\s\S]*?(?=\n## 7\.)/u.exec(s);
      expect(sec, `privacy-${loc}: §6 절을 찾지 못했다`).not.toBeNull();
      const body = sec![0]!;
      expect(body, `privacy-${loc}: §6 에 삭제 후 보관 기간이 없다`)
        .toMatch(/5 years|5年|5 年/u);
      /* 삭제해도 남는다는 사실을 분명히 적어야 한다. */
      expect(body, `privacy-${loc}: 삭제해도 서버에 남는다는 설명이 없다`)
        .toMatch(/remains on our servers|当社サーバーには|我们服务器上会保留/u);
      /* ★ API 키는 예외임을 분명히 적어야 한다 — 비밀을 계속 보관하면 안 된다. */
      /*
         ★ 일본어는 `取引所APIキー` 처럼 **공백 없이** 붙여 쓴다. `API キー`(공백 포함)로
           찾으면 문장이 있는데도 못 찾는다 — 실제로 그렇게 헛실패했다.
      */
      expect(body, `privacy-${loc}: API 키 예외를 적지 않았다`)
        .toMatch(/API ?(keys?|キー)|API ?密钥/u);
    }
  });
});

describe('길이가 변하는 주기도 차트가 받아들인다', () => {
  const kline = read('src/chart-kline.jsx');

  /*
     ★★★ 운영자 보고: "1분봉은 로딩 중이라고만 나와."
       실측하니 막힌 것은 **월봉**이었다(0봉, 영원히 로딩).

       원인: `candlesMatchTimeframe` 이 `mode === want` 로 **정확히 같은지** 봤다.
       한 달은 **28·30·31일이 섞여** 있어서 우리가 정한 30일과 절대 같지 않다.
       그래서 매번 "이 캔들은 그 주기가 아니다" 로 판정해 데이터를 버렸다.
       실제 응답 간격: [31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31]
  */
  it('달·주만 여유를 준다', () => {
    const i = kline.indexOf('function candlesMatchTimeframe');
    const body = kline.slice(i, i + 2600);
    expect(body, '변동 주기 목록이 없다').toMatch(/const VARIABLE = \{ '1M': 0\.2, '1W': 0\.05 \}/u);
    /*
       ★★ **고정 길이 주기는 정확히 같아야 한다.** 전부 0.5~2배로 열어 보니
         `15m↔30m`·`1H↔2H`·`12H↔1D` 같은 **2배 조합이 모두 통과**했다 — 그러면 이
         검사가 존재하는 이유가 없어진다(엉뚱한 주기의 봉을 그대로 그린다).
    */
    expect(body, '고정 주기까지 여유를 줬다 — 2배 조합이 통과한다')
      .toMatch(/return mode === want;/u);
    expect(body, '비율 검사가 없다').toMatch(/ratio >= 1 - slack && ratio <= 1 \+ slack/u);
  });

  it('목업이 모든 주기를 안다', () => {
    /*
       ★★★ 목업이 주기를 모르면 `|| 15` 로 떨어져 **15분 간격 봉**이 나온다. 그러면
         간격 검사가 거부하고 영원히 로딩 중이 된다 — 실측으로 겪었다.
       ★ 툴바는 대문자(`1H`), 서버는 소문자(`1h`)를 쓴다. 양쪽을 다 받아야 한다.
    */
    const mock = read('src/mock-data.js');
    const i = mock.indexOf('const TF_MIN = {');
    expect(i, '목업 주기 표가 없다').toBeGreaterThan(-1);
    const body = mock.slice(i, mock.indexOf('};', i));
    for (const tf of ['1m', '3m', '30m', '1H', '2H', '6H', '8H', '12H', '1D', '1W', '1M']) {
      expect(body, `목업에 ${tf} 가 없다 — 15분 봉이 나와 로딩이 끝나지 않는다`)
        .toMatch(new RegExp(`'${tf}':`, 'u'));
    }
    /* 소문자도 받는다. */
    for (const tf of ['1h', '4h', '12h', '1d', '1w']) {
      expect(body, `목업에 소문자 ${tf} 가 없다`).toMatch(new RegExp(`'${tf}':`, 'u'));
    }
  });

  it('여유 폭이 다른 주기를 삼키지 않는다', () => {
    /*
       ★ 계산으로 확인한다: 월봉 ±20% 는 28~31일(0.93~1.03배)을 받고, 가장 가까운
         다른 주기인 1주(0.23배)·1일(0.03배)은 받지 않는다.
    */
    const MONTH = TIMEFRAME_MS['1M'];
    for (const days of [28, 29, 30, 31]) {
      const r = (days * 86_400_000) / MONTH;
      expect(r, `${days}일 간격이 월봉으로 인정되지 않는다`).toBeGreaterThanOrEqual(0.8);
      expect(r, `${days}일 간격이 월봉으로 인정되지 않는다`).toBeLessThanOrEqual(1.2);
    }
    /* 주봉·일봉이 월봉으로 오인되면 안 된다. */
    expect(TIMEFRAME_MS['1w'] / MONTH, '주봉이 월봉으로 오인된다').toBeLessThan(0.8);
    expect(TIMEFRAME_MS['1d'] / MONTH, '일봉이 월봉으로 오인된다').toBeLessThan(0.8);
  });
});

describe('보관된 것을 운영자가 확인할 수 있다', () => {
  const routes = read('apps/api/src/admin/admin-routes.ts');
  const strategyRepo = read('apps/api/src/db/user-strategy-repo.ts');
  const savedRepo = read('apps/api/src/db/saved-item-repo.ts');
  const index = read('apps/api/src/index.ts');
  const ui = read('src/pages-admin-more.jsx');

  /*
     ★★★ 만료·삭제가 모두 soft delete 가 되면서 **확인할 방법이 없어졌다.**
       운영자 질문: "규칙을 지운 건 어떻게 확인하지?" 고객 화면에서는 당연히 안 보이고,
       DB 를 직접 보는 것 말고는 길이 없었다.
  */
  it('라우트가 있다', () => {
    expect(routes, '보관 확인 라우트가 없다').toMatch(/app\.get\('\/admin\/users\/:id\/retained'/u);
    /* ★ 읽기 권한으로 막는다 — 아무나 볼 수 있으면 안 된다. */
    expect(routes, '권한 검사가 없다').toMatch(/retained'[\s\S]{0,300}guard\(c, 'admin\.user\.read'\)/u);
    /* ★ 조회를 감사에 남긴다 — 누가 고객 자료를 열어봤는지 남아야 한다. */
    expect(routes, '감사 기록이 없다').toMatch(/action: 'user\.retained\.read'/u);
  });

  it('두 저장소를 합쳐 보여준다', () => {
    for (const [name, src] of [['규칙', strategyRepo], ['저장 항목', savedRepo]] as const) {
      expect(src, `${name} 에 listRetained 가 없다`).toMatch(/async listRetained\(/u);
      /* 삭제된 것과 만료된 것 둘 다 잡아야 한다. */
      expect(src, `${name} 이 삭제·만료를 함께 보지 않는다`)
        .toMatch(/deleted_at IS NOT NULL OR expires_at <= now\(\)/u);
      /* ★ 이유를 구분해 준다 — 고객이 지운 것과 기간이 지난 것은 할 일이 다르다. */
      expect(src, `${name} 이 사라진 이유를 구분하지 않는다`)
        .toMatch(/reason: r\.deleted_at != null \? 'deleted' : 'expired'/u);
    }
  });

  /*
     ★★★ **내용은 돌려주지 않는다.** 확인에 필요한 것은 "남아 있는가" 이고, 조건식·도형
       까지 관리자 화면에 흘리면 감사 로그·브라우저 캐시에 사본이 하나 더 생긴다.
  */
  it('내용을 돌려주지 않는다', () => {
    for (const src of [strategyRepo, savedRepo]) {
      const i = src.indexOf('async listRetained(');
      const body = src.slice(i, i + 1600);
      expect(body, 'SELECT 에 내용이 들어 있다').not.toMatch(/SELECT[^;]*\b(config|payload)\b/u);
    }
  });

  /*
     ★★★ **저장소를 관리자 라우터보다 나중에 만들면 `undefined` 가 넘어간다.**
       아래쪽(3000줄대)에도 같은 저장소를 만들지만 그것은 라우터 등록보다 **나중**이다.
       그 변수를 넘기면 라우트가 항상 `supported:false` 를 준다 — 조용히 안 되는 종류다.
  */
  it('저장소가 실제로 주입된다', () => {
    expect(index, '관리자 라우터에 저장소를 넘기지 않는다')
      .toMatch(/userStrategies: core\.pool \? new PgUserStrategyRepo\(core\.pool\) : undefined/u);
    expect(index, '저장 항목 저장소를 넘기지 않는다')
      .toMatch(/savedItems: core\.pool \? new PgSavedItemRepo\(core\.pool\) : undefined/u);
  });

  it('확인 불가를 빈 목록으로 위장하지 않는다', () => {
    /*
       ★ "남은 것이 없다" 와 "확인할 수 없다" 는 전혀 다른 말이다. 전자를 보여주면
         운영자가 **보관이 안 되는 줄** 안다 — 학습 자료가 쌓이지 않는다고 오해한다.
    */
    expect(routes, '저장소가 없을 때 위장한다')
      .toMatch(/if \(!d\.userStrategies && !d\.savedItems\) return c\.json\(\{ supported: false/u);
    expect(ui, '화면이 네 상태를 구별하지 않는다').toMatch(/ret === 'unsupported'/u);
    expect(ui, '조회 실패를 알리지 않는다').toMatch(/ret === 'error'/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s2 = readFileSync(join(dir, f), 'utf8');
      if (!s2.includes('apg_apply')) continue;
      for (const k of ['aret_title', 'aret_deleted', 'aret_expired', 'aret_unsupported']) {
        if (!s2.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
