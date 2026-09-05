/**
 * A FAILED UNDO STAYS UNDOABLE.
 *
 * The undo entry's restore persisted through IPC, toasted on failure and then
 * RESOLVED, so `EditorDocument.undo()` filed it as done: the entry moved to
 * the redo stack, `canUndo` went false, and disk still held the value the
 * user had just asked to reverse. Pinned here: after a failed restore the
 * entry is still on the undo stack and nothing is on the redo stack.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => {
  const state = {
    selectedPersona: { id: 'p1', name: 'Ada' } as { id: string; name: string } | null,
    applyPersonaOp: vi.fn(async () => {}),
  };
  return { state, addToast: vi.fn() };
});
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign((sel: (s: typeof h.state) => unknown) => sel(h.state), { getState: () => h.state }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: h.addToast }) }),
}));

import { EditorDirtyProvider, useEditorHistory } from '../EditorDocument';
import { useEditorSave } from '../useEditorSave';
import { buildDraft } from '../PersonaDraft';

const wrapper = ({ children }: { children: ReactNode }) => <EditorDirtyProvider>{children}</EditorDirtyProvider>;

beforeEach(() => {
  h.state.applyPersonaOp.mockReset();
  h.state.applyPersonaOp.mockResolvedValue(undefined);
  h.addToast.mockReset();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('useEditorSave undo persistence', () => {
  it('keeps the entry on the undo stack when the restore fails to persist', async () => {
    const baseline = buildDraft({ name: 'Ada', enabled: true });
    const draft = { ...baseline, name: 'Ada Lovelace' };
    const { result } = renderHook(() => {
      const save = useEditorSave({ draft, baseline, setDraft: vi.fn(), setBaseline: vi.fn(), pendingPersonaId: null });
      const history = useEditorHistory();
      return { save, history };
    }, { wrapper });

    // The debounced settings save lands and records the undo entry.
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(h.state.applyPersonaOp).toHaveBeenCalledTimes(1);
    expect(result.current.history.canUndo).toBe(true);

    h.state.applyPersonaOp.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { await result.current.history.undo(); });

    expect(h.addToast).toHaveBeenCalledTimes(1);
    expect(result.current.history.canUndo).toBe(true);
    expect(result.current.history.canRedo).toBe(false);
  });
});
