import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { docsDetail, gateDetail, mixWithEvidence, testsDetail } from '../../../journey/__tests__/detailFixtures';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { LifecycleBody } from '../../LifecycleBody';

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const setLifecycleStepParams = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, setLifecycleStepParams, getLifecycleHistory }));

const DETAILS: Record<string, () => unknown> = { gate: gateDetail, tests: testsDetail, docs: docsDetail };

beforeEach(() => {
  vi.clearAllMocks();
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => DETAILS[stepId]?.() ?? { stepId, runs: [], docs: [], related: [], evidence: [] });
});

// The detail cache is module-scoped and keyed by project, so each test names its own project.
function snap(projectId: string, overrides: Partial<LifecycleSnapshot> = {}) {
  return mixWithEvidence({ projectId, ...overrides });
}

describe('Layer 2: the step screen', () => {
  it('opens in place of Layer 1, and Esc returns with focus on the step key', async () => {
    renderLayer1(<LifecycleBody />, snap('p-open'));
    fireEvent.click(screen.getByTestId('lc-node-land'));
    const screenEl = await screen.findByTestId('lc2-screen');
    expect(screenEl.getAttribute('data-step')).toBe('land');
    expect(screen.queryByTestId('lc-journey-track')).toBeNull();
    expect(screen.getByTestId('lc2-title').textContent).toBe('Land');
    expect(document.activeElement).toBe(screen.getByTestId('lc2-title'));

    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByTestId('lc-journey-track');
    expect(screen.queryByTestId('lc2-screen')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('lc-node-land'));
  });

  it('returns through the trail crumb too', async () => {
    renderLayer1(<LifecycleBody />, snap('p-crumb'), 'record');
    fireEvent.click(await screen.findByTestId('lc2-back'));
    await screen.findByTestId('lc-journey-track');
    expect(document.activeElement).toBe(screen.getByTestId('lc-node-record'));
  });

  it('walks to the neighbouring steps without returning (buttons and arrow keys)', async () => {
    renderLayer1(<LifecycleBody />, snap('p-walk'), 'land');
    fireEvent.click(await screen.findByTestId('lc2-next'));
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('record');
    // Record is the last step: there is no next.
    expect(screen.queryByTestId('lc2-next')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('land');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('commit');
  });

  it('renders a null metric as N/A, never as 0', async () => {
    renderLayer1(<LifecycleBody />, snap('p-na'), 'sync');
    const instrument = await screen.findByTestId('lc2-instrument');
    expect(instrument.querySelector('[data-na="true"]')?.textContent).toBe('N/A');
    expect(instrument.textContent).not.toMatch(/(^|\D)0\s?%/);
  });

  it('shows a detail read failure as an inline banner and keeps the screen', async () => {
    getLifecycleStepDetail.mockRejectedValue(new Error('stub: not implemented'));
    renderLayer1(<LifecycleBody />, snap('p-fail'), 'gate');
    await screen.findByText("Could not read this step's run history.");
    expect(screen.getByTestId('lc2-header')).toBeTruthy();
    // The preset is its own lazy chunk, so its empty band arrives a tick after the header.
    expect(await screen.findByText('The run history could not be read.')).toBeTruthy();
  });

  it('fetches nothing for a step whose preset reads the snapshot only', async () => {
    renderLayer1(<LifecycleBody />, snap('p-generic'), 'isolate');
    await screen.findByTestId('lc2-screen');
    expect(getLifecycleStepDetail).not.toHaveBeenCalled();
  });
});

describe('presets', () => {
  it('gate: one row per command, did-not-run and timeout distinct from failed, the slowest called out', async () => {
    renderLayer1(<LifecycleBody />, snap('p-gate'), 'gate');
    const tsc = await screen.findByTestId('lc2-cmd-tsc');
    const outcome = (id: string) => screen.getByTestId(`lc2-cmd-${id}`).querySelector('[data-outcome]')?.getAttribute('data-outcome');
    expect(outcome('tsc')).toBe('passed');
    expect(outcome('eslint')).toBe('failed');
    expect(outcome('check')).toBe('timeout');
    expect(outcome('clippy')).toBe('did_not_run');
    expect(within(screen.getByTestId('lc2-cmd-check')).getByText('Timed out')).toBeTruthy();
    expect(within(screen.getByTestId('lc2-cmd-clippy')).getByText('Did not run')).toBeTruthy();
    // A non-answer is not a pass-rate vote: the command that never ran has N/A, not 0%.
    expect(within(screen.getByTestId('lc2-cmd-clippy')).getByText('N/A', { selector: '[data-na="true"]' })).toBeTruthy();
    expect(within(tsc).getByText('100%')).toBeTruthy();
    expect(screen.getByTestId('lc2-slowest').textContent).toContain('npx tsc --noEmit');
    expect(screen.getByTestId('lc2-spark-tsc').getAttribute('data-points')).toBe('3');
    expect(screen.getByText(/worktree setup is not included/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('lc2-error-toggle-eslint'));
    expect((await screen.findByTestId('lc2-error-eslint')).textContent).toContain('is defined but never used');
  });

  it('gate: the commands editor saves through setLifecycleStepParams and says so inline', async () => {
    setLifecycleStepParams.mockResolvedValue({});
    renderLayer1(<LifecycleBody />, snap('p-edit'), 'gate');
    await screen.findByTestId('lc2-cmd-tsc');
    fireEvent.click(screen.getByTestId('lc2-commands-edit'));
    // Auto-detected params start the draft from the commands the history shows.
    expect(screen.getByTestId('lc2-draft-command-0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lc2-commands-save'));
    await waitFor(() => expect(setLifecycleStepParams).toHaveBeenCalled());
    const [projectId, stepId, params] = setLifecycleStepParams.mock.calls[0]!;
    expect([projectId, stepId]).toEqual(['p-edit', 'gate']);
    expect(params.commands.map((c: { id: string }) => c.id)).toEqual(['tsc', 'eslint', 'check', 'clippy']);
    expect((await screen.findByTestId('lc2-commands-result')).textContent).toContain('Saved as a new practice version');
  });

  it('tests: coverage drawn when measured', async () => {
    renderLayer1(<LifecycleBody />, snap('p-cov'), 'tests');
    const cov = await screen.findByTestId('lc2-coverage');
    expect(cov.textContent).toContain('63%');
    expect(await screen.findByTestId('lc2-coverage-trend')).toBeTruthy();
    expect(screen.getByText(/Green at 70% or more/)).toBeTruthy();
  });

  it('tests: no coverage is an N/A card that opens the editor with a coverage row', async () => {
    const base = mixWithEvidence();
    const health = base.health.map((h) => (h.stepId === 'tests'
      ? { ...h, metrics: h.metrics.map((m) => (m.key === 'coverage_pct' ? { ...m, value: null, samples: 0 } : m)) }
      : h));
    renderLayer1(<LifecycleBody />, { ...base, projectId: 'p-nocov', health }, 'tests');
    const card = await screen.findByTestId('lc2-coverage-na');
    expect(card.textContent).toContain('Coverage not measured, so Tests cannot be green');
    expect(screen.queryByTestId('lc2-coverage')).toBeNull();
    fireEvent.click(screen.getByTestId('lc2-coverage-add'));
    const rows = screen.getAllByTestId(/^lc2-draft-command-/);
    const last = rows[rows.length - 1] as HTMLInputElement;
    expect(last.value).toBe('');
    expect(last.closest('li')!.textContent).toContain('Coverage');
  });

  it('docs: bullets by status, the clean share drawn, and a change opens in a modal', async () => {
    renderLayer1(<LifecycleBody />, snap('p-docs'), 'docs');
    const broken = await screen.findByTestId('lc2-docs-broken');
    expect(broken.textContent).toContain('docs/features/vault.md');
    expect(broken.textContent).toContain('2 broken references');
    expect(screen.getByTestId('lc2-docs-stale').textContent).toContain('1 changed sources');
    // The clean group starts folded.
    expect(screen.getByTestId('lc2-docs-clean').textContent).not.toContain('README.md');
    expect(screen.getByTestId('lc2-docs-clean').textContent).toContain('Show 2 clean docs');
    const share = screen.getByTestId('lc2-docs-share').textContent ?? '';
    expect(share).toContain('92%');
    expect(share).toContain('of 38 verifiable docs');

    // The change log lists only changes with a docs outcome.
    const log = screen.getByTestId('lc2-docs-log');
    expect(log.textContent).toContain('Rename the vault store');
    expect(log.textContent).not.toContain('Tidy the home page');
    fireEvent.click(within(screen.getByTestId('lc2-docs-log-row-commit:f00dbabe1234567')).getByRole('button'));
    expect((await screen.findByTestId('lc2-change-ref')).textContent).toBe('f00dbabe1234567');
    expect(screen.getByText('Docs that need work now')).toBeTruthy();
  });

  it('generic: done rate, the tally as units, and the evidence with its notes', async () => {
    renderLayer1(<LifecycleBody />, snap('p-land'), 'land');
    expect((await screen.findByTestId('lc2-done-rate')).textContent).toContain('40%');
    const tally = screen.getByTestId('lc2-tally');
    expect(tally.querySelector('[data-kit="UnitStrip"]')).toBeTruthy();
    const evidence = screen.getByTestId('lc2-evidence');
    expect(evidence.textContent).toContain('Merged locally without a pull request');
    expect(evidence.textContent).toContain('The merge was reverted');
    // A null note renders nothing (no lone dot, no placeholder).
    expect(screen.queryByTestId('lc2-evidence-detail-task:task-42')).toBeNull();
    expect(screen.getByTestId('lc2-evidence-row-task:task-42')).toBeTruthy();
  });

  it('generic: an instructed step says so and shows its rule', async () => {
    renderLayer1(<LifecycleBody />, snap('p-frame'), 'frame');
    expect((await screen.findByTestId('lc2-instructed')).textContent).toContain('Followed by instruction, nothing to measure');
    expect(screen.getByTestId('lc2-rule').textContent).toContain('Rule for frame.');
  });
});
