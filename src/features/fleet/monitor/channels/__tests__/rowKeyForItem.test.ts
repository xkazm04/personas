/**
 * A live pop-up knows the ITEM it is showing; the conversation is addressed by
 * ROW. Those are not the same vocabulary — clustering folds a whole assignment
 * or deliberation into one card, so the item's own id appears nowhere in that
 * row's key — and a deep link that assumed they were would pin nothing on
 * exactly the rows most worth landing on (a held step, a deliberation turn).
 */
import { describe, it, expect } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { buildConversation, rowKeyForItem, type ConversationRow } from '../conversationModel';

const item = (id: string, over: Partial<TeamChannelItem> = {}): TeamChannelItem =>
  ({
    id,
    at: '2026-09-17T10:00:00Z',
    kind: 'persona',
    personaId: 'p1',
    assignmentId: null,
    deliberationId: null,
    ...over,
  } as unknown as TeamChannelItem);

describe('rowKeyForItem', () => {
  it('addresses a plain talk line by its own row', () => {
    const rows = buildConversation([item('m1')]);
    expect(rowKeyForItem(rows, 'm1')).toBe('talk:m1');
  });

  it('addresses a clustered item by the CARD that holds it, not by itself', () => {
    const rows: ConversationRow[] = [
      { kind: 'assignment', key: 'asg:a1:m2', at: '', assignmentId: 'a1', items: [item('m2'), item('m3')] },
    ];
    // m3 is inside the cluster; its own id is nowhere in the key.
    expect(rowKeyForItem(rows, 'm3')).toBe('asg:a1:m2');
  });

  it('addresses a deliberation turn by its cluster too', () => {
    const rows: ConversationRow[] = [
      { kind: 'deliberation', key: 'delib:d1:m4', at: '', deliberationId: 'd1', items: [item('m4'), item('m5')] },
    ];
    expect(rowKeyForItem(rows, 'm5')).toBe('delib:d1:m4');
  });

  it('returns null for an item outside the paged window', () => {
    // A link into history that has not loaded is a reason to pin NOTHING —
    // pinning an approximate row would pose the reader at the wrong message
    // and tell them it was the right one.
    expect(rowKeyForItem(buildConversation([item('m1')]), 'not-loaded')).toBeNull();
  });

  it('never matches a day divider or a queued prompt', () => {
    const rows: ConversationRow[] = [
      { kind: 'day', key: 'day:2026-09-17', at: '2026-09-17T10:00:00Z' },
      { kind: 'queued', key: 'queued:q1', at: '', prompt: { id: 'q1' } as never },
    ];
    expect(rowKeyForItem(rows, 'q1')).toBeNull();
    expect(rowKeyForItem(rows, 'day:2026-09-17')).toBeNull();
  });
});
