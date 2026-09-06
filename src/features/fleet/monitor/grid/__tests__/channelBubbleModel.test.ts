import { describe, it, expect } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { FeedTeam, TaggedItem } from '../../channels/types';
import {
  BUBBLE_NEW_GRACE_MS, bubbleText, createBubbleLedger, diffChatArrivals, isPersonaChat, latestPerPersona,
} from '../channelBubbleModel';

const TEAM: FeedTeam = { teamId: 't1', teamName: 'Team', teamColor: '#fff', members: [] };
const NOW = Date.parse('2026-09-05T12:00:00Z');

function item(over: Partial<TeamChannelItem>): TaggedItem {
  return {
    team: TEAM,
    item: {
      id: 'x', kind: 'persona', at: new Date(NOW).toISOString(), personaId: 'p1', label: 'say',
      body: 'hello there', assignmentId: null, stepId: null, extra: null, replyTo: null,
      deliberationId: null, importance: null, consumers: null, ...over,
    },
  };
}

const ROSTER = new Set(['p1', 'p2']);

describe('isPersonaChat / bubbleText', () => {
  it('accepts only persona rows with a persona and a body', () => {
    expect(isPersonaChat(item({}).item)).toBe(true);
    expect(isPersonaChat(item({ kind: 'step' }).item)).toBe(false);
    expect(isPersonaChat(item({ kind: 'athena' }).item)).toBe(false);
    expect(isPersonaChat(item({ kind: 'directive', personaId: null }).item)).toBe(false);
    expect(isPersonaChat(item({ personaId: null }).item)).toBe(false);
    expect(isPersonaChat(item({ body: '   ' }).item)).toBe(false);
  });
  it('collapses whitespace and caps the line', () => {
    expect(bubbleText(item({ body: '  a \n\n b\t c ' }).item)).toBe('a b c');
    expect(bubbleText(item({ body: 'x'.repeat(400) }).item)).toHaveLength(160);
    expect(bubbleText(item({ body: 'x'.repeat(400) }).item).endsWith('…')).toBe(true);
  });
});

describe('diffChatArrivals', () => {
  it('absorbs stale history on the first run but pops rows near mount', () => {
    const ledger = createBubbleLedger(NOW);
    const old = item({ id: 'old', at: new Date(NOW - BUBBLE_NEW_GRACE_MS - 1000).toISOString() });
    const recent = item({ id: 'recent', at: new Date(NOW - 2000).toISOString() });
    const fresh = diffChatArrivals(ledger, [recent, old], ROSTER, NOW);
    expect(fresh.map((b) => b.id)).toEqual(['recent']);
    expect(ledger.established).toBe(true);
  });

  it('after establishment every unseen persona row pops, whatever its stamp', () => {
    const ledger = createBubbleLedger(NOW);
    diffChatArrivals(ledger, [item({ id: 'a' })], ROSTER, NOW);
    const late = item({ id: 'b', at: new Date(NOW - 60_000).toISOString() });
    expect(diffChatArrivals(ledger, [late, item({ id: 'a' })], ROSTER, NOW + 1)).toHaveLength(1);
    // And never twice.
    expect(diffChatArrivals(ledger, [late, item({ id: 'a' })], ROSTER, NOW + 2)).toHaveLength(0);
  });

  it('ignores personas not on the board and non-chat rows, but still marks them seen', () => {
    const ledger = createBubbleLedger(NOW);
    const fresh = diffChatArrivals(
      ledger,
      [item({ id: 'stranger', personaId: 'p9' }), item({ id: 'step', kind: 'step' }), item({ id: 'ok' })],
      ROSTER, NOW,
    );
    expect(fresh.map((b) => b.id)).toEqual(['ok']);
    expect(ledger.seen.has('stranger')).toBe(true);
    expect(ledger.seen.has('step')).toBe(true);
  });

  it('an empty run does not establish the ledger', () => {
    const ledger = createBubbleLedger(NOW);
    diffChatArrivals(ledger, [], ROSTER, NOW);
    expect(ledger.established).toBe(false);
  });

  it('returns newest first, and latestPerPersona keeps one per persona', () => {
    const ledger = createBubbleLedger(NOW);
    const fresh = diffChatArrivals(ledger, [
      item({ id: 'p1-old', at: new Date(NOW - 3000).toISOString(), body: 'first' }),
      item({ id: 'p1-new', at: new Date(NOW - 1000).toISOString(), body: 'second' }),
      item({ id: 'p2', personaId: 'p2', body: 'other' }),
    ], ROSTER, NOW);
    expect(fresh.map((b) => b.id)).toEqual(['p2', 'p1-new', 'p1-old']);
    const latest = latestPerPersona(fresh);
    expect(latest.get('p1')?.text).toBe('second');
    expect(latest.get('p2')?.text).toBe('other');
    expect(latest.size).toBe(2);
  });
});
