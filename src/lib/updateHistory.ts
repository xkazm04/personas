import { silentCatch } from "@/lib/silentCatch";

const STORAGE_KEY = "personas:update-history";
const MAX_ENTRIES = 10;

export interface UpdateHistoryEntry {
  /** App version string as reported by getVersion(). */
  version: string;
  /** Epoch ms when this version was first seen running. */
  at: number;
}

export function getUpdateHistory(): UpdateHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is UpdateHistoryEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as UpdateHistoryEntry).version === "string" &&
        typeof (e as UpdateHistoryEntry).at === "number",
    );
  } catch (err) {
    silentCatch("updateHistory:get")(err);
    return [];
  }
}

/**
 * Idempotently record the currently-running version. Appends a new entry only
 * when the version differs from the most recent one, so calling this on every
 * launch captures each upgrade exactly once (timestamp = first launch on that
 * version). Returns the resulting history.
 */
export function recordVersion(version: string): UpdateHistoryEntry[] {
  const history = getUpdateHistory();
  if (history[0]?.version === version) return history;
  const next = [{ version, at: Date.now() }, ...history].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    silentCatch("updateHistory:record")(err);
  }
  return next;
}

export function clearUpdateHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    silentCatch("updateHistory:clear")(err);
  }
}
