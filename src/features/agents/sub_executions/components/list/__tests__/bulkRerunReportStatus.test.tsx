/**
 * The cohort report printed the database status token ("completed") while
 * ExecutionComparison, on the sibling surface, printed the display label.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkRerunReport } from '../BulkRerunReport';
import { deriveCohort, type BulkRunItem } from '../../../libs/useBulkRerun';
import { getStatusEntry } from '@/lib/utils/formatters';

const items: BulkRunItem[] = [{
  originalId: 'aaaaaaaa1', origStatus: 'failed', origCost: 1, origDurationMs: 100,
  origInputTokens: 1, origOutputTokens: 1, status: 'success', newExecutionId: 'bbbbbbbb2',
  newStatus: 'completed', newCost: 1, newDurationMs: 100, newInputTokens: 1,
  newOutputTokens: 1, error: null,
}];

describe('bulk re-run report status vocabulary', () => {
  it('renders status display labels, not raw database tokens', () => {
    render(
      <BulkRerunReport cohort={deriveCohort(items)} items={items} onClose={() => {}} onCompareItem={() => {}} />,
    );
    const from = getStatusEntry('failed').label;
    const to = getStatusEntry('completed').label;
    expect(from).not.toBe('failed'); // the label is a different string than the token
    expect(screen.getAllByText(from).length).toBeGreaterThan(0);
    expect(screen.getAllByText(to).length).toBeGreaterThan(0);
    expect(screen.queryByText('failed')).toBeNull();
    expect(screen.queryByText('completed')).toBeNull();
  });
});
