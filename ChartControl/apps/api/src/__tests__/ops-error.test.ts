import { describe, it, expect, vi } from 'vitest';
import { fingerprintOf, ALERT_WINDOW_MS, PgOpsErrorStore } from '../ops/error-store';
import { captureError, handleServerError } from '../ops/error-alert';

/*
   ============================================================
   OPS-ERR — 오류 관측 장치.

   ★★ 왜 이 검사가 필요한가

     이 서비스는 장애를 **고객 신고로만** 알 수 있었다. 그 상태를 고치는 장치이므로
     장치 자체가 조용히 고장 나면 원래 상태로 되돌아간다. 특히 두 가지가 깨지기 쉽다:

       1) 지문(fingerprint) — 같은 원인을 같은 값으로 묶지 못하면 한 버그가 수천 행이
          되어 목록을 읽을 수 없고, 알림이 폭주해 운영자가 알림을 끈다.
       2) 실패 삼키기 — 관측 장치가 예외를 던지면 그것 때문에 요청이 깨진다.
          관측을 붙였다가 장애를 만드는 셈이다.
   ============================================================ */

describe('OPS-ERR 지문은 같은 원인을 하나로 묶는다', () => {
  it('[1] 같은 오류는 같은 지문', () => {
    const a = fingerprintOf({ source: 'server', message: 'boom', stack: 'at f (a.js:1:2)' });
    const b = fingerprintOf({ source: 'server', message: 'boom', stack: 'at f (a.js:1:2)' });
    expect(a).toBe(b);
  });

  it('[2] ★★ 메시지 안의 UUID 가 달라도 같은 지문 — 주문마다 새 행이 되면 안 된다', () => {
    const a = fingerprintOf({ source: 'server', message: 'order 3f7c1a2e-1111-4b2c-9d3e-aaaaaaaaaaaa not found' });
    const b = fingerprintOf({ source: 'server', message: 'order 91bb44de-2222-4c3d-8e4f-bbbbbbbbbbbb not found' });
    expect(a).toBe(b);
  });

  it('[3] ★★ 숫자만 다른 메시지도 같은 지문', () => {
    const a = fingerprintOf({ source: 'server', message: 'quantity 10 below minimum 0.001' });
    const b = fingerprintOf({ source: 'server', message: 'quantity 25000 below minimum 12.5' });
    expect(a).toBe(b);
  });

  it('[4] 스택의 행:열 번호가 달라도 같은 지문', () => {
    const a = fingerprintOf({ source: 'client', message: 'x', stack: 'at g (b.js:10:5)' });
    const b = fingerprintOf({ source: 'client', message: 'x', stack: 'at g (b.js:88:99)' });
    expect(a).toBe(b);
  });

  it('[5] 원인이 다르면 지문이 다르다', () => {
    const a = fingerprintOf({ source: 'server', message: 'cannot read property of undefined' });
    const b = fingerprintOf({ source: 'server', message: 'connection refused' });
    expect(a).not.toBe(b);
  });

  it('[6] 출처가 다르면 지문이 다르다 — 서버와 브라우저는 다른 문제다', () => {
    expect(fingerprintOf({ source: 'server', message: 'same' }))
      .not.toBe(fingerprintOf({ source: 'client', message: 'same' }));
  });

  it('[7] URL 은 지문에 들어가지 않는다 — 같은 버그가 화면마다 쪼개지면 안 된다', () => {
    // URL 은 RecordErrorInput 에만 있고 fingerprintOf 는 받지 않는다(구조로 보장).
    const a = fingerprintOf({ source: 'client', message: 'render failed' });
    const b = fingerprintOf({ source: 'client', message: 'render failed' });
    expect(a).toBe(b);
  });
});

/** record/markAlerted 만 흉내내는 최소 저장소. */
function fakeStore(over: Partial<Record<'isNew' | 'shouldAlert', boolean>> = {}, seenCount = 1) {
  const marked: string[] = [];
  return {
    marked,
    store: {
      record: vi.fn(async () => ({
        fingerprint: 'fp1',
        isNew: over.isNew ?? true,
        seenCount,
        shouldAlert: over.shouldAlert ?? true,
      })),
      markAlerted: vi.fn(async (fp: string) => { marked.push(fp); }),
    } as unknown as PgOpsErrorStore,
  };
}

const mailer = () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { sent, provider: { name: 'test', send: async (m: { to: string; subject: string; text: string }) => { sent.push(m); } } };
};

