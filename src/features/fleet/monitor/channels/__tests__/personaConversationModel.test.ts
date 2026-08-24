import { describe, expect, it } from 'vitest';
import {
  buildPersonaConversation,
  parseItemExtra,
  reviewStatusOf,
} from '../personaConversationModel';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';

function item(
  id: string,
  at: string,
  kind = 'chat',
  authorKind = 'persona',
  patch: Partial<PersonaChannelItem> = {},
): PersonaChannelItem {
  return {
    id,
    kind,
    at,
    authorKind,
    title: null,
    body: null,
    reportId: null,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: null,
    ...patch,
  };
}

describe('buildPersonaConversation', () => {
  it('orders oldest-first with day separators, from a newest-first page', () => {
    const rows = buildPersonaConversation([
      item('pch-b', '2026-08-24T10:00:00Z'),
      item('prep-a', '2026-08-23T09:00:00Z', 'report'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'item', 'day', 'item']);
    expect(rows.map((r) => r.key)).toEqual([
      'day:2026-08-23',
      'item:prep-a',
      'day:2026-08-24',
      'item:pch-b',
    ]);
  });

  it('overlays echoes not yet in items, and drops one the server confirmed', () => {
    const confirmed = item('pch-x', '2026-08-24T10:00:00Z', 'chat', 'user');
    const echoX = item('pch-x', '2026-08-24T09:59:59Z', 'chat', 'user', { extra: '{"pending":true}' });
    const echoY = item('pch-y', '2026-08-24T10:00:01Z', 'chat', 'user', { extra: '{"pending":true}' });

    const rows = buildPersonaConversation([confirmed], [echoY, echoX]);
    const items = rows.filter((r) => r.kind === 'item');
    // pch-x appears ONCE (the server row), pch-y rides as the echo.
    expect(items.map((r) => (r.kind === 'item' ? r.item.id : ''))).toEqual(['pch-x', 'pch-y']);
    expect(items[0]!.kind === 'item' && items[0]!.item.extra).toBeNull();
  });

  it('appends a working row while the newest chat turn is an unanswered user turn', () => {
    const rows = buildPersonaConversation([
      // A system row AFTER the user's turn must not clear the indicator.
      item('pev-e', '2026-08-24T10:00:05Z', 'event'),
      item('pch-u', '2026-08-24T10:00:00Z', 'chat', 'user'),
      item('pch-p', '2026-08-24T09:00:00Z', 'chat', 'persona'),
    ]);
    expect(rows[rows.length - 1]!.kind).toBe('working');
  });

  it('shows no working row after the persona replied, or when the user turn failed', () => {
    const answered = buildPersonaConversation([
      item('pch-p', '2026-08-24T10:01:00Z', 'chat', 'persona'),
      item('pch-u', '2026-08-24T10:00:00Z', 'chat', 'user'),
    ]);
    expect(answered.some((r) => r.kind === 'working')).toBe(false);

    const failed = buildPersonaConversation([
      item('pch-u', '2026-08-24T10:00:00Z', 'chat', 'user', { extra: '{"failed":true}' }),
    ]);
    expect(failed.some((r) => r.kind === 'working')).toBe(false);
  });
});

describe('extra parsing', () => {
  it('parseItemExtra never throws and reviewStatusOf defaults to pending', () => {
    expect(parseItemExtra(item('a', 'x', 'chat', 'user', { extra: 'not-json' }))).toEqual({});
    expect(reviewStatusOf(item('a', 'x', 'review'))).toBe('pending');
    expect(
      reviewStatusOf(item('a', 'x', 'review', 'persona', { extra: '{"status":"approved"}' })),
    ).toBe('approved');
  });
});
