// A disabled control fires no pointer events, so the notepad shows WHY on a
// focusable wrapper around it — and `Tooltip` holds that reason back for
// `MOTION.delay.tooltip.default` (400 ms) before painting it. Waiting that out
// with `findByText` on real timers cost 400 ms per control: three tests spent
// 3.4 s of a 7 s file-set doing nothing. These tests run on fake timers that
// still advance with the clock (`shouldAdvanceTime`), so the delay is stepped
// over instead of slept through.
import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { MOTION } from '@/lib/utils/designTokens';

const FRAMES_MS = 64;

/** Fake timers that keep following real time, so `waitFor` elsewhere still works. */
export function useSteppedTimers(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

/**
 * Focus the disabled control's wrapper, step past the tooltip delay and require
 * the reason it painted, then blur so the next control starts from a shut
 * tooltip. Throws (a failed test, not a hang) when the control is not wrapped in
 * an `aria-disabled` host or no text matches.
 */
export async function expectReason(control: HTMLElement, reason: string | RegExp): Promise<void> {
  const wrapper = control.closest('[aria-disabled="true"]');
  if (!wrapper) throw new Error('control has no aria-disabled wrapper to carry its reason');
  fireEvent.focus(wrapper);
  // Two steps, because the second timer is only scheduled once React has
  // committed the first: the delay makes the tooltip visible, THEN its effect
  // asks for the animation frame it positions and paints on.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MOTION.delay.tooltip.default);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FRAMES_MS);
  });
  try {
    screen.getByText(reason);
  } finally {
    fireEvent.blur(wrapper);
  }
}
