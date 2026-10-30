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
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
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

  it('reads the message out of a serialized AppError, the shape invokeWithTimeout really rejects with', async () => {
    select(personaA);
    mockFeasibility.mockRejectedValueOnce({ error: 'feasibility door unreachable', kind: 'Internal' });
    const { result } = renderHook(() => useHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('feasibility door unreachable');
  });
});

describe('useHealthCheck — latest run wins', () => {
  it('drops a slower earlier run that resolves after a newer one', async () => {
    select(personaA);
    let releaseFirst: (v: unknown) => void = () => {};
    mockFeasibility
      .mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }))
      .mockResolvedValueOnce({ overall: 'ready', confirmed_capabilities: [], issues: [] });
    const { result } = renderHook(() => useHealthCheck());

    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = result.current.runHealthCheck(personaA);
      await result.current.runHealthCheck(personaA);
    });
    expect(result.current.result?.result.status).toBe('ready');

    await act(async () => {
      releaseFirst({ overall: 'blocked', confirmed_capabilities: [], issues: ['Tool x is not installed'] });
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

/**
 * Faithful stand-in for the backend's `check_feasibility`
 * (src-tauri/engine/src/design.rs): it reads ONLY `suggested_tools`,
 * `suggested_connectors`, `suggested_triggers` and `structured_prompt` from the
 * payload actually sent, so a payload lacking them cannot be answered well.
 */
function backendFeasibility(json: string, availableTools: string[] = []) {
  const val = JSON.parse(json) as Record<string, unknown>;
  const confirmed: string[] = [];
  const issues: string[] = [];
  for (const t of (Array.isArray(val.suggested_tools) ? val.suggested_tools : []) as string[]) {
    if (availableTools.includes(t)) confirmed.push(`Tool '${t}' is available`);
    else issues.push(`Tool '${t}' is not installed`);
  }
  if (val.structured_prompt !== undefined && val.structured_prompt !== null) confirmed.push('Structured prompt is defined');
  else issues.push('Missing structured_prompt section');
  const overall = issues.length === 0 ? 'ready' : issues.length <= 2 ? 'partial' : 'blocked';
  return { overall, confirmed_capabilities: confirmed, issues };
}

describe('useHealthCheck - the payload sent to the feasibility door', () => {
  const designed = {
    id: 'persona-D', name: 'D', icon: null, color: null, description: 'd',
    design_context: JSON.stringify({ useCases: [], credentialLinks: {}, summary: 's' }),
    last_design_result: JSON.stringify({
      structured_prompt: { identity: 'x' },
      suggested_tools: ['web_search'],
      suggested_connectors: [],
      suggested_triggers: [],
    }),
    structured_prompt: JSON.stringify({ identity: 'x' }),
  } as unknown as Persona;

  it('sends the keys the backend reads, so a fully designed persona is not scored as missing its prompt', async () => {
    select(designed);
    mockFeasibility.mockImplementation(async (json: string) => backendFeasibility(json, ['web_search']));
    const { result } = renderHook(() => useHealthCheck());
    await act(async () => {
      await result.current.runHealthCheck(designed);
    });
    const sent = JSON.parse(mockFeasibility.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toHaveProperty('structured_prompt');
    expect(sent).toHaveProperty('suggested_tools');
    expect(result.current.result?.result.issues.map((i) => i.description)).not.toContain('Missing structured_prompt section');
    expect(result.current.result?.result.status).toBe('ready');
    expect(result.current.score?.grade).not.toBe('degraded');
  });

  it('falls back to the persona structured_prompt when there is no parseable last_design_result', async () => {
    const p = { ...designed, last_design_result: 'not json' } as unknown as Persona;
    select(p);
    mockFeasibility.mockImplementation(async (json: string) => backendFeasibility(json));
    const { result } = renderHook(() => useHealthCheck());
    await act(async () => {
      await result.current.runHealthCheck(p);
    });
    const sent = JSON.parse(mockFeasibility.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent.structured_prompt).toEqual({ identity: 'x' });
    expect(result.current.result?.result.status).toBe('ready');
  });
});
