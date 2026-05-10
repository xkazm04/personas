/**
 * Tauri rejects with a serialised `AppError` object — `{ error, kind }`. Plain
 * `String(err)` collapses to `[object Object]`, so we extract the message
 * field explicitly. Prefer `error` (the human-readable string) over iterating
 * Object.values, which could surface the `kind` discriminator instead.
 */
export function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') return v;
    }
    try { return JSON.stringify(obj); } catch { /* fall through */ }
  }
  return String(err);
}
