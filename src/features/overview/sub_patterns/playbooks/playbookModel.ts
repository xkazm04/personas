// Playbook integrity model — the pure helpers behind the playbooks rail
// (pattern-fabric S3/F4), extracted from the retired topic-graph model when
// the old Nexus was deleted. A playbook is a promise that following it applies
// current doctrine, so staleness detection and replacement/addition
// suggestions live here as pure functions over the library's item views and
// the pattern-edge list.
import type { KnowledgeItemView } from '../libraryModel';

export interface PatternEdgeLike {
  fromId: string;
  toId: string;
  rel: string;
  note: string | null;
}

/** A candidate ADDITION to a playbook (fabric F4): an adopted pattern that
 *  EXTENDS one of the playbook's members and is not itself a member yet. The
 *  suggestion inherits the parent's phase and slots directly after it —
 *  adding stays a curator click, never automatic. */
export interface SuggestedAddition {
  item: KnowledgeItemView;
  /** The member it extends — the reason the suggestion exists. */
  extendsTitle: string;
  phase: string;
  ordinal: number;
}

export function playbookSuggestedAdditions(
  members: readonly { practiceId: string; phase: string; ordinal: number }[],
  itemById: ReadonlyMap<string, KnowledgeItemView>,
  edges: readonly PatternEdgeLike[],
): SuggestedAddition[] {
  const memberIds = new Set(members.map((m) => m.practiceId));
  const out: SuggestedAddition[] = [];
  const suggested = new Set<string>();
  for (const m of members) {
    const parent = itemById.get(m.practiceId);
    if (!parent || parent.status !== 'adopted') continue;
    for (const e of edges) {
      if (e.rel !== 'extends' || e.toId !== m.practiceId) continue;
      if (memberIds.has(e.fromId) || suggested.has(e.fromId)) continue;
      const child = itemById.get(e.fromId);
      if (!child || child.status !== 'adopted') continue;
      suggested.add(child.id);
      out.push({
        item: child,
        extendsTitle: parent.title,
        phase: m.phase,
        ordinal: m.ordinal + 1,
      });
    }
  }
  return out;
}

/** A membership pointing at a pattern that is no longer canon. */
export interface StaleMember {
  practiceId: string;
  /** The pattern's title if the row still exists at all (deprecated/rejected),
   *  `null` when the row is gone entirely. */
  title: string | null;
  /** A pattern that SUPERSEDES the stale one, or its `governs` parent — the
   *  curator's most likely replacement. Suggested, never auto-applied: which
   *  phase a replacement belongs in is a judgement the fabric cannot make. */
  replacementTitle: string | null;
}

/**
 * Which of a playbook's memberships have gone stale.
 *
 * A playbook is a promise that following it applies current doctrine, so a
 * member whose pattern was deprecated, rejected or deleted is worse than a
 * missing one — it teaches something the workspace has since abandoned. Only
 * `adopted` patterns count as live.
 */
export function playbookStaleMembers(
  members: readonly { practiceId: string }[],
  itemById: ReadonlyMap<string, KnowledgeItemView>,
  edges: readonly PatternEdgeLike[],
): StaleMember[] {
  const out: StaleMember[] = [];
  for (const m of members) {
    const item = itemById.get(m.practiceId);
    if (item && item.status === 'adopted') continue;
    // `supersedes` is the explicit replacement; `governs` is the fallback
    // ("the parent doctrine still stands").
    let replacement: KnowledgeItemView | null = null;
    for (const e of edges) {
      if (e.toId !== m.practiceId) continue;
      if (e.rel !== 'supersedes' && e.rel !== 'governs') continue;
      const candidate = itemById.get(e.fromId);
      if (!candidate || candidate.status !== 'adopted') continue;
      if (e.rel === 'supersedes') {
        replacement = candidate;
        break;
      }
      replacement = replacement ?? candidate;
    }
    out.push({
      practiceId: m.practiceId,
      title: item?.title ?? null,
      replacementTitle: replacement?.title ?? null,
    });
  }
  return out;
}
