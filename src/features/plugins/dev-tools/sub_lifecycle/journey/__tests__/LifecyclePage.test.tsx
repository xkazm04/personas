import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { evidenceItem, healthyMix, soloV0, stepView } from './fixtures';

// The page against a stubbed lifecycle API, as the Lens (contest
// lifecycle-portfolio-r2, winner A/3): it lands on the portfolio of every
// project, a cell opens its project, a lit column opens the step across every
// project, a project's column opens that step's detail, Esc walks back up one
// level at a time; the header keeps every slot on every plane; opening a
// project never changes the app-wide active project; the project's own
// controls (Measure, Install, Ask Athena) and its read failure stay inline.

const motion = vi.hoisted(() => ({ reduced: true }));
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
const setActiveProject = vi.hoisted(() => vi.fn());
const projects = vi.hoisted(() => ({ list: [] as { id: string; name: string; root_path: string; github_url: string | null }[] }));

const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
const detectLifecycleCommands = vi.hoisted(() => vi.fn(async () => [{ id: 'lint', command: 'npm run lint', kind: 'lint', budgetMs: null }]));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle, installLifecycle, getLifecycleStepDetail, measureLifecycle, getLifecycleHistory, detectLifecycleCommands }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }), {
    getState: () => ({ addToast }),
  }),
}));
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => askAthena }));
vi.mock('@/stores/systemStore', () => {
  const state = () => ({ activeProjectId: null, projects: projects.list, projectsLoading: false, fetchProjects: vi.fn(), setActiveProject });
  return { useSystemStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector(state()), { getState: state }) };
});
// New keys reach the section chunks only after the i18n split runs, so the page reads the English catalog directly.
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import LifecyclePage from '../../LifecyclePage';
import { __resetLensFocusForTests, openLifecycleProject } from '../../lifecycleView/lens/model/lensFocus';
import { loadStepChunk } from '../../lifecycleView/layer2/stepChunks';

const dl = en.plugins.dev_lifecycle;

beforeAll(async () => {
  await Promise.all([loadStepChunk('screen'), loadStepChunk('gate'), loadStepChunk('generic')]);
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  __resetLensFocusForTests();
  motion.reduced = true;
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => ({ stepId, runs: [], docs: [], related: [], evidence: [] }));
});

/** A portfolio of projects, each with its own snapshot; ids are unique per test (the snapshot cache is module-wide). */
function portfolio(rows: [string, string, LifecycleSnapshot][]) {
  projects.list = rows.map(([id, name]) => ({ id, name, root_path: `C:/${id}`, github_url: null }));
  const byId = new Map(rows.map(([id, , s]) => [id, { ...s, projectId: id }]));
  getLifecycle.mockImplementation(async (id: string) => {
    const s = byId.get(id);
    if (!s) throw new Error(`no project ${id}`);
    return s;
  });
}

/** One project, opened straight on its plane (as the Overseer's deep link does). */
function project(id: string, snap: LifecycleSnapshot) {
  portfolio([[id, 'Acme', snap]]);
  openLifecycleProject(id);
}

const failing = (land: 'red' | 'green') => {
  const mix = healthyMix();
  return { ...mix, health: mix.health.map((h) => (h.stepId === 'land' ? { ...h, health: land, reason: land === 'red' ? 'done in 40% of recent changes' : null } : h)) };
};

/** The real field is in (the ghost shares its test id) and the commit's effects have run. */
async function columnsIn() {
  await waitFor(() => {
    expect(screen.queryByTestId('lens-field-ghost')).toBeNull();
    expect(screen.getByTestId('lens-field')).toBeTruthy();
  });
  await act(async () => {});
}

/** Every slot of the fixed header, present whatever the plane says. */
function expectFullHead() {
  const head = screen.getByTestId('lens-head');
  for (const slot of ['lens-head-eyebrow', 'lens-head-title', 'lens-head-lede', 'lens-head-readout']) {
    expect(within(head).getByTestId(slot)).toBeTruthy();
  }
  expect(head.querySelector('.lens-head-mark')).not.toBeNull();
}

