import { z } from 'zod';
import { DecimalString, EpochMs } from './primitives';

/**
 * ChartCommand — the ONLY actions an AI (or any structured tool call) may express against the
 * chart / signal / order surface. Anything outside this allowlist fails validation and is
 * rejected. The LLM cannot emit arbitrary JS/HTML/Canvas. See ADR-0004 & threat model T2.
 *
 * CRITICAL: `createOrderDraft` produces a DRAFT ONLY. No command can submit an order. Order
 * submission requires the human confirmation gate in the order state machine.
 */
export const CHART_COMMAND_VERSION = 1;

const OverlayPoint = z.object({ time: EpochMs, price: DecimalString });

const base = { schemaVersion: z.number().int().positive().default(CHART_COMMAND_VERSION) };

export const ChartCommandSchema = z.discriminatedUnion('command', [
  z.object({
    ...base,
    command: z.literal('createTrendLine'),
    points: z.tuple([OverlayPoint, OverlayPoint]),
    label: z.string().max(80).optional(),
  }),
  z.object({
    ...base,
    command: z.literal('createHorizontalLine'),
    price: DecimalString,
    label: z.string().max(80).optional(),
  }),
  z.object({
    ...base,
    command: z.literal('createEntryZone'),
    priceLo: DecimalString,
    priceHi: DecimalString,
    label: z.string().max(80).optional(),
  }),
  z.object({ ...base, command: z.literal('createStopLoss'), price: DecimalString }),
  z.object({ ...base, command: z.literal('createTakeProfit'), price: DecimalString, index: z.number().int().min(0).max(10).default(0) }),
  z.object({
    ...base,
    command: z.literal('createMarker'),
    point: OverlayPoint,
    text: z.string().max(120),
  }),
  z.object({
    ...base,
    command: z.literal('updateOverlay'),
    overlayId: z.string().min(1),
    patch: z.record(z.union([z.string(), z.number(), z.boolean()])),
  }),
  z.object({ ...base, command: z.literal('removeOverlay'), overlayId: z.string().min(1) }),
  z.object({ ...base, command: z.literal('lockOverlay'), overlayId: z.string().min(1) }),
  z.object({ ...base, command: z.literal('hideOverlay'), overlayId: z.string().min(1) }),
  z.object({ ...base, command: z.literal('approveSignal'), signalId: z.string().min(1) }),
  z.object({ ...base, command: z.literal('rejectSignal'), signalId: z.string().min(1), reason: z.string().max(200).optional() }),
  z.object({
    ...base,
    command: z.literal('createOrderDraft'),
    signalId: z.string().min(1),
    // A draft only: never a submission.
    note: z.string().max(200).optional(),
  }),
]);
export type ChartCommand = z.infer<typeof ChartCommandSchema>;

export const ALLOWED_CHART_COMMANDS = [
  'createTrendLine',
  'createHorizontalLine',
  'createEntryZone',
  'createStopLoss',
  'createTakeProfit',
  'createMarker',
  'updateOverlay',
  'removeOverlay',
  'lockOverlay',
  'hideOverlay',
  'approveSignal',
  'rejectSignal',
  'createOrderDraft',
] as const;
