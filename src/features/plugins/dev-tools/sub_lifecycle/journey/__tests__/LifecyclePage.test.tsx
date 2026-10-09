import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { evidenceItem, healthyMix, soloV0, stepView } from './fixtures';

// The page against a stubbed lifecycle API: Solo v0, a snapshot with a
// missing binding (Install offered), a measured snapshot (the headline by
// health), Layer 2 opened from the rail, and a failed read (inline banner).

// Reduced motion where a test asserts a layer is GONE: with motion, the step's key flies between
// the layers (a shared layout animation jsdom cannot finish), so the outgoing layer stays mounted.
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => motion.reduced,
}));

const getLifecycle = vi.hoisted(() => vi.fn());
const installLifecycle = vi.hoisted(() => vi.fn());
const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const measureLifecycle = vi.hoisted(() => vi.fn());
const askAthena = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
let activeProjectId: string | null = 'p1';

const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
const detectLifecycleCommands = vi.hoisted(() => vi.fn(async () => [{ id: 'lint', command: 'npm run lint', kind: 'lint', budgetMs: null }]));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle, installLifecycle, getLifecycleStepDetail, measureLifecycle, getLifecycleHistory, detectLifecycleCommands }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }), {
    getState: () => ({ addToast }),
  }),
}));
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
import { loadStepChunk } from '../../lifecycleView/layer2/stepChunks';

