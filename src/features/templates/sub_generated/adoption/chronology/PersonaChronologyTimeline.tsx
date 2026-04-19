/**
 * PersonaChronologyTimeline — Experimental prototype variant B.
 *
 * Same data contract as the Journey variant (unified use-case chronology),
 * but presented as a schematic timeline: each use case becomes a horizontal
 * track with numbered stages (WHEN → USES → DOES), monospace captions, and
 * dashed connector lines. Steps from the use_case_flow nodes expand below
 * the track.
 *
 * Aesthetic matches PersonaMatrixBlueprint — dashed borders, corner
 * brackets, high-contrast monospace, circuit-dot status indicators.
 */
import { motion } from 'framer-motion';
import {
  Terminal, Play, Loader2, Eye, ChevronRight, AlertCircle, Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { CELL_LABELS } from '@/features/agents/components/matrix/cellVocabulary';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology } from './useUseCaseChronology';
import type { ChronologyRow, ChronologyTrigger, ChronologyStep } from './useUseCaseChronology';
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

function prettyTriggerType(type: string): string {
  switch (type) {
    case 'schedule': return 'SCHEDULE';
    case 'webhook': return 'WEBHOOK';
    case 'manual': return 'MANUAL';
    case 'polling': return 'POLLING';
    case 'event_listener': return 'EVENT';
    case 'file_watcher': return 'FILE_WATCH';
    case 'app_focus': return 'APP_FOCUS';
    default: return type.toUpperCase();
  }
}

function triggerDetail(t: ChronologyTrigger): string {
  if (t.trigger_type === 'schedule' && t.config) {
    const cron = typeof t.config.cron === 'string' ? t.config.cron : '';
    const tz = typeof t.config.timezone === 'string' ? t.config.timezone : '';
    if (cron) return tz ? `${cron} (${tz})` : cron;
  }
  return t.description ?? '—';
}

/* ── Stage brackets ────────────────────────────────────────────────── */

function StageBracket({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative border border-dashed border-card-border p-3 flex-1 min-w-0 bg-transparent">
      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-foreground/20" />
      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-foreground/20" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-foreground/20" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-foreground/20" />
      {children}
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center border border-dashed border-foreground/30 font-mono text-[11px] font-bold text-foreground">
      {String(n).padStart(2, '0')}
    </div>
  );
}

/* ── Track ─────────────────────────────────────────────────────────── */

