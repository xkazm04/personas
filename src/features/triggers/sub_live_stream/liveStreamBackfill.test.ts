import { describe, it, expect } from 'vitest';
import { mergeBackfillIntoLiveBuffer } from './LiveStreamTab';
import type { PersonaEvent } from '@/lib/types/types';

function makeEvent(id: string, overrides: Partial<PersonaEvent> = {}): PersonaEvent {
  return {
    id,
    project_id: 'proj-1',
    event_type: 'test.event',
    source_type: 'test',
    source_id: null,
    target_persona_id: null,
    payload: null,
    status: 'completed',
    error_message: null,
    processed_at: null,
    created_at: '2026-05-05T00:00:00Z',
    use_case_id: null,
    retry_count: 0,
    ...overrides,
  };
}

describe('LiveStreamTab mount backfill', () => {
  it('keeps an event pushed while the backfill request was in flight', () => {
    // The listener is attached before listEvents(100) resolves, so this row is
    // already in the buffer when the snapshot lands. The wholesale
    // `setEvents(recentEvents)` this replaces dropped it.
    const live = [makeEvent('live-during-flight')];
    const backfill = [makeEvent('snap-1'), makeEvent('snap-2')];

    const merged = mergeBackfillIntoLiveBuffer(live, backfill);

    expect(merged.map((e) => e.id)).toEqual(['live-during-flight', 'snap-1', 'snap-2']);
  });

  it('prefers the live copy of an id the snapshot also carries', () => {
    const live = [makeEvent('evt-x', { status: 'completed' })];
    const backfill = [makeEvent('evt-x', { status: 'pending' })];

    const merged = mergeBackfillIntoLiveBuffer(live, backfill);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('completed');
  });

  it('takes the snapshot as-is on a cold mount', () => {
    const backfill = [makeEvent('snap-1'), makeEvent('snap-2')];
    expect(mergeBackfillIntoLiveBuffer([], backfill)).toBe(backfill);
  });

  it('respects the buffer cap', () => {
    const live = Array.from({ length: 150 }, (_, i) => makeEvent(`live-${i}`));
    const backfill = Array.from({ length: 100 }, (_, i) => makeEvent(`snap-${i}`));
    const merged = mergeBackfillIntoLiveBuffer(live, backfill);
    expect(merged).toHaveLength(200);
    expect(merged[0]!.id).toBe('live-0');
  });
});
