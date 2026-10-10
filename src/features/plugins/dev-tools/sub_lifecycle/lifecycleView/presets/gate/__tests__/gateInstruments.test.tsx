import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { mixWithEvidence, testsDetail } from '../../../../journey/__tests__/detailFixtures';
import { ESLINT_ERROR, ESLINT_OUTPUT, instrumentGateDetail, slowingRuns } from '../../../../journey/__tests__/gateFixtures';
import { renderLayer1 } from '../../../layer1/__tests__/renderLayer1';
import { loadStepChunk } from '../../../layer2/stepChunks';
import { LifecycleBody } from '../../../LifecycleBody';
import { __resetGateViewForTests } from '../gateView';
import { RunChart } from '../RunChart';
import { __resetRunOutputsForTests } from '../useRunOutput';

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const setLifecycleStepParams = vi.hoisted(() => vi.fn());
const getLifecycleRunOutput = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, setLifecycleStepParams, getLifecycleHistory, getLifecycleRunOutput }));

const OUTPUTS: Record<string, string | null> = { 'r-eslint-0': ESLINT_OUTPUT, 'r-clippy-0': null, 'r-check-0': null, 'r-check-1': '' };

beforeAll(async () => {
  await Promise.all([loadStepChunk('screen'), loadStepChunk('gate'), loadStepChunk('tests')]);
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  __resetGateViewForTests();
  __resetRunOutputsForTests();
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => (
    stepId === 'gate' ? instrumentGateDetail() : stepId === 'tests' ? testsDetail() : { stepId, runs: [], docs: [], related: [], evidence: [] }
  ));
  getLifecycleRunOutput.mockImplementation(async (_p: string, runId: string) => (runId in OUTPUTS ? OUTPUTS[runId] : 'ok'));
});

const openGate = async (projectId: string) => {
  renderLayer1(<LifecycleBody />, mixWithEvidence({ projectId }), 'gate');
  await screen.findByTestId('lc2-cmd-eslint');
};
const bars = (commandId: string) => screen.getByTestId(`lc2-spark-${commandId}`).querySelectorAll<HTMLElement>('[data-bar]');
const newestBar = (commandId: string) => [...bars(commandId)].pop()!;
const rowIds = () => [...screen.getByTestId('lc6-rows').querySelectorAll('[data-testid^="lc2-cmd-"]')].map((e) => e.getAttribute('data-testid')!.slice(8));

describe('Gate instrument rows', () => {
  it('draws each command’s runs and shows its signals: flaky, slowing (with the filed item)', async () => {
    await openGate('p-w6-rows');
    expect(screen.getByTestId('lc2-spark-tsc').getAttribute('data-points')).toBe('9');
    expect(newestBar('check').getAttribute('data-bar')).toBe('timeout');
    expect(newestBar('clippy').getAttribute('data-bar')).toBe('did_not_run');
    expect(newestBar('tsc').getAttribute('data-bar')).toBe('over');
    expect(screen.getByTestId('lc6-flaky-eslint')).toBeTruthy();
    expect(screen.getByTestId('lc6-slowing-tsc').getAttribute('data-filed')).toBe('true');
    expect(screen.queryByTestId('lc6-flaky-tsc')).toBeNull();
    expect(screen.getByTestId('lc6-chart-legend').textContent).toContain('Timed out');
  });

  it('orders and filters from the toolbar, and remembers the choice for the step', async () => {
    await openGate('p-w6-sort');
    const toolbar = screen.getByTestId('lc6-gate-toolbar');
    fireEvent.click(within(toolbar).getByRole('button', { name: /Least reliable first/ }));
    expect(rowIds()).toEqual(['eslint', 'tsc', 'check', 'clippy']);
    fireEvent.click(within(toolbar).getByRole('button', { name: /Failing/ }));
    expect(rowIds()).toEqual(['eslint', 'check']);
    fireEvent.click(within(toolbar).getByRole('button', { name: /Flaky/ }));
    expect(rowIds()).toEqual(['eslint']);
    expect(toolbar.getAttribute('data-filter')).toBe('flaky');
  });
});

