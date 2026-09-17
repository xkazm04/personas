import { describe, it, expect } from 'vitest';
import { deriveDeskTrail, TRAIL_RECENT } from '../desk/trailModel';
import type { SetupHistoryEntry, SetupProposal } from '../setupContract';

/**
 * The Desk's trail is the only thing standing between "one question at a time"
 * and "a question out of nowhere", so its three load-bearing behaviours are
 * asserted here rather than left to the renderer:
 *  - the FIRST question opens the conversation (no trail, greeting territory);
 *  - the trail is a thread, not a transcript (two exchanges stay open);
 *  - a resolved proposal keeps its verdict in the record.
 */

function guide(id: string, text: string, over: Partial<SetupHistoryEntry> = {}): SetupHistoryEntry {
  return { id, role: 'guide', text, ...over };
}

function user(id: string, text: string): SetupHistoryEntry {
  return { id, role: 'user', text };
}

function proposal(id: string, over: Partial<SetupProposal> = {}): SetupProposal {
  return { id, kind: 'bio', channel: null, value: 'A bio.', lengthHint: null, reason: 'why', ...over };
}

describe('deriveDeskTrail', () => {
  it('opens the conversation on the first question: no exchanges, nothing to follow yet', () => {
    const trail = deriveDeskTrail([guide('g1', 'Who are you?')], 'Who are you?');
    expect(trail.isOpening).toBe(true);
    expect(trail.exchanges).toHaveLength(0);
    expect(trail.recent).toHaveLength(0);
    expect(trail.earlier).toHaveLength(0);
  });

  it('drops the live guide turn so the current question is never also trail', () => {
    const trail = deriveDeskTrail(
      [guide('g1', 'Who are you?'), user('u1', 'A writer.'), guide('g2', 'What tone?')],
      'What tone?',
    );
    expect(trail.exchanges).toHaveLength(1);
    expect(trail.exchanges[0]).toMatchObject({ question: 'Who are you?', answer: 'A writer.' });
    expect(trail.isOpening).toBe(false);
  });

  it('keeps the last two exchanges open and folds everything older into "earlier"', () => {
    const history: SetupHistoryEntry[] = [];
    for (let i = 1; i <= 4; i++) {
      history.push(guide(`g${i}`, `Q${i}`), user(`u${i}`, `A${i}`));
    }
    history.push(guide('g5', 'Q5'));

    const trail = deriveDeskTrail(history, 'Q5');
    expect(trail.exchanges).toHaveLength(4);
    expect(trail.recent).toHaveLength(TRAIL_RECENT);
    expect(trail.recent.map((e) => e.question)).toEqual(['Q3', 'Q4']);
    expect(trail.earlier.map((e) => e.question)).toEqual(['Q1', 'Q2']);
  });

  it('carries the verdict of every resolved proposal on its own guide turn', () => {
    const history = [
      guide('g1', 'Shall I write your bio?', {
        proposals: [proposal('p1'), proposal('p2', { kind: 'role' })],
        resolutions: { p1: 'accepted', p2: 'dismissed' },
      }),
      user('u1', 'Yes to the first.'),
      guide('g2', 'What tone?'),
    ];

    const [exchange] = deriveDeskTrail(history, 'What tone?').exchanges;
    expect(exchange?.verdicts).toEqual([
      { id: 'p1', kind: 'bio', channel: null, resolution: 'accepted' },
      { id: 'p2', kind: 'role', channel: null, resolution: 'dismissed' },
    ]);
  });

  it('shows an unresolved proposal as no verdict at all rather than a false one', () => {
    const history = [
      guide('g1', 'Shall I write your bio?', { proposals: [proposal('p1')] }),
      user('u1', 'Later.'),
      guide('g2', 'What tone?'),
    ];
    expect(deriveDeskTrail(history, 'What tone?').exchanges[0]?.verdicts).toEqual([]);
  });

  it('records a declined question as an exchange with no answer, not as a gap', () => {
    // `skip()` writes no transcript line, so the guide turn is followed by the
    // next guide turn. The thread must still show that it was asked.
    const trail = deriveDeskTrail(
      [guide('g1', 'Who are you?'), guide('g2', 'What tone?')],
      'What tone?',
    );
    expect(trail.exchanges).toHaveLength(1);
    expect(trail.exchanges[0]).toMatchObject({ question: 'Who are you?', answer: null });
  });

  it('keeps the tail when it is a guide turn that is NOT the live question', () => {
    // Mid-flight: the user has answered and the next question has not landed.
    const trail = deriveDeskTrail(
      [guide('g1', 'Who are you?'), user('u1', 'A writer.')],
      'Who are you?',
    );
    expect(trail.exchanges).toHaveLength(1);
    expect(trail.exchanges[0]?.answer).toBe('A writer.');
  });
});
