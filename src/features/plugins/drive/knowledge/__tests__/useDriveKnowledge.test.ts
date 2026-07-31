/**
 * Unit tests for useDriveKnowledge's build-gate probe.
 *
 * `available` is feature-detected by calling `listKnowledgeBases()` once on
 * mount: on the default (`desktop`) build the whole `vector_kb` command
 * module doesn't exist, so the invoke rejects with Tauri's "command not
 * found" shape — that, and only that, means "no KB lane in this build".
 * A different failure (a real backend error on an ML build) must not be
 * folded into the same silent "unavailable" bucket without at least a
 * breadcrumb — see `isCommandNotFound` in `@/lib/utils/tauri/safeInvoke`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const silentCatchSpy = vi.fn();
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: (context: string) => (err: unknown) => silentCatchSpy(context, err),
}));

vi.mock('@/api/drive', () => ({
  driveGetRoot: vi.fn(),
}));

vi.mock('@/api/vault/database/vectorKb', () => ({
  createKnowledgeBase: vi.fn(),
  kbIngestDirectory: vi.fn(),
  kbIngestFiles: vi.fn(),
  listKnowledgeBases: vi.fn(),
}));

import * as vectorKb from '@/api/vault/database/vectorKb';
import { useDriveKnowledge } from '../useDriveKnowledge';

describe('useDriveKnowledge — build-gate probe', () => {
  beforeEach(() => {
    vi.mocked(vectorKb.listKnowledgeBases).mockReset();
    silentCatchSpy.mockClear();
  });

  it('marks the lane unavailable, silently, when the command is genuinely not registered (lite build)', async () => {
    vi.mocked(vectorKb.listKnowledgeBases).mockRejectedValue(
      new Error('Command "list_knowledge_bases" not found'),
    );

    const { result } = renderHook(() => useDriveKnowledge());

    await waitFor(() => expect(result.current.available).toBe(false));
    expect(silentCatchSpy).not.toHaveBeenCalled();
  });

  it('still marks the lane unavailable but records a breadcrumb on a genuine backend failure (ML build)', async () => {
    vi.mocked(vectorKb.listKnowledgeBases).mockRejectedValue(
      new Error('database is locked'),
    );

    const { result } = renderHook(() => useDriveKnowledge());

    await waitFor(() => expect(result.current.available).toBe(false));
    expect(silentCatchSpy).toHaveBeenCalledTimes(1);
    expect(silentCatchSpy.mock.calls[0][0]).toBe('drive:knowledge:refresh');
  });

  it('marks the lane available when the probe succeeds', async () => {
    vi.mocked(vectorKb.listKnowledgeBases).mockResolvedValue([]);

    const { result } = renderHook(() => useDriveKnowledge());

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(silentCatchSpy).not.toHaveBeenCalled();
  });
});
