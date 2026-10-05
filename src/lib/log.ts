/**
 * Structured frontend logger.
 * Every level writes to the WebView console. `error` additionally reaches the
 * app's JSONL log file as a devlog `error` record (msg
 * `logged error [<scope>]: <first line>`, the full text in `fields.error`,
 * the scope in `fields.scope`), batched through
 * `devlog_ingest` - in every build, since PROD keeps `error` records. A logger
 * made with `{ forward: false }` stays console-only; main.tsx's global
 * handlers use one because they emit their own, more specific record.
 */

import { recordError } from "./devlog/errors";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** Forward `error` calls to devlog (default true). */
  forward?: boolean;
}

function forwardError(scope: string, message: string, context?: Record<string, unknown>) {
  const { error, stack, category, ...rest } = context ?? {};
  recordError({
    source: "logged",
    scope,
    error: message,
    stack,
    category: typeof category === "string" ? category : undefined,
    // A caller's own `error` text is kept as `detail`, beside the log message.
    extra: { ...rest, detail: typeof error === "string" ? error : undefined, scope },
  });
}

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
  context?: Record<string, unknown>,
  forward = true,
) {
  if (level === "error" && forward) forwardError(scope, message, context);
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
export function createLogger(scope: string, options?: LoggerOptions): ScopedLogger {
  const forward = options?.forward ?? true;
  return {
    debug: (msg, ctx) => logAt("debug", scope, msg, ctx),
    info: (msg, ctx) => logAt("info", scope, msg, ctx),
    warn: (msg, ctx) => logAt("warn", scope, msg, ctx),
    error: (msg, ctx) => logAt("error", scope, msg, ctx, forward),
  };
}
