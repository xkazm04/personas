import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// Overseer's Watched pipelines against a stubbed API: the empty band, a row
// with a goal and one without, a row press that opens Lifecycle on that
// project, and a failed read said inline.

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

const d = en.director;

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

  it('renders one row per pipeline, with progress or "not sent yet"', async () => {
    listOverseerWatchedPipelines.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Acme',
        goal: { goalId: 'g1', measurableTotal: 6, measurableGreen: 4, instructed: 2, openItems: 3 },
        lastMeasuredAt: new Date().toISOString(),
      },
      { projectId: 'p2', projectName: 'Beta', goal: null, lastMeasuredAt: null },
    ]);
    render(<WatchedPipelines />);

    const acme = await screen.findByTestId('watched-pipeline-p1');
    expect(acme.textContent).toContain('Acme');
    expect(acme.textContent).toContain('4 of 6 green, 2 instructed');
    expect(acme.textContent).toContain('3 open items');
    expect(acme.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('4 of 6 green, 2 instructed');

    const beta = screen.getByTestId('watched-pipeline-p2');
    expect(beta.textContent).toContain(d.watched_pipelines_not_sent);
    expect(beta.textContent).toContain(d.watched_pipelines_never_measured);
  });

  it('opens Lifecycle on the pressed project', async () => {
    listOverseerWatchedPipelines.mockResolvedValue([
      { projectId: 'p2', projectName: 'Beta', goal: null, lastMeasuredAt: null },
    ]);
    render(<WatchedPipelines />);

    fireEvent.click(await screen.findByRole('button', { name: 'Beta' }));

    expect(sys.setActiveProject).toHaveBeenCalledWith('p2');
    expect(sys.setSidebarSection).toHaveBeenCalledWith('teams');
    expect(sys.setTeamsTab).toHaveBeenCalledWith('lifecycle');
  });

  it('says a failed read inline', async () => {
    listOverseerWatchedPipelines.mockRejectedValue(new Error('db locked'));
    render(<WatchedPipelines />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
