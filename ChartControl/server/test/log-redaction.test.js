/**
 * 로그 마스킹 검증.
 *
 * 실제로 겪은 회귀: 'sign' 부분 문자열 매칭이 'signal' 을 잡아 종료 시그널
 * 이름이 ***redacted*** 로 찍혔다. 아래 테스트가 그 케이스를 고정한다.
 * 동시에 진짜 비밀값이 새지 않는지도 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const REDACTED = '***redacted***';

/** log 모듈은 stdout 에 쓰므로, 캡처해서 검사한다. */
async function capture(fn) {
  const { log } = await import('../src/log.js');
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn(log);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines.map((l) => JSON.parse(l));
}

test('비밀 키는 마스킹된다', async () => {
  const [line] = await capture((log) =>
    log.error('테스트', {
      apiSecret: 'super-secret-value',
      passphrase: 'pass123',
      password: 'pw',
      token: 'tok',
      apiKey: 'ak',
      brokerKey: 'bk',
      'KC-API-SIGN': 'sig',
      'KC-API-PARTNER-SIGN': 'psig',
      authorization: 'Bearer x',
      cookie: 'a=b',
    }),
  );

  for (const k of Object.keys(line.meta)) {
    assert.equal(line.meta[k], REDACTED, `${k} 가 마스킹되지 않았다`);
  }
  // 원본 값이 직렬화 결과에 남지 않아야 한다.
  const raw = JSON.stringify(line);
  assert.ok(!raw.includes('super-secret-value'));
  assert.ok(!raw.includes('Bearer x'));
});

test("'signal' 은 마스킹하지 않는다 (sign 부분매칭 회귀 방지)", async () => {
  const [line] = await capture((log) => log.error('종료 시작', { signal: 'SIGTERM' }));
  assert.equal(line.meta.signal, 'SIGTERM');
});

test('무해한 키는 그대로 남는다', async () => {
  const [line] = await capture((log) =>
    log.error('테스트', {
      symbol: 'BTCUSDT',
      designer: 'kuri',
      assignment: 'x',
      cosign: 'y',
      count: 3,
      price: 63748.1,
      keyboard: 'ansi',
    }),
  );
  assert.equal(line.meta.symbol, 'BTCUSDT');
  assert.equal(line.meta.designer, 'kuri');
  assert.equal(line.meta.assignment, 'x');
  assert.equal(line.meta.count, 3);
  assert.equal(line.meta.price, 63748.1);
  assert.equal(line.meta.keyboard, 'ansi');
  // 'cosign' 은 토큰이 ['cosign'] 이므로 sign 과 일치하지 않는다.
  assert.equal(line.meta.cosign, 'y');
});

test('중첩 객체와 배열 내부도 마스킹된다', async () => {
  const [line] = await capture((log) =>
    log.error('테스트', {
      outer: { inner: { apiSecret: 'nested-secret' } },
      list: [{ token: 'in-array' }],
    }),
  );
  assert.equal(line.meta.outer.inner.apiSecret, REDACTED);
  assert.equal(line.meta.list[0].token, REDACTED);
  const raw = JSON.stringify(line);
  assert.ok(!raw.includes('nested-secret'));
  assert.ok(!raw.includes('in-array'));
});

test('snake_case / kebab-case 키도 잡는다', async () => {
  const [line] = await capture((log) =>
    log.error('테스트', {
      api_secret: 'a',
      'broker-key': 'b',
      API_KEY: 'c',
      access_key: 'd',
    }),
  );
  for (const k of Object.keys(line.meta)) {
    assert.equal(line.meta[k], REDACTED, `${k} 미마스킹`);
  }
});
