import { createContext, useContext, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, HelpCircle, AlertCircle, Loader2 } from 'lucide-react';
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

export function CellBullets({ items, color = 'text-foreground/70' }: { items: string[]; color?: string }) {
  const typewriter = useContext(TypewriterContext);
  // When typewriter is active, delegate to TypewriterBullets for line-by-line reveal
  if (typewriter) {
    return <TypewriterBullets items={items} />;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 leading-tight">
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 mt-[7px] flex-shrink-0" />
          <span className={`text-sm ${color} leading-snug`}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Renders resolved cell content — bullet points from buildCellData store, with background checkmark. */
function ResolvedCellContent({ cellKey, fallbackRender, typewriterActive }: { cellKey: string; fallbackRender: React.ReactNode; typewriterActive: boolean }) {
  const data = useAgentStore((s) => s.buildCellData[cellKey]);
  const items = data?.items;

  return (
    <motion.div
      key="resolved-content"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="w-full relative z-10"
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
    </motion.div>
  );
}

export function MatrixCellRenderer({
  cell,
  isEditMode,
  buildLocked,
  cellBuildStatus,
  onCellRef,
}: {
  cell: MatrixCell;
  isEditMode: boolean;
  buildLocked?: boolean;
  cellBuildStatus?: CellBuildStatus;
  onCellRef?: (key: string, el: HTMLElement | null) => void;
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

  const useEditRender = isEditMode && cell.editRender && !effectiveBuildLocked;
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
  const outerClasses = stateClasses
    ? [
        'relative rounded-xl border p-4 min-h-[200px] transition-[opacity,transform,border-color,background-color,box-shadow] duration-300 shadow-md',
        stateClasses.bg,
        stateClasses.border,
        stateClasses.opacity,
        stateClasses.glow,
        glowColorClass,
        useEditRender ? 'ring-1 ring-inset ring-primary/10' : '',
      ].filter(Boolean).join(' ')
    : [
        'relative rounded-xl border p-4 min-h-[200px] transition-[opacity,transform,border-color,background-color,box-shadow] duration-300 shadow-md',
        useEditRender
          ? 'bg-card-bg ring-1 ring-inset ring-primary/10'
          : 'bg-card-bg',
        filledGlow
          ? 'border-primary/20 shadow-lg shadow-primary/[0.03]'
          : 'border-card-border',
      ].join(' ');

  return (
    <div
      ref={(el) => onCellRef?.(cell.key, el)}
      className={outerClasses}
    >
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
        <div className={`absolute -right-1 -top-1 ${watermarkOpacity} transition-opacity duration-300`}>
          <Watermark className={`w-22 h-22 ${cell.watermarkColor}`} />
        </div>
      </div>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold uppercase tracking-[0.15em] text-foreground/60">{cell.label}</span>
        {cell.filled !== undefined && (
          <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${cell.filled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
        )}
        {cellBuildStatus && (
          <span className="flex items-center gap-1 ml-auto">
            {(cellBuildStatus === 'pending' || cellBuildStatus === 'filling') && (
              <><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /><span className="text-[10px] text-cyan-400/70">Analyzing...</span></>
            )}
            {cellBuildStatus === 'resolved' && (
              <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span className="text-[10px] text-emerald-400/70">Resolved</span></>
            )}
            {cellBuildStatus === 'highlighted' && (
              <><HelpCircle className="w-3 h-3 text-amber-400" /><span className="text-[10px] text-amber-400/70">Input needed</span></>
            )}
            {cellBuildStatus === 'error' && (
              <><AlertCircle className="w-3 h-3 text-red-400" /><span className="text-[10px] text-red-400/70">Error</span></>
            )}
          </span>
        )}
      </div>
      <div className="relative flex-1 flex flex-col justify-center">
        {/* Background status icon — always visible as watermark */}
        {cellBuildStatus && (cellBuildStatus as string) !== 'hidden' && (cellBuildStatus as string) !== 'revealed' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {cellBuildStatus === 'resolved' ? (
              <CheckCircle2 className="w-20 h-20 text-emerald-400/10" />
            ) : cellBuildStatus === 'highlighted' ? (
              <HelpCircle className="w-20 h-20 text-primary/10 animate-pulse" />
            ) : cellBuildStatus === 'filling' || cellBuildStatus === 'pending' ? (
              <Loader2 className="w-20 h-20 text-primary/8 animate-spin" />
            ) : cellBuildStatus === 'error' ? (
              <AlertCircle className="w-20 h-20 text-red-400/10" />
            ) : null}
          </div>
        )}
        <AnimatePresence mode="wait">
          {/* Resolved cell content — bullet points from buildCellData */}
          {cellBuildStatus === 'resolved' ? (
            <ResolvedCellContent cellKey={cell.key} fallbackRender={useEditRender ? cell.editRender!() : cell.render()} typewriterActive={typewriterActiveRef.current} />
          ) : hasContent ? (
            <motion.div
              key="cell-content"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="w-full relative z-10"
            >
              <TypewriterContext.Provider value={typewriterActiveRef.current}>
                {useEditRender ? cell.editRender!() : cell.render()}
              </TypewriterContext.Provider>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
