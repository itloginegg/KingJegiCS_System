import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Lint configuration.
 *
 * WHY THIS EXISTS AT ALL. The codebase already carried twenty
 * `eslint-disable-next-line react-hooks/exhaustive-deps` comments before any
 * ESLint was installed, so every one of them was inert and nothing had ever
 * checked a dependency array. Those suppressions are the reason this config
 * leads with the react-hooks rules rather than with style: they mark the exact
 * places someone previously decided a dependency was safe to omit, and until now
 * no tool has been able to agree or disagree.
 *
 * Style rules are deliberately absent. The house style here is carried by long
 * explanatory comments and by the existing code, not by a formatter, and turning
 * on a style preset would bury the correctness findings under thousands of
 * cosmetic ones in a 36k-line tree.
 */
export default tseslint.config(
  {
    // Build output, vendored assets, and the generated avatar pipeline.
    ignores: ['dist/**', 'node_modules/**', 'avatar-src/**', 'public/**', 'scripts/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  /* `.configs.flat[...]`, not `.configs[...]`: the top-level entries in this
     plugin are still eslintrc-shaped and ESLint 10 rejects them outright. */
  reactHooks.configs.flat['recommended-latest'],

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      /* Vite's HMR can only refresh a module that exports components alone. Warn
         rather than error: several files here deliberately export a component
         next to its helpers, and that is a judgement call, not a defect. */
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* The base rule does not understand TypeScript's type-only bindings and
         double-reports; the TS version is the one that can tell them apart.
         Leading underscore is the opt-out for an argument kept for its position
         or for documentation. */
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      /* ── Severity, and the line this config draws ──

         eslint-plugin-react-hooks v7 ships the React Compiler rule set alongside
         the two classic hook rules. Most of it assumes you are adopting the
         compiler; this project is not. Left at their defaults those rules bury
         the real defects under advice about an optimisation nobody has opted
         into, and a lint run that is permanently red is a lint run nobody runs.

         So: ERROR means "this is a defect" — a hook called conditionally, a ref
         read during render, a dependency that is genuinely missing. WARN means
         "debt worth seeing" and does not fail the build. */

      /* 39 hits, and idiomatic here: most are an effect syncing React to
         something outside it (a media element, a storage event, a viewport
         listener). The compiler dislikes the pattern; without the compiler it is
         merely ordinary. Visible, not blocking. */
      'react-hooks/set-state-in-effect': 'warn',

      /* Only meaningful when React Compiler is doing the memoising. It isn't. */
      'react-hooks/preserve-manual-memoization': 'off',

      /* 25 hits of real type debt — worth seeing on every run, not worth
         blocking on until someone decides to work through them. */
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    /* react-three-fiber works by mutating the object graph a hook handed you —
       scene nodes, materials, bones are all mutated in place every frame, and
       there is no r3f idiom that avoids it. The immutability rule flags that as
       a defect, which is correct advice in a plain React tree and wrong in this
       one. Off here, and only here: the same rule caught a genuine
       use-before-declare in CustomerDashboardPage, which stays an error. */
    files: ['src/components/avatar/**/*.{ts,tsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },

  {
    /* Config and build scripts run in Node, not the browser. */
    files: ['*.config.{js,ts}', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
