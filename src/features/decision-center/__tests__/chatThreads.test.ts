import { describe, expect, it } from 'vitest';

import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

import { chipOf } from '../model/decisionModel';
import { decisionTier } from '../model/decisionOrder';
import {
  THREAD_TAIL,
  chatThreadToDecision,
  isAwaitingYou,
  personaThreadMessages,
  teamThreadMessages,
  type ThreadMessage,
} from '../roster/chatThreads';
import { DEFAULT_DECISION_COPY as copy } from '../roster/decisionCopy';

const msg = (id: string, author: ThreadMessage['author'], at: string): ThreadMessage => ({
  id,
  author,
  personaId: author === 'persona' ? 'p-1' : null,
  body: id,
  at,
});

// Newest first, as the slices hold them.
const T1 = '2026-10-01T10:00:00Z';
const T2 = '2026-10-01T10:05:00Z';
const T3 = '2026-10-01T10:10:00Z';

describe('isAwaitingYou — the chat predicate', () => {
  it('awaits you when the latest persona message is newer than your reply and the watermark', () => {
    expect(isAwaitingYou([msg('m2', 'persona', T2), msg('m1', 'user', T1)], T1)).toBe(true);
    expect(isAwaitingYou([msg('m1', 'athena', T1)], null)).toBe(true);
  });

  it('is answered when you replied after it', () => {
    expect(isAwaitingYou([msg('m3', 'user', T3), msg('m2', 'persona', T2)], null)).toBe(false);
  });

  it('is answered when you have SEEN past it, without a reply', () => {
    expect(isAwaitingYou([msg('m2', 'persona', T2), msg('m1', 'user', T1)], T3)).toBe(false);
    expect(isAwaitingYou([msg('m2', 'persona', T2)], T2)).toBe(false);
  });

  it('never awaits on a thread with only your own messages', () => {
    expect(isAwaitingYou([msg('m1', 'user', T1)], null)).toBe(false);
    expect(isAwaitingYou([], null)).toBe(false);
  });
});

function teamItem(over: Partial<TeamChannelItem>): TeamChannelItem {
  return {
    id: 'tc',
    kind: 'persona',
    at: T1,
    personaId: 'p-1',
    label: '',
    body: 'hello',
    assignmentId: null,
    stepId: null,
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
    ...over,
  };
}

function personaItem(over: Partial<PersonaChannelItem>): PersonaChannelItem {
  return {
    id: 'pch-1',
    kind: 'chat',
    at: T1,
    authorKind: 'persona',
    title: null,
    body: 'hi',
    reportId: null,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: null,
    ...over,
  };
}

describe('thread message extraction', () => {
  it('keeps only messages from a team channel, and drops deliberation turns', () => {
    const out = teamThreadMessages([
      teamItem({ id: 'a', kind: 'director' }),
      teamItem({ id: 'b', kind: 'step' }),
      teamItem({ id: 'c', kind: 'directive', personaId: null }),
      teamItem({ id: 'd', kind: 'persona', deliberationId: 'dl-1' }),
      teamItem({ id: 'e', kind: 'memory' }),
    ]);
    expect(out.map((m) => [m.id, m.author])).toEqual([
      ['a', 'athena'],
      ['c', 'user'],
    ]);
  });

  it('keeps only chat rows from a persona channel', () => {
    const out = personaThreadMessages(
      [
        personaItem({ id: 'pch-2', authorKind: 'user' }),
        personaItem({ id: 'prep-1', kind: 'report' }),
        personaItem({ id: 'pch-1', authorKind: 'persona' }),
      ],
      'p-1',
    );
    expect(out.map((m) => [m.id, m.author])).toEqual([
      ['pch-2', 'user'],
      ['pch-1', 'persona'],
    ]);
  });
});

describe('chatThreadToDecision', () => {
  it('is a tier-3 message with the thread tail oldest-first', () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      msg(`m${15 - i}`, i % 2 ? 'user' : 'persona', `2026-10-01T10:${String(59 - i).padStart(2, '0')}:00Z`),
    );
    const d = chatThreadToDecision(
      {
        channelKey: 'persona:p-1',
        title: 'Scout',
        personaId: 'p-1',
        messages,
        seenAt: null,
        canReply: true,
      },
      copy,
      () => 'Scout',
    );
    expect(d?.kind).toBe('message');
    expect(chipOf(d!.kind)).toBe('chat');
    expect(decisionTier(d!)).toBe(3);
    expect(d?.thread?.channelKey).toBe('persona:p-1');
    expect(d?.thread?.messages).toHaveLength(THREAD_TAIL);
    // Oldest first: the tail ends on the newest message.
    expect(d?.thread?.messages.at(-1)?.id).toBe('m15');
    expect(d?.payload).toMatchObject({ channelKey: 'persona:p-1', channelKind: 'persona', targetId: 'p-1' });
  });
});
