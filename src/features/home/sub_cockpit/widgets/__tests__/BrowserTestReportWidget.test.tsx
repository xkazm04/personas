import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

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
 * Closing a goal's UAT gate is a write, and the widget's own guard against
 * firing it twice is a localStorage key rather than a ref - precisely because
 * a remount (tab revisit, spec recompose) would reset a ref. Nothing tested
 * either half.
 */
describe('BrowserTestReportWidget goal-UAT close', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    completeGoalUat.mockReset();
    completeGoalUat.mockResolvedValue(undefined);
    companionFileBrowserDefects.mockReset();
  });

  it('closes the gate once when every step passed', async () => {
    render(<BrowserTestReportWidget config={{ goal_id: 'g-1', steps: PASSING }} />);
    await waitFor(() => {
      expect(completeGoalUat).toHaveBeenCalledWith('g-1');
    });
    expect(completeGoalUat).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire on a remount', async () => {
    const first = render(<BrowserTestReportWidget config={{ goal_id: 'g-2', steps: PASSING }} />);
    await waitFor(() => {
      expect(completeGoalUat).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    render(<BrowserTestReportWidget config={{ goal_id: 'g-2', steps: PASSING }} />);
    await waitFor(() => {
      expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    });
    expect(completeGoalUat).toHaveBeenCalledTimes(1);
  });

  it('does not close the gate when a step failed', async () => {
    render(
      <BrowserTestReportWidget
        config={{ goal_id: 'g-3', steps: [...PASSING, { label: 'checkout', result: 'fail' }] }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    });
    expect(completeGoalUat).not.toHaveBeenCalled();
  });

  it('does not close anything when the report is not a goal gate', async () => {
    render(<BrowserTestReportWidget config={{ steps: PASSING }} />);
    await waitFor(() => {
      expect(screen.getByTestId('companion-browser-test-report')).toBeInTheDocument();
    });
    expect(completeGoalUat).not.toHaveBeenCalled();
  });

  it('renders the empty state rather than a verdict when there are no steps', async () => {
    render(<BrowserTestReportWidget config={{ goal_id: 'g-4', steps: [] }} />);
    expect(screen.queryByTestId('companion-browser-test-report')).toBeNull();
    expect(completeGoalUat).not.toHaveBeenCalled();
  });
});
