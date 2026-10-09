import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { commitHistory, history, landHistory, NEWEST, snapshotOver, stepDetail } from '../../../../journey/__tests__/evidenceFixtures';
import { stepView } from '../../../../journey/__tests__/fixtures';
import { evidenceRowsFor } from '../../../blocks/evidenceRows';
import { renderLayer1 } from '../../../layer1/__tests__/renderLayer1';
import { loadStepChunk } from '../../../layer2/stepChunks';
import { LifecycleBody } from '../../../LifecycleBody';
import { ChangeDrawer } from '../ChangeDrawer';

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, getLifecycleHistory, setLifecycleStepParams: vi.fn() }));
const ask = vi.hoisted(() => vi.fn());
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => ask }));

// The screen and the preset are lazy chunks; load them once so no test pays the first import.
beforeAll(async () => { await Promise.all([loadStepChunk('screen'), loadStepChunk('generic')]); });

afterEach(() => { vi.useRealTimers(); });

let details: Record<string, ReturnType<typeof landHistory>> = {};
beforeEach(() => {
  // The weeks run to the current one: pin the clock to the fixtures' newest change.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NEWEST);
  vi.clearAllMocks();
  details = {};
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => stepDetail(stepId, details[stepId] ?? []));
});

/** Each test names its own project: the detail cache is module-scoped by project. */
function openLand(projectId: string, count = 60): LifecycleSnapshot {
  details.land = landHistory(count);
  const snap = snapshotOver(details.land, 20, { projectId });
  renderLayer1(<LifecycleBody />, snap, 'land');
  return snap;
}

