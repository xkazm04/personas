// Scene settle gate — the canvas's answer to a browser's render-blocking CSS.
//
// A browser does not paint the page before its stylesheet arrives, because a
// flash of unstyled content followed by the styled page reads as breakage, not
// as progress. The Mastermind canvas had the equivalent defect: on a cold open
// ~15 data arrivals landed in the first two seconds (passport skeleton, phase
// 0, phase 1, phase 2, relations, scans, goals, monitoring, spend, KPIs, ship),
// and each one repainted every island's VERDICT. Measured 2026-09-24 on the
// owner's 20-project portfolio: Pumper painted red with 8 alerts at 0.7 s and
// yellow with 4 at 2.5 s; the Soundings chart named a different project as
// "needs you first" before and after.
//
// So identity paints at once (names, positions: the islands and stations are
// there from the first frame, drawn as calm provisional ghosts), and verdicts
// wait until every family that changes a verdict has answered, then land as
// ONE commit. A family that fails counts as answered (its cells render
// `unknown`, honestly). A ceiling keeps a stuck family from holding the canvas
// hostage. Once settled, the gate stays open for the rest of the app session:
// the stores and module caches hold the data, so a re-open paints verdicts
// immediately and later changes adopt live.
import { useEffect, useState } from 'react';

import type { FamilyStatus } from './sceneStore';

export interface SettleInputs {
  /** The passports on screen are measured (not a skeleton or an estimate), or
   *  the passport build failed. */
  passportsReady: boolean;
  /** Every scene-store family whose data changes a verdict. */
  families: readonly FamilyStatus[];
  /** Factory KPI tree loaded (feeds the KPI dimension). */
  factoryReady: boolean;
  /** Ship-milestone summaries answered (feed "late"). */
  shipReady: boolean;
}

/** Longest the canvas holds verdicts back on a cold open. The whole fan-out
 *  measured under 2 s; this is the ceiling for a slow or stuck family. */
export const SETTLE_CEILING_MS = 5_000;

const answered = (s: FamilyStatus) => s !== 'idle' && s !== 'loading';

export function isSceneSettled(i: SettleInputs): boolean {
  return i.passportsReady && i.factoryReady && i.shipReady && i.families.every(answered);
}

/** Session latch: the first settle opens the gate for every later mount. */
let settledThisSession = false;

/** Test hook. */
export function __resetSceneSettleForTests(): void {
  settledThisSession = false;
}

export function useSceneSettle(inputs: SettleInputs, ceilingMs: number = SETTLE_CEILING_MS): boolean {
  const [settled, setSettled] = useState(settledThisSession);
  const ready = isSceneSettled(inputs);

  useEffect(() => {
    if (settled) return;
    if (ready) {
      settledThisSession = true;
      setSettled(true);
    }
  }, [ready, settled]);

  useEffect(() => {
    if (settled) return undefined;
    const id = window.setTimeout(() => {
      settledThisSession = true;
      setSettled(true);
    }, ceilingMs);
    return () => window.clearTimeout(id);
  }, [settled, ceilingMs]);

  // Ready in this very render: open now rather than one commit later.
  return settled || ready;
}
