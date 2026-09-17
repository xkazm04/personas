import { describe, it, expect } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { Persona } from '@/lib/bindings/Persona';
import type { TaggedItem } from '../../../channels/types';
import {
  buildMessageThreads, countUnreadThreads, SYSTEM_THREAD_KEY, type ThreadLookups,
} from '../messageThreads';
import { threadToRow } from '../railModel';

/**
 * The Messages tab is one thread per source. What is worth pinning: which
 * thread a line lands in (persona / team / system, and a reply following the
 * line it answers), the newest-thread-first order, and the unread rule, which
 * must keep `countUnread`'s semantics (your own directives never count) while
 * layering a per-thread watermark over the team's.
 */

function item(over: Partial<TeamChannelItem>): TeamChannelItem {
  return {
    id: 'x', kind: 'persona', at: '2026-09-01T00:00:00Z', personaId: null,
    label: 'said', body: 'hello', assignmentId: null, stepId: null, extra: null,
    replyTo: null, deliberationId: null, importance: null, consumers: null,
    ...over,
  } as TeamChannelItem;
}

function tg(teamId: string, over: Partial<TeamChannelItem>): TaggedItem {
  return { item: item(over), team: { teamId, teamName: `Team ${teamId}`, teamColor: '#888', members: [] } };
}

const PERSONAS = new Map<string, Persona>([
  ['p1', { id: 'p1', name: 'Scout', icon: null, color: '#f00' } as unknown as Persona],
  ['p2', { id: 'p2', name: 'T: Builder', icon: null, color: '#0f0' } as unknown as Persona],
]);

function lookups(over: Partial<ThreadLookups> = {}): ThreadLookups {
  return {
    personaOf: (id) => PERSONAS.get(id),
    threadSeenOf: () => null,
    teamSeenOf: () => null,
    systemName: 'System',
    teamName: (t) => t.team.teamName,
    ...over,
  };
}

// Newest first, the order the merged feed hands over.
const merged: TaggedItem[] = [
  tg('a', { id: 'm1', kind: 'persona', personaId: 'p1', at: '2026-09-01T10:00:00Z' }),
  tg('a', { id: 'm2', kind: 'step', personaId: null, at: '2026-09-01T09:00:00Z' }),
  tg('b', { id: 'm3', kind: 'persona', personaId: 'p1', at: '2026-09-01T08:00:00Z' }),
  tg('b', { id: 'm4', kind: 'director', personaId: null, at: '2026-09-01T07:00:00Z' }),
  tg('a', { id: 'm5', kind: 'event', personaId: null, at: '2026-09-01T06:00:00Z' }),
  tg('b', { id: 'm6', kind: 'persona', personaId: 'gone', at: '2026-09-01T05:00:00Z' }),
  tg('a', { id: 'm7', kind: 'step', personaId: 'p2', at: '2026-09-01T04:00:00Z' }),
];

describe('buildMessageThreads — thread keys', () => {
  const threads = buildMessageThreads(merged, lookups());
  const byKey = new Map(threads.map((t) => [t.key, t]));

  it('keeps every message, in exactly one thread', () => {
    expect(threads.reduce((n, t) => n + t.items.length, 0)).toBe(merged.length);
  });

  it('gives a persona ONE thread across teams', () => {
    const scout = byKey.get('persona:p1')!;
    expect(scout.kind).toBe('persona');
    expect(scout.name).toBe('Scout');
    expect(scout.items.map((t) => t.item.id)).toEqual(['m1', 'm3']);
  });

  it('files a persona step under the persona, and strips the team prefix from its name', () => {
    expect(byKey.get('persona:p2')!.name).toBe('Builder');
  });

  it('puts authorless machine items in one system thread across teams', () => {
    const sys = byKey.get(SYSTEM_THREAD_KEY)!;
    expect(sys.kind).toBe('system');
    expect(sys.name).toBe('System');
    expect(sys.items.map((t) => t.item.id)).toEqual(['m2', 'm5']);
  });

  it('puts room voices and unresolvable personas in their team thread', () => {
    const team = byKey.get('team:b')!;
    expect(team.kind).toBe('team');
    expect(team.items.map((t) => t.item.id)).toEqual(['m4', 'm6']);
  });

  it('orders threads by their newest message', () => {
    expect(threads.map((t) => t.key)).toEqual([
      'persona:p1', SYSTEM_THREAD_KEY, 'team:b', 'persona:p2',
    ]);
  });

  it('files a reply directive into the thread of the line it answers', () => {
    const withReply = [
      tg('a', { id: 'r1', kind: 'directive', replyTo: 'm1', at: '2026-09-01T11:00:00Z' }),
      ...merged,
    ];
    const th = buildMessageThreads(withReply, lookups());
    const scout = th.find((t) => t.key === 'persona:p1')!;
    // Opened by the reply, and still a PERSONA thread with the persona's name.
    expect(th[0]!.key).toBe('persona:p1');
    expect(scout.kind).toBe('persona');
    expect(scout.name).toBe('Scout');
    expect(scout.latest.item.id).toBe('r1');
  });

  it('keeps a plain directive (no reply target) in the team thread', () => {
    const th = buildMessageThreads([tg('a', { id: 'd', kind: 'directive' })], lookups());
    expect(th.map((t) => t.key)).toEqual(['team:a']);
  });

  it('never files a bridged slack human under a persona', () => {
    const th = buildMessageThreads([tg('a', { id: 's', kind: 'slack', personaId: 'p1' })], lookups());
    expect(th.map((t) => t.key)).toEqual(['team:a']);
  });
});