describe('an evidence step tells the story of its practice', () => {
  it('Land: the rate now with its move, the weeks against the target, too-few weeks hollow', async () => {
    openLand('p-ev-adherence');
    const figure = await screen.findByTestId('lc8-adherence');
    await waitFor(() => expect(Number(screen.getByTestId('lc2-evidence').getAttribute('data-rows'))).toBe(60));
    expect(figure.getAttribute('data-mode')).toBe('week');
    expect(screen.getByTestId('lc2-done-rate').textContent).toContain('40%');
    expect(screen.getByTestId('lc2-done-rate').querySelector('[data-delta="down"]')).toBeTruthy();
    expect(screen.getByTestId('lc8-target')).toBeTruthy();
    const bars = figure.querySelectorAll('[data-testid^="lc8-bar-"]');
    expect(bars.length).toBeGreaterThanOrEqual(9);
    // One change a day: full weeks are judged (7 >= 5), the partial ends may not be.
    expect([...bars].some((b) => b.getAttribute('data-judged') === 'true')).toBe(true);
    // The current week (Monday to Thursday) holds four changes: hollow, too few to judge.
    expect(bars[bars.length - 1]!.getAttribute('data-judged')).toBe('false');
    expect(bars[bars.length - 1]!.getAttribute('data-empty')).toBe('false');
    // The screen reader reads every column as a sentence.
    expect(within(figure.parentElement!.parentElement!).getAllByRole('listitem').length).toBe(bars.length);
  });

  it('Land: the reasons ranked, one question for Athena per reason', async () => {
    openLand('p-ev-reasons');
    const top = await screen.findByTestId('lc8-reason-0');
    await waitFor(() => expect(Number(screen.getByTestId('lc8-reason-0').getAttribute('data-count'))).toBeGreaterThan(10));
    expect(top.textContent).toMatch(/^Pushed straight to main at/);
    expect(top.textContent).toContain('Also written as');
    expect(screen.getByTestId('lc8-reason-1').textContent).toContain('Merged locally; the pull request was never opened');
    expect(screen.getByTestId('lc8-reasons-unexplained').textContent).toContain('Left no note');
    fireEvent.click(screen.getByTestId('lc8-reason-ask-1'));
    expect(ask).toHaveBeenCalledWith('lifecycle', expect.stringContaining('"Merged locally; the pull request was never opened"'));
    expect(ask.mock.calls[0]![1]).toContain('Land');
  });

  it('Land: by source, commits are called out against pull requests', async () => {
    openLand('p-ev-sources');
    await waitFor(() => expect(screen.getByTestId('lc8-source-contrast').textContent).toMatch(/of commits, against 100% of pull requests/));
    expect(screen.getByTestId('lc8-source-pr').getAttribute('data-rate')).toBe('100');
  });

  it('the timeline: chips are counts and filters, the list is virtualised, and filtering keeps only that outcome', async () => {
    openLand('p-ev-timeline', 200);
    await waitFor(() => expect(Number(screen.getByTestId('lc2-evidence').getAttribute('data-rows'))).toBe(200));
    const drawn = screen.getAllByTestId(/^lc2-evidence-row-/);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(40);
    expect(screen.getAllByTestId('lc2-evidence-day').length).toBeGreaterThan(0);

    const timeline = screen.getByTestId('lc8-timeline');
    const skipped = within(timeline).getByRole('button', { name: /Skipped/ });
    fireEvent.click(skipped);
    expect(timeline.getAttribute('data-filter')).toBe('skipped');
    expect(skipped.getAttribute('aria-pressed')).toBe('true');
    const shown = timeline.querySelectorAll('[data-outcome-row]');
    expect(shown.length).toBeGreaterThan(0);
    expect([...shown].every((r) => r.getAttribute('data-outcome-row') === 'skipped')).toBe(true);
    fireEvent.click(skipped);
    expect(timeline.getAttribute('data-filter')).toBe('all');
  });

  it('a change opens in the drawer with its note and what it did on every other step', async () => {
    openLand('p-ev-drawer');
    const row = await screen.findByTestId(/^lc2-evidence-row-task:task-300$/);
    fireEvent.click(within(row).getByRole('button', { name: 'Change 300' }));
    const drawer = await screen.findByTestId('lc8-drawer');
    expect(within(drawer).getByTestId('lc8-drawer-ref').textContent).toBe('task-300');
    expect(within(drawer).getByTestId('lc8-drawer-note').textContent).toBe('No reviewer was available');
    const gate = within(drawer).getByTestId('lc8-drawer-other-gate');
    expect(gate.querySelector('[data-outcome="failed"]')).toBeTruthy();
    expect(gate.textContent).toContain('eslint failed on VaultPage.tsx');
    expect(within(drawer).queryByTestId('lc8-drawer-other-land')).toBeNull();
    fireEvent.click(within(gate).getByRole('button', { name: 'Open Gate' }));
    await waitFor(() => expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('gate'));
  });

  it('Commit, healthy with a dip week: no contrast, a judged dip under the target', async () => {
    details.commit = commitHistory();
    renderLayer1(<LifecycleBody />, snapshotOver(details.commit, 20, { projectId: 'p-ev-commit' }), 'commit');
    const figure = await screen.findByTestId('lc8-adherence');
    await waitFor(() => expect(Number(screen.getByTestId('lc2-evidence').getAttribute('data-rows'))).toBe(56));
    expect(screen.queryByTestId('lc8-source-contrast')).toBeNull();
    const judged = [...figure.querySelectorAll('[data-judged="true"]')];
    expect(judged.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a custom step', () => {
  it('is instructed, and when changes record it, its record follows the instructed note', async () => {
    details['x-review'] = history('x-review', 12, 24, (i) => ({ kind: 'task', outcome: i % 4 === 0 ? 'skipped' : 'done', detail: i % 4 === 0 ? 'No second reviewer' : null }));
    const snap = snapshotOver(details['x-review'], 20, { projectId: 'p-ev-custom' });
    snap.steps = [...snap.steps, stepView('x-review', 'after', [['advisory', 'advisory']])];
    renderLayer1(<LifecycleBody />, snap, 'x-review');
    expect((await screen.findByTestId('lc2-instructed')).textContent).toContain('changes record it too');
    expect(screen.getByTestId('lc8-adherence')).toBeTruthy();
    expect(screen.queryByTestId('lc2-done-rate')).toBeNull();
    expect((await screen.findByTestId('lc8-reason-0')).textContent).toContain('No second reviewer');
  });
});

describe('the change drawer', () => {
  it('a change older than the snapshot window says only this step is known', async () => {
    const detail = landHistory();
    const snap = snapshotOver(detail, 20, { projectId: 'p-ev-older' });
    const old = evidenceRowsFor('land', detail)[45]!;
    renderLayer1(<ChangeDrawer row={old} stepId="land" onClose={() => {}} />, snap);
    expect((await screen.findByTestId('lc8-drawer-others-unknown')).textContent).toContain('only this step');
  });
});
