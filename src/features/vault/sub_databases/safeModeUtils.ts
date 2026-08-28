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
//
// This list is the mirror of the backend's CTE_MUTATION_VERBS
// (src-tauri/src/engine/db_query.rs). DROP and ALTER were missing from this
// copy, so a `WITH`-led statement carrying either was classified a read here,
// raised no confirm banner, and was dispatched with allowMutation:false — where
// the backend, whose list DOES carry them, rejected it as a mutation. The user
// got a raw validation error instead of the authorisation prompt this guard
// exists to offer. Keep the two lists in step.
const MUTATION_VERBS_RE = /\b(DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT|DROP|ALTER)\b/i;

function stripSqlLiterals(s: string): string {
  // Strip single-quoted literals (with '' escapes), double-quoted identifiers,
  // and Postgres dollar-quoted strings. Crude but enough to suppress most
  // false positives like `WHERE message = 'please delete this'`.
  return s
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/'(?:''|[^'])*'/g, '')
    .replace(/"(?:""|[^"])*"/g, '');
}

/**
 * Returns `true` if the query looks like it mutates data.
 *
 * Biased toward `true`: an unrecognised or unparseable statement is treated as a
 * mutation so the confirm banner is offered, rather than silently executed.
 */
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

  // Fail CLOSED on anything this classifier cannot parse. Convex is a
  // first-class language in these editors and a Convex statement is a JSON body
  // (`{"path": "messages:remove", "args": {...}}`), so it has no leading
  // keyword at all. Returning false here classified every Convex call — remove
  // and destroy included — as a read: no confirm banner, dispatched with
  // allowMutation:false. Every other unknown shape in this pipeline already
  // fails closed; this was the one hole. The backend guard still has the final
  // say, so the cost of a false positive is one extra confirmation.
  const match = s.match(/^([A-Za-z]+)/);
  if (!match?.[1]) return true;
  const leading = match[1].toUpperCase();
  if (!READ_ONLY_KEYWORDS.has(leading)) return true;

  // Two read-looking leading keywords can still carry a mutation in the body,
  // so the leading keyword alone is not enough to grant read-only status:
  //
  //   WITH    — `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x`.
  //             Postgres, SQLite, Neon and PlanetScale all execute the CTE.
  //
  //   EXPLAIN — `EXPLAIN ANALYZE DELETE FROM users` REALLY DELETES. ANALYZE is
  //             not a dry run: Postgres executes the statement and reports the
  //             measured plan. Classifying on the leading keyword let this
  //             through safe mode with no confirm banner at all, and the
  //             backend's is_mutation() keys on the same keyword, so nothing
  //             downstream stopped it either. A bare `EXPLAIN DELETE ...` does
  //             not execute, but it is warned about too — one redundant
  //             confirmation is the documented price of this guard's
  //             fail-closed posture.
  //
  // Scan the body (with literals stripped) for mutation verbs as whole words.
  if (leading === 'WITH' || leading === 'EXPLAIN') {
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
