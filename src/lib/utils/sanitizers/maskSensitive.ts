/**
 * Sensitive data masking for execution display.
 *
 * - maskSensitiveJson(): redacts JSON values whose keys match sensitive patterns
 * - sanitizeErrorMessage(): strips file paths, IPs, and internal hostnames from errors
 */

const SENSITIVE_KEY_RE =
  /^(password|passwd|secret|token|api_key|apikey|api[-_]?secret|access[-_]?key|auth|authorization|credential|private[-_]?key|client[-_]?secret|refresh[-_]?token|access[-_]?token|bearer|session[-_]?id|cookie|x[-_]?api[-_]?key|connection[-_]?string|dsn)$/i;

const MASK = '********';

/**
 * Recursively walk a parsed JSON value and redact values whose keys match
 * sensitive patterns.  Returns a new object (does not mutate input).
 */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key) && (typeof val === 'string' || typeof val === 'number')) {
        out[key] = MASK;
      } else {
        out[key] = redactObject(val);
      }
    }
    return out;
  }
  return obj;
}

/**
 * Parse a raw JSON string, redact sensitive keys, and re-serialize.
 * Returns the original string unchanged if it doesn't parse as JSON.
 */
export function maskSensitiveJson(raw: string | null | undefined): string | null | undefined {
  if (!raw) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(redactObject(parsed));
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return raw;
  }
}

// -- Error message sanitization -------------------------------------------

// Unix/Windows absolute file paths with optional :line:col. The unix-path
// branch requires the leading `/` NOT be preceded by `:` or another `/` --
// otherwise it also matches the `//host/path` portion of an ordinary URL
// (e.g. `https://api.example.com/v1/run`), shredding it into `https:[path]`
// before EMAIL/host rules ever see it.
const FILE_PATH_RE = /(?:(?<![:/])\/[\w./-]+|[A-Z]:\\[\w.\\ -]+)(?::\d+(?::\d+)?)?/g;

// Full http(s) URLs, matched and protected before FILE_PATH_RE runs so a
// URL's path segment isn't mistaken for a filesystem path. Query/fragment
// (where tokens live) are stripped; scheme+host+path are preserved for
// diagnostic value.
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g;

// Placeholder wrapper used to shield a protected URL from the redaction
// passes below. Unlikely to collide with real error text.
const URL_PLACEHOLDER_RE = /@@SANITIZED_URL_(\d+)@@/g;

// IPv4 addresses (but not version-like patterns such as 1.2.3)
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g;

// Internal hostnames (*.internal, *.local, *.corp, ip-xxx-xxx patterns)
const INTERNAL_HOST_RE = /\b[\w-]+\.(?:internal|local|corp|lan)\b/gi;

// Email addresses
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// Common secret patterns (API keys, tokens, etc.)
// - Generic key:value pairs in text
const INLINE_SECRET_RE =
  /(api[-_]?key|apikey|secret|token|password|passwd|auth|authorization|credential|private[-_]?key|client[-_]?secret|access[-_]?key|access[-_]?token|refresh[-_]?token|bearer|dsn|connection[-_]?string|cookie|session[-_]?id)\s*[:=]\s*([a-zA-Z0-9\-_.~%]+)/gi;

// - Common token prefixes (ghp_, sk_live_, etc)
const PREFIXED_SECRET_RE = /\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\b/g;

/**
 * Strip internal file paths, IP addresses, internal hostnames, emails,
 * and potential secrets from a string to prevent leakage in plaintext storage.
 */
export function sanitizeErrorMessage(msg: string): string {
  // Protect full URLs before the file-path pass runs (it would otherwise
  // mistake the `//host/path` portion of a URL for a unix path and shred it,
  // e.g. `Failed to reach https://api.example.com/v1/run` -> `Failed to
  // reach https:[path]`). Strip the query/fragment now -- that's where a
  // token would live -- and stash the scheme+host+path behind a placeholder
  // so the later IP/host/email/secret passes still get a look at it, then
  // restore it at the end.
  const urls: string[] = [];
  let out = msg.replace(URL_RE, (match) => {
    let safe = match;
    try {
      const u = new URL(match);
      safe = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      // Not a parseable URL despite matching the loose regex; leave as-is
      // and let the remaining passes handle it.
    }
    const idx = urls.push(safe) - 1;
    return `@@SANITIZED_URL_${idx}@@`;
  });

  out = out
    .replace(FILE_PATH_RE, '[path]')
    .replace(IPV4_RE, '[ip]')
    .replace(INTERNAL_HOST_RE, '[host]')
    .replace(EMAIL_RE, '[email]')
    .replace(INLINE_SECRET_RE, (_match, key) => `${key}: [secret]`)
    .replace(PREFIXED_SECRET_RE, '[secret]');

  return out.replace(URL_PLACEHOLDER_RE, (_m, idx: string) => urls[Number(idx)] ?? '[url]');
}
