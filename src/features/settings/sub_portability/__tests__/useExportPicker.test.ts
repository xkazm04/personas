import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported.
// ---------------------------------------------------------------------------

const twinA = {
  id: 'twin-a',
  name: 'Founder Twin',
  slug: 'founder-twin',
  bio: null,
  role: 'Founder',
  languages: null,
  pronouns: null,
  obsidian_subpath: 'personas/twins/founder-twin',
  is_active: true,
  knowledge_base_id: 'kb-1',
  training_directives: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const twinB = { ...twinA, id: 'twin-b', name: 'Community Twin', slug: 'community-twin', is_active: false, knowledge_base_id: null };

const mockStats = {
  personaCount: 1,
  toolCount: 0,
  teamCount: 0,
  credentialCount: 0,
  memoryCount: 0,
  teamMemoryCount: 0,
  testSuiteCount: 0,
  kpiCount: 0,
  devProjectCount: 0,
  workspaceKnowledgeCount: 0,
  twinCount: 2,
  athenaCoreCount: 12,
  athenaLearnedCount: 34,
  warnings: [] as string[],
};

const getExportStats = vi.fn(async () => mockStats);
const listTwinProfiles = vi.fn(async () => [twinA, twinB]);
const listDistilledFacts = vi.fn(async (twinId: string) => (twinId === 'twin-a' ? [{}, {}, {}] : []));

vi.mock('@/api/agents/personas', () => ({
  listPersonas: vi.fn(async () => [
    { id: 'p1', name: 'Alpha', enabled: true, starred: false, description: null, model_profile: null, trust_score: 50, icon: null, color: null },
  ]),
}));
vi.mock('@/api/vault/credentials', () => ({ listCredentials: vi.fn(async () => []) }));
vi.mock('@/api/pipeline/teams', () => ({
  listTeams: vi.fn(async () => []),
  listTeamMembers: vi.fn(async () => []),
}));
vi.mock('@/api/devTools/kpis', () => ({ listAllKpis: vi.fn(async () => []) }));
vi.mock('@/api/devTools/devTools', () => ({ listProjects: vi.fn(async () => []) }));
vi.mock('@/api/devTools/workspaces', () => ({ listWorkspaces: vi.fn(async () => []) }));
vi.mock('@/api/twin/twin', () => ({
  listProfiles: (...a: unknown[]) => listTwinProfiles(...(a as [])),
  listDistilledFacts: (id: string) => listDistilledFacts(id),
}));
vi.mock('@/api/system/dataPortability', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getExportStats: () => getExportStats(),
}));

import { useExportPicker } from '../components/export-prototype/useExportPicker';
import { ENCRYPTED_SCOPES, type ExportKind } from '../components/export-prototype/types';

const ALL_SCOPES: ExportKind[] = [
  'personas',
  'teams',
  'credentials',
  'projects',
  'knowledge',
  'twins',
  'athena',
];

