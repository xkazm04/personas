/**
 * triageJournal — what a reviewer actually did, recorded.
 *
 * Nothing in this app records the SHAPE of a triage session. SQLite knows the
 * outcome of every row (`dev_memories` gets a decision/constraint memory,
 * `policy_proposals` keeps its status and decline reason, the reviews table
 * keeps its notes) but nothing anywhere knows that the reviewer cleared 38 cards
 * in nine minutes, accepted 11% of them, rejected every `pitfall` practice from
 * one workspace, and lost two compare-and-swaps to Athena on the way.
 *
 * The backend has been ready for this question since the actor taxonomy landed:
 * `record_idea_decision_by` files every verdict under `"Human" · "TriageRule" ·
 * "Strategist" · "Autonomy"` precisely so the loops can be told apart later. The
 * deck has been feeding it nothing but the default.
 *
 * This module records enough for a FUTURE round to answer "you reject 80% of
 * pitfall practices from workspace X — want a triage rule?". It deliberately
 * does not answer it: no suggestion, no rule, no prompt. Just the data, plus the
 * one readout a reviewer wants at the end of a session.
 *
 * ## Why localStorage, and where the seam is
 *
 * Same store as {@link ./triageSession}, and the same argument: this is the
 * reviewer's own record of their own working session, on their own machine, and
 * the authoritative decision is already durable elsewhere. What makes it
 * defensible rather than lazy is the shape — a bounded ring of flat entries with
 * no derived aggregates. The day this needs to be queryable across devices, or
 * to feed an actual triage-rule suggester, the entries move to a
 * `triage_decisions` table and `readJournal()`/`recordDecision()` are the only
 * two functions that change.
 *
 * ## What each field is FOR
 *
 * `tags` is the load-bearing one. A future "you always reject X" needs an axis
 * to group on, and the axes differ per kind — a practice groups by its
 * `pitfall`/`pattern` chip, an idea by its category, a review by severity. The
 * card already carries exactly those as {@link TriageItem.tags}, pre-resolved,
 * so the journal stores the chips rather than teaching itself six domain models.
 *
 * `dwellMs` is time-per-decision, which is the only number that tells a slow
 * queue (cards that need reading) apart from a slow reviewer.
 *
 * `conflicted` marks a verdict that LOST — it is throughput a reviewer spent and
 * did not get, and a session full of them means something else is deciding the
 * same queue.
 *
 * React-free and store-free on purpose.
 */
import { silentCatch } from '@/lib/silentCatch';

import type { TriageItem, TriageKind, TriageVerdict } from './triageTypes';

const STORAGE_KEY = 'personas.triage.journal.v1';

/**
 * Ring size. Large enough that a heavy day is fully recorded, small enough that
 * the record stays a few hundred KB and can never crowd out the session state
 * it shares an origin with.
 */
export const MAX_JOURNAL_ENTRIES = 500;

/** Reasons are the reviewer's own words; there is no case for storing an essay. */
const MAX_REASON_CHARS = 200;
const MAX_TAGS = 4;

/** One recorded act. Flat on purpose — see the module note on the seam. */
export interface TriageJournalEntry {
  /** Epoch ms the act was recorded. */
  at: number;
  kind: TriageKind;
  /** Queue key, `${kind}:${sourceId}`. */
  itemId: string;
  /** The id the backend knows. */
  sourceId: string;
  verdict: TriageVerdict;
  /** Set when a branch was fired rather than a plain verdict. */
  branchId?: string;
  /** Canonical preset value or free text, truncated. */
  reason?: string;
  /** Who raised it — workspace, project, persona. */
  source: string;
  /** The card's own chips: the grouping axis, see the module note. */
  tags: string[];
  /** ms the card sat at the top of the deck before this act. */
  dwellMs?: number;
  /** Matches `record_idea_decision_by`'s taxonomy. The deck is only ever one of
   *  them; the field exists so a merged view never has to guess. */
  actor: 'Human';
  /** The write lost a compare-and-swap — spent effort that recorded nothing. */
  conflicted?: boolean;
  /** The reviewer took it back inside the undo window. */
  undone?: boolean;
}

/** What a card contributes to an entry. Derived once, at record time. */
export interface JournalInput {
  item: TriageItem;
  verdict: TriageVerdict;
  branchId?: string;
  reason?: string;
  dwellMs?: number;
  conflicted?: boolean;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let cached: TriageJournalEntry[] | null = null;

/** Every entry, oldest first. Never throws — an unreadable journal is an empty one. */
export function readJournal(): TriageJournalEntry[] {
  if (cached) return cached;
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    cached = parsed as TriageJournalEntry[];
    return cached;
  } catch {
    return [];
  }
}

