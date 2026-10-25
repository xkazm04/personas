// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  matchesQuery,
  reviewKeyEffect,
  splitHighlight,
  tokenizeQuery,
} from '../deskModel';

describe('fuzzy query', () => {
  it('matches an empty query against everything', () => {
    expect(matchesQuery('', 'Ship the dock', 'body')).toBe(true);
    expect(tokenizeQuery('   ')).toEqual([]);
  });

  it('requires every token (AND) across title and body, case-insensitive', () => {
    expect(matchesQuery('ship dock', 'Ship the dock', 'notes')).toBe(true);
    expect(matchesQuery('SHIP', 'Ship the dock', '')).toBe(true);
    expect(matchesQuery('athena', 'Draft', 'Ask Athena about scope')).toBe(true);
    expect(matchesQuery('ship athena', 'Ship the dock', 'notes')).toBe(false);
  });

  it('splits a title around the first query token', () => {
    expect(splitHighlight('Ship the dock', 'dock')).toEqual({
      pre: 'Ship the ',
      hit: 'dock',
      post: '',
    });
    expect(splitHighlight('Ship the dock', 'gone')).toBeNull();
    expect(splitHighlight('Ship the dock', '')).toBeNull();
  });
});

describe('reviewKeyEffect — the bubble first, the thread otherwise', () => {
  const none = { up: false, pendingReview: false, refKind: null };
  const comment = { up: true, pendingReview: false, refKind: null };
  const runReview = { up: true, pendingReview: true, refKind: 'run' };
  const cardReview = { up: true, pendingReview: true, refKind: 'suggestion_card' };

  it('r focuses the bubble Comment field when a bubble is up, else the thread composer', () => {
    expect(reviewKeyEffect('reply', comment)).toBe('bubbleComment');
    expect(reviewKeyEffect('reply', runReview)).toBe('bubbleComment');
    expect(reviewKeyEffect('reply', none)).toBe('threadReply');
  });

  it('y approves a pending review on the bubble, else opens the thread', () => {
    expect(reviewKeyEffect('approve', runReview)).toBe('approve');
    expect(reviewKeyEffect('approve', cardReview)).toBe('approve');
    expect(reviewKeyEffect('approve', comment)).toBe('thread');
    expect(reviewKeyEffect('approve', none)).toBe('thread');
  });

  it('n asks for the reason on a run review, rejects a suggestion card in one tap', () => {
    expect(reviewKeyEffect('reject', runReview)).toBe('rejectReason');
    expect(reviewKeyEffect('reject', cardReview)).toBe('rejectNow');
    expect(reviewKeyEffect('reject', comment)).toBe('thread');
    expect(reviewKeyEffect('reject', none)).toBe('thread');
    // A pending review whose bubble is NOT up (the thread swallowed it) goes to the thread.
    expect(reviewKeyEffect('reject', { ...runReview, up: false })).toBe('thread');
  });
});
