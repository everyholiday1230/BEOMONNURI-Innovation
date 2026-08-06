import { z } from 'zod';
import { WidgetSchema } from './widget';

export const LAYOUT_SCHEMA_VERSION = 1;

/**
 * A saved layout. `version` is the OPTIMISTIC-CONCURRENCY token for server sync (bumped on each
 * server-accepted write); `schemaVersion` drives migration. `cols` fixed at 24 per design.
 */
export const LayoutSchema = z.object({
  schemaVersion: z.number().int().positive().default(LAYOUT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  presetId: z.string().optional(),
  description: z.string().optional(),
  cols: z.literal(24).default(24),
  version: z.number().int().nonnegative().default(0),
  widgets: z.array(WidgetSchema),
});
export type Layout = z.infer<typeof LayoutSchema>;

/**
 * The raw prototype preset shape uses {w,h} instead of {width,height} and omits many fields.
 * This loose schema is what we accept from prototype presets / legacy localStorage before
 * running migration. Anything not matching is treated as corrupted.
 */
export const LegacyWidgetSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
  maxW: z.number().optional(),
  maxH: z.number().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  visible: z.boolean().optional(),
});

export const LegacyLayoutSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  cols: z.number().optional(),
  widgets: z.array(LegacyWidgetSchema),
});
export type LegacyLayout = z.infer<typeof LegacyLayoutSchema>;
