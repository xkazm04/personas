/**
 * The bubble hook over a mocked merged feed: a new persona line becomes a
 * bubble, the bubble fades on its own after ten seconds while the unseen
 * count stays, and opening the persona clears both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { FeedTeam, TaggedItem } from '../../channels/types';
import { BUBBLE_TTL_MS } from '../channelBubbleModel';

let merged: TaggedItem[] = [];
vi.mock('../../channels/mergedFeed', () => ({
  useMergedChannels: () => ({ merged, presenceByTeam: new Map(), byTeam: new Map() }),
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

beforeEach(() => {
  vi.useFakeTimers({ now: CLOCK_ORIGIN });
  merged = [];
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
