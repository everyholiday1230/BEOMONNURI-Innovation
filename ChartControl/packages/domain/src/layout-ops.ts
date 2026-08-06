import {
  LayoutSchema,
  LegacyLayoutSchema,
  WidgetSchema,
  LAYOUT_SCHEMA_VERSION,
  type Layout,
  type Widget,
} from '@quantumtrade/schemas';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
  hidden?: boolean;
}

export function overlaps(a: Box, b: Box): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function hasCollision(widgets: readonly Box[], target: Box): boolean {
  return widgets.some((w) => !w.hidden && w.id !== target.id && overlaps(w, target));
}

/** First free grid position for a w×h box, scanning row-major within `cols`. */
export function findFreeSpot(
  widgets: readonly Box[],
  w: number,
  h: number,
  cols = 24,
  maxRows = 64,
): { x: number; y: number } {
  for (let y = 0; y < maxRows; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (!hasCollision(widgets, { x, y, w, h, id: '__probe__' })) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/** Clamp a widget within grid bounds and enforce min/max sizes. */
export function clampWidget(widget: Widget, cols = 24): Widget {
  const w = Math.max(widget.minWidth, Math.min(widget.maxWidth, Math.min(cols, widget.width)));
  const h = Math.max(widget.minHeight, Math.min(widget.maxHeight, widget.height));
  const x = Math.max(0, Math.min(cols - w, widget.x));
  const y = Math.max(0, widget.y);
  return { ...widget, width: w, height: h, x, y };
}

/**
 * Migrate a legacy prototype layout ({w,h}, GridStack-style) to the current LayoutSchema.
 * Each widget gets the full Widget contract via schema defaults.
 */
export function migrateLegacyLayout(input: unknown): Layout {
  const legacy = LegacyLayoutSchema.parse(input);
  const widgets: Widget[] = legacy.widgets.map((lw) =>
    WidgetSchema.parse({
      id: lw.id,
      type: lw.type,
      x: lw.x,
      y: lw.y,
      width: lw.w,
      height: lw.h,
      minWidth: lw.minW ?? 3,
      minHeight: lw.minH ?? 3,
      maxWidth: lw.maxW ?? 24,
      maxHeight: lw.maxH ?? 64,
      locked: lw.locked ?? false,
      hidden: lw.hidden ?? false,
      collapsed: lw.collapsed ?? false,
      visible: lw.visible ?? true,
    }),
  );
  return LayoutSchema.parse({
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    id: legacy.id,
    name: legacy.name ?? legacy.id,
    presetId: legacy.id,
    description: legacy.description,
    cols: 24,
    version: 0,
    widgets,
  });
}

/**
 * Load a persisted layout defensively. Tries current schema, then legacy migration; on any
 * corruption returns `fallback` (never throws — layout failure must not break trading).
 */
export function loadLayoutSafe(raw: unknown, fallback: Layout): Layout {
  const current = LayoutSchema.safeParse(raw);
  if (current.success) return current.data;
  try {
    return migrateLegacyLayout(raw);
  } catch {
    return fallback;
  }
}
