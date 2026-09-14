// useAutopilotStatus — the Autopilot switch's one read, rolled every 30 s.
//
// The attention loop ticks in the background, so a session-long header must
// roll its readout (the AttentionLoopCard idiom: mount + 30 s + visibility).
// A single-slot module cache keeps the last status across the Monitor's
// unmount/remount, so reopening the board paints the switch warm rather than
// blank for a round-trip (loading pattern v2, mechanic 4).

import { useCallback, useEffect, useRef, useState } from 'react';
import { fleetAutopilotStatus, setFleetAutopilot } from '@/api/fleet/autopilot';
import { silentCatch } from '@/lib/silentCatch';
import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';

const POLL_MS = 30_000;

let warm: AutopilotStatus | null = null;

export interface AutopilotState {
  status: AutopilotStatus | null;
  /** A read failed and nothing warm exists — say "unavailable", not "off". */
  failed: boolean;
  saving: boolean;
  toggle: () => Promise<void>;
  refresh: () => void;
}

export function useAutopilotStatus(): AutopilotState {
  const [status, setStatus] = useState<AutopilotStatus | null>(warm);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const fetching = useRef(false);
  const cancelled = useRef(false);

  const refresh = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    fleetAutopilotStatus()
      .then((s) => {
        warm = s;
        if (!cancelled.current) {
          setStatus(s);
          setFailed(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled.current) setFailed(true);
        silentCatch('fleet/AutopilotSwitch')(err);
      })
      .finally(() => {
        fetching.current = false;
      });
  }, []);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const tick = () => {
      if (!document.hidden) refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (!status || saving) return;
    const next = !status.enabled;
    setSaving(true);
    try {
      await setFleetAutopilot(next);
      setStatus((s) => (s ? { ...s, enabled: next } : s));
      if (warm) warm = { ...warm, enabled: next };
    } finally {
      setSaving(false);
    }
  }, [status, saving]);

  return { status, failed, saving, toggle, refresh };
}
