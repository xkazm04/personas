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

export function member(
  f: ShipFeature,
  bucket: ScopeBucket = 'core',
  afterCut = false,
  annotations: { description?: string | null; rating?: number | null } = {},
): ShipMember {
  return {
    feature: f,
    bucket,
    afterCut,
    description: annotations.description ?? null,
    // Default is UNRATED, not 0 — the same distinction the schema makes.
    rating: annotations.rating ?? null,
  };
}

export function goal(id: string, name: string, slice: ShipContext[] = []): ShipGoal {
  return {
    id,
    name,
    description: null,
    status: 'active',
    contexts: slice.map((c) => c.name),
    contextIds: slice.map((c) => c.id),
  };
}

export function milestone(over: Partial<DevMilestone> = {}): DevMilestone {
  return {
    id: 'm1',
    projectId: 'p1',
    name: 'v1',
    goal: null,
    description: null,
    status: 'active',
    orderIndex: 0,
    targetDate: null,
    cutAt: '2026-01-01T00:00:00Z',
    shippedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}
