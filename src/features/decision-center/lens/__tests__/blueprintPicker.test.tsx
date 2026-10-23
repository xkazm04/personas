/**
 * The Monitor's project list (spark bp-fidelity, Stage A):
 *  - readinessLevel is bp's verdict over the products row: no map = missing, a map with no reading =
 *    map-only, readings = measured, readings plus the events log = full.
 *  - The list draws ghost rows while the products read, one row per product with its level, and its
 *    doors open the product's blueprint (and its release, when one waits) through `openLensSheet`.
 *  - A product whose store did not open still gets a row, and an empty answer is the shared empty state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useLensSheetStore } from '../lensSheetStore';
import { readinessLevel } from '../readiness';
import { resetLensScanSource } from '../../roster/lensScanSource';
import { product } from './lensFixtures';

const api = vi.hoisted(() => ({ listLensScanProducts: vi.fn() }));
vi.mock('@/api/lensScan', () => api);

import { BlueprintPicker } from '../BlueprintPicker';

beforeEach(() => {
  resetLensScanSource();
  api.listLensScanProducts.mockReset();
  useLensSheetStore.setState({ request: null });
});

describe('readinessLevel', () => {
  it.each([
    [{ hasMap: false, measuredFacets: 9, hasEvents: true }, 'missing'],
    [{ hasMap: true, measuredFacets: 0, hasEvents: true }, 'map-only'],
    [{ hasMap: true, measuredFacets: 3, hasEvents: false }, 'measured'],
    [{ hasMap: true, measuredFacets: 3, hasEvents: true }, 'full'],
  ] as const)('%o is %s', (fields, level) => {
    expect(readinessLevel(fields)).toBe(level);
  });
});

describe('BlueprintPicker', () => {
  it('ghosts while the products read, then one row per product with its level', async () => {
    let answer: (rows: unknown) => void = () => {};
    api.listLensScanProducts.mockReturnValue(new Promise((r) => { answer = r; }));
    render(<BlueprintPicker />);
    expect(screen.getByTestId('monitor-blueprint')).toBeTruthy();
    expect(screen.getByTestId('blueprint-picker-ghost')).toBeTruthy();
    answer([
      product({ projectId: 'p-full', name: 'Kettle', hasEvents: true, openRelease: { id: 'rel-1', status: 'building' } }),
      product({ projectId: 'p-bare', name: 'Teapot', hasMap: false, mapVersion: undefined, measuredFacets: 0 }),
      product({ projectId: 'p-broken', name: 'Saucer', error: 'file is not a database' }),
    ]);
    await waitFor(() => expect(screen.queryByTestId('blueprint-picker-ghost')).toBeNull());
    expect(screen.getByTestId('blueprint-product-p-full').getAttribute('data-level')).toBe('full');
    expect(screen.getByTestId('blueprint-product-p-bare').getAttribute('data-level')).toBe('missing');
    expect(screen.getByTestId('blueprint-product-p-broken').textContent).toContain('file is not a database');
    // the release door shows only where a release waits, and never on a broken store
    expect(screen.getByTestId('blueprint-release-p-full')).toBeTruthy();
    expect(screen.queryByTestId('blueprint-release-p-bare')).toBeNull();
    expect(screen.queryByTestId('blueprint-release-p-broken')).toBeNull();
  });

  it('opens the blueprint and the release through the lens sheet', async () => {
    api.listLensScanProducts.mockResolvedValue([product({ projectId: 'p1', unreleasedAccepted: 2 })]);
    render(<BlueprintPicker />);
    fireEvent.click(await screen.findByTestId('blueprint-open-p1'));
    expect(useLensSheetStore.getState().request).toEqual({ kind: 'build', projectId: 'p1' });
    fireEvent.click(screen.getByTestId('blueprint-release-p1'));
    expect(useLensSheetStore.getState().request).toEqual({ kind: 'release', projectId: 'p1' });
  });

  it('an empty answer is the shared empty state', async () => {
    api.listLensScanProducts.mockResolvedValue([]);
    render(<BlueprintPicker />);
    expect(await screen.findByTestId('blueprint-picker-empty')).toBeTruthy();
    expect(screen.getByTestId('scenario-empty-state')).toBeTruthy();
  });
});
