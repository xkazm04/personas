import { describe, expect, it } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';

import { CARD_TEXT_LIMIT, canQuickWrite, cardExcerpt, resultSummary, titleFromText } from '../noteText';

function note(overrides: Partial<DevNote>): DevNote {
  return {
    id: 'n1',
    projectId: null,
    title: 'Note',
    bodyMd: '',
    status: 'draft',
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

describe('canQuickWrite', () => {
  it('allows a draft at exactly the limit and refuses one past it', () => {
    expect(canQuickWrite(note({ bodyMd: 'x'.repeat(CARD_TEXT_LIMIT) }))).toBe(true);
    expect(canQuickWrite(note({ bodyMd: 'x'.repeat(CARD_TEXT_LIMIT + 1) }))).toBe(false);
  });

  it('refuses a short note that has left draft — its body is locked server-side', () => {
    expect(canQuickWrite(note({ bodyMd: 'short', status: 'published' }))).toBe(false);
  });
});

describe('cardExcerpt', () => {
  it('strips markdown markers and collapses whitespace', () => {
    expect(cardExcerpt('## Goal\n\n- **ship** it\n- [ ] `test`').text).toBe('Goal ship it test');
  });

  it('measures truncation on the stored markdown, the same length canQuickWrite reads', () => {
    // 101 raw characters whose plain text is shorter than the limit: still truncated,
    // so the card never offers a textarea for text it would not accept.
    const body = `**${'a'.repeat(97)}**`;
    expect(body.length).toBe(CARD_TEXT_LIMIT + 1);
    expect(cardExcerpt(body)).toEqual({ text: 'a'.repeat(97), truncated: true });
  });

  it('cuts a long excerpt on a word boundary with an ellipsis', () => {
    const { text, truncated } = cardExcerpt('word '.repeat(40));
    expect(truncated).toBe(true);
    expect(text.endsWith('word…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(CARD_TEXT_LIMIT + 1);
  });
});

describe('titleFromText', () => {
  it('uses the first non-empty line without its markers', () => {
    expect(titleFromText('\n# Retry the sweeper\nbody', 'Untitled')).toBe('Retry the sweeper');
  });

  it('falls back when there is no text and shortens a long line', () => {
    expect(titleFromText('   ', 'Untitled')).toBe('Untitled');
    expect(titleFromText('a'.repeat(80), 'Untitled')).toHaveLength(48);
  });
});

describe('resultSummary', () => {
  it('reads the summary and tolerates anything else', () => {
    expect(resultSummary('{"summary":"Done"}')).toBe('Done');
    expect(resultSummary('{"summary":3}')).toBeNull();
    expect(resultSummary('not json')).toBeNull();
    expect(resultSummary(null)).toBeNull();
  });
});
