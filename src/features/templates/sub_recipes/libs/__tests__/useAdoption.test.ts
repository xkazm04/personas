import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { Recipe } from '../../types';

const mocks = vi.hoisted(() => ({
  applyPersonaOp: vi.fn(),
  fetchDetail: vi.fn(),
  syncCapabilityParameters: vi.fn(),
  addToast: vi.fn(),
  toastCatchError: vi.fn(),
  useCases: [] as DesignUseCase[],
}));

vi.mock('@/stores/agentStore', () => {
  const state = {
    personas: [{ id: 'p1', design_context: null }],
    selectedPersona: { id: 'p1', design_context: null },
    applyPersonaOp: mocks.applyPersonaOp,
    fetchDetail: mocks.fetchDetail,
  };
  return {
    useAgentStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));

vi.mock('@/features/agents/sub_lab/use-cases/UseCasesList', () => ({
  parseDesignContext: () => ({ useCases: mocks.useCases }),
  serializeDesignContext: JSON.stringify,
}));

vi.mock('@/api/agents/personaParameters', () => ({
  syncCapabilityParameters: mocks.syncCapabilityParameters,
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { recipes_catalog: {
      adopted_toast: '{title} adopted',
      removed_toast: '{title} removed',
      already_adopted_toast: '{title} already adopted',
    } },
    tx: (template: string, values: { title: string }) => template.replace('{title}', values.title),
  }),
}));

vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => (err: unknown) => mocks.toastCatchError(err),
  silentCatch: () => () => {},
  silentCatchNull: () => () => null,
}));

import { recipeToUseCase, useAdoption } from '../useAdoption';

const recipe: Recipe = {
  id: 'r1', slug: 'recipe', name: 'Recipe', summary: '', description: '',
  category: 'automation', requiredConnectors: [], optionalConnectors: [],
  bindings: [], isBuiltin: true, version: '1.0.0', publishedAt: '', author: '', tags: [],
  template: {
    title: 'Recipe', description: '', capabilitySummary: '', category: 'automation',
    toolHints: [], notificationChannelTypes: [], promptTemplate: '',
  },
};

describe('useAdoption failed design_context writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyPersonaOp.mockRejectedValue(new Error('write failed'));
    mocks.syncCapabilityParameters.mockResolvedValue(undefined);
    mocks.fetchDetail.mockResolvedValue(undefined);
    mocks.useCases = [];
  });

  it('does not report adoption or sync parameters after a failed write', async () => {
    const { result } = renderHook(() => useAdoption());
    let adopted: Awaited<ReturnType<typeof result.current.adopt>> = null;
    await act(async () => { adopted = await result.current.adopt('p1', recipe, {}); });

    expect(mocks.applyPersonaOp).toHaveBeenCalledTimes(1);
    expect(adopted).toBeNull();
    expect(mocks.toastCatchError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }));
    expect(mocks.addToast).not.toHaveBeenCalledWith('Recipe adopted', 'success');
    expect(mocks.syncCapabilityParameters).not.toHaveBeenCalled();
    expect(mocks.fetchDetail).not.toHaveBeenCalled();
  });

  it('does not report removal or sync parameters after a failed write', async () => {
    mocks.useCases = [recipeToUseCase(recipe, {})];
    const { result } = renderHook(() => useAdoption());
    let removed = true;
    await act(async () => { removed = await result.current.remove('p1', recipe); });

    expect(mocks.applyPersonaOp).toHaveBeenCalledTimes(1);
    expect(removed).toBe(false);
    expect(mocks.toastCatchError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }));
    expect(mocks.addToast).not.toHaveBeenCalledWith('Recipe removed', 'success');
    expect(mocks.syncCapabilityParameters).not.toHaveBeenCalled();
    expect(mocks.fetchDetail).not.toHaveBeenCalled();
  });
});
