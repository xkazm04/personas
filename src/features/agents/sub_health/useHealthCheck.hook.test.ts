/**
 * Behavioural tests for the `useHealthCheck` hook itself (the pure helpers are
 * covered in `useHealthCheck.test.ts`). Uses the REAL agent store so the
 * selected-persona subscription is exercised, and mocks only the IPC doors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import { useAgentStore } from '@/stores/agentStore';

const mockFeasibility = vi.fn();
vi.mock('@/api/design/design', () => ({
  testDesignFeasibility: (...args: unknown[]) => mockFeasibility(...args),
}));
vi.mock('@/api/pipeline/triggers', () => ({
  getPersonaConfigWarnings: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ credentials: [] }) },
}));
// Hoisted: the i18n module calls silentCatch while it is being imported, which
// happens before a plain top-level const would be initialised.
const { mockSilentCatch } = vi.hoisted(() => ({ mockSilentCatch: vi.fn((_scope: string) => vi.fn()) }));
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: (scope: string) => mockSilentCatch(scope),
}));

import { useHealthCheck } from './useHealthCheck';

const personaA = { id: 'persona-A', name: 'A', icon: null, color: null, design_context: null } as unknown as Persona;
const personaB = { id: 'persona-B', name: 'B', icon: null, color: null, design_context: null } as unknown as Persona;

function select(persona: Persona | null) {
  // The slice's `selectedPersona` is a PersonaWithDetails; the hook only reads `.id`.
  act(() => {
    useAgentStore.setState({ selectedPersona: persona as never });
  });
}

beforeEach(() => {
  mockFeasibility.mockReset();
  mockFeasibility.mockResolvedValue({ overall: 'partial', confirmed_capabilities: [], issues: ['Tool x is not installed'] });
  mockSilentCatch.mockClear();
  select(null);
});

describe('useHealthCheck — a failed check leaves a trace', () => {
  it('routes a feasibility-door failure through silentCatch as well as into phase/error', async () => {
    select(personaA);
    mockFeasibility.mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('ipc down');
    // The badge renders `error` the same as `idle`, so the breadcrumb is the
    // only durable evidence the door threw.
    expect(mockSilentCatch).toHaveBeenCalledWith('useHealthCheck:run');
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
