import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Trash2, Pencil, X, Check, History, ChevronUp } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { IMPORTANCE_DOTS, IMPORTANCE_MIN, IMPORTANCE_MAX, importanceToDots, dotsToImportance } from './memoryConstants';

const CATEGORIES = ['observation', 'decision', 'context', 'learning'] as const;

const CATEGORY_COLORS: Record<string, { dot: string; bg: string }> = {
  observation: { dot: 'bg-cyan-500', bg: 'bg-cyan-500/10' },
  decision: { dot: 'bg-amber-500', bg: 'bg-amber-500/10' },
  context: { dot: 'bg-violet-500', bg: 'bg-violet-500/10' },
  learning: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10' },
};

const DEFAULT_COLOR = { dot: 'bg-gray-400', bg: 'bg-gray-400/10' };

// ── Revision types ───────────────────────────────────────────────────

interface Revision {
  title: string;
  content: string;
  category: string;
  importance: number;
  edited_at: string;
}

function parseRevisions(tags: string | null): { source: string; revisions: Revision[] } {
  if (!tags) return { source: '', revisions: [] };
  try {
    const parsed = JSON.parse(tags);
    if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.revisions)) {
      return { source: parsed.source ?? '', revisions: parsed.revisions };
    }
  } catch {
    // Simple string tag (e.g. "auto", "manual")
  }
  return { source: tags, revisions: [] };
}

// ── Props ────────────────────────────────────────────────────────────

interface TeamMemoryRowProps {
  memory: TeamMemory;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

// ── Component ────────────────────────────────────────────────────────

export default function TeamMemoryRow({ memory, onDelete, onImportanceChange, onEdit }: TeamMemoryRowProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState(memory.title);
  const [editContent, setEditContent] = useState(memory.content);
  const [editCategory, setEditCategory] = useState(memory.category);
  const [editImportance, setEditImportance] = useState(memory.importance);
  const titleRef = useRef<HTMLInputElement>(null);

  const colors = CATEGORY_COLORS[memory.category] ?? DEFAULT_COLOR;
  const isAuto = memory.tags?.includes('auto');
  const dots = importanceToDots(memory.importance);

  const { revisions } = useMemo(() => parseRevisions(memory.tags), [memory.tags]);

  const startEdit = useCallback(() => {
    if (!onEdit) return;
    setEditTitle(memory.title);
    setEditContent(memory.content);
    setEditCategory(memory.category);
    setEditImportance(memory.importance);
    setEditing(true);
  }, [memory, onEdit]);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const saveEdit = useCallback(() => {
    if (!onEdit) return;
    const t = editTitle.trim();
    const c = editContent.trim();
    if (!t || !c) return;
    onEdit(memory.id, t, c, editCategory, editImportance);
    setEditing(false);
  }, [onEdit, memory.id, editTitle, editContent, editCategory, editImportance]);

  // ── Edit mode ──────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="px-2.5 py-2 rounded-xl border border-violet-500/25 bg-violet-500/5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-violet-400">Edit Memory</span>
          <div className="flex items-center gap-1">
            <button onClick={saveEdit} className="p-1 rounded-lg hover:bg-emerald-500/15 text-emerald-400" title="Save">
              <Check className="w-3 h-3" />
            </button>
            <button onClick={cancelEdit} className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/60" title="Cancel">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        <input
          ref={titleRef}
          className="w-full text-sm bg-secondary/60 border border-primary/10 rounded-lg px-2 py-1 text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Title..."
          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
        />

        <textarea
          className="w-full text-sm bg-secondary/60 border border-primary/10 rounded-lg px-2 py-1 text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30 resize-none"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="Content..."
          rows={3}
        />

        <div className="flex items-center gap-2">
          <select
            className="text-sm bg-secondary/60 border border-primary/10 rounded-lg px-1.5 py-0.5 text-foreground/80 focus:outline-none"
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground/50">Imp:</span>
            <input
              type="range"
              min={IMPORTANCE_MIN}
              max={IMPORTANCE_MAX}
              value={editImportance}
              onChange={(e) => setEditImportance(Number(e.target.value))}
              className="w-14 h-1 accent-amber-500"
            />
            <span className="text-sm text-muted-foreground/60 w-3 text-right">{editImportance}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Read mode ──────────────────────────────────────────────────
  return (
    <div
      className="group relative px-2.5 py-2 rounded-xl border border-primary/5 hover:border-primary/15 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onEdit ? startEdit : undefined}
    >
      <div className="flex items-start gap-2">
        {/* Category dot */}
        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className="text-sm font-medium text-foreground/90 truncate">{memory.title}</p>
          {/* Content preview */}
          <p className="text-sm text-muted-foreground/70 line-clamp-2 mt-0.5">{memory.content}</p>

          <div className="flex items-center gap-2 mt-1.5">
            {/* Source badge */}
            <span className={`text-sm px-1.5 py-0.5 rounded-full ${colors.bg} text-foreground/60`}>
              {isAuto ? 'Auto' : 'Manual'}
            </span>

            {/* Importance dots */}
            <div className="flex items-center gap-0.5">
              {Array.from({ length: IMPORTANCE_DOTS }).map((_, i) => {
                const value = dotsToImportance(i);
                return (
                  <button
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i < dots ? 'bg-amber-400' : 'bg-primary/10'
                    } hover:bg-amber-300`}
                    onClick={() => onImportanceChange(memory.id, value)}
                    title={`Set importance to ${value}`}
                  />
                );
              })}
            </div>

            {/* Category label */}
            <span className="text-sm text-muted-foreground/50 capitalize">{memory.category}</span>

            {/* Revision count badge */}
            {revisions.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-0.5 text-sm text-muted-foreground/40 hover:text-violet-400 transition-colors"
                title={`${revisions.length} revision${revisions.length > 1 ? 's' : ''}`}
              >
                <History className="w-3 h-3" />
                <span>{revisions.length}</span>
              </button>
            )}
          </div>

          {/* Revision history (expandable) */}
          {showHistory && revisions.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-primary/10 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground/60">Version History</span>
                <button onClick={() => setShowHistory(false)} className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground/60">
                  <ChevronUp className="w-3 h-3" />
                </button>
              </div>
              {[...revisions].reverse().map((rev, i) => (
                <div key={i} className="pl-2 border-l-2 border-primary/10 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground/70 truncate">{rev.title}</span>
                    <span className="text-sm text-muted-foreground/60 capitalize">{rev.category}</span>
                  </div>
                  <p className="text-sm text-muted-foreground/50 line-clamp-1">{rev.content}</p>
                  <span className="text-sm text-muted-foreground/60">
                    {new Date(rev.edited_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons on hover */}
      {hovered && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
          {onEdit && (
            <button
              className="p-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
              onClick={startEdit}
              title="Edit memory"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          <button
            className="p-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            onClick={() => onDelete(memory.id)}
            title="Delete memory"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
