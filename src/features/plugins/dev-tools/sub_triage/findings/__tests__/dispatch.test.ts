import { describe, it, expect, vi } from 'vitest';

const getIdea = vi.fn();
const reportSystemOpOutcome = vi.fn();
const addToast = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  getIdea: (...a: unknown[]) => getIdea(...a),
  listProjects: vi.fn(), createTask: vi.fn(), executeTask: vi.fn(), updateIdea: vi.fn(),
}));
vi.mock('@/api/fleet/fleet', () => ({ spawnSession: vi.fn() }));
vi.mock('@/api/systemOps', () => ({
  reportSystemOpOutcome: (...a: unknown[]) => reportSystemOpOutcome(...a),
}));
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@/stores/systemStore', () => ({ useSystemStore: { getState: () => ({ activeProjectId: null }) } }));

import { dispatchPrompt, handleSignalDispatchRequested } from '../dispatch';
import type { DevIdea } from '@/lib/bindings/DevIdea';

function idea(over: Partial<DevIdea>): DevIdea {
  return {
    id: 'i1',
    project_id: 'p1',
    title: 'Route summarize-email to a cheaper model',
    description: 'Investigate the call site; route to Haiku if quality holds.',
    evidence: JSON.stringify({ costUsd: 120, thresholdUsd: 5 }),
    ...over,
  } as unknown as DevIdea;
}

describe('dispatchPrompt', () => {
  it('carries the evidence, so the agent can tell whether it actually fixed the thing', () => {
    const p = dispatchPrompt(idea({}));
    expect(p).toContain('Route summarize-email to a cheaper model');
    expect(p).toContain('route to Haiku');
    expect(p).toContain('costUsd');
    // The bar is the number moving — not a plausible-looking diff.
    expect(p).toMatch(/move them, not merely look plausible/i);
  });

  it('degrades cleanly when a finding has no evidence', () => {
    const p = dispatchPrompt(idea({ evidence: null }));
    expect(p).toContain('Route summarize-email');
    expect(p).not.toContain('Evidence this was raised on');
    expect(p).not.toMatch(/null|undefined/);
  });

  it('survives a bare finding (title only)', () => {
    const p = dispatchPrompt(idea({ description: null, evidence: null }));
    expect(p.trim()).toBe('Route summarize-email to a cheaper model');
  });
});

describe('handleSignalDispatchRequested - a failed dispatch', () => {
  it('reports the IPC error text to the automation row, not "[object Object]"', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, never an Error.
    getIdea.mockRejectedValue({ error: 'Idea i9 not found', kind: 'NotFound' });
    reportSystemOpOutcome.mockResolvedValue(true);

    await handleSignalDispatchRequested('i9', 'runner', 'auto-1');

    await vi.waitFor(() => expect(reportSystemOpOutcome).toHaveBeenCalled());
    expect(reportSystemOpOutcome).toHaveBeenCalledWith('auto-1', 'failed', 'Idea i9 not found');
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error');
  });
});
