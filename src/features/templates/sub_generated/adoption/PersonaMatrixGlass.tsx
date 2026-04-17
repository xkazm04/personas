/**
 * PersonaMatrixGlass — Glassmorphism visual variant of PersonaMatrix.
 *
 * Same 3×3 grid layout as the original (4 cells, center hub, 4 cells auto-flow).
 * Frosted glass panels with colored gradient mesh backgrounds, light reflections,
 * and floating shadows.  Uses theme CSS variables so it works across all themes.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, HelpCircle, Play, Eye, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { CELL_LABELS } from '@/features/agents/components/matrix/cellVocabulary';
import {
  UseCasesIcon, ConnectorsIcon, TriggersIcon, HumanReviewIcon,
  MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from '../gallery/matrix/MatrixIcons';
import type { CellBuildStatus, BuildPhase } from '@/lib/types/buildTypes';

/* ─── Props ─────────────────────────────────────────────────────────── */

interface PersonaMatrixGlassProps {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  cellBuildStates?: Record<string, CellBuildStatus>;
  buildActivity?: string | null;
  onStartTest?: () => void;
  onApproveTest?: () => void;
  onViewAgent?: () => void;
}

/* ─── Dimension definitions ─────────────────────────────────────────── */

const DIMENSIONS = [
  { key: 'use-cases', icon: UseCasesIcon, color: 'violet', dotCls: 'bg-violet-400', iconCls: 'text-violet-400', gradientStyle: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.02) 50%, transparent 100%)' },
  { key: 'connectors', icon: ConnectorsIcon, color: 'cyan', dotCls: 'bg-cyan-400', iconCls: 'text-cyan-400', gradientStyle: 'linear-gradient(135deg, rgba(34,211,238,0.15) 0%, rgba(34,211,238,0.02) 50%, transparent 100%)' },
  { key: 'triggers', icon: TriggersIcon, color: 'amber', dotCls: 'bg-amber-400', iconCls: 'text-amber-400', gradientStyle: 'linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.02) 50%, transparent 100%)' },
  { key: 'human-review', icon: HumanReviewIcon, color: 'rose', dotCls: 'bg-rose-400', iconCls: 'text-rose-400', gradientStyle: 'linear-gradient(135deg, rgba(251,113,133,0.15) 0%, rgba(251,113,133,0.02) 50%, transparent 100%)' },
  { key: 'messages', icon: MessagesIcon, color: 'blue', dotCls: 'bg-blue-400', iconCls: 'text-blue-400', gradientStyle: 'linear-gradient(135deg, rgba(96,165,250,0.15) 0%, rgba(96,165,250,0.02) 50%, transparent 100%)' },
  { key: 'memory', icon: MemoryIcon, color: 'purple', dotCls: 'bg-purple-400', iconCls: 'text-purple-400', gradientStyle: 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0.02) 50%, transparent 100%)' },
  { key: 'error-handling', icon: ErrorsIcon, color: 'orange', dotCls: 'bg-orange-400', iconCls: 'text-orange-400', gradientStyle: 'linear-gradient(135deg, rgba(251,146,60,0.15) 0%, rgba(251,146,60,0.02) 50%, transparent 100%)' },
  { key: 'events', icon: EventsIcon, color: 'teal', dotCls: 'bg-teal-400', iconCls: 'text-teal-400', gradientStyle: 'linear-gradient(135deg, rgba(45,212,191,0.15) 0%, rgba(45,212,191,0.02) 50%, transparent 100%)' },
] as const;

const FIRST_FOUR = DIMENSIONS.slice(0, 4);
const LAST_FOUR = DIMENSIONS.slice(4);

/* ─── Animation variants ────────────────────────────────────────────── */

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const cellVariants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(8px)' },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
};

/* ─── Status pill ───────────────────────────────────────────────────── */

