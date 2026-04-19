/**
 * PersonaChronologyWildcard — Prototype B: capability constellation grid.
 *
 * Each use case becomes a "capability coin": a radial SVG ring with 8
 * dimension markers arranged clockwise. Present dimensions light up and
 * draw a spoke to the core; absent ones stay as dashed outlines. The
 * silhouette gives each capability a recognisable fingerprint.
 *
 * Typography floor: `text-md` for all body-weight text. `typo-label`
 * (uppercase 12px) is reserved for iconographic chip labels only.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock,
  ListTodo, Plug, MessageSquare, UserCheck, Brain, Activity, AlertTriangle,
  Loader2, Play, CheckCircle2, Sparkles,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology, CHAIN_DIMENSIONS } from './useUseCaseChronology';
import type {
  ChronologyRow, ChronologyTrigger, DimensionKey,
} from './useUseCaseChronology';
import type { BuildPhase } from '@/lib/types/buildTypes';

interface Props {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  buildActivity?: string | null;
  onStartTest?: () => void;
  onApproveTest?: () => void;
  onViewAgent?: () => void;
}

/* ── Dimension palette ──────────────────────────────────────────────── */

const DIM_META: Record<DimensionKey, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  colorClass: string;
}> = {
  trigger:   { label: 'Trigger',   icon: Calendar,      color: '#fbbf24', colorClass: 'text-amber-400' },
  task:      { label: 'Task',      icon: ListTodo,      color: '#a78bfa', colorClass: 'text-violet-400' },
  connector: { label: 'Apps',      icon: Plug,          color: '#22d3ee', colorClass: 'text-cyan-400' },
  message:   { label: 'Message',   icon: MessageSquare, color: '#60a5fa', colorClass: 'text-blue-400' },
  review:    { label: 'Review',    icon: UserCheck,     color: '#fb7185', colorClass: 'text-rose-400' },
  memory:    { label: 'Memory',    icon: Brain,         color: '#c084fc', colorClass: 'text-purple-400' },
  event:     { label: 'Event',     icon: Activity,      color: '#2dd4bf', colorClass: 'text-teal-400' },
  error:     { label: 'Error',     icon: AlertTriangle, color: '#fb923c', colorClass: 'text-orange-400' },
};

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

function prettyTriggerType(type: string): string {
  switch (type) {
    case 'schedule': return 'Schedule';
    case 'webhook': return 'Webhook';
    case 'manual': return 'Manual';
    case 'polling': return 'Polling';
    case 'event_listener': return 'Event';
    case 'file_watcher': return 'File watch';
    case 'app_focus': return 'App focus';
    default: return type;
  }
}

function triggerDetail(t: ChronologyTrigger): string {
  if (t.trigger_type === 'schedule' && t.config) {
    const cron = typeof t.config.cron === 'string' ? t.config.cron : '';
    if (cron) return cron;
  }
  return t.description ?? '';
}

/* ── Capability ring ─────────────────────────────────────────────────── */

const SPOKE_ANGLES: Record<DimensionKey, number> = {
  trigger:   -90,
  task:      -45,
  connector:   0,
  message:    45,
  review:     90,
  memory:    135,
  event:     180,
  error:    -135,
};

