/**
 * EditorDocument's saveAll CONTRACT, CLAUSE BY CLAUSE.
 *
 * saveAll is what Save & Switch and the leave-section guard trust before they
 * discard the editor state, and its documented contract had no test:
 *   1. tabs save in order and stop at the first failure;
 *   2. tabs saved before the failure are clean, the failed one and the ones
 *      after it stay dirty;
 *   3. the TabSaveError lists failed (incl. never-attempted) and saved tabs;
 *   4. a dirty tab with no registered save is a FAILURE, never "saved" (the
 *      old behaviour marked it clean and the switch toast lied).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EditorDirtyProvider, TabSaveError, useEditorDirty, useEditorDirtyState } from '../EditorDocument';

vi.mock('@/lib/log', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }));

const wrapper = ({ children }: { children: ReactNode }) => <EditorDirtyProvider>{children}</EditorDirtyProvider>;

type Tab = { id: string; save?: () => Promise<void> };

function useHarness(tabs: Tab[]) {
  // Fixed-length list per harness, so the hook call count is stable.
  for (const tab of tabs) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length list per harness
    useEditorDirty(tab.id, true, tab.save);
  }
  return useEditorDirtyState();
}

async function saveAllError(saveAll: () => Promise<void>): Promise<TabSaveError> {
  try {
    await saveAll();
  } catch (err) {
    if (err instanceof TabSaveError) return err;
    throw err;
  }
  throw new Error('saveAll resolved');
}

describe('EditorDocument.saveAll', () => {
  it('stops at the first failure; earlier tabs clean, the rest dirty, both listed', async () => {
    const calls: string[] = [];
    const ok = (id: string) => async () => { calls.push(id); };
    const tabs: Tab[] = [
      { id: 'a', save: ok('a') },
      { id: 'b', save: async () => { calls.push('b'); throw new Error('ipc down'); } },
      { id: 'c', save: ok('c') },
    ];
    const { result } = renderHook(() => useHarness(tabs), { wrapper });

    let err!: TabSaveError;
    await act(async () => { err = await saveAllError(result.current.saveAll); });

    expect(calls).toEqual(['a', 'b']);
    expect(err.savedTabs).toEqual(['a']);
    expect(err.failedTabs).toEqual(['b', 'c']);
    expect(result.current.dirtyTabs).toEqual(['b', 'c']);
    expect(result.current.isDirty).toBe(true);
  });

  it('treats a dirty tab with no registered save as failed, never as saved', async () => {
    const tabs: Tab[] = [{ id: 'a', save: async () => {} }, { id: 'orphan' }];
    const { result } = renderHook(() => useHarness(tabs), { wrapper });

    let err!: TabSaveError;
    await act(async () => { err = await saveAllError(result.current.saveAll); });

    expect(err.failedTabs).toEqual(['orphan']);
    expect(err.savedTabs).toEqual(['a']);
    expect(result.current.dirtyTabs).toEqual(['orphan']);
  });

  it('resolves and leaves every tab clean when all saves land', async () => {
    const tabs: Tab[] = [{ id: 'a', save: async () => {} }, { id: 'b', save: async () => {} }];
    const { result } = renderHook(() => useHarness(tabs), { wrapper });

    await act(async () => { await result.current.saveAll(); });

    expect(result.current.dirtyTabs).toEqual([]);
    expect(result.current.isDirty).toBe(false);
  });
});
