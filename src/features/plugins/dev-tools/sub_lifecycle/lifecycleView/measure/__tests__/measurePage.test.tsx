import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { _setDocumentHiddenForTests, _tickerStateForTests } from '@/hooks/utility/timing/relativeTimeTicker';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

import { healthyMix } from '../../../journey/__tests__/fixtures';
import { cmd, midMeasure, NOW, progress } from './progressFixtures';

// The page through a whole Measure against a stubbed lifecycle API: the
// header's control in one footprint, Cancel pressed twice, the panel in the
// band's slot, the rail holding Gate's verdict until the last run lands, the
// summary (changed / unchanged / cancelled / failure named), the live region,
// the "nothing to measure" way to the Commands editor, and the ticker.

const api = vi.hoisted(() => ({
  getLifecycle: vi.fn(),
  getLifecycleHistory: vi.fn(),
  getLifecycleStepDetail: vi.fn(),
  measureLifecycle: vi.fn(),
  cancelLifecycleMeasure: vi.fn(),
  installLifecycle: vi.fn(),
  setLifecycleStepParams: vi.fn(),
}));
let activeProjectId: string | null = 'p1';

vi.mock('@/api/devTools/lifecycle', () => api);
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => vi.fn() }));
vi.mock('../../../LifecycleProjectPicker', () => ({ LifecycleProjectPicker: () => null }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeProjectId, projects: [{ id: activeProjectId, name: 'Acme', root_path: 'C:/acme', github_url: null }] }),
}));

import LifecyclePage from '../../../LifecyclePage';

const ESLINT_ERROR = "src/a.ts:4:1  error  'x' is never used";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.getLifecycleHistory.mockResolvedValue({ measures: [], stepIds: ['gate', 'tests'] });
  api.getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => ({
    stepId, docs: [], related: [], evidence: [],
    runs: stepId === 'gate' ? [{
      id: 'r1', projectId: 'p', measureId: 'm-live', commandId: 'eslint', command: 'npm run lint', kind: 'lint', outcome: 'failed',
      exitCode: 1, durationMs: 18_000, valuePct: null, firstError: ESLINT_ERROR, headSha: 'a1b2c3d', startedAt: '2026-10-08T09:58:00Z', finishedAt: '2026-10-08T09:58:18Z',
    }] : [],
  }));
  api.cancelLifecycleMeasure.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  _setDocumentHiddenForTests(null);
});

/** Each test its own project id, so the module caches never leak between tests. */
function project(id: string, snap: LifecycleSnapshot) {
  activeProjectId = id;
  api.getLifecycle.mockResolvedValue({ ...snap, projectId: id });
}

/** The next snapshot the page reads, as a `dev_lifecycle_*` change would bring it. */
async function next(snap: LifecycleSnapshot) {
  api.getLifecycle.mockResolvedValue({ ...snap, projectId: activeProjectId });
  await act(async () => { useDevToolsLiveStore.getState().markLifecycleChanged(); });
}

const measuring = (over: Partial<LifecycleSnapshot> = {}) => healthyMix({ measuring: true, progress: midMeasure(), ...over });

/** Gate recovered: At risk -> Healthy, pass rate 90 -> 100. */
function recovered(): LifecycleSnapshot {
  const after = healthyMix();
  after.health = after.health.map((h) => (h.stepId === 'gate'
    ? { ...h, health: 'green', reason: null, metrics: [{ key: 'median_ms', value: 50_000, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }] }
    : h));
  return after;
}

