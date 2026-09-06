import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Vitest ignores vite.config.ts entirely once a vitest.config.ts exists — it
 * does not merge them for you. So this file merges it explicitly, which is what
 * keeps `resolve.alias` defined in exactly one place. Redeclaring the alias here
 * instead would work right up to the day the two disagree and a test resolves a
 * different module than the app does.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],

      /**
       * No globals. `describe`/`it`/`expect` are imported, like every other
       * binding in the file, so a reader can tell where they come from and
       * `noUnusedLocals` can see them.
       */
      globals: false,

      /**
       * Tailwind's output is not under test — a jsdom `getComputedStyle` cannot
       * tell you whether a card looks right, and processing the whole theme adds
       * seconds per run for no assertion. Visual behaviour is Playwright's job.
       */
      css: false,

      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],

      // A component test that leaks a spy or a fake timer into the next file is
      // a flake that reproduces only in CI's file ordering.
      restoreMocks: true,
      clearMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,

      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        /**
         * Excluded because these files are the wiring, and coverage of wiring
         * measures whether it was imported, not whether it works. The
         * interesting layers — src/api, src/queries, src/keyboard,
         * src/components — are all in.
         */
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/vite-env.d.ts',
          'src/**/*.d.ts',
        ],
      },
    },
  }),
)
