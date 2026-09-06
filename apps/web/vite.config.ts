import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Tailwind is a Vite plugin here, not a PostCSS plugin. That is the whole of
 * the v4 setup: no postcss.config.js, no tailwind.config.js, no `content`
 * globs. The theme lives in CSS (`src/design/tokens.css`) and the scanner finds
 * class names by walking the module graph, so there is nothing to keep in sync.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      // Must agree with `paths` in tsconfig.json and with vitest.config.ts,
      // which merges this config rather than repeating it.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    /**
     * In development the app talks to MSW (src/test/browser.ts), not to a
     * server — see docs/specs/web/README.md §10. This proxy is what makes the
     * swap to the real API a configuration change: point it at the running
     * `services/api` and set VITE_USE_MOCKS=0. `request()` never carries an
     * origin, so nothing else in the app changes.
     */
    proxy: {
      '/api': {
        target: process.env.VITE_API_ORIGIN ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    target: 'es2022',
    /**
     * Sourcemaps in production because the alternative is triaging a minified
     * stack trace against a traceId, which is most of the value of §7 thrown
     * away to save a few hundred kilobytes nobody downloads.
     */
    sourcemap: true,
    /**
     * The budget in docs/specs/web/README.md §8 is a first-paint number, so a
     * chunk that quietly grows past this is a budget failure and should be
     * loud. Route-level splitting (routes/router.tsx) is what keeps it true —
     * the board must not ship the import wizard.
     */
    chunkSizeWarningLimit: 250,
  },
})
