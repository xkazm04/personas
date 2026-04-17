import { useCallback, useState } from 'react';
import { Play, Download, Save, Check, Database } from 'lucide-react';
import { RecipePageFlipLoader } from '../../shared/RecipePageFlipLoader';
import { SchemaParseErrorBanner } from '../../shared/SchemaParseErrorBanner';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { updateRecipe } from '@/api/templates/recipes';
import type { InputField } from './recipeTestHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeInputSectionProps {
  recipe: RecipeDefinition;
  fields: InputField[];
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  freeInput: string;
  onFreeInputChange: (value: string) => void;
  mockValues: Record<string, unknown> | null;
  running: boolean;
  executionPhase: string;
  onExecute: () => void;
  onSetFieldValues: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  schemaParseError?: string | null;
}

export function RecipeInputSection({
  recipe,
  fields,
  fieldValues,
  onFieldChange,
  freeInput,
  onFreeInputChange,
  mockValues,
  running,
  executionPhase,
  onExecute,
  onSetFieldValues,
  schemaParseError,
}: RecipeInputSectionProps) {
  const { t } = useTranslation();
  const [mockSaved, setMockSaved] = useState(false);

  const handleLoadMockValues = useCallback(() => {
    if (!recipe.sample_inputs) return;
    try {
      const mock = JSON.parse(recipe.sample_inputs) as Record<string, string>;
      onSetFieldValues((prev) => ({ ...prev, ...mock }));
    } catch {
      // intentional: non-critical - JSON parse fallback
    }
  }, [recipe.sample_inputs, onSetFieldValues]);

  const handleSaveMockValues = useCallback(async () => {
    const mockJson = JSON.stringify(fieldValues);
    await updateRecipe(recipe.id, {
      name: null, description: null, category: null, prompt_template: null,
      input_schema: null, output_contract: null, tool_requirements: null,
      credential_requirements: null, model_preference: null,
      sample_inputs: mockJson, tags: null, icon: null, color: null,
    });
    setMockSaved(true);
    setTimeout(() => setMockSaved(false), 2000);
  }, [fieldValues, recipe.id]);

  return (
    <div className="p-4 border-b border-border/40 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide">
          Input
        </h3>
        <div className="flex items-center gap-2">
          {recipe.sample_inputs && fields.length > 0 && (
            <button
              onClick={handleLoadMockValues}
              className="flex items-center gap-1 rounded-card px-2 py-1 typo-body text-primary hover:bg-primary/10 transition-colors"
            >
              <Download className="w-3 h-3" /> {t.recipes.load_mock}
            </button>
          )}
          {fields.length > 0 && (
            <button
              onClick={handleSaveMockValues}
              className="flex items-center gap-1 rounded-card px-2 py-1 typo-body text-foreground hover:bg-muted/50 transition-colors"
            >
              {mockSaved ? (
                <><Check className="w-3 h-3 text-emerald-400" /> {t.recipes.saved}</>
              ) : (
                <><Save className="w-3 h-3" /> {t.recipes.save_mock}</>
              )}
            </button>
          )}
          <button
            onClick={onExecute}
            disabled={running || executionPhase === 'executing'}
            className="flex items-center gap-1.5 rounded-modal bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 typo-body font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {running || executionPhase === 'executing' ? (
              <RecipePageFlipLoader className="text-emerald-400" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {running ? t.recipes.rendering : executionPhase === 'executing' ? t.recipes.executing : t.recipes.execute}
          </button>
        </div>
      </div>

      {schemaParseError && <SchemaParseErrorBanner parseError={schemaParseError} />}

      <div className="grid grid-cols-2 gap-4">
        {/* Left: Test Input */}
        <div>
          <p className="typo-body font-medium text-foreground mb-2">{t.recipes.test_input}</p>
          {fields.length > 0 ? (
            <div className="space-y-2.5">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="block typo-body text-foreground mb-1">
                    {field.label || field.key}
                    <span className="ml-1 typo-body text-foreground">({field.type})</span>
                  </label>
                  {field.type === 'select' && field.options ? (
                    <select
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) => onFieldChange(field.key, e.target.value)}
                      className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-1.5 typo-body text-foreground focus-visible:outline-none focus-visible:border-emerald-500/50"
                    >
                      {field.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : field.type === 'boolean' ? (
                    <div className="flex gap-2">
                      {['true', 'false'].map((v) => (
                        <button
                          key={v}
                          onClick={() => onFieldChange(field.key, v)}
                          className={`rounded-modal px-3 py-1 typo-body border transition-colors ${
                            fieldValues[field.key] === v
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                              : 'border-border/60 text-foreground hover:border-border'
                          }`}
                        >
                          {v === 'true' ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) => onFieldChange(field.key, e.target.value)}
                      className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-1.5 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-emerald-500/50"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <textarea
              value={freeInput}
              onChange={(e) => onFreeInputChange(e.target.value)}
              placeholder={t.recipes.free_input_placeholder}
              rows={3}
              className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-2 typo-code font-mono text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-emerald-500/50 resize-y"
            />
          )}
        </div>

        {/* Right: Saved Mock Values */}
        <div>
          <p className="typo-body font-medium text-foreground mb-2">{t.recipes.saved_mock_values}</p>
          <div className="rounded-card border border-border/40 bg-card/30 p-3 max-h-60 overflow-y-auto">
            {mockValues ? (
              <div className="space-y-1.5">
                {Object.entries(mockValues).map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-2 typo-body">
                    <span className="text-foreground font-mono shrink-0">{key}:</span>
                    <span className="text-foreground font-mono break-all">
                      {typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 typo-body text-foreground">
                <Database className="w-3.5 h-3.5" />
                {t.recipes.no_mock_values}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
