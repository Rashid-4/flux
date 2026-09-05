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
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off', // brand phantoms
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'properties'],
      'no-throw-literal': 'error',
    },
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
