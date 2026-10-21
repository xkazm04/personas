/**
 * Remove on a row Rust no longer has (deleted by an agent or another window)
 * answers `false`. The ledger must still forget the row, or it keeps a ghost
 * the store cannot delete.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const deleteSite = vi.fn();
const forgetSite = vi.fn();

vi.mock('@/api/browser', () => ({ deleteSite: (o: string) => deleteSite(o) }));
vi.mock('../../browserStore', () => ({
  forgetSite: (o: string) => forgetSite(o),
  putSite: vi.fn(),
  refreshSites: vi.fn(),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setSidebarSection: vi.fn(), setTeamsTab: vi.fn() }),
}));

import { useWhitelistActions } from '../useWhitelistActions';
import type { BrowserSite } from '../../types';

const SITE = { origin: 'https://gone.example.com' } as BrowserSite;

describe('useWhitelistActions.onRemove', () => {
  beforeEach(() => {
    deleteSite.mockReset();
    forgetSite.mockReset();
  });

  it('forgets the row when the delete removed it', async () => {
    deleteSite.mockResolvedValue(true);
    const { result } = renderHook(() => useWhitelistActions());
    await result.current.onRemove(SITE);
    expect(forgetSite).toHaveBeenCalledWith(SITE.origin);
  });

  it('forgets the row when it was already gone (delete answered false)', async () => {
    deleteSite.mockResolvedValue(false);
    const { result } = renderHook(() => useWhitelistActions());
    await result.current.onRemove(SITE);
    expect(forgetSite).toHaveBeenCalledWith(SITE.origin);
  });
});
