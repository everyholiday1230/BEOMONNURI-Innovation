import { z } from 'zod';

/**
 * G1 — Exchange catalogue.
 *
 * Contract source: `team_delivery/src/mock-app-data.js` → `window.QTApp.EXCHANGES` (8 entries).
 * The design handoff states that array IS the API response schema, so the field names and shapes here
 * are taken verbatim from it. Extraction was done by loading the file in a node VM rather than by
 * reading it by eye, so the field list is exhaustive rather than a guess.
 *
 * Two fields are ADDED beyond the mock (`requiredPermissions`, `forbiddenPermissions`). Justification:
 * absolute rule §5.4 — "API key Withdraw 권한 절대 금지" must be enforced by the server, not only
 * displayed by the UI. In the prototype that rule lives in hardcoded copy
 * (`pages-more.jsx:116` → `{ ok: false, text: 'Withdraw 권한 (❌ 절대 활성화 금지)' }`), which a
 * backend cannot enforce. Making it data lets both the wizard and the credential-verification path
 * read the same source. Additive only: every field the prototype reads is still present.
 */

/** Credential fields an exchange requires when a user connects an API key. */
export const ExchangeCredentialFieldSchema = z.enum([
  'apiKey',
  'apiSecret',
  'passphrase',
  'memo',
  'privateKey',
]);
export type ExchangeCredentialField = z.infer<typeof ExchangeCredentialFieldSchema>;

/**
 * Permission scopes as named by the exchanges. `Withdraw` is deliberately part of the enum: the
 * catalogue must be able to state that an exchange OFFERS it in order to state that we FORBID it.
 */
export const ExchangePermissionSchema = z.enum([
  'Read',
  'Trade',
  'Withdraw',
  'Futures',
  'Margin',
  'Copy',
]);
export type ExchangePermission = z.infer<typeof ExchangePermissionSchema>;

/**
 * Rollout state. `available` = connectable now; `beta` = connectable with a caveat shown;
 * `coming-soon` = listed but not connectable. Values verbatim from the mock.
 */
export const ExchangeStatusSchema = z.enum(['available', 'beta', 'coming-soon']);
export type ExchangeStatus = z.infer<typeof ExchangeStatusSchema>;

/** A hex colour as used by the design tokens for the exchange logo chip. */
const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/u, 'must be a 6-digit hex colour');

export const ExchangeSchema = z
  .object({
    /** Stable slug. Also the adapter key in `packages/exchange-adapters`. */
    id: z.string().regex(/^[a-z0-9-]+$/u).min(2).max(32),
    name: z.string().min(1).max(64),

    // --- presentation (design tokens; the UI renders a logo chip from these) ---
    logoText: z.string().min(1).max(4),
    logoBg: HexColor,
    logoColor: HexColor,
    /** Free-text positioning line, e.g. "Global · #1 by volume". */
    market: z.string().min(1).max(120),

    /** Product lines the exchange offers, e.g. ["Spot","Perp","Futures"]. Free-form by design. */
    supportedProducts: z.array(z.string().min(1).max(32)).min(1).max(12),
    /** Indicative round-trip latency in ms, for the UI's ordering hint. Not a live measurement. */
    minLatency: z.number().int().positive().max(10_000),
    apiDocs: z.string().url(),

    /** Everything the exchange's key system can grant. Includes `Withdraw` where applicable. */
    permissions: z.array(ExchangePermissionSchema).min(1),
    /** Credential fields the connect wizard must collect. */
    required: z.array(ExchangeCredentialFieldSchema).min(1).max(4),

    /** Referral URL — the operator's own channel. Single source of truth (absolute rule §5.6). */
    referral: z.string().url(),
    referralNote: z.string().min(1).max(120),

    status: ExchangeStatusSchema,
    recommended: z.boolean(),

    // --- server-enforced policy (added; see file header) ---
    /** Scopes we require the user to grant. */
    requiredPermissions: z.array(ExchangePermissionSchema).min(1),
    /** Scopes we reject. A stored credential proving any of these must be refused. */
    forbiddenPermissions: z.array(ExchangePermissionSchema),
  })
  .strict()
  .superRefine((x, ctx) => {
    // An exchange cannot both require and forbid the same scope.
    const overlap = x.requiredPermissions.filter((p) => x.forbiddenPermissions.includes(p));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forbiddenPermissions'],
        message: `permission cannot be both required and forbidden: ${overlap.join(', ')}`,
      });
    }
    // Absolute rule §5.4 is not per-exchange discretion: if the exchange offers Withdraw at all, the
    // catalogue must say we forbid it.
    if (x.permissions.includes('Withdraw') && !x.forbiddenPermissions.includes('Withdraw')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forbiddenPermissions'],
        message: 'Withdraw must be forbidden when the exchange offers it (absolute rule §5.4)',
      });
    }
    // Requiring a scope the exchange does not offer would make the wizard unsatisfiable.
    const unoffered = x.requiredPermissions.filter((p) => !x.permissions.includes(p));
    if (unoffered.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiredPermissions'],
        message: `exchange does not offer required permission(s): ${unoffered.join(', ')}`,
      });
    }
  });
export type Exchange = z.infer<typeof ExchangeSchema>;

/** `GET /api/v1/exchanges` response. `asOf`/`source` mirror the provenance convention used by market routes. */
export const ExchangeListResponseSchema = z
  .object({
    items: z.array(ExchangeSchema),
    total: z.number().int().nonnegative(),
    asOf: z.number().int().nonnegative(),
    source: z.string().min(1),
  })
  .strict();
export type ExchangeListResponse = z.infer<typeof ExchangeListResponseSchema>;
