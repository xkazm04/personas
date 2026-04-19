/**
 * PersonaChronologyJourney — Experimental prototype variant A.
 *
 * Unifies the three dimensions (Tasks / Apps & Services / Triggers) into
 * a single row-per-use-case layout. Each row renders a left→right
 * "journey" arc:
 *
 *   [ WHEN ]  →  [ USES ]  →  [ DOES ]
 *   trigger      connectors   capability summary + steps preview
 *
 * Visual language: glassmorphism, per-row accent gradient, rounded pills.
 * The remaining 5 dimensions (human-review, messages, memory, errors,
 * events) render as a compact secondary strip below the journey rows.
 */
import { motion } from 'framer-motion';
import {
  Clock, Calendar, Webhook, Mouse, Zap, Radio, Play, CheckCircle2, Loader2, Eye, Sparkles, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { CELL_LABELS } from '@/features/agents/components/matrix/cellVocabulary';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology } from './useUseCaseChronology';
import type { ChronologyRow, ChronologyTrigger } from './useUseCaseChronology';
import type { BuildPhase, CellBuildStatus } from '@/lib/types/buildTypes';
import {
  HumanReviewIcon, MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from '../../gallery/matrix/MatrixIcons';

interface Props {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  cellBuildStates?: Record<string, CellBuildStatus>;
  buildActivity?: string | null;
  onStartTest?: () => void;
  onApproveTest?: () => void;
  onViewAgent?: () => void;
}

const ROW_PALETTE = [
  { accent: 'rgba(139,92,246,0.22)', ring: 'rgba(139,92,246,0.35)', dot: 'bg-violet-400' },
  { accent: 'rgba(34,211,238,0.22)', ring: 'rgba(34,211,238,0.35)', dot: 'bg-cyan-400' },
  { accent: 'rgba(251,191,36,0.22)', ring: 'rgba(251,191,36,0.35)', dot: 'bg-amber-400' },
  { accent: 'rgba(251,113,133,0.22)', ring: 'rgba(251,113,133,0.35)', dot: 'bg-rose-400' },
  { accent: 'rgba(96,165,250,0.22)', ring: 'rgba(96,165,250,0.35)', dot: 'bg-blue-400' },
  { accent: 'rgba(45,212,191,0.22)', ring: 'rgba(45,212,191,0.35)', dot: 'bg-teal-400' },
];

const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: Calendar,
  webhook: Webhook,
  manual: Mouse,
  polling: Clock,
  event_listener: Radio,
  file_watcher: Eye,
  app_focus: Eye,
};

function triggerIcon(type: string) {
  return TRIGGER_ICONS[type] ?? Zap;
}

function triggerSummary(t: ChronologyTrigger): string {
  if (t.trigger_type === 'schedule' && t.config) {
    const cron = typeof t.config.cron === 'string' ? t.config.cron : '';
    if (cron) return cron;
  }
  return t.description ?? t.trigger_type;
}

function prettyTriggerType(type: string): string {
  switch (type) {
    case 'schedule': return 'Scheduled';
    case 'webhook': return 'Webhook';
    case 'manual': return 'Manual';
    case 'polling': return 'Polling';
    case 'event_listener': return 'Event';
    case 'file_watcher': return 'File watch';
    case 'app_focus': return 'App focus';
    default: return type;
  }
}

/* ── Row ───────────────────────────────────────────────────────────── */

