/**
 * The bubble hook over its TWO sources.
 *
 * SOURCE 1 (the regression guard): a mocked merged feed - a new persona line
 * becomes a bubble, the bubble fades on its own after ten seconds while the
 * unseen count stays, and opening the persona clears both. None of that may
 * change because a second source exists.
 *
 * SOURCE 2: a quick-chat ask - the persona wears a quiet pending mark that
 * does NOT fade, and the reply (which arrives on the sentinel-keyed persona
 * channel no team reader can see) replaces it with a longer-lived bubble.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { FeedTeam, TaggedItem } from '../../channels/types';
import {
  ASKED_BUBBLE_TTL_MS, BUBBLE_TTL_MS, getQuickChatAsks, recordQuickChatAsk,
  resetQuickChatAsks, type PersonaChannelRow,
} from '../channelBubbleModel';

let merged: TaggedItem[] = [];
vi.mock('../../channels/mergedFeed', () => ({
  useMergedChannels: () => ({ merged, presenceByTeam: new Map(), byTeam: new Map() }),
}));

/** The persona-channel lane, stubbed at the store: the hook reads the head the
 *  existing channel service already refreshes, and takes a refcounted sub. */
const release = vi.fn();
const pipeline = {
  personaChannels: {} as Record<string, { items: PersonaChannelRow[] }>,
  subscribePersonaChannel: vi.fn(() => release),
};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (select: (s: typeof pipeline) => unknown) => select(pipeline),
}));

import { useChannelBubbles } from '../useChannelBubbles';

const TEAM: FeedTeam = { teamId: 't1', teamName: 'Team', teamColor: '#fff', members: [] };
const TEAMS = [TEAM];
const ROSTER = new Set(['p1']);

/** The fake clock's origin. Every fixture row is stamped a second before it —
 *  inside the mount grace, so it pops — from a constant, never the renderer's
 *  own clock (chronological-feed.md). */
const CLOCK_ORIGIN = Date.parse('2026-09-05T12:00:00Z');
const ROW_AT = new Date(CLOCK_ORIGIN - 1000).toISOString();

function row(id: string, body: string, over: Partial<TeamChannelItem> = {}): TaggedItem {
  return {
    team: TEAM,
    item: {
      id, kind: 'persona', at: ROW_AT, personaId: 'p1', label: 'say', body,
      assignmentId: null, stepId: null, extra: null, replyTo: null, deliberationId: null,
      importance: null, consumers: null, ...over,
    },
  };
}

/** A persona-authored chat row on the persona channel, stamped after the ask. */
function reply(id: string, body: string, over: Partial<PersonaChannelRow> = {}): PersonaChannelRow {
  return {
    id, kind: 'chat', authorKind: 'persona',
    at: new Date(CLOCK_ORIGIN + 1000).toISOString(), body, ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: CLOCK_ORIGIN });
  merged = [];
  pipeline.personaChannels = {};
  pipeline.subscribePersonaChannel.mockClear();
  release.mockClear();
  resetQuickChatAsks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useChannelBubbles', () => {
  it('pops a bubble for a live persona line and fades it after the TTL, keeping the unseen count', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    expect(result.current.bubbles.size).toBe(0);

    merged = [row('m1', 'shipping the fix')];
    rerender();
    expect(result.current.bubbles.get('p1')?.text).toBe('shipping the fix');
    expect(result.current.unseen.get('p1')).toBe(1);

    act(() => { vi.advanceTimersByTime(BUBBLE_TTL_MS + 1); });
    expect(result.current.bubbles.has('p1')).toBe(false);
    expect(result.current.unseen.get('p1')).toBe(1);
  });

  it('a second line replaces the bubble, restarts the clock and counts up', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    merged = [row('m1', 'one')];
    rerender();
    act(() => { vi.advanceTimersByTime(BUBBLE_TTL_MS - 1000); });
    merged = [row('m2', 'two'), row('m1', 'one')];
    rerender();
    expect(result.current.bubbles.get('p1')?.text).toBe('two');
    expect(result.current.unseen.get('p1')).toBe(2);
    // The first timer must not take the second bubble down.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.bubbles.get('p1')?.text).toBe('two');
    act(() => { vi.advanceTimersByTime(BUBBLE_TTL_MS); });
    expect(result.current.bubbles.has('p1')).toBe(false);
  });

  it('acknowledge clears the ledger and the bubble', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    merged = [row('m1', 'hi')];
    rerender();
    act(() => { result.current.acknowledge('p1'); });
    expect(result.current.bubbles.has('p1')).toBe(false);
    expect(result.current.unseen.has('p1')).toBe(false);
  });

  it('does nothing for rows that are not persona chatter', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    merged = [row('s1', 'Plan step', { kind: 'step' }), row('d1', 'go', { kind: 'directive', personaId: null })];
    rerender();
    expect(result.current.bubbles.size).toBe(0);
    expect(result.current.unseen.size).toBe(0);
  });
});

