// ════════════════════════════════════════════════════════════════════
// ESLint flat config, repository-wide.
//
// Division of labour: `tsc` owns type correctness, ESLint owns the
// conventions a type checker cannot see. Deliberately NOT type-aware —
// type-aware linting needs every file to belong to a tsconfig project,
// which breaks the moment an agent adds a file in a new directory, and
// a lint setup that fails confusingly is a lint setup people disable.
//
// Rules here are the ones from AGENTS.md §5 that a machine can check.
// Everything else is enforced by review, not by pretending.
// ════════════════════════════════════════════════════════════════════
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // ── Unused code ────────────────────────────────────────────────
      // Underscore-prefixed is the documented way to say "deliberately
      // ignored", which happens constantly in interface implementations.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ── `any` ──────────────────────────────────────────────────────
      // A warning, not an error: at a boundary with an untyped library,
      // `any` behind a validated zod parse is the honest answer. But it
      // should never be the reflex, so it stays visible.
      '@typescript-eslint/no-explicit-any': 'warn',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // ── ESM correctness ────────────────────────────────────────────
      // Node's ESM resolver does not guess extensions. Omitting `.js`
      // typechecks fine and then throws ERR_MODULE_NOT_FOUND at
      // runtime — a class of bug that only appears once the code
      // actually runs, which for an agent-written module can be days
      // after it was written and merged.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration > Literal.source[value=/^\\.\\.?\\/.*(?<!\\.js|\\.json|\\.css|\\.svg)$/]',
          message:
            'Relative imports need an explicit .js extension (ESM): import { x } from "./y.js".',
        },
        {
          selector:
            'ExportNamedDeclaration > Literal.source[value=/^\\.\\.?\\/.*(?<!\\.js|\\.json)$/]',
          message: 'Relative re-exports need an explicit .js extension (ESM).',
        },
        {
          // Persisted ids are UUIDv7 so they sort by creation time —
          // that is what makes cursor pagination and time-ordered
          // indexes work. randomUUID() is v4 and destroys both.
          selector: 'CallExpression > MemberExpression[property.name="randomUUID"]',
          message:
            'Use newId<Brand>() from @flux/contracts/ids (UUIDv7). randomUUID() is v4 and is not time-ordered.',
        },
      ],

      // ── Correctness traps ──────────────────────────────────────────
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // scripts and workers legitimately log
      'no-return-await': 'off',
      // This rule and `noUncheckedIndexedAccess` (tsconfig.base.json) are in
      // deliberate tension. That setting types every `arr[i]` as possibly
      // undefined, which is correct and worth keeping; the consequence is that
      // code doing index arithmetic — rank.ts, ids.ts — must assert, default,
      // or check at every read. The warning exists to push toward the third:
      // `!` suppresses the check instead of performing it, so when the
      // arithmetic is wrong the bad value propagates as the string "undefined"
      // spliced into a rank, or a UUID with the wrong version nibble.
      //
      // Both of those files now use small checked accessors and the repository
      // lints clean. If this warning reappears, add an accessor — do NOT
      // resolve it by turning off noUncheckedIndexedAccess.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off', // brand phantoms
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'properties'],
      'no-throw-literal': 'error',
    },
  },

  // ── Browser apps ────────────────────────────────────────────────────
  // `apps/**` is bundled by Vite, not resolved by Node, so the ESM
  // extension rule above does not apply there — and worse, it is wrong
  // there: it demanded `./Card.js` for a file that is `Card.tsx`, which
  // Vite cannot resolve. Every relative import in a React component
  // failed lint, in a config the UI agent is not allowed to edit, and
  // the only fix the message offered broke the build. Verified by
  // linting a representative component before this block existed.
  //
  // `no-restricted-syntax` is redeclared rather than disabled, because
  // the randomUUID selector matters *more* in the UI than anywhere
  // else: optimistic writes mint ids client-side, and a v4 id there
  // lands in the database and destroys the cursor ordering that
  // `newId()` exists to guarantee.
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression > MemberExpression[property.name="randomUUID"]',
          message:
            'Use newId<Brand>() from @flux/contracts/ids (UUIDv7). randomUUID() is v4 and is not time-ordered.',
        },
        {
          // The one rule in docs/specs/web/README.md §3 that a machine
          // can check. A single inline fetch is how the parse boundary
          // stops being a boundary — the response reaches a component
          // unvalidated and the field the API renamed renders as
          // `undefined` four components deep instead of throwing here.
          selector: 'CallExpression > Identifier[name="fetch"]',
          message:
            'No fetch outside apps/web/src/api/. Data access goes through the typed request layer, which parses every response with its contract schema (docs/specs/web/README.md §3).',
        },
      ],

      // ── React correctness ───────────────────────────────────────────
      // Errors, not warnings. A stale closure over a query key or a
      // missing dependency is not a style question; it is a component
      // rendering last render's data, which is indistinguishable from a
      // caching bug and gets debugged as one.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // ── Accessibility ───────────────────────────────────────────────
      // §9 commits to WCAG 2.2 AA and §8 forbids the component library
      // that would have supplied the ARIA. That combination is only
      // honest if something checks it, and a lint rule catches the
      // mechanical half — a div with a click handler and no role, an
      // input with no label — at the moment it is written rather than in
      // an audit nobody schedules. The half it cannot see (focus order,
      // whether a live region says something useful) is the keyboard
      // pass in §12's test table.
      ...jsxA11y.flatConfigs.recommended.rules,
      // Custom controls are the point of a bespoke design system, so
      // these two fire constantly on legitimate code and are downgraded
      // to visible rather than blocking. The rest stay errors.
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    },
  },

  // The api/ layer is the one place fetch belongs — it is what the rule
  // above is protecting, so it cannot also be bound by it.
  {
    files: ['apps/*/src/api/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // Tests get more rope: fixtures cast branded ids from readable
  // strings, which is the correct trade for a readable failure message.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Node scripts are plain ESM JavaScript, not part of any tsconfig.
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
