import { z } from 'zod';
import { DecimalString, EpochMs, PositiveDecimalString } from './primitives';
import { MarketTypeSchema, TimeframeSchema } from './market';

export const SIGNAL_SCHEMA_VERSION = 1;

/** Signal lifecycle states (see docs/08-order-state-machine.md). */
export const SIGNAL_STATES = [
  'DRAFT',
  'ANALYZING',
  'PROPOSED',
  'USER_EDITED',
  'APPROVED',
  'ORDER_DRAFT_CREATED',
  'RISK_CHECKED',
  'CONFIRMATION_REQUIRED',
  'SIMULATED_SUBMITTED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
] as const;
export const SignalStateSchema = z.enum(SIGNAL_STATES);
export type SignalState = (typeof SIGNAL_STATES)[number];

export const DirectionSchema = z.enum(['long', 'short']);

/**
 * SignalObject — the structured AI trade thesis a user reviews/edits/approves. Prices are decimal
 * strings. `aiGenerated` is always true for AI output. Approving this does NOT place an order.
 */
export const SignalObjectSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(SIGNAL_SCHEMA_VERSION),
    id: z.string().min(1),
    symbol: z.string().min(1),
    marketType: MarketTypeSchema.default('futures'),
    timeframe: TimeframeSchema,
    direction: DirectionSchema,
    generatedAt: EpochMs,
    dataAsOf: EpochMs,
    analysis: z.string().max(4000),
    evidence: z.array(z.string().max(500)).default([]),
    confidence: z.number().min(0).max(100),
    invalidationCondition: z.string().max(500),
    entryZone: z.tuple([DecimalString, DecimalString]),
    stopLoss: DecimalString,
    takeProfits: z.array(PositiveDecimalString).min(1),
    riskReward: DecimalString,
    timeHorizon: z.string().max(60).optional(),
    assumptions: z.array(z.string().max(300)).default([]),
    warnings: z.array(z.string().max(300)).default([]),
    aiGenerated: z.literal(true).default(true),
    status: SignalStateSchema.default('PROPOSED'),
  })
  .refine((s) => Number(s.entryZone[0]) <= Number(s.entryZone[1]), {
    message: 'entryZone must be [lo, hi] with lo <= hi',
    path: ['entryZone'],
  });
export type SignalObject = z.infer<typeof SignalObjectSchema>;
