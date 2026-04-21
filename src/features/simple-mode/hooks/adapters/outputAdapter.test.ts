/**
 * Tests for `isMessageOutput` — the classifier that splits PersonaMessages
 * into "output" vs "message" buckets for Simple-mode's unified inbox.
 *
 * Phase 17 locks the precedence:
 *   explicit `content_type === 'output'`  (backend signal — runner.rs)
 *   → legacy `content_type === 'result'`  (transitional, kept for migration)
 *   → `content_type === 'markdown'`       (Phase 16 artifact heuristic)
 *   → keyword fallback on title + first 80 chars of content.
 *
 * The explicit signals short-circuit before the keyword scan so an output
 * flagged by the backend is NEVER missed because its title didn't contain a
 * listed keyword. Conversely, the keyword scan still catches messages emitted
 * by code paths that don't set a specific content_type (e.g. fixtures, legacy
 * text rows, future emitters).
 */
import { describe, it, expect } from 'vitest';

import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import { isMessageOutput } from './outputAdapter';

function makeMsg(overrides: Partial<PersonaMessage> = {}): PersonaMessage {
  return {
    id: 'msg-1',
    persona_id: 'p-1',
    execution_id: null,
    title: null,
    content: 'hi there',
    content_type: 'text',
    priority: 'normal',
    is_read: false,
    metadata: null,
    created_at: '2026-04-20T00:00:00Z',
    read_at: null,
    thread_id: null,
    use_case_id: null,
    ...overrides,
  };
}

describe("isMessageOutput (Phase 17)", () => {
  it("classifies content_type='output' as output regardless of content/title", () => {
    const msg = makeMsg({
      content_type: 'output',
      title: 'anything',
      content: 'no keywords at all, just prose',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it("classifies legacy content_type='result' as output (transitional)", () => {
    const msg = makeMsg({
      content_type: 'result',
      title: null,
      content: 'no keywords here',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it('still classifies markdown as output (Phase 16 compat)', () => {
    const msg = makeMsg({
      content_type: 'markdown',
      title: null,
      content: '# no keywords needed',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it("plain 'text' without keywords stays false", () => {
    const msg = makeMsg({
      content_type: 'text',
      title: null,
      content: 'hi there',
    });
    expect(isMessageOutput(msg)).toBe(false);
  });

  it("keyword fallback still fires for text content_type when title contains a keyword", () => {
    const msg = makeMsg({
      content_type: 'text',
      title: 'Weekly draft ready',
      content: 'attached',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it('explicit output signal wins even when keywords would otherwise miss', () => {
    // Regression: before Phase 17, this would have missed (no keyword in title
    // or first 80 chars, content_type 'text'). The explicit backend signal
    // short-circuits before the keyword scan runs.
    const msg = makeMsg({
      content_type: 'output',
      title: 'Status update',
      content: 'Routine run completed with no notable events to flag for review.',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it("keyword fallback matches on content's first 80 chars, not the full body", () => {
    // Ensure the heuristic still works when content is long but the keyword
    // appears within the first 80 chars.
    const head = 'This is a draft of the weekly summary to review before Monday.';
    const tail = ' '.repeat(200) + 'irrelevant trailing text';
    const msg = makeMsg({
      content_type: 'text',
      title: null,
      content: head + tail,
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it('keyword beyond the first 80 chars is ignored when no explicit signal is set', () => {
    // Keyword appears past the 80-char cutoff AND not in the title; with
    // content_type='text' and no title match, this must stay false.
    const head = 'a'.repeat(100);
    const msg = makeMsg({
      content_type: 'text',
      title: null,
      content: `${head} draft`,
    });
    expect(isMessageOutput(msg)).toBe(false);
  });

  it("empty title + empty content with explicit 'output' still returns true", () => {
    const msg = makeMsg({
      content_type: 'output',
      title: null,
      content: '',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it("'result' signal wins over a keyword-matching title from a different semantic domain", () => {
    // Defensive check: the classifier does not require agreement between the
    // explicit signal and the heuristic — the signal alone is sufficient.
    const msg = makeMsg({
      content_type: 'result',
      title: 'Hello from Slack',
      content: 'nothing output-shaped here',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });
});
