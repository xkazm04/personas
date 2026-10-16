import { useEffect, useMemo, useState } from 'react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { ProcessEntry } from '../monitorModel';

type ActiveProcesses = Record<string, Pick<ProcessEntry['proc'], 'status'>>;

/**
 * The clock behind the SystemBand's elapsed times and the drawer's live
 * timers. Ticks once a second only while something is running, and only while
 * someone can see it.
 */
export function useElapsedTick(activeProcesses: ActiveProcesses, isFleetView: boolean, visible: boolean): number {
  // The app's one visibility primitive (`@/lib/documentVisibility` via
  // `useSyncExternalStore`) — the same source `PollingCoordinator` suspends its
  // cadence buckets from. Named `documentVisible` rather than `visible`
  // because the WINDOW being visible and the OVERLAY being on screen are two
  // independent questions, and the tick has to ask both.
  const documentVisible = useDocumentVisibility();
  const anyRunning = useMemo(
    () => Object.values(activeProcesses).some((p) => p.status === 'running'),
    [activeProcesses],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // `now` drives the SystemBand's elapsed times and the drawer's live timers,
    // both of which are Activity-only. The channel surfaces consume none of it,
    // so ticking there would re-render the whole workspace for nothing.
    //
    // The third condition is the window itself. This is the Monitor's only raw
    // `setInterval` — everything else runs on the PollingCoordinator, which
    // suspends on `visibilitychange` — so it was the one loop that kept
    // re-rendering the entire Monitor tree once a second behind a hidden
    // window, painting a clock nobody could see. `useDocumentVisibility` is the
    // app's single visibility primitive and reads the same store the
    // coordinator subscribes to, so the two cannot disagree about what
    // "hidden" means.
    //
    // Re-stamping `now` up front is what makes re-show honest rather than just
    // cheap: while hidden, `now` freezes at the last tick, so a window restored
    // after a minute away would render every elapsed time a minute short until
    // the next second elapsed. The effect re-runs on the false→true edge and
    // corrects it in the same commit that restarts the tick.
    // The fourth condition is the OVERLAY itself, and it arrived with
    // persistence. A closed Monitor used to be an unmounted Monitor, so this
    // interval could not outlive it; now the whole tree stays alive behind
    // `content-visibility: hidden` and the clock would keep ticking against a
    // surface nobody can see — re-rendering the Monitor once a second to paint
    // into a subtree the browser is not painting. It is CLEARED, not merely
    // skipped in the body: an interval that wakes every second to decide it
    // has nothing to do is still a wake, and `now` is re-stamped on the
    // false→true edge exactly as it is for the window, so reopening after ten
    // minutes away shows honest elapsed times in the first commit.
    if (!anyRunning || !isFleetView || !documentVisible || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning, isFleetView, documentVisible, visible]);
  return now;
}
