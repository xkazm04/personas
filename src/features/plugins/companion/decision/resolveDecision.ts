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
import { companionSendMessage, companionRecordUxSignal } from '@/api/companion';
import { useCompanionStore } from '../companionStore';
import type { DecisionOption, PendingDecision } from './types';

/**
 * Run one option's action then clear the pending decision. Mirrors the
 * `OrbDecisionBubble` click handler exactly (sync + async errors are caught and
 * reported, never thrown), so every input method behaves the same.
 */
export function runDecisionOption(option: DecisionOption): void {
  const source = useCompanionStore.getState().pendingDecision?.source ?? 'unknown';
  try {
    const r = option.run();
    if (r && typeof (r as Promise<void>).then === 'function') {
      (r as Promise<void>).catch(silentCatch('companion/resolveDecision:run'));
    }
  } catch (err) {
    silentCatch('companion/resolveDecision:run')(err);
  }
  // F3 — he resolved a decision hands-free via the orb (vs falling through to chat).
  companionRecordUxSignal(
    'decision_resolved',
    JSON.stringify({ via: 'orb', source, option: option.key }),
  );
  useCompanionStore.getState().clearPendingDecision();
}

/**
 * The `0` path: explain + recommend. Two layers, both keeping the decision
 * pending (the numbered options remain answerable):
 *
 *  1. Instant — flips `decisionExplained` so the bubble reveals the
 *     pre-baked recommendation (Slice 4 behaviour, unchanged).
 *  2. Escalation (Explain-in-Cockpit) — fires a synthetic
 *     `decision-explain` turn carrying the decision's full context.
 *     Athena replies with an `explain_in_cockpit` op; the CompanionPanel
 *     listener renders it as a contextual cockpit overlay and clears
 *     `explainComposing`. While the turn runs, the orb plays the
 *     `composing` clip and the bubble shows a processing row.
 *
 * If the turn fails — or finishes without the op — `explainComposing`
 * drops and `explainComposeError` carries a token the bubble maps to a
 * translated fallback line. The static recommendation is the floor.
 */
export function explainDecision(): void {
  const store = useCompanionStore.getState();
  const decision = store.pendingDecision;
  store.markDecisionExplained();
  if (!decision || store.explainComposing) return;

  store.setExplainComposeError(null);
  store.setExplainComposing(true);
  const directive = buildExplainDirective(decision);
  companionSendMessage(directive, false, false, false, 'decision-explain')
    .then(() => {
      // Give the explain event a beat to land (it's emitted just before the
      // invoke resolves); if composing still holds after that, the turn
      // finished without emitting the op.
      setTimeout(() => {
        const s = useCompanionStore.getState();
        if (s.explainComposing) {
          s.setExplainComposing(false);
          s.setExplainComposeError('no-spec');
        }
      }, 1500);
    })
    .catch((err) => {
      silentCatch('companion/resolveDecision:explain-turn')(err);
      const s = useCompanionStore.getState();
      s.setExplainComposing(false);
      s.setExplainComposeError('turn-failed');
    });
}

/**
 * The synthetic prompt for the `decision-explain` turn. Model-facing (never
 * rendered), so it's deliberately not translated. Everything Athena may cite
 * must be in here or in her own memory — the constitution's "Explaining a
 * decision visually" section forbids invented data.
 */
function buildExplainDirective(decision: PendingDecision): string {
  const options = decision.options
    .map((o, i) => `${i + 1}. ${o.label}${o.hint ? ` — ${o.hint}` : ''}`)
    .join('\n');
  return [
    `[decision-explain] The user pressed "0 — Explain" on your orb decision bubble and is waiting for a visual explanation in the Cockpit.`,
    '',
    `Decision id: ${decision.id}`,
    `Source: ${decision.source}${decision.sourceRef ? ` (${decision.sourceRef})` : ''}`,
    `Question: ${decision.prompt}`,
    `Options:`,
    options,
    `Your earlier short recommendation: ${decision.recommendation ?? '(none)'}`,
    `Detail: ${decision.detail ?? '(none)'}`,
    `Underlying payload: ${decision.payload ?? '(none)'}`,
    '',
    `Respond by emitting exactly ONE \`explain_in_cockpit\` op (constitution: "Explaining a decision visually") with decision_id "${decision.id}". Lead with a \`verdict\` widget — set recommended_option to the option number you would pick — then 1-3 supporting widgets grounded ONLY in the data above and your own memory; never invent numbers. Keep the chat text to one short sentence.`,
  ].join('\n');
}
