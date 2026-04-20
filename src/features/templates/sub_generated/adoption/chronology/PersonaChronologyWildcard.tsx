/**
 * PersonaChronologyWildcard — Prototype B: capability constellation grid.
 *
 * Each use case becomes a "capability coin": a radial SVG ring with 8
 * dimension markers arranged clockwise. Present dimensions light up and
 * draw a spoke to the core; absent ones stay as dashed outlines. The
 * silhouette gives each capability a recognisable fingerprint.
 *
 * Styling floor parity with Matrix (Glass): glassy rounded-modal cards,
 * layered shadow, radial mesh background, hover accent. Command bar swapped
 * for the shared ChronologyCommandHub so testing + mid-build Q&A behave
 * identically to the Matrix prototype.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock,
  ListTodo, Plug, MessageSquare, UserCheck, Brain, Activity, AlertTriangle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { useAgentStore } from '@/stores/agentStore';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology, useUseCaseFlows, CHAIN_DIMENSIONS } from './useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from './ChronologyCommandHub';
import { CapabilityMatrix } from './CapabilityMatrix';
import type {
  ChronologyRow, ChronologyTrigger, DimensionKey,
} from './useUseCaseChronology';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

type Props = ChronologyCommandHubProps;

/* ── Dimension palette ──────────────────────────────────────────────── */

interface DimMeta {
  labelKey: keyof Translations['templates']['chronology'];
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  colorClass: string;
}

