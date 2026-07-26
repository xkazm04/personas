import { describe, it, expect } from 'vitest';
import { flattenScheduleGroups } from '../scheduleListItems';
import { parseScheduleEntry, type ScheduleEntry, type TimeGroup } from '../scheduleHelpers';
import type { CronAgent } from '@/lib/bindings/CronAgent';

function makeAgent(over: Partial<CronAgent> = {}): CronAgent {
  return {
    persona_id: 'p1',
    persona_name: 'Agent One',
    persona_icon: null,
    persona_color: null,
    persona_enabled: true,
    headless: false,
    trigger_id: 'trig-abc',
    cron_expression: null,
    interval_seconds: null,
    timezone: null,
    trigger_enabled: true,
    last_triggered_at: null,
    next_trigger_at: null,
    description: '',
    recent_executions: 1n,
    recent_failures: 0n,
    ...over,
  } as CronAgent;
}

function entry(triggerId: string): ScheduleEntry {
  return parseScheduleEntry(makeAgent({ trigger_id: triggerId }));
}

function group(label: string, ids: string[]): TimeGroup {
  return { label, entries: ids.map(entry) };
}

describe('flattenScheduleGroups', () => {
  it('returns an empty sequence for no groups', () => {
    expect(flattenScheduleGroups([])).toEqual({ items: [], headerIndexes: [], rowCount: 0 });
  });

  it('emits one header followed by its rows, in group order', () => {
    const { items } = flattenScheduleGroups([
      group('Overdue', ['a', 'b']),
      group('Next hour', ['c']),
    ]);

    expect(items.map((i) => (i.kind === 'header' ? `H:${i.label}` : `R:${i.entry.agent.trigger_id}`)))
      .toEqual(['H:Overdue', 'R:a', 'R:b', 'H:Next hour', 'R:c']);
  });

  it('reports header indexes that point at header items', () => {
    const { items, headerIndexes } = flattenScheduleGroups([
      group('Overdue', ['a', 'b']),
      group('Later', ['c', 'd', 'e']),
    ]);

    expect(headerIndexes).toEqual([0, 3]);
    for (const idx of headerIndexes) expect(items[idx]!.kind).toBe('header');
  });

  it('counts only entry rows in rowCount', () => {
    const flat = flattenScheduleGroups([group('Overdue', ['a']), group('Later', ['b', 'c'])]);
    expect(flat.rowCount).toBe(3);
    expect(flat.items).toHaveLength(5);
  });

  it('carries each group count onto its header', () => {
    const { items } = flattenScheduleGroups([group('Overdue', ['a', 'b', 'c'])]);
    const header = items[0]!;
    expect(header.kind === 'header' && header.count).toBe(3);
  });

  it('drops empty groups entirely, keeping header indexes contiguous', () => {
    const { items, headerIndexes } = flattenScheduleGroups([
      group('Overdue', []),
      group('Next hour', ['a']),
      group('Later', []),
      group('Paused / Unscheduled', ['b']),
    ]);

    expect(items.filter((i) => i.kind === 'header').map((i) => (i as { label: string }).label))
      .toEqual(['Next hour', 'Paused / Unscheduled']);
    expect(headerIndexes).toEqual([0, 2]);
  });

  it('marks only the first surviving header as first', () => {
    const { items } = flattenScheduleGroups([
      group('Overdue', []),
      group('Next hour', ['a']),
      group('Later', ['b']),
    ]);
    const headers = items.filter((i) => i.kind === 'header') as { first: boolean; label: string }[];
    expect(headers.map((h) => [h.label, h.first])).toEqual([['Next hour', true], ['Later', false]]);
  });

  it('marks the last row of each group', () => {
    const { items } = flattenScheduleGroups([
      group('Overdue', ['a', 'b']),
      group('Later', ['c']),
    ]);
    const rows = items.filter((i) => i.kind === 'row') as { lastInGroup: boolean; entry: ScheduleEntry }[];
    expect(rows.map((r) => [r.entry.agent.trigger_id, r.lastInGroup]))
      .toEqual([['a', false], ['b', true], ['c', true]]);
  });

  it('keys rows by trigger id and headers by label, uniquely', () => {
    const { items } = flattenScheduleGroups([
      group('Overdue', ['a', 'b']),
      group('Later', ['c']),
    ]);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['header:Overdue', 'row:a', 'row:b', 'header:Later', 'row:c']);
  });

  it('preserves entry object identity so memoized rows keep skipping re-renders', () => {
    const e = entry('a');
    const { items } = flattenScheduleGroups([{ label: 'Overdue', entries: [e] }]);
    expect(items[1]!.kind === 'row' && items[1] as { entry: ScheduleEntry }).toBeTruthy();
    expect((items[1] as { entry: ScheduleEntry }).entry).toBe(e);
  });
});
