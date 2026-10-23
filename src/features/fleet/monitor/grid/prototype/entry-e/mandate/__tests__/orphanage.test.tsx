/**
 * The Orphanage (mandate-lanes WP6): one row per project with why it asks
 * for a mandate; D drafts with the found steward (or asks for one first), A
 * adopts into a picked mandate, X archives ONLY on the second press after
 * listing what leaves the lane (Esc disarms). Archived, not deleted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { en } from '@/i18n/en';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { OrphanClusters } from '@/lib/bindings/OrphanClusters';
import { mandate } from '@/features/decision-center/mandate/__tests__/mandateFixtures';
import { OrphanageView } from '../orphans/OrphanageView';
import { adoptTargets, stewardChoices } from '../orphans/orphanModel';

const api = vi.hoisted(() => ({
  listOrphanClusters: vi.fn(),
  draftOrphanMandate: vi.fn(async () => ({})),
  adoptOrphans: vi.fn(async () => ({})),
  archiveOrphans: vi.fn(async () => 33),
}));
vi.mock('@/api/mandates', () => api);
vi.mock('@/features/decision-center/lanes/useLanesSnapshot', () => ({ useCharterActRecorded: () => {} }));
vi.mock('@/features/decision-center/lanes/lanesSnapshotSource', () => ({ refreshLanesSnapshot: vi.fn(async () => {}) }));

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor;

function clusters(steward: boolean): OrphanClusters {
  return {
    perCard: 4,
    unassigned: 1,
    failedSources: [],
    clusters: [{
      projectId: 'adamant', projectName: 'Adamant', items: 33, recent: 10,
      kinds: [{ kind: 'idea', count: 33 }], itemIds: ['idea:1'],
      oldestAt: '2026-10-01T00:00:00Z', newestAt: '2026-10-14T00:00:00Z',
      why: 'large', archived: 0,
      steward: steward ? { personaId: 'am', name: 'App Master Adamant', source: 'app-master' } : null,
    }],
  };
}

const MANDATES = [
  mandate({ charterId: 'c1', projectId: 'p1', projectName: 'Personas', stewardPersonaId: 's1', stewardName: 'App Master Personas' }),
  mandate({ charterId: 'c2', projectId: 'p2', projectName: 'Ascent', stewardPersonaId: 's2', stewardName: 'App Master Ascent', status: 'suspended' }),
];

const key = (k: string) => fireEvent.keyDown(window, { key: k });
const mount = () => render(<AppKeyboardProvider><OrphanageView mandates={MANDATES} /></AppKeyboardProvider>);

afterEach(() => { Object.values(api).forEach((f) => f.mockClear()); });

describe('orphanage', () => {
  it('lists a cluster with why it asks for a mandate', async () => {
    api.listOrphanClusters.mockResolvedValue(clusters(true));
    mount();
    const row = await screen.findByTestId('orphan-row');
    expect(row.textContent).toContain('Adamant');
    expect(row.textContent).toContain('33 ideas');
    expect(row.textContent).toContain('more than one card releases today (4)');
    expect(screen.getByTestId('orphanage').textContent).toContain('1 more name no project');
  });

  it('archives only on the second press, after listing what leaves; Esc disarms', async () => {
    api.listOrphanClusters.mockResolvedValue(clusters(true));
    mount();
    await screen.findByTestId('orphan-row');
    key('x');
    expect(api.archiveOrphans).not.toHaveBeenCalled();
    const armed = screen.getByTestId('orphan-archive-armed');
    expect(armed.textContent).toContain('33 items: 33 ideas');
    expect(armed.textContent).toContain(m.ml_orphans_archive_not_deleted);
    key('Escape');
    expect(screen.queryByTestId('orphan-archive-armed')).toBeNull();
    key('x');
    key('x');
    await waitFor(() => expect(api.archiveOrphans).toHaveBeenCalledWith('adamant'));
    expect(api.archiveOrphans).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('33 items archived from the Orphans lane.')).toBeTruthy();
  });

  it('drafts with the steward the orphanage found, in one press', async () => {
    api.listOrphanClusters.mockResolvedValue(clusters(true));
    mount();
    await screen.findByTestId('orphan-row');
    key('d');
    await waitFor(() => expect(api.draftOrphanMandate).toHaveBeenCalledWith('adamant', 'am'));
  });

  it('asks for a steward first when none works on the project', async () => {
    api.listOrphanClusters.mockResolvedValue(clusters(false));
    mount();
    await screen.findByTestId('orphan-row');
    key('d');
    expect(api.draftOrphanMandate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('App Master Ascent'));
    key('d');
    await waitFor(() => expect(api.draftOrphanMandate).toHaveBeenCalledWith('adamant', 's2'));
  });

  it('adopts into the picked mandate', async () => {
    api.listOrphanClusters.mockResolvedValue(clusters(true));
    mount();
    await screen.findByTestId('orphan-row');
    key('a');
    expect(api.adoptOrphans).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Personas'));
    key('Enter');
    await waitFor(() => expect(api.adoptOrphans).toHaveBeenCalledWith('adamant', 'c1'));
  });

  it('offers one mandate per other project and each steward once', () => {
    expect(adoptTargets(MANDATES, 'p1').map((s) => s.charterId)).toEqual(['c2']);
    expect(stewardChoices([...MANDATES, MANDATES[0]!]).map((s) => s.id)).toEqual(['s2', 's1']);
  });
});
