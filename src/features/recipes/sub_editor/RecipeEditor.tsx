import { useState, useCallback } from 'react';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { usePersonaStore } from '@/stores/personaStore';

interface RecipeEditorProps {
  /** null = create mode, RecipeDefinition = edit mode */
  recipe: RecipeDefinition | null;
  onSaved: () => void;
  onCancel: () => void;
}

const CATEGORIES = ['analysis', 'automation', 'generation', 'transform', 'monitoring'];

export function RecipeEditor({ recipe, onSaved, onCancel }: RecipeEditorProps) {
  const createRecipe = usePersonaStore((s) => s.createRecipe);
  const updateRecipe = usePersonaStore((s) => s.updateRecipe);

  const [name, setName] = useState(recipe?.name ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [category, setCategory] = useState(recipe?.category ?? '');
  const [promptTemplate, setPromptTemplate] = useState(recipe?.prompt_template ?? '');
  const [inputSchema, setInputSchema] = useState(recipe?.input_schema ?? '');
  const [tags, setTags] = useState(recipe?.tags ?? '');
  const [saving, setSaving] = useState(false);

  const isValid = name.trim().length > 0 && promptTemplate.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      if (recipe) {
        await updateRecipe(recipe.id, {
          name: name.trim(),
          description: description.trim() || null,
          category: category || null,
          prompt_template: promptTemplate,
          input_schema: inputSchema.trim() || null,
          output_contract: null,
          tool_requirements: null,
          credential_requirements: null,
          model_preference: null,
          sample_inputs: null,
          tags: tags.trim() || null,
          icon: null,
          color: null,
        });
      } else {
        await createRecipe({
          credential_id: null,
          use_case_id: null,
          name: name.trim(),
          prompt_template: promptTemplate,
          description: description.trim() || null,
          category: category || null,
          input_schema: inputSchema.trim() || null,
          output_contract: null,
          tool_requirements: null,
          credential_requirements: null,
          model_preference: null,
          sample_inputs: null,
          tags: tags.trim() || null,
          icon: null,
          color: null,
        });
      }
      onSaved();
    } catch {
      // Error set by store
    } finally {
      setSaving(false);
    }
  }, [recipe, name, description, category, promptTemplate, inputSchema, tags, isValid, saving, createRecipe, updateRecipe, onSaved]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {recipe ? 'Save Changes' : 'Create Recipe'}
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summarize PR Changes"
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this recipe do?"
            rows={2}
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Prompt Template */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Prompt Template *
          </label>
          <p className="text-sm text-muted-foreground/60 mb-1.5">
            {'Use {{variable}} syntax for placeholders that will be filled from input schema.'}
          </p>
          <textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder={'You are a helpful assistant.\n\nAnalyze the following: {{input}}'}
            rows={10}
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-y"
          />
        </div>

        {/* Input Schema (JSON) */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Input Schema (JSON)
          </label>
          <p className="text-sm text-muted-foreground/60 mb-1.5">
            {'Define input fields as JSON array: [{"key":"input","type":"text","label":"Input text"}]'}
          </p>
          <textarea
            value={inputSchema}
            onChange={(e) => setInputSchema(e.target.value)}
            placeholder='[{"key": "input", "type": "text", "label": "Input text", "default": ""}]'
            rows={4}
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-y"
          />
        </div>

        {/* Tags (JSON array) */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">Tags (JSON array)</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder='["summarization", "code-review"]'
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>
    </div>
  );
}
