import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mockInvokeMap, resetInvokeMocks } from '@/test/tauriMock';
import type { Composition } from '../../types';

// Bypass the IPC-token wait in tauriInvoke.ts.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// Mock the plugin-dialog surface so save/open prompts return deterministic
// paths (or null to simulate cancellation).
const saveDialog = vi.fn();
const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => saveDialog(...args),
  open: (...args: unknown[]) => openDialog(...args),
}));

// Mock the system store: capture recordRecent + removeRecent calls.
const recordRecent = vi.fn();
const removeRecent = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      recordMediaStudioRecent: recordRecent,
      removeMediaStudioRecent: removeRecent,
    }),
}));

import { useMediaStudioPersistence } from '../useMediaStudioPersistence';

const COMPOSITION: Composition = {
  id: 'comp-1',
  name: 'Test composition',
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#000000',
  items: [],
};

const SAVE_DIR_AND_EXT = {
  artist_default_save_dir: '/test/saves',
  artist_composition_file_extension: 'mstudio.json',
  artist_save_composition: undefined,
  artist_clear_autosave: undefined,
  artist_load_autosave: null,
  artist_load_composition: { compositionJson: JSON.stringify(COMPOSITION), savedAt: '2026-05-16T12:00:00Z' },
} as const;

beforeEach(() => {
  resetInvokeMocks();
  recordRecent.mockClear();
  removeRecent.mockClear();
  saveDialog.mockReset();
  openDialog.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMediaStudioPersistence — save flow', () => {
  it('writes to the chosen path and records it in recents with the composition name', async () => {
    mockInvokeMap(SAVE_DIR_AND_EXT);
    saveDialog.mockResolvedValue('/test/saves/Test composition.mstudio.json');

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false, // disable autosave noise
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(saveDialog).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith({
      path: '/test/saves/Test composition.mstudio.json',
      name: 'Test composition',
      thumbnailDataUrl: undefined,
    });
    expect(result.current.currentFile).toBe('/test/saves/Test composition.mstudio.json');
    expect(result.current.status).toBe('saved');
  });

  it('records the captured thumbnail when captureThumbnail returns one', async () => {
    mockInvokeMap(SAVE_DIR_AND_EXT);
    saveDialog.mockResolvedValue('/test/saves/comp.mstudio.json');
    const captureThumbnail = vi.fn().mockReturnValue('data:image/jpeg;base64,AAA');

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false,
        captureThumbnail,
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(captureThumbnail).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailDataUrl: 'data:image/jpeg;base64,AAA' }),
    );
  });

  it('does not record a recent when the user cancels the save dialog', async () => {
    mockInvokeMap(SAVE_DIR_AND_EXT);
    saveDialog.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(recordRecent).not.toHaveBeenCalled();
    expect(result.current.currentFile).toBeNull();
  });

  it('falls back to "Untitled" in the recents name when composition.name is empty', async () => {
    mockInvokeMap(SAVE_DIR_AND_EXT);
    saveDialog.mockResolvedValue('/test/saves/x.mstudio.json');

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: { ...COMPOSITION, name: '' },
        replaceComposition: vi.fn(),
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(recordRecent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Untitled' }),
    );
  });
});

describe('useMediaStudioPersistence — load flow', () => {
  it('records the path in recents on successful loadFromPath', async () => {
    mockInvokeMap(SAVE_DIR_AND_EXT);
    const replaceComposition = vi.fn();

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition,
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.loadFromPath('/test/saves/preset.mstudio.json');
    });

    expect(replaceComposition).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith({
      path: '/test/saves/preset.mstudio.json',
      name: 'Test composition',
    });
  });

  it('evicts a dead path from recents when loadFromPath fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'artist_load_autosave') return null;
      if (cmd === 'artist_load_composition') throw new Error('ENOENT');
      return undefined;
    });

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.loadFromPath('/test/saves/missing.mstudio.json');
    });

    expect(removeRecent).toHaveBeenCalledWith('/test/saves/missing.mstudio.json');
    expect(result.current.status).toBe('error');
  });

  it('falls back to "Untitled" in the recents name when loaded composition.name is empty', async () => {
    const compositionWithoutName = { ...COMPOSITION, name: '' };
    mockInvokeMap({
      ...SAVE_DIR_AND_EXT,
      artist_load_composition: {
        compositionJson: JSON.stringify(compositionWithoutName),
        savedAt: '2026-05-16T12:00:00Z',
      },
    });

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.loadFromPath('/test/saves/anon.mstudio.json');
    });

    expect(recordRecent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Untitled' }),
    );
  });
});

describe('useMediaStudioPersistence — restore from autosave', () => {
  it('replaces the composition with the autosave payload on mount', async () => {
    const restored = { ...COMPOSITION, name: 'From autosave' };
    mockInvokeMap({
      ...SAVE_DIR_AND_EXT,
      artist_load_autosave: {
        compositionJson: JSON.stringify(restored),
        savedAt: '2026-05-16T12:00:00Z',
      },
    });
    const replaceComposition = vi.fn();

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition,
        enabled: false,
      }),
    );

    await waitFor(() => expect(replaceComposition).toHaveBeenCalledOnce());
    expect(replaceComposition).toHaveBeenCalledWith(restored);
    expect(result.current.restoredFromAutosave).toBe(true);
  });

  it('dismissRestoreHint flips restoredFromAutosave back to false', async () => {
    mockInvokeMap({
      ...SAVE_DIR_AND_EXT,
      artist_load_autosave: {
        compositionJson: JSON.stringify(COMPOSITION),
        savedAt: '2026-05-16T12:00:00Z',
      },
    });

    const { result } = renderHook(() =>
      useMediaStudioPersistence({
        composition: COMPOSITION,
        replaceComposition: vi.fn(),
        enabled: false,
      }),
    );

    await waitFor(() => expect(result.current.restoredFromAutosave).toBe(true));
    act(() => {
      result.current.dismissRestoreHint();
    });
    expect(result.current.restoredFromAutosave).toBe(false);
  });
});
