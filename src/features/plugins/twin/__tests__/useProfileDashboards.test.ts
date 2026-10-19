import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';

const listTones = vi.fn();
const listChannels = vi.fn();
const listPendingMemories = vi.fn();
vi.mock('@/api/twin/twin', () => ({
  listTones: (id: string) => listTones(id),
  listChannels: (id: string) => listChannels(id),
  listPendingMemories: (id: string, status: string) => listPendingMemories(id, status),
}));

import { useProfileDashboards } from '../useProfileDashboards';

function profile(id: string): TwinProfile {
  // Test fixture: only the fields deriveReadiness reads.
  return { id, name: id, slug: id, bio: null } as TwinProfile;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useProfileDashboards', () => {
  beforeEach(() => {
    listTones.mockReset();
    listChannels.mockReset();
    listPendingMemories.mockReset();
  });

  it('settles every card when the profile list is replaced (same ids) while loads are in flight', async () => {
    const tones = deferred<unknown[]>();
    listTones.mockReturnValueOnce(tones.promise).mockResolvedValue([]);
    listChannels.mockResolvedValue([]);
    listPendingMemories.mockResolvedValue([]);

    // TwinPage and ProfilesAtelier both call fetchTwinProfiles on mount, so the
    // list arrives twice: same ids, new array identity.
    const { result, rerender } = renderHook(({ list }) => useProfileDashboards(list), {
      initialProps: { list: [profile('a')] },
    });
    expect(result.current.a?.loading).toBe(true);

    rerender({ list: [profile('a')] });
    await act(async () => { tones.resolve([]); });

    await waitFor(() => expect(result.current.a?.loading).toBe(false));
  });
});
