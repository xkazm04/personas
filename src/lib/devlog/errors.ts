// ---------------------------------------------------------------------------
// Error producers. Unlike every other kind, an error's identity IS its text,
// so `msg` is `<source> [<scope>]: <first line of the error>` (<= 200 chars);
// the sink normalizes uuids, numbers, paths and quoted strings out of it
// before fingerprinting, so repeats of one error group and distinct errors
// do not. The full text still rides in `fields.error`.
//
//   "uncaught error"      - window.onerror            (main.tsx)
//   "unhandled rejection" - unhandledrejection         (main.tsx)
//   "toast error"         - toastCatch                 (silentCatch.ts; [scope] = the toastCatch context)
//   "logged error"        - log.error / logger.error   (log.ts; [scope] = the logger scope)
//
// Per-site silentCatch is deliberately NOT forwarded; its volume reaches the
// log as the `swallow_rollup` records of silentFailureTelemetry.ts.
// ---------------------------------------------------------------------------

import { devlog, type DevlogInput } from './buffer';

export const STACK_MAX_CHARS = 2_000;
export const ERROR_MSG_MAX_CHARS = 200;
const CONTEXT_STRING_MAX = 300;

export type ErrorSource = 'uncaught' | 'rejection' | 'toast' | 'logged';

const MSG_BY_SOURCE: Record<ErrorSource, string> = {
  uncaught: 'uncaught error',
  rejection: 'unhandled rejection',
  toast: 'toast error',
  logged: 'logged error',
};

/** The AppError `kind` of a rejection, when it carries one. */
export function errorKindOf(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const kind = (err as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind) return kind;
  }
  return undefined;
}

export function truncateStack(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || !stack) return undefined;
  return stack.length > STACK_MAX_CHARS ? stack.slice(0, STACK_MAX_CHARS) : stack;
}

function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
}

/**
 * The primitive members of a log context as snake_case fields. Objects and
 * arrays are left out: the sink caps fields at 4 KB and a nested payload is
 * what would blow it.
 */
export function contextFields(ctx: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!ctx) return out;
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'stack') continue;
    if (typeof v === 'string') out[snakeCase(k)] = v.length > CONTEXT_STRING_MAX ? v.slice(0, CONTEXT_STRING_MAX) : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[snakeCase(k)] = v;
  }
  return out;
}

export interface ErrorRecordInput {
  source: ErrorSource;
  /** Producer scope (`global-error`, `toastCatch`, the logger scope, ...). */
  scope: string;
  /** The error's own message. */
  error: string;
  stack?: unknown;
  /** errorRegistry category, when the producer knows it. */
  category?: string;
  /** Extra named fields (already snake_case or a log context to convert). */
  extra?: Record<string, unknown>;
}

/** `<source> [<scope>]: <first line of the error>`, capped at 200 chars. */
export function errorMessage(source: ErrorSource, scope: string, error: string): string {
  const firstLine = error.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const head = `${MSG_BY_SOURCE[source]} [${scope}]`;
  const msg = firstLine ? `${head}: ${firstLine}` : head;
  return msg.length > ERROR_MSG_MAX_CHARS ? msg.slice(0, ERROR_MSG_MAX_CHARS) : msg;
}

export function errorRecord(input: ErrorRecordInput): DevlogInput {
  // The bracketed scope is the most specific one the producer has: the
  // toastCatch context (passed as `extra.scope`) or else the producer scope.
  const msgScope = typeof input.extra?.scope === 'string' && input.extra.scope ? input.extra.scope : input.scope;
  return {
    kind: 'error',
    lvl: 'error',
    scope: input.scope,
    msg: errorMessage(input.source, msgScope, input.error),
    fields: {
      ...contextFields(input.extra),
      error: input.error,
      stack: truncateStack(input.stack),
      category: input.category,
    },
  };
}

export function recordError(input: ErrorRecordInput): void {
  devlog(errorRecord(input));
}
