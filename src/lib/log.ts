/**
 * Structured frontend logger.
 * In development, logs to console. In production, could optionally
 * forward to the Rust backend via invoke('log_frontend', ...).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function formatMessage(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>
): string {
  const ts = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : "";
  return `[${ts}] [${level.toUpperCase()}] [${scope}] ${message}${ctx}`;
}

function logAt(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>
) {
  const formatted = formatMessage(level, scope, message, context);
  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const log = {
  debug: (scope: string, msg: string, ctx?: Record<string, unknown>) =>
    logAt("debug", scope, msg, ctx),
  info: (scope: string, msg: string, ctx?: Record<string, unknown>) =>
    logAt("info", scope, msg, ctx),
  warn: (scope: string, msg: string, ctx?: Record<string, unknown>) =>
    logAt("warn", scope, msg, ctx),
  error: (scope: string, msg: string, ctx?: Record<string, unknown>) =>
    logAt("error", scope, msg, ctx),
};

export interface ScopedLogger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

/** Create a scoped logger instance. Scope is baked in so callers just pass message + context. */
export function createLogger(scope: string): ScopedLogger {
  return {
    debug: (msg, ctx) => logAt("debug", scope, msg, ctx),
    info: (msg, ctx) => logAt("info", scope, msg, ctx),
    warn: (msg, ctx) => logAt("warn", scope, msg, ctx),
    error: (msg, ctx) => logAt("error", scope, msg, ctx),
  };
}
