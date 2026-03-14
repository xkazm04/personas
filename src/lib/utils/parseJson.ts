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

/** Alias for parseJsonOrDefault -- matches the name used across template components. */
export const parseJsonSafe = parseJsonOrDefault;

/** Result tuple returned by {@link safeJsonParse}. */
export type JsonParseResult<T> =
  | [data: T, error: null]
  | [data: null, error: Error];

/**
 * Parse a JSON string and return a `[data, error]` result tuple instead of throwing.
 *
 * When a `guard` function is supplied the parsed value is validated at runtime --
 * if the guard returns `false` an error is produced without throwing.
 */
export function safeJsonParse<T = unknown>(
  json: string | null | undefined,
  guard?: (value: unknown) => value is T,
): JsonParseResult<T> {
  if (!json) return [null, new Error('Input is nullish or empty')];
  try {
    const parsed: unknown = JSON.parse(json);
    if (guard && !guard(parsed)) {
      return [null, new Error('Parsed JSON did not pass type guard')];
    }
    return [parsed as T, null];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err))];
  }
}

/** Check whether a raw JSON string parses into a non-empty array or object. */
export function hasNonEmptyJson(raw: string | null | undefined, type: 'array' | 'object'): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (type === 'array') {
      return Array.isArray(parsed) && parsed.length > 0;
    }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed as Record<string, unknown>).length > 0;
  } catch { // intentional: non-critical -- JSON parse fallback
    return type === 'object' ? !!raw : false;
  }
}
