/**
 * `launchPowerMove` used to call `markTried` on its FIRST line — before any
 * navigation and long before the spotlight resolved. The quest board's progress
 * count is built on `tried`, so a deep link whose anchor never mounted still
 * incremented it: the app could report `anchor-never-mounted` and "you have
 * used this feature" about the same click.
 *
 * These tests pin the corrected contract — credit follows the landing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const flash = vi.hoisted(() => ({ fn: vi.fn<(id: string) => Promise<boolean>>() }));
vi.mock('../flashSpotlight', () => ({ flashSpotlight: flash.fn }));

const sys = vi.hoisted(() => ({
  setSidebarSection: vi.fn(),
  setHeaderOverlay: vi.fn(),
  setEventBusTab: vi.fn(),
  setPluginTab: vi.fn(),
  sidebarSection: 'overview',
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: { getState: () => sys },
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: { getState: () => ({ setOverviewTab: vi.fn() }) },
}));

import { launchPowerMove } from '../launchPowerMove';
import { usePowerMovesStore } from '../powerMovesStore';
import type { PowerMove } from '../registry';

/** Minimal move shaped like a registry entry; only nav + spotlight matter. */
function move(id: string, spotlightTestId?: string): PowerMove {
  return {
    id,
    nav: { section: 'overview' },
    spotlightTestId,
  } as unknown as PowerMove;
}

beforeEach(() => {
  flash.fn.mockReset();
  usePowerMovesStore.setState({ tried: {}, done: {} });
});

describe('launchPowerMove credit', () => {
  it('does NOT credit a move whose deep link never landed', async () => {
    flash.fn.mockResolvedValue(false);
    launchPowerMove(move('dead-link', 'anchor-that-never-mounts'));
    await vi.waitFor(() => expect(flash.fn).toHaveBeenCalledWith('anchor-that-never-mounts'));
    await Promise.resolve();
    await Promise.resolve();
    expect(usePowerMovesStore.getState().tried['dead-link']).toBeUndefined();
  });

  it('credits a move once its anchor resolves', async () => {
    flash.fn.mockResolvedValue(true);
    launchPowerMove(move('good-link', 'anchor-that-mounts'));
    await vi.waitFor(() => expect(usePowerMovesStore.getState().tried['good-link']).toBe(true));
  });

  it('credits a move with no spotlight anchor immediately — the navigation IS the action', () => {
    launchPowerMove(move('no-anchor'));
    expect(usePowerMovesStore.getState().tried['no-anchor']).toBe(true);
    expect(flash.fn).not.toHaveBeenCalled();
  });
});
