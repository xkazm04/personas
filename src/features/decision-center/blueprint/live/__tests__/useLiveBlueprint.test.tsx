/**
 * The live blueprint load (spark one-control): a map the drawing cannot read, an absent
 * `app-structure.json` (the door answers `null`) or one that is neither v2 nor v3, settles as the
 * store's error frame instead of a sheet that throws while it renders. The Kettle sample's own map
 * settles ready, and carries every product for the header's switcher (with its readiness level), the open
 * product's last scan, and an `openProduct` that reopens the sheet on another product (spark bp-fidelity).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLensSheetStore } from '../../../lens/lensSheetStore';
import { refreshLensScanProducts, resetLensScanSource } from '../../../roster/lensScanSource';
import events from '../../fixture/kettle.events.jsonl?raw';
import scan from '../../fixture/kettle.scan.json';
import structure from '../../fixture/kettle.structure.json';
import { useLiveBlueprint } from '../useLiveBlueprint';

const api = vi.hoisted(() => ({
  listLensScanProducts: vi.fn(),
  getLensScanSnapshot: vi.fn(),
}));
vi.mock('@/api/lensScan', () => api);

const product = {
  projectId: 'fixture-kettle', name: 'Kettle', root: 'C:/sample/kettle', storeVersion: 3,
  counts: { proposed: 1 }, awaitingTriage: 0, unreleasedAccepted: 0, lastRunAt: '2026-10-15T10:05:00Z',
  hasMap: true, mapVersion: 3, features: 12, lenses: 3, measuredFacets: 40, hasEvents: true,
};
const other = {
  projectId: 'fixture-teapot', name: 'Teapot Works', root: 'C:/sample/teapot-works', storeVersion: 2,
  counts: { proposed: 4 }, awaitingTriage: 0, unreleasedAccepted: 0,
  hasMap: true, features: 3, lenses: 1, measuredFacets: 0, hasEvents: false,
};
const snapshot = (map: unknown, text = '') => ({ structure: map, events: text, scan, storeVersion: 3 });

beforeEach(async () => {
  resetLensScanSource();
  api.listLensScanProducts.mockReset().mockResolvedValue([product, other]);
  useLensSheetStore.setState({ request: null });
  api.getLensScanSnapshot.mockReset();
  await refreshLensScanProducts();
});

describe('useLiveBlueprint', () => {
  it.each([['absent', null], ['not an app-structure', {}]])('a map that is %s is the store error, not a crash', async (_, map) => {
    api.getLensScanSnapshot.mockResolvedValue(snapshot(map));
    const { result } = renderHook(() => useLiveBlueprint('fixture-kettle'));
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    expect(result.current).toEqual({ status: 'error', kind: 'store' });
  });

  it('the Kettle sample map opens ready', async () => {
    api.getLensScanSnapshot.mockResolvedValue(snapshot(structure, events));
    const { result } = renderHook(() => useLiveBlueprint('fixture-kettle'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('carries every product for the switcher, the last scan, and an openProduct that reopens the sheet', async () => {
    api.getLensScanSnapshot.mockResolvedValue(snapshot(structure, events));
    const { result } = renderHook(() => useLiveBlueprint('fixture-kettle'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const live = result.current;
    if (live.status !== 'ready') throw new Error('not ready');
    expect(live.data.products).toEqual([
      { projectId: 'fixture-kettle', name: 'Kettle', level: 'full', proposals: 1, lastRunAt: '2026-10-15T10:05:00Z' },
      { projectId: 'fixture-teapot', name: 'Teapot Works', level: 'map-only', proposals: 4 },
    ]);
    expect(live.data.lastRunAt).toBe('2026-10-15T10:05:00Z');
    expect(live.actions.openProduct).toBeTypeOf('function');
    live.actions.openProduct?.('fixture-teapot');
    expect(useLensSheetStore.getState().request).toEqual({ kind: 'build', projectId: 'fixture-teapot' });
    // a refresh after a write keeps the switcher's products
    const again = await live.actions.refresh();
    expect(again.products?.map((p) => p.projectId)).toEqual(['fixture-kettle', 'fixture-teapot']);
  });
});
