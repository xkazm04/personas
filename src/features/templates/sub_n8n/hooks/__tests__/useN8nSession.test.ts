import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const updateN8nSession = vi.fn(() => Promise.resolve({}));

vi.mock('@/api/templates/n8nTransform', () => ({
  createN8nSession: vi.fn(() => Promise.resolve({ id: 's1' })),
  updateN8nSession: (...args: unknown[]) => updateN8nSession(...(args as [])),
  deleteN8nSession: vi.fn(() => Promise.resolve(true)),
}));

import { useN8nSession } from '../useN8nSession';
import { useN8nImportReducer, type N8nImportState } from '../useN8nImportReducer';
import { N8N_TRANSFORM_CONTEXT_KEY } from '../n8nTypes';
import type { AgentIR } from '@/lib/types/designTypes';

function baseState(): N8nImportState {
  return renderHook(() => useN8nImportReducer()).result.current.state;
}

const parsed: AgentIR = {
  structured_prompt: { identity: '', instructions: '', toolGuidance: '', examples: '', errorHandling: '', customSections: [] },
  suggested_tools: [],
  suggested_triggers: [],
  full_prompt_markdown: '',
  summary: '',
};

describe('useN8nSession unmount flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateN8nSession.mockClear();
    window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the pending debounced DB slice when the wizard unmounts inside the debounce window', () => {
    const state: N8nImportState = {
      ...baseState(),
      sessionId: 's1',
      step: 'analyze',
      parsedResult: parsed,
    };
    const { unmount } = renderHook(() => useN8nSession(state, vi.fn()));

    // Still inside the 600 ms debounce: nothing written yet.
    act(() => { vi.advanceTimersByTime(100); });
    expect(updateN8nSession).not.toHaveBeenCalled();

    unmount();

    expect(updateN8nSession).toHaveBeenCalledTimes(1);
    expect(updateN8nSession).toHaveBeenCalledWith('s1', expect.objectContaining({ step: 'analyze' }));
  });

  it('writes the pending localStorage transform context when the wizard unmounts mid-transform', () => {
    const state: N8nImportState = {
      ...baseState(),
      sessionId: null,
      step: 'transform',
      transforming: true,
      backgroundTransformId: 't1',
      rawWorkflowJson: '{"nodes":[]}',
      parsedResult: parsed,
    };
    const { unmount } = renderHook(() => useN8nSession(state, vi.fn()));

    act(() => { vi.advanceTimersByTime(100); });
    expect(window.localStorage.getItem(N8N_TRANSFORM_CONTEXT_KEY)).toBeNull();

    unmount();

    const saved = window.localStorage.getItem(N8N_TRANSFORM_CONTEXT_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toMatchObject({ transformId: 't1' });
  });
});
