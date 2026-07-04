import { useState, useEffect, useCallback } from 'react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import type { CliCapabilities } from '@/lib/bindings/CliCapabilities';

export type CliReadinessStatus = 'checking' | 'ready' | 'not_ready';

/**
 * Probes whether the Claude Code CLI is installed AND has a working subscription
 * session, so the app shell can surface the prerequisite before a first run
 * fails opaquely (ship-loop M7 cold-start friction #1/#3).
 *
 * Reuses `probe_cli_capabilities` (spawns a bounded `claude -p`, ~$0, and is
 * backend-cached on success). A thrown probe means the binary is missing OR there
 * is no working session (signed out / credit) — both actionable via the same
 * install-and-sign-in guidance, so the caller doesn't distinguish them. The probe
 * is deferred a few seconds after mount so it never competes with cold-start IPC;
 * because success is cached, a ready user pays it once per launch.
 */
export function useCliReadiness() {
  const [status, setStatus] = useState<CliReadinessStatus>('checking');
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      await invokeWithTimeout<CliCapabilities>('probe_cli_capabilities', {});
      setStatus('ready');
    } catch (err) {
      // A failed probe is the whole signal — surface the gate. Breadcrumb only.
      silentCatch('useCliReadiness:probe')(err);
      setStatus('not_ready');
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