function write(entries: TriageJournalEntry[]): void {
  const bounded =
    entries.length > MAX_JOURNAL_ENTRIES
      ? entries.slice(entries.length - MAX_JOURNAL_ENTRIES)
      : entries;
  cached = bounded;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch (error) {
    // Quota or a hardened origin. Never fail a decision because its diary
    // could not be written — but leave a breadcrumb, or a summary that has
    // quietly stopped counting looks like a session that did nothing.
    silentCatch('triageJournal:write')(error);
  }
}

/** Record one act. Returns the entry so a caller can correlate an undo. */
export function recordDecision(input: JournalInput): TriageJournalEntry {
  const { item, verdict, branchId, reason, dwellMs, conflicted } = input;
  const entry: TriageJournalEntry = {
    at: Date.now(),
    kind: item.kind,
    itemId: item.id,
    sourceId: item.sourceId,
    verdict,
    ...(branchId ? { branchId } : {}),
    ...(reason ? { reason: reason.slice(0, MAX_REASON_CHARS) } : {}),
    source: item.source.label,
    tags: item.tags.slice(0, MAX_TAGS).map((t) => t.label),
    ...(dwellMs != null && dwellMs >= 0 ? { dwellMs } : {}),
    actor: 'Human',
    ...(conflicted ? { conflicted: true } : {}),
  };
  write([...readJournal(), entry]);
  return entry;
}

/**
 * Mark the most recent entry for `itemId` as taken back.
 *
 * The entry is amended rather than deleted: "decided then undone" and "never
 * decided" are different things, and a throughput readout that quietly erases
 * the first one flatters the reviewer.
 */
export function markUndone(itemId: string): void {
  const entries = readJournal();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry && entry.itemId === itemId && !entry.undone) {
      const next = [...entries];
      next[i] = { ...entry, undone: true };
      write(next);
      return;
    }
  }
}

export function clearJournal(): void {
  cached = null;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch (error) {
    // Same posture as the write.
    silentCatch('triageJournal:clear')(error);
  }
}

/** Test seam. Drops the parse cache so a test can write storage directly. */
export function resetJournalCache(): void {
  cached = null;
}

/** Per-kind slice of a session. */
export interface TriageKindTally {
  kind: TriageKind;
  decided: number;
  accepted: number;
}

export interface TriageSessionSummary {
  /** Acts that WROTE something and stuck — the honest throughput number. */
  decided: number;
  accepted: number;
  rejected: number;
  /** Deferrals. Never a write; counted separately so it cannot inflate throughput. */
  skipped: number;
  undone: number;
  /** Verdicts that lost a compare-and-swap. */
  conflicts: number;
  /**
   * MEDIAN, not mean. One card that the reviewer left open while they read the
   * run behind it would drag a mean into uselessness; the median says what a
   * typical card costs.
   */
  medianDwellMs: number | null;
  /** Kinds actually touched, heaviest first. */
  byKind: TriageKindTally[];
}

const EMPTY_SUMMARY: TriageSessionSummary = {
  decided: 0,
  accepted: 0,
  rejected: 0,
  skipped: 0,
  undone: 0,
  conflicts: 0,
  medianDwellMs: null,
  byKind: [],
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo != null && hi != null ? (lo + hi) / 2 : null;
}

/**
 * Reduce the journal to what a reviewer wants to see at the end of a run.
 *
 * `since` scopes it to the CURRENT session (see `triageSession.startedAt`), so
 * the readout says what this sitting achieved rather than what the ring happens
 * to still hold.
 */
export function summariseJournal(
  entries: readonly TriageJournalEntry[],
  since: number,
): TriageSessionSummary {
  const scoped = entries.filter((e) => e.at >= since);
  if (scoped.length === 0) return EMPTY_SUMMARY;

  const byKind = new Map<TriageKind, TriageKindTally>();
  const dwells: number[] = [];
  let decided = 0;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  let undone = 0;
  let conflicts = 0;

  for (const entry of scoped) {
    if (entry.dwellMs != null) dwells.push(entry.dwellMs);
    if (entry.undone) undone += 1;
    if (entry.conflicted) conflicts += 1;

    if (entry.verdict === 'skip') {
      skipped += 1;
      continue;
    }
    // An undone verdict is not throughput, and a lost swap is not the
    // reviewer's decision. Both stay visible above as their own counts.
    if (entry.undone || entry.conflicted) continue;

    decided += 1;
    if (entry.verdict === 'accept') accepted += 1;
    else rejected += 1;

    const tally = byKind.get(entry.kind) ?? { kind: entry.kind, decided: 0, accepted: 0 };
    tally.decided += 1;
    if (entry.verdict === 'accept') tally.accepted += 1;
    byKind.set(entry.kind, tally);
  }

  return {
    decided,
    accepted,
    rejected,
    skipped,
    undone,
    conflicts,
    medianDwellMs: median(dwells),
    byKind: [...byKind.values()].sort((a, b) => b.decided - a.decided),
  };
}