describe('the run viewer', () => {
  it('opens a failed run on its output with the first error marked, and searches next / previous', async () => {
    await openGate('p-w6-viewer');
    fireEvent.click(newestBar('eslint'));
    expect((await screen.findByTestId('lc6-viewer-command')).textContent).toBe('npm run lint');
    expect(screen.getByTestId('lc6-viewer-first-error').textContent).toContain(ESLINT_ERROR);
    const lines = await screen.findByTestId('lc6-output-lines');
    expect(getLifecycleRunOutput).toHaveBeenCalledWith('p-w6-viewer', 'r-eslint-0');
    expect(lines.querySelector('[data-error]')?.textContent).toContain(ESLINT_ERROR);
    expect(lines.querySelector('[data-section="stderr"]')?.textContent).toContain('3 lines');

    fireEvent.change(screen.getByTestId('lc6-output-search'), { target: { value: 'LINT' } });
    const count = screen.getByTestId('lc6-search-count');
    expect(count.textContent).toBe('1 of 3');
    expect(lines.querySelector('[data-current]')?.textContent).toContain('> lint');
    fireEvent.click(screen.getByTestId('lc6-search-next'));
    expect(count.textContent).toBe('2 of 3');
    fireEvent.click(screen.getByTestId('lc6-search-prev'));
    fireEvent.click(screen.getByTestId('lc6-search-prev'));
    expect(count.textContent).toBe('3 of 3');
    fireEvent.change(screen.getByTestId('lc6-output-search'), { target: { value: 'nothing like this' } });
    expect(count.textContent).toBe('No match');
  });

  it('says plainly when no output was kept, and when the command printed nothing', async () => {
    await openGate('p-w6-none');
    fireEvent.click(newestBar('clippy'));
    expect((await screen.findByTestId('lc6-output-none')).textContent).toBe('No output was kept: the command did not run.');
    // Older walks to the run before it on the same command (check's runs are separate).
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByTestId('lc6-viewer')).toBeNull());
    fireEvent.click(bars('check')[bars('check').length - 2]!);
    expect((await screen.findByTestId('lc6-output-empty')).textContent).toBe('The command printed nothing.');
    fireEvent.click(screen.getByTestId('lc6-viewer-newer'));
    await waitFor(() => expect(screen.getByTestId('lc6-viewer').querySelector('[data-run]')?.getAttribute('data-run')).toBe('r-check-0'));
    expect((await screen.findByTestId('lc6-output-none')).textContent).toBe('No output was kept: the command was stopped at its timeout.');
  });
});

describe('inline budget edit', () => {
  it('validates, saves on Enter through setLifecycleStepParams, and says so inline', async () => {
    setLifecycleStepParams.mockResolvedValue({});
    await openGate('p-w6-budget');
    fireEvent.click(screen.getByTestId('lc6-budget-tsc'));
    const input = screen.getByTestId('lc6-budget-input-tsc');
    fireEvent.change(input, { target: { value: 'soon' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(setLifecycleStepParams).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setLifecycleStepParams).toHaveBeenCalledTimes(1));
    const [projectId, stepId, params] = setLifecycleStepParams.mock.calls[0]!;
    expect([projectId, stepId]).toEqual(['p-w6-budget', 'gate']);
    // Auto-detected params are pinned from the history, with only tsc's budget set.
    expect(params.commands.map((c: { id: string; budgetMs: number | null }) => [c.id, c.budgetMs])).toEqual([
      ['tsc', 90_000], ['eslint', null], ['check', null], ['clippy', null],
    ]);
    expect((await screen.findByTestId('lc6-budget-result')).textContent).toContain('now has a 1m 30s budget');
    expect(screen.queryByTestId('lc6-budget-input-tsc')).toBeNull();
  });

  it('cancels on Esc without saving, and keeps the step screen open', async () => {
    await openGate('p-w6-esc');
    fireEvent.click(screen.getByTestId('lc6-budget-eslint'));
    const input = screen.getByTestId('lc6-budget-input-eslint');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('lc6-budget-input-eslint')).toBeNull();
    expect(setLifecycleStepParams).not.toHaveBeenCalled();
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('gate');
  });
});

describe('time travel on the chart', () => {
  it('rings the run of the viewed Measure, and opens a run from the keyboard', () => {
    const onOpen = vi.fn();
    const runs = slowingRuns();
    renderLayer1(
      <RunChart runsNewestFirst={runs} budgetMs={60_000} command="npx tsc --noEmit" slots={12} markRunId="r-tsc-4" onOpen={onOpen} testId="chart" />,
      mixWithEvidence({ projectId: 'p-w6-mark' }),
    );
    const chart = screen.getByTestId('chart');
    const mark = chart.querySelector('[data-mark]')!;
    expect(mark.getAttribute('data-outcome')).toBe('passed');
    // Oldest first: run 4 of 9 newest-first sits at index 4.
    expect(mark.getAttribute('data-mark')).toBe('4');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(runs[3]);
  });
});

describe('Tests coverage instrument', () => {
  it('draws coverage over its runs against the thresholds, with the distance to green', async () => {
    renderLayer1(<LifecycleBody />, mixWithEvidence({ projectId: 'p-w6-cov' }), 'tests');
    const chart = await screen.findByTestId('lc2-coverage-trend');
    expect(chart.getAttribute('data-points')).toBe('2');
    expect(screen.getByTestId('lc6-cov-to-green').textContent).toBe('7 pts to green');
    expect(screen.getByTestId('lc6-cov-change').textContent).toBe('+5 pts over these runs');
    fireEvent.click(chart.querySelector('[data-point="1"]')!);
    expect((await screen.findByTestId('lc6-viewer-command')).textContent).toBe('npm run coverage');
  });
});
