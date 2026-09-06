import { defineConfig } from 'tsup'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The production artifact: one ESM file, plus a sourcemap.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### Why this service is bundled at all
 *
 * `@flux/contracts` publishes TypeScript **source** — its `exports` map points
 * at `./src/index.ts`, because `apps/web` consumes it through Vite and never
 * needed anything else. Node cannot load a `.ts` file, so a `tsc`-only build of
 * this service would emit `import ... from '@flux/contracts'` into `dist/` and
 * throw at the first import on startup.
 *
 * Three ways out were considered. Widening the contracts `exports` map with a
 * `dist` condition is the *correct* long-term fix, and it is a change request
 * rather than an edit — `packages/contracts/` is frozen precisely so that a
 * service does not reshape the shared contract to make its own build work
 * (CLAUDE.md, "Amend the contract, then say so"). Compiling contracts and
 * pointing at its `dist/` by relative path would work and would also be a lie
 * about the dependency graph. Bundling is the third, and it is what `apps/web`
 * already does — so it keeps one consumption model across the repository rather
 * than adding a second.
 *
 * It also happens to be the right deployment shape independently: one file, no
 * `node_modules` for first-party code, and a cold start that does not walk a
 * dependency tree.
 *
 * ### What is bundled and what is not
 *
 * Only first-party code. `noExternal` names `@flux/contracts` explicitly rather
 * than relying on tsup's default treatment of workspace links, because that
 * default has changed between majors and the failure it produces — an
 * unresolvable import inside a shipped artifact — appears at startup in
 * production rather than in CI.
 *
 * Everything in `dependencies` stays external and is installed normally. Nest
 * 12 is native ESM (`"type": "module"`, an `exports` map of `.js` files), so
 * there is no CJS interop to shim; and bundling a DI framework that resolves
 * some of its own optional peers dynamically is a way to discover at runtime
 * that a `require` became unreachable.
 *
 * ### emitDecoratorMetadata is NOT available here, and that is load-bearing
 *
 * esbuild implements `experimentalDecorators` but **cannot** implement
 * `emitDecoratorMetadata`: emitting a constructor parameter's type requires the
 * type checker, which esbuild does not have. So Nest's reflection-based
 * injection — the `constructor(private readonly x: Thing)` form every tutorial
 * uses — does not work in this build. It fails as
 * `Nest can't resolve dependencies of ...  (?)`, at boot, with the argument
 * index in place of the name.
 *
 * Every provider in this service therefore declares its dependencies with an
 * explicit `@Inject(TOKEN)`. That is not a workaround grudgingly adopted:
 * `docs/specs/api/README.md` §1 requires modules to talk to each other through
 * *typed interfaces*, and an interface has no runtime value to reflect, so
 * tokens would be required for every cross-module dependency regardless. This
 * build makes the same rule apply within a module too, which is the consistent
 * version.
 *
 * `src/app.module.integration.test.ts` boots the real container so that a
 * missing `@Inject` fails a test rather than a deployment.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],

  /**
   * Matches `engines.node` in package.json and the Docker base image. Set here
   * as well as in tsconfig because esbuild reads this, not `target`
   * (`ES2023`) — and a downlevelled `await` in a Node 22 process is pure cost.
   */
  target: 'node22',
  platform: 'node',

  bundle: true,
  noExternal: ['@flux/contracts'],

  /**
   * Sourcemaps in production for the same reason `apps/web` ships them: the
   * alternative is triaging a minified stack trace against a trace id, which
   * throws away most of the value of having the trace id.
   */
  sourcemap: true,

  /** No `.d.ts`. Nothing imports this service's types; it is a process. */
  dts: false,

  clean: true,

  /**
   * Off, deliberately. Minifying a server saves nothing that matters — it is
   * not downloaded — and it costs readable stack traces in exactly the moment
   * they are needed. `sourcemap` covers the rest.
   */
  minify: false,
})
