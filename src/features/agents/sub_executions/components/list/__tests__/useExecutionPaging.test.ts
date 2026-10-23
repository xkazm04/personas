/**
 * A "load more" page that lands after a persona switch belongs to the OLD
 * persona. The reset effect clears `extraRows` on the switch, but the request
 * already in flight then resolved and appended its rows (and its server count)
 * to the new persona's ledger: persona A's runs listed under persona B.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

const listExecutionsSummary = vi.fn<(...a: unknown[]) => Promise<ExecutionListItem[]>>();
vi.mock('@/api/agents/executions', () => ({
  listExecutionsSummary: (...a: unknown[]) => listExecutionsSummary(...a),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => {} }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: { executionsServerCount: Record<string, number> }) => unknown) =>
    selector({ executionsServerCount: {} }),
}));

import { useExecutionPaging, EXECUTION_PAGE_SIZE } from '../useExecutionPaging';

function row(id: string, personaId: string): ExecutionListItem {
  return {
    id, persona_id: personaId, use_case_id: null, status: 'completed',
    input_tokens: 0, output_tokens: 0, cost_usd: null, error_message: null,
    duration_ms: null, retry_of_execution_id: null, retry_count: 0,
    started_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z',
    is_simulation: false, business_outcome: 'none',
  } as ExecutionListItem;
}

const fullPage = (personaId: string) =>
  Array.from({ length: EXECUTION_PAGE_SIZE }, (_, i) => row(`${personaId}-${i}`, personaId));

beforeEach(() => vi.clearAllMocks());

describe('useExecutionPaging', () => {
  it('drops a page that resolves after the persona changed', async () => {
    let resolvePage: (rows: ExecutionListItem[]) => void = () => {};
    listExecutionsSummary.mockImplementation(() => new Promise((r) => { resolvePage = r; }));

    const { result, rerender } = renderHook(
      ({ personaId, firstPage }) => useExecutionPaging(personaId, firstPage, 'failed'),
      { initialProps: { personaId: 'A', firstPage: fullPage('A') } },
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.loadMore(); });
    rerender({ personaId: 'B', firstPage: fullPage('B') });
    await act(async () => {
      resolvePage([row('A-late', 'A')]);
      await pending;
    });

    expect(result.current.rows.some((r) => r.persona_id === 'A')).toBe(false);
    expect(result.current.rows).toHaveLength(EXECUTION_PAGE_SIZE);
    // The stale page must not have consumed the new persona's offset either.
    expect(result.current.hasMore).toBe(true);
  });
});
