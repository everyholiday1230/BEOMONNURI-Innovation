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

/*
   카탈로그 항목의 형태.

   ★ `superRefine` 을 붙이기 전의 object 를 따로 둔다. `.strict()` + `superRefine`
     이 걸린 스키마는 ZodEffects 라서 `.extend()` 로 확장할 수 없다.
     응답 전용 필드(`connectable`)를 더하려면 base 가 필요하다.
*/
const ExchangeBaseSchema = z
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
  .strict();

/* 카탈로그 규칙 검증. base 와 응답 스키마가 같은 규칙을 쓰도록 함수로 둔다. */
const refineExchange = (
  x: z.infer<typeof ExchangeBaseSchema>,
  ctx: z.RefinementCtx,
): void => {
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
};

export const ExchangeSchema = ExchangeBaseSchema.superRefine(refineExchange);
export type Exchange = z.infer<typeof ExchangeSchema>;

/*
   응답에 실리는 거래소 항목 = 카탈로그 + 연결 가능 여부.

   ★★ `connectable` 을 `ExchangeSchema` 에 넣지 않는 이유: 그 스키마는 **카탈로그
     파일의 형태**를 검증한다(이름·상품·권한처럼 편집자가 적는 값). 연결 가능
     여부는 어댑터 존재에서 파생되는 **런타임 사실**이므로 카탈로그에 적을 값이
     아니다. 섞으면 카탈로그를 손으로 고쳐 "연결 가능" 이라고 주장할 수 있게 된다.
*/
export const ExchangeListItemSchema = ExchangeBaseSchema.extend({
  /** 어댑터가 있고 협약된 거래소인가. false 면 키를 등록해도 동작하지 않는다. */
  connectable: z.boolean(),
}).superRefine(refineExchange);
export type ExchangeListItem = z.infer<typeof ExchangeListItemSchema>;

/** `GET /api/v1/exchanges` response. `asOf`/`source` mirror the provenance convention used by market routes. */
export const ExchangeListResponseSchema = z
  .object({
    items: z.array(ExchangeListItemSchema),
    total: z.number().int().nonnegative(),
    /*
       연결할 수 없어서 감춘 개수.

       ★ 화면이 "N개 거래소는 준비 중" 을 말할 수 있고, 목록이 0개일 때 필터
         때문인지 카탈로그가 빈 것인지 구분된다.
    */
    hiddenNotConnectable: z.number().int().nonnegative(),
    asOf: z.number().int().nonnegative(),
    source: z.string().min(1),
  })
  .strict();
export type ExchangeListResponse = z.infer<typeof ExchangeListResponseSchema>;
