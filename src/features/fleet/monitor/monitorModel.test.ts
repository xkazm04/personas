import { describe, it, expect } from 'vitest';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import {
  buildMonitorModel,
  pillarStateKey,
  pillarVisual,
  captionDescriptor,
  primaryDrawerSection,
  healthTone,
  healthSegments,
  summarizeFleet,
  type PersonaCardModel,
} from './monitorModel';

// --- fixtures ---------------------------------------------------------------

function mkPersona(id: string, name: string): Persona {
  return { id, name, icon: null, color: null, home_team_id: null } as unknown as Persona;
}

function mkHealth(o: Partial<{
  recentStatuses: string[]; successRate: number; runsToday: number; totalRecent: number;
}>): PersonaHealth {
  return {
    status: 'healthy',
    recentStatuses: o.recentStatuses ?? [],
    successRate: o.successRate ?? 1,
    totalRecent: BigInt(o.totalRecent ?? (o.recentStatuses?.length ?? 0)),
    runsToday: BigInt(o.runsToday ?? 0),
    sparkline: [],
  } as PersonaHealth;
}

function mkProc(o: Partial<ActiveProcess>): ActiveProcess {
  return {
    domain: 'execution',
    startedAt: 1000,
    status: 'running',
    toolCallCount: 0,
    costUsd: 0,
    ...o,
  } as ActiveProcess;
}

function mkReview(personaId: string, severity: string): ManualReviewItem {
  return { id: `r-${Math.round(severity.length * 7)}-${personaId}`, persona_id: personaId, severity } as unknown as ManualReviewItem;
}

function mkMessage(personaId: string, id: string): PersonaMessage {
  return { id, persona_id: personaId } as unknown as PersonaMessage;
}

