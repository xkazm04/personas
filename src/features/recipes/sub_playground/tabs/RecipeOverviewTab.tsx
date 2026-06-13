import { Tag, Cpu, FileText } from 'lucide-react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { parseTags, parseInputSchema } from '@/features/recipes/shared/recipeParseUtils';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeOverviewTabProps {
  recipe: RecipeDefinition;
}

export function RecipeOverviewTab({ recipe }: RecipeOverviewTabProps) {
  const { t } = useTranslation();
  const tags = parseTags(recipe.tags);
  const inputs = parseInputSchema(recipe.input_schema).fields;

  const inputColumns: TableColumn<(typeof inputs)[number]>[] = [
    { key: 'key', label: t.recipes.col_key, width: '1fr', render: (f) => <span className="font-mono text-foreground">{f.key}</span> },
    { key: 'type', label: t.recipes.col_type, width: '1fr', render: (f) => <span className="text-foreground">{f.type}</span> },
    { key: 'label', label: t.recipes.col_label, width: '1fr', render: (f) => <span className="text-foreground">{f.label}</span> },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Details */}
      <div className="space-y-3">
        <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide">{t.recipes.details}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-card border border-border/40 bg-card/30 p-3">
            <p className="typo-body text-foreground mb-1">{t.recipes.category}</p>
            <p className="typo-body text-foreground">{recipe.category || 'None'}</p>
          </div>
          <div className="rounded-card border border-border/40 bg-card/30 p-3">
            <p className="typo-body text-foreground mb-1">{t.recipes.created}</p>
            <p className="typo-body text-foreground">{<AbsoluteTime timestamp={recipe.created_at} variant="date" />}</p>
          </div>
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Tag className="w-3 h-3" /> Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-card border border-border/50 bg-muted/30 px-2 py-0.5 typo-body text-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input Schema */}
      {inputs.length > 0 && (
        <div className="space-y-2">
          <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> {t.recipes.input_fields}
          </h3>
          <UnifiedTable
            columns={inputColumns}
            data={inputs}
            getRowKey={(f) => f.key}
          />
        </div>
      )}

      {/* Prompt Template Preview */}
      <div className="space-y-2">
        <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> {t.recipes.prompt_template}
        </h3>
        <PromptTemplateRenderer content={recipe.prompt_template || '(empty)'} maxHeight="max-h-60" />
      </div>
    </div>
  );
}
