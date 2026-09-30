// Two ceremonies can land in one turn (two notes crossing in one sweep). The
// host used to keep only the last setState, so the first title card never
// played and its status text never announced.
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitGoalBanner } from '../notifications/goalBanner';
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
});
