/**
 * PersonaMatrixBlueprint — Technical schematic visual variant of PersonaMatrix.
 *
 * Same 3×3 grid layout as the original (4 cells, center hub, 4 cells auto-flow).
 * Engineering-diagram aesthetics: dashed borders, corner brackets, monospace type,
 * circuit-dot indicators.  Uses theme CSS variables — works across all themes.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, Play, Eye, Sparkles, Terminal } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { CELL_LABELS } from '@/features/agents/components/matrix/cellVocabulary';
import {
  UseCasesIcon, ConnectorsIcon, TriggersIcon, HumanReviewIcon,
  MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from '../gallery/matrix/MatrixIcons';
import type { CellBuildStatus, BuildPhase } from '@/lib/types/buildTypes';

/* ─── Types ─────────────────────────────────────────────────────────── */

interface PersonaMatrixBlueprintProps {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  cellBuildStates?: Record<string, CellBuildStatus>;
  buildActivity?: string | null;
  onStartTest?: () => void;
  onApproveTest?: () => void;
  onViewAgent?: () => void;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const DIMENSIONS = [
  { key: 'use-cases', icon: UseCasesIcon, colorClass: 'text-violet-400', accentBg: 'bg-violet-400' },
  { key: 'connectors', icon: ConnectorsIcon, colorClass: 'text-cyan-400', accentBg: 'bg-cyan-400' },
  { key: 'triggers', icon: TriggersIcon, colorClass: 'text-amber-400', accentBg: 'bg-amber-400' },
  { key: 'human-review', icon: HumanReviewIcon, colorClass: 'text-rose-400', accentBg: 'bg-rose-400' },
  { key: 'messages', icon: MessagesIcon, colorClass: 'text-blue-400', accentBg: 'bg-blue-400' },
  { key: 'memory', icon: MemoryIcon, colorClass: 'text-purple-400', accentBg: 'bg-purple-400' },
  { key: 'error-handling', icon: ErrorsIcon, colorClass: 'text-orange-400', accentBg: 'bg-orange-400' },
  { key: 'events', icon: EventsIcon, colorClass: 'text-teal-400', accentBg: 'bg-teal-400' },
] as const;

const FIRST_FOUR = DIMENSIONS.slice(0, 4);
const LAST_FOUR = DIMENSIONS.slice(4);

/* ─── Animation ─────────────────────────────────────────────────────── */

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const cellVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

/* ─── Status helpers ────────────────────────────────────────────────── */

function statusIndicator(status: CellBuildStatus | undefined): { dotColor: string; label: string } {
  switch (status) {
    case 'resolved':
    case 'updated':
      return { dotColor: 'bg-emerald-400', label: 'OK' };
    case 'pending':
      return { dotColor: 'bg-primary/50 animate-pulse', label: 'WAIT' };
    case 'error':
      return { dotColor: 'bg-red-400', label: 'ERR' };
    case 'filling':
    case 'highlighted':
      return { dotColor: 'bg-cyan-400 animate-pulse', label: 'FILL' };
    default:
      return { dotColor: 'bg-foreground/15', label: '---' };
  }
}

function phaseIcon(phase: BuildPhase | undefined) {
  switch (phase) {
    case 'completed':
    case 'promoted':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    case 'resolving':
    case 'analyzing':
    case 'testing':
      return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />;
    default:
      return <Terminal className="w-4 h-4 text-foreground/50" />;
  }
}

/* ─── Completeness bar (text-based) ─────────────────────────────────── */

function CompletenessBar({ value }: { value: number }) {
  const filled = Math.round((value / 100) * 12);
  const empty = 12 - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return (
    <span className="font-mono text-[11px] text-foreground tabular-nums">
      [{bar}] {value}%
    </span>
  );
}

/* ─── Corner brackets ───────────────────────────────────────────────── */

function CornerBrackets({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
  return (
    <>
      <div className={`absolute top-0 left-0 ${s} border-t-2 border-l-2 border-foreground/15`} />
      <div className={`absolute top-0 right-0 ${s} border-t-2 border-r-2 border-foreground/15`} />
      <div className={`absolute bottom-0 left-0 ${s} border-b-2 border-l-2 border-foreground/15`} />
      <div className={`absolute bottom-0 right-0 ${s} border-b-2 border-r-2 border-foreground/15`} />
    </>
  );
}

/* ─── Blueprint Cell ────────────────────────────────────────────────── */

function BlueprintCell({ dim, index, items, status }: {
  dim: (typeof DIMENSIONS)[number];
  index: number;
  items: string[];
  status: CellBuildStatus | undefined;
}) {
  const DimIcon = dim.icon;
  const { dotColor, label: statusLabel } = statusIndicator(status);

  return (
    <motion.div variants={cellVariants} className="relative">
      <div className="relative rounded-none p-4 min-h-[200px] h-full border border-dashed border-card-border bg-transparent transition-all duration-300 hover:border-primary/25 group">
        <CornerBrackets />

        {/* Left accent line */}
        <div className={`absolute left-0 top-4 bottom-4 w-0.5 ${dim.accentBg} opacity-50`} />

        {/* Label — monospace, full contrast */}
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[10px] text-foreground/40 tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-foreground/70">
            {CELL_LABELS[dim.key]}
          </span>
        </div>

        {/* Watermark icon */}
        <div className="absolute right-2 bottom-2 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity">
          <DimIcon className={`w-20 h-20 ${dim.colorClass}`} />
        </div>

        {/* Bullet items — full readable contrast */}
        <div className="space-y-1 relative z-10">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 font-mono text-[12px] leading-snug">
              <span className="text-foreground/30 mt-px flex-shrink-0">{'\u203A'}</span>
              <span className="text-foreground/90">{item}</span>
            </div>
          ))}
        </div>

