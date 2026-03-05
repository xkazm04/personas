/**
 * E2E: CLI scenario streams — Query Debug, N8N Transform, Template Adoption.
 *
 * Each scenario uses useCorrelatedCliStream with different event names and
 * idField values. These tests simulate the complete Tauri event pipeline
 * for each domain-specific CLI operation across providers.
 *
 * Run: `npm test -- src/test/e2e/cli-scenario-streams.e2e.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  installTauriEventEmitter,
  emitTauriEvent,
  teardownTauriEventEmitter,
} from '../helpers/tauriEventEmitter';
import {
  QUERY_DEBUG_CLAUDE_LINES,
  QUERY_DEBUG_GEMINI_LINES,
  QUERY_DEBUG_COPILOT_LINES,
  QUERY_DEBUG_FAILED_LINES,
  N8N_TRANSFORM_LINES,
  N8N_TRANSFORM_GEMINI_LINES,
  N8N_TRANSFORM_FAILED_LINES,
  TEMPLATE_ADOPTION_LINES,
  TEMPLATE_ADOPTION_COPILOT_LINES,
} from '../helpers/cliFixtures';

beforeEach(() => {
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO A: Query Debug (QueriesTab → useQueryDebug → useCorrelatedCliStream)
//
// Events: query-debug-output / query-debug-status
// ID field: job_id
// Extras in status payload: result, corrected_query
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: Query Debug — Claude provider', () => {
  it('streams debug output, completes, and extracts result + corrected query', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('debug-job-1');
    });

    expect(result.current.phase).toBe('running');

    // Stream debug output lines
    for (const line of QUERY_DEBUG_CLAUDE_LINES) {
      act(() => {
        emitTauriEvent('query-debug-output', { job_id: 'debug-job-1', line });
      });
    }

    expect(result.current.lines).toEqual(QUERY_DEBUG_CLAUDE_LINES);

    // Complete with result payload
    act(() => {
      emitTauriEvent('query-debug-status', {
        job_id: 'debug-job-1',
        status: 'completed',
        result: { columns: ['id', 'name', 'email'], rows: [['1', 'Alice', 'alice@example.com']] },
        corrected_query: 'SELECT u.id, u.name, u.email FROM users u INNER JOIN orders o ON u.id = o.user_id',
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(onStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        result: expect.objectContaining({ columns: ['id', 'name', 'email'] }),
        corrected_query: expect.stringContaining('INNER JOIN'),
      }),
    );
  });
});

describe('E2E: Query Debug — Gemini provider', () => {
  it('streams Gemini-specific debug output with type casting fix', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('debug-gemini-1');
    });

    for (const line of QUERY_DEBUG_GEMINI_LINES) {
      act(() => {
        emitTauriEvent('query-debug-output', { job_id: 'debug-gemini-1', line });
      });
    }

    act(() => {
      emitTauriEvent('query-debug-status', {
        job_id: 'debug-gemini-1',
        status: 'completed',
        result: { columns: ['date', 'count'], rows: [['2025-01-01', '42']] },
        corrected_query: 'SELECT CAST(created_at AS DATE) AS date, COUNT(*) FROM events GROUP BY 1',
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.lines.some((l) => l.includes('Gemini'))).toBe(true);
    expect(result.current.lines.some((l) => l.includes('PostgreSQL'))).toBe(true);
  });
});

describe('E2E: Query Debug — Copilot provider', () => {
  it('streams Copilot-specific debug output with GROUP BY fix', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('debug-copilot-1');
    });

    for (const line of QUERY_DEBUG_COPILOT_LINES) {
      act(() => {
        emitTauriEvent('query-debug-output', { job_id: 'debug-copilot-1', line });
      });
    }

    act(() => {
      emitTauriEvent('query-debug-status', {
        job_id: 'debug-copilot-1',
        status: 'completed',
        result: { columns: ['status', 'total'], rows: [['active', '150'], ['inactive', '23']] },
        corrected_query: 'SELECT status, COUNT(*) AS total FROM users GROUP BY status',
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.lines.some((l) => l.includes('Copilot'))).toBe(true);
    expect(result.current.lines.some((l) => l.includes('GROUP BY'))).toBe(true);
  });
});

describe('E2E: Query Debug — failure after retries', () => {
  it('handles failed debug with max retries exceeded', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('debug-fail-1');
    });

    for (const line of QUERY_DEBUG_FAILED_LINES) {
      act(() => {
        emitTauriEvent('query-debug-output', { job_id: 'debug-fail-1', line });
      });
    }

    act(() => {
      emitTauriEvent('query-debug-status', {
        job_id: 'debug-fail-1',
        status: 'failed',
        error: 'Max retries exceeded',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith('Max retries exceeded');
    expect(result.current.lines.some((l) => l.includes('Max retries'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO B: N8N Transform (useN8nTransform → useCorrelatedCliStream)
//
// Events: n8n-transform-output / n8n-transform-status
// ID field: transform_id
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: N8N Transform — Claude provider', () => {
  it('streams full transform lifecycle with milestone markers', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('tf-001');
    });

    expect(result.current.phase).toBe('running');

    // Stream transform lines
    for (const line of N8N_TRANSFORM_LINES) {
      act(() => {
        emitTauriEvent('n8n-transform-output', { transform_id: 'tf-001', line });
      });
    }

    expect(result.current.lines).toEqual(N8N_TRANSFORM_LINES);

    // Verify milestone progression
    const milestones = result.current.lines.filter((l) => l.startsWith('[Milestone]'));
    expect(milestones).toEqual([
      '[Milestone] Parsing workflow structure',
      '[Milestone] Preparing transformation',
      '[Milestone] AI generating persona draft',
      '[Milestone] Extracting persona structure',
      '[Milestone] Draft ready for review.',
    ]);

    // Complete
    act(() => {
      emitTauriEvent('n8n-transform-status', {
        transform_id: 'tf-001',
        status: 'completed',
      });
    });

    expect(result.current.phase).toBe('completed');
  });
});

describe('E2E: N8N Transform — Gemini provider', () => {
  it('streams Gemini-specific transform output', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
      }),
    );

    await act(async () => {
      await result.current.start('tf-gemini-1');
    });

    for (const line of N8N_TRANSFORM_GEMINI_LINES) {
      act(() => {
        emitTauriEvent('n8n-transform-output', { transform_id: 'tf-gemini-1', line });
      });
    }

    act(() => {
      emitTauriEvent('n8n-transform-status', {
        transform_id: 'tf-gemini-1',
        status: 'completed',
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.lines[0]).toContain('Gemini');
    expect(result.current.lines.some((l) => l.includes('Gemini 3.1 Flash Lite Preview'))).toBe(true);
  });
});

describe('E2E: N8N Transform — parse failure', () => {
  it('handles unsupported node type error', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('tf-fail-1');
    });

    for (const line of N8N_TRANSFORM_FAILED_LINES) {
      act(() => {
        emitTauriEvent('n8n-transform-output', { transform_id: 'tf-fail-1', line });
      });
    }

    act(() => {
      emitTauriEvent('n8n-transform-status', {
        transform_id: 'tf-fail-1',
        status: 'failed',
        error: 'Unsupported node type in workflow',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith('Unsupported node type in workflow');
    expect(result.current.lines.some((l) => l.includes('[ERROR]'))).toBe(true);
  });
});

describe('E2E: N8N Transform — concurrent isolation', () => {
  it('two transforms with different IDs do not interfere', async () => {
    const { result: r1 } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
      }),
    );
    const { result: r2 } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
      }),
    );

    await act(async () => {
      await r1.current.start('tf-A');
    });
    await act(async () => {
      await r2.current.start('tf-B');
    });

    act(() => {
      emitTauriEvent('n8n-transform-output', { transform_id: 'tf-A', line: 'Transform A' });
      emitTauriEvent('n8n-transform-output', { transform_id: 'tf-B', line: 'Transform B' });
    });

    expect(r1.current.lines).toEqual(['Transform A']);
    expect(r2.current.lines).toEqual(['Transform B']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO C: Template Adoption (useAsyncTransform → useCorrelatedCliStream)
//
// Events: template-adopt-output / template-adopt-status
// ID field: adopt_id
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: Template Adoption — default (Claude) provider', () => {
  it('streams full adoption lifecycle with sandbox policy', async () => {
    const onStatusEvent = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'template-adopt-output',
        statusEvent: 'template-adopt-status',
        idField: 'adopt_id',
        onStatusEvent,
      }),
    );

    await act(async () => {
      await result.current.start('adopt-001');
    });

    for (const line of TEMPLATE_ADOPTION_LINES) {
      act(() => {
        emitTauriEvent('template-adopt-output', { adopt_id: 'adopt-001', line });
      });
    }

    expect(result.current.lines).toEqual(TEMPLATE_ADOPTION_LINES);
    expect(result.current.lines.some((l) => l.includes('sandbox policy'))).toBe(true);

    act(() => {
      emitTauriEvent('template-adopt-status', {
        adopt_id: 'adopt-001',
        status: 'completed',
      });
    });

    expect(result.current.phase).toBe('completed');
  });
});

describe('E2E: Template Adoption — Copilot provider', () => {
  it('streams Copilot adoption with different budget settings', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'template-adopt-output',
        statusEvent: 'template-adopt-status',
        idField: 'adopt_id',
      }),
    );

    await act(async () => {
      await result.current.start('adopt-copilot-1');
    });

    for (const line of TEMPLATE_ADOPTION_COPILOT_LINES) {
      act(() => {
        emitTauriEvent('template-adopt-output', { adopt_id: 'adopt-copilot-1', line });
      });
    }

    act(() => {
      emitTauriEvent('template-adopt-status', {
        adopt_id: 'adopt-copilot-1',
        status: 'completed',
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.lines[0]).toContain('Copilot');
    expect(result.current.lines.some((l) => l.includes('$1.00'))).toBe(true);
  });
});

describe('E2E: Template Adoption — failure mid-adoption', () => {
  it('handles adoption failure and triggers onFailed callback', async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'template-adopt-output',
        statusEvent: 'template-adopt-status',
        idField: 'adopt_id',
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.start('adopt-fail-1');
    });

    act(() => {
      emitTauriEvent('template-adopt-output', {
        adopt_id: 'adopt-fail-1',
        line: '[System] Starting template adoption…',
      });
      emitTauriEvent('template-adopt-output', {
        adopt_id: 'adopt-fail-1',
        line: '> Parsing template definition',
      });
      emitTauriEvent('template-adopt-output', {
        adopt_id: 'adopt-fail-1',
        line: '[ERROR] Template schema validation failed: missing required field "use_cases"',
      });
    });

    act(() => {
      emitTauriEvent('template-adopt-status', {
        adopt_id: 'adopt-fail-1',
        status: 'failed',
        error: 'Template schema validation failed',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith('Template schema validation failed');
    expect(result.current.lines).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO D: Cross-scenario — same events, different consumers
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: cross-scenario isolation', () => {
  it('execution, debug, and transform streams are fully isolated', async () => {
    const { result: execStream } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
      }),
    );

    const { result: debugStream } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
      }),
    );

    const { result: transformStream } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'n8n-transform-output',
        statusEvent: 'n8n-transform-status',
        idField: 'transform_id',
      }),
    );

    await act(async () => {
      await execStream.current.start('exec-1');
    });
    await act(async () => {
      await debugStream.current.start('debug-1');
    });
    await act(async () => {
      await transformStream.current.start('tf-1');
    });

    // Emit to each stream
    act(() => {
      emitTauriEvent('execution-output', { execution_id: 'exec-1', line: 'exec line' });
      emitTauriEvent('query-debug-output', { job_id: 'debug-1', line: 'debug line' });
      emitTauriEvent('n8n-transform-output', { transform_id: 'tf-1', line: 'transform line' });
    });

    // Each stream only has its own line
    expect(execStream.current.lines).toEqual(['exec line']);
    expect(debugStream.current.lines).toEqual(['debug line']);
    expect(transformStream.current.lines).toEqual(['transform line']);

    // Cross-event emission does not leak
    act(() => {
      emitTauriEvent('execution-output', { execution_id: 'debug-1', line: 'should not appear' });
      emitTauriEvent('query-debug-output', { job_id: 'exec-1', line: 'should not appear' });
    });

    expect(execStream.current.lines).toEqual(['exec line']);
    expect(debugStream.current.lines).toEqual(['debug line']);
  });

  it('provider-specific lines maintain content integrity across scenarios', async () => {
    // Claude execution
    const { result: claudeExec } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'execution-output',
        statusEvent: 'execution-status',
        idField: 'execution_id',
      }),
    );

    // Gemini debug
    const { result: geminiDebug } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'query-debug-output',
        statusEvent: 'query-debug-status',
        idField: 'job_id',
      }),
    );

    await act(async () => {
      await claudeExec.current.start('claude-exec-1');
    });
    await act(async () => {
      await geminiDebug.current.start('gemini-debug-1');
    });

    // Stream Claude execution lines
    act(() => {
      emitTauriEvent('execution-output', {
        execution_id: 'claude-exec-1',
        line: 'Session started (claude-sonnet-4-20250514)',
      });
    });

    // Stream Gemini debug lines
    act(() => {
      emitTauriEvent('query-debug-output', {
        job_id: 'gemini-debug-1',
        line: '> Analyzing query error context…',
      });
    });

    expect(claudeExec.current.lines[0]).toContain('claude-sonnet-4');
    expect(geminiDebug.current.lines[0]).toContain('Analyzing query');

    // Complete both
    act(() => {
      emitTauriEvent('execution-status', { execution_id: 'claude-exec-1', status: 'completed' });
      emitTauriEvent('query-debug-status', { job_id: 'gemini-debug-1', status: 'completed' });
    });

    expect(claudeExec.current.phase).toBe('completed');
    expect(geminiDebug.current.phase).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO E: Rapid event bursts — stress test
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: rapid event bursts', () => {
  it('handles 1000 lines in quick succession without data loss', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('burst-1');
    });

    const lineCount = 1000;
    for (let i = 0; i < lineCount; i++) {
      act(() => {
        emitTauriEvent('exec-output', {
          execution_id: 'burst-1',
          line: `Burst line ${i}`,
        });
      });
    }

    expect(result.current.lines).toHaveLength(lineCount);
    expect(result.current.lines[0]).toBe('Burst line 0');
    expect(result.current.lines[lineCount - 1]).toBe(`Burst line ${lineCount - 1}`);
  });
});
