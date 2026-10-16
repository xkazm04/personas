/**
 * The lens-scan cards in the live deck and the sheets they open (spark
 * one-control, WP3):
 *  - A / X are printed disabled and A / R write nothing; Enter opens the
 *    sheet at the card's own product and kind.
 *  - An Evidence card's blueprint opens at the first feature waiting for
 *    triage; the ghost shows while the snapshot reads; a load error says
 *    which cause and offers nothing that writes.
 *  - The Release sheet's one primary action opens bp's Release tab, built from
 *    the setting or its default; when bp does not answer it says bp is not
 *    running and shows how to start it, and offers no open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { en } from '@/i18n/en';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { BlueprintSheetProps } from '../../blueprint/BlueprintSheet';
import kettleStructure from '../../blueprint/fixture/kettle.structure.json';

const api = vi.hoisted(() => ({
  listLensScanProducts: vi.fn(),
  getLensScanSnapshot: vi.fn(),
  getAppSetting: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock('@/api/lensScan', () => ({ listLensScanProducts: api.listLensScanProducts, getLensScanSnapshot: api.getLensScanSnapshot }));
vi.mock('@/api/system/settings', () => ({ getAppSetting: api.getAppSetting }));
vi.mock('@/api/system/system', async (orig) => ({ ...(await orig<typeof import('@/api/system/system')>()), openExternalUrl: api.openExternalUrl }));
vi.mock('@/hooks/utility/interaction/useMotion', async (orig) => ({
  ...(await orig<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));
// The drawing itself is WP4a's (its own tests); here only what it is handed matters.
vi.mock('../../blueprint/BlueprintSheet', () => ({
  BlueprintSheet: (p: BlueprintSheetProps) => (
    <div data-testid="blueprint-sheet" data-product={p.data.product.projectId} data-feature={p.initialFeature ?? ''} />
  ),
}));

import { useDecisionDeckStore } from '../../deck/deckStore';
import { key, mountLane } from '../../deck/__tests__/shapeKit';
import { refreshLensScanProducts, resetLensScanSource } from '../../roster/lensScanSource';
import { lensToDecisions } from '../lensAdapters';
import { LensSheetHost } from '../LensSheetHost';
import { openLensSheet, useLensSheetStore } from '../lensSheetStore';
import { resetReleaseCompositions } from '../releaseCompositions';
import { lensCopy, product } from './lensFixtures';

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const dc = en.decisionCenter;
const T = '2026-10-15T10:00:00.000Z';
const teapot = product({ counts: { proposed: 2 }, awaitingTriage: 1, unreleasedAccepted: 1 });
const [buildCard, evidenceCard] = lensToDecisions([teapot], new Map(), lensCopy());

beforeEach(async () => {
  for (const f of Object.values(api)) f.mockReset();
  resetLensScanSource();
  resetReleaseCompositions();
  api.listLensScanProducts.mockResolvedValue([teapot]);
  await refreshLensScanProducts();
});
afterEach(() => {
  useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null });
  useLensSheetStore.setState({ request: null });
  vi.unstubAllGlobals();
});

describe('a lens card in the deck', () => {
  it('prints its verdicts disabled, writes nothing on A or R, and opens on Enter', async () => {
    const { onDecide } = mountLane('breach', [buildCard!], []);
    const verdicts = await screen.findByTestId('lens-dock-verdicts');
    const buttons = within(verdicts).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
    key('a');
    key('r');
    key('1', 'Digit1');
    expect(onDecide).not.toHaveBeenCalled();
    expect(useLensSheetStore.getState().request).toBeNull();
    key('Enter');
    expect(useLensSheetStore.getState().request).toEqual({ kind: 'build', projectId: 'proj-teapot' });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('an Evidence card opens its own kind, from the Accept lane', async () => {
    mountLane('accept', [evidenceCard!], []);
    await screen.findByTestId('lens-dock-verdicts');
    fireEvent.click(screen.getByRole('button', { name: dc.lens.open_blueprint }));
    expect(useLensSheetStore.getState().request).toEqual({ kind: 'evidence', projectId: 'proj-teapot' });
  });
});

const host = () => render(<AppKeyboardProvider><LensSheetHost /></AppKeyboardProvider>);
const packScan = {
  runs: [], measurements: [], activity: [], shots: [], coverage: [], releases: [],
  packs: [{ id: 'k-1', lens: 'design', n: 1, branch: 'pack/k-1', base_ref: 'main', base_sha: 'abc', status: 'open', created_at: T, updated_at: T }],
  proposals: [{ id: 'p1', run_id: 'r', feature: 'brew-timer', lens: 'design', title: 'p1', standard: 'none', kind: 'fix', status: 'done', created_at: T, updated_at: T, pack_id: 'k-1' }],
};

describe('the blueprint a lens card opens', () => {
  it('shows a ghost while the snapshot reads, then the drawing at the first feature waiting for triage', async () => {
    let land: (v: unknown) => void = () => {};
    api.getLensScanSnapshot.mockReturnValue(new Promise((r) => { land = r; }));
    host();
    act(() => openLensSheet({ kind: 'evidence', projectId: 'proj-teapot' }));
    expect(await screen.findByTestId('lens-blueprint-ghost')).toBeTruthy();
    await act(async () => land({ structure: kettleStructure, events: '', scan: packScan, storeVersion: 3 }));
    const sheet = await screen.findByTestId('blueprint-sheet');
    expect(sheet.getAttribute('data-product')).toBe('proj-teapot');
    expect(sheet.getAttribute('data-feature')).toBe('brew-timer');
    expect(api.getLensScanSnapshot).toHaveBeenCalledWith('proj-teapot');
  });

  it('a Build card opens at the product, not a feature', async () => {
    api.getLensScanSnapshot.mockResolvedValue({ structure: kettleStructure, events: '', scan: packScan, storeVersion: 3 });
    host();
    act(() => openLensSheet({ kind: 'build', projectId: 'proj-teapot' }));
    expect((await screen.findByTestId('blueprint-sheet')).getAttribute('data-feature')).toBe('');
  });

  it('a product that cannot open says why and offers only Close', async () => {
    api.getLensScanSnapshot.mockRejectedValue({ error: 'node was not found on PATH', kind: 'process_spawn' });
    host();
    act(() => openLensSheet({ kind: 'build', projectId: 'proj-teapot' }));
    const frame = await screen.findByTestId('lens-blueprint-error');
    expect(frame.textContent).toContain(dc.lens.error_node);
    const labels = within(frame).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels.sort()).toEqual([dc.lens.close, dc.lens.close]);
    key('Escape');
    expect(useLensSheetStore.getState().request).toBeNull();
  });
});

describe('the release composition', () => {
  const relScan = {
    ...packScan,
    packs: [],
    proposals: [{ id: 'a1', run_id: 'r', feature: 'tea-menu', lens: 'development', title: 'Menu loads at once', standard: 'none', kind: 'fix', status: 'accepted', created_at: T, updated_at: T }],
    releases: [{ id: 'rel-0.4.0', version: '0.4.0', branch: 'release/0.4.0', status: 'tagged', created_at: T, updated_at: T }],
  };

  it('opens bp at the product Release tab from the setting, read only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
    api.getAppSetting.mockResolvedValue('http://bp.test:4000');
    api.getLensScanSnapshot.mockResolvedValue({ structure: {}, events: '', scan: relScan, storeVersion: 3 });
    api.openExternalUrl.mockResolvedValue(undefined);
    host();
    act(() => openLensSheet({ kind: 'release', projectId: 'proj-teapot' }));
    expect((await screen.findByTestId('lens-release-version')).textContent).toBe('0.4.1');
    expect(screen.getAllByTestId('lens-release-item')).toHaveLength(1);
    expect(screen.getByTestId('lens-release-notes-none')).toBeTruthy();
    const open = screen.getByTestId('lens-release-open-bp');
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    await waitFor(() => expect(api.openExternalUrl).toHaveBeenCalledWith('http://bp.test:4000/?product=teapot-works&page=ledger&tab=release'));
  });

  it('falls back to the default URL when the setting is unset, and Enter opens it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
    api.getAppSetting.mockResolvedValue(null);
    api.getLensScanSnapshot.mockResolvedValue({ structure: {}, events: '', scan: relScan, storeVersion: 3 });
    api.openExternalUrl.mockResolvedValue(undefined);
    host();
    act(() => openLensSheet({ kind: 'release', projectId: 'proj-teapot' }));
    const open = await screen.findByTestId('lens-release-open-bp');
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    key('Enter');
    await waitFor(() => expect(api.openExternalUrl).toHaveBeenCalledWith('http://localhost:3000/?product=teapot-works&page=ledger&tab=release'));
  });

  it('when bp does not answer, says it is not running, shows the command, and offers no open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    api.getAppSetting.mockResolvedValue(null);
    api.getLensScanSnapshot.mockResolvedValue({ structure: {}, events: '', scan: relScan, storeVersion: 3 });
    host();
    act(() => openLensSheet({ kind: 'release', projectId: 'proj-teapot' }));
    const down = await screen.findByTestId('lens-release-bp-down');
    expect(down.textContent).toContain(dc.release.bp_down_title);
    expect(down.textContent).toContain('npm run dev');
    expect(screen.queryByTestId('lens-release-open-bp')).toBeNull();
    expect(screen.queryByTestId('lens-release-item')).toBeNull();
    expect(api.openExternalUrl).not.toHaveBeenCalled();
  });
});
