import { describe, expect, it } from 'vitest';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';
import { countHeld, previewRows } from '../useDispatchPreview';

function row(id: string, position: number, verdict: DispatchPreviewRow['verdict'] = { kind: 'idle' }): DispatchPreviewRow {
  return {
    personaId: id,
    personaName: id.toUpperCase(),
    personaIcon: null,
    personaColor: null,
    position,
    rank: null,
    enabled: true,
    wakePending: false,
    lastServedAt: null,
    intervalMinutes: 30,
    selfPaced: false,
    appMaster: false,
    charters: 1,
    verdict,
    lane: null,
  };
}

describe('previewRows — the ledger shows the loop\'s walk order, untouched', () => {
  const rows = [row('c', 1), row('a', 2), row('b', 3)];
  // Only the rows are read; the rest of the view is irrelevant to row derivation.
  const view = { preview: { rows } } as unknown as DispatchPreviewView;

  it('keeps the server order (no local reordering survives the read-only ledger)', () => {
    expect(previewRows(view).map((r) => r.personaId)).toEqual(['c', 'a', 'b']);
  });

  it('is empty before the first read lands', () => {
    expect(previewRows(null)).toEqual([]);
  });
});

describe('countHeld — the fourth counter', () => {
  it('counts only the refused rows', () => {
    const rows = [
      row('a', 1, { kind: 'dispatch', slot: 1 }),
      row('b', 2, { kind: 'refused', refusal: 'quiet_hours', reason: 'Quiet hours until 08:00' }),
      row('c', 3, { kind: 'waits_for_slot' }),
      row('d', 4, { kind: 'refused', refusal: 'interval_floor', reason: 'Served 4 minutes ago' }),
      row('e', 5, { kind: 'disabled' }),
    ];
    expect(countHeld(rows)).toBe(2);
  });
});
