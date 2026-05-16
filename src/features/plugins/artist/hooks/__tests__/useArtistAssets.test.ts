import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mockInvokeMap, resetInvokeMocks } from '@/test/tauriMock';
import type { ArtistAsset } from '@/api/artist';

// Bypass the IPC-token wait in tauriInvoke.ts — without this, _invokeCore
// stalls up to 2s per call waiting on globalThis.__IPC_TOKEN before firing
// the underlying mock, well beyond the default waitFor timeout.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// Mock the system store so the hook reads a controllable artistFolder and
// setArtistFolder. The mock factory returns a `useSystemStore` whose call
// shape mirrors zustand selectors (state) => slice.
const setArtistFolder = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ artistFolder: '/test/artist', setArtistFolder }),
}));

import { useArtistAssets } from '../useArtistAssets';

function makeAsset(id: string, fileName = `${id}.png`): ArtistAsset {
  return {
    id,
    fileName,
    filePath: `/test/artist/${fileName}`,
    assetType: '2d',
    mimeType: 'image/png',
    fileSize: 100,
    width: 100,
    height: 100,
    thumbnailPath: null,
    tags: null,
    source: null,
    createdAt: '2026-05-16T12:00:00Z',
  };
}

beforeEach(() => {
  resetInvokeMocks();
  setArtistFolder.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useArtistAssets', () => {
  it('loads assets from artistListAssets on mount', async () => {
    const assets = [makeAsset('a'), makeAsset('b')];
    mockInvokeMap({ artist_list_assets: assets });

    const { result } = renderHook(() => useArtistAssets());

    await waitFor(() => expect(result.current.assets).toHaveLength(2));
    expect(result.current.assets.map((a) => a.id)).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('removes an asset from local state when deleteAsset succeeds', async () => {
    const assets = [makeAsset('a'), makeAsset('b'), makeAsset('c')];
    mockInvokeMap({
      artist_list_assets: assets,
      artist_delete_asset: true,
    });

    const { result } = renderHook(() => useArtistAssets());
    await waitFor(() => expect(result.current.assets).toHaveLength(3));

    await act(async () => {
      await result.current.deleteAsset('b');
    });

    expect(result.current.assets.map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('replaces the updated row in local state when updateTags succeeds', async () => {
    const assets = [makeAsset('a'), makeAsset('b')];
    const updated = { ...assets[1], tags: 'forest, sunset' };
    mockInvokeMap({
      artist_list_assets: assets,
      artist_update_tags: updated,
    });

    const { result } = renderHook(() => useArtistAssets());
    await waitFor(() => expect(result.current.assets).toHaveLength(2));

    await act(async () => {
      await result.current.updateTags('b', 'forest, sunset');
    });

    expect(result.current.assets[1]?.tags).toBe('forest, sunset');
    expect(result.current.assets[0]?.tags).toBeNull();
  });

  it('replaces the renamed row in local state when renameAsset succeeds', async () => {
    const assets = [makeAsset('a', 'old-name.png'), makeAsset('b')];
    const renamed = { ...assets[0], fileName: 'forest-keyframe.png', filePath: '/test/artist/forest-keyframe.png' };
    mockInvokeMap({
      artist_list_assets: assets,
      artist_rename_asset: renamed,
    });

    const { result } = renderHook(() => useArtistAssets());
    await waitFor(() => expect(result.current.assets).toHaveLength(2));

    await act(async () => {
      await result.current.renameAsset('a', 'forest-keyframe');
    });

    expect(result.current.assets[0]?.fileName).toBe('forest-keyframe.png');
    expect(result.current.assets[0]?.filePath).toBe('/test/artist/forest-keyframe.png');
    expect(result.current.assets[1]?.fileName).toBe('b.png');
  });

  it('does not mutate local state when delete fails', async () => {
    const assets = [makeAsset('a'), makeAsset('b')];
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'artist_list_assets') return assets;
      if (cmd === 'artist_delete_asset') throw new Error('Delete failed');
      return undefined;
    });

    const { result } = renderHook(() => useArtistAssets());
    await waitFor(() => expect(result.current.assets).toHaveLength(2));

    await act(async () => {
      await result.current.deleteAsset('a');
    });

    // toastCatch swallows the error, but local state is unchanged.
    expect(result.current.assets).toHaveLength(2);
  });
});
