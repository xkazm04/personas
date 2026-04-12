import { useTranslation } from '@/i18n/useTranslation';
import { useState, useCallback, useMemo } from 'react';
import { History, ChevronUp } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { IMPORTANCE_DOTS, importanceToDots, dotsToImportance } from '../../libs/memoryConstants';
import MemoryRowDetail from './MemoryRowDetail';
import MemoryRowActions from './MemoryRowActions';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';

interface Revision { title: string; content: string; category: string; importance: number; edited_at: string; }

function parseRevisions(tags: string | null): { source: string; revisions: Revision[] } {
  if (!tags) return { source: '', revisions: [] };
  try {
    const parsed = JSON.parse(tags);
    if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.revisions))
      return { source: parsed.source ?? '', revisions: parsed.revisions };
  } catch { /* Simple string tag */ }
  return { source: tags, revisions: [] };
}

interface TeamMemoryRowProps {
  memory: TeamMemory;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

export default function TeamMemoryRow({ memory, onDelete, onImportanceChange, onEdit }: TeamMemoryRowProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isAuto = memory.tags?.includes('auto');
  const dots = importanceToDots(memory.importance);
  const { revisions } = useMemo(() => parseRevisions(memory.tags), [memory.tags]);

  const startEdit = useCallback(() => { if (onEdit) setEditing(true); }, [onEdit]);

  if (editing && onEdit) {
    return (
      <MemoryRowDetail
        id={memory.id}
        initialTitle={memory.title}
        initialContent={memory.content}
        initialCategory={memory.category}
        initialImportance={memory.importance}
        onSave={(id, t, c, cat, imp) => { onEdit(id, t, c, cat, imp); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="group relative px-2.5 py-2 rounded-xl border border-primary/5 hover:border-primary/15 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onEdit ? startEdit : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 truncate">{memory.title}</p>
          <p className="text-sm text-muted-foreground/70 line-clamp-2 mt-0.5">{memory.content}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CategoryChip category={memory.category} source="team" />
            <span className="text-sm px-1.5 py-0.5 rounded-full bg-primary/5 text-foreground/60">
              {isAuto ? pt.auto_label : pt.manual_label}
            </span>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: IMPORTANCE_DOTS }).map((_, i) => (
                <button
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i < dots ? 'bg-amber-400' : 'bg-primary/10'} hover:bg-amber-300`}
                  onClick={() => onImportanceChange(memory.id, dotsToImportance(i))}
                  title={`Set importance to ${dotsToImportance(i)}`}
                />
              ))}
            </div>
            {revisions.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-0.5 text-sm text-muted-foreground/40 hover:text-violet-400 transition-colors"
                title={`${revisions.length} revision${revisions.length > 1 ? 's' : ''}`}
              >
                <History className="w-3 h-3" /><span>{revisions.length}</span>
              </button>
            )}
          </div>

          {showHistory && revisions.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-primary/10 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground/60">{pt.version_history}</span>
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

      {hovered && (
        <MemoryRowActions canEdit={!!onEdit} onEdit={startEdit} onDelete={() => onDelete(memory.id)} />
      )}
    </div>
  );
}
