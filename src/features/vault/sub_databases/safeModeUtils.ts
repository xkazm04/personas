/**
 * Client-side SQL statement classification for safe-mode UX.
 *
 * Mirrors the Rust `is_mutation()` logic so the UI can show instant feedback
 * without an IPC round-trip. The backend still enforces the guard — this is
 * purely for the confirmation dialog decision.
 */

const READ_ONLY_KEYWORDS = new Set([
  'SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH',
  'VALUES',
  // Redis read commands
  'GET', 'MGET', 'HGET', 'HGETALL', 'HMGET', 'HKEYS', 'HVALS', 'HLEN',
  'LRANGE', 'LLEN', 'LINDEX', 'SCARD', 'SMEMBERS', 'SISMEMBER',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZSCORE', 'ZCARD', 'ZCOUNT', 'ZRANK',
  'EXISTS', 'TYPE', 'TTL', 'PTTL', 'KEYS', 'SCAN', 'DBSIZE', 'INFO',
  'PING', 'ECHO', 'TIME', 'RANDOMKEY', 'STRLEN', 'GETRANGE',
]);

// Session/engine-state statements: a third class, neither read nor data
// mutation. They change nothing in the user's tables but DO change connection
// or engine state the next caller inherits — `PRAGMA journal_mode = WAL`
// rewrites the database's journal mode for everyone; `ANALYZE` rewrites the
// planner's statistics tables. Both sat in READ_ONLY_KEYWORDS, so safe mode
// dispatched them with no confirm banner. Safe mode has no shared-connection
// guarantee to lean on, so they are asked about.
const SESSION_STATE_KEYWORDS = new Set(['PRAGMA', 'ANALYZE']);

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

// Read-shaped writes: statements whose first token is SELECT or VALUES but
// which the engine's own READ ONLY transaction mode refuses — `SELECT ... INTO`
// creates a table (MySQL's `INTO OUTFILE` writes a file), `FOR UPDATE` /
// `FOR SHARE` hold row locks to transaction end, `nextval`/`setval` advance a
// sequence, and the pg_* / lo_* functions change engine state. Measured before
// this scan existed, 8 of 9 such statements were dispatched as reads with no
// confirm banner. The set is owned by `db_query::READ_SHAPED_WRITES`, whose
// test `read_shaped_writes_set_is_pinned` fails naming this file when the set
// changes; this regex is the client's copy for instant feedback and falls
// closed on anything it does not recognise. `UPDATE` (for `FOR UPDATE`) is
// already in MUTATION_VERBS_RE.
const READ_SHAPED_WRITES_RE = /\b(INTO|SHARE|NEXTVAL|SETVAL|LO_IMPORT|LO_EXPORT|PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND)\b/i;

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
  if (SESSION_STATE_KEYWORDS.has(leading)) return true;
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
  // Everything from here runs in order to GRANT read-only status, so it fails
  // CLOSED, exactly as the backend's `cte_body_has_mutation` does: an
  // unreadable tail has to resolve to "no".
  const body = stripSqlLiterals(s);
  if (body.unterminated) return true;

  // In safe mode a request is ONE statement. After stripping, a separator with
  // anything after it means the payload carries more than one — and
  // `SELECT 1; DROP TABLE audit_log` grants read-only status on its leading
  // keyword while a pass-through connector forwards the whole payload to an
  // engine that honours stacked statements. Refuse the request rather than
  // judging each member: that needs no statement splitter, which is itself
  // dialect-shaped and easy to fool. A single trailing terminator is not a
  // batch.
  const sep = body.text.indexOf(';');
  if (sep !== -1 && body.text.slice(sep + 1).trim().length > 0) return true;

  // SELECT/VALUES join the scan for the read-shaped writes above: the leading
  // keyword is exactly what those statements share with a real read.
  if (leading === 'WITH' || leading === 'EXPLAIN' || leading === 'SELECT' || leading === 'VALUES') {
    if (MUTATION_VERBS_RE.test(body.text) || READ_SHAPED_WRITES_RE.test(body.text)) return true;
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
