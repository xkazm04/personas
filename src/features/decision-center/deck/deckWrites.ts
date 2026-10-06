/**
 * deckWrites — one deck verdict in, the real writes out.
 *
 * The deck speaks `DeckVerdict` (which adds `done` and `reply` to the spine);
 * the roster speaks `RosterDecision`. This is the one mapping between them, and
 * the one place a chat reply is SENT before its thread is marked seen:
 *
 *   skip (no branch)    nothing — the card stays pending
 *   done                accept (report: mark read; chat: advance the watermark)
 *   reply               send through the channel's own door, then accept
 *   accept / reject     pass through, with branch, reason and question answers
 *
 * Every write that reaches the roster goes through `roster.decide`, which
 * routes it to `lib/decisions/rowWrites` and REJECTS when it did not land.
 * React-free: the doors arrive in `DeckWriteDoors`.
 */
import type { RosterDecision } from '../roster/decisionDispatch';
import type { DeckVerdict } from './deckTypes';

export interface DeckWriteDoors {
  decide: (decision: RosterDecision) => Promise<void>;
  /** `channelSlice.sendChannelDirective` — a team reply, threaded under `replyTo`. */
  sendTeamReply: (teamId: string, text: string, replyTo?: string) => Promise<void>;
  /** `personaChannelSlice.sendPersonaChannelMessage`. */
  sendPersonaReply: (personaId: string, text: string) => Promise<void>;
}

/** Thrown when a reply has nowhere to go from the deck. */
export class ReplyRouteError extends Error {}

async function sendReply(v: DeckVerdict, doors: DeckWriteDoors, text: string): Promise<void> {
  const key = v.item.thread?.channelKey ?? v.item.payload?.channelKey ?? '';
  const [kind, id] = key.split(':', 2);
  if (!id || v.item.thread?.canReply === false) throw new ReplyRouteError(`No reply route for ${key || v.item.id}`);
  if (kind === 'team') {
    const messages = v.item.thread?.messages ?? [];
    await doors.sendTeamReply(id, text, messages[messages.length - 1]?.id);
    return;
  }
  if (kind === 'persona') {
    await doors.sendPersonaReply(id, text);
    return;
  }
  throw new ReplyRouteError(`No reply route for ${key}`);
}

export async function writeDeckVerdict(v: DeckVerdict, doors: DeckWriteDoors): Promise<void> {
  const { item, branchId, reason, answers } = v;
  if (v.verdict === 'skip' && !branchId) return;
  if (v.verdict === 'reply') {
    const text = (v.text ?? '').trim();
    if (!text) return;
    await sendReply(v, doors, text);
    await doors.decide({ item, verdict: 'accept' });
    return;
  }
  const verdict = v.verdict === 'done' ? 'accept' : v.verdict;
  await doors.decide({ item, verdict, branchId, reason, answers });
}
