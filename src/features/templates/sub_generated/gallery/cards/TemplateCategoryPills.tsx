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
          <span
            key={pill.key}
            title={pill.isUnknown ? `Unmapped category: ${pill.key}` : pill.label}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border typo-caption leading-none ${
              pill.isUnknown
                ? 'bg-status-warning/10 border-status-warning/30 text-status-warning'
                : 'bg-foreground/[0.04] border-border text-foreground/80'
            }`}
            style={pill.isUnknown ? undefined : { color }}
          >
            <Icon className="w-2.5 h-2.5" />
            <span className="font-medium">{pill.label}</span>
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-foreground/[0.03] typo-caption text-foreground/60 font-medium"
          title={tags
            .slice(maxVisible)
            .map((p) => p.label)
            .join(', ')}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
