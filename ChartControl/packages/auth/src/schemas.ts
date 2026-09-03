import { z } from 'zod';

export const RegisterInputSchema = z
  .object({
    email: z.string().email().max(254).transform((s) => s.toLowerCase()),
    password: z.string().min(10).max(200),
    /*
       가입 시 선택한 국가 (ISO 3166-1 alpha-2, 또는 목록에 없을 때 'OTHER').

       ★★ 이 항목이 없어서 화면이 물어본 값을 서버가 그대로 버렸다. 가입 화면에
         195개국 선택 칸이 있고 클라이언트도 보내고 있었는데, 이 스키마가
         email·password 만 통과시켰다. **묻고서 듣지 않는 입력**이었다.

       ★ 선택 항목이다. 국가를 고르지 않아 가입이 막히면 그 손해가 이 정보의
         가치보다 크다.

       ★★ 잘못된 값은 **거부하지 않고 버린다**(catch → undefined 가 아니라
         optional 로 두고 서버에서 정규화). 브라우저가 이상한 값을 보냈다고
         가입 자체를 실패시키면, 고객은 자기가 무엇을 잘못했는지 알 수 없다.
         국가는 부가 정보이고 계정 생성이 본체다.
    */
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === 'OTHER' || /^[A-Z]{2}$/.test(v), 'country must be ISO alpha-2 or OTHER')
      .optional(),
    /*
       그 값의 근거.

       ★★ 브라우저 언어·시간대로 추정해 미리 채운 값과 사용자가 직접 고른 값은
         **사실의 성질이 다르다.** 나중에 국가별 평균이나 언어 확장을 판단할 때
         추정치를 선언으로 취급하면 숫자가 조용히 왜곡된다.

       ★ 모르면 'inferred' 로 본다 — 사용자가 골랐다고 단정하는 쪽이 위험하다.
    */
    countrySource: z.enum(['user', 'inferred']).optional(),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, {
    message: 'password must not equal email',
    path: ['password'],
  });
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const PreferencesSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  brand: z.string().max(40).optional(),
  density: z.string().max(40).optional(),
  longshort: z.string().max(40).optional(),
  locale: z.enum(['ko', 'en']).optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