describe('OPS-ERR 알림', () => {
  const base = { appBaseUrl: 'https://example.invalid', environment: 'prod' };

  it('[8] 새 오류는 운영자에게 메일로 알린다', async () => {
    const { store, marked } = fakeStore();
    const m = mailer();
    await captureError({ ...base, store, mail: m.provider, to: 'ops@test.invalid' },
      { source: 'server', message: 'boom', url: '/api/x', method: 'POST', status: 500 });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.subject).toContain('새 오류');
    expect(m.sent[0]!.text).toContain('/api/x');
    // 보냈으면 표시해야 한다 — 안 하면 같은 오류로 계속 메일이 간다.
    expect(marked).toEqual(['fp1']);
  });

  it('[9] ★★ shouldAlert=false 면 보내지 않는다 (폭주 시 메일함이 막히면 알림이 무의미해진다)', async () => {
    const { store } = fakeStore({ shouldAlert: false });
    const m = mailer();
    await captureError({ ...base, store, mail: m.provider, to: 'ops@test.invalid' },
      { source: 'server', message: 'boom' });
    expect(m.sent).toHaveLength(0);
  });

  it('[10] 받는 주소가 없으면 기록만 하고 조용히 넘어간다', async () => {
    const { store } = fakeStore();
    const m = mailer();
    await captureError({ ...base, store, mail: m.provider, to: '  ' },
      { source: 'client', message: 'boom' });
    expect(m.sent).toHaveLength(0);
    expect(store.record).toHaveBeenCalledTimes(1);
  });

  it('[11] ★★ 메일 발송이 실패해도 던지지 않는다 — 관측이 요청을 깨뜨리면 안 된다', async () => {
    const { store } = fakeStore();
    const bad = { name: 'bad', send: async () => { throw new Error('smtp down'); } };
    await expect(captureError({ ...base, store, mail: bad, to: 'ops@test.invalid' },
      { source: 'server', message: 'boom' })).resolves.toBeUndefined();
  });

  it('[12] ★★ 기록이 실패해도 던지지 않는다', async () => {
    const store = { record: async () => { throw new Error('db down'); } } as unknown as PgOpsErrorStore;
    const m = mailer();
    await expect(captureError({ ...base, store, mail: m.provider, to: 'ops@test.invalid' },
      { source: 'server', message: 'boom' })).resolves.toBeUndefined();
    expect(m.sent).toHaveLength(0);
  });

  it('[13] 관측 장치가 꺼져 있으면(deps=null) 아무 일도 하지 않는다', async () => {
    await expect(captureError(null, { source: 'server', message: 'boom' })).resolves.toBeUndefined();
  });

  it('[14] 본문에 "1시간에 한 번만 알린다" 를 밝힌다 — 한 통을 한 번으로 오해하면 안 된다', async () => {
    const { store } = fakeStore({}, 47);
    const m = mailer();
    await captureError({ ...base, store, mail: m.provider, to: 'ops@test.invalid' },
      { source: 'server', message: 'boom' });
    expect(m.sent[0]!.text).toContain('47회');
    expect(m.sent[0]!.text).toContain('1시간에 한 번');
  });

  it('[15] 알림 창은 1시간이다', () => {
    expect(ALERT_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});


describe('OPS-ERR 서버 예외 처리 계약', () => {
  const base = { appBaseUrl: 'https://example.invalid', environment: 'prod' };

  it('[16] ★★ 응답에 예외 메시지를 넣지 않는다 — 내부 사정이 새면 안 된다', () => {
    const { store } = fakeStore();
    const m = mailer();
    const secret = 'relation "users" does not exist; DATABASE_URL=postgres://u:p@h/db';
    const out = handleServerError(
      { ...base, store, mail: m.provider, to: 'ops@test.invalid' },
      new Error(secret),
      { method: 'POST', path: '/api/trading/orders' },
      () => 'cid12345',
    );
    expect(out.body.error.message).toBe('');
    expect(JSON.stringify(out.body)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(out.body)).not.toContain('users');
  });

  it('[17] 추적 ID 를 응답과 본문 양쪽에 같은 값으로 넣는다', () => {
    const { store } = fakeStore();
    const m = mailer();
    const out = handleServerError(
      { ...base, store, mail: m.provider, to: 'x@test.invalid' },
      new Error('boom'), { method: 'GET', path: '/api/x' }, () => 'abc12345',
    );
    expect(out.correlationId).toBe('abc12345');
    expect(out.body.error.correlationId).toBe('abc12345');
  });

  it('[18] ★★ 예외를 기록으로 남긴다 (method·경로·500 포함)', async () => {
    const { store } = fakeStore();
    const m = mailer();
    handleServerError(
      { ...base, store, mail: m.provider, to: 'x@test.invalid' },
      new Error('kaboom'), { method: 'DELETE', path: '/api/admin/users/1' }, () => 'c',
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({
      source: 'server', message: 'kaboom', method: 'DELETE', url: '/api/admin/users/1', status: 500,
    }));
  });

  it('[19] 관측이 꺼져 있어도 응답은 정상적으로 만든다 — 관측이 요청을 깨뜨리면 안 된다', () => {
    const out = handleServerError(null, new Error('boom'), { method: 'GET', path: '/api/y' }, () => 'z');
    expect(out.body.error.code).toBe('INTERNAL_ERROR');
    expect(out.correlationId).toBe('z');
  });

  it('[20] 메시지가 없는 예외도 처리한다', () => {
    const { store } = fakeStore();
    const m = mailer();
    const out = handleServerError(
      { ...base, store, mail: m.provider, to: 'x@test.invalid' },
      new Error(''), { method: 'GET', path: '/api/z' }, () => 'q',
    );
    expect(out.body.error.code).toBe('INTERNAL_ERROR');
  });
});