function StatusPill({ status }: { status?: CellBuildStatus }) {
  if (!status || status === 'hidden') return null;
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide backdrop-blur-sm';

  if (status === 'resolved' || status === 'updated')
    return <span className={`${base} bg-emerald-500/15 border border-emerald-500/25 text-emerald-400`}><CheckCircle2 className="w-3 h-3" /> Resolved</span>;
  if (status === 'error')
    return <span className={`${base} bg-red-500/15 border border-red-500/25 text-red-400`}><AlertCircle className="w-3 h-3" /> Error</span>;
  if (status === 'pending' || status === 'filling')
    return <span className={`${base} bg-primary/10 border border-primary/15 animate-pulse text-foreground`}><Loader2 className="w-3 h-3 animate-spin" /> {status === 'filling' ? 'Filling' : 'Pending'}</span>;
  return <span className={`${base} bg-primary/10 border border-primary/15 text-foreground`}><HelpCircle className="w-3 h-3" /> {status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

/* ─── Phase label ───────────────────────────────────────────────────── */

function phaseLabel(phase?: BuildPhase): string {
  if (!phase) return 'Idle';
  const map: Record<string, string> = {
    initializing: 'Initializing', analyzing: 'Analyzing', awaiting_input: 'Awaiting Input',
    resolving: 'Resolving', draft_ready: 'Draft Ready', completed: 'Completed',
    failed: 'Failed', cancelled: 'Cancelled', testing: 'Testing',
    test_complete: 'Test Complete', promoted: 'Promoted',
  };
  return map[phase] ?? phase;
}

/* ─── Glass Cell ────────────────────────────────────────────────────── */

function GlassCell({ dim, items, status }: {
  dim: (typeof DIMENSIONS)[number];
  items?: string[];
  status?: CellBuildStatus;
}) {
  const { t } = useTranslation();
  const DimIcon = dim.icon;

  return (
    <motion.div variants={cellVariants}>
      <div
        className="relative rounded-2xl p-4 min-h-[200px] overflow-hidden backdrop-blur-xl h-full bg-card-bg border border-card-border transition-all duration-300 hover:border-primary/20"
        style={{ boxShadow: '0 8px 32px -4px rgba(0,0,0,0.2), inset 0 1px 0 0 rgba(255,255,255,0.05)' }}
      >
        {/* Colored gradient mesh — inline style so it works across all themes */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: dim.gradientStyle }} />
        {/* Light reflection arc */}
        <div className="absolute top-0 left-0 w-1/2 h-1/3 pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%)' }} />

        <div className="relative z-10">
          {/* Label with accent dot + status */}
          <div className="flex items-center gap-2.5 mb-3">
            <span className={`w-2 h-2 rounded-full ${dim.dotCls}`} />
            <span className="typo-heading font-semibold uppercase tracking-[0.2em] text-foreground">
              {CELL_LABELS[dim.key] ?? dim.key}
            </span>
            <div className="ml-auto"><StatusPill status={status} /></div>
          </div>

          {/* Watermark icon */}
          <div className="absolute -right-2 -top-2 opacity-[0.07]">
            <DimIcon className={`w-24 h-24 ${dim.iconCls}`} />
          </div>

          {/* Bullet items — readable contrast, scrollable when content overflows */}
          <div className="max-h-[180px] overflow-y-auto mt-2 scrollbar-thin">
          {items && items.length > 0 ? (
            <ul className="space-y-1.5">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-md text-foreground leading-relaxed">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-foreground/25 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-md text-foreground italic">{t.templates.matrix_variants.no_data_yet}</p>
          )}
          </div>

        </div>
      </div>
    </motion.div>
  );
}

/* ─── Center Hub ────────────────────────────────────────────────────── */

function CenterHub({
  buildPhase, completeness = 0, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: Omit<PersonaMatrixGlassProps, 'cellBuildStates'>) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(100, Math.max(0, completeness)));

  return (
    <motion.div
      variants={cellVariants}
      className="relative rounded-2xl overflow-hidden backdrop-blur-2xl bg-card-bg border border-card-border flex flex-col items-center justify-center p-6"
      style={{ boxShadow: '0 12px 48px -8px rgba(0,0,0,0.25)' }}
    >
      {/* Radial glow using primary color */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--primary) 8%, transparent) 0%, transparent 70%)' }} />
      {/* Light reflection */}
      <div className="absolute top-0 left-0 w-2/3 h-1/4 pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }} />

      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-[280px]">
        {/* Phase pill */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full backdrop-blur-md bg-primary/10 border border-primary/15">
          {isRunning && <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin" />}
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
            {phaseLabel(buildPhase)}
          </span>
        </div>

        <Sparkles className="w-10 h-10 text-primary/50" />

        {/* Progress bar */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-foreground uppercase tracking-wider">Completeness</span>
            <span className="text-[13px] font-semibold text-foreground">{pct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-primary/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 60%, transparent), color-mix(in srgb, var(--primary) 40%, transparent))' }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' as const }}
            />
          </div>
        </div>

        {/* Activity text */}
        {buildActivity && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-modal bg-primary/5 border border-primary/10 w-full">
            <span className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="text-[12px] text-foreground truncate">{buildActivity}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2 w-full mt-2">
          {onStartTest && buildPhase === 'draft_ready' && (
            <button onClick={onStartTest} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-modal backdrop-blur-md cursor-pointer bg-primary/10 border border-primary/15 hover:bg-primary/20 transition-all duration-200 text-foreground text-[13px] font-medium">
              <Play className="w-4 h-4" /> {t.templates.matrix_variants.start_test}
            </button>
          )}
          {buildPhase === 'testing' && (
            <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-modal backdrop-blur-md bg-primary/5 border border-primary/10 text-[13px] font-medium text-foreground">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              {t.templates.matrix_variants.testing_agent}
            </div>
          )}
          {onApproveTest && buildPhase === 'test_complete' && (
            <button onClick={onApproveTest} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-modal backdrop-blur-md cursor-pointer bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 transition-all duration-200 text-emerald-400 text-[13px] font-medium">
              <CheckCircle2 className="w-4 h-4" /> {t.templates.matrix_variants.approve_and_promote}
            </button>
          )}
          {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
            <button onClick={onViewAgent} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-modal backdrop-blur-md cursor-pointer bg-primary/10 border border-primary/15 hover:bg-primary/20 transition-all duration-200 text-foreground text-[13px] font-medium">
              <Eye className="w-4 h-4" /> {t.templates.matrix_variants.view_agent_btn}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────── */

export function PersonaMatrixGlass({
  buildPhase, completeness, isRunning, cellBuildStates, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: PersonaMatrixGlassProps) {
  const buildCellData = useAgentStore((s) => s.buildCellData);

  const cellItems = useMemo(() => {
    const out: Record<string, string[] | undefined> = {};
    for (const dim of DIMENSIONS) {
      out[dim.key] = buildCellData[dim.key]?.items;
    }
    return out;
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
        {FIRST_FOUR.map((dim) => (
          <GlassCell key={dim.key} dim={dim} items={cellItems[dim.key]} status={cellBuildStates?.[dim.key]} />
        ))}
        <CenterHub
          buildPhase={buildPhase} completeness={completeness} isRunning={isRunning}
          buildActivity={buildActivity} onStartTest={onStartTest} onApproveTest={onApproveTest} onViewAgent={onViewAgent}
        />
        {LAST_FOUR.map((dim) => (
          <GlassCell key={dim.key} dim={dim} items={cellItems[dim.key]} status={cellBuildStates?.[dim.key]} />
        ))}
      </div>
    </motion.div>
  );
}
