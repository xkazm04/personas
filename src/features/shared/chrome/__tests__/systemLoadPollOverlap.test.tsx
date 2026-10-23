/**
 * The footer load gauge ticks every 2 s. A get_system_metrics call slower than
 * that must not stack: at most one read is in flight at a time.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const { getSystemMetrics } = vi.hoisted(() => ({ getSystemMetrics: vi.fn() }));
vi.mock('@/api/system/systemMetrics', () => ({ getSystemMetrics }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    // INVARIANT for the cast: the component only reads string leaves of chrome.system_load.
    t: new Proxy({}, { get: () => new Proxy({}, { get: () => 'x' }) }) as never,
    tx: (s: string) => s,
  }),
}));

import SystemLoadFooterIcon from '../SystemLoadFooterIcon';

afterEach(() => {
  vi.useRealTimers();
  getSystemMetrics.mockReset();
});

describe('SystemLoadFooterIcon polling', () => {
  it('never has two metric reads in flight', async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    getSystemMetrics.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Slower than the 2 s poll period.
          setTimeout(() => {
            inFlight--;
            resolve({ sampleValid: true, cpuPercent: 10, memUsedPercent: 20, memAvailableMb: 1024n });
          }, 5000);
        }),
    );
    const { unmount } = render(<SystemLoadFooterIcon />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(maxInFlight).toBe(1);
    unmount();
  });
});