function TimelineTrack({ row, index }: { row: ChronologyRow; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const trackIdx = String(index + 1).padStart(2, '0');

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="relative bg-transparent"
    >
      {/* Track header */}
      <div className="flex items-center gap-3 mb-2">
        <span className="font-mono text-[11px] text-foreground/60 tabular-nums">
          TRACK.{trackIdx}
        </span>
        <span className="font-mono font-bold uppercase tracking-[0.2em] text-[12px] text-foreground">
          {row.title}
        </span>
        {!row.enabled && (
          <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 border border-dashed border-foreground/30 text-foreground/50">
            DISABLED
          </span>
        )}
        {row.shared && (
          <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 border border-dashed border-foreground/20 text-foreground/40">
            SHARED_IO
          </span>
        )}
        {row.steps.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-foreground/60 hover:text-foreground cursor-pointer"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {row.steps.length} STEPS
          </button>
        )}
      </div>

      {/* Three stages + connectors */}
      <div className="flex items-stretch gap-2">
        <StepNumber n={1} />
        {/* WHEN */}
        <StageBracket>
          <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-foreground/50 mb-1.5">
            WHEN
          </div>
          {row.triggers.length > 0 ? (
            <div className="space-y-1">
              {row.triggers.map((t, i) => (
                <div key={i} className="font-mono text-[11px] text-foreground">
                  <span className="text-cyan-400">▶</span>{' '}
                  <span className="font-bold">{prettyTriggerType(t.trigger_type)}</span>
                  <span className="text-foreground/70"> · {triggerDetail(t)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-mono text-[10px] text-foreground/40 italic">manual_only</div>
          )}
        </StageBracket>

        {/* connector arrow */}
        <div className="flex items-center font-mono text-foreground/40 text-[16px]">─▶</div>
        <StepNumber n={2} />

        {/* USES */}
        <StageBracket>
          <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-foreground/50 mb-1.5">
            USES
          </div>
          {row.connectors.length > 0 ? (
            <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
              {row.connectors.map((c, i) => {
                const meta = getConnectorMeta(c.name);
                return (
                  <div key={i} className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                    <ConnectorIcon meta={meta} size="w-3 h-3" />
                    <span className="text-foreground font-bold">{meta.label}</span>
                    {c.role && (
                      <span className="text-[9px] text-foreground/50 uppercase tracking-wider">
                        [{c.role}]
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="font-mono text-[10px] text-foreground/40 italic">no_external_io</div>
          )}
        </StageBracket>

        {/* connector arrow */}
        <div className="flex items-center font-mono text-foreground/40 text-[16px]">─▶</div>
        <StepNumber n={3} />

        {/* DOES */}
        <StageBracket>
          <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-foreground/50 mb-1.5">
            DOES
          </div>
          <div className="font-mono text-[11px] text-foreground leading-snug">
            {row.summary || row.description || row.title}
          </div>
        </StageBracket>
      </div>

      {/* Expanded steps */}
      {expanded && row.steps.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2 }}
          className="mt-2 ml-10 pl-4 border-l border-dashed border-foreground/15"
        >
          <div className="space-y-1">
            {row.steps.map((s: ChronologyStep, i: number) => (
              <div key={s.id} className="font-mono text-[11px] text-foreground/80 leading-snug">
                <span className="text-foreground/40">
                  {String(i + 1).padStart(2, '0')}.
                </span>{' '}
                <span className="text-cyan-400 uppercase text-[9px] tracking-widest">
                  {s.type || 'step'}
                </span>{' '}
                <span className="font-bold">{s.label}</span>
                {s.detail && (
                  <div className="text-foreground/60 pl-5 mt-0.5 leading-relaxed">
                    › {s.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Divider between tracks */}
      <div className="mt-3 border-b border-dashed border-foreground/10" />
    </motion.div>
  );
}

/* ── Secondary strip (blueprint style) ─────────────────────────────── */

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
    <div className="grid grid-cols-5 gap-2 mt-auto">
      {SECONDARY_DIMS.map((dim, idx) => {
        const items = buildCellData[dim.key]?.items ?? [];
        const DimIcon = dim.icon;
        return (
          <div key={dim.key} className="relative border border-dashed border-card-border p-3 min-h-[110px]">
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-foreground/20" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-foreground/20" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-foreground/20" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-foreground/20" />
            <div className="flex items-center gap-1.5 mb-2">
              <span className="font-mono text-[9px] text-foreground/60 tabular-nums">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <DimIcon className={`w-3 h-3 ${dim.color}`} />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
                {CELL_LABELS[dim.key]}
              </span>
            </div>
            <div className="space-y-0.5 max-h-[72px] overflow-y-auto scrollbar-thin">
              {items.length > 0 ? (
                items.slice(0, 3).map((item, i) => (
                  <div key={i} className="font-mono text-[10px] text-foreground/80 leading-snug line-clamp-1">
                    <span className="text-foreground/40">›</span> {item}
                  </div>
                ))
              ) : (
                <div className="font-mono text-[10px] text-foreground/40 italic">—</div>
              )}
              {items.length > 3 && (
                <div className="font-mono text-[10px] text-foreground/50">+{items.length - 3} more</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Command bar ───────────────────────────────────────────────────── */

function CommandBar({
  buildPhase, completeness = 0, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: {
  buildPhase?: BuildPhase; completeness?: number; isRunning?: boolean;
  buildActivity?: string | null;
  onStartTest?: () => void; onApproveTest?: () => void; onViewAgent?: () => void;
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(100, Math.max(0, completeness)));
  const filled = Math.round((pct / 100) * 14);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(14 - filled);

  return (
    <div className="relative flex items-center gap-3 border-2 border-dashed border-card-border p-3 bg-transparent">
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-foreground/20" />
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-foreground/20" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-foreground/20" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-foreground/20" />

      <Terminal className="w-4 h-4 text-foreground" />
      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-foreground">
        {t.templates.matrix_variants.command_center_header}
      </span>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-widest text-foreground/60">
          {buildPhase ?? 'idle'}
        </span>
        <span className="font-mono text-[11px] text-foreground tabular-nums">
          [{bar}] {pct}%
        </span>
        {isRunning && <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />}
      </div>

      {buildActivity && (
        <div className="hidden md:block font-mono text-[11px] text-foreground/60 truncate max-w-[240px]">
          <span className="text-cyan-400">&gt;</span> {buildActivity}
        </div>
      )}

      <div className="flex items-center gap-2">
        {onStartTest && buildPhase === 'draft_ready' && (
          <button
            onClick={onStartTest}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-card-border font-mono text-[10px] uppercase tracking-wider text-foreground cursor-pointer hover:bg-primary/10"
          >
            <Play className="w-3 h-3" /> {t.templates.matrix_variants.run_test}
          </button>
        )}
        {buildPhase === 'testing' && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-emerald-500/30 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
            <Loader2 className="w-3 h-3 animate-spin" /> {t.templates.matrix_variants.testing_dots}
          </div>
        )}
        {onApproveTest && buildPhase === 'test_complete' && (
          <button
            onClick={onApproveTest}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-emerald-500/30 font-mono text-[10px] uppercase tracking-wider text-emerald-400 cursor-pointer hover:bg-emerald-500/10"
          >
            <Sparkles className="w-3 h-3" /> APPROVE
          </button>
        )}
        {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
          <button
            onClick={onViewAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-card-border font-mono text-[10px] uppercase tracking-wider text-foreground cursor-pointer hover:bg-primary/10"
          >
            <Eye className="w-3 h-3" /> {t.templates.matrix_variants.view_agent_label}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main ──────────────────────────────────────────────────────────── */

export function PersonaChronologyTimeline({
  buildPhase, completeness, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: Props) {
  const rows = useUseCaseChronology();
  const empty = useMemo(() => rows.length === 0, [rows]);

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <CommandBar
        buildPhase={buildPhase}
        completeness={completeness}
        isRunning={isRunning}
        buildActivity={buildActivity}
        onStartTest={onStartTest}
        onApproveTest={onApproveTest}
        onViewAgent={onViewAgent}
      />

      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto scrollbar-thin">
        {empty ? (
          <div className="border border-dashed border-card-border p-8 text-center">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-foreground/40" />
            <div className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">
              NO_CAPABILITIES_LOADED
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => <TimelineTrack key={row.id} row={row} index={i} />)}
          </div>
        )}

        <SecondaryStrip />
      </div>
    </div>
  );
}