describe('the portfolio', () => {
  it('lands on every project as columns of cells, the failing step lit, the header in full', async () => {
    portfolio([['pf-a', 'Alpha', failing('red')], ['pf-b', 'Beta', failing('green')]]);
    render(<LifecyclePage />);

    const field = await screen.findByTestId('lens-field');
    expect(screen.getByTestId('lens-plane-portfolio')).toBeTruthy();
    expect(within(field).getAllByRole('option')).toHaveLength(10);
    // One cell per project in every column; the failing step is the lit one.
    await waitFor(() => expect(screen.getByTestId('lens-col-land').querySelectorAll('.lens-cell')).toHaveLength(2));
    expect(screen.getByTestId('lens-col-land').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('lens-head-title').textContent).toBe('Land is failing in 1 project.');
    expect(screen.getByTestId('lens-head-lede').textContent).toContain('Start with Alpha: done in 40% of recent changes.');
    expectFullHead();
    // No project's controls on the portfolio.
    expect(screen.queryByTestId('lc-measure')).toBeNull();
  });

  it('says what the pointer is on in the readout line only', async () => {
    portfolio([['pf-r', 'Alpha', failing('red')]]);
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lens-col-land').querySelectorAll('.lens-cell')).toHaveLength(1));
    const title = screen.getByTestId('lens-head-title').textContent;
    fireEvent.mouseEnter(screen.getByTestId('lens-cell-land-pf-r'));
    expect(screen.getByTestId('lens-head-readout').textContent).toBe('Alpha · Land: Failing · done in 40% of recent changes');
    expect(screen.getByTestId('lens-head-title').textContent).toBe(title);
  });

  it('opens one step across every project from its lit column, a row opens that project, Esc walks back up', async () => {
    portfolio([['pf-x', 'Alpha', failing('red')], ['pf-y', 'Beta', failing('green')]]);
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lens-col-land').querySelectorAll('.lens-cell')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('lens-col-land'));
    const across = await screen.findByTestId('lens-across');
    expect(within(across).getByTestId('lens-group-red').textContent).toContain('Alpha');
    expect(within(across).getByTestId('lens-group-green').textContent).toContain('Beta');
    expectFullHead();

    fireEvent.click(within(across).getByTestId('lens-row-pf-y'));
    expect(await screen.findByTestId('lens-plane-project')).toBeTruthy();
    expect(screen.getByTestId('lens-head-title').textContent).toBe('Beta');
    expect(setActiveProject).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByTestId('lens-plane-portfolio')).toBeTruthy();
  });

  it('opens a project from its cell, on the same step', async () => {
    portfolio([['pf-c', 'Alpha', failing('red')]]);
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lens-col-gate').querySelectorAll('.lens-cell')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('lens-cell-gate-pf-c'));
    expect(await screen.findByTestId('lens-plane-project')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('lens-col-gate').getAttribute('aria-selected')).toBe('true'));
    expect(setActiveProject).not.toHaveBeenCalled();
  });

  it('counts a project whose read failed, and draws the rest', async () => {
    portfolio([['pf-ok', 'Alpha', failing('red')], ['pf-bad', 'Broken', failing('red')]]);
    const ok = getLifecycle.getMockImplementation()!;
    getLifecycle.mockImplementation(async (id: string) => (id === 'pf-bad' ? Promise.reject(new Error('boom')) : ok(id)));
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lens-head-eyebrow').textContent).toContain(dl.lens_failed_reads_one));
    expect(screen.getByTestId('lens-col-land').querySelectorAll('.lens-cell')).toHaveLength(1);
  });
});

