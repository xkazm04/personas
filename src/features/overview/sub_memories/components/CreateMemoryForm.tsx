import { useState, useCallback, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { getImportanceGradient } from './MemoryCard';

function InteractiveImportanceBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const maxScale = 5;
  const barRef = useState<HTMLDivElement | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newVal = Math.max(1, Math.min(maxScale, Math.ceil((x / rect.width) * maxScale)));
    onChange(newVal);
  };

  const pct = (value / maxScale) * 100;
  const label = `Importance: ${value} of ${maxScale}`;

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <div
        ref={(el) => { barRef[1](el); }}
        className="relative w-24 h-2 rounded-full bg-muted-foreground/15 cursor-pointer overflow-hidden"
        onClick={handleClick}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={maxScale}
        aria-valuenow={value}
        aria-label="Set importance"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(maxScale, value + 1));
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, value - 1));
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
          style={{ width: `${pct}%`, background: getImportanceGradient(value) }}
        />
      </div>
      <span className="text-sm text-muted-foreground/90 tabular-nums min-w-[24px]">({value}/{maxScale})</span>
    </div>
  );
}

// -- Inline Add Memory Form ---------------------------------------------------
export function InlineAddMemoryForm({ onClose }: { onClose: () => void }) {
  const personas = useAgentStore((s) => s.personas);
  const createMemory = useOverviewStore((s) => s.createMemory);

  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<PersonaMemoryCategory>('fact');
  const [importance, setImportance] = useState(3);
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const agentId = 'memory-persona';
  const titleId = 'memory-title';
  const contentId = 'memory-content';
  const tagsId = 'memory-tags';
  const canSave = personaId && title.trim() && content.trim();

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => onClose(), 1200);
    return () => clearTimeout(timer);
  }, [showSuccess, onClose]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    const ok = await createMemory({ persona_id: personaId, title: title.trim(), content: content.trim(), category, importance, tags });
    setSaving(false);
    if (ok) setShowSuccess(true);
  }, [canSave, personaId, title, content, category, importance, tagsInput, createMemory]);

  return (
    <div
      className="animate-fade-slide-in mx-4 md:mx-6 mb-1 mt-4 p-4 rounded-xl bg-secondary/40 backdrop-blur-sm border border-violet-500/20 relative overflow-hidden"
    >
      {showSuccess && (
          <div className="animate-fade-slide-in absolute inset-0 z-10 flex items-center justify-center bg-secondary/80 backdrop-blur-sm rounded-xl">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="typo-heading text-emerald-300">Memory created successfully</span>
            </div>
          </div>
        )}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor={agentId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Agent</label>
            <ThemedSelect id={agentId} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ThemedSelect>
          </div>
          <fieldset>
            <legend className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5">Category</legend>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ALL_MEMORY_CATEGORIES.map((cat) => {
                const colors = MEMORY_CATEGORY_COLORS[cat];
                const isActive = category === cat;
                return (
                  <button key={cat} type="button" onClick={() => setCategory(cat)} aria-pressed={isActive}
                    className={`rounded-lg transition-all ${isActive ? 'ring-1 ring-offset-1 ring-offset-background ring-current' : 'opacity-50 hover:opacity-80'}`}
                  >
                    <CategoryChip category={cat} colors={colors} />
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <div>
          <label htmlFor={titleId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Title</label>
          <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Always use metric units" aria-required="true" className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus-visible:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80" autoFocus />
        </div>

        <div>
          <label htmlFor={contentId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Content</label>
          <textarea id={contentId} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Describe what the agent should remember..." rows={3} aria-required="true" className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus-visible:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80 resize-none" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <fieldset>
            <legend className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5">Importance</legend>
            <InteractiveImportanceBar value={importance} onChange={setImportance} />
          </fieldset>
          <div>
            <label htmlFor={tagsId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Tags <span className="normal-case text-muted-foreground/80">(comma-separated)</span></label>
            <input id={tagsId} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. units, formatting, output" className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus-visible:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors">Cancel</button>
          <button type="submit" disabled={!canSave || saving} title={saving ? 'Saving memory...' : !canSave ? 'Fill in all required fields to save' : undefined} className="px-4 py-1.5 typo-heading rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">{saving ? 'Saving...' : 'Save Memory'}</button>
        </div>
      </form>
    </div>
  );
}
