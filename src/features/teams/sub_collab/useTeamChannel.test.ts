import { describe, expect, it } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { PRESENCE_WORK_WINDOW_MS, derivePresence, deriveLastSeen } from './useTeamChannel';

/* Pure-model tests for the presence/heartbeat derivations. The hook wrappers
 * are thin store reads; the logic worth pinning is here. */

const NOW = Date.parse('2026-07-28T12:00:00Z');

function item(over: Partial<TeamChannelItem>): TeamChannelItem {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    kind: 'step',
    at: '2026-07-28T11:59:00Z',
    personaId: 'p1',
    label: 'step_running',
    body: null,
    assignmentId: null,
    stepId: 's1',
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
    ...over,
  };
}

describe('derivePresence', () => {
  it('marks a persona working on a fresh step_running row', () => {
    const p = derivePresence([item({ at: '2026-07-28T11:59:00Z' })], NOW);
    expect(p.get('p1')).toBe('working');
  });

  it('does NOT mark working when the step_running row is older than the work window', () => {
    // The channel cache holds history — a dead run's last row is step_running
    // forever. 11 minutes old must not light the roster.
    const p = derivePresence([item({ at: '2026-07-28T11:49:00Z' })], NOW);
    expect(p.has('p1')).toBe(false);
  });

  it('treats the window boundary as inclusive', () => {
    const at = new Date(NOW - PRESENCE_WORK_WINDOW_MS).toISOString();
    const p = derivePresence([item({ at })], NOW);
    expect(p.get('p1')).toBe('working');
  });

  it('keeps WAITING unbounded — review gates legitimately hold for hours', () => {
    const p = derivePresence(
      [item({ label: 'status_awaiting_review', at: '2026-07-27T09:00:00Z' })],
      NOW,
    );
    expect(p.get('p1')).toBe('waiting');
  });

  it('uses only the newest row per step (items are newest-first)', () => {
    const p = derivePresence(
      [
        item({ id: 'a', label: 'step_done', at: '2026-07-28T11:59:30Z' }),
        item({ id: 'b', label: 'step_running', at: '2026-07-28T11:58:00Z' }),
      ],
      NOW,
    );
    expect(p.has('p1')).toBe(false);
  });

  it('working wins over waiting for the same persona across steps', () => {
    const p = derivePresence(
      [
        item({ id: 'a', stepId: 's1', label: 'step_running', at: '2026-07-28T11:59:00Z' }),
        item({ id: 'b', stepId: 's2', label: 'status_awaiting_review', at: '2026-07-28T11:58:00Z' }),
      ],
      NOW,
    );
    expect(p.get('p1')).toBe('working');
  });
});

describe('deriveLastSeen', () => {
  it('takes the max timestamp per persona across every row kind', () => {
    const seen = deriveLastSeen([
      item({ id: 'a', kind: 'message', personaId: 'p1', at: '2026-07-28T11:00:00Z', stepId: null }),
      item({ id: 'b', kind: 'step', personaId: 'p1', at: '2026-07-28T11:30:00Z' }),
      item({ id: 'c', kind: 'memory', personaId: 'p2', at: '2026-07-28T10:00:00Z', stepId: null }),
    ]);
    expect(seen.get('p1')).toBe(Date.parse('2026-07-28T11:30:00Z'));
    expect(seen.get('p2')).toBe(Date.parse('2026-07-28T10:00:00Z'));
  });

  it('ignores rows with no persona (system/directive rows)', () => {
    const seen = deriveLastSeen([item({ personaId: null })]);
    expect(seen.size).toBe(0);
  });
});
