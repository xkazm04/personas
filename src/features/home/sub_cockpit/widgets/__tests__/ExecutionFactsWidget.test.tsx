import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getExecution = vi.fn();

vi.mock('@/api/agents/executions', () => ({
  getExecution: (...a: unknown[]) => getExecution(...a),
}));

import { ExecutionFactsWidget } from '../ExecutionFactsWidget';

const TILE = 'cockpit-widget-execution_facts';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Two states the widget used to get wrong. `invokeWithTimeout` rejects with a
 * serialized AppError OBJECT, which `err instanceof Error ? err.message :
 * String(err)` rendered as the tile's error title "[object Object]". And a
 * report written outside a run carries `execution_id: null`, which
 * openReportInChat passes straight through: the effect returned early and the
 * tile ghosted forever, a load that was never going to happen.
 */
describe('ExecutionFactsWidget states', () => {
  it('never renders an IPC rejection as "[object Object]"', async () => {
    getExecution.mockRejectedValue({ error: 'Execution not found', kind: 'NotFound' });
    render(<ExecutionFactsWidget config={{ executionId: 'e1', personaId: 'p1' }} />);
    await waitFor(() => expect(getExecution).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId(TILE).getAttribute('data-kit-state')).not.toBe('loading'));
    expect(screen.getByTestId(TILE).textContent).not.toContain('[object Object]');
  });

  it('says there is no execution instead of loading forever when the report has none', () => {
    render(<ExecutionFactsWidget config={{ executionId: null, personaId: 'p1' }} />);
    expect(getExecution).not.toHaveBeenCalled();
    const tile = screen.getByTestId(TILE);
    expect(tile.getAttribute('data-kit-state')).toBe('empty');
    expect(tile.textContent).toContain('No execution data');
  });
});