describe('useChannelBubbles — the asked source', () => {
  it('marks the persona pending on an ask, and the pending mark never fades', () => {
    const { result } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    act(() => { recordQuickChatAsk('p1', 'status on the migration?', CLOCK_ORIGIN); });

    const pending = result.current.bubbles.get('p1');
    expect(pending?.pending).toBe(true);
    expect(pending?.text).toBe('status on the migration?');
    expect(pending?.source).toBe('persona');
    // An ask opens the refcounted persona-channel subscription, not a poll.
    expect(pipeline.subscribePersonaChannel).toHaveBeenCalledWith('p1');

    // Far past the AMBIENT life, and well into the 30-minute reply deadline.
    act(() => { vi.advanceTimersByTime(BUBBLE_TTL_MS * 10); });
    expect(result.current.bubbles.get('p1')?.pending).toBe(true);
  });

  it('the reply replaces the pending mark, counts as unseen and closes the ask', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    act(() => { recordQuickChatAsk('p1', 'status?', CLOCK_ORIGIN); });
    expect(result.current.bubbles.get('p1')?.pending).toBe(true);

    pipeline.personaChannels = { p1: { items: [reply('pch-9', 'migration is green')] } };
    act(() => { rerender(); });

    const landed = result.current.bubbles.get('p1');
    expect(landed?.text).toBe('migration is green');
    expect(landed?.pending).toBeFalsy();
    expect(landed?.source).toBe('persona');
    expect(result.current.unseen.get('p1')).toBe(1);
    // Answered: the ledger entry goes, and with it the subscription.
    expect(getQuickChatAsks().size).toBe(0);

    // A delivered reply outlives an ambient line and then fades like one.
    act(() => { vi.advanceTimersByTime(BUBBLE_TTL_MS + 1); });
    expect(result.current.bubbles.get('p1')?.text).toBe('migration is green');
    act(() => { vi.advanceTimersByTime(ASKED_BUBBLE_TTL_MS); });
    expect(result.current.bubbles.has('p1')).toBe(false);
  });

  it('the operator\'s own echo is not mistaken for the reply', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    act(() => { recordQuickChatAsk('p1', 'status?', CLOCK_ORIGIN); });
    pipeline.personaChannels = { p1: { items: [reply('pch-8', 'status?', { authorKind: 'user' })] } };
    act(() => { rerender(); });
    expect(result.current.bubbles.get('p1')?.pending).toBe(true);
    expect(getQuickChatAsks().size).toBe(1);
  });

  it('ambient chatter does not overwrite an outstanding ask', () => {
    const { result, rerender } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    act(() => { recordQuickChatAsk('p1', 'status?', CLOCK_ORIGIN); });
    merged = [row('m1', 'unrelated standup line')];
    act(() => { rerender(); });
    expect(result.current.bubbles.get('p1')?.pending).toBe(true);
    // The ledger still counts it — the bubble is the glance, this is the count.
    expect(result.current.unseen.get('p1')).toBe(1);
  });

  it('acknowledge clears a pending ask too', () => {
    const { result } = renderHook(() => useChannelBubbles(TEAMS, ROSTER));
    act(() => { recordQuickChatAsk('p1', 'status?', CLOCK_ORIGIN); });
    act(() => { result.current.acknowledge('p1'); });
    expect(result.current.bubbles.has('p1')).toBe(false);
    expect(getQuickChatAsks().size).toBe(0);
  });
});
