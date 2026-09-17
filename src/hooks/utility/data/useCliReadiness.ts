import { useState, useEffect, useCallback } from 'react';
import { probeCliCapabilities } from '@/api/agents/evolution';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

export type CliReadinessStatus = 'checking' | 'ready' | 'missing_binary' | 'no_session';

/** The two failure statuses, for callers that branch on guidance. */
export type CliReadinessFailure = Extract<CliReadinessStatus, 'missing_binary' | 'no_session'>;

/**
 * Markers the backend writes when the probe cannot even START the CLI —
 * `CliProcessDriver::spawn_temp` (`src-tauri/engine/src/cli_process.rs`) wraps
 * the spawn io error as `"Failed to spawn CLI: {e}"`, and the OS text under it
 * is a not-found error. Everything else the probe can fail with (EOF before
 * init, timeout waiting for init, a non-init transcript) means the binary DID
 * start and then refused to produce a session.
 *
 * Read as machine markers, the same way `detectAutoResolution` reads the
 * engine's reviewer-note markers — the probe returns a free-form string, so
 * there is no typed kind to switch on.
 */
const MISSING_BINARY_MARKERS = [
  /failed to spawn cli/i,
  /\bENOENT\b/,
  /os error 2\b/,
  /not recognized as an internal or external command/i,
  /command not found/i,
  /no such file or directory/i,
  /program not found/i,
];

/**
 * Split a thrown `probe_cli_capabilities` into the two failures that need
 * DIFFERENT guidance: the CLI is not installed (install it) versus the CLI is
 * installed but has no working session (sign in). Collapsing them sent a
 * signed-out user to install a binary they already have.
 */
export function classifyCliProbeFailure(err: unknown): CliReadinessFailure {
  const message = extractMessage(err);
  return MISSING_BINARY_MARKERS.some((re) => re.test(message)) ? 'missing_binary' : 'no_session';
}

/**
 * Probes whether the Claude Code CLI is installed AND has a working subscription
 * session, so the app shell can surface the prerequisite before a first run
 * fails opaquely (ship-loop M7 cold-start friction #1/#3).
 *
 * Reuses `probe_cli_capabilities` (spawns a bounded `claude -p`, ~$0, and is
 * backend-cached on success). A thrown probe is classified into
 * `missing_binary` or `no_session` so the caller can route to the right fix
 * instead of showing one combined install-and-sign-in wall. The probe is
 * deferred a few seconds after mount so it never competes with cold-start IPC;
 * because success is cached, a ready user pays it once per launch.
 */
export function useCliReadiness() {
  const [status, setStatus] = useState<CliReadinessStatus>('checking');
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      await probeCliCapabilities();
      setStatus('ready');
    } catch (err) {
      // A failed probe is the whole signal — surface the gate. Breadcrumb only.
      silentCatch('useCliReadiness:probe')(err);
      setStatus(classifyCliProbeFailure(err));
    }
  }, []);

  useEffect(() => {
    // Defer out of the cold-start window; the probe spawns a CLI process.
    const timer = setTimeout(() => { void check(); }, 3500);
    return () => clearTimeout(timer);
  }, [check]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { status, dismissed, retry: check, dismiss };
}
