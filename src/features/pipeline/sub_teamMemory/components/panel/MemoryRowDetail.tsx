import { useTranslation } from '@/i18n/useTranslation';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { IMPORTANCE_MIN, IMPORTANCE_MAX } from '../../libs/memoryConstants';

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
        <span className="text-sm font-medium text-violet-400">{pt.edit_memory_title}</span>
        <div className="flex items-center gap-1">
          <button onClick={handleSave} className="p-1 rounded-card hover:bg-emerald-500/15 text-emerald-400" title={t.common.save}>
            <Check className="w-3 h-3" />
          </button>
          <button onClick={onCancel} className="p-1 rounded-card hover:bg-primary/10 text-foreground" title={t.common.cancel}>
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <input
        ref={titleRef}
        className="w-full text-sm bg-secondary/60 border border-primary/10 rounded-card px-2 py-1 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        placeholder={pt.title_placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
      />

      <textarea
        className="w-full text-sm bg-secondary/60 border border-primary/10 rounded-card px-2 py-1 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 resize-none"
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        placeholder={pt.content_placeholder}
        rows={3}
      />

      <div className="flex items-center gap-2">
        <select
          className="text-sm bg-secondary/60 border border-primary/10 rounded-card px-1.5 py-0.5 text-foreground focus-visible:outline-none"
          value={editCategory}
          onChange={(e) => setEditCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <span className="text-sm text-foreground">Imp:</span>
          <input
            type="range"
            min={IMPORTANCE_MIN}
            max={IMPORTANCE_MAX}
            value={editImportance}
            onChange={(e) => setEditImportance(Number(e.target.value))}
            className="w-14 h-1 accent-amber-500"
          />
          <span className="text-sm text-foreground w-3 text-right">{editImportance}</span>
        </div>
      </div>
    </div>
  );
}
