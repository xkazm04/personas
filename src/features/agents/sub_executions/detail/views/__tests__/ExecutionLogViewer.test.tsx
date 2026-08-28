import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/api/agents/executions', () => ({ getExecutionLog: vi.fn() }));

import * as executionsApi from '@/api/agents/executions';
import { ExecutionLogViewer } from '../ExecutionLogViewer';

const getExecutionLogMock = vi.mocked(executionsApi.getExecutionLog);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => { getExecutionLogMock.mockReset(); });

/**
 * The repo's spinner boundary reserves a spinner for a CONTROL the user just
 * pressed; a surface fetching its data gets a calm geometry-matched ghost under
 * permanent chrome. This region used to render `<Loader2 className="animate-spin"/>`
 * while the log fetched — the banned half of that pair — after the three sibling
 * surfaces in the same context had already been converted.
 */
describe('ExecutionLogViewer log-region loading state', () => {
  it('ghosts the log region instead of spinning while the fetch is in flight', async () => {
    const fetch = deferred<string>();
    getExecutionLogMock.mockReturnValue(fetch.promise);

    const { container } = render(
      <ExecutionLogViewer executionId="e1" personaId="p1" />,
    );
    // The disclosure toggle is the only button carrying aria-expanded; the
    // sibling CopyButton also matches on an accessible name containing "log".
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    // A calm ghost, announced once for assistive tech...
    expect(screen.getByRole('status')).toBeTruthy();
    // ...and not a spinner.
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);

    await act(async () => {
      fetch.resolve('line one\nline two');
      await fetch.promise;
    });

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('line one')).toBeTruthy();
  });

  it('keeps the disclosure chrome rendered while the region ghosts', async () => {
    const fetch = deferred<string>();
    getExecutionLogMock.mockReturnValue(fetch.promise);

    const { container } = render(<ExecutionLogViewer executionId="e1" personaId="p1" />);
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    // Law 1: a fetch ghosts UNDER the permanent chrome, never instead of it.
    expect(container.querySelector('button[aria-expanded]')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
