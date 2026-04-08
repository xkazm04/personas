import { createContext, useContext, useRef, useState } from 'react';
import { CheckCircle2, HelpCircle, AlertCircle, Loader2, Pencil } from 'lucide-react';
import { getCellStateClasses } from '@/features/agents/components/matrix/cellStateClasses';
import { getCellGlowColorClass } from '@/features/agents/components/matrix/cellGlowColors';
import { GhostedCellRenderer } from '@/features/agents/components/matrix/GhostedCellRenderer';
import { TypewriterBullets } from './MatrixCommandCenter';
import { useAgentStore } from '@/stores/agentStore';
import type { CellBuildStatus } from '@/lib/types/buildTypes';

/**
 * Context for passing typewriter mode to CellBullets inside cell render closures.
 * When true, CellBullets delegates to TypewriterBullets for line-by-line reveal.
 */
export const TypewriterContext = createContext(false);

export interface MatrixCell {
  key: string;
  label: string;
  watermark: React.ComponentType<{ className?: string }>;
  watermarkColor: string;
  render: () => React.ReactNode;
  editRender?: () => React.ReactNode;
  /** Whether this cell has meaningful content (for state indicator) */
  filled?: boolean;
}

/**
 * Split a bullet item into title + description.
 * Recognizes two separator conventions:
 *   - `: ` (colon-space) — e.g. "stock.signal.strong_buy: Emitted when..."
 *   - ` — ` (em-dash)    — e.g. "Weekly Analysis: The primary Monday workflow..."
 * Only splits when the title part is a short label (under 60 chars) and
 * the description is at least 10 chars. Returns null if no meaningful split.
 */
function splitBulletItem(item: string): { title: string; description: string } | null {
  // Try `: ` first, then ` — ` (em-dash), then ` - ` (hyphen)
  for (const sep of [': ', ' \u2014 ', ' -- ']) {
    const idx = item.indexOf(sep);
    if (idx >= 1 && idx <= 60) {
      const title = item.slice(0, idx).trim();
      const description = item.slice(idx + sep.length).trim();
      if (description.length >= 10) return { title, description };
    }
  }
  return null;
}

function BulletItem({ item, color }: { item: string; color: string }) {
  const [showDescription, setShowDescription] = useState(false);
  const split = splitBulletItem(item);

  if (!split) {
    return (
      <li className="flex items-start gap-2 leading-tight">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 mt-[7px] flex-shrink-0" />
        <span className={`text-sm ${color} leading-snug`}>{item}</span>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 leading-tight group">
      <span className="w-1.5 h-1.5 rounded-full bg-primary opacity-50 mt-[7px] flex-shrink-0" />
      <span className="min-w-0">
        <button
          type="button"
          onClick={() => setShowDescription((v) => !v)}
          className="text-sm font-medium text-primary/80 leading-snug hover:text-primary transition-colors text-left cursor-pointer"
          title={split.description}
        >
          {split.title}
        </button>
        {showDescription && (
          <p className="text-[12px] text-muted-foreground/60 leading-snug mt-0.5 animate-fade-slide-in">
            {split.description}
          </p>
        )}
      </span>
    </li>
  );
}

export function CellBullets({ items, color = 'text-foreground/70' }: { items: string[]; color?: string }) {
  const typewriter = useContext(TypewriterContext);
  // When typewriter is active, delegate to TypewriterBullets for line-by-line reveal
  if (typewriter) {
    return <TypewriterBullets items={items} />;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <BulletItem key={i} item={item} color={color} />
      ))}
    </ul>
  );
}

/** Renders resolved cell content — bullet points from buildCellData store, with background checkmark. */
function ResolvedCellContent({ cellKey, fallbackRender, typewriterActive }: { cellKey: string; fallbackRender: React.ReactNode; typewriterActive: boolean }) {
  const data = useAgentStore((s) => s.buildCellData[cellKey]);
  const items = data?.items;

  return (
    <div
      key="resolved-content"
      className="animate-fade-slide-in w-full relative z-10"
    >
      {items && items.length > 0 ? (
        <TypewriterContext.Provider value={typewriterActive}>
          <CellBullets items={items} color="text-foreground/70" />
        </TypewriterContext.Provider>
      ) : (
        <TypewriterContext.Provider value={typewriterActive}>
          {fallbackRender}
        </TypewriterContext.Provider>
      )}
    </div>
  );
}

