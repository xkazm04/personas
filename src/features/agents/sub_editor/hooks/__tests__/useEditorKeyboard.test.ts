import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ handler: null as null | ((e: KeyboardEvent) => boolean | void) }));
vi.mock('@/lib/keyboard/AppKeyboardProvider', () => ({
  useAppKeyboard: (handler: (e: KeyboardEvent) => boolean | void) => { h.handler = handler; },
}));

import { useEditorKeyboard } from '../useEditorKeyboard';

const ev = (over: Partial<KeyboardEvent> & { target?: EventTarget }) =>
  ({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z', target: document.body, preventDefault: vi.fn(), ...over }) as unknown as KeyboardEvent;

describe('useEditorKeyboard', () => {
  it('Ctrl+Z undoes', () => {
    const undo = vi.fn(); const redo = vi.fn();
    renderHook(() => useEditorKeyboard(undo, redo));
    expect(h.handler!(ev({}))).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+Z redoes even though Shift capitalises the key', () => {
    const undo = vi.fn(); const redo = vi.fn();
    renderHook(() => useEditorKeyboard(undo, redo));
    // Browsers report the produced character, so with Shift held the key is 'Z'.
    expect(h.handler!(ev({ shiftKey: true, key: 'Z' }))).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('leaves the shortcut to a focused text field', () => {
    const undo = vi.fn(); const redo = vi.fn();
    renderHook(() => useEditorKeyboard(undo, redo));
    expect(h.handler!(ev({ target: document.createElement('input') }))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});
