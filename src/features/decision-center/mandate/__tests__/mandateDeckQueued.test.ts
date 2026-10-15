/**
 * A verdict on a MIRRORED mandate whose home device is offline is queued
 * there, not failed (residue item 6): `useMandateDeck.write` resolves with
 * the home's name, the card stays out of the deck, and only a mandate that
 * lives here (no mirror) or another failure still rejects. The drawer reads
 * the same door the same way (`useMandateDoors`, `mirrorMark.test.tsx`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { MandateSummary } from '@/lib/bindings/MandateSummary';

const signMandate = vi.fn();
const dropMandate = vi.fn();
vi.mock('@/api/mandates', () => ({
  signMandate: (...a: unknown[]) => signMandate(...a),
  dropMandate: (...a: unknown[]) => dropMandate(...a),
  keepMandate: vi.fn(),
  amendMandate: vi.fn(),
  suspendMandate: vi.fn(),
}));

let mandates: MandateSummary[] = [];
vi.mock('@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates', () => ({
  useMandates: () => ({ mandates, failed: false, refresh: vi.fn() }),
}));
vi.mock('../../lanes/lanesSnapshotSource', () => ({ refreshLanesSnapshot: vi.fn(() => Promise.resolve()) }));

import { useMandateDeck } from '../useMandateDeck';

function draft(charterId: string, mirror: MandateSummary['mirror']): MandateSummary {
  // A fixture: only the fields the deck reads matter here.
  return {
    charterId, title: 'Benchmark the new routers', projectId: 'dp-research', projectName: 'research',
    stewardPersonaId: 'st-1', stewardName: 'App Master', status: 'draft', scopeRung: 2, source: 'app_master',
    updatedAt: '2026-10-15T10:00:00Z',
    envelope: { decideScopes: [], mergePolicy: 'never', budgetMonthlyUsd: 40, envelopeVersion: 0, keptAtActs: null },
    load: { spendUsedUsd: null, budgetUsd: 40, actsCount: 0, openAsks: 0 },
    reread: null, origin: null, mirror,
  } as unknown as MandateSummary;
}

const MIRROR = { homePeerId: 'peer-desk', homeName: 'Desk', mirroredAt: '2026-10-15T09:00:00Z' } as MandateSummary['mirror'];
const ENVELOPE = { decideScopes: [], mergePolicy: 'never', budgetMonthlyUsd: 40 } as never;

beforeEach(() => {
  signMandate.mockReset();
  dropMandate.mockReset();
});

describe('useMandateDeck: a verdict on a mirrored mandate', () => {
  it('waits for an offline home: resolves queued with the home name and keeps the card out', async () => {
    mandates = [draft('ch-1', MIRROR)];
    signMandate.mockRejectedValue({ error: 'Sent home to "Desk".', kind: 'network_offline' });
    const { result } = renderHook(() => useMandateDeck(true, null));
    const card = result.current.items[0]!;

    let written: Awaited<ReturnType<typeof result.current.write>> | undefined;
    await act(async () => { written = await result.current.write({ item: card, verdict: 'accept', envelope: ENVELOPE }); });

    expect(written).toEqual({ wrote: true, queuedOn: 'Desk' });
    expect(result.current.items).toHaveLength(0);
  });

  it('still fails a mandate that lives here, and brings its card back', async () => {
    mandates = [draft('ch-2', null)];
    dropMandate.mockRejectedValue({ error: 'offline', kind: 'network_offline' });
    const { result } = renderHook(() => useMandateDeck(true, null));
    const card = result.current.items[0]!;

    await act(async () => {
      await expect(result.current.write({ item: card, verdict: 'reject', reason: 'not now' })).rejects.toMatchObject({ kind: 'network_offline' });
    });
    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
  });

  it('still fails a mirrored mandate the home refused', async () => {
    mandates = [draft('ch-3', MIRROR)];
    signMandate.mockRejectedValue({ error: 'The mandate moved.', kind: 'validation' });
    const { result } = renderHook(() => useMandateDeck(true, null));
    const card = result.current.items[0]!;

    await act(async () => {
      await expect(result.current.write({ item: card, verdict: 'accept', envelope: ENVELOPE })).rejects.toMatchObject({ kind: 'validation' });
    });
  });
});
