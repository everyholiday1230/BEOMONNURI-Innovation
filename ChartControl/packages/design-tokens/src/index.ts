/**
 * @quantumtrade/design-tokens
 * Typed accessors for the 3-layer OKLCH token system defined in tokens.css (copied verbatim from
 * the approved prototype). Components reference these CSS custom properties — NEVER hardcoded
 * colors — preserving the Brand -> Semantic -> Component layering.
 */

export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export const BRANDS = [
  'institutional-cool',
  'quantum-violet',
  'onyx-emerald',
  'graphite-amber',
] as const;
export type Brand = (typeof BRANDS)[number];

export const DENSITIES = ['comfortable', 'compact', 'dense'] as const;
export type Density = (typeof DENSITIES)[number];

export const LONGSHORT = ['teal-magenta', 'green-red', 'cyan-orange'] as const;
export type LongShort = (typeof LONGSHORT)[number];

export const LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The `data-*` attributes applied to <html> to switch variants (see tokens.css). */
export interface ThemeAttributes {
  'data-theme': Theme;
  'data-brand': Brand;
  'data-density': Density;
  'data-longshort': LongShort;
}

export const DEFAULT_THEME_ATTRIBUTES: ThemeAttributes = {
  'data-theme': 'dark',
  'data-brand': 'institutional-cool',
  'data-density': 'comfortable',
  'data-longshort': 'teal-magenta',
};

/** Semantic token CSS variable names — use with `var(...)` in inline styles when needed. */
export const semantic = {
  bgApp: 'var(--color-bg-app)',
  bgSurface: 'var(--color-bg-surface)',
  bgPanel: 'var(--color-bg-panel)',
  bgElevated: 'var(--color-bg-elevated)',
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  borderSubtle: 'var(--color-border-subtle)',
  borderDefault: 'var(--color-border-default)',
  brand: 'var(--color-brand)',
  tradeLong: 'var(--color-trade-long)',
  tradeShort: 'var(--color-trade-short)',
  ai: 'var(--color-ai)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
} as const;

/** Chart color tokens for the KLineChart adapter theme mapping. */
export const chartTokens = {
  grid: 'var(--chart-grid)',
  axisText: 'var(--chart-axis-text)',
  crosshair: 'var(--chart-crosshair)',
  candleUp: 'var(--chart-candle-up)',
  candleDown: 'var(--chart-candle-dn)',
  ma1: 'var(--chart-ma-1)',
  ma2: 'var(--chart-ma-2)',
  ma3: 'var(--chart-ma-3)',
} as const;

export const typography = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
  num: 'var(--font-num)',
  en: 'var(--font-en)',
} as const;

/** Widget grid geometry — matches tokens.css --grid-* and the layout engine. */
export const grid = {
  cols: 24,
  rowHeight: 40,
  gap: 6,
} as const;
