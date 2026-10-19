/**
 * "What it needs" over a real catalog row. The seeded corpus is v3: settings
 * come from `inputSchema` and no row names a connector slug, so the card must
 * list each declared setting once and must not print a connectors heading
 * over an empty strip.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

vi.mock('@/lib/connectors/connectorMeta', () => ({
  ConnectorIcon: () => <span />,
  getConnectorMeta: (name: string) => ({ label: name, color: '#888888', iconUrl: null, Icon: () => null }),
}));

import { RecipeNeedsCard } from '../detail/RecipeNeedsCard';
import { recipeDefinitionToRecipe } from '../../libs/recipeAdapter';

function defWith(payload: object): RecipeDefinition {
  return {
    id: 'r1', project_id: 'default', credential_id: null, use_case_id: null,
    name: 'Approval chain', description: 'Routes an access request.', category: null,
    prompt_template: JSON.stringify(payload), input_schema: null, output_contract: null,
    tool_requirements: null, credential_requirements: null, model_preference: null,
    sample_inputs: null, tags: null, icon: null, color: null, is_builtin: true,
    created_at: '2026-05-09T00:00:00Z', updated_at: '2026-05-09T00:00:00Z',
    source_template_id: null, source_use_case_id: null, source_use_case_name: null,
    source_version: '1.0.0',
  };
}

afterEach(cleanup);

describe('RecipeNeedsCard', () => {
  it('lists each declared setting once, with its default', () => {
    const recipe = recipeDefinitionToRecipe(defWith({
      id: 'uc',
      title: 'Approval chain',
      inputSchema: [
        { name: 'timeout_hours', type: 'number', default: 48, description: 'Approval timeout.' },
        { name: 'access_level_scheme', type: 'text', description: 'Access-level vocabulary.' },
      ],
    }));
    render(<RecipeNeedsCard recipe={recipe} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Default: 48')).toBeTruthy();
  });

  it('prints no required-connectors heading when the recipe needs none', () => {
    const recipe = recipeDefinitionToRecipe(defWith({ id: 'uc', title: 'Plain' }));
    expect(recipe.requiredConnectors).toEqual([]);
    render(<RecipeNeedsCard recipe={recipe} />);

    expect(screen.queryByText('Required connectors')).toBeNull();
  });
});
