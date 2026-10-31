// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
// Imported as text through Vite so the file stays inside tsc's program
// (node:fs would need it under __tests__/, which tsc skips).
import toolRunnerRs from '../../../../../src-tauri/src/engine/tool_runner.rs?raw';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { invokeToolDirect } from '@/api/agents/tools';

/**
 * Backend ceiling for one direct tool run, read from the Rust source rather
 * than copied: `DIRECT_TOOL_TIMEOUT` in src-tauri/src/engine/tool_runner.rs. A
 * timeout there is answered with a structured, retryable result, which only
 * reaches the panel if the IPC wrapper is still waiting. A hand-copied 120_000
 * here stayed green when the Rust value was raised past the IPC ceiling - the
 * exact drift this test exists to catch (same pattern as
 * src/api/agents/__tests__/mcpSessionTimeoutParity.test.ts).
 */
function backendDirectToolTimeoutMs(): number {
  const raw: string = toolRunnerRs;
  // Strip comments first so a commented-out or prose mention cannot satisfy the match.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const DIRECT_TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs\((\d+)\);/.exec(src);
  expect(m, 'DIRECT_TOOL_TIMEOUT not found in tool_runner.rs').not.toBeNull();
  // The constant must still be the deadline the direct run is wrapped in.
  expect(src).toMatch(/tokio::time::timeout\(\s*DIRECT_TOOL_TIMEOUT/);
  return Number(m![1]) * 1000;
}

describe('invokeToolDirect IPC ceiling', () => {
  it('outlives the backend tool timeout so its structured result lands', async () => {
    invokeWithTimeout.mockResolvedValue({ success: true });
    await invokeToolDirect('t1', 'p1', '{}');
    expect(invokeWithTimeout).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = invokeWithTimeout.mock.calls[0] as [string, unknown, { timeoutMs?: number } | undefined];
    expect(cmd).toBe('invoke_tool_direct');
    expect(args).toEqual({ toolId: 't1', personaId: 'p1', inputJson: '{}' });
    // Without an explicit value the wrapper's 90 s default rejects first.
    expect(opts?.timeoutMs ?? 90_000).toBeGreaterThan(backendDirectToolTimeoutMs());
  });
});
