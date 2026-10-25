// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getExecution = vi.hoisted(() => vi.fn());
vi.mock('@/api/agents/executions', () => ({ getExecution }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => undefined }));

import { awaitExecutionResult } from '../awaitExecutionResult';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

// Fixture: awaitExecutionResult reads only id and status.
const row = (status: string) => ({ id: 'e1', status }) as PersonaExecution;

beforeEach(() => { getExecution.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('awaitExecutionResult', () => {
  it('returns an already-terminal row without reading again', async () => {
    await expect(awaitExecutionResult(row('completed'), 'p1')).resolves.toEqual(row('completed'));
    expect(getExecution).not.toHaveBeenCalled();
  });

  it('re-reads a queued row until it lands, retrying a failed read', async () => {
    getExecution
      .mockResolvedValueOnce(row('running'))
      .mockRejectedValueOnce(new Error('db busy'))
      .mockResolvedValueOnce(row('failed'));
    const p = awaitExecutionResult(row('queued'), 'p1', { intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toEqual(row('failed'));
    expect(getExecution).toHaveBeenCalledTimes(3);
  });

  it('gives up with null when the budget runs out', async () => {
    getExecution.mockResolvedValue(row('running'));
    const p = awaitExecutionResult(row('queued'), 'p1', { intervalMs: 10, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBeNull();
  });

  it('stops with null once cancelled', async () => {
    getExecution.mockResolvedValue(row('running'));
    let cancelled = false;
    const p = awaitExecutionResult(row('queued'), 'p1', { intervalMs: 10, isCancelled: () => cancelled });
    await vi.advanceTimersByTimeAsync(25);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(25);
    await expect(p).resolves.toBeNull();
  });
});
