import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Regression pin for the stale-async defect in `usePassportData`'s
 * build()/publish() closure: FIVE independent callers (mount, telemetry
 * sweep, rescan, rescanProject, factory-process-complete listener) funnel
 * into one build→publish path with no generation token. `publish()`
 * unconditionally overwrote both the module cache and React state, so
 * whichever call finished LAST won — even if it started before an explicit
 * user-requested rescan. Fixed via a `createLatestWins()` token minted in
 * `build()`; `publish()` now drops the write if a newer build has since
 * started.
 *
 * This test drives the real mount-triggered build() and an explicit
 * rescan() concurrently, resolving the OLDER (mount) fetch after the NEWER
 * (rescan) one, and asserts the older result never lands.
 */
vi.mock('@/api/devTools/devTools', () => ({
  listProjects: vi.fn(),
  getCrossProjectMetadata: vi.fn(),
  generateCrossProjectMetadata: vi.fn(),
  listSkills: vi.fn().mockResolvedValue([]),
  listSkillsGlobal: vi.fn().mockResolvedValue([]),
  probeRepoEvidence: vi.fn().mockResolvedValue(null),
  scanSkillUsage: vi.fn().mockResolvedValue({ exhausted: false }),
  getSkillUsageOverview: vi.fn().mockResolvedValue([]),
  scanDocRot: vi.fn().mockResolvedValue(undefined),
  getDocRotOverview: vi.fn().mockResolvedValue([]),
  scanMemoryHealth: vi.fn().mockResolvedValue(undefined),
  getMemoryHealthOverview: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/vault/credentials', () => ({
  listCredentials: vi.fn().mockResolvedValue([]),
}));

import * as devTools from '@/api/devTools/devTools';
import { usePassportData } from '../usePassportData';

const listProjectsMock = vi.mocked(devTools.listProjects);
const getCrossProjectMetadataMock = vi.mocked(devTools.getCrossProjectMetadata);
const generateCrossProjectMetadataMock = vi.mocked(devTools.generateCrossProjectMetadata);

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function metaMap(generatedAt: string) {
  return { projects: [], relations: [], generated_at: generatedAt } as unknown as ReturnType<
    typeof devTools.getCrossProjectMetadata
  > extends Promise<infer R> ? R : never;
}

describe('usePassportData — stale-build guard', () => {
  beforeEach(() => {
    listProjectsMock.mockReset();
    getCrossProjectMetadataMock.mockReset();
    generateCrossProjectMetadataMock.mockReset();
  });

  it('discards the mount build when it resolves after an explicit rescan', async () => {
    const mountProjects = deferred<never[]>();
    const mountMeta = deferred<ReturnType<typeof metaMap>>();
    // Mount build: regen=false → listProjects() + getCrossProjectMetadata(), both slow.
    listProjectsMock.mockReturnValueOnce(mountProjects.promise as never);
    getCrossProjectMetadataMock.mockReturnValueOnce(mountMeta.promise as never);
    // Rescan build: regen=true → listProjects() + generateCrossProjectMetadata(), both fast.
    listProjectsMock.mockReturnValueOnce(Promise.resolve([]) as never);
    generateCrossProjectMetadataMock.mockReturnValueOnce(Promise.resolve(metaMap('rescan-gen')) as never);

    const { result } = renderHook(() => usePassportData());

    // Mount effect's build(false) is now in flight (awaiting the deferreds above).
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalledTimes(1));

    // Fire an explicit user rescan while the mount build is still pending.
    act(() => {
      result.current.rescan();
    });

    await waitFor(() => expect(result.current.generatedAt).toBe('rescan-gen'));
    expect(result.current.rescanning).toBe(false);

    // The stale mount build finally resolves — it must NOT overwrite the
    // rescan's result.
    await act(async () => {
      mountProjects.resolve([]);
      mountMeta.resolve(metaMap('mount-gen'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.generatedAt).toBe('rescan-gen');
  });
});
