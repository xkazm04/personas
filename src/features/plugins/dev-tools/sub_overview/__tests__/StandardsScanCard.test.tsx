import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DevStandard } from '@/lib/bindings/DevStandard';

// A `missing` rule carries a recommendation — an actionable defect. The card
// must be able to hand it to the Run Desk queue; a `present` rule must not
// offer the control at all.

const createTask = vi.hoisted(() => vi.fn());
const setPendingTaskFocusId = vi.fn();
const setDevToolsTab = vi.fn();
const fetchStandards = vi.fn(async () => undefined);
const runStandardsScan = vi.fn(async () => undefined);

let standards: DevStandard[] = [];

vi.mock('@/api/devTools/devTools', () => ({ createTask }));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ standards, fetchStandards, runStandardsScan, setPendingTaskFocusId, setDevToolsTab }),
}));

vi.mock('@/hooks/useTauriEvent', () => ({ useTypedTauriEvent: () => undefined }));

import { StandardsScanCard } from '../StandardsScanCard';

function standard(over: Partial<DevStandard>): DevStandard {
  return {
    id: 'std-1',
    project_id: 'p1',
    scan_id: null,
    rule_key: 'lint.config',
    category: 'precommit',
    title: 'Lint config present',
    status: 'missing',
    severity: 'warn',
    evidence: null,
    recommendation: 'Add an eslint config and wire it into pre-commit.',
    created_at: '2026-09-17T09:00:00Z',
    updated_at: '2026-09-17T09:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createTask.mockResolvedValue({ id: 'task-9' });
  standards = [
    standard({}),
    standard({ id: 'std-2', title: 'README present', status: 'present', recommendation: null }),
  ];
});

describe('StandardsScanCard dispatch', () => {
  it('queues a task from a missing rule and focuses it on the Run Desk', async () => {
    render(<StandardsScanCard projectId="p1" />);

    const buttons = screen.getAllByRole('button', { name: /queue task/i });
    expect(buttons).toHaveLength(1); // the present rule offers nothing

    fireEvent.click(buttons[0]!);

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(
      'Lint config present',
      'p1',
      'Add an eslint config and wire it into pre-commit.',
    );
    await waitFor(() => expect(setPendingTaskFocusId).toHaveBeenCalledWith('task-9'));
    expect(setDevToolsTab).toHaveBeenCalledWith('task-runner');
  });

  it('offers no dispatch when every rule is present', () => {
    standards = [standard({ status: 'present', recommendation: null })];
    render(<StandardsScanCard projectId="p1" />);

    expect(screen.queryByRole('button', { name: /queue task/i })).toBeNull();
  });
});
