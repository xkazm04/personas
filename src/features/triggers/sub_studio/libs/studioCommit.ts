/**
 * studioCommit — maps a Chain Studio draft link to a real backend trigger.
 *
 * Two commit paths:
 *  · Persona→persona links commit DIRECTLY as a `chain` trigger on the TARGET
 *    persona, bound to the source via `source_persona_id`, with the link
 *    condition mapped onto the backend `ChainCondition` (any / success /
 *    failure / jsonpath). The target runs when the source completes and the
 *    condition holds. See docs/plans/studio-supersedes-builder.md (Phase 1).
 *  · Signal-source links (schedule / webhook / polling / …) commit through the
 *    Studio's configure-&-commit modal, which hosts the full trigger form
 *    (`TriggerAddForm`) locked to the source's type — the form collects the
 *    per-type config (cron, url, secret, …) with its real validation, and the
 *    trigger is created on the TARGET persona. See `linkCommitsViaForm`.
 *
 * `output_match` maps to the backend `jsonpath` condition (engine/chain.rs):
 * the draft carries `outputMatch: { path, expected }`; the route is
 * committable once both are filled. Conditions only gate persona-completion
 * sources — signal-source links ignore the condition field (a schedule has no
 * upstream output to match).
 */
import type { CreateTriggerInput } from '@/lib/bindings/CreateTriggerInput';
import type { DraftLink } from './studioDraftModel';

export type CommitBlocker = 'signal_source' | 'output_match';

/**
 * Signal-source trigger types whose per-type config the full trigger form can
 * collect — these commit through the configure-&-commit modal. `chain` is
 * excluded (a chain source IS a persona-completion source: arm the persona
 * instead); `manual` is excluded (nothing to trigger on).
 */
export const FORM_COMMITTABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'schedule',
  'polling',
  'webhook',
  'event_listener',
  'file_watcher',
  'clipboard',
  'app_focus',
  'composite',
]);

/** True when the link commits through the configure-&-commit modal. */
export function linkCommitsViaForm(link: DraftLink): boolean {
  return link.source.kind === 'trigger' && FORM_COMMITTABLE_SOURCE_TYPES.has(link.source.triggerType);
}

/** Why a link can't be committed yet — `null` when it's committable. */
export function commitBlocker(link: DraftLink): CommitBlocker | null {
  if (link.source.kind !== 'persona') {
    return linkCommitsViaForm(link) ? null : 'signal_source';
  }
  if (link.condition === 'output_match') {
    const om = link.outputMatch;
    return om && om.path.trim() && om.expected.trim() ? null : 'output_match';
  }
  return null;
}

/**
 * Build the `create_trigger` input for a directly-committable persona→persona
 * link. Returns `null` when the link isn't directly committable — signal
 * sources go through the modal path instead (see {@link linkCommitsViaForm}).
 */
export function draftLinkToTriggerInput(link: DraftLink): CreateTriggerInput | null {
  if (link.source.kind !== 'persona') return null;

  let condition: Record<string, unknown>;
  switch (link.condition) {
    case 'on_success': condition = { type: 'success' }; break;
    case 'on_failure': condition = { type: 'failure' }; break;
    case 'output_match': {
      const om = link.outputMatch;
      if (!om || !om.path.trim() || !om.expected.trim()) return null;
      // Backend shape (engine/chain.rs:75-77): the path field is literally
      // named "jsonpath"; unresolvable paths log + treat as non-matching.
      condition = { type: 'jsonpath', jsonpath: om.path.trim(), expected: om.expected.trim() };
      break;
    }
    case null: condition = { type: 'any' }; break;
    default: return null;
  }

  return {
    persona_id: link.targetPersonaId,
    trigger_type: 'chain',
    config: JSON.stringify({
      source_persona_id: link.source.personaId,
      condition,
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

/**
 * Build the `create_trigger` input for a signal-source link committed through
 * the configure-&-commit modal: the form-collected config becomes a trigger of
 * the source's type on the TARGET persona.
 */
export function formConfigToTriggerInput(
  link: DraftLink,
  triggerType: string,
  config: Record<string, unknown>,
): CreateTriggerInput {
  return {
    persona_id: link.targetPersonaId,
    trigger_type: triggerType,
    config: JSON.stringify(config),
    enabled: true,
    use_case_id: null,
  };
}
