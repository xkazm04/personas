import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { useSystemStore } from '@/stores/systemStore';

import { evidenceItem } from '../../../journey/__tests__/fixtures';
import { mixWithEvidence, run } from '../../../journey/__tests__/detailFixtures';
import { gateDetailByMeasure, sixMeasures } from '../../history/__tests__/historyFixtures';
import { __resetHistoryCacheForTests } from '../../history/useLifecycleHistory';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { ProjectLens } from '../../lens/ProjectLens';
import { loadStepChunk } from '../stepChunks';

// Wave 5: the step screen's shell - the mini-map, the band under the time
// cursor, the Next panel, the backlog items, and the key that flies between
// the layers.

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => motion.reduced,
}));

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn());
const setLifecycleStepParams = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, getLifecycleHistory, setLifecycleStepParams }));
const getIdea = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/devTools', () => ({ getIdea }));

const ITEMS = [
  { id: 'i-slow', title: 'tsc is slow', status: 'accepted', verifyState: null, source: 'slow_gate' as const, commandId: 'tsc', createdAt: '2026-10-08T08:00:00Z' },
  { id: 'i-ov', title: 'Bring Gate back to green', status: 'pending', verifyState: null, source: 'overseer' as const, commandId: null, createdAt: '2026-10-08T07:00:00Z' },
];

function gateWithItems() {
  const d = gateDetailByMeasure();
  // The newest Measure: eslint failed, tsc passed over its 60s budget.
  d.runs = [run('eslint', 'lint', 'failed', 20_000, { measureId: 'm-h6', firstError: 'src/a.ts:1:1  error  boom' }), ...d.runs];
  return { ...d, related: ITEMS, evidence: [] };
}

// The screen and preset chunks are transformed once, up front: a cold transform is not what these tests time.
// So is the dev-tools API an item press imports on demand (`related/relatedItem`): under a full
// parallel run its first import outlasted waitFor's one second.
beforeAll(async () => {
  await Promise.all([
    loadStepChunk('screen'), loadStepChunk('gate'), loadStepChunk('docs'), loadStepChunk('generic'), loadStepChunk('tests'),
    import('@/api/devTools/devTools'),
  ]);
}, 30_000);

beforeEach(() => {
  __resetHistoryCacheForTests();
  vi.clearAllMocks();
  motion.reduced = false;
  // An item read that never answers: the tests check what is asked, not the backlog's dialog.
  getIdea.mockReturnValue(new Promise(() => {}));
  getLifecycleHistory.mockImplementation(async () => sixMeasures());
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => {
    if (stepId === 'gate') return gateWithItems();
    if (stepId === 'record') {
      const done = (ref: string) => evidenceItem(ref, '2026-10-08T08:00:00Z', [['record', 'done']]);
      return { stepId, runs: [], docs: [], related: [], evidence: [done('a'), done('b'), done('c')] };
    }
    return { stepId, runs: [], docs: [], related: [], evidence: [] };
  });
});

describe('the band', () => {
  it('shows the viewed Measure: its verdict, reason and metrics, and the travel lead; Back to now returns', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-band' }), 'gate');
    const header = await screen.findByTestId('lc2-header');
    expect(header.getAttribute('data-health')).toBe('amber');
    await waitFor(() => expect(screen.getAllByTestId(/^lc2-strip-col-\d+$/)).toHaveLength(6));

    fireEvent.click(screen.getByTestId('lc2-strip-col-2'));
    await waitFor(() => expect(header.getAttribute('data-travel')).toBe('then'));
    expect(header.getAttribute('data-health')).toBe('red');
    expect(screen.getByTestId('lc2-reason').textContent).toBe('gate red at 3');
    expect(screen.getByTestId('lc2-instrument').textContent).toContain('50%');
    expect(screen.getByTestId('lc2-band-travel').getAttribute('data-measure')).toBe('m-h3');

    fireEvent.click(screen.getByTestId('lc2-band-now'));
    await waitFor(() => expect(header.getAttribute('data-health')).toBe('amber'));
    expect(header.getAttribute('data-travel')).toBeNull();
    expect(screen.getByTestId('lc2-band-meta')).toBeTruthy();
  });

  it('a step the history does not track says it is shown as it is now', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-untracked' }), 'gate');
    await waitFor(() => expect(screen.getAllByTestId(/^lc2-strip-col-\d+$/)).toHaveLength(6));
    fireEvent.click(screen.getByTestId('lc2-strip-col-2'));
    // Walk to Land (gate -> tests -> docs -> commit -> land) without leaving the Measure.
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect((await screen.findByTestId('lc2-band-untracked')).textContent).toContain('Not tracked in history');
    expect(screen.getByTestId('lc2-header').getAttribute('data-health')).toBe('red');
  });
});

