import { useState, useCallback, useMemo } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useToastStore } from '@/stores/toastStore';
import { TagChipInput } from './TagChipInput';
import { SchemaFieldBuilder, type SchemaField } from './SchemaFieldBuilder';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeEditorProps {
  /** null = create mode, RecipeDefinition = edit mode */
  recipe: RecipeDefinition | null;
  onSaved: () => void;
  onCancel: () => void;
}

const CATEGORIES = ['analysis', 'automation', 'generation', 'transform', 'monitoring'];

function parseTagsString(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function parseSchemaString(raw: string | null | undefined): SchemaField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f: Record<string, unknown>) => ({
      key: String(f.key ?? ''),
      type: String(f.type ?? 'text'),
      label: String(f.label ?? ''),
      default: f.default != null ? String(f.default) : '',
    }));
  } catch {
    return [];
  }
}

function serializeTags(tags: string[]): string | null {
  return tags.length > 0 ? JSON.stringify(tags) : null;
}

function serializeSchema(fields: SchemaField[]): string | null {
  const valid = fields.filter((f) => f.key.trim());
  if (valid.length === 0) return null;
  return JSON.stringify(valid.map((f) => ({
    key: f.key.trim(),
    type: f.type,
    label: f.label.trim() || f.key.trim(),
    ...(f.default ? { default: f.default } : {}),
  })));
}

export function RecipeEditor({ recipe, onSaved, onCancel }: RecipeEditorProps) {
  const { t } = useTranslation();
  const createRecipe = usePipelineStore((s) => s.createRecipe);
  const updateRecipe = usePipelineStore((s) => s.updateRecipe);

  const [name, setName] = useState(recipe?.name ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [category, setCategory] = useState(recipe?.category ?? '');
  const [promptTemplate, setPromptTemplate] = useState(recipe?.prompt_template ?? '');

  const initialTags = useMemo(() => parseTagsString(recipe?.tags), [recipe?.tags]);
  const initialSchema = useMemo(() => parseSchemaString(recipe?.input_schema), [recipe?.input_schema]);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>(initialSchema);
  const [saving, setSaving] = useState(false);

  const isValid = name.trim().length > 0 && promptTemplate.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
        prompt_template: promptTemplate,
        input_schema: serializeSchema(schemaFields),
        output_contract: null,
        tool_requirements: null,
        credential_requirements: null,
        model_preference: null,
        sample_inputs: null,
        tags: serializeTags(tags),
        icon: null,
        color: null,
      };

      if (recipe) {
        await updateRecipe(recipe.id, payload);
      } else {
        await createRecipe({
          credential_id: null,
          use_case_id: null,
          ...payload,
        });
      }
      onSaved();
    } catch {
      useToastStore.getState().addToast('Failed to save recipe', 'error');
    } finally {
      setSaving(false);
    }
  }, [recipe, name, description, category, promptTemplate, schemaFields, tags, isValid, saving, createRecipe, updateRecipe, onSaved]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className="flex items-center gap-1.5 rounded-modal bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {saving ? <LoadingSpinner size="sm" /> : <Save className="w-3.5 h-3.5" />}
          {recipe ? t.recipes.save_changes : t.recipes.create_recipe}
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{t.recipes.name_label}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summarize PR Changes"
            className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{t.recipes.description_label}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.recipes.description_placeholder}
            rows={2}
            className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 resize-none"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{t.recipes.category_label}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary/50"
          >
            <option value="">{t.common.none}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Prompt Template */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Prompt Template *
          </label>
          <p className="text-sm text-foreground mb-1.5">
            {'Use {{variable}} syntax for placeholders that will be filled from input schema.'}
          </p>
          <textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder={'You are a helpful assistant.\n\nAnalyze the following: {{input}}'}
            rows={10}
            className="w-full rounded-modal border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 resize-y"
          />
        </div>

        {/* Input Schema — Visual Builder */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Input Schema
          </label>
          <p className="text-sm text-foreground mb-1.5">
            {t.recipes.input_schema_help}
          </p>
          <SchemaFieldBuilder fields={schemaFields} onChange={setSchemaFields} />
        </div>

        {/* Tags — Chip Input */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{t.recipes.tags_label}</label>
          <TagChipInput tags={tags} onChange={setTags} />
        </div>
      </div>
    </div>
  );
}
