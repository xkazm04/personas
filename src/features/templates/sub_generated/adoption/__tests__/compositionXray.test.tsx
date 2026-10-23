import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/stores/pipelineStore', () => {
  const state = {
    recipes: [{ id: 'r1', name: 'Approval chain' }, { id: 'r2', name: 'Weekly digest' }],
    fetchRecipes: async () => {},
  };
  return { usePipelineStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { foundry: { xray_tooltip: 'tip', xray_label: '{count} recipes' } },
    tx: (tpl: string, v: Record<string, unknown>) => tpl.replace('{count}', String(v.count)),
  }),
}));

import { CompositionXray } from '../CompositionXray';

describe('CompositionXray', () => {
  it('names the recipes of a raw recipe_ref payload', () => {
    render(<CompositionXray designResult={{ use_cases: [{ recipe_ref: { id: 'r1' } }] }} />);
    expect(screen.getByTestId('composition-xray')).toBeTruthy();
    expect(screen.getByText('Approval chain')).toBeTruthy();
  });

  it('stays mounted after hydration inlines the use cases', () => {
    // The shape useHydratedDesignResult hands over once list_recipes lands:
    // no recipe_ref, the recipe id kept as the provenance stamp.
    const hydrated = {
      use_cases: [
        { id: 'uc1', title: 'A', source_recipe_id: 'r1' },
        { id: 'uc2', title: 'B', source_recipe_id: 'r2' },
      ],
    };
    render(<CompositionXray designResult={hydrated} />);
    expect(screen.getByText('2 recipes')).toBeTruthy();
    expect(screen.getByText('Weekly digest')).toBeTruthy();
  });

  it('renders nothing for a legacy inline payload with no recipe link', () => {
    const { container } = render(<CompositionXray designResult={{ use_cases: [{ id: 'uc1' }] }} />);
    expect(container.innerHTML).toBe('');
  });
});
