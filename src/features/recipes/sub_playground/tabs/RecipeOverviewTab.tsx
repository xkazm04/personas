import { Tag, Cpu, FileText } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/PromptTemplateRenderer';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

interface RecipeOverviewTabProps {
  recipe: RecipeDefinition;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseInputSchema(schema: string | null): Array<{ key: string; type: string; label: string }> {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function RecipeOverviewTab({ recipe }: RecipeOverviewTabProps) {
  const tags = parseTags(recipe.tags);
  const inputs = parseInputSchema(recipe.input_schema);

  return (
    <div className="p-4 space-y-4">
      {/* Details */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Details</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/40 bg-card/30 p-3">
            <p className="text-sm text-muted-foreground/60 mb-1">Category</p>
            <p className="text-sm text-foreground">{recipe.category || 'None'}</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/30 p-3">
            <p className="text-sm text-muted-foreground/60 mb-1">Created</p>
            <p className="text-sm text-foreground">{new Date(recipe.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Tag className="w-3 h-3" /> Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-sm text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input Schema */}
      {inputs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Input Fields
          </h3>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 bg-muted/20">
                  <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Key</th>
                  <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Type</th>
                  <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Label</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((field) => (
                  <tr key={field.key} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-foreground">{field.key}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{field.type}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{field.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Prompt Template Preview */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> Prompt Template
        </h3>
        <PromptTemplateRenderer content={recipe.prompt_template || '(empty)'} maxHeight="max-h-60" />
      </div>
    </div>
  );
}
