import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { AdoptedTeamPresetResult } from '@/lib/bindings/AdoptedTeamPresetResult';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ addToast }),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel({ setSidebarSection: vi.fn() }), {
    getState: () => ({ setSidebarSection: vi.fn(), setTeamsTab: vi.fn() }),
  }),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ fetchPersonas: async () => {} }),
}));
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel({ fetchTeams: async () => {} }), {
    getState: () => ({ selectTeam: vi.fn() }),
  }),
}));
vi.mock('@/hooks/useTauriEvent', () => ({ useTypedTauriEvent: () => {} }));
vi.mock('@/api/pipeline/teams', () => ({ repairTeamHandoff: vi.fn() }));

const adoptTeamPreset = vi.fn();
const retryTeamPresetMembers = vi.fn();
vi.mock('@/api/templates/teamPresets', () => ({
  adoptTeamPreset: (...a: unknown[]) => adoptTeamPreset(...a),
  retryTeamPresetMembers: (...a: unknown[]) => retryTeamPresetMembers(...a),
  getPresetAdoptionSchema: async () => null,
}));

import { usePresetAdoption } from '../usePresetAdoption';

const preset = {
  id: 'p1',
  name: 'Desk',
  members: [
    { role: 'lead', template_id: 'tpl-lead', x: 0, y: 0 },
    { role: 'scout', template_id: 'tpl-scout', x: 1, y: 1 },
  ],
  connections: [],
} as TeamPreset;

const partial = {
  team_id: 'team-1',
  home_team_id: null,
  members: [{ role: 'lead' }],
  failed_members: [{ role: 'scout', reason: 'template missing' }],
  handoff_wired: true,
} as AdoptedTeamPresetResult;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function adoptedWithOneFailure() {
  adoptTeamPreset.mockResolvedValue(partial);
  const hook = renderHook(() => usePresetAdoption(preset));
  await act(async () => { await hook.result.current.adopt(); });
  await waitFor(() => expect(hook.result.current.stage).toBe('done'));
  expect(hook.result.current.rows.find((r) => r.role === 'scout')?.status).toBe('failed');
  return hook;
}

describe('usePresetAdoption retry', () => {
  beforeEach(() => {
    adoptTeamPreset.mockReset();
    retryTeamPresetMembers.mockReset();
    addToast.mockClear();
  });

  it('shows a retried row as adopting while the retry runs, not as the old failure', async () => {
    const hook = await adoptedWithOneFailure();
    const pending = deferred<AdoptedTeamPresetResult>();
    retryTeamPresetMembers.mockReturnValue(pending.promise);

    let run!: Promise<void>;
    act(() => { run = hook.result.current.retry(); });

    expect(hook.result.current.retrying).toBe(true);
    expect(hook.result.current.rows.find((r) => r.role === 'scout')?.status).toBe('adopting');

    await act(async () => {
      pending.resolve({ ...partial, members: [{ role: 'lead' }, { role: 'scout' }], failed_members: [] } as AdoptedTeamPresetResult);
      await run;
    });
    expect(hook.result.current.retrying).toBe(false);
  });

  it('drops a second press while a retry is in flight', async () => {
    const hook = await adoptedWithOneFailure();
    const pending = deferred<AdoptedTeamPresetResult>();
    retryTeamPresetMembers.mockReturnValue(pending.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.result.current.retry();
      second = hook.result.current.retry();
    });
    await act(async () => {
      pending.resolve({ ...partial, failed_members: [] } as AdoptedTeamPresetResult);
      await Promise.all([first, second]);
    });
    expect(retryTeamPresetMembers).toHaveBeenCalledTimes(1);
  });
});
