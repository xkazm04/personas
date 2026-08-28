import { beforeEach, describe, expect, it } from 'vitest';
import { useStudioHistory, type StudioHistoryEntry } from '../studioHistory';

// The persisted Studio history had no reaper. `save` bounded the MESSAGES inside
// one project, and nothing bounded the projects: an entry was written for every
// project ever opened and removed for none, and `openTabIds` kept the id of a
// project that had since been deleted — so `rehydrate` re-walked the same dead
// tab on every launch, forever. These pin the reaper on both axes.

const entry = (updatedAt: number): StudioHistoryEntry => ({
  phases: [],
  messages: [],
  reply: null,
  question: null,
  options: [],
  updatedAt,
});

const seed = (byProject: Record<string, StudioHistoryEntry>, openTabIds: string[], activeTabId: string | null) =>
  useStudioHistory.setState({ byProject, openTabIds, activeTabId });

describe('useStudioHistory.prune', () => {
  beforeEach(() => {
    seed({}, [], null);
  });

  it('drops history for a project that no longer exists', () => {
    seed({ alive: entry(2), deleted: entry(1) }, [], null);

    useStudioHistory.getState().prune(['alive']);

    expect(Object.keys(useStudioHistory.getState().byProject)).toEqual(['alive']);
  });

  it('drops the stale tab id rehydrate used to re-walk on every launch', () => {
    seed({ alive: entry(1) }, ['alive', 'deleted'], 'deleted');

    useStudioHistory.getState().prune(['alive']);

    const s = useStudioHistory.getState();
    expect(s.openTabIds).toEqual(['alive']);
    // The active tab pointed at the project that is gone; it must land on a tab
    // that still exists rather than on an id nothing can resolve.
    expect(s.activeTabId).toBe('alive');
  });

  it('caps the surviving projects at the most recently worked', () => {
    const byProject: Record<string, StudioHistoryEntry> = {};
    for (let i = 0; i < 30; i += 1) byProject[`p${i}`] = entry(i);
    seed(byProject, [], null);

    useStudioHistory.getState().prune(Object.keys(byProject));

    const kept = Object.keys(useStudioHistory.getState().byProject);
    expect(kept).toHaveLength(24);
    // Newest survive, oldest are dropped — the same ordering the picker's
    // "Resume" list already uses.
    expect(kept).toContain('p29');
    expect(kept).not.toContain('p0');
  });

  it('is a no-op when nothing is stale', () => {
    const before = { alive: entry(1) };
    seed(before, ['alive'], 'alive');
    const snapshot = useStudioHistory.getState().byProject;

    useStudioHistory.getState().prune(['alive']);

    // Same object identity: a prune on every project-list load must not churn
    // localStorage or re-render subscribers when there is nothing to remove.
    expect(useStudioHistory.getState().byProject).toBe(snapshot);
  });

  it('still bounds the message log per project', () => {
    useStudioHistory.getState().save('p', {
      ...entry(1),
      messages: Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, text: 't', ts: i })),
    });

    expect(useStudioHistory.getState().byProject.p?.messages).toHaveLength(60);
  });
});
