/**
 * WHY A STEP WAS MISSED: the notes on the changes that skipped or failed it,
 * grouped by what they say. The ONE implementation of reason grouping: the
 * step screen's "Why it was skipped" section ranks these clusters and the Next
 * panel's "most common reason" (`layer2/next/nextEvidence`) is the top one.
 * Pure: no React, no i18n, no IO.
 *
 * Two notes say the same thing when, after `normaliseReason`, they are equal,
 * or (both at least three content words long) share {@link NEAR_SAME} of their
 * content words (fillers like "at", "to", "the" left out).
 * Normalising drops what differs between two instances of one reason: case,
 * commit shas, uuids, ids (`task-42`, `#118`), paths and file names, numbers
 * and punctuation, and a plural `s`. So "Pushed 3 commits straight to main at
 * 9f8e7d6" and "pushed 1 commit straight to main" are one reason.
 */
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

/** Token overlap (Jaccard) at or above which two normalised notes are one reason. */
export const NEAR_SAME = 0.75;

/** Fewest words a normalised note needs before near-matching applies; shorter notes match exactly. */
const NEAR_MIN_WORDS = 3;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PATH = /(?:[a-z]:)?[\w.@-]*[\\/][\w.@\\/-]*/gi;
const FILE = /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|mdx|json|toml|ya?ml|css|scss|html|py|go|java|kt|sql|lock|txt)\b/gi;
const SHA = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi;
const ID = /\b[a-z]+[-_#]\d+\b|#\d+/gi;
const NUMBER = /\d+(?:[.,]\d+)*/g;

/** The words of a note, without what differs between two instances of one reason. */
export function normaliseReason(note: string): string {
  return note
    .toLowerCase()
    .replace(UUID, ' ')
    .replace(PATH, ' ')
    .replace(FILE, ' ')
    .replace(SHA, ' ')
    .replace(ID, ' ')
    .replace(NUMBER, ' ')
    .replace(/[^\p{L}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * A note with its identifiers (uuids, shas, ids) shown as an ellipsis: the
 * reason a cluster reads as when every change wrote it with its own sha
 * ("Pushed straight to main at …"). Paths and numbers stay: they read as words.
 */
export function maskIdentifiers(note: string): string {
  return note.replace(UUID, '…').replace(SHA, '…').replace(ID, '…').replace(/…(?:\s*…)+/g, '…');
}

/** What one change of the step contributes: its outcome and its note, newest change first. */
export interface ReasonInput {
  outcome: LifecycleOutcome;
  detail: string | null;
}

export interface ReasonCluster {
  /** The normalised words the cluster was founded on (stable within one input). */
  key: string;
  /**
   * The note as written that the cluster's changes used most (a tie: the
   * newest); when every change wrote it differently, the newest with its
   * identifiers masked (`maskIdentifiers`).
   */
  label: string;
  count: number;
  skipped: number;
  failed: number;
  /** The distinct notes as written, newest first, at most {@link EXAMPLE_CAP}. */
  examples: string[];
  /** Position of its newest change in the input (0 = the newest change of all). */
  newest: number;
}

export interface ReasonSummary {
  /** Biggest first; a tie goes to the cluster with the newer change. */
  clusters: ReasonCluster[];
  /** Changes that skipped or failed the step. */
  missed: number;
  /** Of those, the ones that left no note. */
  unexplained: number;
}

export const EXAMPLE_CAP = 3;

interface Draft {
  key: string;
  words: Set<string>;
  members: { text: string; at: number; outcome: LifecycleOutcome }[];
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Words that carry no reason of their own, left out of the overlap (never out
 * of the key). Negations are NOT here: "no PR" and "PR" are different reasons.
 */
const FILLER = new Set(['a', 'an', 'the', 'at', 'to', 'in', 'on', 'of', 'for', 'by', 'with', 'and', 'or', 'is', 'was', 'were', 'be', 'it']);

function contentWords(key: string): Set<string> {
  return new Set(key.split(' ').filter((w) => w && !FILLER.has(w)));
}

function similar(a: Draft, b: Draft): boolean {
  if (a.key === b.key) return true;
  if (a.words.size < NEAR_MIN_WORDS || b.words.size < NEAR_MIN_WORDS) return false;
  return overlap(a.words, b.words) >= NEAR_SAME;
}

const byWeight = (a: Draft, b: Draft) => b.members.length - a.members.length || a.members[0]!.at - b.members[0]!.at;

function finish(d: Draft): ReasonCluster {
  const uses = new Map<string, number>();
  for (const m of d.members) uses.set(m.text, (uses.get(m.text) ?? 0) + 1);
  // Members are newest first, so the first text to reach the top count is the newest of the tied.
  let label = d.members[0]!.text;
  for (const m of d.members) if (uses.get(m.text)! > uses.get(label)!) label = m.text;
  // Written once each (every change with its own sha): the reason reads without the identifier.
  if (uses.get(label) === 1 && d.members.length > 1) label = maskIdentifiers(label);
  return {
    key: d.key,
    label,
    count: d.members.length,
    skipped: d.members.filter((m) => m.outcome === 'skipped').length,
    failed: d.members.filter((m) => m.outcome === 'failed').length,
    examples: [...new Set(d.members.map((m) => m.text))].slice(0, EXAMPLE_CAP),
    newest: d.members[0]!.at,
  };
}

/** Group the notes of the changes that skipped or failed the step; `inputs` newest first. */
export function clusterReasons(inputs: readonly ReasonInput[]): ReasonSummary {
  const exact = new Map<string, Draft>();
  let missed = 0;
  inputs.forEach((input, at) => {
    if (input.outcome !== 'skipped' && input.outcome !== 'failed') return;
    missed += 1;
    const text = input.detail?.trim();
    if (!text) return;
    const key = normaliseReason(text) || text.toLowerCase();
    const draft = exact.get(key) ?? { key, words: contentWords(key), members: [] };
    draft.members.push({ text, at, outcome: input.outcome });
    exact.set(key, draft);
  });
  // Greedy: the biggest cluster absorbs every near-identical smaller one.
  const drafts = [...exact.values()].sort(byWeight);
  const merged: Draft[] = [];
  for (const d of drafts) {
    const home = merged.find((m) => similar(m, d));
    if (home) home.members = [...home.members, ...d.members].sort((a, b) => a.at - b.at);
    else merged.push({ ...d, members: [...d.members] });
  }
  const clusters = merged.sort(byWeight).map(finish);
  const explained = clusters.reduce((n, c) => n + c.count, 0);
  return { clusters, missed, unexplained: missed - explained };
}
