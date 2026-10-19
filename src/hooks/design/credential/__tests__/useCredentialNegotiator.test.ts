import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/i18n/useTranslation', () => ({
  getActiveTranslations: () => ({ errors: { run_superseded: 'SUPERSEDED' } }),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/silentCatch')>()), silentCatch: () => () => {} }));
vi.mock('@/api/vault/negotiator', () => ({
  startCredentialNegotiation: vi.fn(),
  cancelCredentialNegotiation: vi.fn(async () => {}),
  getNegotiationStepHelp: vi.fn(),
}));
vi.mock('@/lib/credentials/credentialRecipeRegistry', () => ({
  saveRecipeFromDesign: vi.fn(async () => {}),
}));

const step = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: '',
  action_type: 'navigate',
  url: null,
  requires_human: false,
  field_fills: null,
  visual_hint: null,
  wait_for: null,
  ...extra,
});

// Original step 1 is a capture step that becomes skipped once its field is prefilled.
const plan = {
  service_name: 'Acme',
  estimated_time_seconds: 60,
  prerequisites: [],
  steps: [
    step('s0'),
    step('s1', { action_type: 'capture', field_fills: { api_key: 'API key' } }),
    step('s2'),
    step('s3'),
    step('s4'),
  ],
  verification_hint: '',
  tips: [],
};

const mockSavePlaybook = vi.fn();
vi.mock('@/hooks/design/core/playbookCache', () => ({
  lookupPlaybook: () => ({ plan }),
  markPlaybookUsed: vi.fn(),
  savePlaybook: (...args: unknown[]) => mockSavePlaybook(...args),
}));

import { useCredentialNegotiator, type NegotiatorContext } from '../useCredentialNegotiator';

const connector = { name: 'acme', label: 'Acme', category: 'x', color: '#000', fields: [], healthcheck_config: null, services: [], events: [] };

beforeEach(() => mockSavePlaybook.mockReset());

describe('useCredentialNegotiator completion', () => {
  it('a step skipped mid-flow does not let "done" fire with an original step never completed', async () => {
    const ctx: { current: NegotiatorContext } = { current: { prefilledValues: {} } };
    const hook = renderHook(() => useCredentialNegotiator(ctx.current));
    await act(async () => {
      await hook.result.current.start('Acme', connector as never, []);
    });
    expect(hook.result.current.visibleSteps).toHaveLength(5);

    // Complete original steps 0, 1, 2.
    for (const i of [0, 1, 2]) act(() => hook.result.current.completeStep(i));
    expect(hook.result.current.phase).toBe('guiding');

    // autoCred fills the capture field: original step 1 becomes skipped, indices shift.
    ctx.current = { prefilledValues: { api_key: 'sk-123' } };
    hook.rerender();
    expect(hook.result.current.visibleSteps).toHaveLength(4); // originals [0, 2, 3, 4]

    // Visible 3 is original 4. Original 3 (visible 2) has not been completed.
    act(() => hook.result.current.completeStep(3));
    expect(hook.result.current.phase).toBe('guiding');
    expect(mockSavePlaybook).not.toHaveBeenCalled();

    act(() => hook.result.current.completeStep(2));
    expect(hook.result.current.phase).toBe('done');
    expect(mockSavePlaybook).toHaveBeenCalledTimes(1);
  });
});
