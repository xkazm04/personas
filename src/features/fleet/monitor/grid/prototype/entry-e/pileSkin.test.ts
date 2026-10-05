// pileSkin - the Activity board's lines speak the Board's four piles.
//
// A session is folded through the panel filter's own `sessionBucket`, so these
// tests pin that a line's fill and the command-bar tag that counts it agree.

import { describe, expect, it } from 'vitest';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaCardModel } from '../../../monitorModel';
import { PILE_VISUAL } from '../../../fleetboard/piles';
import { sessionBucket } from './boardFilter';
import { personaLinePileKey, pileOfKey, pileSkin, sessionPileKey } from './pileSkin';

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'P', personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    reviewCount: 0, messages: [], messageCount: 0, processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

const s = (state: FleetSessionState, exitCode: number | null = null) => ({ state, exitCode });

describe('sessionPileKey', () => {
  it('folds every session state into the Board piles', () => {
    expect(sessionPileKey(s('awaiting_input'))).toBe('warning');
    expect(sessionPileKey(s('stale'))).toBe('warning');
    expect(sessionPileKey(s('exited', 1))).toBe('critical');
    expect(sessionPileKey(s('running'))).toBe('working');
    expect(sessionPileKey(s('spawning'))).toBe('working');
    for (const st of ['queued', 'idle', 'hibernated', 'finished'] as const) expect(sessionPileKey(s(st))).toBe('resting');
    expect(sessionPileKey(s('exited', 0))).toBe('off');
    expect(sessionPileKey(s('exited'))).toBe('off');
    expect(sessionPileKey(s('expired'))).toBe('off');
  });

  it('agrees with the panel filter tag that counts the session', () => {
    const tagOf = { warning: 'attention', critical: 'failed', working: 'running', resting: 'idle', off: 'idle' } as const;
    const states: FleetSessionState[] = ['queued', 'spawning', 'running', 'awaiting_input', 'idle', 'stale', 'finished', 'hibernated', 'exited', 'expired'];
    for (const st of states) {
      for (const code of [null, 0, 2]) expect(tagOf[sessionPileKey(s(st, code))]).toBe(sessionBucket(s(st, code)));
    }
  });
});

describe('personaLinePileKey', () => {
  it('is the Board pile, with a switched-off project drawn off unless it needs you', () => {
    expect(personaLinePileKey(card(), false)).toBe('resting');
    expect(personaLinePileKey(card(), true)).toBe('off');
    expect(personaLinePileKey(card({ running: 1, execState: 'running' }), true)).toBe('off');
    const unread = card({ messageCount: 3, messages: [{ id: 'm' } as unknown as PersonaReport] });
    expect(personaLinePileKey(unread, true)).toBe('warning');
    expect(personaLinePileKey(card({ execState: 'failed' }), true)).toBe('critical');
  });
});

describe('pileSkin', () => {
  it('names the Board tile classes and its tone', () => {
    const skin = pileSkin('critical', 'a');
    expect(skin.pile).toBe('needs');
    expect(skin.className).toBe('fb-tile ae-pile is-needs is-critical');
    expect((skin.style as Record<string, string>)['--fb-tone']).toBe(PILE_VISUAL.critical.tone);
    expect(pileSkin('working', 'a').className).toBe('fb-tile ae-pile is-working');
    expect(pileOfKey('warning')).toBe('needs');
  });

  it('staggers the sweep by id, stably', () => {
    const d = (id: string) => (pileSkin('working', id).style as Record<string, string>)['--fb-sd'];
    expect(d('s-1')).toBe(d('s-1'));
    expect(d('s-1')).toMatch(/^-?\d+(\.\d)?s$/);
  });
});
