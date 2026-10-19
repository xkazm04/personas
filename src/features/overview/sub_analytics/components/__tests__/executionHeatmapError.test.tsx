/**
 * A failed heatmap read is spelled as a failure, not as "[object Object]" and
 * not as a year with zero executions.
 *
 * `getExecutionHeatmap` goes through invokeWithTimeout, which rejects with a
 * serialized AppError OBJECT. The card's `e instanceof Error ? e.message :
 * String(e)` ladder printed "[object Object]", and the header still read
 * "0 executions" above the error because the subtitle came from the null data.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { preloadSectionsAsync } from '@/i18n/useTranslation';

const getExecutionHeatmap = vi.fn();
vi.mock('@/api/overview/observability', () => ({
  getExecutionHeatmap: (...a: unknown[]) => getExecutionHeatmap(...a),
}));

import { ExecutionHeatmap } from '../ExecutionHeatmap';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

describe('ExecutionHeatmap — AppError rejection', () => {
  it('renders a resolved message and no zero-execution subtitle', async () => {
    getExecutionHeatmap.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    render(<ExecutionHeatmap />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const card = screen.getByTestId('execution-heatmap');
    expect(card.textContent).not.toMatch(/object Object/);
    expect(card.textContent).not.toMatch(/\b0 executions?\b/i);
    expect(card.querySelector('[class*="text-red-400"]')).not.toBeNull();
  });
});
