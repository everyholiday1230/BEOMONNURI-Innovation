import { defineConfig } from 'tsup';

// Production bundle for the container image (Phase 6 §8). Workspace packages (@quantumtrade/*) and
// pure-JS deps are INLINED so the runtime image needs only the native/heavy npm deps (installed --prod).
// Native/SDK deps stay external and are installed in the runtime stage.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noSplitting: true,
  clean: true,
  sourcemap: false, // no source maps shipped in the production image
  noExternal: [/^@quantumtrade\//, 'hono', '@hono/node-server', 'zod'],
  external: ['better-sqlite3', 'pg', 'openai', '@aws-sdk/client-secrets-manager'],
});
