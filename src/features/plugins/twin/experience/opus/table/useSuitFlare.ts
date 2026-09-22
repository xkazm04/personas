/**
 * The suit that just became complete, for one flare. A suit completes when
 * READINESS says so — a kept bio long enough, a tone row, a bound channel,
 * enough approved memories — never when the guide thinks it has asked enough.
 *
 * Disarmed for a moment after mount: the twin's rows hydrate asynchronously,
 * and a suit filling in from storage is not the person's progress.
 */

import { useEffect, useRef, useState } from 'react';
import type { SetupChecklistItem, SetupFocus } from '../../../setup/setupContract';

const ARM_AFTER_MS = 1500;
const FLARE_MS = 2400;

export function useSuitFlare(checklist: SetupChecklistItem[]): SetupFocus | null {
  const [flare, setFlare] = useState<SetupFocus | null>(null);
  const previous = useRef<Map<SetupFocus, string>>(new Map());
  const armed = useRef(false);

  useEffect(() => {
    const arm = window.setTimeout(() => {
      armed.current = true;
    }, ARM_AFTER_MS);
    return () => window.clearTimeout(arm);
  }, []);

  useEffect(() => {
    let completed: SetupFocus | null = null;
    for (const item of checklist) {
      const before = previous.current.get(item.id);
      if (armed.current && before !== undefined && before !== 'set' && item.status === 'set') {
        completed = item.id;
      }
      previous.current.set(item.id, item.status);
    }
    if (completed) setFlare(completed);
  }, [checklist]);

  // The glow's own clock, keyed on the flare rather than on the checklist: a
  // checklist that changes again mid-glow must not cancel it and leave it lit.
  useEffect(() => {
    if (!flare) return;
    const settle = window.setTimeout(() => setFlare(null), FLARE_MS);
    return () => window.clearTimeout(settle);
  }, [flare]);

  return flare;
}
