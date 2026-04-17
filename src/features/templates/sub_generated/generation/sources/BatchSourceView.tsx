import { useRef, useMemo } from 'react';
import { Upload } from 'lucide-react';
import { CATEGORY_COLORS } from '../runner/designRunnerConstants';
import type { BatchProps } from './TemplateSourceTypes';

export function BatchSourceView({ templates, categoryFilter, onCategoryFilterChange, onClear, onFileUpload }: BatchProps) {
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of templates) {
      if (t.category) cats.add(t.category);
    }
    return Array.from(cats).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    if (!categoryFilter) return templates;
    return templates.filter((t) => t.category === categoryFilter);
  }, [templates, categoryFilter]);

  if (templates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="typo-body text-foreground">
          Upload a list.md file with numbered template entries to batch-generate templates via Claude CLI.
        </p>
        <div className="flex justify-center">
          <input
            ref={batchFileInputRef}
            type="file"
            accept=".md,.txt"
            onChange={onFileUpload}
            className="hidden"
          />
          <button
            onClick={() => batchFileInputRef.current?.click()}
            className="px-4 py-3 rounded-modal border-2 border-dashed border-primary/15 hover:border-violet-500/30 hover:bg-violet-500/5 text-foreground hover:text-violet-300 transition-all flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload list.md
          </button>
        </div>
        <p className="typo-body text-foreground text-center">
          Expected format: <code className="text-foreground">**1. Template Name**</code> followed by description and metadata
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Category filter chips */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onCategoryFilterChange(null)}
            className={`px-2.5 py-1 typo-body rounded-modal border transition-all ${
              categoryFilter === null
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                : 'bg-secondary/30 border-primary/10 text-foreground hover:border-primary/20'
            }`}
          >
            All ({templates.length})
          </button>
          {categories.map((cat) => {
            const count = templates.filter((t) => t.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => onCategoryFilterChange(categoryFilter === cat ? null : cat)}
                className={`px-2.5 py-1 typo-body rounded-modal border transition-all ${
                  categoryFilter === cat
                    ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                    : 'bg-secondary/30 border-primary/10 text-foreground hover:border-primary/20'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Template list */}
      <div className="max-h-[220px] overflow-y-auto space-y-1 pr-1">
        {filtered.map((t) => {
          const catStyle = CATEGORY_COLORS[t.category ?? ''] ?? 'bg-secondary/30 text-foreground border-primary/15';
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 px-3 py-2 rounded-modal bg-secondary/20 border border-primary/5 hover:border-primary/15 transition-colors"
            >
              <span className="typo-body text-foreground w-6 text-right flex-shrink-0">
                {t.id.replace('template_', '')}
              </span>
              <span className="typo-body text-foreground/90 flex-1 truncate">{t.name}</span>
              {t.category && (
                <span className={`px-2 py-0.5 typo-body rounded-card border flex-shrink-0 ${catStyle}`}>
                  {t.category}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="typo-body text-foreground">
          {filtered.length} template{filtered.length !== 1 ? 's' : ''} will be generated via Claude CLI (~45s each)
        </p>
        <button
          onClick={onClear}
          className="px-2 py-1 typo-body rounded-card text-foreground hover:text-red-400 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
