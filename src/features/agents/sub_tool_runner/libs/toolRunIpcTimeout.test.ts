import { describe, it, expect, vi } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { invokeToolDirect } from '@/api/agents/tools';

/** Backend ceiling for one direct tool run: `DIRECT_TOOL_TIMEOUT` in
 *  src-tauri/src/engine/tool_runner.rs. A timeout there is answered with a
 *  structured, retryable result, which only reaches the panel if the IPC
 *  wrapper is still waiting. */
const BACKEND_DIRECT_TOOL_TIMEOUT_MS = 120_000;

describe('invokeToolDirect IPC ceiling', () => {
  it('outlives the backend tool timeout so its structured result lands', async () => {
    invokeWithTimeout.mockResolvedValue({ success: true });
    await invokeToolDirect('t1', 'p1', '{}');
    expect(invokeWithTimeout).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = invokeWithTimeout.mock.calls[0] as [string, unknown, { timeoutMs?: number } | undefined];
    expect(cmd).toBe('invoke_tool_direct');
    expect(args).toEqual({ toolId: 't1', personaId: 'p1', inputJson: '{}' });
    // Without an explicit value the wrapper's 90 s default rejects first.
    expect(opts?.timeoutMs ?? 90_000).toBeGreaterThan(BACKEND_DIRECT_TOOL_TIMEOUT_MS);
  });
});
