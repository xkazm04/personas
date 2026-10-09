import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// Wave 10: the first-run setup in Layer 1's status slot - what detection found
// as a checklist grouped by step, the coverage suggestions (never saved on
// their own), Save and Measure (each step's commands, then a Measure),
// Measure with these (nothing saved), the empty state, and the measured
// project that gets the status plate instead.

const api = vi.hoisted(() => ({
  detectLifecycleCommands: vi.fn(),
  setLifecycleStepParams: vi.fn(),
  measureLifecycle: vi.fn(),
  getLifecycleHistory: vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })),
}));
vi.mock('@/api/devTools/lifecycle', () => api);
vi.mock('../../layer2/stepChunks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer2/stepChunks')>()),
  prefetchStepChunksOnIdle: () => () => {},
}));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';

import { healthyMix, soloV0 } from '../../../journey/__tests__/fixtures';
import { Layer1 } from '../Layer1';
import { coverageTemplates, needsSetup } from '../setup/setupModel';
import { __resetSetupCacheForTests } from '../setup/useSetup';
import { renderLayer1 } from './renderLayer1';

const dl = en.plugins.dev_lifecycle;

const cmd = (id: string, command: string, kind: LifecycleGateCommand['kind']): LifecycleGateCommand => ({ id, command, kind, budgetMs: null });
const DETECTED = [
  cmd('lint', 'npm run lint', 'lint'),
  cmd('tsc', 'npm run tsc', 'typecheck'),
  cmd('test', 'npm run test', 'test'),
  cmd('cargo-test', 'cargo test --manifest-path src-tauri/Cargo.toml', 'test'),
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetSetupCacheForTests();
  api.detectLifecycleCommands.mockResolvedValue(DETECTED);
  api.setLifecycleStepParams.mockImplementation(async () => soloV0());
  api.measureLifecycle.mockResolvedValue({ measureId: 'm1' });
});

const rowIds = (group: HTMLElement) =>
  [...group.querySelectorAll('[data-testid^="lc10-setup-row-"]')].map((r) => r.getAttribute('data-testid')!.replace('lc10-setup-row-', ''));

async function openSetup(projectId: string) {
  const view = renderLayer1(<Layer1 />, soloV0({ projectId }));
  await screen.findByTestId('lc10-setup-row-lint');
  return view;
}

describe('when the setup shows', () => {
  it('shows for a project never measured, and the status plate for a measured one', () => {
    expect(needsSetup(soloV0())).toBe(true);
    expect(needsSetup(healthyMix())).toBe(false);
    renderLayer1(<Layer1 />, healthyMix({ projectId: 'p-measured' }));
    expect(screen.getByTestId('lc1-status')).toBeTruthy();
    expect(screen.queryByTestId('lc10-setup')).toBeNull();
    expect(api.detectLifecycleCommands).not.toHaveBeenCalled();
  });
});

describe('the checklist', () => {
  it('lists what detection found, grouped by step, each on, with its kind', async () => {
    await openSetup('p-list');
    expect(screen.getByRole('heading', { name: dl.lcx10_setup_title })).toBeTruthy();
    expect(rowIds(screen.getByTestId('lc10-setup-group-gate'))).toEqual(['lint', 'tsc']);
    expect(rowIds(screen.getByTestId('lc10-setup-group-tests'))).toEqual(['test', 'cargo-test']);
    const tsc = screen.getByTestId('lc10-setup-row-tsc');
    expect(tsc.querySelector('[data-kind="typecheck"]')!.textContent).toBe(dl.lc2_kind_typecheck);
    expect(within(tsc).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByTestId('lc10-setup-group-gate')).getByText(dl.lcx10_setup_detected)).toBeTruthy();
  });

  it('suggests coverage commands from the stack it found; Add puts one on the list and saves nothing', async () => {
    await openSetup('p-tpl');
    expect(screen.getByTestId('lc10-setup-tpl-vitest').textContent).toContain('npx vitest run --coverage --coverage.reporter=text-summary');
    expect(screen.getByTestId('lc10-setup-tpl-jest').textContent).toContain('npx jest --coverage --coverageReporters=text-summary');
    expect(screen.getByTestId('lc10-setup-tpl-llvm-cov').textContent).toContain(dl.lcx10_tpl_needs_install);
    fireEvent.click(screen.getByTestId('lc10-setup-add-vitest'));
    expect(rowIds(screen.getByTestId('lc10-setup-group-tests'))).toEqual(['test', 'cargo-test', 'tpl-vitest']);
    expect(screen.getByTestId('lc10-setup-row-tpl-vitest').textContent).toContain(dl.lcx10_setup_suggested);
    // One coverage command is enough: the alternatives go.
    expect(screen.queryByTestId('lc10-setup-suggestions')).toBeNull();
    expect(screen.getByTestId('lc10-setup-measure').textContent).toBe(dl.lcx10_setup_measure_unsaved);
    expect(api.setLifecycleStepParams).not.toHaveBeenCalled();
  });

  it('picks the stack its manifests show (Jest first when the stack says Jest; a pnpm runner; none with coverage)', () => {
    const rows = [{ command: 'pnpm run test', kind: 'test' as const }];
    expect(coverageTemplates(rows, 'TypeScript, Jest').map((t) => t.command)).toEqual([
      'pnpm exec jest --coverage --coverageReporters=text-summary',
      'pnpm exec vitest run --coverage --coverage.reporter=text-summary',
    ]);
    expect(coverageTemplates([{ command: 'cargo test', kind: 'test' }], null).map((t) => t.command)).toEqual(['cargo llvm-cov --summary-only']);
    expect(coverageTemplates([...rows, { command: 'pnpm run coverage', kind: 'coverage' }], null)).toEqual([]);
  });
});

