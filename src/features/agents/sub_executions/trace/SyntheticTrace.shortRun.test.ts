// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSyntheticTrace } from './SyntheticTrace';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

function run(totalMs: number): PersonaExecution {
  const start = Date.parse('2026-07-01T12:00:00.000Z');
  // Test fixture: buildSyntheticTrace reads only id, persona_id, status, error_message and the timestamps.
  return {
    id: 'exec1',
    persona_id: 'p1',
    status: 'failed',
    error_message: null,
    duration_ms: totalMs,
    started_at: new Date(start).toISOString(),
    completed_at: new Date(start + totalMs).toISOString(),
    created_at: new Date(start).toISOString(),
  } as unknown as PersonaExecution;
}

describe('buildSyntheticTrace on short runs', () => {
  it.each([20, 80, 10_000])('keeps every span inside a %i ms run', (ms) => {
    const trace = buildSyntheticTrace(run(ms))!;
    const wall = trace.completedAt! - trace.startedAt;
    expect(wall).toBe(ms);
    for (const s of trace.spans) {
      expect(s.start_ms).toBeGreaterThanOrEqual(0);
      expect(s.end_ms!).toBeLessThanOrEqual(wall + 1e-9);
    }
  });

  it('leaves a long run unchanged and spans contiguous', () => {
    const trace = buildSyntheticTrace(run(10_000))!;
    expect(trace.spans[0]!.duration_ms).toBe(100);
    expect(trace.spans[4]!.duration_ms).toBe(10_000 - 100 - 200 - 100 - 100 - 300);
    for (let i = 1; i < trace.spans.length; i++) {
      expect(trace.spans[i]!.start_ms).toBeCloseTo(trace.spans[i - 1]!.end_ms!, 9);
    }
  });
});
