import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// -- Mocks (before the modules under test are imported) ----------------------

type ListenerCallback = (event: { payload: Record<string, unknown> }) => void;
const listenerMap = new Map<string, ListenerCallback>();
const mockListen = vi.fn(async (eventName: string, callback: ListenerCallback) => {
  listenerMap.set(eventName, callback);
  return () => {};
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, callback: ListenerCallback) => mockListen(eventName, callback),
}));

vi.mock('@/i18n/useTranslation', () => ({
  getActiveTranslations: () => ({ errors: { run_superseded: 'SUPERSEDED' } }),
}));

vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

const mockStartNegotiation = vi.fn();
vi.mock('@/api/vault/negotiator', () => ({
  startCredentialNegotiation: (...args: unknown[]) => mockStartNegotiation(...args),
  cancelCredentialNegotiation: vi.fn(async () => {}),
  getNegotiationStepHelp: vi.fn(),
}));

const cachedPlan = {
  service_name: 'Acme',
  estimated_time_seconds: 60,
  prerequisites: [],
  steps: [],
  verification_hint: '',
  tips: [],
};
vi.mock('@/hooks/design/core/playbookCache', () => ({
  lookupPlaybook: () => ({ plan: cachedPlan }),
  markPlaybookUsed: vi.fn(),
  savePlaybook: vi.fn(),
}));

vi.mock('@/lib/credentials/credentialRecipeRegistry', () => ({
  saveRecipeFromDesign: vi.fn(async () => {}),
}));

import { useAiArtifactTask } from '../useAiArtifactTask';
import { useCredentialNegotiator } from '../../credential/useCredentialNegotiator';
import { getCompletedTraces, getActiveSessions, __resetSystemTracesForTests } from '@/lib/execution/systemTrace';

// -- Helpers -----------------------------------------------------------------

const emit = (eventName: string, payload: Record<string, unknown>) => {
  const cb = listenerMap.get(eventName);
  if (!cb) throw new Error(`no listener registered for ${eventName}`);
  act(() => cb({ payload }));
};

function renderTask(cancelFn = vi.fn(async () => {})) {
  const startFn = vi.fn(async () => ({ design_id: 'B' }));
  const hook = renderHook(() =>
    useAiArtifactTask<[], Record<string, unknown>>({
      progressEvent: 'task-progress',
      statusEvent: 'task-status',
      runningPhase: 'analyzing',
      completedPhase: 'preview',
      startFn,
      cancelFn,
      errorMessage: 'Task failed',
      idField: 'design_id',
      backendTimeoutSecs: 600,
    }),
  );
  return { hook, startFn, cancelFn };
}

function renderTracedTask(startFn: () => Promise<unknown>, extra: { errorMessage?: string; traceLabel?: string } = {}) {
  const cancelFn = vi.fn(async () => {});
  const hook = renderHook(() =>
    useAiArtifactTask<[], Record<string, unknown>>({
      progressEvent: 'task-progress',
      statusEvent: 'task-status',
      runningPhase: 'analyzing',
      completedPhase: 'preview',
      startFn,
      cancelFn,
      errorMessage: extra.errorMessage ?? 'Task failed',
      traceLabel: extra.traceLabel,
      traceOperation: 'credential_design',
    }),
  );
  return hook;
}

const rootError = (t: { spans: Array<{ error: string | null }> }) =>
  t.spans.map((s) => s.error).find((e) => e) ?? null;

