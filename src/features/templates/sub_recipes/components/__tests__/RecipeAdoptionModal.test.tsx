/**
 * The adoption form is only as good as the manifest it is handed.
 *
 * `RecipeAdoptionModal` renders one control per `recipe.bindings` entry and
 * nothing else — it has no knowledge of `input_schema`. So the thing worth
 * asserting end to end is the JOIN: a catalog row whose payload declares
 * settings must arrive at this modal as fillable controls, and the value the
 * operator types must reach `adopt`. Before the adapter derived bindings the
 * list was always empty and this whole section of the modal was dead code
 * against real data, which a component test that hand-builds a `Recipe`
 * fixture would never have noticed.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

const adoptSpy = vi.fn(async () => ({ useCaseId: 'uc-1' }));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedPersona: { id: 'p1', name: 'Persona' } }),
}));

vi.mock('../../useEligibility', () => ({
  useRecipeEligibility: () => ({ state: 'eligible' as const }),
}));

vi.mock('../../libs/useAdoption', () => ({
  useAdoption: () => ({ adopt: adoptSpy, remove: vi.fn(), pending: false }),
}));

vi.mock('@/lib/connectors/connectorMeta', () => ({
  ConnectorIcon: () => <span />,
  getConnectorMeta: (name: string) => ({ label: name, color: '#888888', iconUrl: null, Icon: () => null }),
}));

import { RecipeAdoptionModal } from '../RecipeAdoptionModal';
import { recipeDefinitionToRecipe } from '../../libs/recipeAdapter';

function defWith(payload: object): RecipeDefinition {
  return {
    id: 'r1',
    project_id: 'default',
    credential_id: null,
    use_case_id: null,
    name: 'Approval chain',
    description: 'Routes an access request.',
    category: null,
    prompt_template: JSON.stringify(payload),
    input_schema: null,
    output_contract: null,
    tool_requirements: null,
    credential_requirements: null,
    model_preference: null,
    sample_inputs: null,
    tags: null,
    icon: null,
    color: null,
    is_builtin: true,
    created_at: '2026-05-09T00:00:00Z',
    updated_at: '2026-05-09T00:00:00Z',
    source_template_id: null,
    source_use_case_id: null,
    source_use_case_name: null,
    source_version: '1.0.0',
  };
}

const TWO_PARAM_RECIPE = defWith({
  id: 'uc',
  title: 'Approval chain',
  inputSchema: [
    { name: 'timeout_hours', type: 'number', default: 48, min: 4, max: 168, description: 'Approval timeout.' },
    { name: 'access_level_scheme', type: 'text', description: 'Access-level vocabulary.' },
  ],
});

afterEach(() => {
  cleanup();
  adoptSpy.mockClear();
});

describe('RecipeAdoptionModal over an adapted catalog recipe', () => {
  it('renders one control per declared setting', () => {
    const recipe = recipeDefinitionToRecipe(TWO_PARAM_RECIPE);
    expect(recipe.bindings).toHaveLength(2);

    render(<RecipeAdoptionModal recipe={recipe} onClose={() => {}} />);

    expect(screen.getByText('Timeout hours')).toBeTruthy();
    expect(screen.getByText('Access level scheme')).toBeTruthy();
    // The number field is pre-filled from the schema's own default.
    expect(screen.getByDisplayValue('48')).toBeTruthy();
  });

  it('hands the operator-entered value to adopt', () => {
    const recipe = recipeDefinitionToRecipe(TWO_PARAM_RECIPE);
    render(<RecipeAdoptionModal recipe={recipe} onClose={() => {}} />);

    const textInputs = screen
      .getAllByRole('textbox')
      .filter((el) => el.getAttribute('type') !== 'number');
    fireEvent.change(textInputs[0], { target: { value: 'Viewer, Editor, Owner' } });
    fireEvent.click(screen.getByText('Adopt recipe').closest('button')!);

    expect(adoptSpy).toHaveBeenCalledTimes(1);
    const [personaId, adopted, values] = adoptSpy.mock.calls[0] as unknown as [
      string,
      { id: string },
      Record<string, unknown>,
    ];
    expect(personaId).toBe('p1');
    expect(adopted.id).toBe('r1');
    expect(values).toMatchObject({
      timeout_hours: 48,
      access_level_scheme: 'Viewer, Editor, Owner',
    });
  });

  it('renders a switch for a declared boolean setting', () => {
    const recipe = recipeDefinitionToRecipe(
      defWith({ id: 'uc', inputSchema: [{ name: 'audit_enabled', type: 'boolean', default: true }] }),
    );
    render(<RecipeAdoptionModal recipe={recipe} onClose={() => {}} />);

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Audit enabled');
  });

  it('renders no settings block for a recipe that declares none', () => {
    const recipe = recipeDefinitionToRecipe(defWith({ id: 'uc', title: 'Plain' }));
    expect(recipe.bindings).toEqual([]);
    render(<RecipeAdoptionModal recipe={recipe} onClose={() => {}} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
