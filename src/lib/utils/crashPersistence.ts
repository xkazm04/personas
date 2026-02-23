const STORAGE_KEY = "__personas_frontend_crashes";
const MAX_ENTRIES = 20;

/**
 * Persist a frontend crash to localStorage for later diagnostics.
 * Keeps the most recent {@link MAX_ENTRIES} entries under {@link STORAGE_KEY}.
 */
export function persistCrash(
  label: string,
  error: unknown,
  componentStack?: string,
): void {
  try {
    const crashes: unknown[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]",
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(crashes.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // localStorage may be full or unavailable
  }
}