const DIM_META: Record<DimensionKey, DimMeta> = {
  trigger:   { labelKey: 'dim_trigger',   icon: Calendar,      color: '#fbbf24', colorClass: 'text-amber-400' },
  task:      { labelKey: 'dim_task',      icon: ListTodo,      color: '#a78bfa', colorClass: 'text-violet-400' },
  connector: { labelKey: 'dim_apps',      icon: Plug,          color: '#22d3ee', colorClass: 'text-cyan-400' },
  message:   { labelKey: 'dim_message',   icon: MessageSquare, color: '#60a5fa', colorClass: 'text-blue-400' },
  review:    { labelKey: 'dim_review',    icon: UserCheck,     color: '#fb7185', colorClass: 'text-rose-400' },
  memory:    { labelKey: 'dim_memory',    icon: Brain,         color: '#c084fc', colorClass: 'text-purple-400' },
  event:     { labelKey: 'dim_event',     icon: Activity,      color: '#2dd4bf', colorClass: 'text-teal-400' },
  error:     { labelKey: 'dim_error',     icon: AlertTriangle, color: '#fb923c', colorClass: 'text-orange-400' },
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
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 32;
  const spokeR = 80;
  const markerR = 14;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <defs>
          <radialGradient id="ring-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
          </radialGradient>
        </defs>

        {/* Outer guide ring */}
        <circle cx={cx} cy={cy} r={spokeR + 14} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />

        {/* Spokes */}
        {CHAIN_DIMENSIONS.map((dim) => {
          const presence = row.presence[dim];
          if (presence === 'none') return null;
          const meta = DIM_META[dim];
          const angle = SPOKE_ANGLES[dim];
          const end = polar(angle, spokeR - markerR, cx, cy);
          const start = polar(angle, innerR + 4, cx, cy);
          return (
            <line
              key={`spoke-${dim}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={meta.color}
              strokeOpacity={presence === 'linked' ? 0.7 : 0.35}
              strokeWidth="1.5"
              strokeDasharray={presence === 'shared' ? '3,3' : undefined}
            />
          );
        })}

        {/* Marker circles (no icons — those are overlaid as HTML below) */}
        {CHAIN_DIMENSIONS.map((dim) => {
          const presence = row.presence[dim];
          const meta = DIM_META[dim];
          const angle = SPOKE_ANGLES[dim];
          const pos = polar(angle, spokeR, cx, cy);
          const filled = presence !== 'none';
          return (
            <g key={`marker-${dim}`}>
              {presence === 'linked' && (
                <circle cx={pos.x} cy={pos.y} r={markerR + 3} fill={meta.color} fillOpacity={0.18} />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={markerR}
                fill={filled ? meta.color : 'transparent'}
                fillOpacity={presence === 'linked' ? 0.28 : presence === 'shared' ? 0.15 : 0}
                stroke={filled ? meta.color : 'currentColor'}
                strokeOpacity={filled ? 0.9 : 0.25}
                strokeWidth="1.4"
                strokeDasharray={presence === 'shared' ? '3,3' : presence === 'none' ? '2,3' : undefined}
              />
            </g>
          );
        })}

        {/* Core */}
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="url(#ring-core)"
          stroke="currentColor"
          strokeOpacity={row.enabled ? 0.4 : 0.15}
          strokeWidth="1"
        />
        <text
          x={cx}
          y={cy + 5}
          textAnchor="middle"
          className="fill-current"
          style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em', opacity: row.enabled ? 1 : 0.4 }}
        >
          {row.triggers.length > 0 ? row.connectors.length : '—'}
        </text>
      </svg>

      {/* Icon overlay — lucide icons placed at polar coords so each orbit
          circle tells the user which dimension it represents at a glance. */}
      {CHAIN_DIMENSIONS.map((dim) => {
        const presence = row.presence[dim];
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const angle = SPOKE_ANGLES[dim];
        const pos = polar(angle, spokeR, cx, cy);
        const filled = presence !== 'none';
        const label = c[meta.labelKey];
        return (
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center pointer-events-none transition-opacity"
            style={{
              left: pos.x - markerR,
              top: pos.y - markerR,
              width: markerR * 2,
              height: markerR * 2,
              opacity: filled ? 1 : 0.35,
            }}
            title={c.presence_tooltip.replace('{label}', label).replace('{state}', presence)}
          >
            <Icon className={`w-3.5 h-3.5 ${meta.colorClass}`} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Legend ─────────────────────────────────────────────────────────── */

function DimLegend() {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 rounded-modal bg-card-bg border border-card-border shadow-elevation-1">
      <span className="typo-label font-bold uppercase tracking-[0.15em] text-foreground">{c.legend_label}</span>
      {CHAIN_DIMENSIONS.map((k) => {
        const meta = DIM_META[k];
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className="block w-2.5 h-2.5 rounded-full shadow-elevation-1" style={{ backgroundColor: meta.color }} />
            <span className="typo-body text-foreground">{c[meta.labelKey]}</span>
          </div>
        );
      })}
      <span className="ml-auto typo-body text-foreground/75">
        {c.legend_semantics}
      </span>
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

function ConstellationCard({ row, index, flow, templateName }: {
  row: ChronologyRow;
  index: number;
  flow: UseCaseFlow | null;
  templateName?: string;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [expanded, setExpanded] = useState(false);
  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const linkedCount = Object.values(row.presence).filter((p) => p === 'linked').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      className={`relative rounded-modal bg-card-bg border transition-[border-color,box-shadow,transform] duration-300 overflow-hidden group ${
        expanded
          ? 'border-primary/35 col-span-full shadow-elevation-3'
          : 'border-card-border shadow-elevation-2 hover:border-primary/25 hover:-translate-y-0.5 hover:shadow-elevation-3'
      }`}
    >
      {/* Radial mesh background — keyed off the primary trigger hue */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.45] group-hover:opacity-60 transition-opacity duration-300"
        style={{
          background: `radial-gradient(ellipse at 20% 0%, ${
            row.enabled ? `${DIM_META.trigger.color}18` : 'transparent'
          } 0%, transparent 55%)`,
        }}
      />
      {/* Light reflection */}
      <div
        className="absolute top-0 left-0 w-2/3 h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%)' }}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-full flex items-start gap-4 p-4 text-left cursor-pointer"
      >
        <CapabilityRing row={row} />

        <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <span className="typo-data text-foreground/50 tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className={`typo-heading font-bold uppercase tracking-[0.12em] truncate ${row.enabled ? 'text-foreground' : 'text-foreground/50'}`}>
              {row.title}
            </span>
            {!row.enabled && (
              <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/70">{c.off_badge}</span>
            )}
          </div>

          <div className="flex items-center gap-2 typo-body text-foreground">
            {TrigIcon && <TrigIcon className="w-4 h-4 text-amber-400" />}
            <span className="truncate">
              {row.triggers[0]
                ? `${prettyTriggerType(t, row.triggers[0].trigger_type)}${triggerDetail(row.triggers[0]) ? ' · ' + triggerDetail(row.triggers[0]) : ''}`
                : c.manual_only}
            </span>
          </div>

          {row.summary && (
            <div className="typo-body text-foreground/85 leading-snug line-clamp-2">
              {row.summary}
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1">
              {row.connectors.slice(0, 4).map((cn, i) => {
                const meta = getConnectorMeta(cn.name);
                return (
                  <div key={i} className="w-6 h-6 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shadow-elevation-1">
                    <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                  </div>
                );
              })}
              {row.connectors.length > 4 && (
                <span className="text-md font-semibold text-foreground ml-0.5 tabular-nums">
                  +{row.connectors.length - 4}
                </span>
              )}
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/5 border border-primary/15 typo-label tracking-[0.1em] text-foreground">
              {c.dims_ratio.replace('{count}', String(linkedCount))}
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
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden relative"
          >
            <div className="border-t border-card-border/60">
              <CapabilityMatrix row={row} flow={flow} templateName={templateName} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Presence ribbon — full-width footer showing all 8 dims at a glance */}
      <div className="h-1.5 flex relative">
        {CHAIN_DIMENSIONS.map((k) => {
          const presence = row.presence[k];
          const meta = DIM_META[k];
          const opacity = presence === 'linked' ? 1 : presence === 'shared' ? 0.35 : 0.08;
          return (
            <div
              key={k}
              className="flex-1"
              style={{ background: meta.color, opacity }}
              title={c.presence_tooltip.replace('{label}', c[meta.labelKey]).replace('{state}', presence)}
            />
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */

function PersonaChronologyWildcardImpl(props: Props) {
  const { t } = useTranslation();
  const rows = useUseCaseChronology();
  const flowsById = useUseCaseFlows();
  const templateName = useAgentStore((s) => {
    const draft = s.buildDraft as Record<string, unknown> | null;
    const name = draft?.name;
    return typeof name === 'string' ? name : undefined;
  });
  const c = t.templates.chronology;

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <ChronologyCommandHub {...props} />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {rows.length === 0 ? (
          <div className="rounded-modal bg-card-bg border border-card-border p-8 text-center shadow-elevation-2">
            <span className="typo-body text-foreground/75 italic">{c.empty_seeding}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {rows.map((row, i) => (
              <ConstellationCard
                key={row.id}
                row={row}
                index={i}
                flow={flowsById.get(row.id) ?? null}
                templateName={templateName}
              />
            ))}
          </div>
        )}
      </div>
      {rows.length > 0 && <DimLegend />}
    </div>
  );
}

export const PersonaChronologyWildcard = memo(PersonaChronologyWildcardImpl);
