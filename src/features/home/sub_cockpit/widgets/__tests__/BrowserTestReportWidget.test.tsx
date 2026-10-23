import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const completeGoalUat = vi.fn();
const companionFileBrowserDefects = vi.fn();

vi.mock('@/api/devTools/devTools', async () => {
  const actual = await vi.importActual<typeof import('@/api/devTools/devTools')>(
    '@/api/devTools/devTools',
  );
  return { ...actual, completeGoalUat: (...args: unknown[]) => completeGoalUat(...args) };
});

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionFileBrowserDefects: (...args: unknown[]) => companionFileBrowserDefects(...args),
  };
});

import { BrowserTestReportWidget } from '../BrowserTestReportWidget';

const PASSING = [
  { label: 'open the app', result: 'pass' },
  { label: 'sign in', result: 'pass' },
];

/**
 * Closing a goal's UAT gate is a write. A model-composed report must never perform it on render:
 * it happens only on the user's explicit press, and only for a goal-gate report whose steps all
 * passed.
 */
describe('BrowserTestReportWidget goal-UAT close', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    completeGoalUat.mockReset();
    completeGoalUat.mockResolvedValue(undefined);
    companionFileBrowserDefects.mockReset();
  });

  it('does not close the gate on render, even when every step passed', async () => {
    render(<BrowserTestReportWidget config={{ goal_id: 'g-1', steps: PASSING }} />);
    await waitFor(() => {
      expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    });
    expect(completeGoalUat).not.toHaveBeenCalled();
  });

  it('closes the gate once when the user presses the close control', async () => {
    render(<BrowserTestReportWidget config={{ goal_id: 'g-2', steps: PASSING }} />);
    fireEvent.click(screen.getByTestId('browser-report-close-uat'));
    await waitFor(() => {
      expect(screen.getByTestId('browser-report-uat-passed')).toBeInTheDocument();
    });
    expect(completeGoalUat).toHaveBeenCalledTimes(1);
    expect(completeGoalUat).toHaveBeenCalledWith('g-2');
    expect(screen.queryByTestId('browser-report-close-uat')).toBeNull();
  });

  it('offers no close control when a step failed', async () => {
    render(
      <BrowserTestReportWidget
        config={{ goal_id: 'g-3', steps: [...PASSING, { label: 'checkout', result: 'fail' }] }}
      />,
    );
    expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-report-close-uat')).toBeNull();
    expect(completeGoalUat).not.toHaveBeenCalled();
  });

  it('offers no close control when the report is not a goal gate', async () => {
    render(<BrowserTestReportWidget config={{ steps: PASSING }} />);
    expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-report-close-uat')).toBeNull();
  });

  it('renders the empty state rather than a verdict when there are no steps', async () => {
    render(<BrowserTestReportWidget config={{ goal_id: 'g-4', steps: [] }} />);
    expect(screen.queryByTestId('companion-browser-test-report')).toBeNull();
    expect(screen.queryByTestId('browser-report-close-uat')).toBeNull();
  });
});

/** A WebView2 profile with storage disabled throws on access; the report must still render. */
describe('BrowserTestReportWidget with storage that throws', () => {
  it('still renders the report', async () => {
    cleanup();
    completeGoalUat.mockReset();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    try {
      render(<BrowserTestReportWidget config={{ goal_id: 'g-storage', steps: PASSING }} />);
      expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
