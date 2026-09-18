// useAutoCapture — store the CLI's live Claude login the moment the strip
// notices it is not one of the stored plans.
//
// This used to be a *Store this login* button on the live card (and a "not
// stored yet" notice in the controls row). Both asked the operator to do the
// one thing the strip could always do for them: the backend says
// `livePresent && !liveCaptured`, `capture` needs nothing else, and the
// snapshot that comes back is the same one a click would have produced.
//
// ONE ATTEMPT PER LIVE LOGIN. The guard is a module-scoped set keyed by the
// live email, so a capture that fails (token dead, endpoint down) toasts once
// and does not fire again on the next poll, the next remount or the next
// re-render — and a *different* login arriving later still gets its own
// attempt. A login with no email (an install whose `~/.claude.json` carries no
// `oauthAccount`) is keyed on a sentinel so it, too, is tried exactly once.
// Forgetting a stored plan is still a deliberate act on the card.

import { useEffect } from 'react';

const UNKNOWN_LOGIN = '\0unknown';

/** Live logins already handed to `capture` in this app session (module state). */
const attempted = new Set<string>();

export function useAutoCapture({
  active, liveEmail, capture,
}: {
  /** The backend reports a live login that is not stored, and the strip is live (not simulated). */
  active: boolean;
  liveEmail: string | null;
  capture: () => Promise<void>;
}): void {
  useEffect(() => {
    if (!active) return;
    const key = liveEmail ?? UNKNOWN_LOGIN;
    if (attempted.has(key)) return;
    attempted.add(key);
    void capture();
  }, [active, liveEmail, capture]);
}

/** Test hatch — the guard is module state. */
export function _resetAutoCaptureForTests(): void {
  attempted.clear();
}
