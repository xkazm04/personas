/**
 * Tests for `isMessageOutput` — the classifier that splits PersonaMessages
 * into "output" vs "message" buckets for the unified inbox.
 *
 * Precedence:
 *   explicit `content_type === 'output'`  (backend signal — runner.rs)
 *   → legacy `content_type === 'result'`  (transitional)
 *   → `content_type === 'markdown'`       (artifact heuristic)
 *   → keyword fallback on title + first 80 chars of content.
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

describe('isMessageOutput', () => {
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

  it('still classifies markdown as output', () => {
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

  it('keyword fallback still fires for text content_type when title contains a keyword', () => {
    const msg = makeMsg({
      content_type: 'text',
      title: 'Weekly draft ready',
      content: 'attached',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it('explicit output signal wins even when keywords would otherwise miss', () => {
    const msg = makeMsg({
      content_type: 'output',
      title: 'Status update',
      content: 'Routine run completed with no notable events to flag for review.',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });

  it("keyword fallback matches on content's first 80 chars, not the full body", () => {
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
    const msg = makeMsg({
      content_type: 'result',
      title: 'Hello from Slack',
      content: 'nothing output-shaped here',
    });
    expect(isMessageOutput(msg)).toBe(true);
  });
});
