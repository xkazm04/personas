import { describe, it, expect } from 'vitest';
import { isMutationQuery, extractErrorMessage } from '../safeModeUtils';

/**
 * The classifier decides whether the console and the saved-query editor offer
 * the safe-mode confirm banner before dispatching. Its posture is fail-CLOSED:
 * anything it cannot parse is reported as a mutation, so the worst outcome is
 * one extra confirmation rather than an unconfirmed write.
 */
describe('isMutationQuery', () => {
  it('classifies plain reads as reads', () => {
    expect(isMutationQuery('SELECT * FROM users')).toBe(false);
    expect(isMutationQuery('  show tables  ')).toBe(false);
    expect(isMutationQuery('EXPLAIN SELECT 1')).toBe(false);
  });

  it('classifies writes as mutations', () => {
    expect(isMutationQuery('DELETE FROM users')).toBe(true);
    expect(isMutationQuery('update users set a = 1')).toBe(true);
    expect(isMutationQuery('DROP TABLE users')).toBe(true);
  });

  it('sees through a CTE that wraps a mutation', () => {
    expect(isMutationQuery('WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d')).toBe(true);
  });

  it('sees through EXPLAIN ANALYZE, which executes the statement it explains', () => {
    // `EXPLAIN ANALYZE DELETE ...` really deletes in Postgres — ANALYZE is not
    // a dry run. Classifying on the leading keyword sent it through safe mode
    // with no confirm banner.
    expect(isMutationQuery('EXPLAIN ANALYZE DELETE FROM users')).toBe(true);
    expect(isMutationQuery('explain analyze update users set a = 1')).toBe(true);
    expect(isMutationQuery('EXPLAIN ANALYZE SELECT * FROM users')).toBe(false);
    expect(isMutationQuery("EXPLAIN SELECT * FROM audit WHERE action = 'delete'")).toBe(false);
  });

  it('carries the same CTE verb list as the backend guard', () => {
    // Parity with CTE_MUTATION_VERBS in src-tauri/src/engine/db_query.rs.
    // DROP and ALTER were absent here, so these two shapes raised no confirm
    // banner and reached the user as a backend validation error instead.
    expect(isMutationQuery('WITH d AS (SELECT 1) DROP TABLE users')).toBe(true);
    expect(isMutationQuery('WITH d AS (SELECT 1) ALTER TABLE users ADD c INT')).toBe(true);
    expect(isMutationQuery('WITH d AS (SELECT 1) SELECT * FROM d')).toBe(false);
  });

  it('does not fire on a mutation verb that only appears inside a string literal', () => {
    expect(isMutationQuery("WITH c AS (SELECT 1) SELECT * FROM t WHERE msg = 'please delete this'")).toBe(false);
  });

  it('fails closed on a Convex statement, which has no leading keyword', () => {
    // Regression guard: this returned false (a "read"), so a Convex remove was
    // dispatched with allowMutation:false and never raised the confirm banner.
    expect(isMutationQuery('{"path": "messages:remove", "args": {"id": "1"}}')).toBe(true);
    expect(isMutationQuery('  {"path":"tasks:destroy","args":{}}  ')).toBe(true);
  });

  it('fails closed on any other statement with no leading letter', () => {
    expect(isMutationQuery('(SELECT 1)')).toBe(true);
    expect(isMutationQuery('/* unclosed')).toBe(true);
  });

  it('still resolves a read hidden behind a leading block comment', () => {
    expect(isMutationQuery('/* note */ SELECT 1')).toBe(false);
  });
});

/**
 * Comment handling, aligned with the backend's `strip_sql_literals`
 * (`src-tauri/src/engine/db_query.rs`). The frontend stripper handled quoting
 * only, so a mutation verb written in an ordinary trailing comment raised a
 * confirm banner on a pure read — measured before this change, 3 of the 4
 * comment-bearing reads below were misclassified as mutations.
 *
 * The dialect cases matter as much as the comment cases: the same string is
 * forwarded to Postgres/Neon, SQLite or MySQL and neither classifier knows
 * which, so anything one engine would execute must stay visible.
 */
describe('isMutationQuery — comment handling parity with the backend', () => {
  it('does not read a mutation verb out of a trailing comment', () => {
    expect(isMutationQuery('WITH c AS (SELECT 1) SELECT * FROM t /* delete the old rows later */')).toBe(false);
    expect(isMutationQuery('WITH c AS (SELECT 1) SELECT * FROM t -- delete the old rows later')).toBe(false);
    expect(isMutationQuery('EXPLAIN SELECT * FROM t /* we used to DROP this */')).toBe(false);
    expect(isMutationQuery("WITH c AS (SELECT 1) SELECT * FROM t /* it's fine */")).toBe(false);
  });

  it('counts nesting so a closed nested comment does not swallow the tail', () => {
    expect(isMutationQuery('WITH c AS (SELECT 1) /* a /* delete */ b */ SELECT * FROM c')).toBe(false);
  });

  it('keeps a MySQL-only line comment visible, because MySQL would execute it', () => {
    // `--x` (no gap) is a comment in Postgres/SQLite but NOT in MySQL, so the
    // DROP behind it has to stay countable.
    expect(isMutationQuery('WITH c AS (SELECT 1) SELECT 1 --x DROP TABLE t')).toBe(true);
  });

  it('keeps a MySQL executable comment visible', () => {
    expect(isMutationQuery('WITH c AS (SELECT 1) /*! DELETE FROM t */ SELECT 1')).toBe(true);
  });

  it('fails closed when a block comment or literal never closes', () => {
    // An unreadable tail is danger the scan cannot see; this branch only ever
    // runs in order to GRANT read-only status, so unknown resolves to "no".
    expect(isMutationQuery('WITH c AS (SELECT 1) SELECT * FROM t /* oops')).toBe(true);
    expect(isMutationQuery("WITH c AS (SELECT 1) SELECT * FROM t WHERE a = 'oops")).toBe(true);
  });

  it('does not understand dollar-quoting, matching the backend', () => {
    // The old regex stripped `$$ … $$`, so a verb inside one was invisible here
    // and visible to the backend: the frontend granted read-only status and the
    // dispatch was then rejected, surfacing a raw validation error instead of
    // the confirm prompt. Over-rejecting is the safe side of that line.
    expect(isMutationQuery('WITH c AS (SELECT 1) SELECT $$ delete $$')).toBe(true);
  });

  it('still ignores a verb inside an ordinary string literal', () => {
    expect(isMutationQuery("WITH c AS (SELECT 1) SELECT * FROM t WHERE msg = 'please delete this'")).toBe(false);
    expect(isMutationQuery("WITH c AS (SELECT 1) SELECT * FROM t WHERE msg = 'don''t delete'")).toBe(false);
  });
});

describe('extractErrorMessage', () => {
  it('reads Error, the IPC { error } envelope, and raw strings', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
    expect(extractErrorMessage({ error: 'ipc failed' })).toBe('ipc failed');
    expect(extractErrorMessage('plain')).toBe('plain');
  });
});
