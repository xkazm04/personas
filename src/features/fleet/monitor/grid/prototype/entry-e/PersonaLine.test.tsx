/**
 * The persona line (WP11 V1 "Tail") on the real stores: state as a lamp plus a
 * tone edge (never a fill), and its accessible name / tooltip carrying the
 * whole sentence (reason in words, activity, next start), with the next start
 * read from the Monitor's one `list_cron_agents` slice and absent without it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { ManualReviewItem } from '@/lib/types/types';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaCardModel } from '../../../monitorModel';
import { PersonaLine } from './PersonaLine';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const review = (id: string): ManualReviewItem => ({ id, severity: 'warning', created_at: '2026-10-16T08:00:00Z' } as unknown as ManualReviewItem);

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p1', personaName: 'Leave Planner', personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    reviewCount: 0, messages: [], messageCount: 0, processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: ['completed'], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

const cron = (minutes: number): CronAgent => ({
  persona_id: 'p1', persona_name: 'Leave Planner', persona_icon: null, persona_color: null, persona_enabled: true, headless: false,
  trigger_id: 't1', cron_expression: '0 * * * *', interval_seconds: null, timezone: null, trigger_enabled: true,
  last_triggered_at: null, next_trigger_at: new Date(NOW + minutes * 60_000).toISOString(), description: '',
  recent_executions: 0n, recent_failures: 0n,
});

function line(c: PersonaCardModel) {
  const { container } = render(
    <PersonaLine card={c} selected={false} onSelect={() => undefined} flash={false} bubble={null} unseenChat={0} now={NOW} />,
  );
  return container.querySelector<HTMLElement>('[data-testid="fleet-grid-square"]')!;
}

afterEach(() => {
  cleanup();
  useOverviewStore.setState({ cronAgents: [] });
  useAgentStore.setState({ personaLastRun: {} });
});

describe('PersonaLine: state -> lamp and edge', () => {
  it('a resting line is a flat hairline row with a dark lamp', () => {
    const el = line(card());
    expect(el.className).toMatch(/\bae-line\b/);
    expect(el.className).not.toMatch(/\bfb-tile\b|\bis-lit\b/);
    expect(el.querySelector('.ae-lamp')!.className).not.toMatch(/\bis-lit\b/);
  });

  it('needs-you lights the edge and the lamp in the warning tone', () => {
    const el = line(card({ reviews: [review('r1')], reviewCount: 1, reviewCounts: { critical: 0, warning: 1, info: 0 }, topReviewSeverity: 'warning', attentionCount: 1, execState: 'attention' }));
    expect(el.dataset.kind).toBe('warning');
    expect(el.className).toMatch(/\bis-lit\b/);
    expect(el.className).not.toMatch(/\bis-critical\b/);
    expect(el.querySelector('.ae-lamp')!.className).toMatch(/\bae-t-warn\b.*\bis-lit\b/);
  });

  it('a failed last run is critical: the stronger edge, the error tone', () => {
    const el = line(card({ execState: 'failed', recentStatuses: ['failed'] }));
    expect(el.dataset.kind).toBe('critical');
    expect(el.className).toMatch(/\bis-lit\b.*\bis-critical\b/);
    expect(el.className).toMatch(/\bae-t-err\b/);
  });

  it('a run keeps only the edge, and an off persona is drawn off', () => {
    expect(line(card({ running: 1, execState: 'running', runningSince: NOW - 6 * 60_000 })).className).toMatch(/\bis-working\b/);
    expect(line(card({ enabled: false })).className).toMatch(/\bis-off\b/);
  });
});

describe('PersonaLine: the sentence and the next start', () => {
  it('carries the activity and the next start from the cron slice', () => {
    useAgentStore.setState({ personaLastRun: { p1: new Date(NOW - 2 * 3_600_000).toISOString() } });
    useOverviewStore.setState({ cronAgents: [cron(30)] });
    const el = line(card());
    const label = el.getAttribute('aria-label')!;
    expect(label).toMatch(/^Leave Planner · /);
    expect(label).toContain('2h');
    expect(label).toMatch(/next \d{2}:\d{2}/);
    expect(el.querySelector('[data-testid="persona-line-next"]')).not.toBeNull();
  });

  it('with no schedule the next start is absent, on the row and in the sentence', () => {
    const el = line(card());
    expect(el.querySelector('[data-testid="persona-line-next"]')).toBeNull();
    expect(el.getAttribute('aria-label')).not.toMatch(/next /);
  });
});
