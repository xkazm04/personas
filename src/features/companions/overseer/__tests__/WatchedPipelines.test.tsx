import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import type { LifecycleWatchedPipeline } from '@/lib/bindings/LifecycleWatchedPipeline';

// Overseer's Watched pipelines against a stubbed API: the empty band, a card
// per pipeline (its mini rail with one node per step in its lane, the verdict
// counts in words, the goal or "Not sent yet", the standing on its rail), a
// card that opens Lifecycle on that project, and a failed read said inline.

const listOverseerWatchedPipelines = vi.hoisted(() => vi.fn());
const sys = vi.hoisted(() => ({
  setActiveProject: vi.fn(async (_id: string) => {}),
  setSidebarSection: vi.fn(),
  setTeamsTab: vi.fn(),
}));

vi.mock('@/api/devTools/lifecycle', () => ({ listOverseerWatchedPipelines }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign((selector: (s: typeof sys) => unknown) => selector(sys), { getState: () => sys }),
}));
// New keys reach the section chunks only after the i18n split runs, so the
// component reads the English catalog directly here.
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import { WatchedPipelines } from '../components/WatchedPipelines';
import { standingOf, verdictTally } from '../watchedModel';

const d = en.director;

const BEFORE = ['frame', 'recall', 'isolate', 'sync'];
const rail = (verdicts: Record<string, LifecycleWatchedPipeline['steps'][number]['health']>) =>
  Object.entries(verdicts).map(([stepId, health]) => ({
    stepId, phase: BEFORE.includes(stepId) ? 'before' as const : 'after' as const, label: null, health,
  }));

const ATLAS: LifecycleWatchedPipeline = {
  projectId: 'p1',
  projectName: 'Acme',
  goal: { goalId: 'g1', measurableTotal: 6, measurableGreen: 4, instructed: 2, openItems: 3, items: [] },
  lastMeasuredAt: new Date().toISOString(),
  steps: rail({ frame: 'instructed', recall: 'instructed', isolate: 'green', sync: 'green', gate: 'amber', tests: 'green', docs: 'red', land: 'green' }),
};
const BETA: LifecycleWatchedPipeline = {
  projectId: 'p2', projectName: 'Beta', goal: null, lastMeasuredAt: null,
  steps: rail({ frame: 'instructed', isolate: 'unmeasured', gate: 'unmeasured', docs: 'stale' }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WatchedPipelines', () => {
  it('shows the empty band when nothing is watched', async () => {
    listOverseerWatchedPipelines.mockResolvedValue([]);
    render(<WatchedPipelines />);
    const empty = await screen.findByTestId('watched-pipelines-empty');
    expect(empty.textContent).toContain(d.watched_pipelines_empty);
  });

  it('draws each pipeline as a card with its mini rail, lanes apart, one node per step', async () => {
    listOverseerWatchedPipelines.mockResolvedValue([ATLAS, BETA]);
    render(<WatchedPipelines />);

    const acme = await screen.findByTestId('watched-pipeline-p1');
    expect(acme.textContent).toContain('Acme');
    const mini = within(acme).getByTestId('watched-mini-rail');
    expect(mini.querySelectorAll('[data-node]')).toHaveLength(8);
    const lanes = [...mini.children].map((lane) => [...lane.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-node')));
    expect(lanes).toEqual([['frame', 'recall', 'isolate', 'sync'], ['gate', 'tests', 'docs', 'land']]);
    expect(mini.querySelector('[data-node="docs"]')!.getAttribute('data-health')).toBe('red');
    expect(mini.getAttribute('aria-label')).toBe("The pipeline's steps: 1 failing, 1 at risk, 4 green, 2 by instruction");
    expect(acme.textContent).toContain('1 failing · 1 at risk · 4 green · 2 by instruction');
    expect(within(acme).getByTestId('watched-goal').textContent).toContain('4 of 6 green, 2 instructed');
    expect(within(acme).getByTestId('watched-goal').textContent).toContain('3 open items');

    const beta = screen.getByTestId('watched-pipeline-p2');
    expect(within(beta).getByTestId('watched-not-sent').textContent).toBe(d.watched_pipelines_not_sent);
    expect(within(beta).getByTestId('watched-measured').textContent).toBe(d.watched_pipelines_never_measured);
    expect(within(beta).getByTestId('watched-mini-rail').querySelectorAll('[data-node]')).toHaveLength(4);
  });

  it('opens Lifecycle on the pressed project, from its name or its button', async () => {
    listOverseerWatchedPipelines.mockResolvedValue([BETA]);
    render(<WatchedPipelines />);

    fireEvent.click(await screen.findByRole('button', { name: 'Beta' }));
    expect(sys.setActiveProject).toHaveBeenCalledWith('p2');
    expect(sys.setSidebarSection).toHaveBeenCalledWith('teams');
    expect(sys.setTeamsTab).toHaveBeenCalledWith('lifecycle');

    sys.setActiveProject.mockClear();
    fireEvent.click(screen.getByTestId('watched-open-p2'));
    expect(sys.setActiveProject).toHaveBeenCalledWith('p2');
  });

  it('says a failed read inline', async () => {
    listOverseerWatchedPipelines.mockRejectedValue(new Error('db locked'));
    render(<WatchedPipelines />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('watchedModel', () => {
  it('judges a pipeline by its worst verdict', () => {
    expect(standingOf(ATLAS.steps)).toBe('red');
    expect(standingOf(BETA.steps)).toBe('open');
    expect(standingOf(rail({ frame: 'instructed', gate: 'green' }))).toBe('green');
    expect(standingOf(rail({ frame: 'instructed' }))).toBe('none');
    expect(verdictTally(ATLAS.steps)).toEqual({ red: 1, amber: 1, stale: 0, unmeasured: 0, green: 4, instructed: 2 });
  });
});