function polar(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function CapabilityRing({ row }: { row: ChronologyRow }) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 26;
  const spokeR = 62;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={spokeR + 12} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />

      {CHAIN_DIMENSIONS.map((dim) => {
        const presence = row.presence[dim];
        if (presence === 'none') return null;
        const meta = DIM_META[dim];
        const angle = SPOKE_ANGLES[dim];
        const end = polar(angle, spokeR - 10, cx, cy);
        const start = polar(angle, innerR + 4, cx, cy);
        return (
          <line
            key={`spoke-${dim}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={meta.color}
            strokeOpacity={presence === 'linked' ? 0.65 : 0.3}
            strokeWidth="1.5"
            strokeDasharray={presence === 'shared' ? '3,3' : undefined}
          />
        );
      })}

      {CHAIN_DIMENSIONS.map((dim) => {
        const presence = row.presence[dim];
        const meta = DIM_META[dim];
        const angle = SPOKE_ANGLES[dim];
        const pos = polar(angle, spokeR, cx, cy);
        const filled = presence !== 'none';
        return (
          <g key={`marker-${dim}`}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={11}
              fill={filled ? meta.color : 'transparent'}
              fillOpacity={presence === 'linked' ? 0.95 : presence === 'shared' ? 0.35 : 0}
              stroke={filled ? meta.color : 'currentColor'}
              strokeOpacity={filled ? 0.9 : 0.25}
              strokeWidth="1.3"
              strokeDasharray={presence === 'shared' ? '3,3' : presence === 'none' ? '2,3' : undefined}
            />
          </g>
        );
      })}

      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="currentColor"
        fillOpacity={row.enabled ? 0.1 : 0.03}
        stroke="currentColor"
        strokeOpacity={row.enabled ? 0.35 : 0.15}
        strokeWidth="1"
      />
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        className="fill-current"
        style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}
      >
        {row.triggers.length > 0 ? row.connectors.length : '—'}
      </text>
    </svg>
  );
}

/* ── Legend ─────────────────────────────────────────────────────────── */

function DimLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 rounded-modal bg-card-bg border border-card-border">
      <span className="typo-label text-foreground">Legend</span>
      {CHAIN_DIMENSIONS.map((k) => {
        const meta = DIM_META[k];
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
            <span className="text-md text-foreground">{meta.label}</span>
          </div>
        );
      })}
      <span className="ml-auto text-md text-foreground">
        filled = linked · dashed = shared · hollow = none
      </span>
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

function ConstellationCard({ row, index }: { row: ChronologyRow; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const linkedCount = Object.values(row.presence).filter((p) => p === 'linked').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className={`relative rounded-modal bg-card-bg border transition-all overflow-hidden ${
        expanded ? 'border-primary/30 col-span-full' : 'border-card-border hover:border-primary/20'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-4 p-4 text-left cursor-pointer"
      >
        <CapabilityRing row={row} />

        <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <span className="typo-data text-foreground">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-md font-bold text-foreground truncate">{row.title}</span>
            {!row.enabled && (
              <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">Off</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-md text-foreground">
            {TrigIcon && <TrigIcon className="w-4 h-4 text-amber-400" />}
            <span className="truncate">
              {row.triggers[0]
                ? `${prettyTriggerType(row.triggers[0].trigger_type)}${triggerDetail(row.triggers[0]) ? ' · ' + triggerDetail(row.triggers[0]) : ''}`
                : 'Manual only'}
            </span>
          </div>

          {row.summary && (
            <div className="text-md text-foreground leading-snug line-clamp-2">
              {row.summary}
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1">
              {row.connectors.slice(0, 4).map((c, i) => {
                const meta = getConnectorMeta(c.name);
                return (
                  <div key={i} className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <ConnectorIcon meta={meta} size="w-3 h-3" />
                  </div>
                );
              })}
              {row.connectors.length > 4 && (
                <span className="text-md font-semibold text-foreground ml-0.5">
                  +{row.connectors.length - 4}
                </span>
              )}
            </div>
            <span className="ml-auto typo-data text-foreground">
              {linkedCount}/8 dims
            </span>
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-4 border-t border-card-border/60 pt-4">
              {row.description && (
                <DimBlock label="Description" color="#a78bfa" span={3}>
                  <span className="text-md text-foreground leading-relaxed">{row.description}</span>
                </DimBlock>
              )}
              {row.triggers.length > 0 && (
                <DimBlock label="Trigger" color={DIM_META.trigger.color}>
                  {row.triggers.map((t, i) => (
                    <div key={i} className="text-md text-foreground">
                      <span className="font-semibold">{prettyTriggerType(t.trigger_type)}</span>
                      {triggerDetail(t) && <span> — {triggerDetail(t)}</span>}
                    </div>
                  ))}
                </DimBlock>
              )}
              {row.connectors.length > 0 && (
                <DimBlock label="Apps & Services" color={DIM_META.connector.color} span={2}>
                  <div className="flex flex-wrap gap-1.5">
                    {row.connectors.map((c, i) => {
                      const meta = getConnectorMeta(c.name);
                      return (
                        <div key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/5 border border-card-border">
                          <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                          <span className="text-md text-foreground">{meta.label}</span>
                          {c.role && <span className="typo-label text-foreground">· {c.role}</span>}
                        </div>
                      );
                    })}
                  </div>
                </DimBlock>
              )}
              {row.steps.length > 0 && (
                <DimBlock label={`Flow · ${row.steps.length} steps`} color="#a78bfa" span={3}>
                  <div className="space-y-1">
                    {row.steps.map((s, i) => (
                      <div key={s.id} className="text-md text-foreground leading-snug">
                        <span className="typo-code text-foreground">{String(i + 1).padStart(2, '0')}.</span>{' '}
                        <span className="font-semibold">{s.label}</span>
                        {s.detail && <span className="text-foreground"> — {s.detail}</span>}
                      </div>
                    ))}
                  </div>
                </DimBlock>
              )}
              {row.messageSummary && <DimBlock label="Message" color={DIM_META.message.color}><span className="text-md text-foreground">{row.messageSummary}</span></DimBlock>}
              {row.reviewSummary && <DimBlock label="Review" color={DIM_META.review.color}><span className="text-md text-foreground">{row.reviewSummary}</span></DimBlock>}
              {row.memorySummary && <DimBlock label="Memory" color={DIM_META.memory.color}><span className="text-md text-foreground">{row.memorySummary}</span></DimBlock>}
              {row.events.length > 0 && (
                <DimBlock label="Events" color={DIM_META.event.color}>
                  <div className="flex flex-wrap gap-1.5">
                    {row.events.slice(0, 6).map((e, i) => (
                      <span key={i} className="typo-code text-foreground px-2 py-0.5 rounded bg-primary/5 border border-card-border">
                        {e.event_type}
                      </span>
                    ))}
                    {row.events.length > 6 && <span className="text-md text-foreground">+{row.events.length - 6}</span>}
                  </div>
                </DimBlock>
              )}
              {row.errorSummary && <DimBlock label="Error handling" color={DIM_META.error.color}><span className="text-md text-foreground">{row.errorSummary}</span></DimBlock>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-1.5 flex">
        {CHAIN_DIMENSIONS.map((k) => {
          const presence = row.presence[k];
          const meta = DIM_META[k];
          const opacity = presence === 'linked' ? 1 : presence === 'shared' ? 0.35 : 0.08;
          return (
            <div
              key={k}
              className="flex-1"
              style={{ background: meta.color, opacity }}
              title={`${meta.label}: ${presence}`}
            />
          );
        })}
      </div>
    </motion.div>
  );
}

function DimBlock({ label, color, children, span = 1 }: {
  label: string;
  color: string;
  children: React.ReactNode;
  span?: 1 | 2 | 3;
}) {
  const spanCls = span === 3 ? 'col-span-full' : span === 2 ? 'col-span-2' : '';
  return (
    <div className={spanCls}>
      <div className="typo-label mb-1.5" style={{ color }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

/* ── Command bar ────────────────────────────────────────────────────── */

function CommandBar({
  buildPhase, completeness = 0, isRunning, buildActivity,
  onStartTest, onApproveTest, onViewAgent,
}: Omit<Props, 'cellBuildStates'>) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(100, Math.max(0, completeness)));

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-modal bg-card-bg border border-card-border">
      <span className="typo-label text-foreground">{buildPhase ?? 'idle'}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden max-w-[220px]">
          <motion.div
            className="h-full bg-primary/40"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <span className="text-md font-semibold text-foreground tabular-nums">{pct}%</span>
        {isRunning && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
      </div>
      {buildActivity && (
        <div className="hidden md:block text-md text-foreground truncate max-w-[260px]">
          {buildActivity}
        </div>
      )}
      <div className="flex items-center gap-2">
        {onStartTest && buildPhase === 'draft_ready' && (
          <button onClick={onStartTest} className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-primary/10 border border-primary/15 hover:bg-primary/20 text-md font-medium text-foreground cursor-pointer">
            <Play className="w-4 h-4" /> {t.templates.matrix_variants.start_test}
          </button>
        )}
        {buildPhase === 'testing' && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-emerald-500/10 border border-emerald-500/20 text-md text-emerald-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {t.templates.matrix_variants.testing_agent}
          </div>
        )}
        {onApproveTest && buildPhase === 'test_complete' && (
          <button onClick={onApproveTest} className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 text-md font-medium text-emerald-400 cursor-pointer">
            <CheckCircle2 className="w-4 h-4" /> {t.templates.matrix_variants.approve_and_promote}
          </button>
        )}
        {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
          <button onClick={onViewAgent} className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-primary/10 border border-primary/15 hover:bg-primary/20 text-md font-medium text-foreground cursor-pointer">
            <Sparkles className="w-4 h-4" /> {t.templates.matrix_variants.view_agent_btn}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */

function PersonaChronologyWildcardImpl(props: Props) {
  const rows = useUseCaseChronology();

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <CommandBar {...props} />
      <DimLegend />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {rows.length === 0 ? (
          <div className="rounded-modal bg-card-bg border border-card-border p-8 text-center">
            <span className="text-md text-foreground">No capabilities yet — the template is still seeding.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((row, i) => <ConstellationCard key={row.id} row={row} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export const PersonaChronologyWildcard = memo(PersonaChronologyWildcardImpl);
