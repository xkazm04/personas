import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTodayActivity, formatErr, type ActivityKind } from '../overviewHelpers';
import type { DevScan } from '@/lib/bindings/DevScan';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';

function makeScan(overrides: Partial<DevScan> = {}): DevScan {
  return {
    id: 'scan-1',
    project_id: 'proj-1',
    scan_type: 'security_auditor,ux_reviewer',
    status: 'success',
    idea_count: 5,
    input_tokens: null,
    output_tokens: null,
    duration_ms: null,
    error: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<DevTask> = {}): DevTask {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    title: 'Test task',
    description: null,
    source_idea_id: null,
    goal_id: null,
    status: 'pending',
    session_id: null,
    progress_pct: 0,
    output_lines: 0,
    error: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    depth: 'quick',
    ...overrides,
  };
}

function makeSignal(overrides: Partial<DevGoalSignal> = {}): DevGoalSignal {
  return {
    id: 'sig-1',
    goal_id: 'goal-1',
    signal_type: 'progress',
    source_id: null,
    delta: null,
    message: 'Progress updated',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const FIXED_NOW = new Date('2026-05-16T15:00:00Z').getTime();
const TODAY_AT_NOON = new Date('2026-05-16T12:00:00Z').toISOString();
// 36+ hours before FIXED_NOW so it is unambiguously "yesterday" regardless
// of local TZ (startOfToday uses local midnight).
const YESTERDAY = new Date('2026-05-14T12:00:00Z').toISOString();

describe('buildTodayActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty feed when there is nothing today', () => {
    const events = buildTodayActivity(
      [makeScan({ created_at: YESTERDAY })],
      [makeTask({ created_at: YESTERDAY })],
      [makeSignal({ created_at: YESTERDAY })],
    );
    expect(events).toEqual([]);
  });

  it('surfaces today scans as scan_run events with agent count + idea count in the label', () => {
    const events = buildTodayActivity(
      [makeScan({ created_at: TODAY_AT_NOON, scan_type: 'a,b,c', idea_count: 7 })],
      [],
      [],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe<ActivityKind>('scan_run');
    expect(events[0]!.label).toMatch(/3 agents/);
    expect(events[0]!.label).toMatch(/7 ideas/);
  });

  it('emits both task_created AND task_completed when both timestamps fall today', () => {
    const created = new Date(FIXED_NOW - 3600_000).toISOString();
    const completed = new Date(FIXED_NOW - 60_000).toISOString();
    const events = buildTodayActivity(
      [],
      [makeTask({ id: 'task-x', title: 'Build it', created_at: created, completed_at: completed, status: 'complete' })],
      [],
    );
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['task_completed', 'task_created']);
    expect(events.every((e) => e.sourceId === 'task-x')).toBe(true);
  });

  it('emits task_failed instead of task_completed when status is failed', () => {
    const events = buildTodayActivity(
      [],
      [makeTask({
        title: 'Bust', status: 'failed',
        created_at: YESTERDAY,  // creation not today — only completion event fires today
        completed_at: TODAY_AT_NOON,
      })],
      [],
    );
    // Filter to just completion-side events; the task may also emit
    // task_created if its created_at is interpreted as today in local TZ.
    const completionEvents = events.filter((e) => e.kind === 'task_failed' || e.kind === 'task_completed');
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0]!.kind).toBe('task_failed');
  });

  it('appends a delta in the goal_signal label when delta is set', () => {
    const events = buildTodayActivity(
      [],
      [],
      [makeSignal({ created_at: TODAY_AT_NOON, message: 'Goal progressed', delta: 15 })],
    );
    expect(events[0]!.label).toContain('Goal progressed');
    expect(events[0]!.label).toContain('+15%');
  });

  it('falls back to signal_type when message is null', () => {
    const events = buildTodayActivity(
      [],
      [],
      [makeSignal({ created_at: TODAY_AT_NOON, message: null, signal_type: 'milestone' })],
    );
    expect(events[0]!.label).toContain('milestone');
  });

  it('sorts events newest-first', () => {
    const oldest = new Date(FIXED_NOW - 3600_000).toISOString();
    const middle = new Date(FIXED_NOW - 1800_000).toISOString();
    const newest = new Date(FIXED_NOW - 60_000).toISOString();
    const events = buildTodayActivity(
      [
        makeScan({ id: 's1', created_at: middle }),
        makeScan({ id: 's2', created_at: newest }),
        makeScan({ id: 's3', created_at: oldest }),
      ],
      [],
      [],
    );
    expect(events.map((e) => e.id)).toEqual(['scan-s2', 'scan-s1', 'scan-s3']);
  });

  it('caps the feed at 30 entries even when more events qualify', () => {
    const scans = Array.from({ length: 50 }, (_, i) =>
      makeScan({ id: `s${i}`, created_at: new Date(FIXED_NOW - i * 1000).toISOString() }),
    );
    const events = buildTodayActivity(scans, [], []);
    expect(events).toHaveLength(30);
  });

  it('ignores malformed timestamps without throwing', () => {
    const events = buildTodayActivity(
      [makeScan({ created_at: 'not a date' })],
      [makeTask({ created_at: 'also bad' })],
      [makeSignal({ created_at: '' })],
    );
    expect(events).toEqual([]);
  });
});

describe('formatErr', () => {
  it('extracts the .error field from Tauri AppError objects', () => {
    expect(formatErr({ error: 'failed thing', kind: 'NotFound' })).toBe('failed thing');
  });
  it('falls back to .message when no .error', () => {
    expect(formatErr({ message: 'oh no' })).toBe('oh no');
  });
  it('returns the message of an Error instance', () => {
    expect(formatErr(new Error('boom'))).toBe('boom');
  });
  it('passes strings through', () => {
    expect(formatErr('plain')).toBe('plain');
  });
});
