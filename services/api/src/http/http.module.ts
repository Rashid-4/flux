import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ApiErrorFilter } from './error-reporting.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The cross-cutting HTTP layer.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `APP_FILTER` rather than `app.useGlobalFilters(new ApiErrorFilter(logger))`.
 *
 * The two are not equivalent, and the difference is the reason to prefer this one:
 * a filter constructed by hand receives whatever the bootstrap code happened to have
 * in scope, so it needs the logger threaded to it and cannot ever be given a
 * dependency that the container owns. Registered as a provider, it is resolved by the
 * container like everything else — which also means `app.module.integration.test.ts`
 * fails at boot if its `@Inject(LOGGER)` is ever dropped, rather than silently
 * constructing a filter with an undefined logger that throws on the first error it
 * is asked to report.
 *
 * Fastify's half of error handling cannot be a provider — it is installed on the
 * Fastify instance before Nest is readied — and lives in `bootstrap.ts`. Both halves
 * call the same formatter; `error-reporting.ts` explains why there are two.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class HttpModule {}
