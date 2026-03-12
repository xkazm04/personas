/**
 * E2E: AI Healing Stream -- self-healing diagnostics lifecycle.
 *
 * Tests the useAiHealingStream hook that monitors background AI healing
 * events, tracking diagnosis phase transitions, fix application, and
 * retry recommendations. This is a dev-mode feature that shows as a
 * TerminalStrip below the main execution output.
 *
 * Run: `npm test -- src/test/e2e/cli-healing-stream.e2e.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import {
  installTauriEventEmitter,
  emitTauriEvent,
  teardownTauriEventEmitter,
} from '../helpers/tauriEventEmitter';
import {
  AI_HEALING_SUCCESS_LINES,
  AI_HEALING_MANUAL_LINES,
} from '../helpers/cliFixtures';

beforeEach(() => {
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
});

// ===========================================================================
// 1. Initial state
// ===========================================================================

describe('E2E: useAiHealingStream -- initial state', () => {
  it('starts idle with empty state', () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    expect(result.current.phase).toBe('idle');
    expect(result.current.lines).toEqual([]);
    expect(result.current.lastLine).toBe('');
    expect(result.current.diagnosis).toBeNull();
    expect(result.current.fixesApplied).toEqual([]);
    expect(result.current.shouldRetry).toBe(false);
    expect(result.current.executionId).toBeNull();
  });
});

// ===========================================================================
// 2. Full healing lifecycle -- successful auto-fix
// ===========================================================================

describe('E2E: successful AI healing lifecycle', () => {
  it('progresses through all healing phases with line accumulation', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    // Allow async setup to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Phase: started
    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'started',
        execution_id: 'exec-fail-1',
      });
    });

    expect(result.current.phase).toBe('started');
    expect(result.current.executionId).toBe('exec-fail-1');

    // Emit diagnostic lines
    for (const line of AI_HEALING_SUCCESS_LINES.slice(0, 3)) {
      act(() => {
        emitTauriEvent('ai-healing-output', {
          persona_id: 'persona-1',
          line,
        });
      });
    }

    expect(result.current.lines).toHaveLength(3);
    expect(result.current.lastLine).toBe(AI_HEALING_SUCCESS_LINES[2]);

    // Phase: diagnosing
    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'diagnosing',
        diagnosis: 'Missing API credential for Slack connector',
      });
    });

    expect(result.current.phase).toBe('diagnosing');
    expect(result.current.diagnosis).toBe('Missing API credential for Slack connector');

    // Emit more lines
    for (const line of AI_HEALING_SUCCESS_LINES.slice(3)) {
      act(() => {
        emitTauriEvent('ai-healing-output', {
          persona_id: 'persona-1',
          line,
        });
      });
    }

    expect(result.current.lines).toHaveLength(AI_HEALING_SUCCESS_LINES.length);

    // Phase: applying
    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'applying',
        fixes_applied: ['credential_rotation'],
      });
    });

    expect(result.current.phase).toBe('applying');
    expect(result.current.fixesApplied).toEqual(['credential_rotation']);

    // Phase: completed
    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'completed',
        should_retry: true,
        fixes_applied: ['credential_rotation', 'config_update'],
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.shouldRetry).toBe(true);
    expect(result.current.fixesApplied).toEqual(['credential_rotation', 'config_update']);
  });
});

// ===========================================================================
// 3. Manual fix required -- no auto-fix possible
// ===========================================================================

describe('E2E: manual fix healing lifecycle', () => {
  it('completes without retry when auto-fix is not possible', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-2'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-2',
        phase: 'started',
        execution_id: 'exec-fail-2',
      });
    });

    for (const line of AI_HEALING_MANUAL_LINES) {
      act(() => {
        emitTauriEvent('ai-healing-output', { persona_id: 'persona-2', line });
      });
    }

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-2',
        phase: 'diagnosing',
        diagnosis: 'Rate limit exceeded -- requires manual plan upgrade',
      });
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-2',
        phase: 'completed',
        should_retry: false,
        fixes_applied: [],
      });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.shouldRetry).toBe(false);
    expect(result.current.fixesApplied).toEqual([]);
    expect(result.current.diagnosis).toBe('Rate limit exceeded -- requires manual plan upgrade');
    expect(result.current.lines).toEqual(AI_HEALING_MANUAL_LINES);
  });
});

// ===========================================================================
// 4. Failed healing
// ===========================================================================

describe('E2E: failed healing', () => {
  it('transitions to failed phase when healing itself fails', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-3'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-3',
        phase: 'started',
        execution_id: 'exec-fail-3',
      });
    });

    act(() => {
      emitTauriEvent('ai-healing-output', {
        persona_id: 'persona-3',
        line: '> Starting AI healing diagnosis...',
      });
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-3',
        phase: 'failed',
      });
    });

    expect(result.current.phase).toBe('failed');
    expect(result.current.lines).toHaveLength(1);
  });
});

// ===========================================================================
// 5. Persona ID scoping -- events from other personas are ignored
// ===========================================================================

describe('E2E: persona ID scoping', () => {
  it('ignores output events from different persona IDs', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-target'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-output', {
        persona_id: 'persona-target',
        line: 'correct',
      });
      emitTauriEvent('ai-healing-output', {
        persona_id: 'persona-other',
        line: 'wrong',
      });
    });

    expect(result.current.lines).toEqual(['correct']);
  });

  it('ignores status events from different persona IDs', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-target'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-other',
        phase: 'completed',
        should_retry: true,
      });
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.shouldRetry).toBe(false);
  });
});

// ===========================================================================
// 6. Persona change -- state resets
// ===========================================================================

describe('E2E: persona change resets state', () => {
  it('resets all healing state when persona ID changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useAiHealingStream(id),
      { initialProps: { id: 'persona-A' } },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-A',
        phase: 'diagnosing',
        diagnosis: 'some issue',
      });
      emitTauriEvent('ai-healing-output', {
        persona_id: 'persona-A',
        line: 'diagnostic line',
      });
    });

    expect(result.current.phase).toBe('diagnosing');
    expect(result.current.lines).toHaveLength(1);

    // Change persona
    rerender({ id: 'persona-B' });

    // State should be reset
    expect(result.current.phase).toBe('idle');
    expect(result.current.lines).toEqual([]);
    expect(result.current.diagnosis).toBeNull();
  });
});

// ===========================================================================
// 7. Buffer limits -- MAX_LINES = 500
// ===========================================================================

describe('E2E: healing stream buffer limits', () => {
  it('caps lines at 500 and evicts oldest', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Emit 510 lines
    for (let i = 1; i <= 510; i++) {
      act(() => {
        emitTauriEvent('ai-healing-output', {
          persona_id: 'persona-1',
          line: `Healing line ${i}`,
        });
      });
    }

    expect(result.current.lines.length).toBeLessThanOrEqual(500);
    expect(result.current.lastLine).toBe('Healing line 510');
    expect(result.current.lines[result.current.lines.length - 1]).toBe('Healing line 510');
  });
});

// ===========================================================================
// 8. Line truncation -- MAX_LINE_LENGTH = 4096
// ===========================================================================

describe('E2E: healing line truncation', () => {
  it('truncates lines exceeding 4096 characters', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const longLine = 'Y'.repeat(5000);
    act(() => {
      emitTauriEvent('ai-healing-output', {
        persona_id: 'persona-1',
        line: longLine,
      });
    });

    const stored = result.current.lines[0];
    expect(stored.length).toBeLessThanOrEqual(4096 + '...[truncated]'.length);
    expect(stored).toContain('...[truncated]');
  });

  it('ignores empty and whitespace-only lines', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-output', { persona_id: 'persona-1', line: '' });
      emitTauriEvent('ai-healing-output', { persona_id: 'persona-1', line: '   ' });
      emitTauriEvent('ai-healing-output', { persona_id: 'persona-1', line: 'actual' });
    });

    expect(result.current.lines).toEqual(['actual']);
  });
});

// ===========================================================================
// 9. Incremental status payload -- partial updates preserve existing state
// ===========================================================================

describe('E2E: incremental status payload updates', () => {
  it('preserves diagnosis when subsequent status lacks it', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'diagnosing',
        diagnosis: 'Root cause found',
      });
    });

    expect(result.current.diagnosis).toBe('Root cause found');

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'applying',
        // No diagnosis in this payload -- should preserve previous
      });
    });

    expect(result.current.phase).toBe('applying');
    expect(result.current.diagnosis).toBe('Root cause found');
  });

  it('preserves executionId across phase transitions', async () => {
    const { result } = renderHook(() => useAiHealingStream('persona-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'started',
        execution_id: 'exec-42',
      });
    });

    act(() => {
      emitTauriEvent('ai-healing-status', {
        persona_id: 'persona-1',
        phase: 'completed',
        should_retry: true,
      });
    });

    expect(result.current.executionId).toBe('exec-42');
  });
});