// The step screen's chunks are transformed once, up front: under a full parallel run a cold
// transform outlasted a one-second wait for the screen.
beforeAll(async () => {
  await Promise.all([loadStepChunk('screen'), loadStepChunk('gate'), loadStepChunk('generic')]);
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  activeProjectId = 'p1';
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => ({ stepId, runs: [], docs: [], related: [], evidence: [] }));
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
    // Never measured: the first-run setup holds the status slot, over what detection found.
    expect(await screen.findByTestId('lc10-setup-row-lint')).toBeTruthy();
    expect(screen.queryByTestId('lc-weakest')).toBeNull();
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
    // The recent outcomes live in the card's peek (layer one has no room for 6px beads).
    fireEvent.focus(screen.getByTestId('lc-node-gate'));
    expect((await screen.findByTestId('lc-dots-gate')).querySelector('[data-outcome="skipped"]')).toBeTruthy();
    fireEvent.blur(screen.getByTestId('lc-node-gate'));

    fireEvent.click(screen.getByTestId('lc-install'));
    fireEvent.click(await screen.findByTestId('lc-install-confirm-go'));
    await waitFor(() => expect(installLifecycle).toHaveBeenCalledWith('p-missing'));
    // The result is said inline beside the action, never as a toast.
    expect((await screen.findByTestId('lc-install-note')).textContent).toBe('Install task started (task-7)');
    expect(addToast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('lc-ask-athena'));
    expect(askAthena).toHaveBeenCalledWith('lifecycle', expect.stringContaining('Acme (id p-missing)'));
  });

  it('names the weakest step by measured health, not by binding', async () => {
    project('p-health', healthyMix());
    render(<LifecyclePage />);

    const line = await screen.findByTestId('lc-weakest');
    // Docs is advisory-only (the weakest BINDING) but measures healthy; Land is red.
    expect(line.textContent).toBe('Land is the weakest step: failing. Done in 40% of recent changes, 80% needed.');
    expect(line.getAttribute('data-health')).toBe('red');
    fireEvent.click(screen.getByTestId('lc-ask-athena'));
    expect(askAthena).toHaveBeenCalledWith('lifecycle', expect.stringContaining('The weakest step is Land.'));
  });

  it('says every measured step is healthy when nothing is red, stale, amber or unmeasured', async () => {
    const mix = healthyMix();
    project('p-green', { ...mix, health: mix.health.map((h) => (h.health === 'instructed' ? h : { ...h, health: 'green' as const })) });
    render(<LifecyclePage />);
    expect((await screen.findByTestId('lc-weakest')).textContent).toBe('Every measured step is healthy.');
  });

  // The owner's note, 2026-10-06, still holds: a node click must NOT open a
  // drawer. Since WP4 it opens the step's Layer-2 screen IN PLACE of the rail.
  it('opens a step in place, with no drawer, and returns', async () => {
    motion.reduced = true;
    project('p-detail', soloV0());
    render(<LifecyclePage />);

    fireEvent.click(await screen.findByTestId('lc-node-gate'));
    const screenEl = await screen.findByTestId('lc2-screen');
    expect(screenEl.textContent).toContain('Rule for gate.');
    expect(screenEl.textContent).toContain('Git hook');
    expect(screen.queryByTestId('lc-step-detail')).toBeNull();
    expect(screen.queryByTestId('lc-journey-track')).toBeNull();

    fireEvent.click(screen.getByTestId('lc2-back'));
    expect(await screen.findByTestId('lc-journey-track')).toBeTruthy();
    expect(screen.getByTestId('lc-node-gate').getAttribute('aria-pressed')).toBe('true');
  });

  it("lists a step's evidence on its screen", async () => {
    project('p-ledger', soloV0({
      evidence: [
        evidenceItem('c1', '2026-09-25T10:00:00Z', [['commit', 'skipped']]),
        evidenceItem('c2', '2026-09-26T10:00:00Z', [['commit', 'done']]),
      ],
      steps: [stepView('commit', 'after', [['hook', 'live']], { skipped: 1, done: 1 })],
    }));
    render(<LifecyclePage />);

    fireEvent.click(await screen.findByTestId('lc-node-commit'));
    const evidence = await screen.findByTestId('lc2-evidence');
    expect(evidence.textContent).toContain('Change c1');
    expect(evidence.textContent).toContain('Change c2');
    expect(evidence.querySelector('[data-outcome="skipped"]')).toBeTruthy();
    expect(evidence.querySelector('[data-outcome="done"]')).toBeTruthy();
  });

  it('starts a Measure, spins while the snapshot says measuring, and says a refusal inline', async () => {
    project('p-measure', healthyMix());
    measureLifecycle.mockRejectedValueOnce(new Error("another project's Measure is running; one runs at a time"));
    const { unmount } = render(<LifecyclePage />);

    fireEvent.click(await screen.findByTestId('lc-measure'));
    await waitFor(() => expect(screen.getByTestId('lc-measure-note').textContent).toContain('Measure did not start'));
    expect(measureLifecycle).toHaveBeenCalledWith('p-measure');
    expect(addToast).not.toHaveBeenCalled();
    unmount();

    project('p-measuring', { ...healthyMix(), measuring: true });
    render(<LifecyclePage />);
    expect((await screen.findByTestId('lc-measure')).hasAttribute('disabled')).toBe(true);
  });

  it('heads the page with the project, the practice and how fresh its measurement is', async () => {
    project('p-head-never', soloV0());
    const { unmount } = render(<LifecyclePage />);
    const never = await screen.findByTestId('lc-freshness');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme');
    expect(screen.getByTestId('lc-practice').textContent).toBe('Solo practice, default');
    expect(never.getAttribute('data-freshness')).toBe('never');
    expect(never.textContent).toBe('Never measured');
    unmount();

    project('p-head-current', healthyMix());
    const second = render(<LifecyclePage />);
    const current = await screen.findByTestId('lc-freshness');
    expect(current.getAttribute('data-freshness')).toBe('current');
    expect(current.textContent).toMatch(/^Measured .+ on a1b2c3d, up to date with master$/);
    expect(current.className).not.toContain('text-status-warning');
    second.unmount();

    const mix = healthyMix();
    project('p-head-behind', { ...mix, tip: { ...mix.tip!, measuredSha: 'ffff0000aaaa', commitsBehind: 14 } });
    render(<LifecyclePage />);
    const behind = await screen.findByTestId('lc-freshness');
    expect(behind.getAttribute('data-freshness')).toBe('behind');
    expect(behind.textContent).toMatch(/^Measured .+, 14 commits behind master$/);
    expect(behind.className).toContain('text-status-warning');
  });

  it('says nothing about freshness when no base branch resolves', async () => {
    project('p-head-norepo', { ...healthyMix(), tip: null });
    render(<LifecyclePage />);
    await screen.findByTestId('lc-practice');
    expect(screen.queryByTestId('lc-freshness')).toBeNull();
  });

  it('holds every header control at its place while the snapshot loads', async () => {
    activeProjectId = 'p-head-loading';
    getLifecycle.mockReturnValue(new Promise(() => {}));
    render(<LifecyclePage />);
    // The cluster is chrome: present, disabled, before any data.
    expect(screen.getByTestId('lc-measure').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('lc-overseer-send').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('lc-ask-athena').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('lc1-ghost')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme');
  });

  it('shows an inline error when the read fails', async () => {
    activeProjectId = 'p-error';
    getLifecycle.mockRejectedValue(new Error('boom'));
    render(<LifecyclePage />);

    await screen.findByText("Could not read this project's practice.");
    // The chrome stays (the action row and the banner are permanent); what a
    // failed read must NOT produce is a timeline or a selected step.
    expect(screen.queryByTestId('lc-journey-track')).toBeNull();
    expect(screen.queryByTestId('lc2-screen')).toBeNull();
  });
});
