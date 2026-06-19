/**
 * studioCommit — maps a Chain Studio draft link to a real backend trigger.
 *
 * Persona→persona links commit as a `chain` trigger on the TARGET persona,
 * bound to the source via `source_persona_id`, with the link condition mapped
 * onto the backend `ChainCondition` (any / success / failure). The target runs
 * when the source completes and the condition holds.
 * See docs/plans/studio-supersedes-builder.md (Phase 1).
 *
 * Not yet committable (deferred):
 *  - signal sources (schedule / webhook / polling / …) — need per-type config
 *    (cron, url, …) the draft doesn't capture; gathered in a later phase.
 *  - `output_match` — maps to the backend `jsonpath` condition, which needs a
 *    JSONPath + expected value the draft model doesn't model yet.
 */
import type { CreateTriggerInput } from '@/lib/bindings/CreateTriggerInput';
import type { DraftLink } from './studioDraftModel';

export type CommitBlocker = 'signal_source' | 'output_match';

/** Why a link can't be committed yet — `null` when it's committable. */
export function commitBlocker(link: DraftLink): CommitBlocker | null {
  if (link.source.kind !== 'persona') return 'signal_source';
  if (link.condition === 'output_match') return 'output_match';
  return null;
}

/**
 * Build the `create_trigger` input for a committable persona→persona link.
 * Returns `null` when the link isn't committable (see {@link commitBlocker}).
 */
export function draftLinkToTriggerInput(link: DraftLink): CreateTriggerInput | null {
  if (link.source.kind !== 'persona') return null;

  let conditionType: 'any' | 'success' | 'failure';
  switch (link.condition) {
    case 'on_success': conditionType = 'success'; break;
    case 'on_failure': conditionType = 'failure'; break;
    case null: conditionType = 'any'; break;
    default: return null; // output_match — not committable yet
  }

  return {
    persona_id: link.targetPersonaId,
    trigger_type: 'chain',
    config: JSON.stringify({
      source_persona_id: link.source.personaId,
      condition: { type: conditionType },
      event_type: 'chain_triggered',
      // Forward the source step's output so the target can see the previous
      // step's result. The engine only injects `source_output` into the next
      // step when this flag is true (engine/chain.rs); without it a Studio-built
      // A->B chain advanced control flow but B received no upstream payload
      // (UAT L1 F-CHAIN-NO-PAYLOAD-FORWARD). team_handoff wiring already sets it.
      payload_forward: true,
    }),
    enabled: true,
    use_case_id: null,
  };
}