function JourneyRow({ row, index }: { row: ChronologyRow; index: number }) {
  const palette = ROW_PALETTE[index % ROW_PALETTE.length]!;
  const TriggerIcon = triggerIcon(row.triggers[0]?.trigger_type ?? 'manual');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
      className="relative rounded-2xl overflow-hidden backdrop-blur-xl bg-card-bg border border-card-border"
      style={{ boxShadow: '0 8px 32px -4px rgba(0,0,0,0.18), inset 0 1px 0 0 rgba(255,255,255,0.04)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(110deg, ${palette.accent} 0%, transparent 55%)` }}
      />
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: palette.ring }} />

      <div className="relative z-10 grid grid-cols-[220px_1fr_280px] gap-3 p-4">
        {/* -- WHEN column -- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${palette.dot}`} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
              When
            </span>
          </div>
          {row.triggers.length > 0 ? (
            row.triggers.map((t, i) => {
              const Icon = triggerIcon(t.trigger_type);
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-modal bg-primary/5 border border-primary/10"
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 text-foreground/80 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-foreground">
                      {prettyTriggerType(t.trigger_type)}
                    </div>
                    <div className="text-[10px] text-foreground/70 truncate">
                      {triggerSummary(t)}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-modal bg-primary/5 border border-primary/10">
              <TriggerIcon className="w-3.5 h-3.5 text-foreground/50" />
              <span className="text-[10px] text-foreground/50 italic">Manual only</span>
            </div>
          )}
        </div>

        {/* -- USES column -- */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-3 h-3 text-foreground/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
              Uses
              {row.shared && <span className="ml-1.5 text-foreground/40 normal-case tracking-normal">(shared)</span>}
            </span>
          </div>
          {row.connectors.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {row.connectors.map((c, i) => {
                const meta = getConnectorMeta(c.name);
                return (
                  <div
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-card-bg/60 border border-card-border"
                    title={c.purpose}
                  >
                    <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium text-foreground">{meta.label}</span>
                    {c.role && (
                      <span className="text-[9px] uppercase tracking-wider text-foreground/50">
                        {c.role}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] text-foreground/40 italic">No external services</div>
          )}
        </div>

        {/* -- DOES column -- */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-3 h-3 text-foreground/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
              Does
            </span>
            {!row.enabled && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/50">
                Disabled
              </span>
            )}
          </div>
          <div className="text-[13px] font-semibold text-foreground leading-snug">{row.title}</div>
          {row.summary && (
            <div className="text-[11px] text-foreground/70 leading-relaxed line-clamp-3">
              {row.summary}
            </div>
          )}
          {row.steps.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-foreground/50">
              <Sparkles className="w-3 h-3" />
              <span>{row.steps.length} steps</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Secondary cells strip ─────────────────────────────────────────── */

const SECONDARY_DIMS = [
  { key: 'human-review', icon: HumanReviewIcon, color: 'text-rose-400' },
  { key: 'messages', icon: MessagesIcon, color: 'text-blue-400' },
  { key: 'memory', icon: MemoryIcon, color: 'text-purple-400' },
  { key: 'error-handling', icon: ErrorsIcon, color: 'text-orange-400' },
  { key: 'events', icon: EventsIcon, color: 'text-teal-400' },
] as const;

function SecondaryStrip() {
  const buildCellData = useAgentStore((s) => s.buildCellData);
  return (
    <div className="grid grid-cols-5 gap-2.5">
      {SECONDARY_DIMS.map((dim) => {
        const items = buildCellData[dim.key]?.items ?? [];
        const DimIcon = dim.icon;
        return (
          <div
            key={dim.key}
            className="rounded-2xl backdrop-blur-xl bg-card-bg border border-card-border p-3 min-h-[110px] overflow-hidden relative"
          >
            <div className="flex items-center gap-2 mb-2">
              <DimIcon className={`w-3.5 h-3.5 ${dim.color}`} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/80">
                {CELL_LABELS[dim.key]}
              </span>
            </div>
            <div className="space-y-1 max-h-[72px] overflow-y-auto scrollbar-thin">
              {items.length > 0 ? (
                items.slice(0, 3).map((item, i) => (
                  <div key={i} className="text-[10px] text-foreground/75 leading-snug line-clamp-1">
                    • {item}
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-foreground/40 italic">—</div>
              )}
              {items.length > 3 && (
                <div className="text-[10px] text-foreground/50">+{items.length - 3} more</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Header / action bar ───────────────────────────────────────────── */

function ActionBar({
  buildPhase, completeness = 0, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: {
  buildPhase?: BuildPhase; completeness?: number; isRunning?: boolean;
  buildActivity?: string | null;
  onStartTest?: () => void; onApproveTest?: () => void; onViewAgent?: () => void;
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(100, Math.max(0, completeness)));
  const phaseMap: Record<string, string> = {
    initializing: 'Initializing', analyzing: 'Analyzing',
    awaiting_input: 'Awaiting Input', resolving: 'Resolving',
    draft_ready: 'Draft Ready', completed: 'Completed', failed: 'Failed',
    cancelled: 'Cancelled', testing: 'Testing', test_complete: 'Test Complete',
    promoted: 'Promoted',
  };
  const phaseText = phaseMap[buildPhase ?? ''] ?? (buildPhase ?? 'Idle');

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl backdrop-blur-xl bg-card-bg border border-card-border">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/15">
        {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground">
          {phaseText}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-[10px] font-medium text-foreground/60 uppercase tracking-wider">Build</span>
        <div className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden max-w-[240px]">
          <motion.div
            className="h-full"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 60%, transparent), color-mix(in srgb, var(--primary) 40%, transparent))' }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6 }}
          />
        </div>
        <span className="text-[11px] font-semibold text-foreground tabular-nums">{pct}%</span>
      </div>

      {buildActivity && (
        <div className="hidden md:flex items-center gap-2 text-[11px] text-foreground/60 truncate max-w-[260px]">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
          <span className="truncate">{buildActivity}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {onStartTest && buildPhase === 'draft_ready' && (
          <button
            onClick={onStartTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/15 hover:bg-primary/20 text-[11px] font-medium text-foreground cursor-pointer transition-colors"
          >
            <Play className="w-3 h-3" /> {t.templates.matrix_variants.start_test}
          </button>
        )}
        {buildPhase === 'testing' && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400">
            <Loader2 className="w-3 h-3 animate-spin" /> {t.templates.matrix_variants.testing_agent}
          </div>
        )}
        {onApproveTest && buildPhase === 'test_complete' && (
          <button
            onClick={onApproveTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 text-[11px] font-medium text-emerald-400 cursor-pointer transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" /> {t.templates.matrix_variants.approve_and_promote}
          </button>
        )}
        {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
          <button
            onClick={onViewAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/15 hover:bg-primary/20 text-[11px] font-medium text-foreground cursor-pointer transition-colors"
          >
            <Eye className="w-3 h-3" /> {t.templates.matrix_variants.view_agent_btn}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main ──────────────────────────────────────────────────────────── */

export function PersonaChronologyJourney({
  buildPhase, completeness, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: Props) {
  const rows = useUseCaseChronology();

  const empty = useMemo(() => rows.length === 0, [rows]);

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <ActionBar
        buildPhase={buildPhase}
        completeness={completeness}
        isRunning={isRunning}
        buildActivity={buildActivity}
        onStartTest={onStartTest}
        onApproveTest={onApproveTest}
        onViewAgent={onViewAgent}
      />

      <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto scrollbar-thin">
        {empty ? (
          <div className="rounded-2xl bg-card-bg border border-card-border p-8 text-center">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 text-foreground/40" />
            <div className="text-[12px] text-foreground/60">No capabilities yet — the template is still seeding.</div>
          </div>
        ) : (
          rows.map((row, i) => <JourneyRow key={row.id} row={row} index={i} />)
        )}

        <SecondaryStrip />
      </div>
    </div>
  );
}
