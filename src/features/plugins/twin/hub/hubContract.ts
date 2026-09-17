/**
 * The Hub's wire contract — one feed of everything the twin has learned or
 * said, and the reactions available on each kind. Hand-written so the desk and
 * the feed implementation could be built in parallel.
 *
 * Governing rules: a rejection SUPERSEDES rather than deletes (agent-memory /
 * consolidation), claims about the human are propose-and-review
 * (memory-governance), and each entry's kind is a token that drives colour
 * and glyph — never a user-typed string.
 */

import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';
import type { TwinDistilledFact } from '@/lib/bindings/TwinDistilledFact';
import type { TwinReflection } from '@/lib/bindings/TwinReflection';
import type { TwinContact } from '@/lib/bindings/TwinContact';

/** Every row kind the Hub can show. Drives glyph + colour role, never text. */
export type HubEntryKind = 'memory' | 'message' | 'fact' | 'reflection' | 'audit';

export type HubReviewStatus = 'pending' | 'approved' | 'rejected';

export interface HubEntry {
  id: string;
  kind: HubEntryKind;
  /** ISO timestamp of the row's own event time. */
  at: string;
  /** Channel token ('training', 'slack', 'audit', …). Never a display name. */
  channel: string | null;
  title: string | null;
  body: string;
  /** Review status for `kind: 'memory'`; null for kinds that aren't reviewed. */
  status: HubReviewStatus | null;
  /** Reviewer note carried by a superseded (rejected) memory. */
  reviewerNotes: string | null;
  contactHandle: string | null;
  /** Importance 1–5 where the source row carries one. */
  importance: number | null;
  /** The untouched source row, for a lane that needs a field the feed drops. */
  source:
    | { kind: 'memory'; row: TwinPendingMemory }
    | { kind: 'message'; row: TwinCommunication }
    | { kind: 'fact'; row: TwinDistilledFact }
    | { kind: 'reflection'; row: TwinReflection };
}

/** The six reject presets, ONE table (the duplicate parsers are deleted). */
export type HubRejectReason =
  | 'off_brand'
  | 'inaccurate'
  | 'too_long'
  | 'wrong_tone'
  | 'risky_claim'
  | 'too_private';

export const HUB_REJECT_REASONS: readonly HubRejectReason[] = [
  'off_brand',
  'inaccurate',
  'too_long',
  'wrong_tone',
  'risky_claim',
  'too_private',
] as const;

export interface HubCounts {
  pending: number;
  approved: number;
  rejected: number;
  messages: number;
  facts: number;
  reflections: number;
}

/** The knowledge sources strip that sits above every Hub lane. */
export interface HubSources {
  knowledgeBaseId: string | null;
  knowledgeBaseName: string | null;
  documents: number | null;
  chunks: number | null;
  obsidianSubpath: string | null;
  /** Newest wiki file mtime, or null when never compiled. */
  wikiCompiledAt: string | null;
  wikiFiles: number | null;
}

export interface HubFeedApi {
  entries: HubEntry[];
  counts: HubCounts;
  sources: HubSources;
  contacts: TwinContact[];
  /** True until the first settle. Chrome renders regardless. */
  loading: boolean;
  /** Failure is distinct from empty; never dressed as "no data". */
  error: string | null;
  refresh: () => Promise<void>;
  approve: (entry: HubEntry) => Promise<void>;
  /** Supersedes with a reason; the row stays as a record. */
  reject: (entry: HubEntry, reason: HubRejectReason) => Promise<void>;
  /** Approves AND queues follow-up questions for the Setup training stage. */
  digDeeper: (entry: HubEntry) => Promise<void>;
  saveAsFact: (entry: HubEntry, importance: number) => Promise<void>;
  deleteFact: (entry: HubEntry) => Promise<void>;
  deleteReflection: (entry: HubEntry) => Promise<void>;
  reflect: (seed: string) => Promise<void>;
  compileWiki: () => Promise<void>;
  auditWiki: () => Promise<void>;
  ingestDoctrine: () => Promise<void>;
  bindKnowledgeBase: (kbId: string) => Promise<void>;
  unbindKnowledgeBase: () => Promise<void>;
  /** Per-entry busy key, so one press never lights a sibling's spinner. */
  busyId: string | null;
}

/** What the desk and every lane under it render against. */
export interface HubDeskProps {
  feed: HubFeedApi;
}

/**
 * A memory or an audit report is reviewable; nothing else carries a verdict.
 * It lives in the contract rather than beside the buttons because the Queue
 * lane and the lane derivations both key on it and neither owns it.
 */
export function isReviewable(entry: HubEntry): boolean {
  return entry.status === 'pending' && (entry.kind === 'memory' || entry.kind === 'audit');
}
