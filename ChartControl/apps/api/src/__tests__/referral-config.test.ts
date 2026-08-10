/**
 * 거래소 추천(레퍼럴) 링크 설정 테스트.
 *
 * 여기서 지키는 두 가지
 * -------------------
 * 1. 안전: 설정 파일은 신뢰 경계 밖일 수 있다. `javascript:` 같은 스킴이 그대로
 *    화면의 링크가 되면 클릭 한 번에 스크립트가 실행된다.
 * 2. 수익: 설정에 없는 거래소는 링크가 **없어야** 한다. 예시 코드가 박힌 링크를
 *    내보내면 사용자는 가입하지만 귀속이 안 돼 수수료 수익이 0 이 된다.
 *    가입은 정상으로 보이므로 새는 것을 알아채기 어렵다. 실제로 9개 거래소에
 *    예시 코드('QUANTUM-KURI')가 박혀 있었다.
 */

import { describe, expect, it } from 'vitest';

import { loadEnv } from '../env';

/** 부팅에 필요한 최소 환경. 레퍼럴과 무관한 값은 고정한다. */
const BASE = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'x'.repeat(32),
  CSRF_SECRET: 'y'.repeat(32),
  ENCRYPTION_KEY: 'z'.repeat(32),
} as const;

const load = (extra: Record<string, string | undefined>) =>
  loadEnv({ ...BASE, ...extra } as never);

describe('거래소 추천 링크 설정', () => {
  it('설정이 없으면 링크도 없다 — 예시 링크로 채우지 않는다', () => {
    const env = load({});
    expect(env.kucoinReferralUrl).toBe('');
    expect(env.exchangeReferralUrls).toEqual({});
  });

  it('https 링크를 그대로 통과시킨다', () => {
    const env = load({ KUCOIN_REFERRAL_URL: 'https://www.kucoin.com/r/rf/ABC123' });
    expect(env.kucoinReferralUrl).toBe('https://www.kucoin.com/r/rf/ABC123');
    expect(env.exchangeReferralUrls.kucoin).toBe('https://www.kucoin.com/r/rf/ABC123');
  });

  it('javascript: 스킴을 거부한다 — 링크 클릭이 스크립트 실행이 되면 안 된다', () => {
    const env = load({ KUCOIN_REFERRAL_URL: 'javascript:alert(document.cookie)' });
    expect(env.kucoinReferralUrl).toBe('');
    expect(env.exchangeReferralUrls.kucoin).toBeUndefined();
  });

  it('data: 와 file: 도 거부한다', () => {
    for (const bad of ['data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://x.com/a']) {
      expect(load({ KUCOIN_REFERRAL_URL: bad }).kucoinReferralUrl, bad).toBe('');
    }
  });

  it('형식이 잘못돼도 부팅을 막지 않는다 — 레퍼럴 때문에 서비스가 죽으면 안 된다', () => {
    // 던지지 않고 빈 값이 되어야 한다.
    expect(() => load({ KUCOIN_REFERRAL_URL: 'not a url at all' })).not.toThrow();
    expect(load({ KUCOIN_REFERRAL_URL: 'not a url at all' }).kucoinReferralUrl).toBe('');
  });

  it('공백만 있으면 없는 것으로 본다', () => {
    expect(load({ KUCOIN_REFERRAL_URL: '   ' }).kucoinReferralUrl).toBe('');
  });

  it('접두어 방식으로 거래소를 추가할 수 있다 — 코드 수정 없이', () => {
    const env = load({
      EXCHANGE_REFERRAL_URL_BINANCE: 'https://accounts.binance.com/register?ref=AAA',
      EXCHANGE_REFERRAL_URL_OKX: 'https://www.okx.com/join/BBB',
    });
    expect(env.exchangeReferralUrls.binance).toBe('https://accounts.binance.com/register?ref=AAA');
    expect(env.exchangeReferralUrls.okx).toBe('https://www.okx.com/join/BBB');
    // 설정하지 않은 거래소는 없다.
    expect(env.exchangeReferralUrls.bybit).toBeUndefined();
  });

  it('접두어 설정도 스킴 검증을 받는다', () => {
    const env = load({ EXCHANGE_REFERRAL_URL_BYBIT: 'javascript:void(0)' });
    expect(env.exchangeReferralUrls.bybit).toBeUndefined();
  });

  it('전용 변수가 접두어 설정보다 우선한다 — 더 구체적인 설정이 이긴다', () => {
    const env = load({
      EXCHANGE_REFERRAL_URL_KUCOIN: 'https://www.kucoin.com/r/rf/FROM_PREFIX',
      KUCOIN_REFERRAL_URL: 'https://www.kucoin.com/r/rf/FROM_DEDICATED',
    });
    expect(env.exchangeReferralUrls.kucoin).toBe('https://www.kucoin.com/r/rf/FROM_DEDICATED');
  });

  it('거래소 ID 는 소문자로 정규화된다 — 화면의 exchange.id 와 맞아야 한다', () => {
    const env = load({ EXCHANGE_REFERRAL_URL_KuCoin: 'https://www.kucoin.com/r/rf/CASE' });
    expect(env.exchangeReferralUrls.kucoin).toBe('https://www.kucoin.com/r/rf/CASE');
  });

  it('추천 링크는 브로커 자격증명과 별개다', () => {
    /*
       두 수익원을 섞으면 계산이 틀린다.
         레퍼럴 = 링크로 신규 가입한 사람의 수수료 일부. 자격증명 불필요.
         브로커 = 주문 헤더로 받는 리베이트. 파트너 3종 필요.
       레퍼럴만 설정해도 브로커 값이 생기지 않아야 한다.
    */
    const env = load({ KUCOIN_REFERRAL_URL: 'https://www.kucoin.com/r/rf/ABC' });
    expect(env.kucoinBrokerPartner).toBe('');
    expect(env.kucoinBrokerKey).toBe('');
    expect(env.kucoinBrokerName).toBe('');
  });
});
