// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { kbIngestText } from '@/api/vault/database/vectorKb';

/** invokeWithTimeout's fallback when a caller passes no `timeoutMs`. */
const IPC_DEFAULT_TIMEOUT_MS = 90_000;

describe('kbIngestText: embeds the whole paste inline, so the wrapper must outlive 90 s', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue(3);
  });

  it('passes an explicit timeout above the IPC default', async () => {
    await kbIngestText('kb1', 'title', 'text');
    const call = invokeWithTimeout.mock.calls[0] as [string, unknown, { timeoutMs?: number } | undefined];
    expect(call[0]).toBe('kb_ingest_text');
    expect(call[2]?.timeoutMs, 'no explicit timeout: the 90 s default applies').toBeDefined();
    expect(call[2]!.timeoutMs!).toBeGreaterThan(IPC_DEFAULT_TIMEOUT_MS);
  });
});
