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

describe('CloudStatusPanel Claude token: presence is not authorization', () => {
  const oauth = (isExpired: boolean | null) => ({ connected: true, scopes: null, expiresAt: null, isExpired });
  const token = () => screen.getByTestId('cloud-status-token');

  it('shows a present but expired token as expired, not available', () => {
    render(<CloudStatusPanel status={status(0, 0)} isLoading={false} onRefresh={() => {}} oauthStatus={oauth(true)} />);
    expect(token().textContent).toContain('Token expired');
    expect(token().getAttribute('data-token-state')).toBe('expired');
  });

  it('shows a present token whose validity was not verified as unknown', () => {
    render(<CloudStatusPanel status={status(0, 0)} isLoading={false} onRefresh={() => {}} oauthStatus={null} />);
    expect(token().textContent).toContain('Token status unknown');
    expect(token().getAttribute('data-token-state')).toBe('unknown');
  });

  it('keeps a verified token green and a missing token red', () => {
    const { rerender } = render(
      <CloudStatusPanel status={status(0, 0)} isLoading={false} onRefresh={() => {}} oauthStatus={oauth(false)} />,
    );
    expect(token().getAttribute('data-token-state')).toBe('valid');
    expect(token().textContent).toContain('Token available');
    rerender(
      <CloudStatusPanel status={{ ...status(0, 0), hasClaudeToken: false }} isLoading={false} onRefresh={() => {}} oauthStatus={oauth(false)} />,
    );
    expect(token().getAttribute('data-token-state')).toBe('missing');
  });
});

describe('CloudStatusPanel liveness after a failed poll', () => {
  it('shows Live while polls succeed and a stale marker (no ping) after a failed poll', () => {
    const { rerender } = render(
      <CloudStatusPanel status={status(2, 1)} isLoading={false} onRefresh={() => {}} lastPolled={1} />,
    );
    expect(screen.getByTestId('cloud-status-liveness').getAttribute('data-stale')).toBe('false');
    rerender(
      <CloudStatusPanel status={status(2, 1)} isLoading={false} onRefresh={() => {}} lastPolled={1} stale />,
    );
    expect(screen.getByTestId('cloud-status-liveness').getAttribute('data-stale')).toBe('true');
  });
});
