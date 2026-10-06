import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { evidenceItem, soloV0, stepView } from './fixtures';

// The page against a stubbed lifecycle API: Solo v0, a snapshot with a
// missing binding (Install offered), and a failed read (inline banner).

const getLifecycle = vi.hoisted(() => vi.fn());
const installLifecycle = vi.hoisted(() => vi.fn());
const askAthena = vi.hoisted(() => vi.fn());
let activeProjectId: string | null = 'p1';

vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle, installLifecycle }));
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => askAthena }));
vi.mock('../../LifecycleProjectPicker', () => ({ LifecycleProjectPicker: () => null }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeProjectId,
      projects: [{ id: activeProjectId, name: 'Acme', root_path: 'C:/acme', github_url: null }],
    }),
}));

import LifecyclePage from '../../LifecyclePage';

beforeEach(() => {
  vi.clearAllMocks();
  activeProjectId = 'p1';
});

// Each test uses its own project id so the module warm cache never leaks a
// snapshot from one test into the next.
function project(id: string, snap: LifecycleSnapshot) {
  activeProjectId = id;
  getLifecycle.mockResolvedValue({ ...snap, projectId: id });
}

describe('LifecyclePage', () => {
  it('renders Solo v0 as two lanes with no Install', async () => {
    project('p-solo', soloV0());
    render(<LifecyclePage />);

    await screen.findByTestId('lc-journey');
    expect(screen.getByText('Solo practice, default')).toBeTruthy();
    expect(screen.getByTestId('lc-lane-before').querySelectorAll('[data-testid^="lc-node-"]')).toHaveLength(4);
    expect(screen.getByTestId('lc-lane-after').querySelectorAll('[data-testid^="lc-node-"]')).toHaveLength(6);
    expect(screen.getByTestId('lc-node-tests').getAttribute('data-state')).toBe('advisory');
    expect(screen.getByTestId('lc-weakest').textContent).toContain('No work has passed through yet.');
    expect(screen.queryByTestId('lc-install')).toBeNull();
  });

  it('offers Install when a binding is missing, and names Athena the project', async () => {
    project('p-missing', soloV0({
      version: 2,
      author: 'athena',
      evidence: [evidenceItem('c1', '2026-09-25T10:00:00Z', [['gate', 'skipped']])],
      steps: [
        stepView('recall', 'before', [['claude_md', 'missing']]),
        stepView('gate', 'after', [['hook', 'live']], { skipped: 1 }),
      ],
    }));
    installLifecycle.mockResolvedValue('task-7');
    render(<LifecyclePage />);

    await screen.findByTestId('lc-install');
    expect(screen.getByText('Solo practice, v2 by Athena')).toBeTruthy();
    expect(screen.getByTestId('lc-dots-gate').querySelector('[data-outcome="skipped"]')).toBeTruthy();

    fireEvent.click(screen.getByTestId('lc-install'));
    fireEvent.click(await screen.findByTestId('lc-install-confirm-go'));
    await waitFor(() => expect(installLifecycle).toHaveBeenCalledWith('p-missing'));

    fireEvent.click(screen.getByTestId('lc-ask-athena'));
    expect(askAthena).toHaveBeenCalledWith('lifecycle', expect.stringContaining('Acme (id p-missing)'));
  });

  // The owner's note, 2026-10-06: a node click must NOT open a drawer. It
  // selects, and the state renders inline under the timeline, which is what
  // makes walking the journey possible.
  it('renders the selected step inline, with no drawer', async () => {
    project('p-detail', soloV0());
    render(<LifecyclePage />);

    // The region is pre-seeded with the weakest step, so it has content before
    // any click: that is what keeps it from shoving the timeline when it appears.
    const region = await screen.findByTestId('lc-state-region');
    expect(region.textContent).toBeTruthy();

    fireEvent.click(await screen.findByTestId('lc-node-gate'));
    const state = await screen.findByTestId('lc-step-state');
    expect(state.textContent).toContain('Rule for gate.');
    expect(state.textContent).toContain('Git hook');
    expect(screen.getByTestId('lc-node-gate').getAttribute('aria-pressed')).toBe('true');
    // The retired right-drawer must not be reachable from a node any more.
    expect(screen.queryByTestId('lc-step-detail')).toBeNull();
    // The timeline is still on screen with its selection.
    expect(screen.getByTestId('lc-journey-track')).toBeTruthy();
  });

  it('formats the step evidence as a table ledger', async () => {
    project('p-ledger', soloV0({
      evidence: [
        evidenceItem('c1', '2026-09-25T10:00:00Z', [['gate', 'skipped']]),
        evidenceItem('c2', '2026-09-26T10:00:00Z', [['gate', 'done']]),
      ],
      steps: [stepView('gate', 'after', [['hook', 'live']], { skipped: 1, done: 1 })],
    }));
    render(<LifecyclePage />);

    await screen.findByTestId('lc-step-state');
    // UnifiedTable owns the column header and the rows; both outcomes for the
    // selected step appear, and the unrelated steps' outcomes do not.
    expect(screen.getByText('Outcome')).toBeTruthy();
    expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
  });

  it('shows an inline error when the read fails', async () => {
    activeProjectId = 'p-error';
    getLifecycle.mockRejectedValue(new Error('boom'));
    render(<LifecyclePage />);

    await screen.findByText("Could not read this project's practice.");
    // The chrome stays (the action row and the banner are permanent); what a
    // failed read must NOT produce is a timeline or a selected step.
    expect(screen.queryByTestId('lc-journey-track')).toBeNull();
    expect(screen.queryByTestId('lc-step-state')).toBeNull();
  });
});