describe('Next', () => {
  it('leads with the failing command; Open the run opens that row with its error', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-next' }), 'gate');
    const failing = await screen.findByTestId('lc2-next-failing');
    expect(failing.textContent).toContain('npm run lint failed');
    expect(failing.textContent).toContain('boom');
    const kinds = [...screen.getByTestId('lc2-next').querySelectorAll('[data-next]')].map((e) => e.getAttribute('data-next'));
    expect(kinds).toEqual(['failing', 'over_budget']);
    expect(screen.getByTestId('lc2-next-over_budget').textContent).toContain('14s over budget');
    expect(screen.queryByTestId('lc2-error-eslint')).toBeNull();
    fireEvent.click(screen.getByTestId('lc2-next-run-eslint'));
    expect((await screen.findByTestId('lc2-error-eslint')).textContent).toContain('boom');
  });

  it('names the slow-gate item already filed and the Overseer items, each opening the item', async () => {
    getIdea.mockRejectedValueOnce(new Error('database is locked'));
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-items' }), 'gate');
    const filed = await screen.findByTestId('lc2-next-over_budget-detail');
    expect(filed.textContent).toContain('Filed as a backlog item:');
    expect(filed.textContent).toContain('tsc is slow (Accepted)');
    expect(screen.getByTestId('lc2-next-overseer').textContent).toContain('Bring Gate back to green');
    fireEvent.click(screen.getByTestId('lc2-item-link-i-slow'));
    await waitFor(() => expect(getIdea).toHaveBeenCalledWith('i-slow'));
    // A read that fails is said on the screen, under the items.
    await waitFor(() => expect(screen.getByTestId('lc2-related-note').textContent).not.toBe(''));
  });

  it('a healthy step gets one calm line with its streak and nothing else', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-healthy' }), 'record');
    expect((await screen.findByTestId('lc2-next-healthy')).textContent).toBe('Healthy: done in each of the last 3 changes');
    expect(screen.getByTestId('lc2-next').querySelectorAll('[data-next]')).toHaveLength(0);
  });
});

describe('backlog items about the step', () => {
  it('lists them with source, status and time; a row opens the item; the backlog link goes to the list', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-related' }), 'gate');
    const list = await screen.findByTestId('lc2-related');
    expect(within(list).getByTestId('lc2-related-i-slow').textContent).toContain('Slow gate');
    expect(within(list).getByTestId('lc2-related-i-ov').querySelector('[data-status="pending"]')).not.toBeNull();
    fireEvent.click(within(screen.getByTestId('lc2-related-i-ov')).getAllByRole('button')[0]!);
    await waitFor(() => expect(getIdea).toHaveBeenCalledWith('i-ov'));

    fireEvent.click(screen.getByTestId('lc2-related-backlog'));
    expect(useSystemStore.getState().pendingApprovalsMode).toBe('backlog');
    expect(useSystemStore.getState().sidebarSection).toBe('overview');
  });

  it('renders nothing when the step has none', async () => {
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-none' }), 'docs');
    await screen.findByTestId('lc2-screen');
    await waitFor(() => expect(getLifecycleStepDetail).toHaveBeenCalledWith('p-none', 'docs'));
    expect(screen.queryByTestId('lc2-related')).toBeNull();
  });
});

describe('the step and its columns', () => {
  it('opens from its lit column, and under reduced motion Esc returns to the columns at once', async () => {
    motion.reduced = true;
    renderLayer1(<ProjectLens />, mixWithEvidence({ projectId: 'p-still' }));
    fireEvent.click(screen.getByTestId('lens-col-gate'));
    fireEvent.click(screen.getByTestId('lens-col-gate'));
    await screen.findByTestId('lc2-header');
    expect(screen.queryByTestId('lens-field')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByTestId('lens-field', {}, { timeout: 3000 });
    expect(screen.queryByTestId('lc2-screen')).toBeNull();
  });
});
