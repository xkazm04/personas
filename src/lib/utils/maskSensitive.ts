/**
 * Sensitive data masking for execution display.
 *
 * - maskSensitiveJson(): redacts JSON values whose keys match sensitive patterns
 * - sanitizeErrorMessage(): strips file paths, IPs, and internal hostnames from errors
 */

const SENSITIVE_KEY_RE =
  /^(password|passwd|secret|token|api_key|apikey|api[-_]?secret|access[-_]?key|auth|authorization|credential|private[-_]?key|client[-_]?secret|refresh[-_]?token|access[-_]?token|bearer|session[-_]?id|cookie|x[-_]?api[-_]?key|connection[-_]?string|dsn)$/i;

const MASK = '••••••••';

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
    return raw;
  }
}

// ── Error message sanitization ───────────────────────────────────────────

// Unix/Windows absolute file paths with optional :line:col
const FILE_PATH_RE = /(?:\/[\w./-]+|[A-Z]:\\[\w.\\ -]+)(?::\d+(?::\d+)?)?/g;

// IPv4 addresses (but not version-like patterns such as 1.2.3)
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g;

// Internal hostnames (*.internal, *.local, *.corp, ip-xxx-xxx patterns)
const INTERNAL_HOST_RE = /\b[\w-]+\.(?:internal|local|corp|lan)\b/gi;

/**
 * Strip internal file paths, IP addresses, and internal hostnames from an
 * error message to prevent leaking deployment details in screenshots.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(FILE_PATH_RE, '[path]')
    .replace(IPV4_RE, '[ip]')
    .replace(INTERNAL_HOST_RE, '[host]');
}
