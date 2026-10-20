/**
 * Boundary narrowing for Athena-composed widget config.
 *
 * A widget's `config` is whatever the model emitted: `items: [{ title: { text } }]` is as likely as
 * the documented shape, and a cast (`config.items as IssueItem[]`) hands React an object where it
 * expects a string ("Objects are not valid as a React child"). Each widget narrows ONCE here, into
 * its own domain type, and renders only that. A malformed item is dropped or defaulted - it never
 * reaches JSX as a non-primitive.
 */

/** The array's elements that are plain objects; anything else (null, string, nested array) is dropped. */
export function recordsOf(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

/** A renderable string: a non-empty string, or a number/boolean spelled out; objects and the rest are `undefined`. */
export function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v === '' ? undefined : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return undefined;
}

/** A list of strings: array elements via {@link textOf}; a lone string is a one-item list; the rest is empty. */
export function stringsOf(v: unknown): string[] {
  if (typeof v === 'string') return v ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.map(textOf).filter((s): s is string => s !== undefined);
}

/** The value if it is one of `allowed`, else `undefined`. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
