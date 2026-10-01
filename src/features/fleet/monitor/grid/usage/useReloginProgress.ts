// useReloginProgress — the re-login run's progress event, as a subscription.
//
// The backend emits `fleet-claude-relogin-progress` (a `ReloginState`) at every
// step of a run. The strip must not DEPEND on it: `useClaudeAccounts` also
// re-reads the snapshot on a short cadence while a run is live, so a missed
// event costs seconds, not correctness.

import { useEffect, useRef } from 'react';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import type { ReloginState } from '@/lib/bindings/ReloginState';

export function useReloginProgress(enabled: boolean, onState: (state: ReloginState) => void): void {
  const ref = useRef(onState);
  ref.current = onState;
  useEffect(() => {
    if (!enabled) return undefined;
    let off: (() => void) | null = null;
    let cancelled = false;
    typedListen(EventName.FLEET_CLAUDE_RELOGIN_PROGRESS, (state) => ref.current(state))
      .then((fn) => {
        if (cancelled) fn();
        else off = fn;
      })
      .catch(silentCatch('monitor:reloginProgress'));
    return () => {
      cancelled = true;
      off?.();
    };
  }, [enabled]);
}
