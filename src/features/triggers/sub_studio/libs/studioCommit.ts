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
import type { DraftLink } from './studioDraftModel';
import { FORM_COMMITTABLE_SOURCE_TYPES } from './routeCodec';

// The write side lives in routeCodec beside its inverse (triggersToRoutes);
// re-exported so existing call sites keep this import path.
export { FORM_COMMITTABLE_SOURCE_TYPES, draftLinkToTriggerInput, formConfigToTriggerInput } from './routeCodec';

export type CommitBlocker = 'signal_source' | 'output_match';

/** True when the link commits through the configure-&-commit modal. */
export function linkCommitsViaForm(link: DraftLink): boolean {
  return link.source.kind === 'trigger' && FORM_COMMITTABLE_SOURCE_TYPES.has(link.source.triggerType);
}

/** True when the source is a Marketplace feed (direct-commits to an event_listener). */
export function isMarketplaceSource(link: DraftLink): boolean {
  return link.source.kind === 'marketplace';
}

/** Why a link can't be committed yet — `null` when it's committable. */
export function commitBlocker(link: DraftLink): CommitBlocker | null {
  if (link.source.kind === 'marketplace') return null; // fully specified — direct commit
  if (link.source.kind !== 'persona') {
    return linkCommitsViaForm(link) ? null : 'signal_source';
  }
  if (link.condition === 'output_match') {
    const om = link.outputMatch;
    return om && om.path.trim() && om.expected.trim() ? null : 'output_match';
  }
  return null;
}
