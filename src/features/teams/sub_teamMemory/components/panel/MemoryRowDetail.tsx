import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Check, X, ChevronDown } from 'lucide-react';
import { IMPORTANCE_MIN, IMPORTANCE_MAX } from '../../libs/memoryConstants';
import { Slider } from '@/features/shared/components/forms/Slider';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

const CATEGORIES = ['observation', 'decision', 'context', 'learning'] as const;

interface MemoryRowDetailProps {
  id: string;
  initialTitle: string;
  initialContent: string;
  initialCategory: string;
  initialImportance: number;
  onSave: (id: string, title: string, content: string, category: string, importance: number) => void;
  onCancel: () => void;
}

export default function MemoryRowDetail({
  id,
  initialTitle,
  initialContent,
  initialCategory,
  initialImportance,
  onSave,
  onCancel,
}: MemoryRowDetailProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [editTitle, setEditTitle] = useState(initialTitle);
  const [editContent, setEditContent] = useState(initialContent);
  const [editCategory, setEditCategory] = useState(initialCategory);
  const [editImportance, setEditImportance] = useState(initialImportance);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => {
    const t = editTitle.trim();
    const c = editContent.trim();
    if (!t || !c) return;
    onSave(id, t, c, editCategory, editImportance);
  }, [id, editTitle, editContent, editCategory, editImportance, onSave]);

  return (
    <div className="px-2.5 py-2 rounded-modal border border-violet-500/25 bg-violet-500/5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="typo-body font-medium text-violet-400">{pt.edit_memory_title}</span>
        <div className="flex items-center gap-1">
          <Tooltip content={t.common.save}>
            <button type="button" onClick={handleSave} className="p-1 rounded-card hover:bg-emerald-500/15 text-emerald-400" aria-label={t.common.save}>
              <Check className="w-3 h-3" />
            </button>
          </Tooltip>
          <Tooltip content={t.common.cancel}>
            <button type="button" onClick={onCancel} className="p-1 rounded-card hover:bg-primary/10 text-foreground" aria-label={t.common.cancel}>
              <X className="w-3 h-3" />
            </button>
          </Tooltip>
        </div>
      </div>

      <input
        ref={titleRef}
        className="w-full typo-body bg-secondary/60 border border-primary/10 rounded-card px-2 py-1 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        placeholder={pt.title_placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
      />

      <textarea
        className="w-full typo-body bg-secondary/60 border border-primary/10 rounded-card px-2 py-1 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 resize-none"
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        placeholder={pt.content_placeholder}
        rows={3}
      />

      <div className="flex items-center gap-2">
        <Listbox
          ariaLabel={pt.category_label}
          className="flex-shrink-0"
          itemCount={CATEGORIES.length}
          onSelectFocused={(idx) => {
            const picked = CATEGORIES[idx];
            if (picked) setEditCategory(picked);
          }}
          renderTrigger={({ isOpen, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label={pt.category_label}
              className="inline-flex items-center gap-1 typo-body bg-secondary/60 border border-primary/10 rounded-card px-1.5 py-0.5 text-foreground hover:border-primary/20 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
            >
              {tokenLabel(t, 'memory_category', editCategory)}
              <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        >
          {({ close, focusIndex }) => (
            <div className="py-1 bg-secondary/95">
              {CATEGORIES.map((c, idx) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={editCategory === c}
                  onClick={() => { setEditCategory(c); close(); }}
                  className={`w-full text-left px-2 py-1 typo-body transition-colors ${
                    idx === focusIndex || editCategory === c
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground/80 hover:bg-primary/5'
                  }`}
                >
                  {tokenLabel(t, 'memory_category', c)}
                </button>
              ))}
            </div>
          )}
        </Listbox>

        <div className="flex items-center gap-1">
          <span className="typo-body text-foreground">{pt.importance_label}</span>
          <Slider
            min={IMPORTANCE_MIN}
            max={IMPORTANCE_MAX}
            value={editImportance}
            onChange={(v) => setEditImportance(v)}
            ariaLabel={pt.importance_label}
            showBubble={false}
            className="w-14"
          />
          <span className="typo-body text-foreground w-3 text-right">{editImportance}</span>
        </div>
      </div>
    </div>
  );
}
