/**
 * E2E: useCorrelatedCliStream -- Core lifecycle tests.
 *
 * Tests the foundational CLI streaming hook that powers every CLI scenario
 * in the app. Validates event correlation, phase transitions, buffering,
 * deduplication, truncation, and overflow across all three providers.
 *
 * Run: `npm test -- src/test/e2e/cli-stream-core.e2e.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  installTauriEventEmitter,
  emitTauriEvent,
  listenerCount,
  teardownTauriEventEmitter,
} from '../helpers/tauriEventEmitter';
import {
  CLAUDE_EXECUTION_LINES,
  GEMINI_EXECUTION_LINES,
  COPILOT_EXECUTION_LINES,
  FAILED_EXECUTION_LINES,
  TIMEOUT_EXECUTION_LINES,
  OVERSIZED_LINE,
  DUPLICATE_LINES,
  WHITESPACE_LINES,
  generateOverflowLines,
  PROVIDER_FIXTURES,
} from '../helpers/cliFixtures';

// ===========================================================================
// Setup / teardown
// ===========================================================================

beforeEach(() => {
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
});

// ===========================================================================
// 1. Full lifecycle: idle -> running -> lines -> completed
// ===========================================================================

describe('E2E: useCorrelatedCliStream lifecycle', () => {
  it('starts in idle phase with no lines', () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'test-output',
        statusEvent: 'test-status',
        idField: 'job_id',
      }),
    );

    expect(result.current.phase).toBe('idle');
    expect(result.current.lines).toEqual([]);
    expect(result.current.runId).toBeNull();
  });

  it('transitions to running on start()', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'test-output',
        statusEvent: 'test-status',
        idField: 'job_id',
      }),
    );

    await act(async () => {
      await result.current.start('job-001');
    });

    expect(result.current.phase).toBe('running');
    expect(result.current.runId).toBe('job-001');
    expect(result.current.lines).toEqual([]);
  });

  it('registers listeners for both output and status events', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'my-output',
        statusEvent: 'my-status',
        idField: 'id',
      }),
    );

    await act(async () => {
      await result.current.start('run-1');
    });

    expect(listenerCount('my-output')).toBe(1);
    expect(listenerCount('my-status')).toBe(1);
  });

  it('accumulates output lines from correlated events', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 1' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 2' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 3' });
    });

    expect(result.current.lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('transitions to completed on status event', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', { execution_id: 'exec-001', status: 'completed' });
    });

    expect(result.current.phase).toBe('completed');
  });

  it('transitions to failed and invokes onFailed callback', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', {
        execution_id: 'exec-001',
        status: 'failed',
        error: 'API key expired',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith('API key expired');
  });

  it('uses default error message when no error string in payload', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', {
        execution_id: 'exec-001',
        status: 'failed',
      });
    });

    expect(onFailed).toHaveBeenCalledWith('CLI transformation failed.');
  });

  it('resets all state via reset()', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 1' });
    });

    expect(result.current.lines).toHaveLength(1);

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.lines).toEqual([]);
    expect(result.current.runId).toBeNull();
  });

  it('unregisters listeners on cleanup()', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'test-out',
        statusEvent: 'test-stat',
        idField: 'id',
      }),
    );

    await act(async () => {
      await result.current.start('r1');
    });

    expect(listenerCount('test-out')).toBe(1);
    expect(listenerCount('test-stat')).toBe(1);

    await act(async () => {
      await result.current.cleanup();
    });

    expect(listenerCount('test-out')).toBe(0);
    expect(listenerCount('test-stat')).toBe(0);
  });

  it('unregisters listeners on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'test-out',
        statusEvent: 'test-stat',
        idField: 'id',
      }),
    );

    await act(async () => {
      await result.current.start('r1');
    });

    expect(listenerCount('test-out')).toBe(1);

    unmount();

    expect(listenerCount('test-out')).toBe(0);
    expect(listenerCount('test-stat')).toBe(0);
  });
});

// ===========================================================================
// 2. Event correlation -- only matched IDs are processed
// ===========================================================================

describe('E2E: event correlation by ID field', () => {
  it('ignores output events with non-matching IDs', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'matched' });
      emitTauriEvent('exec-output', { execution_id: 'exec-002', line: 'not matched' });
      emitTauriEvent('exec-output', { execution_id: 'exec-003', line: 'also not matched' });
    });

    expect(result.current.lines).toEqual(['matched']);
  });

  it('ignores status events with non-matching IDs', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', { execution_id: 'exec-999', status: 'failed' });
    });

    expect(result.current.phase).toBe('running');
  });

  it('handles different idField names (job_id)', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'debug-output',
        statusEvent: 'debug-status',
        idField: 'job_id',
      }),
    );

    await act(async () => {
      await result.current.start('job-abc');
    });

    act(() => {
      emitTauriEvent('debug-output', { job_id: 'job-abc', line: 'correct' });
      emitTauriEvent('debug-output', { job_id: 'job-xyz', line: 'wrong' });
    });

    expect(result.current.lines).toEqual(['correct']);
  });

  it('handles different idField names (transform_id)', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
      }),
    );

    await act(async () => {
      await result.current.start('tf-42');
    });

    act(() => {
      emitTauriEvent('n8n-transform-output', { transform_id: 'tf-42', line: 'yes' });
      emitTauriEvent('n8n-transform-output', { transform_id: 'tf-99', line: 'no' });
    });

    expect(result.current.lines).toEqual(['yes']);
  });

  it('handles different idField names (adopt_id)', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'template-adopt-output',
        statusEvent: 'template-adopt-status',
        idField: 'adopt_id',
      }),
    );

    await act(async () => {
      await result.current.start('adopt-7');
    });

    act(() => {
      emitTauriEvent('template-adopt-output', { adopt_id: 'adopt-7', line: 'hi' });
    });

    expect(result.current.lines).toEqual(['hi']);
  });
});

// ===========================================================================
// 3. Multi-provider execution -- full streams per provider
// ===========================================================================

describe('E2E: multi-provider full execution streams', () => {
  for (const provider of PROVIDER_FIXTURES) {
    describe(`${provider.name} (${provider.model})`, () => {
      it('streams full successful execution', async () => {
        const onStatusEvent = vi.fn();
        const { result } = renderHook(() =>
          useCorrelatedCliStream({
            outputEvent: 'execution-output',
            statusEvent: 'execution-status',
            idField: 'execution_id',
            onStatusEvent,
          }),
        );

        await act(async () => {
          await result.current.start(`exec-${provider.name}`);
        });

        // Emit all lines
        for (const line of provider.successLines) {
          act(() => {
            emitTauriEvent('execution-output', {
              execution_id: `exec-${provider.name}`,
              line,
            });
          });
        }

        expect(result.current.lines).toEqual(provider.successLines);
        expect(result.current.lines[0]).toContain(provider.model);

        // Complete
        act(() => {
          emitTauriEvent('execution-status', {
            execution_id: `exec-${provider.name}`,
            status: 'completed',
          });
        });

        expect(result.current.phase).toBe('completed');
        expect(onStatusEvent).toHaveBeenCalled();
      });

      it('streams failure scenario', async () => {
        const onFailed = vi.fn();
        const { result } = renderHook(() =>
          useCorrelatedCliStream({
            outputEvent: 'execution-output',
            statusEvent: 'execution-status',
            idField: 'execution_id',
            onFailed,
          }),
        );

        await act(async () => {
          await result.current.start(`fail-${provider.name}`);
        });

        for (const line of provider.failureLines) {
          act(() => {
            emitTauriEvent('execution-output', {
              execution_id: `fail-${provider.name}`,
              line,
            });
          });
        }

        act(() => {
          emitTauriEvent('execution-status', {
            execution_id: `fail-${provider.name}`,
            status: 'failed',
            error: `${provider.name} execution failed`,
          });
        });

        expect(result.current.phase).toBe('failed');
        expect(onFailed).toHaveBeenCalledWith(`${provider.name} execution failed`);
        expect(result.current.lines).toEqual(provider.failureLines);
      });

      it('contains provider-specific content markers', () => {
        const firstLine = provider.successLines[0];
        expect(firstLine).toContain('Session started');
        expect(firstLine).toContain(provider.model);

        const hasToolUse = provider.successLines.some((l) => l.startsWith('> Using tool:'));
        expect(hasToolUse).toBe(true);

        const hasSummary = provider.successLines.some((l) => l.startsWith('[SUMMARY]'));
        expect(hasSummary).toBe(true);
      });
    });
  }
});

// ===========================================================================
// 4. Callback invocations -- onOutputLine, onStatusEvent
// ===========================================================================

describe('E2E: callback invocations', () => {
  it('calls onOutputLine for each correlated line', async () => {
    const onOutputLine = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onOutputLine,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Hello' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'World' });
    });

    expect(onOutputLine).toHaveBeenCalledTimes(2);
    expect(onOutputLine).toHaveBeenCalledWith('Hello');
    expect(onOutputLine).toHaveBeenCalledWith('World');
  });

  it('calls onStatusEvent with full payload', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', {
        execution_id: 'exec-001',
        status: 'completed',
        result: { rows: 42 },
        corrected_query: 'SELECT * FROM users',
      });
    });

    expect(onStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 'exec-001',
        status: 'completed',
        result: { rows: 42 },
        corrected_query: 'SELECT * FROM users',
      }),
    );
  });

  it('does not call onOutputLine for non-correlated events', async () => {
    const onOutputLine = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onOutputLine,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-other', line: 'Nope' });
    });

    expect(onOutputLine).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. bufferLines: false -- external buffer mode
// ===========================================================================

describe('E2E: external buffer mode (bufferLines: false)', () => {
  it('does not accumulate lines internally when bufferLines is false', async () => {
    const onOutputLine = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        bufferLines: false,
        onOutputLine,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 1' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Line 2' });
    });

    // Hook's internal buffer stays empty
    expect(result.current.lines).toEqual([]);
    // But callback is still invoked
    expect(onOutputLine).toHaveBeenCalledTimes(2);
    expect(onOutputLine).toHaveBeenCalledWith('Line 1');
    expect(onOutputLine).toHaveBeenCalledWith('Line 2');
  });

  it('still tracks phase transitions when bufferLines is false', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        bufferLines: false,
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-status', { execution_id: 'exec-001', status: 'completed' });
    });

    expect(result.current.phase).toBe('completed');
  });
});

// ===========================================================================
// 6. Deduplication -- consecutive duplicate lines are skipped
// ===========================================================================

describe('E2E: line deduplication', () => {
  it('skips consecutive duplicate lines', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    for (const line of DUPLICATE_LINES) {
      act(() => {
        emitTauriEvent('exec-output', { execution_id: 'exec-001', line });
      });
    }

    // Three duplicate "Using tool: Read" lines should collapse to one
    expect(result.current.lines).toEqual([
      '> Using tool: Read',
      '  Tool result: success',
    ]);
  });

  it('allows same line after an intervening different line', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'A' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'B' });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'A' });
    });

    expect(result.current.lines).toEqual(['A', 'B', 'A']);
  });
});

// ===========================================================================
// 7. Line truncation -- oversized lines are trimmed
// ===========================================================================

describe('E2E: oversized line truncation', () => {
  it('truncates lines exceeding 4096 characters and appends marker', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: OVERSIZED_LINE });
    });

    const stored = result.current.lines[0];
    expect(stored.length).toBeLessThanOrEqual(4096 + '...[truncated]'.length);
    expect(stored.endsWith('...[truncated]')).toBe(true);
  });

  it('does not truncate lines within the 4096 limit', async () => {
    const normalLine = 'X'.repeat(4096);
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: normalLine });
    });

    expect(result.current.lines[0]).toBe(normalLine);
    expect(result.current.lines[0]).not.toContain('[truncated]');
  });
});

// ===========================================================================
// 8. Buffer overflow -- MAX_STREAM_LINES = 5000
// ===========================================================================

describe('E2E: buffer overflow (MAX_STREAM_LINES)', () => {
  it('evicts oldest lines when buffer exceeds 5000', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    const lines = generateOverflowLines(5050);
    for (const line of lines) {
      act(() => {
        emitTauriEvent('exec-output', { execution_id: 'exec-001', line });
      });
    }

    expect(result.current.lines.length).toBeLessThanOrEqual(5000);
    // The last line should be the final emitted line
    expect(result.current.lines[result.current.lines.length - 1]).toBe('Line 5050: output data');
    // The first line should NOT be "Line 1" (it was evicted)
    expect(result.current.lines[0]).not.toBe('Line 1: output data');
  });
});

// ===========================================================================
// 9. Whitespace / empty line filtering
// ===========================================================================

describe('E2E: empty and whitespace line filtering', () => {
  it('ignores empty and whitespace-only lines', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    for (const line of WHITESPACE_LINES) {
      act(() => {
        emitTauriEvent('exec-output', { execution_id: 'exec-001', line });
      });
    }

    expect(result.current.lines).toEqual(['actual content']);
  });

  it('ignores events with non-string line payloads', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 42 });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: null });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: undefined });
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: { nested: true } });
    });

    expect(result.current.lines).toEqual([]);
  });
});

// ===========================================================================
// 10. Re-start -- start() called while already running
// ===========================================================================

describe('E2E: re-start mid-stream', () => {
  it('cleans up previous listeners and resets buffer on re-start', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'old line' });
    });

    expect(result.current.lines).toEqual(['old line']);

    // Re-start with new ID
    await act(async () => {
      await result.current.start('exec-002');
    });

    expect(result.current.runId).toBe('exec-002');
    expect(result.current.lines).toEqual([]);
    expect(result.current.phase).toBe('running');

    // Old events should be ignored
    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'stale' });
    });
    expect(result.current.lines).toEqual([]);

    // New events work
    act(() => {
      emitTauriEvent('exec-output', { execution_id: 'exec-002', line: 'fresh' });
    });
    expect(result.current.lines).toEqual(['fresh']);
  });
});

// ===========================================================================
// 11. setLines / setPhase -- manual override
// ===========================================================================

describe('E2E: manual state overrides', () => {
  it('setLines replaces the buffer', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    act(() => {
      result.current.setLines(['restored-1', 'restored-2']);
    });

    expect(result.current.lines).toEqual(['restored-1', 'restored-2']);
  });

  it('setPhase overrides the current phase', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    act(() => {
      result.current.setPhase('completed');
    });

    expect(result.current.phase).toBe('completed');
  });
});

// ===========================================================================
// 12. Concurrent streams -- isolated by event names
// ===========================================================================

describe('E2E: concurrent isolated streams', () => {
  it('two hooks with different event names do not interfere', async () => {
    const { result: result1 } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'stream-A-output',
        statusEvent: 'stream-A-status',
        idField: 'id',
      }),
    );

    const { result: result2 } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'stream-B-output',
        statusEvent: 'stream-B-status',
        idField: 'id',
      }),
    );

    await act(async () => {
      await result1.current.start('a1');
    });
    await act(async () => {
      await result2.current.start('b1');
    });

    act(() => {
      emitTauriEvent('stream-A-output', { id: 'a1', line: 'from A' });
      emitTauriEvent('stream-B-output', { id: 'b1', line: 'from B' });
    });

    expect(result1.current.lines).toEqual(['from A']);
    expect(result2.current.lines).toEqual(['from B']);
  });
});

// ===========================================================================
// 13. Full provider execution streams -- complete output validation
// ===========================================================================

describe('E2E: complete Claude execution stream', () => {
  it('streams full Claude output and reaches completed', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('claude-run-1');
    });

    for (const line of CLAUDE_EXECUTION_LINES) {
      act(() => {
        emitTauriEvent('execution-output', { execution_id: 'claude-run-1', line });
      });
    }

    act(() => {
      emitTauriEvent('execution-status', { execution_id: 'claude-run-1', status: 'completed' });
    });

    expect(result.current.lines).toEqual(CLAUDE_EXECUTION_LINES);
    expect(result.current.phase).toBe('completed');
    expect(result.current.lines.some((l) => l.includes('claude-sonnet-4-6'))).toBe(true);
    expect(result.current.lines.some((l) => l.startsWith('[SUMMARY]'))).toBe(true);
  });
});

describe('E2E: complete Gemini execution stream', () => {
  it('streams full Gemini output with different model identifier', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('gemini-run-1');
    });

    for (const line of GEMINI_EXECUTION_LINES) {
      act(() => {
        emitTauriEvent('execution-output', { execution_id: 'gemini-run-1', line });
      });
    }

    act(() => {
      emitTauriEvent('execution-status', { execution_id: 'gemini-run-1', status: 'completed' });
    });

    expect(result.current.lines).toEqual(GEMINI_EXECUTION_LINES);
    expect(result.current.phase).toBe('completed');
    expect(result.current.lines[0]).toContain('gemini-3.1-flash-lite-preview');
    expect(result.current.lines.some((l) => l.includes('WebSearch'))).toBe(true);
  });
});

describe('E2E: complete Copilot execution stream', () => {
  it('streams full Copilot output with GPT model', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('copilot-run-1');
    });

    for (const line of COPILOT_EXECUTION_LINES) {
      act(() => {
        emitTauriEvent('execution-output', { execution_id: 'copilot-run-1', line });
      });
    }

    act(() => {
      emitTauriEvent('execution-status', { execution_id: 'copilot-run-1', status: 'completed' });
    });

    expect(result.current.lines).toEqual(COPILOT_EXECUTION_LINES);
    expect(result.current.phase).toBe('completed');
    expect(result.current.lines[0]).toContain('gpt-5.1-codex-mini');
    expect(result.current.lines.some((l) => l.includes('Bash'))).toBe(true);
  });
});

// ===========================================================================
// 14. Timeout and error recovery streams
// ===========================================================================

describe('E2E: timeout and error execution streams', () => {
  it('handles timeout execution correctly', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('timeout-run');
    });

    for (const line of TIMEOUT_EXECUTION_LINES) {
      act(() => {
        emitTauriEvent('execution-output', { execution_id: 'timeout-run', line });
      });
    }

    act(() => {
      emitTauriEvent('execution-status', {
        execution_id: 'timeout-run',
        status: 'failed',
        error: 'Execution timed out after 60s',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith('Execution timed out after 60s');
    expect(result.current.lines.some((l) => l.includes('[TIMEOUT]'))).toBe(true);
  });

  it('handles mid-stream error execution', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('error-run');
    });

    for (const line of FAILED_EXECUTION_LINES) {
      act(() => {
        emitTauriEvent('execution-output', { execution_id: 'error-run', line });
      });
    }

    act(() => {
      emitTauriEvent('execution-status', {
        execution_id: 'error-run',
        status: 'failed',
        error: 'Tool execution failed',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(result.current.lines.some((l) => l.includes('[ERROR]'))).toBe(true);
  });
});
