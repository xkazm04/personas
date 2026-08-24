import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';

/* ----------------------------------------------------------------------------
 * PERSONA CONVERSATION MODEL — the fold for a persona's channel.
 *
 * Unlike the team conversation there is nothing to cluster: a persona channel
 * is chat bubbles punctuated by reports (attachments), reviews (decide cards)
 * and one-line system rows (events, memories). The fold is: overlay the
 * optimistic echoes, order chronologically, insert day separators, and derive
 * the "persona is working" row from the conversation's own tail.
 *
 * Pure: no React, no store, no IPC.
 * -------------------------------------------------------------------------- */

export type PersonaConversationRow =
  | { kind: 'day'; key: string; at: string }
  | { kind: 'item'; key: string; at: string; item: PersonaChannelItem }
  /** The persona owes a reply — rendered as a subtle indicator row. */
  | { kind: 'working'; key: string; at: string };

/** Parse an item's kind-specific `extra` JSON. Never throws. */
export function parseItemExtra(item: PersonaChannelItem): Record<string, unknown> {
  if (!item.extra) return {};
  try {
    const v: unknown = JSON.parse(item.extra);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Review rows: the resolution status riding `extra` ('pending' when open). */
export function reviewStatusOf(item: PersonaChannelItem): string {
  const status = parseItemExtra(item).status;
  return typeof status === 'string' && status ? status : 'pending';
}

function isUserChat(item: PersonaChannelItem): boolean {
  return item.kind === 'chat' && item.authorKind === 'user';
}

function isFailed(item: PersonaChannelItem): boolean {
  return parseItemExtra(item).failed === true;
}

/**
 * Fold a newest-first channel page (+ optimistic echoes) into oldest-first
 * conversation rows.
 *
 * The WORKING row needs no store state: after a user turn the persona's answer
 * has not arrived yet exactly when the newest chat row is user-authored (an
 * echo counts — it will become that row). A failed user row does not owe a
 * reply, so it does not hold the indicator up.
 */
export function buildPersonaConversation(
  items: PersonaChannelItem[],
  echoes: PersonaChannelItem[] = [],
): PersonaConversationRow[] {
  const known = new Set(items.map((i) => i.id));
  const merged = [...echoes.filter((e) => !known.has(e.id)), ...items].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );

  const rows: PersonaConversationRow[] = [];
  let lastDay = '';
  for (const item of merged) {
    const day = item.at.slice(0, 10);
    if (day && day !== lastDay) {
      rows.push({ kind: 'day', key: `day:${day}`, at: item.at });
      lastDay = day;
    }
    rows.push({ kind: 'item', key: `item:${item.id}`, at: item.at, item });
  }

  // Working indicator: walk back past system rows to the newest CHAT row.
  for (let i = merged.length - 1; i >= 0; i--) {
    const it = merged[i]!;
    if (it.kind !== 'chat') continue;
    if (isUserChat(it) && !isFailed(it)) {
      rows.push({ kind: 'working', key: 'working', at: it.at });
    }
    break;
  }
  return rows;
}
