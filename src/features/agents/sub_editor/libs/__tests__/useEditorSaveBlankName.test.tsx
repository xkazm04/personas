/**
 * AN UNSAVEABLE SETTINGS DRAFT IS REPORTED AS FAILED, NEVER AS SAVED.
 *
 * performSettingsSave returned early for a blank name, so the promise resolved
 * and EditorDocument.saveAll marked Settings clean; Save & Switch then cleared
 * all dirty state and switched away, dropping every other Settings edit.
 * Pinned: an explicit saveAll rejects with a TabSaveError naming Settings and
 * writes nothing, while the debounced autosave stays silent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => {
  const state = {
    selectedPersona: { id: 'p1', name: 'Ada' } as { id: string; name: string } | null,
    applyPersonaOp: vi.fn(async () => {}),
  };
  return { state };
});
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign((sel: (s: typeof h.state) => unknown) => sel(h.state), { getState: () => h.state }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

import { EditorDirtyProvider, useEditorDirtyState, TabSaveError } from '../EditorDocument';
import { useEditorSave } from '../useEditorSave';
import { buildDraft } from '../PersonaDraft';

const wrapper = ({ children }: { children: ReactNode }) => <EditorDirtyProvider>{children}</EditorDirtyProvider>;

beforeEach(() => {
  h.state.applyPersonaOp.mockReset();
  h.state.applyPersonaOp.mockResolvedValue(undefined);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const baseline = buildDraft({ name: 'Ada', enabled: true });
  const draft = { ...baseline, name: '', description: 'edited while the name is blank' };
  return renderHook(() => {
    useEditorSave({ draft, baseline, setDraft: vi.fn(), setBaseline: vi.fn(), pendingPersonaId: null });
    return useEditorDirtyState();
  }, { wrapper });
}

describe('useEditorSave blank name', () => {
  it('rejects an explicit save with a TabSaveError naming Settings and writes nothing', async () => {
    const { result } = setup();
    let caught: unknown;
    await act(async () => {
      try { await result.current.saveAll(); } catch (err) { caught = err; }
    });
    expect(caught).toBeInstanceOf(TabSaveError);
    expect((caught as TabSaveError).failedTabs).toContain('settings');
    expect(h.state.applyPersonaOp).not.toHaveBeenCalled();
    expect(result.current.dirtyTabs).toContain('settings');
  });

  it('keeps the debounced autosave silent for a blank name', async () => {
    const { result } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(h.state.applyPersonaOp).not.toHaveBeenCalled();
    expect(result.current.dirtyTabs).toContain('settings');
  });
});
