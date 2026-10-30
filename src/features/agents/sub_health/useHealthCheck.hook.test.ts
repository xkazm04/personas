/**
 * Behavioural tests for the `useHealthCheck` hook itself (the pure helpers are
 * covered in `useHealthCheck.test.ts`, the shared definition in
 * `healthDefinition.test.ts`). Uses the REAL agent and overview stores so the
 * selected-persona subscription is exercised, and stubs only the doors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';

vi.mock('@/api/pipeline/triggers', () => ({
  getPersonaConfigWarnings: vi.fn().mockResolvedValue([]),
}));
// Hoisted: the i18n module calls silentCatch while it is being imported, which
// happens before a plain top-level const would be initialised.
const { mockSilentCatch } = vi.hoisted(() => ({ mockSilentCatch: vi.fn((_scope: string) => vi.fn()) }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: (scope: string) => mockSilentCatch(scope),
}));

import { useHealthCheck } from './useHealthCheck';

const personaA = { id: 'persona-A', name: 'A', icon: null, color: null } as unknown as Persona;
const personaB = { id: 'persona-B', name: 'B', icon: null, color: null } as unknown as Persona;

function signal(personaId: string, over: Partial<PersonaHealthSignal> = {}): PersonaHealthSignal {
  return {
    personaId, rollbackCount: 0, budgetRatio: 0, projectedExhaustionDays: null, healingFrequency: 0,
    failureTrend: 'stable', successRate: 100, successRateSource: 'executions', totalExecutions: 10,
    recentExecutions: 5, predictedFailureInDays: null, avgLatencyMs: 100, ...over,
  } as unknown as PersonaHealthSignal;
}

const mockRefresh = vi.fn();

function select(persona: Persona | null) {
  // The slice's `selectedPersona` is a PersonaWithDetails; the hook only reads `.id`.
  act(() => {
    useAgentStore.setState({ selectedPersona: persona as never });
  });
}

beforeEach(() => {
  mockRefresh.mockReset().mockResolvedValue(undefined);
  useOverviewStore.setState({
    refreshHealthDashboard: () => mockRefresh(),
    healthSignals: [signal('persona-A'), signal('persona-B')],
    healthHealingIssues: [],
    healthError: null,
  } as never);
  mockSilentCatch.mockClear();
  select(null);
});

describe('useHealthCheck — a failed check leaves a trace', () => {
  it('routes a telemetry-pipeline failure through silentCatch as well as into phase/error', async () => {
    select(personaA);
    mockRefresh.mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('ipc down');
    expect(mockSilentCatch).toHaveBeenCalledWith('useHealthCheck:run');
  });

  it('reads the message out of a serialized AppError, the shape invokeWithTimeout really rejects with', async () => {
    select(personaA);
    mockRefresh.mockRejectedValueOnce({ error: 'dashboard door unreachable', kind: 'Internal' });
    const { result } = renderHook(() => useHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('dashboard door unreachable');
  });
});

describe('useHealthCheck — latest run wins', () => {
  it('drops a slower earlier run that resolves after a newer one', async () => {
    select(personaA);
    let releaseFirst: () => void = () => {};
    mockRefresh
      .mockImplementationOnce(() => new Promise<void>((r) => { releaseFirst = r; }))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useHealthCheck());

    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = result.current.runHealthCheck(personaA);
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.result?.result.status).toBe('ready');

    // The slow run resolves against telemetry that now says the agent broke.
    useOverviewStore.setState({ healthSignals: [signal('persona-A', { rollbackCount: 3 })] } as never);
    await act(async () => {
      releaseFirst();
      await first;
    });
    expect(await first).toBeNull();
    expect(result.current.result?.result.status).toBe('ready');
  });
});

describe('useHealthCheck — verdict is scoped to the selected persona', () => {
  it('presents idle when the app selects a different persona than the one checked', async () => {
    select(personaA);
    const { result } = renderHook(() => useHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.result?.personaId).toBe('persona-A');
    expect(result.current.score).not.toBeNull();

    // The consumer's component tree is not keyed by persona: same hook
    // instance, new selection. A's verdict must not be painted under B.
    select(personaB);
    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.score).toBeNull();
    expect(result.current.error).toBeNull();

    // Switching back restores A's verdict — it was hidden, not discarded.
    select(personaA);
    expect(result.current.phase).toBe('done');
    expect(result.current.result?.personaId).toBe('persona-A');
  });

  it('shows the new persona\'s verdict once a check runs for it', async () => {
    select(personaA);
    const { result } = renderHook(() => useHealthCheck());
    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });

    select(personaB);
    await act(async () => {
      await result.current.runHealthCheck(personaB);
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.result?.personaId).toBe('persona-B');
  });

  it('is unaffected by selection while nothing has been checked yet', () => {
    select(personaA);
    const { result } = renderHook(() => useHealthCheck());
    select(personaB);
    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
  });
});
