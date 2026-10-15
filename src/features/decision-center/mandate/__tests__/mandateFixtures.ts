/** Fixtures for the mandate-lane cards (mandate-lanes WP5). */
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { LaneEntry } from '@/lib/bindings/LaneEntry';
import type { MandateEnvelope } from '@/lib/bindings/MandateEnvelope';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

export function mandate(over: Partial<Omit<MandateSummary, 'envelope'>> & { envelope?: Partial<MandateEnvelope> } = {}): MandateSummary {
  const { envelope, ...rest } = over;
  return {
    charterId: 'c1',
    title: 'Keep Personas shipping',
    projectId: 'p1',
    projectName: 'Personas',
    stewardPersonaId: 'pa1',
    stewardName: 'App Master',
    status: 'active',
    scopeRung: 2,
    source: 'operator',
    envelope: {
      decideScopes: [],
      mergePolicy: 'never',
      budgetMonthlyUsd: null,
      envelopeVersion: 1,
      keptAtActs: null,
      ...envelope,
    },
    load: { spendUsedUsd: 0, budgetUsd: null, actsCount: 0, openAsks: 0 },
    updatedAt: '2026-10-14T10:00:00Z',
    reread: null,
    origin: null,
    ...rest,
  };
}

export function laneEntry(itemId: string, over: Partial<LaneEntry> = {}): LaneEntry {
  return {
    itemId,
    itemKind: itemId.split(':')[0]!,
    lane: 'breach',
    clause: 'scope',
    charterId: 'c1',
    coalesceKey: `c1:${over.lane ?? 'breach'}:${over.clause ?? 'scope'}`,
    irreversible: null,
    projectId: 'p1',
    ...over,
  };
}

export function act(id: string, over: Partial<CharterAct> = {}): CharterAct {
  return {
    id,
    charterId: 'c1',
    envelopeVersion: 1,
    itemKind: 'report',
    itemId: `report:${id}`,
    verdict: 'read',
    actor: 'router',
    scope: 'report.read',
    reversible: true,
    costUsd: null,
    shownJson: null,
    envChange: null,
    revertedAt: null,
    revertActId: null,
    originDevice: null,
    createdAt: '2026-10-14T09:00:00Z',
    ...over,
  };
}
