/**
 * A cohort member that was cut off or cancelled used to keep status
 * running/pending: the report read "Running..." forever under a strip that said
 * "Cohort complete". Every member must end in a labelled, terminal state.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkRerunReport } from '../BulkRerunReport';
import { BulkRerunStrip } from '../BulkRerunStrip';
import { deriveCohort, type BulkRunItem } from '../../../libs/useBulkRerun';

function item(id: string, status: BulkRunItem['status']): BulkRunItem {
  return {
    originalId: id, origStatus: 'failed', origCost: 1, origDurationMs: 100,
    origInputTokens: 1, origOutputTokens: 1, status, newExecutionId: null,
    newStatus: null, newCost: null, newDurationMs: null, newInputTokens: null,
    newOutputTokens: null, error: null,
  };
}

const items = [item('aaaaaaaa1', 'timed_out'), item('bbbbbbbb2', 'cancelled'), item('cccccccc3', 'cancelled')];
const cohort = deriveCohort(items);

describe('bulk re-run terminal states', () => {
  it('report never says Running for a stopped row', () => {
    render(<BulkRerunReport cohort={cohort} items={items} onClose={() => {}} onCompareItem={() => {}} />);
    expect(screen.queryByText('Running...')).toBeNull();
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Timed out').length).toBeGreaterThanOrEqual(1);
  });

  it('strip does not claim a plain "Cohort complete" when rows were stopped', () => {
    render(<BulkRerunStrip phase="completed" items={items} cohort={cohort} onCancel={() => {}} onOpenReport={() => {}} />);
    expect(screen.queryByText(/Cohort complete/)).toBeNull();
    expect(screen.getByText(/3 not finished/)).toBeTruthy();
  });
});
