import { describe, it, expect, beforeAll } from 'vitest';
import { deriveProgress, milestoneForPct } from '../RacingProgress';
import { MILESTONES } from '../strategyPresets';
import { getEnglishTranslationsAsync } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import type { DevTask } from '@/lib/bindings/DevTask';

// `plugins` (and whatever other section deriveProgress reads) is a
// code-split, non-core English section now — see src/i18n/useTranslation.ts's
// module header — so this suite awaits every section's chunk once, up front,
// rather than assuming the full catalog is synchronously resident.
let t: Translations;
beforeAll(async () => {
  t = await getEnglishTranslationsAsync();
});

function task(overrides: Partial<DevTask>): DevTask {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    title: 'Race entry',
    description: null,
    source_idea_id: null,
    goal_id: null,
    status: 'running',
    session_id: null,
    progress_pct: 0,
    output_lines: 0,
    error: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    depth: 'quick',
    parent_task_id: null,
    attempt: 1,
    ...overrides,
  };
}

describe('milestoneForPct', () => {
  it('returns the last milestone whose threshold has been passed', () => {
    expect(milestoneForPct(0).id).toBe('analyzing');
    expect(milestoneForPct(10).id).toBe('analyzing');
    expect(milestoneForPct(54).id).toBe('planning');
    expect(milestoneForPct(80).id).toBe('testing');
    expect(milestoneForPct(100).id).toBe('done');
  });
});

describe('deriveProgress — a failed competitor reports where it actually stopped', () => {
  it('keeps the failed task’s own progress instead of resetting to the first milestone', () => {
    const p = deriveProgress(task({ status: 'failed', progress_pct: 80, error: 'build broke' }), t);
    expect(p.progressPct).toBe(80);
    expect(p.milestone.id).toBe('testing');
    expect(p.detail).toBe('build broke');
  });

  it('does not claim progress a failed task never made', () => {
    const p = deriveProgress(task({ status: 'failed', progress_pct: 0 }), t);
    expect(p.progressPct).toBe(0);
    expect(p.milestone.id).toBe(MILESTONES[0]!.id);
  });

  it('still reports 100% for a completed task', () => {
    const p = deriveProgress(task({ status: 'completed', progress_pct: 100 }), t);
    expect(p.progressPct).toBe(100);
    expect(p.milestone.id).toBe('done');
  });

  it('maps a running task to its milestone threshold', () => {
    const p = deriveProgress(task({ status: 'running', progress_pct: 60 }), t);
    expect(p.milestone.id).toBe('implementing');
    expect(p.progressPct).toBe(55);
  });
});
