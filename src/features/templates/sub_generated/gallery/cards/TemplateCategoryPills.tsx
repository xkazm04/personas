/**
 * TemplateCategoryPills — compact row of connector-category chips for
 * gallery template rows. Renders each chip with the category's icon +
 * label, colored from `ARCH_CATEGORIES`. Unknown categories (tags not
 * in the vault catalog) render in a warning style so the 107-template
 * review can spot typos and de-branding misses at a glance.
 *
 * One line, tight spacing, truncates with a "+N" overflow when there's
 * too many tags to fit.
 */
import { AlertTriangle, Tag } from 'lucide-react';
import { deriveTemplateCategoryTags } from '../shared/deriveTemplateCategoryTags';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface TemplateCategoryPillsProps {
  connectors: string[];
  /** Maximum pills to render before collapsing into a "+N more" chip. */
  maxVisible?: number;
  /** Extra classes for the wrapper (e.g. margin tweaks from the caller). */
  className?: string;
}

export function TemplateCategoryPills({
  connectors,
  maxVisible = 6,
  className = '',
}: TemplateCategoryPillsProps) {
  const tags = deriveTemplateCategoryTags(connectors);
  if (tags.length === 0) return null;

  const visible = tags.slice(0, maxVisible);
  const overflow = tags.length - visible.length;

  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className}`}
      data-testid="template-category-pills"
    >
      {visible.map((pill) => {
        const Icon = pill.arch?.icon ?? (pill.isUnknown ? AlertTriangle : Tag);
        const color = pill.arch?.color ?? '#f59e0b';
        return (
          <Tooltip key={pill.key} content={pill.isUnknown ? `Unmapped category: ${pill.key}` : pill.label}><span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive border typo-caption ${
              pill.isUnknown
                ? 'bg-status-warning/10 border-status-warning/30 text-status-warning'
                : 'bg-foreground/[0.04] border-border text-foreground'
            }`}
            style={pill.isUnknown ? undefined : { color }}
          >
            <Icon className="w-2.5 h-2.5" />
            <span className="font-medium">{pill.label}</span>
          </span></Tooltip>
        );
      })}
      {overflow > 0 && (
        <Tooltip content={tags
            .slice(maxVisible)
            .map((p) => p.label)
            .join(', ')}><span
          className="inline-flex items-center px-1.5 py-0.5 rounded-interactive border border-border bg-foreground/[0.03] typo-caption text-foreground"
        >
          +{overflow}
        </span></Tooltip>
      )}
    </div>
  );
}
