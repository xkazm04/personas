/**
 * Scan freshness. `browser-scan` re-reads the site list immediately. The 15s
 * poll is only the backstop for an emit that never arrived.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSite } from '../types';

vi.mock('@/api/browser', () => ({
  listSites: vi.fn(),
  listTabs: vi.fn(),
  listenTabs: vi.fn(() => Promise.resolve(() => undefined)),
  listenScan: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  extractMessage: (err: unknown) => (err instanceof Error ? err.message : 'unreadable'),
}));

import * as browserApi from '@/api/browser';

import { refreshSites, resetBrowserStore, SCAN_POLL_MS } from '../browserStore';

const listSites = vi.mocked(browserApi.listSites);
const listenScan = vi.mocked(browserApi.listenScan);

function site(origin: string, scanStatus: BrowserSite['scan_status'] = 'none'): BrowserSite {
  return {
    origin,
    label: origin,
    enabled: true,
    overrides: {},
    budget: 50,
    credential_id: null,
    scan_status: scanStatus,
    scan_tier: null,
    scan_report: null,
    scan_at: null,
    first_seen: 0,
    last_seen: 0,
    created_by: 'operator',
  } as BrowserSite;
}

beforeEach(() => {
  vi.clearAllMocks();
  listenScan.mockImplementation(() => Promise.resolve(() => undefined));
  resetBrowserStore();
});

afterEach(() => {
  vi.useRealTimers();
  resetBrowserStore();
});

describe('browser-scan', () => {
  it('re-reads sites when the event fires, without waiting out the poll', async () => {
    let onScan: ((payload: { origin: string; status: string; tier: number | null }) => void) | null = null;
    listenScan.mockImplementationOnce((handler) => {
      onScan = handler;
      return Promise.resolve(() => undefined);
    });
    listSites.mockResolvedValue([site('https://a.example')]);

    await refreshSites();
    expect(listSites).toHaveBeenCalledTimes(1);

    onScan?.({ origin: 'https://a.example', status: 'proposed', tier: 1 });
    expect(listSites).toHaveBeenCalledTimes(2);
  });

  it('subscribes again after listenScan rejects', async () => {
    listSites.mockResolvedValue([]);
    listenScan.mockRejectedValueOnce(new Error('listen failed'));
    await refreshSites();
    await refreshSites();
    expect(listenScan).toHaveBeenCalledTimes(2);
  });

  it('backs a running scan off at 15s, so 2.5s does not refetch', async () => {
    expect(SCAN_POLL_MS).toBe(15_000);
    vi.useFakeTimers();
    listSites.mockResolvedValue([site('https://a.example', 'running')]);
    await refreshSites();
    expect(listSites).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(listSites).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_500);
    expect(listSites).toHaveBeenCalledTimes(2);
  });
});
