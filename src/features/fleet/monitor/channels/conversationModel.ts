import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { QueuedPrompt } from './conversationOutbox';

/* ----------------------------------------------------------------------------
 * CONVERSATION MODEL — the clustering rule (plan D7).
 *
 * The channel is a flat list of items. A conversation is not: a run of twelve
 * `step` rows from one assignment is ONE thing that happened, not twelve things
 * to read. So the steps of one assignment collapse into a single live
 * ASSIGNMENT row, and the messages of one deliberation into a single
 * DELIBERATION row (per day, see `buildConversation`).
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

/**
 * Which row holds a given channel item — the address a deep link needs.
 *
 * A live pop-up knows the ITEM it is showing; the conversation is addressed by
 * ROW, and a row is not an item: clustering folds a whole assignment or
 * deliberation into one card, so the item's own id appears nowhere in the key.
 * The two vocabularies have to be joined somewhere, and joining them here (in
 * the module that built the rows) keeps the key format in one file.
 *
 * Returns `null` when the item is not in the loaded window — which is the
 * ordinary case for a link into history that has not been paged in yet, and is
 * a reason to pin nothing rather than to pin the wrong row.
 */
export function rowKeyForItem(rows: ConversationRow[], itemId: string): string | null {
  for (const row of rows) {
    if (row.kind === 'talk' && row.item.id === itemId) return row.key;
    if ((row.kind === 'assignment' || row.kind === 'deliberation')
      && row.items.some((i) => i.id === itemId)) return row.key;
  }
  return null;
}

/** A decomposed goal awaiting the user's Confirm — the composer's output. */
export interface AssignProposal {
  goal: string;
  steps: Array<{ title: string; description: string; suggestedPersonaId: string | null }>;
  status: 'pending' | 'launching' | 'launched' | 'dismissed';
  assignmentId?: string;
}

// The composer outbox and the row-identity pass live in their own modules;
// re-exported so every import of this model keeps working.
export { nextPromptBatch, type PromptBatch, type QueuedPrompt } from './conversationOutbox';
export { reconcileRows } from './conversationRowIdentity';


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
 * Clustering is by RUN within a day (WP12): every step of one assignment, and
 * every turn of one deliberation, that lands on the same day is ONE row,
 * placed at the cluster's newest event, even when a message lands between two
 * of its steps. Folding only neighbours split a run in two the moment a
 * persona spoke between its steps. A day boundary still breaks a cluster, so a
 * day separator can never sit inside one.
 */
export function buildConversation(items: TeamChannelItem[], now = Date.now()): ConversationRow[] {
  // The channel arrives newest-first; a conversation reads oldest-first.
  const chron = [...items].reverse();
  // Where each (day, cluster) ends: the row is emitted at its newest item.
  const last = new Map<string, number>();
  chron.forEach((item, i) => {
    const id = clusterId(item);
    if (id) last.set(`${dayKeyOf(item.at)}|${id}`, i);
  });
  const open = new Map<string, TeamChannelItem[]>();
  const rows: ConversationRow[] = [];
  let lastDay = '';

  chron.forEach((item, i) => {
    const day = dayKeyOf(item.at);
    const id = clusterId(item);
    if (id) {
      const slot = `${day}|${id}`;
      const held = open.get(slot) ?? [];
      held.push(item);
      if (last.get(slot) !== i) { open.set(slot, held); return; }
      open.delete(slot);
      pushDay(rows, day, item.at, lastDay);
      lastDay = day || lastDay;
      const first = held[0]!;
      rows.push(item.deliberationId
        ? { kind: 'deliberation', key: `delib:${item.deliberationId}:${first.id}`, at: item.at, deliberationId: item.deliberationId, items: held }
        : { kind: 'assignment', key: `asg:${item.assignmentId}:${first.id}`, at: item.at, assignmentId: item.assignmentId!, items: held });
      return;
    }
    pushDay(rows, day, item.at, lastDay);
    lastDay = day || lastDay;
    // Everything else is TALK, including bridged `slack` messages: an inbound
    // Slack message is a person saying something in the channel, so it reads as
    // conversation. The difference is in the line's authorship (TalkLine).
    rows.push({ kind: 'talk', key: `talk:${item.id}`, at: item.at, item });
  });

  // Day labels are computed against `now` at render; the row only carries `at`.
  void now;
  return rows;
}

/** A deliberation turn clusters by its deliberation (it wins over the step rule); a step by its assignment. */
function clusterId(item: TeamChannelItem): string | null {
  if (item.deliberationId) return `d:${item.deliberationId}`;
  if (item.kind === 'step' && item.assignmentId) return `a:${item.assignmentId}`;
  return null;
}

function pushDay(rows: ConversationRow[], day: string, at: string, lastDay: string): void {
  if (day && day !== lastDay) rows.push({ kind: 'day', key: `day:${day}`, at });
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
