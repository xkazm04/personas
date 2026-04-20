/**
 * CapabilityMatrix — per-use-case mini 3×3 matrix for Wildcard expansion.
 *
 * Mirrors the PersonaMatrix cell vocabulary (Description ⇢ Tasks, Apps,
 * Triggers, Human Review, Flow, Messages, Memory, Events, Error handling)
 * but sized down for an embedded expansion panel. The center cell is an
 * interactive Flow tile: clicking it opens ActivityDiagramModal scoped to
 * the row's UseCaseFlow.
 *
 * Applied to the Wildcard prototype only — Chain keeps its legacy DimBlock
 * grid as a safety fallback while this design proves itself.
 */
import { useState, memo } from 'react';
import { motion } from 'framer-motion';
import {
  Workflow, Webhook, Mouse, Clock, Radio, Eye, Zap, Calendar, ArrowUpRight,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import ActivityDiagramModal from '@/features/templates/sub_diagrams/ActivityDiagramModal';
import {
  UseCasesIcon, ConnectorsIcon, TriggersIcon, HumanReviewIcon,
  MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from '../../gallery/matrix/MatrixIcons';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { ChronologyRow, ChronologyTrigger } from './useUseCaseChronology';

interface CapabilityMatrixProps {
  row: ChronologyRow;
  /** Full flow (with nodes+edges) if available from buildDraft.use_case_flows */
  flow?: UseCaseFlow | null;
  templateName?: string;
}

/* ── Trigger helpers ──────────────────────────────────────────────── */

const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: Calendar, webhook: Webhook, manual: Mouse, polling: Clock,
  event_listener: Radio, file_watcher: Eye, app_focus: Eye,
};

function triggerIcon(type: string) {
  return TRIGGER_ICONS[type] ?? Zap;
}

function prettyTriggerType(t: Translations, type: string): string {
  const c = t.templates.chronology;
  switch (type) {
    case 'schedule': return c.trigger_schedule;
    case 'webhook': return c.trigger_webhook;
    case 'manual': return c.trigger_manual;
    case 'polling': return c.trigger_polling;
    case 'event_listener': return c.trigger_event;
    case 'file_watcher': return c.trigger_file_watch;
    case 'app_focus': return c.trigger_app_focus;
    default: return type;
  }
}

function triggerDetail(tr: ChronologyTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return cron;
  }
  return tr.description ?? '';
}

/* ── Cell ─────────────────────────────────────────────────────────── */
/* Matches PersonaMatrix fidelity:
 *   – rounded-modal shell with border-card-border + shadow-elevation-2
 *   – corner watermark illustration at opacity-[0.18] (the hand-drawn SVG
 *     from MatrixIcons is the visual identity of each cell)
 *   – typo-heading label: bold, uppercase, tracking-[0.15em]
 *   – emerald status dot when `filled`, neutral when empty
 *   – cell-glow-<color> CSS variable drives the hover/resolved glow
 */

interface CellProps {
  label: string;
  watermark: React.ComponentType<{ className?: string }>;
  watermarkColorClass: string;
  glowClass: string;
  filled: boolean;
  children: React.ReactNode;
}

