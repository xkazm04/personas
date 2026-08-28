/**
 * Parsing a stored JSON blob. Which of these to reach for:
 *
 *  - the caller can ACT on a parse failure (report it, surface it, branch on
 *    it) -> `safeJsonParse`, which hands back the error.
 *  - the caller cannot -> `parseJsonOrDefault`, which substitutes a fallback.
 *    A parse failure is then indistinguishable from an empty value, which is
 *    the point and also the cost.
 *
 * `hasNonEmptyJson` / `hasRenderableJsonBlob` answer "is there anything here?"
 * without handing the value back; they differ on what unparseable text means
 * and each says so.
 *
 * There used to be a fifth entry point, `parseJsonSafe`, which was
 * `export const parseJsonSafe = parseJsonOrDefault` -- one function under two
 * names, no rule for choosing, and by the end 8 of its 13 consumers were
 * importing the real name and aliasing it back locally.
 */

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

function isNonEmptyPlainObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/**
 * Check whether a raw JSON string parses into a non-empty array or object.
 *
 * A parse failure is `false` for BOTH shapes. The catch used to read
 * `type === 'object' ? !!raw : false`, so the same malformed string answered
 * "yes, that's object content" and "no, that's not array content" — the `type`
 * parameter selecting whether to trust the input rather than which shape to look
 * for. That was one caller's requirement ("a non-empty raw blob still renders")
 * papered into the shared predicate, where every other caller inherited it as a
 * masked parse failure. The requirement now has its own name:
 * {@link hasRenderableJsonBlob}.
 */
export function hasNonEmptyJson(raw: string | null | undefined, type: 'array' | 'object'): boolean {
  if (!raw) return false;
  const [parsed, err] = safeJsonParse(raw);
  if (err) return false;
  return type === 'array'
    ? Array.isArray(parsed) && parsed.length > 0
    : isNonEmptyPlainObject(parsed);
}

/**
 * Whether a stored blob has anything worth rendering — a non-empty JSON object,
 * OR text that does not parse at all and is therefore shown verbatim.
 *
 * This is the honest name for what `hasNonEmptyJson(raw, 'object')` used to do
 * in its catch branch. Execution `input_data` / `output_data` come from four
 * different CLI providers and are not guaranteed to be JSON; hiding a panel
 * because a blob failed to parse would hide content the viewer can read fine.
 * Use this only where unparseable text is genuinely displayed.
 */
export function hasRenderableJsonBlob(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const [parsed, err] = safeJsonParse(raw);
  if (err) return true; // unparseable but non-empty — rendered as raw text
  return isNonEmptyPlainObject(parsed);
}
