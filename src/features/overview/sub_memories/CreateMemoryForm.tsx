import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

// ── Interactive Importance Dots (clickable) ─────────────────────
function InteractiveImportanceDots({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const display = hovered ?? value;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHovered(i)}
            onClick={() => onChange(i)}
            className="group/dot p-0.5 rounded-full transition-transform hover:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
            aria-label={`Set importance to ${i}`}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= display ? 'bg-amber-400' : 'bg-muted-foreground/15 group-hover/dot:bg-amber-400/30'
              }`}
            />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground/90 tabular-nums min-w-[24px]">({display}/5)</span>
    </div>
  );
}

// ── Inline Add Memory Form ──────────────────────────────────────
export function InlineAddMemoryForm({ onClose }: { onClose: () => void }) {
  const personas = usePersonaStore((s) => s.personas);
  const createMemory = usePersonaStore((s) => s.createMemory);

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

  // Auto-close after showing success
  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => onClose(), 1200);
    return () => clearTimeout(timer);
  }, [showSuccess, onClose]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const ok = await createMemory({ persona_id: personaId, title: title.trim(), content: content.trim(), category, importance, tags });
    setSaving(false);
    if (ok) setShowSuccess(true);
  }, [canSave, personaId, title, content, category, importance, tagsInput, createMemory]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', damping: 24, stiffness: 300 }}
      className="mx-4 md:mx-6 mb-1 mt-4 p-4 rounded-xl bg-secondary/40 backdrop-blur-sm border border-violet-500/20 relative overflow-hidden"
    >
      {/* Success confirmation overlay */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-secondary/80 backdrop-blur-sm rounded-xl"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">Memory created successfully</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {/* Row 1: Agent + Category side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor={agentId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Agent</label>
            <ThemedSelect
              id={agentId}
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </ThemedSelect>
          </div>

          <fieldset>
            <legend className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5">Category</legend>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ALL_MEMORY_CATEGORIES.map((cat) => {
                const defaultColors = { label: cat, bg: 'bg-gray-500/10', text: 'text-gray-600', border: 'border-gray-500/20' };
                const colors = MEMORY_CATEGORY_COLORS[cat] ?? defaultColors;
                const isActive = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    aria-pressed={isActive}
                    className={`px-2 py-1 text-sm font-mono uppercase rounded-lg border transition-all ${
                      isActive
                        ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-offset-1 ring-offset-background ${colors.border.replace('border-', 'ring-')}`
                        : 'bg-secondary/40 text-muted-foreground/80 border-primary/10 hover:text-muted-foreground hover:border-primary/20'
                    }`}
                  >
                    {colors.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        {/* Row 2: Title */}
        <div>
          <label htmlFor={titleId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Title</label>
          <input
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Always use metric units"
            aria-required="true"
            className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80"
            autoFocus
          />
        </div>

        {/* Row 3: Content */}
        <div>
          <label htmlFor={contentId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">Content</label>
          <textarea
            id={contentId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Describe what the agent should remember..."
            rows={3}
            aria-required="true"
            className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80 resize-none"
          />
        </div>

        {/* Row 4: Importance + Tags side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <fieldset>
            <legend className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5">Importance</legend>
            <InteractiveImportanceDots value={importance} onChange={setImportance} />
          </fieldset>

          <div>
            <label htmlFor={tagsId} className="text-sm font-mono uppercase text-muted-foreground/90 mb-1.5 block">
              Tags <span className="normal-case text-muted-foreground/80">(comma-separated)</span>
            </label>
            <input
              id={tagsId}
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. units, formatting, output"
              className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-xl outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/80"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave || saving}
            className="px-4 py-1.5 text-sm font-medium rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saving ? 'Saving...' : 'Save Memory'}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