function Cell({ label, watermark: Watermark, watermarkColorClass, glowClass, filled, children }: CellProps) {
  return (
    <div
      className={`relative rounded-modal border bg-card-bg overflow-hidden flex flex-col min-h-[160px] p-4 shadow-elevation-2 transition-[border-color,box-shadow,background-color] duration-300 ${glowClass} ${
        filled
          ? 'border-primary/20 hover:border-primary/30'
          : 'border-card-border hover:border-primary/15'
      }`}
    >
      {/* Watermark illustration — Leonardo-generated SVG in the corner. */}
      <div className="absolute inset-0 overflow-hidden rounded-modal pointer-events-none">
        <div className="absolute -right-1 -top-1 opacity-[0.18] transition-opacity duration-300">
          <Watermark className={`w-16 h-16 ${watermarkColorClass}`} />
        </div>
      </div>

      {/* Header: label + filled status dot */}
      <div className="relative z-10 mb-2 flex items-center gap-2">
        <span className="typo-heading font-bold uppercase tracking-[0.15em] text-foreground">
          {label}
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
            filled ? 'bg-status-success' : 'bg-muted-foreground/20'
          }`}
        />
      </div>

      {/* Body */}
      <div className={`relative z-10 flex-1 overflow-hidden text-md leading-snug ${filled ? 'text-foreground' : 'text-foreground/50 italic'}`}>
        {children}
      </div>
    </div>
  );
}

/* ── Cell body renderers ─────────────────────────────────────────── */

function DescriptionBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  const text = row.description || row.summary;
  if (!text) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return <span className="line-clamp-5">{text}</span>;
}

function AppsBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (row.connectors.length === 0) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {row.connectors.slice(0, 4).map((c, i) => {
        const meta = getConnectorMeta(c.name);
        return (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <ConnectorIcon meta={meta} size="w-3 h-3" />
            </div>
            <span className="truncate text-md">{meta.label}</span>
            {c.role && <span className="typo-label text-foreground/60 flex-shrink-0">· {c.role}</span>}
          </div>
        );
      })}
      {row.connectors.length > 4 && (
        <span className="typo-label text-foreground/60">+{row.connectors.length - 4} more</span>
      )}
    </div>
  );
}

function TriggersBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (row.triggers.length === 0) return <span>{t.templates.chronology.manual_only}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {row.triggers.slice(0, 3).map((tr, i) => {
        const Icon = triggerIcon(tr.trigger_type);
        return (
          <div key={i} className="flex items-start gap-2">
            <Icon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{prettyTriggerType(t, tr.trigger_type)}</div>
              {triggerDetail(tr) && (
                <div className="typo-code text-foreground/70 truncate">{triggerDetail(tr)}</div>
              )}
            </div>
          </div>
        );
      })}
      {row.triggers.length > 3 && (
        <span className="typo-label text-foreground/60">+{row.triggers.length - 3} more</span>
      )}
    </div>
  );
}

function HumanReviewBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (!row.reviewSummary) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return <span className="line-clamp-5">{row.reviewSummary}</span>;
}

function MessagesBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (!row.messageSummary) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return <span className="line-clamp-5">{row.messageSummary}</span>;
}

function MemoryBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (!row.memorySummary) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return <span className="line-clamp-5">{row.memorySummary}</span>;
}

function EventsBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (row.events.length === 0) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.events.slice(0, 6).map((e, i) => (
        <span key={i} className="typo-code px-1.5 py-0.5 rounded bg-primary/5 border border-card-border text-foreground">
          {e.event_type}
        </span>
      ))}
      {row.events.length > 6 && (
        <span className="typo-label text-foreground/60 self-center">+{row.events.length - 6}</span>
      )}
    </div>
  );
}

function ErrorBody({ row }: { row: ChronologyRow }) {
  const { t } = useTranslation();
  if (!row.errorSummary) return <span>{t.templates.chronology.matrix_cell_empty}</span>;
  return <span className="line-clamp-5">{row.errorSummary}</span>;
}

/* ── Flow center cell ─────────────────────────────────────────────── */
/* Mirrors the PersonaMatrix center hub: rounded-modal shell with heavier
 * elevation, radial violet glow, and a clickable CTA that opens the full
 * ActivityDiagramModal. The tile is the visual anchor of the 3x3 matrix —
 * hence the slightly taller silhouette and the arrow affordance. */

function FlowCenterCell({
  row, flow, onOpen,
}: {
  row: ChronologyRow;
  flow: UseCaseFlow | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const stepCount = flow?.nodes.length ?? row.steps.length;
  const hasFlow = stepCount > 0;

  return (
    <motion.button
      type="button"
      onClick={hasFlow ? onOpen : undefined}
      whileHover={hasFlow ? { scale: 1.015 } : undefined}
      whileTap={hasFlow ? { scale: 0.985 } : undefined}
      disabled={!hasFlow}
      className={`relative rounded-modal border overflow-hidden flex flex-col items-center justify-center min-h-[160px] p-4 shadow-elevation-2 transition-[border-color,box-shadow] duration-300 cell-glow-violet ${
        hasFlow
          ? 'border-brand-purple/40 bg-card-bg cursor-pointer hover:border-brand-purple/60 hover:shadow-elevation-3'
          : 'border-card-border bg-card-bg/60 cursor-not-allowed opacity-70'
      }`}
    >
      {/* Radial glow backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: hasFlow
            ? 'radial-gradient(ellipse at center, rgba(139,92,246,0.14) 0%, rgba(139,92,246,0.04) 45%, transparent 70%)'
            : 'none',
        }}
      />
      {/* Light reflection arc */}
      {hasFlow && (
        <div
          className="absolute top-0 left-0 w-2/3 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%)' }}
        />
      )}

      <div className="flex flex-col items-center gap-2.5 relative z-10">
        {/* Workflow orb — mirrors Glass center hub Sparkles badge */}
        <div className="relative w-11 h-11 flex items-center justify-center">
          <span className={`absolute inset-0 rounded-full ${hasFlow ? 'border-2 border-brand-purple/40 shadow-elevation-2' : 'border-2 border-card-border'}`} />
          <span className={`absolute inset-[3px] rounded-full ${hasFlow ? 'bg-brand-purple/15' : 'bg-card-bg/60'}`} />
          <Workflow className={`w-5 h-5 relative z-10 ${hasFlow ? 'text-brand-purple' : 'text-foreground/40'}`} />
        </div>

        <span className="typo-heading font-bold uppercase tracking-[0.15em] text-foreground">
          {c.matrix_cell_flow}
        </span>

        {hasFlow ? (
          <>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-purple/10 border border-brand-purple/25 text-md font-medium text-foreground">
              {c.matrix_steps_count.replace('{count}', String(stepCount))}
            </span>
            <span className="inline-flex items-center gap-1 typo-label tracking-[0.12em] text-brand-purple">
              {c.matrix_open_flow}
              <ArrowUpRight className="w-3 h-3" />
            </span>
          </>
        ) : (
          <span className="text-md text-foreground/55 italic">{c.matrix_no_flow}</span>
        )}
      </div>
    </motion.button>
  );
}

/* ── Main ─────────────────────────────────────────────────────────── */

function CapabilityMatrixImpl({ row, flow, templateName }: CapabilityMatrixProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [showDiagram, setShowDiagram] = useState(false);

  // Cells — 3x3 grid matching the original Matrix vocabulary. Each cell
  // carries its hand-drawn MatrixIcon as the watermark identity and a
  // cell-glow-* class that tints the hover glow via CSS variables.
  const cells = {
    description: { label: c.matrix_cell_description,  watermark: UseCasesIcon,    watermarkColorClass: 'text-violet-400', glowClass: 'cell-glow-violet' },
    apps:        { label: c.matrix_cell_apps,         watermark: ConnectorsIcon,  watermarkColorClass: 'text-cyan-400',   glowClass: 'cell-glow-cyan'   },
    triggers:    { label: c.matrix_cell_triggers,     watermark: TriggersIcon,    watermarkColorClass: 'text-amber-400',  glowClass: 'cell-glow-amber'  },
    review:      { label: c.matrix_cell_human_review, watermark: HumanReviewIcon, watermarkColorClass: 'text-rose-400',   glowClass: 'cell-glow-rose'   },
    messages:    { label: c.matrix_cell_messages,     watermark: MessagesIcon,    watermarkColorClass: 'text-blue-400',   glowClass: 'cell-glow-blue'   },
    memory:      { label: c.matrix_cell_memory,       watermark: MemoryIcon,      watermarkColorClass: 'text-purple-400', glowClass: 'cell-glow-purple' },
    events:      { label: c.matrix_cell_events,       watermark: EventsIcon,      watermarkColorClass: 'text-teal-400',   glowClass: 'cell-glow-teal'   },
    errors:      { label: c.matrix_cell_errors,       watermark: ErrorsIcon,      watermarkColorClass: 'text-orange-400', glowClass: 'cell-glow-orange' },
  } as const;

  // Fill state per dimension — drives the emerald status dot + body contrast.
  const filled = {
    description: !!(row.description || row.summary),
    apps: row.connectors.length > 0,
    triggers: row.triggers.length > 0,
    review: !!row.reviewSummary,
    messages: !!row.messageSummary,
    memory: !!row.memorySummary,
    events: row.events.length > 0,
    errors: !!row.errorSummary,
  };

  return (
    <>
      <div
        className="grid gap-3 p-4"
        style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
      >
        {/* Row 1 */}
        <Cell {...cells.description} filled={filled.description}>
          <DescriptionBody row={row} />
        </Cell>
        <Cell {...cells.apps} filled={filled.apps}>
          <AppsBody row={row} />
        </Cell>
        <Cell {...cells.triggers} filled={filled.triggers}>
          <TriggersBody row={row} />
        </Cell>

        {/* Row 2 — Flow in center */}
        <Cell {...cells.review} filled={filled.review}>
          <HumanReviewBody row={row} />
        </Cell>
        <FlowCenterCell row={row} flow={flow ?? null} onOpen={() => setShowDiagram(true)} />
        <Cell {...cells.messages} filled={filled.messages}>
          <MessagesBody row={row} />
        </Cell>

        {/* Row 3 */}
        <Cell {...cells.memory} filled={filled.memory}>
          <MemoryBody row={row} />
        </Cell>
        <Cell {...cells.events} filled={filled.events}>
          <EventsBody row={row} />
        </Cell>
        <Cell {...cells.errors} filled={filled.errors}>
          <ErrorBody row={row} />
        </Cell>
      </div>

      {showDiagram && flow && (
        <ActivityDiagramModal
          isOpen={showDiagram}
          onClose={() => setShowDiagram(false)}
          templateName={templateName ?? row.title}
          flows={[flow]}
          titleOverride={row.title}
          subtitleOverride={row.summary || row.description || undefined}
        />
      )}
    </>
  );
}

export const CapabilityMatrix = memo(CapabilityMatrixImpl);
