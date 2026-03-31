import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';

// -- Importance bar (1-10 scale, gradient fill) --------------------------------
function getImportanceColor(value: number): string {
  if (value <= 3) return 'rgb(52, 211, 153)';   // emerald-400
  if (value <= 6) return 'rgb(251, 191, 36)';    // amber-400
  return 'rgb(251, 113, 133)';                    // rose-400
}

function getImportanceGradient(value: number): string {
  if (value <= 3) return 'linear-gradient(90deg, rgb(52, 211, 153), rgb(52, 211, 153))';
  if (value <= 6) return 'linear-gradient(90deg, rgb(52, 211, 153), rgb(251, 191, 36))';
  return 'linear-gradient(90deg, rgb(251, 191, 36), rgb(251, 113, 133))';
}

export function ImportanceBar({ value }: { value: number }) {
  const maxScale = 10;
  const pct = (Math.max(1, Math.min(value, maxScale)) / maxScale) * 100;
  const label = `Importance: ${value} of ${maxScale}`;
  const highImportance = value >= 8;

  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={label}>
      <div
        className="relative w-10 h-1.5 rounded-full bg-muted-foreground/15 overflow-hidden"
        style={highImportance ? { boxShadow: `0 1px 4px ${getImportanceColor(value)}60` } : undefined}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: getImportanceGradient(value) }}
        />
      </div>
      <span className="text-xs text-muted-foreground/70 tabular-nums">({value}/{maxScale})</span>
    </div>
  );
}

/** @deprecated Use ImportanceBar instead */
export const ImportanceDots = ImportanceBar;

// -- Memory Row ---------------------------------------------------------------
export function MemoryRow({
  memory, personaName, personaColor, onDelete, onSelect,
}: {
  memory: PersonaMemory; personaName: string; personaColor: string; onDelete: () => void; onSelect: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [confirmDelete]);

  const agentAvatar = (
    <PersonaIcon icon={null} color={personaColor} display="pop"
      frameStyle={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }} />
  );

  const categoryBadge = (
    <CategoryChip category={memory.category} className="flex-shrink-0" />
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {confirmDelete ? (
          <div key="confirm" className="animate-fade-slide-in flex items-center gap-1">
            <button onClick={onDelete} className="px-2 py-1 typo-heading rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 typo-heading rounded-lg bg-secondary/50 text-foreground/80 hover:text-foreground/95 hover:bg-secondary/70 transition-colors">Cancel</button>
          </div>
        ) : (
          <button key="trash" onClick={() => setConfirmDelete(true)} className="animate-fade-slide-in p-1 rounded hover:bg-red-500/10 text-muted-foreground/80 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
    </div>
  );

  return (
    <div data-testid={`memory-row-${memory.id}`} className="animate-fade-slide-in border-b border-primary/10 hover:bg-secondary/20 transition-colors">
      {/* Desktop row */}
      <div className="hidden md:flex items-center gap-4 px-6 py-3 cursor-pointer" onClick={onSelect}>
        <div className="w-[140px] flex items-center gap-2 flex-shrink-0">{agentAvatar}<span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
        <div className="flex-1 min-w-0"><span className="text-sm text-foreground/80 truncate block">{stripHtml(memory.title)}</span></div>
        {categoryBadge}
        <div className="w-[60px] flex-shrink-0"><ImportanceBar value={memory.importance} /></div>
        <span className="text-sm text-muted-foreground/80 w-[60px] text-right flex-shrink-0">{formatRelativeTime(memory.created_at)}</span>
        <div className="w-[32px] flex-shrink-0">{deleteButton}</div>
      </div>

      {/* Mobile card */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">{agentAvatar}<span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
          <div className="flex items-center gap-2 flex-shrink-0">{deleteButton}</div>
        </div>
        <span className="text-sm text-foreground/80 line-clamp-2">{stripHtml(memory.title)}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {categoryBadge}
          <ImportanceBar value={memory.importance} />
          <span className="text-sm text-muted-foreground/80 ml-auto">{formatRelativeTime(memory.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
