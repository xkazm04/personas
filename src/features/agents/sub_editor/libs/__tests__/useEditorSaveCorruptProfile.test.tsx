/**
 * THE CORRUPT MODEL-PROFILE GUARD HOLDS ON THE EXPLICIT SAVE PATH TOO.
 *
 * With an unparseable stored model_profile the debounced model autosave is
 * paused so the reset draft cannot overwrite the recoverable JSON - but the
 * same save stayed registered for saveAll, so Save & Switch or the leave guard
 * wrote the reset profile over it. Pinned: while the guard is up, an explicit
 * saveAll rejects with a TabSaveError naming Model and writes nothing.
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

function setup(suppressModelSave: boolean) {
  const baseline = buildDraft({ name: 'Ada', enabled: true });
  const draft = { ...baseline, maxBudget: 5 };
  return renderHook(() => {
    useEditorSave({ draft, baseline, setDraft: vi.fn(), setBaseline: vi.fn(), pendingPersonaId: null, suppressModelSave });
    return useEditorDirtyState();
  }, { wrapper });
}

describe('useEditorSave corrupt model profile', () => {
  it('refuses the explicit save, reports Model as failed and writes nothing', async () => {
    const { result } = setup(true);
    let caught: unknown;
    await act(async () => {
      try { await result.current.saveAll(); } catch (err) { caught = err; }
    });
    expect(caught).toBeInstanceOf(TabSaveError);
    expect((caught as TabSaveError).failedTabs).toContain('model');
    expect(h.state.applyPersonaOp).not.toHaveBeenCalled();
  });

  it('still saves normally when the stored profile is intact', async () => {
    const { result } = setup(false);
    await act(async () => { await result.current.saveAll(); });
    expect(h.state.applyPersonaOp).toHaveBeenCalledTimes(1);
  });
});
