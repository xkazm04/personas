/**
 * The one-line version of a reply — what the orb shows when the chat is closed.
 */

import type { CompanionMessage } from '@/api/companion';

/**
 * Newest assistant message in a transcript, or null.
 *
 * `PROGRESS:` asides are skipped: they are Athena thinking aloud mid-turn, and
 * surfacing "checking the fleet…" as THE unread message would tell the user the
 * least interesting thing she said.
 */
export function lastAssistantText(messages: CompanionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const body = m.content.trim();
    if (!body || body.startsWith('PROGRESS:')) continue;
    return body;
  }
  return null;
}
