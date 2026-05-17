/**
 * Append `next` to a comma-joined tag string (the storage format used by
 * `ArtistAsset.tags`), case-insensitively de-duplicating against existing
 * tags. Returns the merged string; returns the original input untouched
 * when the new tag is already present so callers can skip the IPC round
 * trip via reference equality.
 */
export function mergeTagAcross(existing: string, next: string): string {
  const trimmed = next.trim();
  if (!trimmed) return existing;
  const tokens = existing
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const lower = trimmed.toLowerCase();
  for (const t of tokens) {
    if (t.toLowerCase() === lower) return existing;
  }
  tokens.push(trimmed);
  return tokens.join(', ');
}
