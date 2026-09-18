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
