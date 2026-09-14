// useSimulatedRail — the rail's mock rows, with their labels resolved.
//
// `simulation/simRail` is deliberately i18n-free, like every other producer of
// `RailRow` (`railModel`'s rule 2: labels arrive pre-translated so a variant
// can resolve copy however it likes). This hook is the one place that crosses
// that line, and it borrows the SAME copy the real feeds use — `kindCopy` for a
// review, the Dispatch tab's own label for an idea — so a simulated row and a
// real one of the same kind are never labelled differently.
//
// Returns `null` while the simulation is off, which is what `ActivityRail`
// reads as "use your real feeds".

import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { kindCopy } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import { buildSimRail, type SimRailRows } from './simulation';

export function useSimulatedRail(enabled: boolean): SimRailRows | null {
  const { t } = useTranslation();
  const review = kindCopy(t, 'review').one;
  const dispatch = t.monitor.grid_rail_tab_dispatch;
  const message = t.monitor.grid_rail_tab_messages;

  return useMemo(
    () => (enabled ? buildSimRail({ review, dispatch, message }) : null),
    [enabled, review, dispatch, message],
  );
}
