import { describe, expect, it } from 'vitest';

import { useAthenaStore } from '@/features/companions/athena/athenaStore';

import {
  markRowResolvedLocally,
  noteSuggestionCards,
  openSuggestionCountFor,
  parseNoteSuggestionRows,
  pendingSuggestionsFor,
} from '../athena/noteSuggestions';

/**
 * The `note_suggestions` card config is snake_case JSON hand-built in Rust and
 * stored as text in SQLite — there is no ts-rs binding for it by design, so
 * this parse IS the type check. What it must never do is DEFAULT a missing
 * field: a suggestion block rendered with an invented body would be Athena
 * putting words in her own mouth, and the operator has no way to tell.
 */
describe('parseNoteSuggestionRows', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    row_id: 'r1',
    kind: 'section',
    anchor: { after_heading: 'Goal' },
    title: 'Add risks',
    body_md: '## Risks',
    outcome: null,
    ...over,
  });

  it('maps the wire shape onto the pad shape, carrying the card id', () => {
    const [parsed] = parseNoteSuggestionRows('card-1', [row()]);
    expect(parsed).toEqual({
      cardId: 'card-1',
      rowId: 'r1',
      kind: 'section',
      anchor: { after_heading: 'Goal' },
      title: 'Add risks',
      bodyMd: '## Risks',
      outcome: null,
    });
  });

  it('drops a row rather than defaulting a missing body or an unknown kind', () => {
    expect(parseNoteSuggestionRows('c', [row({ body_md: undefined })])).toHaveLength(0);
    expect(parseNoteSuggestionRows('c', [row({ kind: 'rewrite' })])).toHaveLength(0);
    expect(parseNoteSuggestionRows('c', [row({ row_id: '' })])).toHaveLength(0);
  });

  it('treats a missing or malformed anchor as "at the end", never as a heading', () => {
    expect(parseNoteSuggestionRows('c', [row({ anchor: null })])[0]?.anchor).toBeNull();
    expect(parseNoteSuggestionRows('c', [row({ anchor: 'Goal' })])[0]?.anchor).toBeNull();
  });

  it('narrows an unknown outcome to undecided rather than trusting it', () => {
    expect(parseNoteSuggestionRows('c', [row({ outcome: 'maybe' })])[0]?.outcome).toBeNull();
    expect(parseNoteSuggestionRows('c', [row({ outcome: 'edited' })])[0]?.outcome).toBe('edited');
  });

  it('survives a config that is not an array at all', () => {
    expect(parseNoteSuggestionRows('c', undefined)).toEqual([]);
    expect(parseNoteSuggestionRows('c', { rows: 1 })).toEqual([]);
  });
});

describe('noteSuggestionCards', () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: 'card-1',
    kind: 'note_suggestions',
    config: {
      note_id: 'n1',
      note_title: 'Notepad polish',
      rows: [{ row_id: 'r1', kind: 'edit', anchor: null, body_md: 'x', outcome: null }],
    },
    ...over,
  });

  it('ignores every other card kind in the transcript', () => {
    expect(noteSuggestionCards([card({ kind: 'ship_goals' })])).toEqual([]);
  });

  /** A card with no durable id cannot be resolved, so rendering its rows would
   *  give the operator buttons that throw. */
  it('ignores a card with no durable row id', () => {
    expect(noteSuggestionCards([card({ id: undefined })])).toEqual([]);
  });

  it('ignores a card whose config names no note', () => {
    expect(noteSuggestionCards([card({ config: { rows: [] } })])).toEqual([]);
  });
});

describe('pendingSuggestionsFor', () => {
  const cards = noteSuggestionCards([
    {
      id: 'card-1',
      kind: 'note_suggestions',
      config: {
        note_id: 'n1',
        note_title: 'A',
        rows: [
          { row_id: 'r1', kind: 'section', anchor: null, body_md: 'open', outcome: null },
          { row_id: 'r2', kind: 'section', anchor: null, body_md: 'done', outcome: 'accepted' },
        ],
      },
    },
    {
      id: 'card-2',
      kind: 'note_suggestions',
      config: {
        note_id: 'n2',
        note_title: 'B',
        rows: [{ row_id: 'r3', kind: 'edit', anchor: null, body_md: 'other', outcome: null }],
      },
    },
  ]);

  it('returns only undecided rows for the note asked about', () => {
    expect(pendingSuggestionsFor(cards, 'n1').map((r) => r.rowId)).toEqual(['r1']);
    expect(pendingSuggestionsFor(cards, 'n2').map((r) => r.rowId)).toEqual(['r3']);
  });

  it('returns nothing when no note is selected', () => {
    expect(pendingSuggestionsFor(cards, null)).toEqual([]);
  });
});

/**
 * The local projection of a resolved row. Accepting one block must take only
 * that block off the note: its siblings on the same card are still Athena's
 * open proposals, and the ask-wait baseline counts them.
 */
describe('markRowResolvedLocally', () => {
  const seed = () =>
    useAthenaStore.setState({
      chatCards: [
        {
          id: 'card-1',
          kind: 'note_suggestions',
          config: {
            note_id: 'n1',
            note_title: 'A',
            rows: [
              { row_id: 'r1', kind: 'section', anchor: null, body_md: 'one', outcome: null },
              { row_id: 'r2', kind: 'edit', anchor: null, body_md: 'two', outcome: null },
            ],
          },
        },
        {
          id: 'card-2',
          kind: 'note_suggestions',
          config: {
            note_id: 'n1',
            note_title: 'A',
            rows: [{ row_id: 'r1', kind: 'question', anchor: null, body_md: 'same id, other card', outcome: null }],
          },
        },
      ],
    });

  it('resolves the one row on the one card and leaves every sibling open', () => {
    seed();
    expect(openSuggestionCountFor('n1')).toBe(3);

    markRowResolvedLocally('card-1', 'r1', 'accepted');

    const cards = noteSuggestionCards(useAthenaStore.getState().chatCards);
    expect(cards[0]?.rows.map((r) => [r.rowId, r.outcome])).toEqual([
      ['r1', 'accepted'],
      ['r2', null],
    ]);
    expect(cards[1]?.rows[0]?.outcome).toBeNull();
    expect(openSuggestionCountFor('n1')).toBe(2);

    // Same row id on another card: only that card moves.
    markRowResolvedLocally('card-2', 'r1', 'rejected');
    const after = noteSuggestionCards(useAthenaStore.getState().chatCards);
    expect(after[1]?.rows.map((r) => [r.rowId, r.bodyMd, r.outcome])).toEqual([
      ['r1', 'same id, other card', 'rejected'],
    ]);
    expect(after[0]?.rows.map((r) => r.outcome)).toEqual(['accepted', null]);
    expect(openSuggestionCountFor('n1')).toBe(1);
  });

  it('changes nothing for a card that is not in the transcript', () => {
    seed();
    const before = useAthenaStore.getState().chatCards;
    markRowResolvedLocally('card-gone', 'r1', 'rejected');
    expect(useAthenaStore.getState().chatCards).toEqual(before);
  });
});
