import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CloudStatusPanel } from './CloudStatusPanel';

const status = (queueLength: number, activeExecutions: number) => ({
  workerCounts: { idle: 3, executing: 1, disconnected: 0 },
  queueLength,
  activeExecutions,
  hasClaudeToken: true,
});

describe('CloudStatusPanel activity gauges', () => {
  it('follows a new status after a poll instead of freezing at the mount value', async () => {
    const { rerender } = render(
      <CloudStatusPanel status={status(2, 1)} isLoading={false} onRefresh={() => {}} lastPolled={1} />,
    );
    // Queue gauge: 2 at mount.
    expect(screen.getByText('2')).toBeTruthy();

    // A later poll reports a longer queue. Before the fix the spring was
    // attached to the initial number only, so the counter stayed at 2.
    rerender(
      <CloudStatusPanel status={status(7, 1)} isLoading={false} onRefresh={() => {}} lastPolled={2} />,
    );
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy(), { timeout: 4000 });
  });
});
