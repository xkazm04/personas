/**
 * URL sanitization for icon/image src attributes and external-shell opens.
 *
 * Prevents SSRF, tracking pixels, IP leakage, and unsafe-protocol shell
 * handlers by:
 * - Only allowing HTTPS URLs for images (blocks http, javascript, data, etc.)
 * - Only allowing http/https URLs for external shell opens
 * - Blocking private/local network hostnames and IP ranges for images
 * - Blocking embedded credentials and unicode control/bidi overrides that
 *   can be used to hide a malicious scheme from the user
 * - Returns null for unsafe URLs so callers can fall back to a placeholder
 */

/** Hostname patterns that resolve to private/local networks. */
const BLOCKED_HOSTNAME_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|.*\.local)$/i;

/**
 * Reject codepoints that must never appear in a URL passed to the OS shell:
 * C0/C1 control chars, zero-width joiners, bidi overrides, BOM. These are
 * frequently used in phishing payloads to visually disguise a `javascript:`
 * or `data:` scheme as `https://`, or to hide the real destination host
 * behind a right-to-left override.
 */
function hasUnsafeCodepoints(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    // C0 controls + DEL
    if (c <= 0x1f || c === 0x7f) return true;
    // C1 controls
    if (c >= 0x80 && c <= 0x9f) return true;
    // Zero-width space / non-joiner / joiner
    if (c === 0x200b || c === 0x200c || c === 0x200d) return true;
    // LRM / RLM
    if (c === 0x200e || c === 0x200f) return true;
    // Line / paragraph separators
    if (c === 0x2028 || c === 0x2029) return true;
    // LRE / RLE / PDF / LRO / RLO (bidi formatting)
    if (c >= 0x202a && c <= 0x202e) return true;
    // LRI / RLI / FSI / PDI
    if (c >= 0x2066 && c <= 0x2069) return true;
    // BOM / word joiner
    if (c === 0xfeff || c === 0x2060) return true;
  }
  return false;
}

/**
 * Validate and sanitize a URL intended for use as an image `src`.
 * Returns the URL string if safe, or `null` if it should be blocked.
 */
export function sanitizeIconUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('https://')) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (BLOCKED_HOSTNAME_RE.test(parsed.hostname)) return null;
  if (parsed.username || parsed.password) return null;

  return parsed.href;
}

/** Allowed protocols for URLs opened via the OS shell (Tauri open). */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Validate a URL before passing it to the Tauri shell open handler.
 * Only allows http/https; rejects javascript:, data:, file:, custom schemes,
 * embedded credentials, and unicode obfuscation (bidi overrides, zero-width).
 * Returns the sanitized URL string if safe, or `null` if blocked.
 */
export function sanitizeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  // Check original input BEFORE trim — JS trim() strips BOM and some
  // zero-width chars, which would let them slip past the check.
  if (hasUnsafeCodepoints(url)) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;

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
