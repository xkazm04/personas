/**
 * The compare/detail hydration cache must not freeze an in-flight run.
 *
 * `hydrate` kept every full record it fetched, keyed by id, for the life of
 * the list. Clicking a row while its run was still `running` cached that
 * snapshot, and every later click (detail modal or compare) served it again:
 * status `running`, cost 0, no output, long after the run had landed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

const getExecution = vi.fn<(...a: unknown[]) => Promise<PersonaExecution>>();
vi.mock('@/api/agents/executions', () => ({
  getExecution: (...a: unknown[]) => getExecution(...a),
}));
vi.mock('@/api/overview/healing', () => ({ getRetryChain: vi.fn(async () => []) }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

import { useExecutionCompare } from '../useExecutionCompare';

const exec = (status: string) => ({ id: 'e1', persona_id: 'p1', status }) as PersonaExecution;
const msg = { failed_to_load_chain: 'chain', failed_to_hydrate_comparison: 'hydrate' };

beforeEach(() => vi.clearAllMocks());

describe('useExecutionCompare.hydrate', () => {
  it('re-reads a run that was still in flight when first hydrated', async () => {
    getExecution.mockResolvedValueOnce(exec('running')).mockResolvedValueOnce(exec('completed'));
    const { result } = renderHook(() => useExecutionCompare('p1', [], new Map(), msg));

    await act(async () => { await result.current.hydrate('e1'); });
    let second: PersonaExecution | undefined;
    await act(async () => { second = await result.current.hydrate('e1'); });

    expect(second?.status).toBe('completed');
    expect(getExecution).toHaveBeenCalledTimes(2);
  });

  it('still serves a landed run from the cache', async () => {
    getExecution.mockResolvedValue(exec('failed'));
    const { result } = renderHook(() => useExecutionCompare('p1', [], new Map(), msg));

    await act(async () => { await result.current.hydrate('e1'); });
    await act(async () => { await result.current.hydrate('e1'); });

    expect(getExecution).toHaveBeenCalledTimes(1);
  });
});
