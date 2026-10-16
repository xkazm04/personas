/**
 * The live blueprint load (spark one-control): a map the drawing cannot read, an absent
 * `app-structure.json` (the door answers `null`) or one that is neither v2 nor v3, settles as the
 * store's error frame instead of a sheet that throws while it renders. The Kettle sample's own map
 * settles ready.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  counts: { proposed: 1 }, awaitingTriage: 0, unreleasedAccepted: 0,
};
const snapshot = (map: unknown, text = '') => ({ structure: map, events: text, scan, storeVersion: 3 });

beforeEach(async () => {
  resetLensScanSource();
  api.listLensScanProducts.mockReset().mockResolvedValue([product]);
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
});