describe('buildMessageThreads — unread', () => {
  it('counts everything unread when nothing has been seen', () => {
    const threads = buildMessageThreads(merged, lookups());
    expect(threads.every((t) => t.unread === t.items.length)).toBe(true);
    expect(countUnreadThreads(threads)).toBe(4);
  });

  it('never counts your own directives', () => {
    const threads = buildMessageThreads([tg('a', { id: 'd', kind: 'directive' })], lookups());
    expect(threads[0]!.unread).toBe(0);
    expect(countUnreadThreads(threads)).toBe(0);
  });

  it('falls back to the team watermark when the thread has none', () => {
    const threads = buildMessageThreads(
      merged,
      lookups({ teamSeenOf: (id) => (id === 'a' ? '2026-09-01T09:30:00Z' : null) }),
    );
    // m1 (team a, 10:00) is newer than a's watermark, m3 (team b) never seen.
    expect(threads.find((t) => t.key === 'persona:p1')!.unread).toBe(2);
    // Both system items are in team a, at or before 09:30.
    expect(threads.find((t) => t.key === SYSTEM_THREAD_KEY)!.unread).toBe(0);
  });

  it('a thread watermark reads the thread across every team', () => {
    const threads = buildMessageThreads(
      merged,
      lookups({ threadSeenOf: (k) => (k === 'persona:p1' ? '2026-09-01T10:00:00Z' : null) }),
    );
    expect(threads.find((t) => t.key === 'persona:p1')!.unread).toBe(0);
    expect(countUnreadThreads(threads)).toBe(3);
  });

  it('uses the LATER of the two watermarks', () => {
    const threads = buildMessageThreads(
      merged,
      lookups({
        threadSeenOf: (k) => (k === 'persona:p1' ? '2026-09-01T01:00:00Z' : null),
        teamSeenOf: () => '2026-09-01T12:00:00Z',
      }),
    );
    expect(countUnreadThreads(threads)).toBe(0);
  });
});

describe('threadToRow', () => {
  const preview = (m: string, author: string | null, mine: boolean) =>
    mine ? `You: ${m}` : author ? `${author}: ${m}` : m;

  it('projects a thread as name + latest line + unread count, keyed by thread', () => {
    const [scout] = buildMessageThreads(merged, lookups());
    const row = threadToRow(scout!, lookups().personaOf, preview);
    expect(row.id).toBe('persona:p1');
    expect(row.title).toBe('Scout');
    expect(row.body).toBe('hello');
    expect(row.unread).toBe(true);
    expect(row.unreadCount).toBe(2);
    expect(row.persona).toEqual({ icon: null, color: '#f00' });
    expect(row.groupHeader).toBeNull();
  });

  it('prefixes the author on a team thread and marks your own last word', () => {
    const team = buildMessageThreads([tg('a', { id: 'x', kind: 'director' })], lookups())[0]!;
    expect(threadToRow(team, lookups().personaOf, preview).body).toBe('Director: hello');
    const mine = buildMessageThreads([tg('a', { id: 'y', kind: 'directive' })], lookups())[0]!;
    const row = threadToRow(mine, lookups().personaOf, preview);
    expect(row.body).toBe('You: hello');
    expect(row.unread).toBe(false);
  });
});
