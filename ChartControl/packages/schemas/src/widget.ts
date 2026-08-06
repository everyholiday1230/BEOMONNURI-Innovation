import { z } from 'zod';

export const WIDGET_TYPES = [
  'symbolHeader',
  'marketWatch',
  'chart',
  'secondaryChart',
  'multiChart',
  'orderBook',
  'recentTrades',
  'orderEntry',
  'positions',
  'openOrders',
  'orderHistory',
  'assets',
  'aiCopilot',
  'signalProposal',
  'alerts',
  'news',
  'riskMonitor',
  'connectionStatus',
  // legacy prototype aliases kept for layout preset compatibility:
  'assetsRisk',
  'miniChart',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WidgetTypeSchema = z.enum(WIDGET_TYPES);

export const WIDGET_SCHEMA_VERSION = 1;

/**
 * Common Widget Contract. Every widget in a layout conforms to this. Grid coordinates:
 * x/width in columns (0..cols), y/height in 40px rows. Optional fields default so that
 * prototype-era preset objects (which omit title/settings/etc.) still validate & migrate.
 */
export const WidgetSchema = z.object({
  id: z.string().min(1),
  type: WidgetTypeSchema,
  title: z.string().default(''),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  minWidth: z.number().int().positive().default(3),
  minHeight: z.number().int().positive().default(3),
  maxWidth: z.number().int().positive().default(24),
  maxHeight: z.number().int().positive().default(64),
  settings: z.record(z.unknown()).default({}),
  permissions: z.array(z.string()).default([]),
  dataDependencies: z.array(z.string()).default([]),
  schemaVersion: z.number().int().positive().default(WIDGET_SCHEMA_VERSION),
});
export type Widget = z.infer<typeof WidgetSchema>;
