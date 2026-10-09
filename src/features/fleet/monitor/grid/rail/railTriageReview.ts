// railTriageReview — the rail's items, said in Approvals' own words.
//
// Overview's `ReviewFocusFlow` is the BASELINE triage surface: the severity
// gradient/ring/shadow, the per-persona workspace tint, `stripPersonaPrefix`,
// item-level gallery media and `ContextDataPreview` all live there and nowhere
// else. The rail is a second CALLER of that surface, so the translation runs
// rail -> Approvals and never the other way: this module exists so the
// component does not learn a second item model.
//
// The rail speaks `TriageItem` (`triage/triageTypes.ts`), a UNIFIED model over
// six kinds — review, idea, question, policy, evolution, goal. `TriageReview`
// (`sub_manual-review/components/reviewFocusHelpers.tsx`) is the manual-review
// row shape. One direction of that map is lossy, and every lossy field is
// named below rather than filled with a plausible-looking default.
//
// WHAT THE RAIL CANNOT SUPPLY
//
//  • `severity` — only `kind: 'review'` items carry one (`reviewToTriage`
//    writes the `severity` tag/fact; no other adapter does). For the other
//    five kinds this returns `''`, and the component degrades exactly as it
//    already does for a malformed row: `getSevCfg('')` falls through to the
//    `info` config, so the card gets the info gradient/ring and the queue dot
//    `sevDot` falls through to `info` too. Nothing is invented and nothing
//    throws.
//  • `persona_color` / `persona_icon` — present only when a persona raised the
//    item (`source.color`, `personaIcon`). Otherwise null, and `PersonaIcon`
//    renders its own neutral frame.
//  • `persona_id` — the workspace tint's input. An item with no persona has no
//    workspace, `usePersonaWorkspaceSwatch` returns undefined for it and
//    `PersonaName` keeps `text-foreground`. That is the SAME fallback Approvals
//    takes for a persona that belongs to no workspace, and it is deliberate:
//    white is the absence of a workspace identity, never a ninth one.
//  • item-level gallery media — `TriageItem` has no slot for a review's
//    `gallery_image_ref` / `image_url` (the unified model carries media only on
//    a DECISION OPTION). A rail item therefore never shows the big single-image
//    gallery block; a review opened from Approvals still does. This is a real
//    hole in `TriageItem`, not in the component.
//  • `status` — the rail's queue is pending BY CONSTRUCTION (an item leaves it
//    when it is decided), so this is `'pending'`, which is also what
//    `ReviewFocusFlow` filters on.
//
// WHAT ROUND-TRIPS EXACTLY: id, title, body, reasoning (as `context_text`),
// decision options (as `decisions[]`, same snake_case wire names in both
// models), evidence, createdAt, and the branch LABELS.

import type {
  TriageItem,
} from '@/features/agents/quick-answer/triage/triageTypes';
import type { TriageReview } from '@/features/overview/sub_manual-review/components/reviewFocusHelpers';

/**
 * Severity as Approvals spells it, or `''` when the item has none.
 *
 * Read from the `severity` FACT rather than the tag: the fact's `value` is the
 * raw severity token the row carried, where the tag's `label` is the same token
 * only by coincidence of `reviewToTriage` and could become display copy.
 */
function severityOf(item: TriageItem): string {
  const fact = item.facts.find((f) => f.id === 'severity');
  return typeof fact?.value === 'string' ? fact.value : '';
}

/**
 * Rebuild the `context_data` blob `parseDecisions` reads back.
 *
 * `reviewToTriage` parsed it apart on the way in — decisions into
 * `item.decisions`, the framing prose into `item.reasoning`, and the
 * unparseable remainder into `item.evidence`. This puts those back into the one
 * JSON envelope the component expects, and only when there is something
 * structured to put there: with no decisions and no reasoning it hands the raw
 * `evidence` straight through, which is what `ContextDataPreview` is for.
 */
function contextDataOf(item: TriageItem): string | null {
  const decisions = item.decisions ?? [];
  if (decisions.length === 0 && !item.reasoning) return item.evidence ?? null;
  const envelope: Record<string, unknown> = {};
  if (decisions.length > 0) envelope.decisions = decisions;
  if (item.reasoning) envelope.context_text = item.reasoning;
  return JSON.stringify(envelope);
}

/**
 * Branch LABELS, not branch ids.
 *
 * `ReviewFocusFlow` renders each suggested action as its own button text AND
 * hands that same string back through `onDispatchAction`. For a review the two
 * are identical (`reviewToTriage` sets `id: action, label: action`), but for
 * every other kind the id is a machine token and the label is the prose. The
 * label is what belongs on screen, so {@link railBranchIdFor} maps the chosen
 * label back to its id at the callback.
 */
export function suggestedActionsOf(item: TriageItem): string | null {
  const labels = item.branches.map((b) => b.label).filter((l) => l.trim().length > 0);
  return labels.length > 0 ? JSON.stringify(labels) : null;
}

/**
 * The branch id behind a label the component handed back.
 *
 * First match wins. Two branches sharing one label are indistinguishable on
 * screen as well, so the ambiguity is the item's, not this lookup's.
 */
export function railBranchIdFor(item: TriageItem, label: string): string | undefined {
  return item.branches.find((b) => b.label === label)?.id;
}

/** One rail item in the shape Approvals' focus flow consumes. */
export function triageItemToReview(item: TriageItem): TriageReview {
  return {
    // `item.id` (`${kind}:${sourceId}`), NOT `sourceId`: it is unique across
    // the six kinds the one queue mixes, and the modal resolves the verdict's
    // id back to its item through `itemById`, which is keyed the same way.
    id: item.id,
    title: item.title,
    description: item.body,
    severity: severityOf(item),
    persona_id: item.personaId ?? undefined,
    persona_name: item.source.label,
    persona_icon: item.personaIcon ?? undefined,
    persona_color: item.source.color ?? undefined,
    context_data: contextDataOf(item),
    suggested_actions: suggestedActionsOf(item),
    created_at: item.createdAt,
    status: 'pending',
  };
}

/** The rail's visible queue, in the rail's own order. */
export function triageItemsToReviews(items: readonly TriageItem[]): TriageReview[] {
  return items.map(triageItemToReview);
}
