import type { Logger } from 'pino'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A logger that records instead of writing.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two reasons this is a recorder rather than a set of no-ops.
 *
 * **The log line is part of the contract.** Several decisions in this service are
 * *only* observable in a log: that a mapped database error's SQLSTATE goes to the
 * operator and never to the client, that a probe route is logged at `debug` rather
 * than `info`, that a 4xx is `debug` and a 5xx is `error`, that the drain logs both
 * its start and its end. None of those can be asserted against a silent double,
 * and every one of them is a thing that regressed or was wrong at least once.
 *
 * **A test suite that prints a boot sequence between assertions is a suite whose
 * output nobody reads.** `vitest.config.ts` deliberately leaves console interception
 * on for the unit tier for the same reason.
 *
 * `bindings` is captured alongside the message because the interesting assertion is
 * almost always about the object, not the string: "the SQLSTATE is in the log record"
 * and "the connection string is not" are both claims about `bindings`.
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface LogRecord {
  level: LogLevel
  bindings: Record<string, unknown>
  message: string | undefined
}

export class RecordingLogger {
  readonly records: LogRecord[] = []

  /** Every record at `level`. */
  at(level: LogLevel): LogRecord[] {
    return this.records.filter((r) => r.level === level)
  }

  /** The records whose message is exactly `message`. */
  withMessage(message: string): LogRecord[] {
    return this.records.filter((r) => r.message === message)
  }

  /** Every message, in order. Makes an ordering assertion readable. */
  get messages(): (string | undefined)[] {
    return this.records.map((r) => r.message)
  }

  /**
   * The whole recording as one string, for negative assertions.
   *
   * "no log line anywhere contains this password" is a claim about every field of
   * every record, including ones a future edit adds, so it is checked against the
   * serialised whole rather than against the fields a test thought to look at.
   * That is the same reasoning `api-error.ts` uses for parsing the response body
   * instead of trusting the allowlist that built it.
   */
  serialise(): string {
    return JSON.stringify(this.records, (_key, value) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
    )
  }

  private record(level: LogLevel) {
    return (first?: unknown, second?: unknown): void => {
      // pino's signature is (obj, msg) or (msg). Both shapes are used in this
      // service, so both are normalised here rather than at every assertion.
      if (typeof first === 'string') {
        this.records.push({ level, bindings: {}, message: first })
        return
      }
      this.records.push({
        level,
        bindings: (first ?? {}) as Record<string, unknown>,
        message: typeof second === 'string' ? second : undefined,
      })
    }
  }

  fatal = this.record('fatal')
  error = this.record('error')
  warn = this.record('warn')
  info = this.record('info')
  debug = this.record('debug')
  trace = this.record('trace')

  /** Nest's logger adapter calls this; the real one returns a child logger. */
  child(): RecordingLogger {
    return this
  }

  flush(): void {
    /* nothing buffered */
  }

  /** The recorder, typed as the real thing. The cast is confined to this line. */
  asLogger(): Logger {
    return this as unknown as Logger
  }
}