describe('a project', () => {
  it('heads its plane with the project, its practice and how fresh its measurement is', async () => {
    project('p-head-never', soloV0());
    const { unmount } = render(<LifecyclePage />);
    const never = await screen.findByTestId('lc-freshness');
    expect(screen.getByTestId('lens-head-title').textContent).toBe('Acme');
    expect(screen.getByTestId('lc-practice').textContent).toBe('Solo practice, default');
    expect(never.getAttribute('data-freshness')).toBe('never');
    expectFullHead();
    unmount();

    const mix = healthyMix();
    project('p-head-behind', { ...mix, tip: { ...mix.tip!, measuredSha: 'ffff0000aaaa', commitsBehind: 14 } });
    render(<LifecyclePage />);
    const behind = await screen.findByTestId('lc-freshness');
    expect(behind.textContent).toMatch(/^Measured .+, 14 commits behind master$/);
    expect(behind.className).toContain('text-status-warning');
  });

  it('opens a step as the last layer, in place of the columns, and Esc walks back up to the portfolio', async () => {
    project('p-detail', soloV0());
    render(<LifecyclePage />);
    await columnsIn();
    // Never measured: the first-run setup heads the Gate detail.
    fireEvent.click(screen.getByTestId('lens-col-gate'));
    fireEvent.click(screen.getByTestId('lens-col-gate'));
    const screenEl = await screen.findByTestId('lc2-screen');
    expect(screenEl.textContent).toContain('Rule for gate.');
    expect(await screen.findByTestId('lc10-setup-row-lint')).toBeTruthy();
    expect(screen.queryByTestId('lens-field')).toBeNull();
    expect(screen.getByTestId('lens-head-title').textContent).toContain('Gate');
    expectFullHead();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByTestId('lens-field')).toBeTruthy();
    expect(screen.getByTestId('lens-col-gate').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByTestId('lens-plane-portfolio')).toBeTruthy();
  });

  it('walks the steps with the arrow keys and opens the lit one with Enter', async () => {
    project('p-keys', healthyMix());
    render(<LifecyclePage />);
    await columnsIn();
    const lit = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!.getAttribute('data-testid');
    const start = lit();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const moved = lit()!;
    expect(moved).not.toBe(start);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect((await screen.findByTestId('lc2-screen')).getAttribute('data-step')).toBe(moved.replace('lens-col-', ''));
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
    // The change's outcome at Gate is a cell in its column.
    expect(screen.getByTestId('lens-col-gate').querySelector('.lens-cell.is-skipped')).not.toBeNull();

    fireEvent.click(screen.getByTestId('lc-install'));
    fireEvent.click(await screen.findByTestId('lc-install-confirm-go'));
    await waitFor(() => expect(installLifecycle).toHaveBeenCalledWith('p-missing'));
    expect((await screen.findByTestId('lc-install-note')).textContent).toBe('Install task started (task-7)');
    expect(addToast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('lc-ask-athena'));
    expect(askAthena).toHaveBeenCalledWith('lifecycle', expect.stringContaining('Acme (id p-missing)'));
  });

  it('names the weakest step by measured health in its lede', async () => {
    project('p-health', healthyMix());
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lens-head-lede').textContent)
      .toBe('Land is the weakest step: failing. Done in 40% of recent changes, 80% needed.'));
    fireEvent.click(screen.getByTestId('lc-ask-athena'));
    expect(askAthena).toHaveBeenCalledWith('lifecycle', expect.stringContaining('The weakest step is Land.'));
  });

  it('starts a Measure and says a refusal inline', async () => {
    project('p-measure', healthyMix());
    measureLifecycle.mockRejectedValueOnce(new Error("another project's Measure is running; one runs at a time"));
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lc-measure').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('lc-measure'));
    await waitFor(() => expect(screen.getByTestId('lc-measure-note').textContent).toContain('Measure did not start'));
    expect(measureLifecycle).toHaveBeenCalledWith('p-measure');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('holds every control and the header while the snapshot loads, over a ghost of the columns', async () => {
    projects.list = [{ id: 'p-loading', name: 'Acme', root_path: 'C:/acme', github_url: null }];
    getLifecycle.mockReturnValue(new Promise(() => {}));
    openLifecycleProject('p-loading');
    render(<LifecyclePage />);
    await act(async () => {});
    expect(screen.getByTestId('lc-measure').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('lc-overseer-send').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('lens-field-ghost')).toBeTruthy();
    expect(screen.getByTestId('lens-head-title').textContent).toBe('Acme');
    expectFullHead();
  });

  it('shows an inline error when the read fails, and no columns or step', async () => {
    projects.list = [{ id: 'p-error', name: 'Acme', root_path: 'C:/acme', github_url: null }];
    getLifecycle.mockRejectedValue(new Error('boom'));
    openLifecycleProject('p-error');
    render(<LifecyclePage />);
    await screen.findByText("Could not read this project's practice.");
    expect(screen.queryByTestId('lens-field')).toBeNull();
    expect(screen.queryByTestId('lc2-screen')).toBeNull();
  });
});
