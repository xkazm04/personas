import { afterEach, describe, expect, it, vi } from 'vitest';

import * as triage from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';

describe('fetchTriageIdeas records a failed first-page read', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sets triageReadError on rejection and clears it on the next read', async () => {
    const spy = vi.spyOn(triage, 'triageIdeas').mockRejectedValueOnce(new Error('database is locked'));
    useSystemStore.setState({ triageItems: [], triageReadError: null });
    await useSystemStore.getState().fetchTriageIdeas(undefined, { status: 'accepted', limit: 100 });
    expect(useSystemStore.getState().triageReadError).toContain('database is locked');
    spy.mockResolvedValueOnce({ ideas: [], cursor: null, hasMore: false, counts: null } as never);
    await useSystemStore.getState().fetchTriageIdeas(undefined, { status: 'accepted', limit: 100 });
    expect(useSystemStore.getState().triageReadError).toBeNull();
  });
});