/** A full PersonaCardModel with sensible defaults, for the pure resolvers. */
function baseCard(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'P', personaIcon: null, personaColor: null,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    messages: [], processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

const find = (m: { cards: PersonaCardModel[] }, id: string) =>
  m.cards.find((c) => c.personaId === id)!;

// --- buildMonitorModel: process attribution ---------------------------------

describe('buildMonitorModel — attribution', () => {
  const personas = [mkPersona('a', 'Alpha'), mkPersona('b', 'Bravo')];

  it('attributes a process by personaId', () => {
    const m = buildMonitorModel(personas, [], [], { k: mkProc({ personaId: 'a' }) }, {});
    expect(find(m, 'a').running).toBe(1);
    expect(m.systemProcesses).toHaveLength(0);
  });

  it('attributes by navigateTo.personaId when personaId is absent', () => {
    const m = buildMonitorModel(personas, [], [], { k: mkProc({ navigateTo: { section: 'personas', personaId: 'b' } }) }, {});
    expect(find(m, 'b').running).toBe(1);
  });

  it('attributes by exact label === persona.name fallback', () => {
    const m = buildMonitorModel(personas, [], [], { k: mkProc({ label: 'Alpha' }) }, {});
    expect(find(m, 'a').running).toBe(1);
  });

  it('routes an unattributable process to systemProcesses', () => {
    const m = buildMonitorModel(personas, [], [], { k: mkProc({ label: 'Nobody' }) }, {});
    expect(m.systemProcesses).toHaveLength(1);
    expect(find(m, 'a').running).toBe(0);
  });
});

// --- buildMonitorModel: execState derivation --------------------------------

describe('buildMonitorModel — execState', () => {
  const personas = [mkPersona('a', 'Alpha')];

  it('running beats everything', () => {
    const m = buildMonitorModel(personas, [mkReview('a', 'critical')], [], { k: mkProc({ personaId: 'a' }) }, { a: mkHealth({ recentStatuses: ['failed'] }) });
    expect(find(m, 'a').execState).toBe('running');
  });

  it('failed when last run failed and nothing running', () => {
    const m = buildMonitorModel(personas, [], [], {}, { a: mkHealth({ recentStatuses: ['failed', 'completed'] }) });
    expect(find(m, 'a').execState).toBe('failed');
  });

  it('attention when pending work but no run/failure', () => {
    const m = buildMonitorModel(personas, [mkReview('a', 'info')], [], {}, { a: mkHealth({ recentStatuses: ['completed'] }) });
    expect(find(m, 'a').execState).toBe('attention');
  });

  it('idle when nothing at all', () => {
    const m = buildMonitorModel(personas, [], [], {}, {});
    expect(find(m, 'a').execState).toBe('idle');
  });
});

// --- buildMonitorModel: enrichment ------------------------------------------

describe('buildMonitorModel — v2 enrichment', () => {
  it('passes through health fields and converts bigints', () => {
    const m = buildMonitorModel([mkPersona('a', 'Alpha')], [], [], {},
      { a: mkHealth({ recentStatuses: ['completed', 'failed'], successRate: 0.5, runsToday: 3, totalRecent: 8 }) });
    const c = find(m, 'a');
    expect(c.recentStatuses).toEqual(['completed', 'failed']);
    expect(c.successRate).toBe(0.5);
    expect(c.runsToday).toBe(3);
    expect(c.totalRecent).toBe(8);
    expect(typeof c.runsToday).toBe('number');
  });

  it('sums live cost and tool-calls across running processes only', () => {
    const m = buildMonitorModel([mkPersona('a', 'Alpha')], [], [], {
      r1: mkProc({ personaId: 'a', status: 'running', costUsd: 0.02, toolCallCount: 5 }),
      r2: mkProc({ personaId: 'a', status: 'running', costUsd: 0.03, toolCallCount: 7 }),
      q1: mkProc({ personaId: 'a', status: 'queued', costUsd: 99, toolCallCount: 99 }),
    }, {});
    const c = find(m, 'a');
    expect(c.running).toBe(2);
    expect(c.queued).toBe(1);
    expect(c.liveToolCalls).toBe(12);
    expect(c.liveCostUsd).toBeCloseTo(0.05, 6);
  });

  it('tracks the earliest running start time', () => {
    const m = buildMonitorModel([mkPersona('a', 'Alpha')], [], [], {
      r1: mkProc({ personaId: 'a', startedAt: 5000 }),
      r2: mkProc({ personaId: 'a', startedAt: 2000 }),
    }, {});
    expect(find(m, 'a').runningSince).toBe(2000);
  });
});

// --- buildMonitorModel: sort ------------------------------------------------

describe('buildMonitorModel — sort order', () => {
  it('orders failed → attention → busy → idle', () => {
    const personas = [
      mkPersona('idle', 'Idle'),
      mkPersona('busy', 'Busy'),
      mkPersona('att', 'Attn'),
      mkPersona('fail', 'Fail'),
    ];
    const m = buildMonitorModel(
      personas,
      [mkReview('att', 'warning')],
      [],
      { k: mkProc({ personaId: 'busy' }) },
      { fail: mkHealth({ recentStatuses: ['failed'] }) },
    );
    expect(m.cards.map((c) => c.personaId)).toEqual(['fail', 'att', 'busy', 'idle']);
  });
});

// --- pure resolvers ---------------------------------------------------------

describe('pillarStateKey priority', () => {
  it('running > failed > input > draft > queued > attention > idle', () => {
    expect(pillarStateKey(baseCard({ running: 1, execState: 'running' }))).toBe('running');
    expect(pillarStateKey(baseCard({ execState: 'failed' }))).toBe('failed');
    expect(pillarStateKey(baseCard({ inputRequired: 1 }))).toBe('input_required');
    expect(pillarStateKey(baseCard({ draftReady: 1 }))).toBe('draft_ready');
    expect(pillarStateKey(baseCard({ queued: 1 }))).toBe('queued');
    expect(pillarStateKey(baseCard({ attentionCount: 2 }))).toBe('attention');
    expect(pillarStateKey(baseCard())).toBe('idle');
  });

  it('input_required outranks a concurrent failed history', () => {
    expect(pillarStateKey(baseCard({ execState: 'failed', inputRequired: 1 }))).toBe('failed');
  });

  it('pillarVisual exposes the resolved key and pulses live states', () => {
    expect(pillarVisual(baseCard({ running: 1, execState: 'running' })).pulse).toBe(true);
    expect(pillarVisual(baseCard({ inputRequired: 1 })).pulse).toBe(true);
    expect(pillarVisual(baseCard({ draftReady: 1 })).pulse).toBe(false);
    expect(pillarVisual(baseCard()).key).toBe('idle');
  });
});

describe('captionDescriptor', () => {
  it('points active states at the activity drawer with the right count', () => {
    expect(captionDescriptor(baseCard({ running: 2, execState: 'running' }))).toEqual({ key: 'running', count: 2, target: 'activity' });
    expect(captionDescriptor(baseCard({ queued: 3 }))).toEqual({ key: 'queued', count: 3, target: 'activity' });
  });
  it('leaves passive states without a target', () => {
    expect(captionDescriptor(baseCard({ attentionCount: 1 })).target).toBeNull();
    expect(captionDescriptor(baseCard()).target).toBeNull();
  });
});

describe('primaryDrawerSection', () => {
  it('opens reviews when attention has reviews, messages otherwise', () => {
    expect(primaryDrawerSection(baseCard({ attentionCount: 1, reviews: [mkReview('p', 'info')] }))).toBe('reviews');
    expect(primaryDrawerSection(baseCard({ attentionCount: 1, messages: [mkMessage('p', 'm1')] }))).toBe('messages');
  });
  it('opens capabilities for idle and activity for active states', () => {
    expect(primaryDrawerSection(baseCard())).toBe('capabilities');
    expect(primaryDrawerSection(baseCard({ running: 1, execState: 'running' }))).toBe('activity');
  });
});

describe('healthTone / healthSegments', () => {
  it('maps outcome tokens to tones', () => {
    expect(healthTone('completed')).toBe('success');
    expect(healthTone('failed')).toBe('fail');
    expect(healthTone('cancelled')).toBe('other');
    expect(healthTone('weird')).toBe('other');
    expect(healthTone(undefined)).toBe('none');
  });

  it('pads to a fixed length and orders oldest→newest (left→right)', () => {
    // recentStatuses is newest-first; "completed" is newest, "failed" oldest.
    const c = baseCard({ recentStatuses: ['completed', 'failed'] });
    expect(healthSegments(c, 5)).toEqual(['none', 'none', 'none', 'fail', 'success']);
  });

  it('truncates to length when there is more history than slots', () => {
    const c = baseCard({ recentStatuses: ['completed', 'completed', 'failed', 'completed'] });
    expect(healthSegments(c, 2)).toEqual(['success', 'success']); // newest 2, reversed
  });
});

describe('summarizeFleet', () => {
  it('aggregates counts and live cost across cards', () => {
    const cards = [
      baseCard({ personaId: 'a', running: 2, liveCostUsd: 0.02, liveToolCalls: 4, execState: 'running' }),
      baseCard({ personaId: 'b', queued: 1, execState: 'attention', attentionCount: 1 }),
      baseCard({ personaId: 'c', execState: 'failed' }),
      baseCard({ personaId: 'd', execState: 'idle' }),
    ];
    const s = summarizeFleet(cards);
    expect(s.personas).toBe(4);
    expect(s.running).toBe(2);
    expect(s.queued).toBe(1);
    expect(s.attention).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.idle).toBe(1);
    expect(s.liveToolCalls).toBe(4);
    expect(s.liveCostUsd).toBeCloseTo(0.02, 6);
  });
});
