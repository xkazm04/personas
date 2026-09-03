/**
 * THE SUMMARY MUST BE ABLE TO SAY "NOTHING" AND "CANCELLED".
 *
 * Two arms of this hook were unreachable by construction:
 *
 *  1. It always returned an object, so `{summary && <ExecutionSummaryCard/>}`
 *     in ExecutionMiniPlayer was always true and the plain-text result fallback
 *     right under it could never render — even for a run with no trace at all.
 *  2. `status: "cancelled"` was declared and never produced. The structured
 *     stream carries no cancel event (it simply stops), so the trace alone can
 *     never witness one; the caller's persisted execution row can.
 *
 * The third property pinned here is the one that must NOT regress into a guess:
 * a finished run with no `complete` entry (a dropped/late result event) still
 * reads "completed", not "cancelled".
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useExecutionSummary } from '../useExecutionSummary';
import type { ReasoningEntry } from '../useReasoningTrace';

const init: ReasoningEntry = { type: 'init', model: 'claude-opus', ts: 1 };
const tool: ReasoningEntry = {
  type: 'tool_call',
  toolName: 'Edit',
  inputPreview: 'src/a.ts',
  ts: 2,
};
const wrote: ReasoningEntry = {
  type: 'file_change',
  path: 'src/a.ts',
  changeType: 'write',
  ts: 3,
};
const done: ReasoningEntry = {
  type: 'complete',
  durationMs: 4200,
  cost: 0.12,
  tokens: 900,
  ts: 4,
};

describe('useExecutionSummary', () => {
  it('returns null when there is nothing to summarise', () => {
    const { result } = renderHook(() => useExecutionSummary([], false));
    expect(result.current).toBeNull();
  });

  it('summarises a completed run from its trace', () => {
    const { result } = renderHook(() =>
      useExecutionSummary([init, tool, wrote, done], false),
    );
    expect(result.current).toMatchObject({
      status: 'completed',
      model: 'claude-opus',
      durationMs: 4200,
      costUsd: 0.12,
      totalTokens: 900,
      uniqueTools: ['Edit'],
      fileWriteCount: 1,
      fileReadCount: 0,
    });
  });

  it('reports a cancelled run from the caller\'s authoritative status', () => {
    const { result } = renderHook(() =>
      useExecutionSummary([init, tool], false, 'cancelled'),
    );
    expect(result.current?.status).toBe('cancelled');
  });

  it('stays "running" while live, whatever the caller\'s status says', () => {
    const { result } = renderHook(() =>
      useExecutionSummary([init, tool], true, 'cancelled'),
    );
    expect(result.current?.status).toBe('running');
  });

  it('does not guess "cancelled" from a missing complete entry', () => {
    const { result } = renderHook(() => useExecutionSummary([init, tool], false));
    expect(result.current?.status).toBe('completed');
  });

  it('falls back to the traced terminal state when the caller has none', () => {
    const failed: ReasoningEntry = { type: 'error', message: 'boom', ts: 5 };
    const { result } = renderHook(() =>
      useExecutionSummary([init, failed], false, null),
    );
    expect(result.current?.status).toBe('failed');
  });
});
