// How a thread entry is NAMED on screen — author, kind, verdict, clipped body.
//
// One table for the three surfaces that render an entry (the popover, the card
// bubble, the LiveCommsStack projection), so an entry can never read as two
// different things in two places. Every label resolves against the live
// translations; nothing here stores English.
import type { Translations } from '@/i18n/generated/types';
import type { NoteComment } from '@/lib/bindings/NoteComment';

import { markdownToPlainText } from '../cardMarkdown';

type NotepadStrings = Translations['notepad'];
type Tx = (template: string, vars: Record<string, string | number>) => string;

/** Who wrote the entry. An agent with a recorded name says which one. */
export function threadAuthorLabel(c: Pick<NoteComment, 'authorKind' | 'authorName'>, n: NotepadStrings, tx: Tx): string {
  switch (c.authorKind) {
    case 'operator':
      return n.thread_author_you;
    case 'athena':
      return n.thread_author_athena;
    case 'agent':
      return c.authorName ? tx(n.thread_author_agent_named, { name: c.authorName }) : n.thread_author_agent;
    default:
      return n.thread_author_system;
  }
}

/**
 * What KIND of entry it is.
 *
 * A `run` review does not say in its row whether the run failed — the ingest
 * writes the summary, or the bare outcome token when there is none. A body that
 * IS the token `failed` is therefore the one failure signal the row carries;
 * everything else reads as a completed run.
 */
export function threadEntryLabel(
  c: Pick<NoteComment, 'kind' | 'refKind' | 'refId' | 'bodyMd'>,
  n: NotepadStrings,
): string {
  if (c.kind === 'comment') return n.thread_entry_comment;
  if (c.kind === 'review') {
    if (c.refKind === 'suggestion_card') return n.thread_entry_suggestions_ready;
    if (c.refKind === 'run') {
      return c.bodyMd.trim() === 'failed' ? n.thread_entry_run_failed : n.thread_entry_run_completed;
    }
    return n.thread_entry_review_requested;
  }
  // system / status milestone — the token rides in `ref_id` (WP1 stores no English).
  if (c.refId === 'cut') return n.thread_entry_status_cut;
  if (c.refId === 'shipped') return n.thread_entry_status_shipped;
  return n.thread_entry_status_completed;
}

/** The verdict chip, or `null` for an entry that carries none. */
export function threadVerdictLabel(c: Pick<NoteComment, 'verdict'>, n: NotepadStrings): string | null {
  switch (c.verdict) {
    case 'pending':
      return n.thread_verdict_pending;
    case 'approved':
      return n.thread_verdict_approved;
    case 'rejected':
      return n.thread_verdict_rejected;
    default:
      return null;
  }
}

/** A review still waiting on the operator — the one entry with verdict buttons. */
export function isPendingReview(c: Pick<NoteComment, 'kind' | 'verdict'>): boolean {
  return c.kind === 'review' && c.verdict === 'pending';
}

/** Tone class for an author (Athena violet, the agent info-blue, the rest neutral). */
export function threadAuthorTone(c: Pick<NoteComment, 'authorKind'>): string {
  if (c.authorKind === 'athena') return 'text-brand-purple';
  if (c.authorKind === 'agent') return 'text-status-info';
  if (c.authorKind === 'operator') return 'text-primary';
  return 'text-foreground/85';
}

/**
 * The body as a reader sees it (markers stripped), one paragraph, clipped.
 * `max` counts characters of the PLAIN text.
 */
export function clipThreadBody(bodyMd: string, max = 160): string {
  const plain = markdownToPlainText(bodyMd).replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * Split a `…{elapsed}…` template around its placeholder, so a caller can put a
 * live node (a ticking `RelativeTime`) where the placeholder sits while keeping
 * the translation's own word order. A template without the placeholder renders
 * as `[template, '']`.
 */
export function splitElapsedTemplate(template: string): [string, string] {
  const at = template.indexOf('{elapsed}');
  if (at < 0) return [template, ''];
  return [template.slice(0, at), template.slice(at + '{elapsed}'.length)];
}
