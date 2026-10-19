import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const listRecipes = vi.fn();
vi.mock('@/api/recipes/recipes', () => ({ listRecipes: () => listRecipes() }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

import { useHydratedDesignResult } from '../useHydratedDesignResult';

const WITH_REFS = JSON.stringify({
  use_cases: [{ recipe_ref: { id: 'r1', bindings: { channel: 'ops' } } }],
});
const WITHOUT_REFS = JSON.stringify({ use_cases: [] });
const RECIPE = { id: 'r1', prompt_template: JSON.stringify({ id: 'uc1', title: 'Post to {{channel}}' }) };

describe('adoption recipe-ref hydration', () => {
  beforeEach(() => {
    listRecipes.mockReset();
  });

  it('reports a failed recipe lookup instead of looking like an empty template', async () => {
    listRecipes.mockImplementation(async () => { throw new Error('ipc down'); });
    const { result } = renderHook(() => useHydratedDesignResult(WITH_REFS));
    await waitFor(() => expect(result.current.failed).toBe(true));
    // The raw parse survives so adoption is not blocked.
    expect(result.current.result).not.toBeNull();
  });

  it('does not flag failure for a template that genuinely declares nothing', async () => {
    listRecipes.mockResolvedValue([]);
    const { result } = renderHook(() => useHydratedDesignResult(WITHOUT_REFS));
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.failed).toBe(false);
    expect(listRecipes).not.toHaveBeenCalled();
  });

  it('clears the failure when retry succeeds', async () => {
    listRecipes.mockImplementationOnce(async () => { throw new Error('ipc down'); }).mockResolvedValue([RECIPE]);
    const { result } = renderHook(() => useHydratedDesignResult(WITH_REFS));
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.failed).toBe(false));
    const ucs = result.current.result?.use_cases as Array<Record<string, unknown>>;
    expect(ucs[0]?.title).toBe('Post to ops');
  });

  it('hydrates and applies bindings on the happy path', async () => {
    listRecipes.mockResolvedValue([RECIPE]);
    const { result } = renderHook(() => useHydratedDesignResult(WITH_REFS));
    await waitFor(() => {
      const ucs = result.current.result?.use_cases as Array<Record<string, unknown>>;
      expect(ucs[0]?.title).toBe('Post to ops');
    });
    expect(result.current.failed).toBe(false);
  });
});

describe('adoption hydration keeps recipe provenance (parity with template_v3.rs)', () => {
  beforeEach(() => {
    listRecipes.mockReset();
  });

  it('stamps source_recipe_id and source_recipe_version onto the inlined use case', async () => {
    listRecipes.mockResolvedValue([RECIPE]);
    const json = JSON.stringify({
      use_cases: [{ recipe_ref: { id: 'r1', version: '3', bindings: { channel: 'ops' } } }],
    });
    const { result } = renderHook(() => useHydratedDesignResult(json));
    await waitFor(() => {
      const ucs = result.current.result?.use_cases as Array<Record<string, unknown>>;
      expect(ucs[0]?.title).toBe('Post to ops');
    });
    const uc = (result.current.result?.use_cases as Array<Record<string, unknown>>)[0]!;
    expect(uc.source_recipe_id).toBe('r1');
    expect(uc.source_recipe_version).toBe('3');
    expect('recipe_ref' in uc).toBe(false);
  });

  it('never overwrites provenance the recipe body already carries', async () => {
    listRecipes.mockResolvedValue([
      { id: 'r1', prompt_template: JSON.stringify({ id: 'uc1', source_recipe_id: 'origin' }) },
    ]);
    const { result } = renderHook(() => useHydratedDesignResult(WITH_REFS));
    await waitFor(() => {
      const ucs = result.current.result?.use_cases as Array<Record<string, unknown>>;
      expect(ucs[0]?.id).toBe('uc1');
    });
    const uc = (result.current.result?.use_cases as Array<Record<string, unknown>>)[0]!;
    expect(uc.source_recipe_id).toBe('origin');
    expect('source_recipe_version' in uc).toBe(false);
  });
});
