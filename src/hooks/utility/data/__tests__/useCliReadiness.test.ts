import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const probeCliCapabilities = vi.fn();
vi.mock('@/api/agents/evolution', () => ({
  probeCliCapabilities: (...args: unknown[]) => probeCliCapabilities(...args),
}));

import { classifyCliProbeFailure, useCliReadiness } from '../useCliReadiness';

// The probe returns a free-form string, so these are the EXACT machine markers
// the backend writes:
//  - engine/src/cli_process.rs  -> spawn_temp: "Failed to spawn CLI: {io error}"
//  - engine/src/cli_capabilities.rs -> "probe: CLI exited before emitting an
//    init event" / "probe: timed out waiting for CLI init event"
// The first means the binary is not there; the rest mean it started and then
// produced no session.
describe('classifyCliProbeFailure', () => {
  it('reads a failed spawn as a missing binary', () => {
    expect(
      classifyCliProbeFailure({ error: 'Internal error: Failed to spawn CLI: program not found (os error 2)' }),
    ).toBe('missing_binary');
    expect(classifyCliProbeFailure(new Error('spawn claude ENOENT'))).toBe('missing_binary');
  });

  it('reads a started-but-sessionless probe as signed out', () => {
    expect(classifyCliProbeFailure({ error: 'probe: CLI exited before emitting an init event' })).toBe('no_session');
    expect(classifyCliProbeFailure({ error: 'probe: timed out waiting for CLI init event' })).toBe('no_session');
  });

  it('defaults an unrecognised failure to signed out rather than to install', () => {
    // Guessing "install Node" at a stranger is the worse of the two wrong
    // answers: it asks for a change to the machine instead of a sign-in.
    expect(classifyCliProbeFailure(null)).toBe('no_session');
  });
});

describe('useCliReadiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    probeCliCapabilities.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Fire the 3.5s deferral, then let the probe promise settle. `waitFor`
  // cannot be used here: it polls on real timers, which fake timers freeze.
  const runDeferredProbe = async () => {
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('starts in checking and resolves to ready on a successful probe', async () => {
    probeCliCapabilities.mockResolvedValue({ served_from_cache: false });
    const { result } = renderHook(() => useCliReadiness());
    expect(result.current.status).toBe('checking');
    await runDeferredProbe();
    expect(result.current.status).toBe('ready');
  });

  it('reports missing_binary and no_session as distinct statuses', async () => {
    probeCliCapabilities.mockRejectedValue({ error: 'Failed to spawn CLI: program not found' });
    const missing = renderHook(() => useCliReadiness());
    await runDeferredProbe();
    expect(missing.result.current.status).toBe('missing_binary');

    probeCliCapabilities.mockRejectedValue({ error: 'probe: CLI exited before emitting an init event' });
    const signedOut = renderHook(() => useCliReadiness());
    await runDeferredProbe();
    expect(signedOut.result.current.status).toBe('no_session');
  });
});
