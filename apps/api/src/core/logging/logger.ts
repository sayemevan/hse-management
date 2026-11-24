import { redact } from '../security/redaction';

/**
 * Structured JSON logger for Cloudflare Workers.
 *
 * Workers Logs indexes JSON written to the console, so each entry is one JSON line.
 * Sensitive keys are redacted recursively before output (never log secrets or tokens).
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Record<string, unknown>;

export interface LogSink {
  write(level: LogLevel, line: string): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** The logger is the single place allowed to write to the console. */
export const consoleSink: LogSink = {
  write(level, line) {
    /* eslint-disable no-console */
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    /* eslint-enable no-console */
  },
};

export class Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly bindings: LogContext = {},
    private readonly sink: LogSink = consoleSink,
  ) {}

  /** Returns a logger that adds `bindings` (e.g. requestId, module) to every entry. */
  child(bindings: LogContext): Logger {
    return new Logger(this.minLevel, { ...this.bindings, ...bindings }, this.sink);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(redact(this.bindings) as LogContext),
      ...(context ? (redact(context) as LogContext) : {}),
    };
    this.sink.write(level, JSON.stringify(entry));
  }
}
