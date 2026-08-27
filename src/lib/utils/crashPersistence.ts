import { reportFrontendCrash } from "@/api/system/system";
import { sanitizeErrorMessage } from "@/lib/utils/sanitizers/maskSensitive";
import { createLogger } from "@/lib/log";
import { silentCatch } from '@/lib/silentCatch';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';


const logger = createLogger("crash-persistence");

// ── Crash-log sanitization ────────────────────────────────────────────────
// Strips secrets, URL query/fragment params, and function arguments from
// stack traces before anything is written to localStorage or sent to the
// backend.  Builds on the existing `sanitizeErrorMessage` (file paths, IPs,
// inline secrets, prefixed tokens) and adds crash-specific passes.

/** Strip query strings and fragments from URLs so tokens/keys in params don't leak. */
const URL_QUERY_RE = /(https?:\/\/[^\s"']+?)\?[^\s"')]+/g;
const URL_FRAGMENT_RE = /(https?:\/\/[^\s"']+?)#[^\s"')]+/g;

/** Redact argument values in stack-trace frames, e.g. `at fn(secret)` → `at fn(…)` */
const STACK_ARG_RE = /(\bat\s+[\w$.]+)\(([^)]+)\)/g;

function sanitizeCrashString(raw: string): string {
  let out = raw;
  // 1. Strip URL query/fragment params
  out = out.replace(URL_QUERY_RE, '$1?[query]');
  out = out.replace(URL_FRAGMENT_RE, '$1#[fragment]');
  // 2. Redact stack-trace argument values
  out = out.replace(STACK_ARG_RE, '$1(…)');
  // 3. Apply the shared sensitive-data sanitizer (paths, IPs, secrets, emails)
  out = sanitizeErrorMessage(out);
  return out;
}

export const CRASH_STORAGE_KEY = "__personas_frontend_crashes";
export const CRASH_MAX_ENTRIES = 20;

/**
 * Read and trim crash logs from localStorage.
 * Always returns at most {@link CRASH_MAX_ENTRIES} entries, re-saving if trimmed.
 */
export function readCrashLogs(): Array<{ timestamp: string; component: string; message: string; stack?: string }> {
  try {
    const raw = localStorage.getItem(CRASH_STORAGE_KEY);
    const parsed: unknown[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    // Merge any entries that fell back to sessionStorage during quota exhaustion
    try {
      const sessionRaw = sessionStorage.getItem(CRASH_STORAGE_KEY);
      if (sessionRaw) {
        const sessionParsed: unknown[] = JSON.parse(sessionRaw);
        if (Array.isArray(sessionParsed)) {
          parsed.unshift(...sessionParsed);
        }
        sessionStorage.removeItem(CRASH_STORAGE_KEY);
      }
    } catch (err) { silentCatch("lib/utils/crashPersistence:catch1")(err); }

    const trimmed = parsed.slice(0, CRASH_MAX_ENTRIES);
    if (trimmed.length !== parsed.length) {
      try {
        localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(trimmed));
      } catch (err) { silentCatch("lib/utils/crashPersistence:catch2")(err); }
    }
    return trimmed as Array<{ timestamp: string; component: string; message: string; stack?: string }>;
  } catch {
    // Corrupted data -- wipe and return empty. The wipe is itself wrapped:
    // when `localStorage` is unavailable outright (storage blocked, private
    // mode, a sandboxed webview) the getItem above throws AND so does this
    // removeItem, so the recovery path re-threw out of a function whose entire
    // contract is "returns a list, never throws" -- taking the crash-log panel
    // down on exactly the machines whose crashes matter.
    try {
      localStorage.removeItem(CRASH_STORAGE_KEY);
    } catch (err) {
      silentCatch("lib/utils/crashPersistence:wipe")(err);
    }
    return [];
  }
}

/**
 * Persist a frontend crash to localStorage AND to the Rust backend (SQLite).
 * Keeps the most recent {@link CRASH_MAX_ENTRIES} entries under {@link CRASH_STORAGE_KEY}.
 * The backend call is fire-and-forget so it never blocks crash recovery.
 */
export function persistCrash(
  label: string,
  error: unknown,
  componentStack?: string,
): void {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rawStack = error instanceof Error ? error.stack?.slice(0, 2000) : undefined;
  const rawCompStack = componentStack?.slice(0, 1000);

  // Sanitize all strings before persisting to localStorage / backend
  const message = sanitizeCrashString(rawMessage);
  const stack = rawStack ? sanitizeCrashString(rawStack) : undefined;
  const compStack = rawCompStack ? sanitizeCrashString(rawCompStack) : undefined;

  // 1. localStorage (synchronous, best-effort)
  try {
    // A corrupted blob must not disable crash persistence FOREVER. The previous
    // `JSON.parse(...)` threw straight into the outer catch, so this crash was
    // dropped -- and because nothing rewrote the key, so was every crash after
    // it, for the life of the install. Parsing defensively and discarding a
    // non-array lets the very next write replace the bad value.
    const stored = parseJsonOrDefault<unknown>(
      localStorage.getItem(CRASH_STORAGE_KEY),
      [],
    );
    const crashes: unknown[] = Array.isArray(stored) ? stored : [];
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      component: label,
      message,
      stack,
    };
    if (compStack) {
      entry.componentStack = compStack;
    }
    crashes.unshift(entry);
    const sliced = crashes.slice(0, CRASH_MAX_ENTRIES);
    try {
      localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(sliced));
    } catch {
      // Quota exceeded -- halve entries and retry once
      const halved = sliced.slice(0, Math.max(1, Math.floor(CRASH_MAX_ENTRIES / 2)));
      try {
        localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(halved));
      } catch {
        // localStorage genuinely full -- fall back to sessionStorage
        try {
          sessionStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(halved));
        } catch {
          logger.warn("Unable to persist crash locally — storage full");
        }
      }
    }
  } catch (err) { silentCatch("lib/utils/crashPersistence:catch3")(err); }

  // 2. Backend persistence (async, fire-and-forget)
  reportFrontendCrash(label, message, stack, compStack).catch(
    silentCatch("crashPersistence:reportFrontendCrash"),
  );
}
