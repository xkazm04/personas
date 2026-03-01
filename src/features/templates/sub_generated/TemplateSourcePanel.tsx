import React, { useRef, useMemo } from 'react';
import { Upload, Plus, Trash2 } from 'lucide-react';
import { CATEGORY_COLORS, PREDEFINED_TEST_CASES } from './designRunnerConstants';

// ── Unified source type ──────────────────────────────────────────────────

export interface TemplateSource {
  id: string;
  name: string;
  instruction: string;
  tools?: string;
  trigger?: string;
  category?: string;
}

// ── Discriminated union props ────────────────────────────────────────────

interface PredefinedProps {
  mode: 'predefined';
}

interface CustomProps {
  mode: 'custom';
  instructions: string[];
  validCount: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface BatchProps {
  mode: 'batch';
  templates: TemplateSource[];
  categoryFilter: string | null;
  onCategoryFilterChange: (filter: string | null) => void;
  onClear: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

type TemplateSourcePanelProps = PredefinedProps | CustomProps | BatchProps;

// ── Component ────────────────────────────────────────────────────────────

export function TemplateSourcePanel(props: TemplateSourcePanelProps) {
  if (props.mode === 'predefined') return <PredefinedView />;
  if (props.mode === 'custom') return <CustomView {...props} />;
  return <BatchView {...props} />;
}

// ── Predefined variant ───────────────────────────────────────────────────

function PredefinedView() {
  return (
    <div className="text-sm text-muted-foreground/90 space-y-1">
      <p>Runs {PREDEFINED_TEST_CASES.length} predefined use cases through the design engine:</p>
      <ul className="list-disc list-inside text-muted-foreground/80 space-y-0.5 ml-1">
        {PREDEFINED_TEST_CASES.map((tc) => (
          <li key={tc.id}>{tc.name}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Custom variant ───────────────────────────────────────────────────────

function CustomView({ instructions, validCount, onAdd, onRemove, onUpdate, onFileUpload }: CustomProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/90">
          Enter use case instructions ({validCount} valid)
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            onChange={onFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
            title="Load from .txt or .md file (lines starting with '-')"
          >
            <Upload className="w-3 h-3" />
            Load file
          </button>
          <button
            onClick={onAdd}
            className="px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
        {instructions.map((instruction, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="text-sm text-muted-foreground/80 mt-2.5 w-5 text-right flex-shrink-0">
              {index + 1}.
            </span>
            <textarea
              value={instruction}
              onChange={(e) => onUpdate(index, e.target.value)}
              placeholder="Describe a persona use case to test..."
              rows={2}
              className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground/80 placeholder:text-muted-foreground/80 resize-none focus:outline-none focus:border-violet-500/30 transition-colors"
            />
            {instructions.length > 1 && (
              <button
                onClick={() => onRemove(index)}
                className="mt-2 p-1 rounded hover:bg-red-500/10 text-muted-foreground/80 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground/80">
        Tip: Upload a .txt or .md file with bullet points (lines starting with &apos;-&apos;) to load multiple cases at once
      </p>
    </div>
  );
}

// ── Batch variant ────────────────────────────────────────────────────────

function BatchView({ templates, categoryFilter, onCategoryFilterChange, onClear, onFileUpload }: BatchProps) {
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
        <p className="text-sm text-muted-foreground/90">
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
            className="px-4 py-3 rounded-xl border-2 border-dashed border-primary/15 hover:border-violet-500/30 hover:bg-violet-500/5 text-muted-foreground/90 hover:text-violet-300 transition-all flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload list.md
          </button>
        </div>
        <p className="text-sm text-muted-foreground/80 text-center">
          Expected format: <code className="text-muted-foreground/80">**1. Template Name**</code> followed by description and metadata
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
            className={`px-2.5 py-1 text-sm rounded-lg border transition-all ${
              categoryFilter === null
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                : 'bg-secondary/30 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
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
                className={`px-2.5 py-1 text-sm rounded-lg border transition-all ${
                  categoryFilter === cat
                    ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                    : 'bg-secondary/30 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
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
          const catStyle = CATEGORY_COLORS[t.category ?? ''] ?? 'bg-secondary/30 text-muted-foreground/90 border-primary/15';
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/20 border border-primary/5 hover:border-primary/15 transition-colors"
            >
              <span className="text-sm text-muted-foreground/80 w-6 text-right flex-shrink-0">
                {t.id.replace('template_', '')}
              </span>
              <span className="text-sm text-foreground/90 flex-1 truncate">{t.name}</span>
              {t.category && (
                <span className={`px-2 py-0.5 text-sm rounded-md border flex-shrink-0 ${catStyle}`}>
                  {t.category}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/80">
          {filtered.length} template{filtered.length !== 1 ? 's' : ''} will be generated via Claude CLI (~45s each)
        </p>
        <button
          onClick={onClear}
          className="px-2 py-1 text-sm rounded-md text-muted-foreground/80 hover:text-red-400 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
