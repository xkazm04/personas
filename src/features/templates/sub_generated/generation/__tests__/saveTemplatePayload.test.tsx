import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { mergeDraftIntoDesignResult } from '../mergeDraftIntoDesignResult';

const draft = (over: Partial<N8nPersonaDraft> = {}): N8nPersonaDraft => ({
  name: 'Reviewed name',
  description: 'Reviewed summary',
  system_prompt: '# Reviewed prompt',
  structured_prompt: { role: 'reviewed' },
  icon: 'bot',
  color: '#123456',
  model_profile: 'balanced',
  max_budget_usd: 5,
  max_turns: 12,
  design_context: null,
  notification_channels: null,
  ...over,
});

// The generator payload the Review step opens on: four fields the draft also
// owns, plus everything the draft does not carry.
const GENERATED = JSON.stringify({
  structured_prompt: { role: 'generated' },
  full_prompt_markdown: '# Generated prompt',
  summary: 'Generated summary',
  persona_meta: { name: 'Generated name', icon: 'sparkles', color: '#000000', model_profile: null },
  suggested_tools: [{ name: 'gen_tool', category: 'api', description: 'from the generator' }],
  suggested_connectors: [{ name: 'slack', auth_type: 'oauth2' }],
  adoption_requirements: [{ key: 'inbox', label: 'Inbox' }],
  feasibility: { score: 85 },
});

describe('mergeDraftIntoDesignResult', () => {
  it('lets the Review draft win the fields it owns', () => {
    const out = JSON.parse(mergeDraftIntoDesignResult(GENERATED, draft()));

    expect(out.persona_meta.name).toBe('Reviewed name');
    expect(out.persona_meta.max_budget_usd).toBe(5);
    expect(out.persona_meta.max_turns).toBe(12);
    expect(out.structured_prompt).toEqual({ role: 'reviewed' });
    expect(out.full_prompt_markdown).toBe('# Reviewed prompt');
    expect(out.summary).toBe('Reviewed summary');
  });

  it('keeps every generator key the draft does not carry', () => {
    const out = JSON.parse(mergeDraftIntoDesignResult(GENERATED, draft()));

    expect(out.suggested_connectors).toEqual([{ name: 'slack', auth_type: 'oauth2' }]);
    expect(out.adoption_requirements).toEqual([{ key: 'inbox', label: 'Inbox' }]);
    expect(out.feasibility).toEqual({ score: 85 });
    // persona_meta merges rather than replaces.
    expect(out.persona_meta.icon).toBe('bot');
  });

  it('carries notification channels across as the design_result array shape', () => {
    const channels = [{ type: 'slack', description: 'alerts' }];
    const out = JSON.parse(
      mergeDraftIntoDesignResult(GENERATED, draft({ notification_channels: JSON.stringify(channels) })),
    );
    expect(out.suggested_notification_channels).toEqual(channels);
  });

  it('ignores a malformed channel blob instead of failing the save', () => {
    const out = JSON.parse(mergeDraftIntoDesignResult(GENERATED, draft({ notification_channels: '{oops' })));
    expect(out.suggested_notification_channels).toBeUndefined();
    expect(out.persona_meta.name).toBe('Reviewed name');
  });

  it('still produces a complete payload with no generator JSON (live-stream path)', () => {
    const out = JSON.parse(mergeDraftIntoDesignResult('', draft({ tools: [{ name: 't', category: 'api', description: 'd' }] })));
    expect(out.persona_meta.name).toBe('Reviewed name');
    expect(out.persona_meta.max_budget_usd).toBe(5);
    expect(out.full_prompt_markdown).toBe('# Reviewed prompt');
    expect(out.suggested_tools).toEqual([{ name: 't', category: 'api', description: 'd' }]);
  });

  it('falls back to the draft when the generator JSON is unparseable', () => {
    const out = JSON.parse(mergeDraftIntoDesignResult('not json', draft()));
    expect(out.persona_meta.name).toBe('Reviewed name');
  });
});

// -- the save path itself ------------------------------------------------

const saveCustomTemplate = vi.fn(() => Promise.resolve());
vi.mock('@/api/templates/templateAdopt', () => ({
  saveCustomTemplate: (...args: unknown[]) => saveCustomTemplate(...(args as [])),
  generateTemplateBackground: vi.fn(),
  clearTemplateGenerateSnapshot: vi.fn(() => Promise.resolve()),
  cancelTemplateGenerate: vi.fn(),
  getTemplateGenerateSnapshot: vi.fn(),
}));
vi.mock('@/hooks/utility/data/usePersistedContext', () => ({ usePersistedContext: () => {} }));
vi.mock('../useCreateTemplateSnapshot', () => ({ useCreateTemplateSnapshot: () => {} }));

import { useCreateTemplateActions } from '../useCreateTemplateActions';

describe('handleSaveTemplate', () => {
  it('persists the Review edits on top of the generator payload', async () => {
    saveCustomTemplate.mockClear();
    const { result } = renderHook(() => useCreateTemplateActions(true, () => {}));

    act(() => {
      result.current.reducer.setTemplateName('My template');
      result.current.reducer.setDescription('what it does');
    });
    act(() => {
      result.current.reducer.generateCompleted(draft({ name: 'Generated name', max_budget_usd: null }), GENERATED);
    });
    // The operator renames it and sets a budget on Review.
    act(() => {
      result.current.updateDraft((d) => ({ ...d, name: 'Renamed on review', max_budget_usd: 5 }));
    });

    await act(async () => { await result.current.handleSaveTemplate(); });

    expect(saveCustomTemplate).toHaveBeenCalledTimes(1);
    const [name, description, json] = saveCustomTemplate.mock.calls[0] as [string, string, string];
    expect(name).toBe('My template');
    expect(description).toBe('what it does');
    const payload = JSON.parse(json);
    expect(payload.persona_meta.name).toBe('Renamed on review');
    expect(payload.persona_meta.max_budget_usd).toBe(5);
    expect(payload.adoption_requirements).toEqual([{ key: 'inbox', label: 'Inbox' }]);
  });
});
