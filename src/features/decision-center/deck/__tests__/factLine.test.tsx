/**
 * A fact whose value is a raw ISO timestamp (the promotion card's `lockedAt`,
 * "Pinned to") reads as a time in the ledger, never as the machine string.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FactLine } from '../FactLine';

const ISO = '2026-01-20T00:00:00.000Z';

describe('FactLine timestamp facts', () => {
  it('does not print the raw ISO string for lockedAt', () => {
    const { container } = render(<FactLine fact={{ id: 'lockedAt', label: 'Pinned to', value: ISO }} />);
    expect(container.textContent).toContain('Pinned to');
    expect(container.textContent).not.toContain(ISO);
  });

  it('leaves ordinary facts verbatim', () => {
    const { container } = render(<FactLine fact={{ id: 'severity', label: 'Severity', value: ISO }} />);
    expect(container.textContent).toContain(ISO);
  });
});
