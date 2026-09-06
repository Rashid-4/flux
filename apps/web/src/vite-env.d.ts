/// <reference types="vite/client" />

/**
 * Every environment variable the app reads, declared. `import.meta.env` is
 * otherwise typed loosely enough that a typo in a variable name is `undefined`
 * at runtime and no error at build time.
 *
 * Both are optional and both have a defined default at their single point of
 * use, so a missing `.env` file is a working development build, not a crash.
 */
interface ImportMetaEnv {
  /**
   * `'1'` (the development default) serves the app from `@flux/mocks` through
   * MSW. Anything else talks to the real API through the Vite proxy. See
   * src/main.tsx — this is read in exactly one place.
   */
  readonly VITE_USE_MOCKS?: string

  /**
   * Where `/api` is proxied in development. Read by vite.config.ts in node, not
   * by the app: `request()` issues same-origin paths, so the browser bundle has
   * no notion of an API origin and cannot be misconfigured into one.
   */
  readonly VITE_API_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
