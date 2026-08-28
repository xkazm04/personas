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

describe('extractErrorMessage', () => {
  it('reads Error, the IPC { error } envelope, and raw strings', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
    expect(extractErrorMessage({ error: 'ipc failed' })).toBe('ipc failed');
    expect(extractErrorMessage('plain')).toBe('plain');
  });
});
