/**
 * 미리보기 토큰 — 서명·만료·주문내용 묶음을 고정한다.
 *
 * ★★ 무엇이 문제였나
 *
 *   실주문 게이트가 `previewExpired: false` 를 **하드코딩**하고,
 *   `confirmationTokenValid` 는 `Boolean(body.confirmationToken)` 즉 **존재 여부만**
 *   봤다. 게이트가 없는 보호를 있다고 말하고 있었다.
 */
import { describe, it, expect } from 'vitest';
import {
  issuePreviewToken, verifyPreviewToken, PREVIEW_TOKEN_TTL_MS,
  type PreviewBinding,
} from '../trading/preview-token.js';

const SECRET = 'test-secret-not-used-in-production';
const bind: PreviewBinding = {
  userId: 'u1', symbol: 'BTCUSDT', side: 'long', orderType: 'limit',
  quantity: '0.043', price: '90000', leverage: '3', marginMode: 'isolated',
};

describe('미리보기 토큰', () => {
  it('발급한 토큰은 통과한다', () => {
    const t = issuePreviewToken(SECRET, bind);
    const r = verifyPreviewToken(SECRET, t, bind);
    expect(r.ok).toBe(true);
  });

  it('없거나 형식이 아니면 MALFORMED', () => {
    for (const bad of [undefined, null, '', 'garbage', 'p1.only-two', 'p9.1.abc']) {
      const r = verifyPreviewToken(SECRET, bad as string, bind);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('MALFORMED');
    }
  });

  it('다른 비밀로 만든 토큰은 MISMATCH — 위조가 통과하지 않는다', () => {
    const t = issuePreviewToken('other-secret', bind);
    const r = verifyPreviewToken(SECRET, t, bind);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MISMATCH');
  });

  it('★ 수량이 바뀌면 MISMATCH — 작은 주문 토큰으로 큰 주문을 확인할 수 없다', () => {
    const t = issuePreviewToken(SECRET, { ...bind, quantity: '0.001' });
    const r = verifyPreviewToken(SECRET, t, { ...bind, quantity: '10' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MISMATCH');
  });

  it('★ 다른 사용자의 토큰은 MISMATCH', () => {
    const t = issuePreviewToken(SECRET, { ...bind, userId: 'attacker' });
    const r = verifyPreviewToken(SECRET, t, bind);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MISMATCH');
  });

  it('방향·심볼·레버리지·마진모드·가격·주문유형 모두 묶인다', () => {
    const variants: Array<Partial<PreviewBinding>> = [
      { side: 'short' }, { symbol: 'ETHUSDT' }, { leverage: '20' },
      { marginMode: 'cross' }, { price: '1' }, { orderType: 'market' },
    ];
    for (const v of variants) {
      const t = issuePreviewToken(SECRET, bind);
      const r = verifyPreviewToken(SECRET, t, { ...bind, ...v });
      expect(r.ok, JSON.stringify(v)).toBe(false);
    }
  });

  it('TTL 을 넘기면 EXPIRED (MISMATCH 와 구분된다)', () => {
    const now = 1_700_000_000_000;
    const t = issuePreviewToken(SECRET, bind, now);
    const ok = verifyPreviewToken(SECRET, t, bind, now + PREVIEW_TOKEN_TTL_MS - 1);
    expect(ok.ok).toBe(true);
    const late = verifyPreviewToken(SECRET, t, bind, now + PREVIEW_TOKEN_TTL_MS + 1);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('EXPIRED');
  });

  it('미래 시각 토큰도 EXPIRED — 시계가 어긋나도 무한 유효 토큰이 생기지 않는다', () => {
    const now = 1_700_000_000_000;
    const t = issuePreviewToken(SECRET, bind, now + 60_000);
    const r = verifyPreviewToken(SECRET, t, bind, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EXPIRED');
  });

  it('구분자 혼동으로 다른 조합이 같은 서명을 만들지 않는다', () => {
    /* 'a'+'bc' 와 'ab'+'c' 가 같은 정규화 문자열이 되면 서명이 같아진다. */
    const t = issuePreviewToken(SECRET, { ...bind, symbol: 'AB', side: 'C' });
    const r = verifyPreviewToken(SECRET, t, { ...bind, symbol: 'A', side: 'BC' });
    expect(r.ok).toBe(false);
  });
});
