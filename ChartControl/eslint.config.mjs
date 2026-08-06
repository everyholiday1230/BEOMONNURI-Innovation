// Flat ESLint config for the QuantumTrade AI monorepo (ESLint 9 + typescript-eslint 8).
// Rationale recorded in docs/adr/ADR-0006-eslint.md. Kept intentionally lean (req §4: no excess deps).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // Non-source artifacts and generated output.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.css',
      '**/coverage/**',
      'tests/load/**', // k6 scripts run in the k6 runtime, not Node/browser; not linted here.
      'tests/integration/**', // standalone Node scripts (WS verification); run via `node`.
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Enforce the "minimize any" requirement (§4) — but as a warning so lint stays green while
      // the two documented, intentional `any` sites (klineModule façade, ADR-0002) remain.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Operational Node scripts (.mjs/.js): ESM + Node globals so `eslint .` covers scripts/** too
    // (item 3-5). No React/TS-project rules; just correctness (no-undef, unused vars).
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Test files: relax a few rules that are noisy in test scaffolding.
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', '**/test-setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
