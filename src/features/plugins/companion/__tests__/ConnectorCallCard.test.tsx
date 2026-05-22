import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const companionEnqueueJob = vi.fn();

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>(
    '@/api/companion',
  );
  return {
    ...actual,
    companionEnqueueJob: (...args: unknown[]) => companionEnqueueJob(...args),
  };
});

import { ConnectorCallCard } from '../ConnectorCallCard';
import type { BackgroundJob } from '@/api/companion';

function failedJob(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job_aaaaaaaa1234',
    kind: 'connector_use',
    status: 'failed',
    paramsJson: JSON.stringify({
      connector_name: 'sentry',
      capability: 'list_issues',
      project: 'web',
      limit: 5,
    }),
    resultText: null,
    errorText: 'oh no',
    projectId: null,
    createdAt: '2026-05-22T12:00:00Z',
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

beforeEach(() => {
  companionEnqueueJob.mockReset();
});

describe('ConnectorCallCard retry', () => {
  it('shows the Retry button only when the job is failed', () => {
    const { rerender } = render(
      <ConnectorCallCard job={failedJob({ status: 'completed', errorText: null })} />,
    );
    expect(screen.queryByTestId('companion-connector-retry')).toBeNull();
    rerender(<ConnectorCallCard job={failedJob()} />);
    expect(
      screen.getByTestId('companion-connector-retry'),
    ).toBeInTheDocument();
  });

  it('does not show Retry while the job is still running', () => {
    render(
      <ConnectorCallCard job={failedJob({ status: 'running', errorText: null })} />,
    );
    expect(screen.queryByTestId('companion-connector-retry')).toBeNull();
  });

  it('re-enqueues with the original paramsJson when Retry is clicked', async () => {
    companionEnqueueJob.mockResolvedValueOnce('job_new12345678');
    render(<ConnectorCallCard job={failedJob()} />);
    fireEvent.click(screen.getByTestId('companion-connector-retry'));
    await waitFor(() => {
      expect(companionEnqueueJob).toHaveBeenCalledWith('connector_use', {
        connector_name: 'sentry',
        capability: 'list_issues',
        project: 'web',
        limit: 5,
      });
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-connector-retried'),
      ).toBeInTheDocument();
    });
    // New job id truncated to 8 chars.
    expect(screen.getByText(/job_new1/)).toBeInTheDocument();
  });

  it('surfaces an error message when the retry IPC rejects', async () => {
    companionEnqueueJob.mockRejectedValueOnce(new Error('worker offline'));
    render(<ConnectorCallCard job={failedJob()} />);
    fireEvent.click(screen.getByTestId('companion-connector-retry'));
    await waitFor(() => {
      expect(screen.getByText(/worker offline/)).toBeInTheDocument();
    });
  });

  it('ignores a second click while the first retry is in flight', async () => {
    let resolveIt: (value: string) => void = () => {};
    companionEnqueueJob.mockReturnValueOnce(
      new Promise<string>((res) => {
        resolveIt = res;
      }),
    );
    render(<ConnectorCallCard job={failedJob()} />);
    fireEvent.click(screen.getByTestId('companion-connector-retry'));
    // Button is gone (replaced by the spinner); double-click guard implicit.
    expect(screen.queryByTestId('companion-connector-retry')).toBeNull();
    resolveIt('job_done5678abcd');
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-connector-retried'),
      ).toBeInTheDocument();
    });
    expect(companionEnqueueJob).toHaveBeenCalledTimes(1);
  });
});
