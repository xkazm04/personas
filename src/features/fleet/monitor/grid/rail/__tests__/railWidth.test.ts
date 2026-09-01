import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RAIL_DEFAULT_WIDTH,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  useRailWidth,
  _resetRailWidthForTests,
} from '../useRailWidth';

/* ----------------------------------------------------------------------------
 * The hook became multi-rail on 2026-09-01 (Conversations has two of its own).
 * Two things had to survive that and neither is visible from a render: the
 * Activity rail's no-argument call must behave exactly as it did, and two rails
 * must not share a number. The third is the sign — a rail on the LEFT widens
 * when the pointer goes right, and that is the half of the change with no
 * precedent in the file to copy from.
 * -------------------------------------------------------------------------- */

afterEach(() => {
  act(() => _resetRailWidthForTests());
  localStorage.clear();
});

/** The arrow-key path, which is the whole gesture without a pointer to fake. */
function press(
  result: { current: ReturnType<typeof useRailWidth> },
  key: string,
  shiftKey = false,
) {
  act(() => {
    result.current.handleProps.onKeyDown({
      key,
      shiftKey,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as React.KeyboardEvent);
  });
}

describe('useRailWidth', () => {
  it('defaults to the Activity rail: 320px, and the ARIA a splitter owes', () => {
    const { result } = renderHook(() => useRailWidth());
    expect(result.current.width).toBe(RAIL_DEFAULT_WIDTH);
    expect(result.current.handleProps).toMatchObject({
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': RAIL_DEFAULT_WIDTH,
      'aria-valuemin': RAIL_MIN_WIDTH,
      'aria-valuemax': RAIL_MAX_WIDTH,
      tabIndex: 0,
    });
  });

  it('widens a right-hand rail on ArrowLeft, exactly as it always did', () => {
    const { result } = renderHook(() => useRailWidth());
    press(result, 'ArrowLeft');
    expect(result.current.width).toBe(RAIL_DEFAULT_WIDTH + 16);
    press(result, 'ArrowRight');
    expect(result.current.width).toBe(RAIL_DEFAULT_WIDTH);
  });

  it('widens a LEFT-hand rail on ArrowRight — the sign follows the edge', () => {
    const { result } = renderHook(() =>
      useRailWidth({ storageKey: 'test-left-rail', defaultWidth: 300, side: 'left' }),
    );
    press(result, 'ArrowRight');
    expect(result.current.width).toBe(316);
    press(result, 'ArrowLeft');
    expect(result.current.width).toBe(300);
  });

  it('multiplies the step with Shift', () => {
    const { result } = renderHook(() => useRailWidth({ storageKey: 'test-shift' }));
    press(result, 'ArrowLeft', true);
    expect(result.current.width).toBe(RAIL_DEFAULT_WIDTH + 64);
  });

  it('clamps at both ends rather than letting a rail become the view', () => {
    const { result } = renderHook(() => useRailWidth({ storageKey: 'test-clamp' }));
    for (let i = 0; i < 40; i++) press(result, 'ArrowLeft', true);
    expect(result.current.width).toBe(RAIL_MAX_WIDTH);
    for (let i = 0; i < 40; i++) press(result, 'ArrowRight', true);
    expect(result.current.width).toBe(RAIL_MIN_WIDTH);
  });

  it('keeps two rails on two numbers — dragging one must not move the other', () => {
    const a = renderHook(() => useRailWidth({ storageKey: 'test-rail-a' }));
    const b = renderHook(() => useRailWidth({ storageKey: 'test-rail-b', defaultWidth: 300 }));
    press(a.result, 'ArrowLeft');
    expect(a.result.current.width).toBe(RAIL_DEFAULT_WIDTH + 16);
    expect(b.result.current.width).toBe(300);
  });

  it('shares ONE number between two views of the same key', () => {
    const a = renderHook(() => useRailWidth({ storageKey: 'test-shared' }));
    const b = renderHook(() => useRailWidth({ storageKey: 'test-shared' }));
    press(a.result, 'ArrowLeft');
    expect(b.result.current.width).toBe(RAIL_DEFAULT_WIDTH + 16);
  });

  it('Home restores THIS rail’s default, not the Activity rail’s', () => {
    const { result } = renderHook(() =>
      useRailWidth({ storageKey: 'test-home', defaultWidth: 280, side: 'left' }),
    );
    press(result, 'ArrowRight');
    press(result, 'Home');
    expect(result.current.width).toBe(280);
  });

  it('ignores a key it does not own, so the Monitor still sees it', () => {
    const { result } = renderHook(() => useRailWidth({ storageKey: 'test-escape' }));
    press(result, 'Escape');
    expect(result.current.width).toBe(RAIL_DEFAULT_WIDTH);
  });
});
