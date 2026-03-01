/**
 * URL sanitization for icon/image src attributes.
 *
 * Prevents SSRF, tracking pixels, and IP leakage by:
 * - Only allowing HTTPS URLs (blocks http, javascript, data, etc.)
 * - Blocking private/local network hostnames and IP ranges
 * - Returns null for unsafe URLs so callers can fall back to a placeholder
 */

/** Hostname patterns that resolve to private/local networks. */
const BLOCKED_HOSTNAME_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|.*\.local)$/i;

/**
 * Validate and sanitize a URL intended for use as an image `src`.
 * Returns the URL string if safe, or `null` if it should be blocked.
 */
export function sanitizeIconUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  // Only allow HTTPS
  if (!trimmed.startsWith('https://')) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Double-check protocol after parsing (handles edge cases like https://http://...)
  if (parsed.protocol !== 'https:') return null;

  // Block private/local network hostnames
  if (BLOCKED_HOSTNAME_RE.test(parsed.hostname)) return null;

  // Block URLs with credentials embedded
  if (parsed.username || parsed.password) return null;

  return parsed.href;
}

/**
 * Check whether a string looks like an external image URL (starts with http/https).
 * Use `sanitizeIconUrl` to validate before rendering.
 */
export function isIconUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('http://') || value.startsWith('https://');
}
