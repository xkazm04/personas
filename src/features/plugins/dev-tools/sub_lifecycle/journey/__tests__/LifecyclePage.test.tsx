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
vi.mock('@/features/plugins/companion/useAskAthena', () => ({ useAskAthena: () => askAthena }));
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

  it('opens the detail layer for a step', async () => {
    project('p-detail', soloV0());
    render(<LifecyclePage />);

    fireEvent.click(await screen.findByTestId('lc-node-gate'));
    const sheet = await screen.findByTestId('lc-step-detail');
    expect(sheet.textContent).toContain('Rule for gate.');
    expect(sheet.textContent).toContain('Git hook');
  });

  it('shows an inline error when the read fails', async () => {
    activeProjectId = 'p-error';
    getLifecycle.mockRejectedValue(new Error('boom'));
    render(<LifecyclePage />);

    await screen.findByText("Could not read this project's practice.");
    expect(screen.queryByTestId('lc-journey')).toBeNull();
  });
});
