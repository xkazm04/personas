/**
 * A FAILED SAVE & SWITCH MARKS THE TABS THAT FAILED.
 *
 * EditorBody ships a "Couldn't save: <tabs> - Retry" banner and a failed badge
 * on the tab, both driven by `failedTabs` - whose only writer was the banner's
 * own Retry button, so neither could ever appear. The switch guard caught the
 * TabSaveError and only toasted. Pinned: the guard hands the failed tab ids to
 * its caller (and still toasts and holds the switch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ commitPendingSwitch: vi.fn(), addToast: vi.fn() }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { commitPendingSwitch: () => void }) => unknown) =>
    sel({ commitPendingSwitch: h.commitPendingSwitch }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: h.addToast }) },
}));
// Any depth (`t.agents.editor.tabs` is a catalog object); `in` finds nothing,
// so tab labels fall back to the English table, and every leaf prints its path.
const deep = (path: string): unknown => new Proxy({}, {
  get: (_o, k) => (k === Symbol.toPrimitive || k === 'toString' ? () => path : deep(`${path}.${String(k)}`)),
  has: () => false,
});
const t = deep('t');
const tx = (s: unknown) => String(s);
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx, language: 'en' }) }));

import { usePersonaSwitchGuard } from '../usePersonaSwitchGuard';
import { TabSaveError } from '../../libs/EditorDocument';

beforeEach(() => { h.commitPendingSwitch.mockReset(); h.addToast.mockReset(); });

describe('usePersonaSwitchGuard', () => {
  it('reports the failed tabs to its caller and holds the switch', async () => {
    const onSaveFailed = vi.fn();
    const deps = {
      cancelAllDebouncedSaves: vi.fn(),
      saveAllTabs: vi.fn(async () => { throw new TabSaveError(['settings', 'model'], []); }),
      clearAllDirty: vi.fn(),
      onSaveFailed,
    };
    const { result } = renderHook(() => usePersonaSwitchGuard(deps));
    await act(async () => { await result.current.handleSaveAndSwitch(); });

    expect(onSaveFailed).toHaveBeenCalledWith(['settings', 'model']);
    expect(h.addToast).toHaveBeenCalledTimes(1);
    expect(h.commitPendingSwitch).not.toHaveBeenCalled();
    expect(deps.clearAllDirty).not.toHaveBeenCalled();
  });

  it('reports nothing and switches when every tab saved', async () => {
    const onSaveFailed = vi.fn();
    const deps = {
      cancelAllDebouncedSaves: vi.fn(),
      saveAllTabs: vi.fn(async () => {}),
      clearAllDirty: vi.fn(),
      onSaveFailed,
    };
    const { result } = renderHook(() => usePersonaSwitchGuard(deps));
    await act(async () => { await result.current.handleSaveAndSwitch(); });

    expect(onSaveFailed).not.toHaveBeenCalled();
    expect(h.commitPendingSwitch).toHaveBeenCalledTimes(1);
  });
});
