import { describe, expect, it } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';

import { CARD_TEXT_LIMIT, canQuickWrite, resultSummary, titleFromText } from '../noteText';

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

  it('measures the STORED markdown, so formatting markers count toward the limit', () => {
    // 101 raw characters that render as 97: the card still hands this to the editor.
    const body = `**${'a'.repeat(97)}**`;
    expect(body.length).toBe(CARD_TEXT_LIMIT + 1);
    expect(canQuickWrite(note({ bodyMd: body }))).toBe(false);
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
