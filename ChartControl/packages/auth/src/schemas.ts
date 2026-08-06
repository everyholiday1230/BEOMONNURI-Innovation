import { z } from 'zod';

export const RegisterInputSchema = z
  .object({
    email: z.string().email().max(254).transform((s) => s.toLowerCase()),
    password: z.string().min(10).max(200),
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