        {/* Status circuit dot */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className="font-mono text-[9px] uppercase tracking-wider text-foreground/40">
            {statusLabel}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Center Hub ────────────────────────────────────────────────────── */

function CenterHub({ buildPhase, completeness, isRunning, buildActivity, onStartTest, onApproveTest, onViewAgent }: {
  buildPhase?: BuildPhase; completeness: number; isRunning: boolean;
  buildActivity?: string | null; onStartTest?: () => void; onApproveTest?: () => void; onViewAgent?: () => void;
}) {
  const phaseLabelText = buildPhase ?? 'initializing';

  return (
    <motion.div variants={cellVariants} className="relative flex flex-col border-2 border-dashed border-card-border bg-transparent p-5">
      <CornerBrackets size="lg" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {phaseIcon(buildPhase)}
        <span className="font-mono text-xs text-foreground/50">
          COMMAND CENTER // BUILD v1.0
        </span>
      </div>

      {/* Phase label — full contrast */}
      <div className="font-mono text-sm text-foreground mb-3">
        [PHASE: {phaseLabelText}]
      </div>

      {/* Completeness */}
      <div className="mb-4">
        <CompletenessBar value={completeness} />
      </div>

      {/* Activity */}
      <div className="flex-1 flex flex-col justify-center">
        {buildActivity && (
          <div className="font-mono text-[11px] text-foreground/80 mb-4 leading-relaxed">
            <span className="text-cyan-400">&gt;</span> {buildActivity}
          </div>
        )}
        {isRunning && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-foreground/50 mb-4">
            <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2">
        {(buildPhase === 'draft_ready' || buildPhase === 'completed') && onStartTest && (
          <button onClick={onStartTest} className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-card-border font-mono text-xs text-foreground cursor-pointer hover:bg-primary/10 transition-colors">
            <Play className="w-3.5 h-3.5" /> RUN TEST
          </button>
        )}
        {buildPhase === 'testing' && (
          <div className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-emerald-500/20 font-mono text-xs text-emerald-400/70">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            TESTING...
          </div>
        )}
        {buildPhase === 'test_complete' && onApproveTest && (
          <button onClick={onApproveTest} className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-emerald-500/30 font-mono text-xs text-emerald-400 cursor-pointer hover:bg-emerald-500/10 transition-colors">
            <Sparkles className="w-3.5 h-3.5" /> APPROVE
          </button>
        )}
        {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
          <button onClick={onViewAgent} className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-card-border font-mono text-xs text-foreground/70 cursor-pointer hover:bg-primary/10 transition-colors">
            <Eye className="w-3.5 h-3.5" /> VIEW AGENT
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────── */

export function PersonaMatrixBlueprint({
  buildPhase, completeness = 0, isRunning = false,
  cellBuildStates, buildActivity, onStartTest, onApproveTest, onViewAgent,
}: PersonaMatrixBlueprintProps) {
  const buildCellData = useAgentStore((s) => s.buildCellData);

  const cellItems = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const dim of DIMENSIONS) {
      result[dim.key] = buildCellData[dim.key]?.items ?? [];
    }
    return result;
  }, [buildCellData]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-3 w-full h-full"
    >
      <div
        className="grid grid-rows-[1fr_1fr_1fr] gap-2.5 flex-1 min-h-0 w-full min-w-[1100px]"
        style={{ gridTemplateColumns: '2fr 2.6fr 2fr' }}
      >
        {FIRST_FOUR.map((dim, i) => (
          <BlueprintCell key={dim.key} dim={dim} index={i} items={cellItems[dim.key]!} status={cellBuildStates?.[dim.key]} />
        ))}
        <CenterHub
          buildPhase={buildPhase} completeness={completeness} isRunning={isRunning}
          buildActivity={buildActivity} onStartTest={onStartTest} onApproveTest={onApproveTest} onViewAgent={onViewAgent}
        />
        {LAST_FOUR.map((dim, i) => (
          <BlueprintCell key={dim.key} dim={dim} index={i + 4} items={cellItems[dim.key]!} status={cellBuildStates?.[dim.key]} />
        ))}
      </div>
    </motion.div>
  );
}
