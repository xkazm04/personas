/**
 * The in-flight class is `queued | running`, the statuses the
 * `persona_executions` CHECK constraint allows (schema.rs: queued, running,
 * completed, failed, incomplete, cancelled). The ledger tested
 * `running || pending` instead: `pending` is not a status this table can hold,
 * and `queued`, which it can, fell through. A queued run was hidden by the
 * "Running" filter and painted the amber accent of a cancelled one.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t: {}, tx: String }) }));

import { isInFlightExecutionStatus, matchesStatusFilter } from '../executionStatus';
import { executionRowAccent } from '../../components/table/ExecutionCells';
import { STATUS_FILTERS } from '../../components/list/useExecutionColumns';

const DB_STATUSES = ['queued', 'running', 'completed', 'failed', 'incomplete', 'cancelled'];

describe('execution status classes', () => {
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
