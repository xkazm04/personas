import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';
import { useTranslation } from '@/i18n/useTranslation';

// -- Importance colors (Tailwind palette values, centralized for theme consistency) --
const IMPORTANCE_COLORS = {
  low: 'oklch(0.765 0.177 163.22)',      // emerald-400
  medium: 'oklch(0.828 0.189 84.43)',     // amber-400
  high: 'oklch(0.712 0.194 13.43)',       // rose-400
} as const;

// -- Importance bar (1-5 scale, matching API's IMPORTANCE_MAX) -----------------
export function getImportanceColor(value: number): string {
  if (value <= 2) return IMPORTANCE_COLORS.low;
  if (value <= 3) return IMPORTANCE_COLORS.medium;
  return IMPORTANCE_COLORS.high;
}

export function getImportanceGradient(value: number): string {
  const { low, medium, high } = IMPORTANCE_COLORS;
  if (value <= 2) return `linear-gradient(90deg, ${low}, ${low})`;
  if (value <= 3) return `linear-gradient(90deg, ${low}, ${medium})`;
  return `linear-gradient(90deg, ${medium}, ${high})`;
}

export function ImportanceBar({ value }: { value: number }) {
  const maxScale = 5;
  const pct = (Math.max(1, Math.min(value, maxScale)) / maxScale) * 100;
  const label = `Importance: ${value} of ${maxScale}`;
  const highImportance = value >= 4;

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
      <span className="text-xs text-foreground tabular-nums">{value}/{maxScale}</span>
    </div>
  );
}

/** @deprecated Use ImportanceBar instead */
export const ImportanceDots = ImportanceBar;

// -- Memory Row ---------------------------------------------------------------
export function MemoryRow({
  memory, personaName, onDelete, onSelect, index = 0,
}: {
  memory: PersonaMemory; personaName: string; onDelete: () => void; onSelect: () => void; index?: number;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [confirmDelete]);

  const categoryBadge = (
    <CategoryChip category={memory.category} className="flex-shrink-0" />
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {confirmDelete ? (
        <div key="confirm" className="animate-fade-slide-in flex items-center gap-1">
          <button onClick={onDelete} className="px-2 py-1 typo-heading rounded-card bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">{t.overview.memory_card.confirm}</button>
          <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 typo-heading rounded-card bg-secondary/50 text-foreground hover:text-foreground/95 hover:bg-secondary/70 transition-colors">{t.overview.memory_card.cancel}</button>
        </div>
      ) : (
        <button key="trash" onClick={() => setConfirmDelete(true)} className="animate-fade-slide-in p-1 rounded hover:bg-red-500/10 text-foreground hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div data-testid={`memory-row-${memory.id}`} className={`animate-fade-slide-in border-b border-primary/10 hover:bg-white/[0.05] transition-colors ${index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}>
      {/* Desktop row */}
      <div className="hidden md:flex items-center gap-4 px-6 py-3 cursor-pointer" onClick={onSelect}>
        <div className="w-[140px] flex items-center gap-2 flex-shrink-0"><span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
        <div className="flex-1 min-w-0"><span className="text-sm text-foreground truncate block">{stripHtml(memory.title)}</span></div>
        {categoryBadge}
        <div className="w-[60px] flex-shrink-0"><ImportanceBar value={memory.importance} /></div>
        <span className="text-sm text-foreground w-[60px] text-right flex-shrink-0">{formatRelativeTime(memory.created_at)}</span>
        <div className="w-[32px] flex-shrink-0">{deleteButton}</div>
      </div>

      {/* Mobile card */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0"><span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
          <div className="flex items-center gap-2 flex-shrink-0">{deleteButton}</div>
        </div>
        <span className="text-sm text-foreground line-clamp-2">{stripHtml(memory.title)}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {categoryBadge}
          <ImportanceBar value={memory.importance} />
          <span className="text-sm text-foreground ml-auto">{formatRelativeTime(memory.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
