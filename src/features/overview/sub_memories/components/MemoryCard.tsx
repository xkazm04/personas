import { useCallback, useState, useEffect, useRef } from 'react';
import { Trash2, Layers, RotateCcw, Archive } from 'lucide-react';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';
import { importanceColor, importanceGradient } from '../libs/memoryVisualTokens';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Small badge that surfaces a memory's capability (use case) attribution.
 * Persona-wide memories (use_case_id == null) render nothing — the absence of
 * a badge already signals "applies everywhere". Phase C5.
 */
function CapabilityScopeBadge({ useCaseId }: { useCaseId: string | null | undefined }) {
  if (!useCaseId) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 typo-body"
      title={`Capability scope: ${useCaseId}`}
    >
      <Layers className="w-3 h-3" />
      <span className="max-w-[80px] truncate">{useCaseId}</span>
    </span>
  );
}

// -- Importance bar (1-5 scale, matching API's IMPORTANCE_MAX) -----------------
// Colors come from the single `memoryVisualTokens` source so the bar, the stats
// ring, the dense matrix, and the graph never disagree on the importance scale.
export function ImportanceBar({ value }: { value: number }) {
  const maxScale = 5;
  const pct = (Math.max(1, Math.min(value, maxScale)) / maxScale) * 100;
  const label = `Importance: ${value} of ${maxScale}`;
  const highImportance = value >= 4;

  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={label}>
      <div
        className="relative w-10 h-1.5 rounded-full bg-muted-foreground/15 overflow-hidden"
        style={highImportance ? { boxShadow: `0 1px 4px ${importanceColor(value)}60` } : undefined}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: importanceGradient(value) }}
        />
      </div>
      <span className="typo-caption text-foreground tabular-nums">{value}/{maxScale}</span>
    </div>
  );
}

/** @deprecated Use ImportanceBar instead */
export const ImportanceDots = ImportanceBar;

// -- Memory Row ---------------------------------------------------------------

/** Fallback grid template — kept in sync with MEMORY_COLUMNS in MemoriesPage. */
const DEFAULT_MEMORY_GRID = '180px minmax(0,2fr) 100px 80px 100px 40px';

export function MemoryRow({
  memory, personaName, onDelete, onSelect, onRestore, index = 0, gridTemplate = DEFAULT_MEMORY_GRID,
}: {
  memory: PersonaMemory; personaName: string; onDelete: () => void; onSelect: () => void;
  /** Restore an archived memory back to the active set (shown only when tier='archive'). */
  onRestore?: () => void;
  index?: number;
  /** Shared grid-template-columns so the row's cells align with the table header. */
  gridTemplate?: string;
}) {
  const { t } = useTranslation();
  const isArchived = memory.tier === 'archive';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearConfirmTimer = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearConfirmTimer();
    if (!confirmDelete) return undefined;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    confirmTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (confirmTimerRef.current === timer) {
        confirmTimerRef.current = null;
      }
    };
  }, [clearConfirmTimer, confirmDelete, memory.id]);

  useEffect(() => {
    clearConfirmTimer();
    setConfirmDelete(false);
    return () => {
      clearConfirmTimer();
    };
  }, [clearConfirmTimer, memory.id]);

  const armDelete = useCallback(() => {
    clearConfirmTimer();
    setConfirmDelete(true);
  }, [clearConfirmTimer]);

  const cancelDelete = useCallback(() => {
    clearConfirmTimer();
    setConfirmDelete(false);
  }, [clearConfirmTimer]);

  const confirmAndDelete = useCallback(() => {
    clearConfirmTimer();
    setConfirmDelete(false);
    onDelete();
  }, [clearConfirmTimer, onDelete]);

  const categoryBadge = (
    <CategoryChip category={memory.category} className="flex-shrink-0" />
  );

  const scopeBadge = <CapabilityScopeBadge useCaseId={memory.use_case_id} />;

  const archivedBadge = isArchived ? (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/60 border border-primary/15 text-foreground/60 typo-body"
      title={t.overview.memory_filter.tier_archived}
    >
      <Archive className="w-3 h-3" />
      {t.overview.memory_filter.tier_archived}
    </span>
  ) : null;

  const restoreButton = isArchived && onRestore ? (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={onRestore}
        className="p-1 rounded hover:bg-violet-500/10 text-foreground/60 hover:text-violet-300 transition-colors"
        title={t.overview.memory_card.restore}
        aria-label={t.overview.memory_card.restore}
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  // Status-accent left border (matches the Activity/Messages tables): only
  // high-importance memories (>=4 of 5) carry the rose gutter accent that the
  // ImportanceBar already uses, so the rows that matter most are scannable down
  // the left edge. Lower-importance rows stay neutral to avoid gutter noise.
  const importanceAccent = memory.importance >= 4 ? importanceColor(memory.importance) : 'transparent';

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {confirmDelete ? (
        <div key="confirm" className="animate-fade-slide-in flex items-center gap-1">
          <button onClick={confirmAndDelete} className="px-2 py-1 typo-heading rounded-card bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">{t.overview.memory_card.confirm}</button>
          <button onClick={cancelDelete} className="px-2 py-1 typo-heading rounded-card bg-secondary/50 text-foreground hover:text-foreground/95 hover:bg-secondary/70 transition-colors">{t.overview.memory_card.cancel}</button>
        </div>
      ) : (
        <button key="trash" onClick={armDelete} className="animate-fade-slide-in p-1 rounded hover:bg-red-500/10 text-foreground hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div data-testid={`memory-row-${memory.id}`} style={{ borderLeftColor: importanceAccent }} className={`animate-fade-slide-in border-l-2 border-b border-primary/10 hover:bg-white/[0.05] transition-colors ${index % 2 === 0 ? 'bg-white/[0.015]' : ''} ${isArchived ? 'opacity-60' : ''}`}>
      {/* Desktop row — grid columns mirror the table header in MemoriesPage */}
      <div className="hidden md:grid items-center py-3 cursor-pointer" style={{ gridTemplateColumns: gridTemplate }} onClick={onSelect}>
        <div className="px-4 flex items-center gap-2 min-w-0"><span className="typo-body text-foreground/90 truncate">{personaName}</span></div>
        <div className="px-4 min-w-0"><span className="typo-body text-foreground truncate block">{stripHtml(memory.title)}</span></div>
        <div className="px-2 flex items-center gap-1 min-w-0">{scopeBadge}{categoryBadge}{archivedBadge}</div>
        <div className="px-4 min-w-0"><ImportanceBar value={memory.importance} /></div>
        <span className="px-4 typo-body text-foreground text-right">{formatRelativeTime(memory.created_at).replace(/ ago$/, '')}</span>
        <div className="px-2 flex justify-end items-center gap-1">{restoreButton}{deleteButton}</div>
      </div>

      {/* Mobile card */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0"><span className="typo-body text-foreground/90 truncate">{personaName}</span></div>
          <div className="flex items-center gap-2 flex-shrink-0">{restoreButton}{deleteButton}</div>
        </div>
        <span className="typo-body text-foreground line-clamp-2">{stripHtml(memory.title)}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {scopeBadge}
          {categoryBadge}
          {archivedBadge}
          <ImportanceBar value={memory.importance} />
          <span className="typo-body text-foreground ml-auto">{formatRelativeTime(memory.created_at).replace(/ ago$/, '')}</span>
        </div>
      </div>
    </div>
  );
}
