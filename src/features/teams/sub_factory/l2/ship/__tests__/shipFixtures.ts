// Shared fixtures for the Ship layer's pure-derivation tests. Deliberately
// plain object literals: these pin the SHAPE the live adapter produces, so a
// refactor that changes the shape fails here first.
import type { Translations } from '@/i18n/generated/types';
import { en } from '@/i18n/en';
import { interpolate } from '@/i18n/useTranslation';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import type { ContextTone, ScopeBucket, ShipContext, ShipFeature, ShipGoal, ShipMember } from '../shipModel';

export const T = en as unknown as Translations;
export const TX = interpolate;

export function ctx(id: string, name: string, tone: ContextTone, kpis = 1, errors: number | null = 0): ShipContext {
  return { id, name, tone, groupId: null, files: [], kpis, errors };
}

export function feature(id: string, name: string, slice: ShipContext[], ready = true): ShipFeature {
  return {
    id,
    name,
    contexts: slice.map((c) => c.name),
    contextIds: slice.map((c) => c.id),
    kpiCount: ready ? 1 : 0,
    ready,
    stateLabel: ready ? 'Ready' : 'No KPI yet',
    stateHue: '#000',
    blocker: null,
  };
}

export function member(f: ShipFeature, bucket: ScopeBucket = 'core', afterCut = false): ShipMember {
  return { feature: f, bucket, afterCut };
}

export function goal(id: string, name: string): ShipGoal {
  return { id, name, description: null, status: 'active', contexts: [] };
}

export function milestone(over: Partial<DevMilestone> = {}): DevMilestone {
  return {
    id: 'm1',
    project_id: 'p1',
    name: 'v1',
    goal: null,
    status: 'active',
    order_index: 0,
    target_date: null,
    cut_at: '2026-01-01T00:00:00Z',
    shipped_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}
