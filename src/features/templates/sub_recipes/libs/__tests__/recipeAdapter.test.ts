import { describe, it, expect } from 'vitest';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { recipeDefinitionToRecipe, recipeDefinitionsToRecipes } from '../recipeAdapter';

function defWithPrompt(prompt: object | string, overrides: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    id: 'r1',
    project_id: 'default',
    credential_id: null,
    use_case_id: null,
    name: 'Test Recipe',
    description: 'A short description.',
    category: null,
    prompt_template: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
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
    source_version: null,
    ...overrides,
  };
}

describe('recipeDefinitionToRecipe', () => {
  it('passes through top-level fields', () => {
    const r = recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }));
    expect(r.id).toBe('r1');
    expect(r.name).toBe('Test Recipe');
    expect(r.description).toBe('A short description.');
    // No category in the source → defaults to 'automation'.
    expect(r.category).toBe('automation');
  });

  it('coerces unknown categories to automation', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc' }, { category: 'something-weird' }),
    );
    expect(r.category).toBe('automation');
  });

  it('maps known category aliases to canonical buckets', () => {
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'workflow' })).category)
      .toBe('automation');
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'reports' })).category)
      .toBe('reporting');
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'observability' })).category)
      .toBe('monitoring');
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'personal_productivity' })).category)
      .toBe('productivity');
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'writing' })).category)
      .toBe('content');
    expect(recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }, { category: 'build' })).category)
      .toBe('development');
  });

  it('prefers the UC title over the technical row name', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc_approval_workflow', title: 'Approval Workflow' }, { name: 'uc_approval_workflow' }),
    );
    expect(r.name).toBe('Approval Workflow');
    expect(r.slug).toBe('approval-workflow');
    expect(r.template.title).toBe('Approval Workflow');
  });

  it('prefers the UC category over the (usually null) row category', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc', category: 'research' }, { category: null }),
    );
    expect(r.category).toBe('analysis');
    // Raw UC category is preserved on the adopted-template shape.
    expect(r.template.category).toBe('research');
  });

  it('uses the UC capability_summary as the browse tagline', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc', capability_summary: 'Tracks invoices end to end.' }),
    );
    expect(r.summary).toBe('Tracks invoices end to end.');
  });

  it('extracts review/memory policies and derives generation settings', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        review_policy: { mode: 'on_low_confidence', context: 'Reviewed when unsure.' },
        memory_policy: { enabled: true, context: 'Remembers approver stats.' },
        error_handling: 'Retry once, then flag.',
      }),
    );
    expect(r.template.reviewPolicy).toEqual({ mode: 'on_low_confidence', context: 'Reviewed when unsure.' });
    expect(r.template.memoryPolicy).toEqual({ enabled: true, context: 'Remembers approver stats.' });
    expect(r.template.errorHandling).toBe('Retry once, then flag.');
    expect(r.template.generationSettings).toEqual({ reviews: 'trust_llm', memories: 'on' });
  });

  it('maps never-review + disabled memory to off settings', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        review_policy: { mode: 'never' },
        memory_policy: { enabled: false },
      }),
    );
    expect(r.template.generationSettings).toEqual({ reviews: 'off', memories: 'off' });
  });

  it('leaves generation settings undefined when the UC declares no policies', () => {
    const r = recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }));
    expect(r.template.generationSettings).toBeUndefined();
    expect(r.template.reviewPolicy).toBeUndefined();
  });

  it('extracts event subscriptions, dropping malformed entries', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        event_subscriptions: [
          { event_type: 'access.request.received', direction: 'listen', description: 'Incoming.' },
          { event_type: 'access.request.approved', direction: 'emit' },
          { event_type: 'bad.direction', direction: 'sideways' },
          { direction: 'emit' },
        ],
      }),
    );
    expect(r.template.eventSubscriptions).toEqual([
      { eventType: 'access.request.received', direction: 'listen', description: 'Incoming.' },
      { eventType: 'access.request.approved', direction: 'emit', description: undefined },
    ]);
  });

  it('extracts input parameters with display-ready defaults', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        input_schema: [
          { name: 'timeout_hours', type: 'number', default: 48, description: 'Approval timeout.' },
          { name: 'strict_mode', type: 'boolean', default: true },
          { type: 'number', default: 1 },
        ],
      }),
    );
    expect(r.template.inputParameters).toEqual([
      { name: 'timeout_hours', type: 'number', defaultValue: '48', description: 'Approval timeout.' },
      { name: 'strict_mode', type: 'boolean', defaultValue: 'true', description: undefined },
    ]);
  });

  it('omits events/parameters when absent from the UC', () => {
    const r = recipeDefinitionToRecipe(defWithPrompt({ id: 'uc' }));
    expect(r.template.eventSubscriptions).toBeUndefined();
    expect(r.template.inputParameters).toBeUndefined();
  });

  it('extracts tool_hints from the prompt_template UC', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc', tool_hints: ['file_read', 'gmail_search'] }),
    );
    expect(r.template.toolHints).toEqual(['file_read', 'gmail_search']);
  });

  it('parses string-array connectors', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc', connectors: ['slack', 'github'] }),
    );
    expect(r.requiredConnectors).toEqual(['slack', 'github']);
    expect(r.iconConnector).toBe('slack');
  });

  it('parses object-shape connectors via name field', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        connectors: [{ name: 'gmail', label: 'Gmail' }, { name: 'notion' }],
      }),
    );
    expect(r.requiredConnectors).toEqual(['gmail', 'notion']);
  });

  it('extracts suggested_trigger and coerces unknown types to manual', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        suggested_trigger: {
          trigger_type: 'schedule',
          config: { cron: '0 9 * * *' },
          description: 'Daily 9am',
        },
      }),
    );
    expect(r.template.suggestedTrigger).toEqual({
      type: 'schedule',
      cron: '0 9 * * *',
      description: 'Daily 9am',
    });
  });

  it('coerces event_listener trigger to webhook (frontend taxonomy gap)', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        suggested_trigger: { trigger_type: 'event_listener', description: 'On event' },
      }),
    );
    expect(r.template.suggestedTrigger?.type).toBe('webhook');
  });

  it('forwards only recognized notification channel types', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({
        id: 'uc',
        notification_channels: [
          { type: 'slack' },
          { type: 'discord' }, // unknown — should be filtered
          { type: 'email' },
          { type: 'built-in' }, // unknown — should be filtered
        ],
      }),
    );
    expect(r.template.notificationChannelTypes).toEqual(['slack', 'email']);
  });

  it('degrades gracefully on malformed prompt_template', () => {
    const r = recipeDefinitionToRecipe(defWithPrompt('not valid json {{'));
    expect(r.template.toolHints).toEqual([]);
    expect(r.requiredConnectors).toEqual([]);
    expect(r.template.suggestedTrigger).toBeUndefined();
    // Still produces a valid Recipe.
    expect(r.id).toBe('r1');
    expect(r.name).toBe('Test Recipe');
  });

  it('parses tags from JSON-encoded array', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc' }, { tags: '["incident-logger","derived"]' }),
    );
    expect(r.tags).toEqual(['incident-logger', 'derived']);
  });

  it('returns empty tags on malformed JSON', () => {
    const r = recipeDefinitionToRecipe(
      defWithPrompt({ id: 'uc' }, { tags: 'not json' }),
    );
    expect(r.tags).toEqual([]);
  });
});

describe('recipeDefinitionsToRecipes', () => {
  it('batch-adapts in order', () => {
    const defs: RecipeDefinition[] = [
      defWithPrompt({ id: 'uc1' }, { id: 'a', name: 'A' }),
      defWithPrompt({ id: 'uc2' }, { id: 'b', name: 'B' }),
    ];
    const recipes = recipeDefinitionsToRecipes(defs);
    expect(recipes.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('survives one bad entry without dropping the rest', () => {
    const defs: RecipeDefinition[] = [
      defWithPrompt('not valid {{', { id: 'bad' }),
      defWithPrompt({ id: 'uc' }, { id: 'good', name: 'Good' }),
    ];
    const recipes = recipeDefinitionsToRecipes(defs);
    expect(recipes).toHaveLength(2);
    expect(recipes[1].name).toBe('Good');
  });
});
