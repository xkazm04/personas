import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * CONVERSATION MODEL — the clustering rule (plan D7).
 *
 * The channel is a flat list of items. A conversation is not: a run of twelve
 * `step` rows from one assignment is ONE thing that happened, not twelve things
 * to read. So consecutive steps sharing an assignmentId collapse into a single
 * live ASSIGNMENT row, and messages sharing a deliberationId collapse into a
 * single DELIBERATION row.
 *
 * This is what keeps the timeline readable when capability-work (hard-wired
 * tasks) and improvement-dialog (the behaviour core) interleave in one stream:
 * each is one row, anchored at its newest event, not a spray of machine noise.
 *
 * The Stream deliberately does NOT cluster — it is the flat log, and that is
 * the point of having both surfaces.
 *
 * Pure: no React, no store, no IPC.
 * -------------------------------------------------------------------------- */

export type ConversationRow =
  | { kind: 'day'; key: string; at: string }
  | { kind: 'talk'; key: string; at: string; item: TeamChannelItem }
  | { kind: 'assignment'; key: string; at: string; assignmentId: string; items: TeamChannelItem[] }
  | { kind: 'deliberation'; key: string; at: string; deliberationId: string; items: TeamChannelItem[] }
  | { kind: 'proposal'; key: string; at: string; proposal: AssignProposal }
  // `at` is empty on purpose: a queued prompt has no timestamp anyone else
  // agrees with. Minting one from the renderer's clock would give it a position
  // in a stream ordered by the server's (census:
  // `feed-item-ordered-by-the-renderers-clock`), so it carries none and is
  // appended outside the fold instead.
  | { kind: 'queued'; key: string; at: ''; prompt: QueuedPrompt };

/** A decomposed goal awaiting the user's Confirm — the composer's output. */
export interface AssignProposal {
  goal: string;
  steps: Array<{ title: string; description: string; suggestedPersonaId: string | null }>;
  status: 'pending' | 'launching' | 'launched' | 'dismissed';
  assignmentId?: string;
}

/* ── THE COMPOSER QUEUE (plan Lane A, "submit-while-busy = enqueue") ───────── */

/**
 * One thing the operator typed and pressed Enter on, before the channel was
 * ready to take it.
 *
 * The composer never disables. A prompt typed while a directive or a route is
 * in flight becomes one of these — a VISIBLE row at the bottom of the
 * conversation, in its own phase — and drains in order. The alternative the
 * surface shipped with was a greyed-out button, which loses the thought and
 * tells the operator to wait on a machine.
 */
export interface QueuedPrompt {
  /** Client id. Never leaves the browser — the server row is matched by the
   *  refetch that follows a successful post, not by this. */
  id: string;
  text: string;
  /** A goal ROUTES (decompose → proposal card); a plain prompt POSTS. */
  goal: boolean;
  phase: 'queued' | 'sending' | 'failed';
}

/** What the drain should do next: one post, covering one or more prompts. */
export interface PromptBatch {
  ids: string[];
  body: string;
  goal: boolean;
}

/**
 * The fold rule.
 *
 * Two plain prompts typed back to back are one thought split across two
 * keystrokes' worth of patience — posting them as two directives makes the team
 * answer twice, so the BODY combines while the DISPLAY stays two rows. A goal
 * never folds: routing is a decomposition of one goal, and concatenating two
 * would produce a plan for neither.
 *
 * Returns `null` when there is nothing to do, which includes the case that
 * matters most: something is already in flight. A `failed` entry is skipped
 * rather than retried — it is a row the operator now owns — and it BREAKS a
 * run, because the two prompts either side of it were never one body.
 */
export function nextPromptBatch(queue: QueuedPrompt[]): PromptBatch | null {
  if (queue.some((p) => p.phase === 'sending')) return null;
  const head = queue.findIndex((p) => p.phase === 'queued');
  if (head < 0) return null;
  const first = queue[head]!;
  if (first.goal) return { ids: [first.id], body: first.text, goal: true };

  const run: QueuedPrompt[] = [];
  for (let i = head; i < queue.length; i++) {
    const p = queue[i]!;
    if (p.phase !== 'queued' || p.goal) break;
    run.push(p);
  }
  return { ids: run.map((p) => p.id), body: run.map((p) => p.text).join('\n\n'), goal: false };
}

const DAY_MS = 86_400_000;

function dayKeyOf(at: string): string {
  return at.slice(0, 10);
}

/** Human day label for a separator. Pure — the caller supplies the words, so
 *  this stays free of React and the i18n proxy. */
export function dayLabel(at: string, labels: { today: string; yesterday: string }, now = Date.now()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(now);
  const diff = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY_MS);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.yesterday;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Fold a newest-first channel page into oldest-first conversation rows.
 *
 * Clustering is by RUN, not by id globally: two separate bursts of the same
 * assignment, separated by a week of chat, stay two rows — because that's how a
 * conversation actually reads. Only consecutive same-key items merge.
 */
export function buildConversation(items: TeamChannelItem[], now = Date.now()): ConversationRow[] {
  // The channel arrives newest-first; a conversation reads oldest-first.
  const chron = [...items].reverse();
  const rows: ConversationRow[] = [];
  let lastDay = '';

  for (const item of chron) {
    const day = dayKeyOf(item.at);
    if (day && day !== lastDay) {
      rows.push({ kind: 'day', key: `day:${day}`, at: item.at });
      lastDay = day;
    }

    const prev = rows[rows.length - 1];

    if (item.deliberationId) {
      if (prev?.kind === 'deliberation' && prev.deliberationId === item.deliberationId) {
        prev.items.push(item);
        prev.at = item.at; // anchored at the cluster's NEWEST event
        continue;
      }
      rows.push({
        kind: 'deliberation',
        key: `delib:${item.deliberationId}:${item.id}`,
        at: item.at,
        deliberationId: item.deliberationId,
        items: [item],
      });
      continue;
    }

    if (item.kind === 'step' && item.assignmentId) {
      if (prev?.kind === 'assignment' && prev.assignmentId === item.assignmentId) {
        prev.items.push(item);
        prev.at = item.at;
        continue;
      }
      rows.push({
        kind: 'assignment',
        key: `asg:${item.assignmentId}:${item.id}`,
        at: item.at,
        assignmentId: item.assignmentId,
        items: [item],
      });
      continue;
    }

    // Everything else is TALK — including bridged `slack` messages. That is the
    // point: an inbound Slack message is a person saying something in the
    // channel, so it reads as conversation, not as a system event. It needs no
    // ConversationRow variant of its own; the differentiation is in the bubble's
    // authorship (see TalkBubble / AUTHOR_KIND_META.slack), not in the fold.
    rows.push({ kind: 'talk', key: `talk:${item.id}`, at: item.at, item });
  }

  // Day labels are computed against `now` at render; the row only carries `at`.
  void now;
  return rows;
}

/** Does this look like WORK rather than chat? Drives the composer's /assign
 *  affordance — a long imperative sentence is probably a goal, not a remark. */
export function looksLikeGoal(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('/assign')) return true;
  if (t.length < 24) return false;
  if (t.startsWith('@')) return false; // addressed to someone = talk
  return /^(add|build|implement|fix|ship|write|create|refactor|migrate|investigate|design|update|remove|audit)\b/i.test(t);
}

/** Strip the /assign prefix, if present. */
export function goalText(text: string): string {
  return text.trim().replace(/^\/assign\s*/i, '').trim();
}

/** The latest step status in an assignment cluster — drives the card's pill. */
export function clusterStatus(items: TeamChannelItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const l = items[i]!.label;
    if (l) return l;
  }
  return 'created';
}
