import { describe, expect, it } from 'vitest';
import {
  appendNarrationEntry,
  completeNarrationTool,
  isTrailWorthKeeping,
  type NarrationEntry,
} from '../narrationTimeline';

const tool = (id: string, at = 1000): NarrationEntry => ({
  id,
  kind: 'tool',
  toolName: 'WebSearch',
  detail: 'climate data',
  at,
});

const beat = (id: string, at = 1000): NarrationEntry => ({
  id,
  kind: 'beat',
  text: 'Pulling up your recent runs…',
  at,
});

describe('appendNarrationEntry', () => {
  it('appends a new entry', () => {
    const next = appendNarrationEntry([], tool('t1'));
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe('t1');
  });

  it('dedupes by id — a re-emitted tool_use block must not double-log', () => {
    const initial = [tool('t1')];
    const next = appendNarrationEntry(initial, tool('t1', 2000));
    expect(next).toBe(initial); // same reference → store skips the write
  });

  it('preserves arrival order', () => {
    let entries: NarrationEntry[] = [];
    entries = appendNarrationEntry(entries, beat('b1', 1000));
    entries = appendNarrationEntry(entries, tool('t1', 2000));
    entries = appendNarrationEntry(entries, tool('t2', 3000));
    expect(entries.map((e) => e.id)).toEqual(['b1', 't1', 't2']);
  });
});

describe('completeNarrationTool', () => {
  it('stamps endedAt on the matching tool entry', () => {
    const entries = [tool('t1', 1000)];
    const next = completeNarrationTool(entries, 't1', 4500);
    expect(next[0]!.endedAt).toBe(4500);
    expect(entries[0]!.endedAt).toBeUndefined(); // immutably
  });

  it('is a no-op for unknown ids (e.g. a TodoWrite tool_result)', () => {
    const entries = [tool('t1')];
    expect(completeNarrationTool(entries, 'todo_1', 4500)).toBe(entries);
  });

  it('never overwrites an existing endedAt', () => {
    const entries = completeNarrationTool([tool('t1', 1000)], 't1', 2000);
    expect(completeNarrationTool(entries, 't1', 9000)).toBe(entries);
  });

  it('ignores beat entries even on id collision', () => {
    const entries = [beat('x')];
    expect(completeNarrationTool(entries, 'x', 2000)).toBe(entries);
  });
});

describe('isTrailWorthKeeping', () => {
  // The trail now shows only TOOL calls — beats persist as their own aside
  // messages (Phase A/B), so a beats-only turn has no trail to pin.
  it('drops empty and beats-only trails', () => {
    expect(isTrailWorthKeeping([])).toBe(false);
    expect(isTrailWorthKeeping([beat('b1')])).toBe(false);
  });

  it('keeps any trail containing at least one tool call', () => {
    expect(isTrailWorthKeeping([tool('t1')])).toBe(true);
    expect(isTrailWorthKeeping([tool('t1'), tool('t2')])).toBe(true);
    expect(isTrailWorthKeeping([beat('b1'), tool('t1')])).toBe(true);
  });
});
