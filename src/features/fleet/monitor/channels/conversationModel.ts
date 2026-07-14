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
  | { kind: 'proposal'; key: string; at: string; proposal: AssignProposal };

/** A decomposed goal awaiting the user's Confirm — the composer's output. */
export interface AssignProposal {
  goal: string;
  steps: Array<{ title: string; description: string; suggestedPersonaId: string | null }>;
  status: 'pending' | 'launching' | 'launched' | 'dismissed';
  assignmentId?: string;
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
