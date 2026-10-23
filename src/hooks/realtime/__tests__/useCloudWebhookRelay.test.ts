/**
 * Snapshot plus stream for the cloud webhook relay.
 *
 * `cloud-webhook-relay-status` fires only on a relay tick (15 s active, 60 s
 * idle). Listening alone left a fresh mount on `connected: false` until the
 * next tick, and `CloudWebhooksTab` shows its "not connected" empty state from
 * that flag. These pin that the mount reads the snapshot, and that a push which
 * lands before the snapshot resolves is not painted over by the older read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import type { CloudWebhookRelayStatus } from '@/lib/bindings/CloudWebhookRelayStatus';

const snapshotMock = vi.fn<() => Promise<CloudWebhookRelayStatus>>();
vi.mock('@/api/system/cloud', () => ({
  cloudWebhookRelayStatus: () => snapshotMock(),
}));

import { useCloudWebhookRelay } from '../useCloudWebhookRelay';

const listenMock = vi.mocked(listen);
let nativeHandler: EventCallback<CloudWebhookRelayStatus> | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function status(over: Partial<CloudWebhookRelayStatus>): CloudWebhookRelayStatus {
  return {
    connected: true,
    lastPollAt: '2026-10-19T10:00:00Z',
    activeWebhookTriggers: 2,
    totalRelayed: 5n,
    error: null,
    ...over,
  };
}

describe('useCloudWebhookRelay', () => {
  beforeEach(() => {
    nativeHandler = null;
    snapshotMock.mockReset();
    vi.stubGlobal('requestAnimationFrame', undefined);
    listenMock.mockImplementation(async (_name: string, cb: unknown) => {
      nativeHandler = cb as EventCallback<CloudWebhookRelayStatus>;
      return () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints the snapshot on mount without waiting for a relay tick', async () => {
    snapshotMock.mockResolvedValue(status({ activeWebhookTriggers: 3 }));
    const view = renderHook(() => useCloudWebhookRelay());
    await flush();

    expect(snapshotMock).toHaveBeenCalledTimes(1);
    expect(view.result.current.connected).toBe(true);
    expect(view.result.current.activeWebhookTriggers).toBe(3);
    view.unmount();
  });

  it('keeps a pushed status that arrived before the snapshot resolved', async () => {
    let resolveSnapshot: (s: CloudWebhookRelayStatus) => void = () => {};
    snapshotMock.mockReturnValue(
      new Promise<CloudWebhookRelayStatus>((r) => {
        resolveSnapshot = r;
      }),
    );
    const view = renderHook(() => useCloudWebhookRelay());
    await flush();

    nativeHandler?.({
      event: 'cloud-webhook-relay-status',
      id: 1,
      payload: status({ activeWebhookTriggers: 9 }),
    });
    await flush();
    expect(view.result.current.activeWebhookTriggers).toBe(9);

    resolveSnapshot(status({ connected: false, activeWebhookTriggers: 1 }));
    await flush();
    expect(view.result.current.connected).toBe(true);
    expect(view.result.current.activeWebhookTriggers).toBe(9);
    view.unmount();
  });

  it('stays on the default when the snapshot read fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshotMock.mockRejectedValue({ error: 'not connected', kind: 'cloud' });
    const view = renderHook(() => useCloudWebhookRelay());
    await flush();

    expect(view.result.current.connected).toBe(false);
    view.unmount();
    err.mockRestore();
    warn.mockRestore();
  });
});
