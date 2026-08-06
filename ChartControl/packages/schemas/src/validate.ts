import type { z } from 'zod';

/** Result of a boundary validation — never throws, always discriminable. */
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues: z.ZodIssue[] };

/**
 * Validate untrusted input (external API response, AI output, localStorage) against a schema.
 * Use at every trust boundary. Returns a discriminated result instead of throwing.
 */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    issues: parsed.error.issues,
  };
}
