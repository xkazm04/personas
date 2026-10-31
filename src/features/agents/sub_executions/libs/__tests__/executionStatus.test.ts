/**
 * The in-flight class is `queued | running`, the statuses the
 * `persona_executions` CHECK constraint allows (schema.rs: queued, running,
 * completed, failed, incomplete, cancelled). The ledger tested
 * `running || pending` instead: `pending` is not a status this table can hold,
 * and `queued`, which it can, fell through. A queued run was hidden by the
 * "Running" filter and painted the amber accent of a cancelled one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t: {}, tx: String }) }));

import {
  isFailedExecutionStatus,
  isInFlightExecutionStatus,
  isSuccessExecutionStatus,
  matchesStatusFilter,
} from '../executionStatus';
import { executionRowAccent } from '../../components/table/ExecutionCells';
import { STATUS_FILTERS } from '../../components/list/useExecutionColumns';

/**
 * The status set is read from the schema source itself, not hand-copied: the
 * persona_executions CREATE TABLE's `CHECK(status IN (...))`. A status added
 * to the backend without reaching executionStatus.ts fails this file.
 */
const SCHEMA_PATH = resolve(__dirname, '../../../../../../src-tauri/db/src/migrations/schema.rs');

function parseExecutionStatusCheck(schemaSource: string): string[] {
  const table = schemaSource.match(/CREATE TABLE IF NOT EXISTS persona_executions\s*\(([\s\S]*?)\n\);/);
  const check = table?.[1].match(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/);
  if (!check) throw new Error('persona_executions status CHECK not found in schema.rs');
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function isClassified(status: string): boolean {
  return (
    isInFlightExecutionStatus(status) ||
    isSuccessExecutionStatus(status) ||
    isFailedExecutionStatus(status)
  );
}

const DB_STATUSES = parseExecutionStatusCheck(readFileSync(SCHEMA_PATH, 'utf8'));

describe('execution status classes', () => {
  it('parses the schema CHECK (guards the parser itself)', () => {
    expect(DB_STATUSES).toContain('queued');
    expect(DB_STATUSES.length).toBeGreaterThanOrEqual(6);
    expect(['paused'].filter((x) => !isClassified(x))).toEqual(['paused']);
  });

  it('classifies every status the schema allows (in flight, success or failed)', () => {
    expect(DB_STATUSES.filter((x) => !isClassified(x))).toEqual([]);
  });

  it('treats queued as in flight, and nothing outside the CHECK set', () => {
    expect(DB_STATUSES.filter(isInFlightExecutionStatus)).toEqual(['queued', 'running']);
    expect(isInFlightExecutionStatus('pending')).toBe(false);
  });

  it('the Running filter keeps a queued run', () => {
    expect(matchesStatusFilter('queued', 'running')).toBe(true);
    expect(matchesStatusFilter('running', 'running')).toBe(true);
    expect(matchesStatusFilter('completed', 'running')).toBe(false);
    expect(matchesStatusFilter('failed', 'all')).toBe(true);
    expect(matchesStatusFilter('failed', 'cancelled')).toBe(false);
  });

  it('paints a queued row with the in-flight accent', () => {
    expect(executionRowAccent('queued')).toBe(executionRowAccent('running'));
  });

  it('offers a filter for every terminal status the table can hold', () => {
    for (const s of DB_STATUSES.filter((x) => !isInFlightExecutionStatus(x))) {
      expect(STATUS_FILTERS as readonly string[]).toContain(s);
    }
  });
});
