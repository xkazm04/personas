export const CRASH_STORAGE_KEY = "__personas_frontend_crashes";
export const CRASH_MAX_ENTRIES = 20;

/**
 * Read and trim crash logs from localStorage.
 * Always returns at most {@link CRASH_MAX_ENTRIES} entries, re-saving if trimmed.
 */
export function readCrashLogs(): Array<{ timestamp: string; component: string; message: string; stack?: string }> {
  try {
    const raw = localStorage.getItem(CRASH_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const trimmed = parsed.slice(0, CRASH_MAX_ENTRIES);
    if (trimmed.length < parsed.length) {
      localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(trimmed));
    }
    return trimmed as Array<{ timestamp: string; component: string; message: string; stack?: string }>;
  } catch {
    // intentional: corrupted data -- wipe and return empty
    localStorage.removeItem(CRASH_STORAGE_KEY);
    return [];
  }
}

/**
 * Persist a frontend crash to localStorage for later diagnostics.
 * Keeps the most recent {@link CRASH_MAX_ENTRIES} entries under {@link CRASH_STORAGE_KEY}.
 */
export function persistCrash(
  label: string,
  error: unknown,
  componentStack?: string,
): void {
  try {
    const crashes: unknown[] = JSON.parse(
      localStorage.getItem(CRASH_STORAGE_KEY) || "[]",
    );
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      component: label,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
    };
    if (componentStack) {
      entry.componentStack = componentStack.slice(0, 1000);
    }
    crashes.unshift(entry);
    const sliced = crashes.slice(0, CRASH_MAX_ENTRIES);
    try {
      localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(sliced));
    } catch {
      // Quota exceeded -- halve entries and retry once
      const halved = sliced.slice(0, Math.max(1, Math.floor(CRASH_MAX_ENTRIES / 2)));
      localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(halved));
    }
  } catch {
    // intentional: non-critical -- localStorage may be full or unavailable
  }
}
