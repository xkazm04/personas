import { describe, expect, it } from 'vitest';

import { PERSONA_INK, processBuckets, processTotal } from '../lib/farProcesses';
import { FLEET_INK } from '../lib/ink';
import type { FleetNode } from '../lib/types';

const s = (id: string, state: string): FleetNode => ({ id, label: id, state });

describe('farProcesses — what the far-zoom hex counts', () => {
  it('is empty (→ sleeping state) when nothing is running', () => {
    const buckets = processBuckets([], []);
    expect(buckets).toEqual([]);
    expect(processTotal(buckets)).toBe(0);
  });

  it('counts Fleet sessions and personas together', () => {
    const buckets = processBuckets([s('a', 'running'), s('b', 'running')], ['Dev Clone', 'QA Guardian']);
    expect(processTotal(buckets)).toBe(4);
  });

  it('does NOT count exited sessions — "running" must not include finished work', () => {
    const buckets = processBuckets([s('a', 'running'), s('b', 'exited'), s('c', 'exited')], []);
    expect(processTotal(buckets)).toBe(1);
    expect(buckets.map((b) => b.key)).toEqual(['running']);
  });

  it('orders buckets attention-first so the lead ink is the urgent one', () => {
    const buckets = processBuckets(
      [s('a', 'idle'), s('b', 'running'), s('c', 'awaiting_input'), s('d', 'idle')],
      ['Dev Clone'],
    );
    expect(buckets.map((b) => b.key)).toEqual(['awaiting_input', 'running', 'idle', 'personas']);
    // The body tint is taken from buckets[0] — it must be the awaiting-input ink
    // even though `idle` has the larger count.
    expect(buckets[0]!.ink).toBe(FLEET_INK.awaiting_input);
    expect(buckets.find((b) => b.key === 'idle')!.count).toBe(2);
  });

  it('keeps the persona lane last, with its own ink', () => {
    const buckets = processBuckets([s('a', 'running')], ['One', 'Two', 'Three']);
    const last = buckets[buckets.length - 1]!;
    expect(last).toMatchObject({ key: 'personas', kind: 'persona', count: 3, ink: PERSONA_INK });
  });

  it('keeps unrecognised session states rather than dropping them from the count', () => {
    const buckets = processBuckets([s('a', 'running'), s('b', 'quantum_folded')], []);
    expect(processTotal(buckets)).toBe(2);
    const odd = buckets.find((b) => b.key === 'quantum_folded');
    expect(odd).toMatchObject({ count: 1, kind: 'fleet', ink: 'var(--status-neutral)' });
    // ...and sorts after every known state, so it never steals the lead tint.
    expect(buckets[0]!.key).toBe('running');
  });

  it('reports personas alone when no session is open', () => {
    const buckets = processBuckets([], ['Only Persona']);
    expect(buckets).toHaveLength(1);
    expect(processTotal(buckets)).toBe(1);
    expect(buckets[0]!.kind).toBe('persona');
  });
});
