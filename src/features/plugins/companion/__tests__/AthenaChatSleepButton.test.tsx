import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AthenaChatSleepButton } from '../chat/AthenaChatSleepButton';
import { useToastStore } from '@/stores/toastStore';
import type { SleepPressure } from '@/api/companion';

const api = vi.hoisted(() => ({
  run: vi.fn(),
  pressure: vi.fn(),
}));

vi.mock('@/api/companion', () => ({
  companionRunSleepCycle: api.run,
  companionGetSleepPressure: api.pressure,
}));

function gauge(over: Partial<SleepPressure> = {}): SleepPressure {
  return {
    pressureChars: 42310,
    thresholdChars: 40000,
    episodesWaiting: 118,
    boundary: '2026-08-07T22:00:00+00:00',
    floorSatisfied: true,
    floorHours: 6,
    minChars: 2000,
    staleness: { hoursSince: 14, firesAtHours: 72 },
    lastCycle: {
      id: 'cyc_abc',
      finishedAt: '2026-08-07T22:00:00+00:00',
      hoursAgo: 14,
      truncated: false,
    },
    wouldAdmit: true,
    wouldAdmitReason: 'sleep pressure reached: 42,310 of 40,000 chars across 118 episodes',
    ...over,
  };
}

function toasts() {
  return useToastStore.getState().toasts.map((t) => t.message);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  api.run.mockResolvedValue({ status: 'started', cycleId: 'cyc_new', skippedReason: null });
  api.pressure.mockResolvedValue(gauge());
});

describe('AthenaChatSleepButton', () => {
  it('renders without waiting for the pressure read', () => {
    // The gauge is a window fetch on the backend; the header must never be
    // held hostage to it. A never-resolving read must not stop the paint.
    api.pressure.mockReturnValue(new Promise(() => {}));
    render(<AthenaChatSleepButton />);
    expect(screen.getByTestId('companion-force-sleep-cycle')).toBeInTheDocument();
    expect(api.pressure).not.toHaveBeenCalled();
  });

  it('forces a cycle and reports the new cycle id', async () => {
    render(<AthenaChatSleepButton />);
    fireEvent.click(screen.getByTestId('companion-force-sleep-cycle'));

    await waitFor(() => expect(api.run).toHaveBeenCalledWith(true));
    await waitFor(() => {
      expect(toasts().some((m) => m.includes('cyc_new'))).toBe(true);
    });
  });

  it('reports a skip with the backend’s own reason, verbatim', async () => {
    // The reason carries the real numbers — paraphrasing it in the UI would
    // undo the whole point of the honest skip string.
    api.run.mockResolvedValue({
      status: 'skipped',
      cycleId: null,
      skippedReason: 'a sleep cycle is already running in this process',
    });
    render(<AthenaChatSleepButton />);
    fireEvent.click(screen.getByTestId('companion-force-sleep-cycle'));

    await waitFor(() => {
      expect(
        toasts().some((m) => m.includes('a sleep cycle is already running in this process')),
      ).toBe(true);
    });
  });

  it('surfaces a failure instead of looking like it worked', async () => {
    api.run.mockRejectedValue(new Error('ipc exploded'));
    render(<AthenaChatSleepButton />);
    fireEvent.click(screen.getByTestId('companion-force-sleep-cycle'));

    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    expect(toasts().some((m) => m.toLowerCase().includes('sleep cycle'))).toBe(true);
  });

  it('reads the gauge on hover and shows the numbers in the tooltip', async () => {
    render(<AthenaChatSleepButton />);
    // `mouseover` is what React synthesizes both onMouseEnter handlers from —
    // the button's (which loads the gauge) and the shared Tooltip wrapper's
    // (which schedules the reveal after its 400ms hover-intent delay).
    fireEvent.mouseOver(screen.getByTestId('companion-force-sleep-cycle'));

    await waitFor(() => expect(api.pressure).toHaveBeenCalledTimes(1));
    const tip = await screen.findByRole('tooltip', {}, { timeout: 3000 });
    expect(tip).toHaveTextContent('42,310');
    expect(tip).toHaveTextContent('40,000');
    expect(tip).toHaveTextContent('14h ago');
  });

  it('falls back to the plain label until the gauge answers', async () => {
    api.pressure.mockReturnValue(new Promise(() => {}));
    render(<AthenaChatSleepButton />);
    fireEvent.mouseOver(screen.getByTestId('companion-force-sleep-cycle'));

    const tip = await screen.findByRole('tooltip', {}, { timeout: 3000 });
    expect(tip.textContent).toBeTruthy();
    expect(tip).not.toHaveTextContent('/');
  });

  it('does not stack gauge reads when hover and focus both fire', async () => {
    render(<AthenaChatSleepButton />);
    const btn = screen.getByTestId('companion-force-sleep-cycle');
    fireEvent.mouseOver(btn);
    fireEvent.focus(btn);
    await waitFor(() => expect(api.pressure).toHaveBeenCalledTimes(1));
  });
});