export function MatrixCellRenderer({
  cell,
  isEditMode,
  buildLocked,
  cellBuildStatus,
  onCellRef,
  questionCount = 0,
  onConfirmUpdate: _onConfirmUpdate,
  onCellClick,
  isInlineEditing,
  compact = false,
}: {
  cell: MatrixCell;
  isEditMode: boolean;
  buildLocked?: boolean;
  cellBuildStatus?: CellBuildStatus;
  onCellRef?: (key: string, el: HTMLElement | null) => void;
  /** Number of pending questions for this cell's dimension */
  questionCount?: number;
  /** Called when user clicks an 'updated' cell to confirm they've reviewed it */
  onConfirmUpdate?: (cellKey: string) => void;
  /** Called when cell is clicked in draft phase for inline editing */
  onCellClick?: () => void;
  /** Whether this cell is currently showing inline edit UI */
  isInlineEditing?: boolean;
  /** Compact mode for pre-build state — minimized dimensions */
  compact?: boolean;
}) {
  // When cellBuildStatus is 'hidden' or 'revealed', render the ghosted outline
  if (cellBuildStatus === 'hidden' || cellBuildStatus === 'revealed') {
    return (
      <GhostedCellRenderer
        label={cell.label}
        watermark={cell.watermark}
        watermarkColor={cell.watermarkColor}
      />
    );
  }

  const Watermark = cell.watermark;

  // Determine if we should use state-machine classes (only when cellBuildStatus is provided)
  const stateClasses = cellBuildStatus ? getCellStateClasses(cellBuildStatus) : null;

  // Glow color class based on cell key (e.g. 'cell-glow-violet' for 'use-cases')
  const glowColorClass = getCellGlowColorClass(cell.key);

  // When filling, the cell is locked regardless of buildLocked prop
  const effectiveBuildLocked = buildLocked || cellBuildStatus === 'filling';

  const useEditRender = (isEditMode || isInlineEditing) && cell.editRender && !effectiveBuildLocked;
  const filledGlow = isEditMode && cell.filled;

  // Track previous status to detect filling->resolved transition for typewriter effect
  const prevStatusRef = useRef<CellBuildStatus | undefined>(undefined);
  const justResolved = prevStatusRef.current === 'filling' && cellBuildStatus === 'resolved';
  const typewriterActiveRef = useRef(false);
  if (justResolved) {
    typewriterActiveRef.current = true;
  } else if (cellBuildStatus !== 'resolved') {
    typewriterActiveRef.current = false;
  }
  prevStatusRef.current = cellBuildStatus;

  // Whether content should be visible (not hidden/revealed)
  const statusStr = cellBuildStatus as string;
  const hasContent = !cellBuildStatus || (statusStr !== 'hidden' && statusStr !== 'revealed');

  // Watermark opacity: state-aware when build status present, otherwise hardcoded defaults
  const watermarkOpacity = stateClasses
    ? stateClasses.watermarkOpacity
    : useEditRender ? 'opacity-[0.15]' : 'opacity-[0.25]';

  // Build outer class list -- state-machine classes override defaults when present
  const baseSize = compact ? 'p-2.5 min-h-[80px]' : 'p-4 min-h-[200px]';
  const outerClasses = stateClasses
    ? [
        `relative rounded-xl border ${baseSize} transition-[opacity,transform,border-color,background-color,box-shadow,min-height,padding] duration-300 shadow-elevation-2`,
        stateClasses.bg,
        stateClasses.border,
        stateClasses.opacity,
        stateClasses.glow,
        glowColorClass,
        useEditRender ? 'ring-1 ring-inset ring-primary/10' : '',
      ].filter(Boolean).join(' ')
    : [
        `relative rounded-xl border ${baseSize} transition-[opacity,transform,border-color,background-color,box-shadow,min-height,padding] duration-300 shadow-elevation-2`,
        useEditRender
          ? 'bg-card-bg ring-1 ring-inset ring-primary/10'
          : 'bg-card-bg',
        filledGlow
          ? 'border-primary/20 shadow-elevation-3 shadow-primary/[0.03]'
          : 'border-card-border',
      ].join(' ');

  return (
    <div
      ref={(el) => onCellRef?.(cell.key, el)}
      data-cell-key={cell.key}
      onClick={cellBuildStatus === 'highlighted' ? () => {
        // Dispatch custom event for SpatialQuestionPopover
        window.dispatchEvent(new CustomEvent('matrix-cell-click', { detail: { cellKey: cell.key } }));
      } : undefined}
      style={cellBuildStatus === 'highlighted' ? { cursor: 'pointer' } : undefined}
      className={outerClasses}
    >
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
        <div className={`absolute -right-1 -top-1 ${watermarkOpacity} transition-opacity duration-300`}>
          <Watermark className={`${compact ? 'w-12 h-12' : 'w-22 h-22'} ${cell.watermarkColor}`} />
        </div>
      </div>
      {/* Header: label only (badge moved to bottom) */}
      <div className={`${compact ? 'mb-1' : 'mb-2.5'} flex items-center gap-2`}>
        <span className={`${compact ? 'text-[10px]' : 'text-[13px]'} font-bold uppercase tracking-[0.15em] text-foreground/60`}>{cell.label}</span>
        {cell.filled !== undefined && (
          <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${cell.filled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
        )}
      </div>
      <div className={`relative flex-1 flex flex-col justify-center transition-[max-height] duration-300 ${compact ? 'overflow-hidden max-h-[40px]' : 'max-h-[500px]'}`}>
        {/* Background status icon — always visible as watermark */}
        {cellBuildStatus && (cellBuildStatus as string) !== 'hidden' && (cellBuildStatus as string) !== 'revealed' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {cellBuildStatus === 'resolved' ? (
              <CheckCircle2 className="w-20 h-20 text-emerald-400/10" />
            ) : cellBuildStatus === 'updated' ? (
              <CheckCircle2 className="w-20 h-20 text-amber-400/10" />
            ) : cellBuildStatus === 'highlighted' ? (
              <HelpCircle className="w-20 h-20 text-primary/10 animate-pulse" />
            ) : cellBuildStatus === 'pending' ? (
              <Loader2 className="w-20 h-20 text-primary/8 animate-spin" />
            ) : cellBuildStatus === 'filling' ? (
              <CheckCircle2 className="w-20 h-20 text-cyan-400/10" />
            ) : cellBuildStatus === 'error' ? (
              <AlertCircle className="w-20 h-20 text-red-400/10" />
            ) : null}
          </div>
        )}
        {/* Resolved/Updated/Highlighted cell content — bullet points or inline edit */}
          {/* Highlighted cells also show resolved content (propose-and-confirm pattern) */}
          {(cellBuildStatus === 'resolved' || cellBuildStatus === 'updated') && useEditRender ? (
            <div key="edit-content" className="animate-fade-slide-in w-full relative z-10">
              {cell.editRender!()}
            </div>
          ) : (cellBuildStatus === 'resolved' || cellBuildStatus === 'updated' || cellBuildStatus === 'highlighted') ? (
            <ResolvedCellContent cellKey={cell.key} fallbackRender={cell.render()} typewriterActive={typewriterActiveRef.current} />
          ) : hasContent ? (
            <div
              key="cell-content"
              className="animate-fade-slide-in w-full relative z-10"
            >
              <TypewriterContext.Provider value={typewriterActiveRef.current}>
                {useEditRender ? cell.editRender!() : cell.render()}
              </TypewriterContext.Provider>
            </div>
          ) : null}
      </div>

      {/* Bottom-left edit button — shown when cell is editable (resolved/updated in draft phase) */}
      {onCellClick && cell.editRender && (cellBuildStatus === 'resolved' || cellBuildStatus === 'updated') && !isInlineEditing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCellClick(); }}
          className="absolute bottom-2.5 left-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-primary/50 bg-primary/5 border border-primary/10 hover:text-primary hover:bg-primary/10 hover:border-primary/20 transition-colors"
        >
          <Pencil className="w-2.5 h-2.5" />
          Edit
        </button>
      )}
      {isInlineEditing && onCellClick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCellClick(); }}
          className="absolute bottom-2.5 left-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-emerald-400/70 bg-emerald-500/10 border border-emerald-500/20 hover:text-emerald-400 transition-colors"
        >
          <CheckCircle2 className="w-2.5 h-2.5" />
          Done
        </button>
      )}

      {/* Bottom-right status badge with question count */}
      {cellBuildStatus && (
        <div className="absolute bottom-2.5 right-3 flex items-center gap-1.5 z-10">
          {questionCount > 0 && cellBuildStatus === 'highlighted' && (
            <span className="text-xs font-mono text-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/15">
              {questionCount}Q
            </span>
          )}
          {cellBuildStatus === 'pending' && (
            <span className="flex items-center gap-1 text-xs text-cyan-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Analyzing
            </span>
          )}
          {cellBuildStatus === 'filling' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400/70">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Answered
            </span>
          )}
          {cellBuildStatus === 'resolved' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400/70">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Resolved
            </span>
          )}
          {cellBuildStatus === 'highlighted' && (
            <span className="flex items-center gap-1 text-xs text-amber-400/70">
              <HelpCircle className="w-3 h-3 text-amber-400" />
              Input needed
            </span>
          )}
          {cellBuildStatus === 'updated' && (
            <span className="flex items-center gap-1 text-xs text-red-400/70">
              <AlertCircle className="w-3 h-3 text-red-400" />
              Missing credential
            </span>
          )}
          {cellBuildStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-red-400/70">
              <AlertCircle className="w-3 h-3 text-red-400" />
              Error
            </span>
          )}
        </div>
      )}
    </div>
  );
}
