import type { LoggerService, LogLevel } from '@nestjs/common'
import type { Logger } from 'pino'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Nest's own logging, routed through pino.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Nest logs a fair amount on its own account — every mapped route, every dependency
 * it fails to resolve, the shutdown sequence — through a built-in logger that writes
 * coloured, multi-line text to stdout. Two things make that unacceptable here and
 * neither is aesthetic.
 *
 * A log aggregator parses stdout line by line as JSON. Nest's format is not JSON, so
 * those lines are dropped or quarantined as unparseable — and the lines being dropped
 * are the ones written when the process is failing to start, which is when the log is
 * the only instrument available.
 *
 * And the alternative usually reached for, `logger: false`, is worse: it silences
 * Nest's DI diagnostics entirely. "Nest can't resolve dependencies of the
 * DatabaseService (?, Config, Logger)" is the single most useful sentence this
 * service can produce, because it names the missing `@Inject` that a bundled build
 * cannot infer (see `tsup.config.ts`). Discarding it to keep the log clean trades the
 * diagnosis for the symptom.
 *
 * So Nest's messages become pino records with `nest: true`, which keeps them
 * parseable, level-filtered by `LOG_LEVEL` like everything else, and greppable as a
 * group.
 */

/**
 * Nest's `LogLevel` → pino's method names.
 *
 * `verbose` and `debug` both land on `debug`: pino's `trace` exists, but Nest uses
 * `verbose` for route mapping, which is information an operator wants at `debug`
 * rather than at the level below it that nobody enables.
 */
const PINO_METHOD: Record<LogLevel, 'fatal' | 'error' | 'warn' | 'info' | 'debug'> = {
  fatal: 'fatal',
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'debug',
}

export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params)
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params)
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params)
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params)
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params)
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params)
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    /**
     * Nest's calling convention is `(message, ...params, context)` — the context is
     * a trailing string like `'RoutesResolver'` or `'InstanceLoader'`, and it is
     * the field worth having as a field rather than buried in the text. It is only
     * *by convention* the last argument, so a trailing string is treated as one and
     * anything else is left in `params`.
     */
    const trailing = params.at(-1)
    const context = typeof trailing === 'string' ? trailing : undefined
    const rest = context === undefined ? params : params.slice(0, -1)

    this.logger[PINO_METHOD[level]](
      {
        nest: true,
        context,
        /**
         * An `Error` in the parameters is how Nest passes a stack trace — on a
         * failed DI resolution it is the stack that names the module. Serialised
         * by hand rather than through pino's `err` serialiser so that the shape is
         * the same one `error-reporting.ts` produces, and a search for a stack does
         * not have to know which layer wrote it.
         */
        stack: rest.find((value): value is Error => value instanceof Error)?.stack,
        params: rest.length > 0 ? rest.map(describe) : undefined,
      },
      typeof message === 'string' ? message : describe(message),
    )
  }

  /**
   * Nest also calls `setLogLevels` when `bufferLogs` is used.
   *
   * Ignored deliberately: the level is `LOG_LEVEL` from the validated environment,
   * and letting the framework override it would mean the one setting an operator
   * changes during an incident is quietly not in effect.
   */
  setLogLevels(): void {}
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A circular object, which Nest does pass — `JSON.stringify` throws on it, and
    // an exception thrown while logging a start-up failure loses the failure.
    return String(value)
  }
}
