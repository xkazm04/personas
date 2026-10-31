/**
 * Status tokens are a status signal. The compare toolbar used text-status-error
 * on the second pick's id as a left/right key, whatever that run's status.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ExecutionListFilters } from '../ExecutionListFilters';

describe('ExecutionListFilters compare bar', () => {
  it('colours neither picked id with a status token', () => {
    const { container } = render(
      <ExecutionListFilters
        showSimulations={false}
        setShowSimulations={() => {}}
        hasSimulations={false}
        compareMode
        exitCompareMode={() => {}}
        setCompareMode={() => {}}
        hasEnoughToCompare
        compareLeft="aaaaaaaa-1"
        compareRight="bbbbbbbb-2"
        canCompare
        onShowComparison={() => {}}
      />,
    );
    const ids = Array.from(container.querySelectorAll('span.typo-code')).filter((s) => s.textContent?.startsWith('#'));
    expect(ids).toHaveLength(2);
    const statusToned = ids.filter((s) => /text-status-/.test(s.className));
    expect(statusToned.length).toBe(0);
  });
});
