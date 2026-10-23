import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoCredBrowser } from '../AutoCredBrowser';
import type { BrowserLogEntry } from '../../helpers/types';

/**
 * The session log keeps only its last 500 entries, so on a long run its first
 * entry is not the start of the session. The elapsed clock read `logs[0].ts`
 * and jumped back every time the log rolled over.
 */

const NOW = 1_760_000_000_000;

afterEach(() => { vi.useRealTimers(); });

describe('AutoCredBrowser: the elapsed clock counts from the run start', () => {
  it('ignores a log that has rolled past its first entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // 500 retained entries, the oldest one only 5 s old after a rollover.
    const logs: BrowserLogEntry[] = Array.from({ length: 500 }, (_, i) => ({
      ts: NOW - 5_000 + i,
      message: `step ${i}`,
      type: 'action',
    }));

    render(<AutoCredBrowser logs={logs} startedAt={NOW - 125_000} onCancel={vi.fn()} />);

    expect(screen.getByText('2:05')).toBeTruthy();
    expect(screen.queryByText('5s')).toBeNull();
  });
});
