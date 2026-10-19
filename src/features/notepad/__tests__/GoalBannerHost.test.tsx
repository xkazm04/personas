// Two ceremonies can land in one turn (two notes crossing in one sweep). The
// host used to keep only the last setState, so the first title card never
// played and its status text never announced.
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitGoalBanner, onGoalBanner, type GoalBannerEvent } from '../notifications/goalBanner';
import { GoalBannerHost } from '../notifications/GoalBannerHost';

describe('GoalBannerHost', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays the first ceremony through before the next one', () => {
    vi.useFakeTimers();
    render(<GoalBannerHost />);

    act(() => {
      emitGoalBanner('First note', 'goal');
      emitGoalBanner('Second note', 'cut');
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('First note');
    expect(status.textContent).not.toContain('Second note');

    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(status.textContent).toContain('Second note');
    expect(status.textContent).not.toContain('First note');
  });

  it('gives two same-kind cards raised in one millisecond two keys', () => {
    // The host keys each card's entrance on the event id; a shared id means the
    // second card swaps its text into the first one's frame without a beat.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const seen: GoalBannerEvent[] = [];
    const off = onGoalBanner((e) => seen.push(e));
    emitGoalBanner('First note', 'goal');
    emitGoalBanner('Second note', 'goal');
    off();
    vi.restoreAllMocks();
    expect(seen).toHaveLength(2);
    expect(seen[0]!.id).not.toBe(seen[1]!.id);
  });
});
