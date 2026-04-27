/**
 * Client-side SQL statement classification for safe-mode UX.
 *
 * Mirrors the Rust `is_mutation()` logic so the UI can show instant feedback
 * without an IPC round-trip. The backend still enforces the guard — this is
 * purely for the confirmation dialog decision.
 */

const READ_ONLY_KEYWORDS = new Set([
  'SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH',
  'PRAGMA', 'ANALYZE', 'VALUES',
  // Redis read commands
  'GET', 'MGET', 'HGET', 'HGETALL', 'HMGET', 'HKEYS', 'HVALS', 'HLEN',
  'LRANGE', 'LLEN', 'LINDEX', 'SCARD', 'SMEMBERS', 'SISMEMBER',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZSCORE', 'ZCARD', 'ZCOUNT', 'ZRANK',
  'EXISTS', 'TYPE', 'TTL', 'PTTL', 'KEYS', 'SCAN', 'DBSIZE', 'INFO',
  'PING', 'ECHO', 'TIME', 'RANDOMKEY', 'STRLEN', 'GETRANGE',
]);

// CTE-style mutations: `WITH x AS (DELETE/INSERT/UPDATE/MERGE ...) SELECT ...`
// look read-only by leading keyword but actually mutate data. After stripping
// string/identifier literals to avoid matching inside text values, scan the body
// for mutation verbs.
const MUTATION_VERBS_RE = /\b(DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT)\b/i;

function stripSqlLiterals(s: string): string {
  // Strip single-quoted literals (with '' escapes), double-quoted identifiers,
  // and Postgres dollar-quoted strings. Crude but enough to suppress most
  // false positives like `WHERE message = 'please delete this'`.
  return s
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/'(?:''|[^'])*'/g, '')
    .replace(/"(?:""|[^"])*"/g, '');
}

/** Returns `true` if the query looks like it mutates data. */
export function isMutationQuery(queryText: string): boolean {
  let s = queryText.trim();

  // Strip leading comments
  while (true) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      if (nl === -1) return false;
      s = s.slice(nl + 1).trimStart();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) return true; // unclosed comment — treat as mutation (fail-safe)
      s = s.slice(end + 2).trimStart();
    } else {
      break;
    }
  }

  const match = s.match(/^([A-Za-z]+)/);
  if (!match?.[1]) return false;
  const leading = match[1].toUpperCase();
  if (!READ_ONLY_KEYWORDS.has(leading)) return true;

  // CTE escape hatch: a `WITH` query can wrap a mutation. Scan the body
  // (with literals stripped) for mutation verbs as whole words.
  if (leading === 'WITH') {
    const body = stripSqlLiterals(s);
    if (MUTATION_VERBS_RE.test(body)) return true;
  }

  return false;
}

/** Extract a human-readable error message from a Tauri IPC error. */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as Record<string, unknown>).error);
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return 'Unknown error'; }
}
