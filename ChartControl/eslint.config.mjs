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
      /*
         ★ 서드파티 번들. 우리가 고칠 수 없는 코드다.
           babel.min.js · klinecharts.min.js · react-dom.development.js 세 파일만으로
           오류 4,700건이 넘게 나와 `pnpm lint` 가 늘 red 였다. 남의 코드 스타일을
           우리 규칙으로 재단하는 것은 의미가 없고, 진짜 오류를 가린다.
      */
      'vendor/**',
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
    /*
       브라우저에서 그대로 도는 프론트엔드 (src/**).

       ★★ 이 블록이 없어서 `pnpm lint` 가 red 였다. src/*.js(x) 는 위의 Node 블록에
         걸려 브라우저 전역(window·document·fetch·React …)이 모두 no-undef 로 잡혔다.
         CI 가 lint 를 게이트로 쓰는데(ci.yml), 게이트가 항상 빨간색이면 아무도
         보지 않는다 — 진짜 오류가 그 안에 묻힌다.

       ★ 이 파일들은 빌드 없이 브라우저가 읽고 in-browser Babel 이 JSX 를 바꾼다.
         그래서 sourceType 은 script 이고, 서로를 window 전역으로 참조한다.
    */
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        React: 'readonly',
        ReactDOM: 'readonly',
        klinecharts: 'readonly',
        /* 디자이너 프론트엔드의 전역 네임스페이스(mock-data.js 가 window.QT 로 만든다). */
        QT: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    /*
       브라우저 자동화 도구 (tools/**).

       ★ 이 스크립트는 Node 에서 돌지만, `page.evaluate(() => document…)` 안의 코드는
         **브라우저에서** 실행된다. eslint 는 그 구분을 모르므로 document·window·
         getComputedStyle 등이 전부 no-undef 로 잡혔다(143건). 두 전역을 함께 허용한다.
    */
    files: ['tools/**/*.mjs', 'tools/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
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
