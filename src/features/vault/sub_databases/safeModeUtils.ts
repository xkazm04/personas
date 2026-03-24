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
  return !READ_ONLY_KEYWORDS.has(match[1].toUpperCase());
}
