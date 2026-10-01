// A rejected milestone list must be distinguishable from "this id is not in
// the list". The pane reads `loadError`; this file pins the hook that sets it.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { milestone } from '@/lib/milestone/__tests__/shipFixtures';

const api = vi.hoisted(() => ({
  listMilestones: vi.fn(),
  listMilestoneItems: vi.fn(),
  listGoals: vi.fn(),
  memorySkillContextPairs: vi.fn(),
}));

vi.mock('../plan/useShipLive', () => ({ useShipLiveRevision: () => 0 }));

vi.mock('@/features/teams/sub_factory/l2/factoryL2Data', () => ({
  useFactoryL2Data: () => ({
    loading: false,
    project: { id: 'p1', name: 'personas', root_path: '/repo' },
    kpis: [],
    contexts: [],
    groups: [],
    monitoringWired: false,
    llmWired: false,
    runtime: { errorsByContext: new Map() },
    useCaseState: { active: [] },
  }),
  parseStringArray: (value: unknown) => (Array.isArray(value) ? value : []),
}));

vi.mock('@/api/devTools/milestones', () => ({
  listMilestones: api.listMilestones,
  listMilestoneItems: api.listMilestoneItems,
  removeMilestoneItem: vi.fn(),
  setMilestoneItem: vi.fn(),
  updateMilestone: vi.fn(),
}));

vi.mock('@/api/devTools/devTools', () => ({
  listGoals: api.listGoals,
  memorySkillContextPairs: api.memorySkillContextPairs,
}));

import { useProjectPlan } from '../plan/useProjectPlan';

function loadErrorOf(ship: { loadError?: boolean }): boolean | undefined {
  return ship.loadError;
}

describe('useProjectPlan load failure', () => {
  beforeEach(() => {
    api.listMilestones.mockReset();
    api.listMilestoneItems.mockReset();
    api.listGoals.mockReset();
    api.memorySkillContextPairs.mockReset();
    api.listGoals.mockResolvedValue([]);
    api.memorySkillContextPairs.mockResolvedValue([]);
    api.listMilestoneItems.mockResolvedValue([]);
  });

  it('marks a rejected first fetch instead of an empty roadmap', async () => {
    api.listMilestones.mockRejectedValue(new Error('db down'));
    const { result } = renderHook(() => useProjectPlan('p1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(loadErrorOf(result.current)).toBe(true);
    expect(result.current.roadmap).toEqual([]);
  });

  it('keeps the painted roadmap when a later fetch rejects', async () => {
    api.listMilestones.mockResolvedValue([milestone({ id: 'ms-1' })]);
    const { result } = renderHook(() => useProjectPlan('p1'));

    await waitFor(() => {
      expect(result.current.roadmap).toHaveLength(1);
    });
    expect(loadErrorOf(result.current)).toBe(false);

    api.listMilestones.mockRejectedValue(new Error('db down'));
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(loadErrorOf(result.current)).toBe(true);
    });
    expect(result.current.roadmap).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('clears the failure once a later fetch succeeds', async () => {
    api.listMilestones.mockRejectedValueOnce(new Error('db down'));
    const { result } = renderHook(() => useProjectPlan('p1'));

    await waitFor(() => {
      expect(loadErrorOf(result.current)).toBe(true);
    });

    api.listMilestones.mockResolvedValue([milestone({ id: 'ms-1' })]);
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.roadmap).toHaveLength(1);
    });
    expect(loadErrorOf(result.current)).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});
