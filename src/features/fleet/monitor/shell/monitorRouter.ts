// The Monitor's router: which of the four header destinations is on screen,
// how a deep link lands on one, and the pressed-tab affordance.

import { useCallback, useEffect, useState, startTransition } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useMandateDrawerRequest } from '../grid/prototype/entry-e/mandate/mandateDrawerRequest';

/** The four top-level Monitor destinations. Blueprint (spark one-control) is
 *  the lens-scan products' door that does not wait for a Decision Center card. */
export type MonitorView = 'activity' | 'blueprint' | 'conversations' | 'map';

/**
 * Last-selected tab, remembered for the life of the session.
 *
 * It was module-scoped because the Monitor fully unmounted on close, so
 * component state could not carry it. **That is no longer true** — the overlay
 * now persists for the app session and hides instead, so `view` itself
 * survives a close and this is redundant for the close/reopen case it was
 * written for. It is kept deliberately: it is still the initializer for the
 * genuine remounts that remain (the dev-only standalone mount, a Fast Refresh
 * boundary, a test), and other code may yet read the last destination from
 * here. Deliberately NOT persisted — a fresh app launch should land on
 * Activity.
 */
let lastView: MonitorView = 'activity';

/** The store's deep-link vocabulary → this router's destinations. One function
 *  rather than the same ternary at the initializer and the effect, which is how
 *  a third value gets added to one of them and not the other.
 *
 *  `'channels'` meant "the merged Timeline" and no longer names a Monitor
 *  destination — the Timeline is an Overview tab since 2026-10-06. It is kept
 *  in the store's union rather than removed, because removing it would silently
 *  turn a stale caller's deep link into a type error at the call site and a
 *  no-op at runtime; here it lands on Activity, the Monitor's own default.
 *  Measured 2026-10-06: no caller sends it. A caller that wants the Timeline
 *  should set `overviewTab` instead (see `useMonitorChannels`). */
function viewForSignal(signal: 'fleet' | 'channels' | 'conversations'): MonitorView {
  if (signal === 'conversations') return 'conversations';
  return 'activity';
}

export interface MonitorRouter {
  /** The destination being rendered. */
  view: MonitorView;
  /** What the tab strip highlights: the press if one is in flight, else the view. */
  activeTab: MonitorView;
  goToView: (next: MonitorView) => void;
}

export function useMonitorRouter(): MonitorRouter {
  // A live pop-up can deep-link straight into a Monitor destination via the
  // transient `monitorInitialView` signal. Two of the three names predate the
  // router and are left alone: 'channels' means "the merged Timeline", 'fleet'
  // means "the fleet board", which is Activity now. 'conversations' is the one
  // added deliberately — a channel message arriving as a pop-up belongs in the
  // room where you can answer it, not in the read-only merged stream, so that
  // is where the corner cards now land.
  const monitorInitialView = useSystemStore((s) => s.monitorInitialView);
  const setMonitorInitialView = useSystemStore((s) => s.setMonitorInitialView);
  const [view, setView] = useState<MonitorView>(() =>
    monitorInitialView ? viewForSignal(monitorInitialView) : lastView,
  );
  /**
   * THE TAB THE OPERATOR JUST PRESSED, which is not the same thing as the tab
   * being rendered.
   *
   * `goToView` hands the actual view change to `startTransition`, so the
   * outgoing surface stays mounted and interactive while the incoming one (a
   * lazy chunk, in three of the four cases) builds. The standard trap with
   * that is the one thing the operator can see: the tab strip reads `view`, so
   * the pill they clicked would not light up until the new body had finished
   * arriving, and a 300ms chunk fetch would read as a dead click. This holds
   * the pressed destination as an URGENT update, cleared inside the same
   * transition that commits the view, so the affordance moves on the frame of
   * the click and the two can never end up disagreeing.
   */
  const [pressedView, setPressedView] = useState<MonitorView | null>(null);
  const goToView = useCallback((next: MonitorView) => {
    setPressedView(next);
    startTransition(() => {
      setView(next);
      setPressedView(null);
    });
  }, []);
  useEffect(() => {
    lastView = view;
  }, [view]);
  useEffect(() => {
    if (!monitorInitialView) return;
    setView(viewForSignal(monitorInitialView));
    setMonitorInitialView(null);
  }, [monitorInitialView, setMonitorInitialView]);
  // The dock's act ticker asks for the act log, which only Activity hosts (its
  // mandate drawer consumes the request on mount). A press made from
  // Conversations, the Blueprint or the Map takes the operator to Activity,
  // where it lands.
  const actLogPending = useMandateDrawerRequest((s) => s.pending !== null);
  useEffect(() => {
    if (actLogPending && view !== 'activity') goToView('activity');
  }, [actLogPending, view, goToView]);

  return { view, activeTab: pressedView ?? view, goToView };
}
