/**
 * THE FALLBACK UNDER THE SUMMARY CARD WAS UNREACHABLE.
 *
 * `useExecutionSummary` used to return an object unconditionally, so
 * `{executionSummary && <ExecutionSummaryCard/>}` was always true and the
 * `{resultText && !executionSummary && ...}` branch beneath it could never
 * render — a finished run with no structured trace showed a bare header and
 * nothing else. Now the summary is `null` when there is nothing to summarise,
 * and this pins both sides of that switch.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimpleExecutionView } from '../ExecutionMiniPlayer';
import type { ExecutionSummary } from '@/hooks/execution/useExecutionSummary';

const baseProps = {
  isExecuting: false,
  error: null,
  stageProgress: { label: 'Done', fraction: 1 },
  elapsed: 1200,
  executionOutput: [],
  meaningfulTail: ['the model said this'],
  traceEntries: [],
  traceLive: false,
};

const summary: ExecutionSummary = {
  status: 'completed',
  durationMs: 4200,
  costUsd: 0.12,
  totalTokens: 900,
  model: 'claude-opus',
  toolCalls: [],
  uniqueTools: [],
  fileChanges: [],
  fileWriteCount: 0,
  fileReadCount: 0,
};

describe('SimpleExecutionView — completed state', () => {
  it('renders the plain result text when there is no summary', () => {
    render(<SimpleExecutionView {...baseProps} executionSummary={null} />);
    expect(screen.getByText('the model said this')).toBeInTheDocument();
  });

  it('renders the summary card instead of the plain text when there is one', () => {
    render(<SimpleExecutionView {...baseProps} executionSummary={summary} />);
    expect(screen.queryByText('the model said this')).not.toBeInTheDocument();
  });
});