describe('the ways on', () => {
  it('Save and Measure writes each step its commands that are on, then starts a Measure', async () => {
    await openSetup('p-save');
    fireEvent.click(within(screen.getByTestId('lc10-setup-row-cargo-test')).getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Budget for npm run lint, in seconds'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('lc10-setup-add-vitest'));
    await act(async () => { fireEvent.click(screen.getByTestId('lc10-setup-save')); });
    await waitFor(() => expect(api.measureLifecycle).toHaveBeenCalledWith('p-save'));
    expect(api.setLifecycleStepParams).toHaveBeenCalledTimes(2);
    const [gateCall, testsCall] = api.setLifecycleStepParams.mock.calls;
    expect(gateCall![1]).toBe('gate');
    expect(gateCall![2].commands).toEqual([
      { id: 'lint', command: 'npm run lint', kind: 'lint', budgetMs: 90_000 },
      { id: 'tsc', command: 'npm run tsc', kind: 'typecheck', budgetMs: null },
    ]);
    expect(testsCall![1]).toBe('tests');
    expect(testsCall![2].commands.map((c: LifecycleGateCommand) => [c.command, c.kind])).toEqual([
      ['npm run test', 'test'],
      ['npx vitest run --coverage --coverage.reporter=text-summary', 'coverage'],
    ]);
    // Saved first, measured after.
    expect(api.setLifecycleStepParams.mock.invocationCallOrder[1]!).toBeLessThan(api.measureLifecycle.mock.invocationCallOrder[0]!);
  });

  it('a budget that is not a number holds the save and says why', async () => {
    await openSetup('p-bad');
    fireEvent.change(screen.getByLabelText('Budget for npm run tsc, in seconds'), { target: { value: 'soon' } });
    await act(async () => { fireEvent.click(screen.getByTestId('lc10-setup-save')); });
    expect(screen.getByTestId('lc10-setup-note').textContent).toBe(dl.lc2_field_budget_invalid);
    expect(screen.getByLabelText('Budget for npm run tsc, in seconds').getAttribute('aria-invalid')).toBe('true');
    expect(api.setLifecycleStepParams).not.toHaveBeenCalled();
    expect(api.measureLifecycle).not.toHaveBeenCalled();
  });

  it('Measure with these starts a Measure and saves nothing', async () => {
    await openSetup('p-measure');
    expect(screen.getByTestId('lc10-setup-measure').textContent).toBe(dl.lcx10_setup_measure);
    await act(async () => { fireEvent.click(screen.getByTestId('lc10-setup-measure')); });
    expect(api.measureLifecycle).toHaveBeenCalledWith('p-measure');
    expect(api.setLifecycleStepParams).not.toHaveBeenCalled();
  });

  it('a failed save says so on the panel and does not measure', async () => {
    api.setLifecycleStepParams.mockRejectedValueOnce(new Error('database is locked'));
    await openSetup('p-fail');
    await act(async () => { fireEvent.click(screen.getByTestId('lc10-setup-save')); });
    expect(screen.getByTestId('lc10-setup-note').textContent).toContain(dl.lcx10_setup_save_failed);
    expect(api.measureLifecycle).not.toHaveBeenCalled();
  });
});

describe('nothing detected', () => {
  it('says so, offers no Measure, and Add a command opens the Gate editor', async () => {
    api.detectLifecycleCommands.mockResolvedValue([]);
    const { openStep } = renderLayer1(<Layer1 />, soloV0({ projectId: 'p-none' }));
    expect(await screen.findByText(dl.lcx10_setup_none_title)).toBeTruthy();
    expect(screen.queryByTestId('lc10-setup-save')).toBeNull();
    expect(screen.queryByTestId('lc10-setup-measure')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: dl.lcx10_setup_add_command }));
    expect(openStep).toHaveBeenCalledWith('gate', 'commands');
  });
});