describe('a Measure on the page', () => {
  it('turns the Measure button into the live control in the same slot', async () => {
    project('p-m-slot', healthyMix());
    render(<LifecyclePage />);
    const slot = await screen.findByTestId('lc-measure-slot');
    await waitFor(() => expect(screen.getByTestId('lc-measure').hasAttribute('disabled')).toBe(false));
    expect(screen.queryByTestId('lc-measure-progress')).toBeNull();

    await next(measuring());
    const control = await screen.findByTestId('lc-measure-progress');
    expect(screen.getByTestId('lc-measure-slot')).toBe(slot);
    expect(slot.contains(control)).toBe(true);
    expect(screen.getByTestId('lc-measure-count').textContent).toBe('2 of 5');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    // The idle button keeps its place in the slot (hidden), so the width never changes.
    expect(slot.contains(screen.getByTestId('lc-measure'))).toBe(true);
  });

  it('cancels once: a second press while cancelling does nothing', async () => {
    project('p-m-cancel', measuring());
    render(<LifecyclePage />);
    const cancel = await screen.findByTestId('lc-measure-cancel');
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.getByTestId('lc-measure-count').textContent).toBe('Cancelling'));
    fireEvent.click(screen.getByTestId('lc-measure-cancel'));
    expect(api.cancelLifecycleMeasure).toHaveBeenCalledTimes(1);
    expect(api.cancelLifecycleMeasure).toHaveBeenCalledWith('p-m-cancel');
  });

  it('shows the panel in the status band slot, one row per command with its time against its median', async () => {
    project('p-m-panel', measuring());
    render(<LifecyclePage />);
    const panel = await screen.findByTestId('lc-measure-panel');
    expect(screen.queryByTestId('lc1-status')).toBeNull();
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[2]!.textContent).toContain('40s of ~1m');
    expect(rows[4]!.textContent).toContain('No estimate');
    expect(screen.getByTestId('lc-measuring-eta').textContent).toBe('about 1m 50s left, plus 1 with no estimate');
  });

  it('holds Gate at its verdict until the last run lands, then says what changed and names the failure', async () => {
    project('p-m-summary', healthyMix());
    render(<LifecyclePage />);
    await screen.findByTestId('lc1-status');

    // Mid-Measure the backend already judges Gate green: the card must not say so yet.
    await next({ ...recovered(), measuring: true, progress: midMeasure() });
    const gate = await screen.findByTestId('lc-measure-panel').then(() => document.querySelector('[data-card="gate"]')!);
    expect(gate.getAttribute('data-measuring')).toBe('true');
    expect(gate.textContent).toContain('Measuring, 2 of 3');
    expect(gate.textContent).toContain('90');

    await next(recovered());
    const changed = await screen.findByTestId('lc-measure-changed');
    expect(changed.textContent).toMatch(/^Measured in .+: Gate At risk → Healthy/);
    await waitFor(() => expect(screen.getByTestId('lc-measure-failure').textContent).toContain(`eslint failed: ${ESLINT_ERROR}`));
    expect(document.querySelector('[data-card="gate"]')!.getAttribute('data-settle')).toBe('true');
    expect(screen.getByTestId('lc1-verdict-gate').textContent).toContain('Healthy');
    expect(screen.getByTestId('lc-measure-live').textContent).toMatch(/^Measure finished in .+\. Gate At risk → Healthy.*eslint failed\.$/);

    // Dismissed, the band returns.
    fireEvent.click(screen.getByTestId('lc-measure-dismiss'));
    expect(await screen.findByTestId('lc1-status')).toBeTruthy();
  });

  it('says no verdict changed, and how many commands a cancel left unrun', async () => {
    const clean = progress([
      cmd({ commandId: 'tsc', kind: 'typecheck', state: 'done', outcome: 'passed', durationMs: 50_000 }),
      cmd({ commandId: 'vitest', kind: 'test', state: 'running', startedAt: new Date(NOW - 5_000).toISOString() }),
      cmd({ commandId: 'check', kind: 'check', state: 'pending' }),
    ]);
    project('p-m-cancelled', healthyMix());
    render(<LifecyclePage />);
    await screen.findByTestId('lc1-status');
    await next(healthyMix({ measuring: true, progress: clean }));
    fireEvent.click(await screen.findByTestId('lc-measure-cancel'));
    await next(healthyMix());
    expect((await screen.findByTestId('lc-measure-changed')).textContent).toMatch(/^Cancelled after .+: no verdict changed, and no figure moved\.$/);
    expect(screen.getByTestId('lc-measure-cancelled').textContent).toBe('Cancelled: 2 commands did not run');
  });

  it('offers the Commands editor when there is nothing to measure', async () => {
    project('p-m-nothing', healthyMix());
    api.measureLifecycle.mockRejectedValueOnce({ error: 'nothing to measure: no gate or test commands', kind: 'not_found' });
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lc-measure').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('lc-measure'));
    expect((await screen.findByTestId('lc-measure-note')).textContent).toContain('Nothing to measure');
    fireEvent.click(await screen.findByTestId('lc-measure-setup'));
    expect((await screen.findByTestId('lc2-screen')).getAttribute('data-step')).toBe('gate');
    expect(await screen.findByTestId('lc2-commands-save', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('ticks on the shared ticker, which stops while the window is hidden', async () => {
    project('p-m-ticker', measuring());
    render(<LifecyclePage />);
    await screen.findByTestId('lc-measure-progress');
    expect(_tickerStateForTests().running).toBe(true);
    act(() => _setDocumentHiddenForTests(true));
    expect(_tickerStateForTests().running).toBe(false);
    act(() => _setDocumentHiddenForTests(false));
    expect(_tickerStateForTests().running).toBe(true);
  });
});
