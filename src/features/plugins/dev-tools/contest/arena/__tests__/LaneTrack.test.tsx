// The lane row reads cleanly (FE-14): the state word is never cut, the runner
// carries the state's own tone, and a seconds clock never says "0ms".
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LaneMeter } from '../LaneTrack';

afterEach(cleanup);

describe('LaneMeter', () => {
  it('an errored runner is painted with the error tone its state dot uses', () => {
    const { container } = render(
      <LaneMeter state="errored" stateLabel="Did not finish" stateTone="error" wallS={600} startedAtMs={null} ceilingS={3600} />,
    );
    const track = screen.getByTestId('arena-lane-track');
    expect(track.querySelector('.bg-status-error')).not.toBeNull();
    expect(track.querySelector('.bg-status-warning')).toBeNull();
    expect(container.querySelectorAll('.bg-status-error').length).toBeGreaterThan(1);
  });

  it('the state word wraps instead of being truncated', () => {
    render(<LaneMeter state="seat-limit" stateLabel="Out of fuel · seat limit" stateTone="warning" wallS={60} startedAtMs={null} ceilingS={3600} />);
    const label = screen.getByText('Out of fuel · seat limit');
    expect(label.className).not.toMatch(/\btruncate\b/);
  });

  it('a racing lane whose start is still ahead of the clock shows no elapsed time, never "0ms"', () => {
    render(<LaneMeter state="running" stateLabel="Racing" stateTone="processing" wallS={null} startedAtMs={Date.now() + 60_000} ceilingS={5400} />);
    expect(screen.queryByText(/0ms/)).toBeNull();
  });
});
