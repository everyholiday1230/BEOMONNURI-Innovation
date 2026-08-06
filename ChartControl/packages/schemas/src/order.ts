import { z } from 'zod';
import {
  DecimalString,
  EpochMs,
  PositiveDecimalString,
} from './primitives';
import { MarketTypeSchema } from './market';
import { DirectionSchema } from './signal';

export const ORDER_SCHEMA_VERSION = 1;

/** 12-state order machine (see docs/08-order-state-machine.md). */
export const ORDER_STATES = [
  'DRAFT',
  'VALIDATING',
  'READY',
  'SUBMITTING',
  'ACCEPTED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'UNKNOWN_RECONCILING',
] as const;
export const OrderStateSchema = z.enum(ORDER_STATES);
export type OrderState = (typeof ORDER_STATES)[number];

export const OrderTypeSchema = z.enum(['market', 'limit', 'stop', 'tp_sl']);
export const PositionActionSchema = z.enum(['open', 'close']);
export const MarginModeSchema = z.enum(['isolated', 'cross']);

/**
 * OrderDraft — created from an approved signal or manually. Always `isSimulated: true` in Phase 1.
 * `clientOrderId` is the idempotency key. Limit/stop orders require a price.
 */
export const OrderDraftSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(ORDER_SCHEMA_VERSION),
    symbol: z.string().min(1),
    marketType: MarketTypeSchema.default('futures'),
    side: DirectionSchema,
    positionAction: PositionActionSchema.default('open'),
    orderType: OrderTypeSchema,
    price: DecimalString.optional(),
    quantity: PositiveDecimalString,
    leverage: z.number().positive().max(125).default(1),
    marginMode: MarginModeSchema.default('isolated'),
    reduceOnly: z.boolean().default(false),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    clientOrderId: z.string().min(1),
    aiGenerated: z.boolean().default(false),
    isSimulated: z.literal(true).default(true),
  })
  .refine(
    (o) => o.orderType === 'market' || o.price !== undefined,
    { message: 'limit/stop/tp_sl orders require a price', path: ['price'] },
  );
export type OrderDraft = z.infer<typeof OrderDraftSchema>;

/** OrderPreview — computed by the risk/domain layer; shown before final confirmation. */
export const OrderPreviewSchema = z.object({
  symbol: z.string(),
  marketType: MarketTypeSchema,
  side: DirectionSchema,
  positionAction: PositionActionSchema,
  orderType: OrderTypeSchema,
  entryPrice: DecimalString,
  quantity: DecimalString,
  leverage: z.number(),
  marginMode: MarginModeSchema,
  positionValue: DecimalString,
  stopLoss: DecimalString.optional(),
  takeProfit: DecimalString.optional(),
  estFee: DecimalString,
  estLiquidationPrice: DecimalString.optional(),
  riskReward: DecimalString.optional(),
  maxEstLoss: DecimalString.optional(),
  aiGenerated: z.boolean(),
  isSimulated: z.literal(true),
});
export type OrderPreview = z.infer<typeof OrderPreviewSchema>;

export const OrderEventSchema = z.object({
  fromState: OrderStateSchema.nullable(),
  toState: OrderStateSchema,
  reason: z.string().optional(),
  actor: z.enum(['user', 'system', 'risk', 'exchange']),
  at: EpochMs,
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;

export const OrderSchema = OrderDraftSchema.and(
  z.object({
    id: z.string().min(1),
    status: OrderStateSchema,
    filledQuantity: NonNeg(),
    createdAt: EpochMs,
    updatedAt: EpochMs,
    events: z.array(OrderEventSchema).default([]),
  }),
);
export type Order = z.infer<typeof OrderSchema>;

function NonNeg() {
  return DecimalString.refine((s) => Number(s) >= 0, 'must be >= 0').default('0');
}
