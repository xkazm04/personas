/**
 * The Sessions-tab hotkey layer listens on the whole document, so the claims
 * that keep it safe are the ones about when it does NOT fire: never while the
 * operator types (inputs, and xterm's hidden helper textarea), never on a
 * modifier chord, never while a modal turned it off, and only `g` / `n` over
 * the open grid.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetHotkeys, type FleetHotkeyHandlers } from '../useFleetHotkeys';

function handlers(): Required<FleetHotkeyHandlers> {
  return {
    onNextWaiting: vi.fn(), onMoveFocus: vi.fn(), onFocusSearch: vi.fn(),
    onToggleGrid: vi.fn(), onShowHelp: vi.fn(),
  };
}

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('useFleetHotkeys', () => {
  it('dispatches each key to its handler', () => {
    const h = handlers();
    renderHook(() => useFleetHotkeys(true, false, h));
    press('n'); press('g'); press('?'); press('/'); press('ArrowDown'); press('ArrowUp');
    expect(h.onNextWaiting).toHaveBeenCalledTimes(1);
    expect(h.onToggleGrid).toHaveBeenCalledTimes(1);
    expect(h.onShowHelp).toHaveBeenCalledTimes(1);
    expect(h.onFocusSearch).toHaveBeenCalledTimes(1);
    expect(h.onMoveFocus).toHaveBeenNthCalledWith(1, 1);
    expect(h.onMoveFocus).toHaveBeenNthCalledWith(2, -1);
  });

  it('never fires while the operator types into a field or a terminal', () => {
    const h = handlers();
    renderHook(() => useFleetHotkeys(true, false, h));
    const input = document.createElement('input');
    const terminal = document.createElement('textarea'); // xterm's helper textarea
    document.body.append(input, terminal);
    press('n', input); press('g', terminal); press('/', input);
    expect(h.onNextWaiting).not.toHaveBeenCalled();
    expect(h.onToggleGrid).not.toHaveBeenCalled();
    expect(h.onFocusSearch).not.toHaveBeenCalled();
    input.remove(); terminal.remove();
  });

  it('ignores modifier chords, so Ctrl+G and Cmd+N stay the OS/browser shortcuts', () => {
    const h = handlers();
    renderHook(() => useFleetHotkeys(true, false, h));
    press('g', document.body, { ctrlKey: true });
    press('n', document.body, { metaKey: true });
    press('n', document.body, { altKey: true });
    expect(h.onToggleGrid).not.toHaveBeenCalled();
    expect(h.onNextWaiting).not.toHaveBeenCalled();
  });

  it('is fully off while a modal or drawer disables it', () => {
    const h = handlers();
    renderHook(() => useFleetHotkeys(false, false, h));
    press('n'); press('g'); press('?');
    expect(Object.values(h).every((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });

  it('over the open grid keeps only g and n, and does not swallow the arrows', () => {
    const h = handlers();
    renderHook(() => useFleetHotkeys(true, true, h));
    press('g'); press('n');
    const arrow = press('ArrowDown');
    press('/'); press('?');
    expect(h.onToggleGrid).toHaveBeenCalledTimes(1);
    expect(h.onNextWaiting).toHaveBeenCalledTimes(1);
    expect(h.onMoveFocus).not.toHaveBeenCalled();
    expect(h.onFocusSearch).not.toHaveBeenCalled();
    expect(h.onShowHelp).not.toHaveBeenCalled();
    expect(arrow.defaultPrevented).toBe(false);
  });
});
