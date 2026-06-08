import { useTranslation } from '@/i18n/useTranslation';
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { type NodeProps } from '@xyflow/react';
import { GripVertical, Trash2, Check } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type StickyNoteCategory = 'decision' | 'todo' | 'warning' | 'documentation';

export interface StickyNoteData {
  text: string;
  category: StickyNoteCategory;
  onUpdate?: (id: string, text: string, category: StickyNoteCategory) => void;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

const CATEGORY_STYLES: Record<StickyNoteCategory, { bg: string; border: string; badge: string; label: string }> = {
  decision: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-300',
    label: 'Decision',
  },
  todo: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/20 text-amber-300',
    label: 'TODO',
  },
  warning: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 text-red-300',
    label: 'Warning',
  },
  documentation: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/20 text-emerald-300',
    label: 'Docs',
  },
};

const CATEGORIES: StickyNoteCategory[] = ['decision', 'todo', 'warning', 'documentation'];

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const d = data as StickyNoteData;
  const [editing, setEditing] = useState(!d.text);
  const [draft, setDraft] = useState(d.text || '');
  const [category, setCategory] = useState<StickyNoteCategory>(d.category || 'documentation');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const style = CATEGORY_STYLES[category];

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleSave = useCallback(() => {
    setEditing(false);
    d.onUpdate?.(id, draft, category);
  }, [id, draft, category, d]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
    // Prevent ReactFlow from intercepting keystrokes while editing
    e.stopPropagation();
  }, [handleSave]);

  const handleCategoryChange = useCallback((cat: StickyNoteCategory) => {
    setCategory(cat);
    d.onUpdate?.(id, draft, cat);
  }, [id, draft, d]);

  return (
    <div
      className={`group relative rounded-modal backdrop-blur-sm border transition-all min-w-[180px] max-w-[320px] ${style.bg} ${style.border} ${
        selected ? 'ring-1 ring-primary/30 shadow-elevation-3' : ''
      }`}
      onDoubleClick={() => { if (!editing) setEditing(true); }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-inherit">
        <GripVertical className="w-3 h-3 text-foreground cursor-grab" />
        {/* Category pills */}
        <div className="flex items-center gap-1 flex-1">
          {CATEGORIES.map((cat) => {
            const s = CATEGORY_STYLES[cat];
            return (
              <button
                key={cat}
                onClick={(e) => { e.stopPropagation(); handleCategoryChange(cat); }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                  category === cat
                    ? `${s.badge} ring-1 ring-current/20`
                    : 'text-foreground hover:text-muted-foreground/60'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {/* Delete */}
        <button
          onClick={(e) => { e.stopPropagation(); d.onDelete?.(id); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-foreground hover:text-red-400 transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 min-h-[48px]">
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pt.note_placeholder}
              rows={3}
              className="w-full bg-transparent typo-code text-foreground/90 placeholder:text-foreground resize-y outline-none min-h-[48px] font-mono"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2 py-0.5 rounded-card bg-primary/15 border border-primary/25 typo-caption font-medium text-primary hover:bg-primary/25 transition-colors"
              >
                <Check className="w-3 h-3" />
                {pt.done}
              </button>
            </div>
          </div>
        ) : (
          <div className="typo-body text-foreground prose prose-invert prose-sm max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0 [&_code]:typo-caption [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:rounded">
            {d.text ? (
              <Markdown remarkPlugins={[remarkGfm]}>{d.text}</Markdown>
            ) : (
              <span className="text-foreground italic">{pt.double_click_to_edit}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(StickyNoteNodeComponent);
