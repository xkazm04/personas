/**
 * chatThreads — "a conversation is waiting on you", derived from the two
 * channel slices.
 *
 * Chat is the one roster kind with no row to read: a thread awaits the user
 * because of an ORDER of messages, not a status column. So this module owns
 * the predicate and the projection, both pure, and the roster feeds it what
 * the team-channel and persona-channel slices already hold.
 *
 * ## The predicate
 *
 * A thread awaits you when its latest message authored by a persona or Athena
 * is newer than BOTH your own last message in that thread AND the thread's
 * seen watermark. The two halves catch different things: replying answers the
 * thread even if you never opened it, and opening it (the watermark the slices'
 * `markChannelSeen` / `markPersonaChannelSeen` advance — the same one
 * `countUnread` / `countPersonaUnread` read) answers it without a reply.
 *
 * Only MESSAGES count. Steps, events and memories are activity, not something
 * said to you, and a persona channel's reports and reviews already have chips
 * of their own — counting them here would deal the same report twice.
 *
 * React-free and store-free.
 */
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

import type { DecisionItem, DecisionThreadMessage } from '../model/decisionModel';
import type { DecisionCopy } from './decisionCopy';

/** Messages shown per thread: the tail, oldest first. */
export const THREAD_TAIL = 12;

/** Inside tier 3, a conversation waiting on you sits between a normal and a high report. */
const MESSAGE_WEIGHT = 50;

/** One message as the predicate needs it. `at` is normalized RFC3339 UTC. */
export interface ThreadMessage {
  id: string;
  author: DecisionThreadMessage['author'];
  /** The persona that wrote it, when one did. */
  personaId: string | null;
  /** Display name for authors with no persona (bridged humans). */
  label?: string | null;
  body: string;
  at: string;
}

/** One candidate thread, before the predicate. */
export interface ThreadSource {
  /** `team:<teamId>` | `persona:<personaId>`. */
  channelKey: string;
  title: string;
  color?: string | null;
  /** Set on persona threads. */
  personaId: string | null;
  /** NEWEST FIRST — the slices' own order. */
  messages: ThreadMessage[];
  /** The slice's watermark. Null = never seen. */
  seenAt: string | null;
  canReply: boolean;
}

/** The newest message by somebody other than the user, or null. */
function latestFromOthers(messages: readonly ThreadMessage[]): ThreadMessage | null {
  return messages.find((m) => m.author !== 'user') ?? null;
}

/** See the module header. `messages` newest first. */
export function isAwaitingYou(messages: readonly ThreadMessage[], seenAt: string | null): boolean {
  const theirs = latestFromOthers(messages);
  if (!theirs) return false;
  const yours = messages.find((m) => m.author === 'user');
  // Same second counts as answered: `at` is second-resolution, and a reply
  // typed in the same second as the message it answers is still a reply.
  if (yours && yours.at >= theirs.at) return false;
  if (seenAt !== null && theirs.at <= seenAt) return false;
  return true;
}

/**
 * The team channel's messages, newest first.
 *
 * `directive` is the user. `persona`, `athena`, `director` and bridged `slack`
 * humans are voices in the room. Deliberation turns are excluded — the blended
 * read already leaves them out, and a deliberation is not addressed to you.
 */
export function teamThreadMessages(items: readonly TeamChannelItem[]): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const i of items) {
    if (i.deliberationId) continue;
    let author: ThreadMessage['author'];
    if (i.kind === 'directive') author = 'user';
    else if (i.kind === 'athena' || i.kind === 'director') author = 'athena';
    else if (i.kind === 'persona' || i.kind === 'slack') author = 'persona';
    else continue;
    out.push({
      id: i.id,
      author,
      personaId: i.kind === 'persona' ? i.personaId : null,
      label: i.kind === 'slack' ? i.label : null,
      body: i.body ?? '',
      at: i.at,
    });
  }
  return out;
}

/** A persona channel's chat rows, newest first. Unconfirmed echoes excluded. */
export function personaThreadMessages(
  items: readonly PersonaChannelItem[],
  personaId: string,
): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const i of items) {
    if (i.kind !== 'chat') continue;
    const author: ThreadMessage['author'] =
      i.authorKind === 'user' ? 'user' : i.authorKind === 'athena' ? 'athena' : 'persona';
    out.push({
      id: i.id,
      author,
      personaId: author === 'persona' ? personaId : null,
      body: i.body ?? '',
      at: i.at,
    });
  }
  return out;
}

/** Resolves a persona id to its display name. */
export type PersonaNameOf = (personaId: string) => string | undefined;

/**
 * One awaiting thread as a decision. Callers MUST have checked
 * {@link isAwaitingYou}; a thread with no message from anyone else has no item.
 */
export function chatThreadToDecision(
  source: ThreadSource,
  copy: DecisionCopy,
  nameOf: PersonaNameOf,
): DecisionItem | null {
  const theirs = latestFromOthers(source.messages);
  if (!theirs) return null;

  const nameFor = (m: ThreadMessage): string => {
    if (m.author === 'user') return copy.chatYou;
    if (m.author === 'athena') return copy.sourceAthena;
    return (m.personaId && nameOf(m.personaId)) || m.label || source.title;
  };
  const tail: DecisionThreadMessage[] = source.messages
    .slice(0, THREAD_TAIL)
    .reverse()
    .map((m) => ({ id: m.id, author: m.author, name: nameFor(m), body: m.body, at: m.at }));

  const [kind, targetId] = source.channelKey.split(':', 2);

  return {
    id: `message:${source.channelKey}`,
    sourceId: source.channelKey,
    kind: 'message',
    personaId: source.personaId,
    title: source.title,
    body: theirs.body,
    thread: { channelKey: source.channelKey, messages: tail, canReply: source.canReply },
    tags: [],
    facts: [{ id: 'last-message', label: copy.factLastMessage, value: theirs.at }],
    source: { label: nameFor(theirs), color: source.color ?? null },
    createdAt: theirs.at,
    weight: MESSAGE_WEIGHT,
    branches: [],
    verdictLabels: { accept: copy.chatDone, reject: copy.chatDismiss, skip: copy.triage.skip },
    payload: { channelKey: source.channelKey, channelKind: kind, targetId },
  };
}
