export * from './interfaces';
export * from './klinechart-adapter';
// NOT re-exported: `klinecharts-module` imports klinecharts, which touches `window` at module load.
// Pulling it into this barrel makes the whole package browser-only — including for this package's own
// node-environment tests. Consumers import it from '@quantumtrade/chart-adapter/klinecharts'.
