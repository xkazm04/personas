import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CloudExecutionRow } from './CloudExecutionRow';
import type { CloudExecution } from '@/api/system/cloud';

const exec = (status: string): CloudExecution => ({
  id: 'ex-1', personaId: 'p1', projectId: null, status, inputData: null,
  errorMessage: status === 'failed' ? 'boom' : null, durationMs: 10n, costUsd: null,
  inputTokens: null, outputTokens: null, retryCount: null, startedAt: null, completedAt: null,
  createdAt: '2026-09-07T10:00:00Z',
});

describe('CloudExecutionRow: red opens to the failure', () => {
  it('loads the output as soon as a failed row is expanded, once', () => {
    const onFetchOutput = vi.fn();
    const { rerender } = render(
      <CloudExecutionRow exec={exec('failed')} personaName="p" isExpanded onToggle={() => {}} onFetchOutput={onFetchOutput} />,
    );
    expect(onFetchOutput).toHaveBeenCalledTimes(1);
    // A parent re-render with a new callback identity must not re-arm it.
    rerender(
      <CloudExecutionRow exec={exec('failed')} personaName="p" isExpanded onToggle={() => {}} onFetchOutput={vi.fn()} output={{ lines: [], loading: true }} />,
    );
    expect(onFetchOutput).toHaveBeenCalledTimes(1);
  });

  it('does not pre-load output for a completed row or a collapsed failed row', () => {
    const onFetchOutput = vi.fn();
    render(<CloudExecutionRow exec={exec('completed')} personaName="p" isExpanded onToggle={() => {}} onFetchOutput={onFetchOutput} />);
    render(<CloudExecutionRow exec={exec('failed')} personaName="p" isExpanded={false} onToggle={() => {}} onFetchOutput={onFetchOutput} />);
    expect(onFetchOutput).not.toHaveBeenCalled();
  });
});
