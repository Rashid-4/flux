import { Controller, Get, Header, Inject } from '@nestjs/common'
import { FluxError } from '@flux/contracts'
import type { Logger } from 'pino'
import { DatabaseService } from '../database/database.service.js'
import { LOGGER } from '../logger.js'
import { currentTraceContext } from '../http/request-context.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Liveness and readiness. Two endpoints, two different questions.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §3 places these outside `/api/v1` and outside
 * versioning, because an orchestrator's probe configuration must not need updating
 * when the API version changes.
 *
 * The distinction between them is the part that is usually got wrong, and getting it
 * wrong has a specific cost each way:
 *
 *   • **`/health` is liveness: is this process working?** It touches nothing
 *     external. If it consulted the database, then a database restart would fail
 *     the liveness probe on *every* replica, the orchestrator would kill and
 *     restart all of them, and a thirty-second database blip would become a
 *     cold-start stampede against a database that was already struggling.
 *   • **`/ready` is readiness: should this process receive traffic?** It checks the
 *     database, because a replica that cannot reach it can serve no request worth
 *     serving, and the correct response is to take it out of the load balancer —
 *     not to kill it.
 *
 * ### Neither body says anything
 *
 * `/ready` answers `{"status":"ready"}` and nothing else. The migration head, the
 * pool counters and the connect timing are logged, not returned, and the trace id in
 * the `x-flux-trace-id` response header is what connects the two.
 *
 * That is §7's rule applied to a probe rather than a new decision: the message is for
 * the caller and the detail goes to the log. It also removes a real exposure — pool
 * saturation counters on an unauthenticated endpoint tell an attacker when the
 * service is close to exhaustion, which is exactly when a load spike is worth
 * sending. An operator loses nothing, because the log line has more than a body
 * could carry and is already where they are looking.
 *
 * A failure *does* say what failed, in the message: "The database is unavailable"
 * and "The database schema has not been migrated" are different problems with
 * different remedies, and §13 forbids collapsing them into one sentence.
 */

/**
 * Probe responses must not be cached.
 *
 * Without this, a CDN or a corporate proxy in front of the service can serve a
 * remembered 200 to a readiness probe for a replica that has since lost its
 * database. `no-store` rather than `no-cache`, which still permits storing.
 */
const NO_STORE = 'no-store, max-age=0'

interface HealthResponse {
  status: 'ok'
}

interface ReadyResponse {
  status: 'ready'
}

@Controller()
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Liveness. No I/O, no dependencies, no allocation worth measuring.
   *
   * Returning 200 from here means only that the event loop is turning and the
   * process is accepting connections. That is exactly what liveness should mean: a
   * process that cannot answer this is one that a restart genuinely fixes.
   */
  @Get('health')
  @Header('cache-control', NO_STORE)
  health(): HealthResponse {
    return { status: 'ok' }
  }

  /**
   * Readiness. A connection from the pool and a migrated schema.
   *
   * Failures throw rather than returning a status, so the response body is the same
   * `ApiErrorSchema` shape as every other error in the service and carries the trace
   * id that the log line for this probe was written against. A probe that answered
   * in its own private shape would be the one endpoint whose failures could not be
   * read by the tooling built for all the others.
   */
  @Get('ready')
  @Header('cache-control', NO_STORE)
  async ready(): Promise<ReadyResponse> {
    const startedAt = process.hrtime.bigint()
    const report = await this.database.readiness()
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10

    const detail = {
      traceId: currentTraceContext()?.traceId,
      migrationHead: report.migrationHead,
      migrationsApplied: report.migrationsApplied,
      pool: report.pool,
      elapsedMs,
    }

    /**
     * An empty `schema_migrations` means the process is running against a database
     * whose schema has not been created — a deploy that reached the application step
     * before the migration step. Serving traffic would produce `42P01` on the first
     * request of every endpoint, which `pg-errors.ts` correctly reports as an
     * internal error, so the outage would look like a code defect rather than a
     * deployment ordering problem.
     *
     * This deliberately does not pin the *expected* head. A replica running code
     * that is newer than the applied migrations is the other half of the same
     * failure and is not detected here; closing it needs the expected version
     * compiled into the build and checked against `db/migrations/`, which is a
     * separate change with its own CI check. `services/api/README.md` records it as
     * open rather than leaving the gap to be rediscovered.
     */
    if (report.migrationHead === null || report.migrationsApplied === 0) {
      this.logger.error(detail, 'not ready: the database schema has no applied migrations')
      throw new FluxError(
        'dependency_unavailable',
        'The database schema has not been migrated',
        { meta: { retryAfterSeconds: 5 } },
      )
    }

    this.logger.debug(detail, 'ready')
    return { status: 'ready' }
  }
}
