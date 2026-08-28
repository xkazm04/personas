/**
 * Shorten a path to at most `maxLen` characters, keeping the tail (the part
 * that identifies the file) and marking the cut with a leading ellipsis.
 *
 * The ellipsis is part of the budget: a result is never longer than `maxLen`.
 * The earlier form returned `'...' + slice(-maxLen)`, which made a 51-char path
 * 53 characters long — a "truncation" that grew its input.
 */
export function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  if (maxLen <= 3) return path.slice(-maxLen);
  return '...' + path.slice(-(maxLen - 3));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
