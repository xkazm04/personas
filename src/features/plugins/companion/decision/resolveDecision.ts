/**
 * Athena hands-free decision layer (P3) — shared resolution logic.
 *
 * The three input methods that answer a {@link PendingDecision} —
 * clicking a chip in `OrbDecisionBubble`, the `;`-leader numeric key in
 * `AthenaOrbLayer`, and spoken numbers via `useHoldToTalk` — must resolve
 * decisions identically. This module is the single source of that behaviour
 * so the surfaces never drift:
 *
 *  - {@link runDecisionOption} fires an option's `run()` (swallowing both sync
 *    throws and rejected promises into a Sentry breadcrumb) and then clears the
 *    pending decision.
 *  - {@link explainDecision} is the `0` path: it flips `decisionExplained` so
 *    the recommendation surfaces, WITHOUT clearing the decision (the options
 *    stay pickable — see Slice 4).
 *
 * Both read the store imperatively (`getState()`) so non-React callers (the raw
 * keydown handler, the STT session-end effect) can use them outside the React
 * render path.
 */
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from '../companionStore';
import type { DecisionOption } from './types';

/**
 * Run one option's action then clear the pending decision. Mirrors the
 * `OrbDecisionBubble` click handler exactly (sync + async errors are caught and
 * reported, never thrown), so every input method behaves the same.
 */
export function runDecisionOption(option: DecisionOption): void {
  try {
    const r = option.run();
    if (r && typeof (r as Promise<void>).then === 'function') {
      (r as Promise<void>).catch(silentCatch('companion/resolveDecision:run'));
    }
  } catch (err) {
    silentCatch('companion/resolveDecision:run')(err);
  }
  useCompanionStore.getState().clearPendingDecision();
}

/**
 * The `0` path: explain + recommend. Keeps the decision pending (does NOT
 * clear) — it only flips `decisionExplained` so the bubble reveals the
 * recommendation while the numbered options remain answerable (Slice 4).
 */
export function explainDecision(): void {
  useCompanionStore.getState().markDecisionExplained();
}