beforeEach(() => {
  __resetSystemTracesForTests();
  listenerMap.clear();
  mockListen.mockClear();
  mockStartNegotiation.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAiArtifactTask', () => {
  it('case 5: the watchdog cancels the backend job once and reports a timeout', async () => {
    vi.useFakeTimers();
    const { hook, cancelFn } = renderTask();
    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.phase).toBe('analyzing');

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(hook.result.current.errorKind).toBe('timeout');
    expect(hook.result.current.phase).toBe('error');
  });

  it("a foreign run's result never lands; its takeover ends ours as superseded", async () => {
    const { hook } = renderTask();
    await act(async () => {
      await hook.result.current.start();
    });

    emit('task-status', { design_id: 'B', status: 'analyzing', result: null, error: null });
    emit('task-progress', { design_id: 'A', line: 'from A' });
    emit('task-status', { design_id: 'A', status: 'completed', result: { from: 'A' }, error: null });
    expect(hook.result.current.phase).toBe('analyzing');
    expect(hook.result.current.result).toBeNull();
    expect(hook.result.current.lines).toEqual([]);

    emit('task-status', { design_id: 'C', status: 'analyzing', result: null, error: null });
    expect(hook.result.current.phase).toBe('error');
    expect(hook.result.current.errorKind).toBe('superseded');
    expect(hook.result.current.error).toBe('SUPERSEDED');
  });

  it('our own completed status still lands as the result', async () => {
    const { hook } = renderTask();
    await act(async () => {
      await hook.result.current.start();
    });
    emit('task-progress', { design_id: 'B', line: 'mine' });
    emit('task-status', { design_id: 'B', status: 'completed', result: { from: 'B' }, error: null });
    expect(hook.result.current.phase).toBe('preview');
    expect(hook.result.current.result).toEqual({ from: 'B' });
    expect(hook.result.current.lines).toEqual(['mine']);
    expect(hook.result.current.errorKind).toBeNull();
  });

  it('[guard] cancel() then a late completed status of our run is ignored', async () => {
    const { hook } = renderTask();
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => hook.result.current.cancel());
    emit('task-status', { design_id: 'B', status: 'completed', result: { late: true }, error: null });
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.result).toBeNull();
  });
});

describe('useAiArtifactTask trace outcomes', () => {
  it('a backend start rejection closes the trace as a failure', async () => {
    const hook = renderTracedTask(async () => {
      throw new Error('CLI missing');
    });
    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.errorKind).toBe('start');
    expect(getActiveSessions()).toHaveLength(0);
    const traces = getCompletedTraces();
    expect(traces).toHaveLength(1);
    expect(rootError(traces[0]!)).toBe('start');
    expect(traces[0]!.abandoned).toBeUndefined();
  });

  it('a user cancel closes the trace without an error', async () => {
    const hook = renderTracedTask(async () => ({}));
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => hook.result.current.cancel());
    const traces = getCompletedTraces();
    expect(traces).toHaveLength(1);
    expect(rootError(traces[0]!)).toBeNull();
    expect(traces[0]!.abandoned).toBe(true);
  });

  it('restarting over a live run closes the superseded trace without an error', async () => {
    const hook = renderTracedTask(async () => ({}));
    await act(async () => {
      await hook.result.current.start();
    });
    await act(async () => {
      await hook.result.current.start();
    });
    const traces = getCompletedTraces();
    expect(traces).toHaveLength(1);
    expect(rootError(traces[0]!)).toBeNull();
  });
});

describe('useAiArtifactTask trace labels', () => {
  const labelOf = async (extra: { errorMessage?: string; traceLabel?: string }) => {
    __resetSystemTracesForTests();
    const hook = renderTracedTask(async () => ({}), extra);
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => hook.result.current.cancel());
    return getCompletedTraces()[0]!.label;
  };

  it('an explicit traceLabel names the trace', async () => {
    expect(await labelOf({ errorMessage: 'Failed to generate recipe', traceLabel: 'Recipe generation' })).toBe('Recipe generation');
  });

  it('without one, a "Failed to ..." error sentence never becomes the name', async () => {
    expect(await labelOf({ errorMessage: 'Failed to generate recipe' })).toBe('Generate recipe');
    expect(await labelOf({ errorMessage: 'Automation design failed' })).toBe('Automation design');
  });
});

describe('useCredentialNegotiator', () => {
  it('[guard] a playbook hit lands on guiding with no backend start and no listener', async () => {
    const hook = renderHook(() => useCredentialNegotiator());
    await act(async () => {
      await hook.result.current.start(
        'Acme',
        { name: 'acme', label: 'Acme', category: 'x', color: '#000', fields: [], healthcheck_config: null, services: [], events: [] },
        [],
      );
    });
    expect(hook.result.current.phase).toBe('guiding');
    expect(hook.result.current.plan).toEqual(cachedPlan);
    expect(mockStartNegotiation).not.toHaveBeenCalled();
    expect(mockListen).not.toHaveBeenCalled();
  });
});
