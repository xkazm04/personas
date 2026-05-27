import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ActivityTray } from '../ActivityTray';
import { TaskTag } from '../TaskTag';
import type { BackgroundJob } from '@/api/companion';
import { useCompanionStore } from '../companionStore';

function job(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job_scan_0001',
    kind: 'scan_codebase',
    status: 'running',
    paramsJson: '{}',
    resultText: null,
    errorText: null,
    projectId: null,
    shortTitle: 'Scanning ai-paralegal',
    parentTurnId: null,
    progressText: null,
    progressCurrent: null,
    progressTotal: null,
    createdAt: '2026-05-26T12:00:00Z',
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

beforeEach(() => {
  useCompanionStore.getState().clearAllConnectorJobs();
});

describe('ActivityTray', () => {
  it('renders nothing when there are no in-flight tasks', () => {
    const { container } = render(<ActivityTray />);
    expect(container.firstChild).toBeNull();
  });

  it('shows queued + running tasks and ignores terminal ones', () => {
    const store = useCompanionStore.getState();
    store.upsertJob(job({ id: 'a', status: 'running' }));
    store.upsertJob(job({ id: 'b', status: 'queued' }));
    store.upsertJob(job({ id: 'c', status: 'completed' }));
    store.upsertJob(job({ id: 'd', status: 'failed' }));

    render(<ActivityTray />);
    const tray = screen.getByTestId('companion-activity-tray');
    expect(tray.getAttribute('data-task-count')).toBe('2');
    expect(screen.getAllByTestId('companion-task-tag')).toHaveLength(2);
  });

  it('collapses and expands the task list', () => {
    useCompanionStore.getState().upsertJob(job({ id: 'a', status: 'running' }));
    render(<ActivityTray />);
    expect(screen.getByTestId('companion-task-tag')).toBeInTheDocument();
    // Header is the only button.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('companion-task-tag')).toBeNull();
  });
});

describe('TaskTag', () => {
  it('renders the short title and a determinate progress bar while running', () => {
    render(
      <TaskTag
        job={job({ status: 'running', progressCurrent: 8, progressTotal: 17 })}
      />,
    );
    const tag = screen.getByTestId('companion-task-tag');
    expect(tag.getAttribute('data-job-status')).toBe('running');
    expect(screen.getByText('Scanning ai-paralegal')).toBeInTheDocument();
    expect(screen.getByText('8/17')).toBeInTheDocument();
  });

  it('falls back to a kind-derived label when shortTitle is absent', () => {
    render(<TaskTag job={job({ shortTitle: null })} />);
    expect(screen.getByText('Scanning codebase')).toBeInTheDocument();
  });
});
