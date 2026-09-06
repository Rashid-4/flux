import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/**
 * The MSW request interceptor for Vitest runs.
 *
 * `msw/node`, not `msw/browser`: the suite runs under jsdom, and jsdom provides
 * no service worker. The browser worker (`public/mockServiceWorker.js`, generated
 * by `msw init` — see the `msw.workerDirectory` field in package.json) is for
 * `pnpm dev` against mocks and for Playwright, and is wired up separately.
 *
 * Started once per test file from ./setup.ts, not here. A module that starts an
 * interceptor as an import side effect is a module that cannot be imported by
 * anything that does not want one — including a test asserting what happens with
 * no server at all.
 */
export const server = setupServer(...handlers)