async function mountPicker(onExport = vi.fn()) {
  const hook = renderHook(() => useExportPicker(true, onExport));
  await waitFor(() => expect(hook.result.current.inv.loading).toBe(false));
  return { hook, onExport };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExportPicker — twins + Athena scopes', () => {
  it('exposes counts for all seven scopes', async () => {
    const { hook } = await mountPicker();
    expect(Object.keys(hook.result.current.counts).sort()).toEqual([...ALL_SCOPES].sort());
    expect(hook.result.current.counts.twins.total).toBe(2);
    // Both Athena tiers have data in the fixture, so both become rows.
    expect(hook.result.current.counts.athena.total).toBe(2);
    expect(hook.result.current.inv.athenaTiers.map((t) => t.id)).toEqual(['core', 'learned']);
    expect(hook.result.current.inv.athenaTiers[0]?.count).toBe(12);
    expect(hook.result.current.inv.athenaTiers[1]?.count).toBe(34);
  });

  it('leaves the encrypted scopes unselected on open so the default export is not blocked', async () => {
    const { hook } = await mountPicker();
    expect(hook.result.current.counts.personas.selected).toBe(1);
    for (const k of ENCRYPTED_SCOPES) expect(hook.result.current.counts[k].selected).toBe(0);
    expect(hook.result.current.passphraseRequired).toBe(false);
    expect(hook.result.current.passphraseMissing).toBe(false);
  });

  it('routes each scope to its own selection set (no cross-scope leakage)', async () => {
    const { hook } = await mountPicker();
    act(() => hook.result.current.toggle('twins', 'twin-a'));
    act(() => hook.result.current.toggle('athena', 'learned'));

    expect(hook.result.current.isSelected('twins', 'twin-a')).toBe(true);
    expect(hook.result.current.isSelected('athena', 'twin-a')).toBe(false);
    expect(hook.result.current.isSelected('knowledge', 'twin-a')).toBe(false);
    expect(hook.result.current.selectedTwins.has('twin-a')).toBe(true);
    expect(hook.result.current.selectedAthenaTiers.has('learned')).toBe(true);
    expect(hook.result.current.selectedWorkspaces.size).toBe(0);
  });

  it('select-all / clear-all covers every scope', async () => {
    const { hook } = await mountPicker();
    act(() => {
      for (const k of ALL_SCOPES) hook.result.current.setMany(k, hook.result.current.allIds[k], true);
    });
    expect(hook.result.current.isFullExport).toBe(true);
    expect(hook.result.current.totalSelected).toBe(hook.result.current.totalItems);

    act(() => {
      for (const k of ALL_SCOPES) hook.result.current.setMany(k, hook.result.current.allIds[k], false);
    });
    expect(hook.result.current.totalSelected).toBe(0);
    expect(hook.result.current.isFullExport).toBe(false);
  });

  it('requires a passphrase once an encrypted scope is selected', async () => {
    const { hook } = await mountPicker();
    act(() => hook.result.current.toggle('twins', 'twin-a'));
    expect(hook.result.current.passphraseRequired).toBe(true);
    expect(hook.result.current.passphraseMissing).toBe(true);

    act(() => hook.result.current.setPassphrase('short'));
    expect(hook.result.current.passphraseMissing).toBe(true);

    act(() => hook.result.current.setPassphrase('long-enough-passphrase'));
    expect(hook.result.current.passphraseMissing).toBe(false);
  });

  it('the Athena scope alone also trips the passphrase gate', async () => {
    const { hook } = await mountPicker();
    act(() => hook.result.current.toggle('athena', 'core'));
    expect(hook.result.current.passphraseRequired).toBe(true);
    expect(hook.result.current.passphraseMissing).toBe(true);
  });

  it('commits ONE options object carrying every scope', async () => {
    const { hook, onExport } = await mountPicker();
    act(() => hook.result.current.toggle('twins', 'twin-b'));
    act(() => hook.result.current.toggle('athena', 'core'));
    act(() => hook.result.current.setPassphrase('long-enough-passphrase'));
    act(() => hook.result.current.commit());

    expect(onExport).toHaveBeenCalledTimes(1);
    const args = onExport.mock.calls[0]![0];
    expect(args).toEqual({
      personaIds: ['p1'],
      teamIds: [],
      credentialIds: [],
      projectIds: [],
      workspaceIds: [],
      twinIds: ['twin-b'],
      athenaTiers: ['core'],
      includeMemories: true,
      includeKpis: true,
      passphrase: 'long-enough-passphrase',
    });
  });

  it('drops a passphrase shorter than 8 characters from the commit payload', async () => {
    const { hook, onExport } = await mountPicker();
    act(() => hook.result.current.setPassphrase('abc'));
    act(() => hook.result.current.commit());
    expect(onExport.mock.calls[0]![0].passphrase).toBeUndefined();
  });

  it('counts distilled facts per twin', async () => {
    const { hook } = await mountPicker();
    expect(hook.result.current.inv.twinFactCount.get('twin-a')).toBe(3);
    expect(hook.result.current.inv.twinFactCount.get('twin-b')).toBe(0);
  });
});

describe('useExportPicker — empty Athena memory', () => {
  it('drops zero-count tiers so "export everything" stays reachable', async () => {
    getExportStats.mockResolvedValueOnce({ ...mockStats, athenaCoreCount: 0, athenaLearnedCount: 0 });
    const { hook } = await mountPicker();
    expect(hook.result.current.inv.athenaTiers).toEqual([]);
    expect(hook.result.current.counts.athena.total).toBe(0);
  });

  it('keeps only the tier that has data', async () => {
    getExportStats.mockResolvedValueOnce({ ...mockStats, athenaCoreCount: 0, athenaLearnedCount: 7 });
    const { hook } = await mountPicker();
    expect(hook.result.current.inv.athenaTiers).toEqual([{ id: 'learned', count: 7 }]);
  });
});

describe('useExportPicker — degraded backend', () => {
  it('survives a stats failure with an empty Athena scope', async () => {
    getExportStats.mockRejectedValueOnce(new Error('boom'));
    const { hook } = await mountPicker();
    expect(hook.result.current.inv.athenaTiers).toEqual([]);
    expect(hook.result.current.counts.twins.total).toBe(2);
  });

  it('survives a twin-list failure', async () => {
    listTwinProfiles.mockRejectedValueOnce(new Error('boom'));
    const { hook } = await mountPicker();
    expect(hook.result.current.counts.twins.total).toBe(0);
  });
});
