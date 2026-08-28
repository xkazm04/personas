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

interface StrippedSql {
  /** The statement with every literal and inert comment replaced by a space.
   *  Only meaningful when `unterminated` is false. */
  text: string;
  /** A quoted literal or block comment ran to end-of-input without closing, so
   *  an unknown amount of the statement was never classified. Callers MUST
   *  fail closed rather than trust `text`. */
  unterminated: boolean;
}

/**
 * Blank out string literals AND comments so verb scanning sees only text the
 * database will actually execute.
 *
 * Character-by-character mirror of the backend's `strip_sql_literals`
 * (`src-tauri/src/engine/db_query.rs`), including its dialect rules and its
 * `unterminated` flag. This used to be three regex replacements that handled
 * quoting only: `WITH c AS (SELECT 1) SELECT * FROM t /* delete the old rows
 * later *\/` had its comment left intact, so `MUTATION_VERBS_RE` matched
 * `delete` inside it and a pure read raised a confirm banner. Measured before
 * this change, 3 of 4 comment-bearing reads were misclassified that way.
 *
 * # Direction of failure — read this before editing
 *
 * The caller SEARCHES this output for danger, so text dropped here is danger
 * the caller can no longer see: "consume to end of input" is the UNSAFE
 * direction. Nothing is silently swallowed — an unclosed literal or block
 * comment sets `unterminated` and the caller classifies the statement as a
 * mutation.
 *
 * # Dialect rules (identical to the backend's, and for the same reason)
 *
 * The same string is forwarded to Postgres/Neon, SQLite or MySQL and this
 * function does not know which, so anything dialect-dependent stays VISIBLE
 * and is scanned as executable text:
 *
 * * `--` is a comment only when followed by whitespace or end of input. MySQL
 *   requires that whitespace, so `--1 DROP TABLE t` really can execute there.
 * * `/*! … *\/` is a MySQL executable comment — never blanked out. Plain
 *   `/* … *\/` is, depth-counted (nesting is a Postgres extension; where the
 *   dialects disagree the counter is still open at EOF, which fails closed).
 * * `#` is a MySQL line comment and nothing in Postgres/SQLite, so it is not
 *   treated as one.
 * * Doubled quotes (`''`, `""`) stay inside the literal; a backslash is inert
 *   inside one (Postgres `standard_conforming_strings=on`, SQLite has no
 *   backslash escape).
 * * Postgres dollar-quoting is deliberately NOT understood, matching the
 *   backend. The previous regex stripped `$$ … $$`, which meant a mutation
 *   verb inside one was invisible here and visible to the backend — the
 *   frontend granted read-only status and the backend then rejected the
 *   dispatch, so the user got a raw validation error instead of the
 *   authorisation prompt this guard exists to offer. Over-rejecting is the
 *   side of that line to be wrong on.
 */
function stripSqlLiterals(s: string): StrippedSql {
  const chars = Array.from(s);
  let out = '';
  let unterminated = false;
  let i = 0;

  /** `--` opens a comment in every dialect only when whitespace or EOF follows. */
  const isLineCommentGap = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

  while (i < chars.length) {
    const ch = chars[i]!;

    if (ch === '-' && chars[i + 1] === '-') {
      if (isLineCommentGap(chars[i + 2])) {
        i += 2;
        while (i < chars.length && chars[i] !== '\n') i += 1;
        out += ' ';
      } else {
        // Dialect-dependent — leave it visible so a verb behind it still counts.
        out += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '/' && chars[i + 1] === '*' && chars[i + 2] !== '!') {
      let depth = 1;
      i += 2;
      while (i < chars.length && depth > 0) {
        if (chars[i] === '/' && chars[i + 1] === '*') { depth += 1; i += 2; }
        else if (chars[i] === '*' && chars[i + 1] === '/') { depth -= 1; i += 2; }
        else i += 1;
      }
      if (depth > 0) unterminated = true;
      out += ' ';
      continue;
    }

    if (ch === "'" || ch === '"') {
      i += 1;
      let closed = false;
      while (i < chars.length) {
        if (chars[i] === ch) {
          if (chars[i + 1] === ch) { i += 2; continue; } // doubled-quote escape
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) unterminated = true;
      out += ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return { text: out, unterminated };
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
    // Fail CLOSED, exactly as the backend's `cte_body_has_mutation` does: this
    // branch is only ever consulted in order to GRANT read-only status, so an
    // unreadable tail has to resolve to "no".
    if (body.unterminated) return true;
    if (MUTATION_VERBS_RE.test(body.text)) return true;
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
