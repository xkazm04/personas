import { describe, it, expect, vi, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ silentCatch: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: (...a: unknown[]) => h.silentCatch(...a) }));

import { buildDraft } from '../PersonaDraft';

afterEach(() => { vi.restoreAllMocks(); });

describe('buildDraft with a corrupt model_profile', () => {
  it('resets the model fields and reports through the shared silentCatch door', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Other modules build their own handlers at import time, so only calls
    // made by this buildDraft are counted.
    h.silentCatch.mockClear();
    const d = buildDraft({ name: 'x', enabled: true, model_profile: '{not json' });
    expect(d.selectedProvider).toBe('anthropic');
    expect(d.selectedModel).toBe('');
    // A breadcrumb and a swallow sample, not a console line nothing collects.
    expect(h.silentCatch).toHaveBeenCalledTimes(1);
    expect(String(h.silentCatch.mock.calls[0]?.[0])).toMatch(/PersonaDraft/);
    expect(warn).not.toHaveBeenCalled();
  });
});
