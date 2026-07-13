import { describe, it, expect } from 'vitest';

import type { Persona } from '@/lib/bindings/Persona';
import type { MetricsSummary } from '@/lib/bindings/MetricsSummary';

import { composeDefaultCockpit, type DefaultCockpitLabels } from './defaultCockpit';

const LABELS: DefaultCockpitLabels = {
  title: 'Starter cockpit',
  callout: { title: 'Starter cockpit', body: 'body' },
  vitalsTitle: 'Fleet vitals',
  rosterTitle: 'Your personas',
  attentionTitle: 'Needs attention',
  attentionEmpty: 'All healthy',
  stat: {
    activePersonas: 'Active personas',
    successRate: 'Success rate',
    executions: 'Executions',
    needsAttention: 'Needs attention',
  },
  attentionReason: {
    setup: 'Setup required',
    disabled: 'Paused',
    low_trust: 'Low trust',
  },
};

function persona(over: Partial<Persona>): Persona {
  return {
    id: 'p1',
    name: 'Persona',
    enabled: true,
    trust_score: 0.9,
    trust_level: 'verified',
    setup_status: 'ready',
    updated_at: '2026-07-10T00:00:00Z',
    model_profile: 'claude-sonnet-4-6',
    max_budget_usd: 1,
    max_turns: 10,
    description: null,
    icon: null,
    ...over,
  } as unknown as Persona;
}

const METRICS: MetricsSummary = {
  totalExecutions: 20,
  successfulExecutions: 18,
  failedExecutions: 2,
  totalCostUsd: 1.23,
  activePersonas: 3,
  periodDays: 7,
};

describe('composeDefaultCockpit', () => {
  it('produces the 4 expected widget kinds in order', () => {
    const spec = composeDefaultCockpit([persona({})], METRICS, LABELS);
    expect(spec.widgets.map((w) => w.kind)).toEqual([
      'text_callout',
      'stat_grid',
      'persona_overview',
      'issue_list',
    ]);
    expect(spec.title).toBe('Starter cockpit');
  });

  it('uses only registered widget kinds with stable ids', () => {
    const spec = composeDefaultCockpit([persona({})], METRICS, LABELS);
    expect(spec.widgets.map((w) => w.id)).toEqual([
      'default-callout',
      'default-vitals',
      'default-roster',
      'default-attention',
    ]);
  });

  it('counts active (enabled) personas', () => {
    const personas = [
      persona({ id: 'a', enabled: true }),
      persona({ id: 'b', enabled: false }),
      persona({ id: 'c', enabled: true }),
    ];
    const spec = composeDefaultCockpit(personas, METRICS, LABELS);
    const vitals = spec.widgets.find((w) => w.id === 'default-vitals');
    const stats = (vitals?.config?.stats as Array<{ label: string; value: unknown }>);
    expect(stats[0]!.value).toBe(2); // a + c enabled; b paused
  });

  it('computes success-rate stat with a good intent for a healthy fleet', () => {
    const spec = composeDefaultCockpit([persona({})], METRICS, LABELS);
    const stats = spec.widgets.find((w) => w.id === 'default-vitals')!.config!
      .stats as Array<{ label: string; value: unknown; intent?: string; unit?: string }>;
    // 18 / (18+2) = 90%
    expect(stats[1]!.value).toBe(90);
    expect(stats[1]!.unit).toBe('%');
    expect(stats[1]!.intent).toBe('good');
  });

  it('renders a neutral success rate when there are no terminal executions', () => {
    const spec = composeDefaultCockpit([persona({})], null, LABELS);
    const stats = spec.widgets.find((w) => w.id === 'default-vitals')!.config!
      .stats as Array<{ value: unknown; intent?: string; unit?: string }>;
    expect(stats[1]!.value).toBe('—');
    expect(stats[1]!.unit).toBeUndefined();
    expect(stats[1]!.intent).toBe('default');
  });

  it('surfaces personas needing attention with localized reasons + severity', () => {
    const personas = [
      persona({ id: 'healthy' }),
      persona({ id: 'needs', setup_status: 'needs_credentials' }),
      persona({ id: 'paused', enabled: false }),
      persona({ id: 'lowtrust', trust_score: 0.3 }),
    ];
    const spec = composeDefaultCockpit(personas, METRICS, LABELS);
    const attention = spec.widgets.find((w) => w.id === 'default-attention')!.config!
      .items as Array<{ id: string; sublabel: string; severity: string }>;
    expect(attention.map((i) => i.id).sort()).toEqual(['lowtrust', 'needs', 'paused']);
    const low = attention.find((i) => i.id === 'lowtrust')!;
    expect(low.sublabel).toBe('Low trust');
    expect(low.severity).toBe('bad');
    const needs = attention.find((i) => i.id === 'needs')!;
    expect(needs.severity).toBe('warn');

    // needs-attention vitals stat matches the item count + warns.
    const stats = spec.widgets.find((w) => w.id === 'default-vitals')!.config!
      .stats as Array<{ value: unknown; intent?: string }>;
    expect(stats[3]!.value).toBe(3);
    expect(stats[3]!.intent).toBe('warn');
  });

  it('caps attention items at 6', () => {
    const personas = Array.from({ length: 10 }, (_, i) =>
      persona({ id: `p${i}`, enabled: false }),
    );
    const spec = composeDefaultCockpit(personas, METRICS, LABELS);
    const items = spec.widgets.find((w) => w.id === 'default-attention')!.config!
      .items as unknown[];
    expect(items).toHaveLength(6);
  });

  it('reports a healthy fleet with a good needs-attention intent + empty list', () => {
    const spec = composeDefaultCockpit([persona({}), persona({ id: 'p2' })], METRICS, LABELS);
    const stats = spec.widgets.find((w) => w.id === 'default-vitals')!.config!
      .stats as Array<{ value: unknown; intent?: string }>;
    expect(stats[3]!.value).toBe(0);
    expect(stats[3]!.intent).toBe('good');
    const items = spec.widgets.find((w) => w.id === 'default-attention')!.config!
      .items as unknown[];
    expect(items).toHaveLength(0);
  });
});
