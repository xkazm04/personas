/** Parse a JSON string, returning `fallback` if the input is nullish or malformed. */
export function parseJsonOrDefault<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return fallback;
  }
}

/** Alias for parseJsonOrDefault — matches the name used across template components. */
export const parseJsonSafe = parseJsonOrDefault;
