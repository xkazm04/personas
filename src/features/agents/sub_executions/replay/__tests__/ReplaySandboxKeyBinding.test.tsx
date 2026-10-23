/**
 * THE REPLAY SHORTCUTS BIND ONCE, NOT ONCE PER RENDER.
 *
 * The keydown effect depended on `actions`, an object rebuilt on every render
 * of the replay hook, so the window listener was removed and re-added on every
 * scrub and on every playback flush (~12 a second). The comment above it said
 * the opposite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';

vi.mock('@/api/agents/executions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getExecutionLogLines: vi.fn().mockResolvedValue([]),
}));

import { ReplaySandbox } from '../ReplaySandbox';

let addSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  addSpy = vi.spyOn(window, 'addEventListener');
});
afterEach(() => {
  addSpy.mockRestore();
});

const keydownBindings = () => addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

describe('ReplaySandbox keyboard shortcuts', () => {
  it('scrubbing five times does not re-bind the window listener', async () => {
    const execution = {
      id: 'e1', persona_id: 'p1', duration_ms: 60_000, cost_usd: 0.5,
      tool_steps: null, input_data: null,
    } as unknown as PersonaExecution;

    render(<ReplaySandbox execution={execution} />);
    await act(async () => { await Promise.resolve(); });
    const before = keydownBindings();

    for (let i = 0; i < 5; i++) {
      act(() => { fireEvent.keyDown(document.body, { key: 'ArrowRight' }); });
    }

    expect(keydownBindings()).toBe(before);
  });
});
