/**
 * PersonaChronologyGlyph — Prototype B (R4): sigil + symbolic side totems.
 *
 * The sigil encodes the abstract "what dimensions are present" layer; the
 * card's dead space is now filled with concrete symbolic data read straight
 * off the template:
 *
 *   • Right totem — connector brand logos for this capability, stacked at
 *     mid-height. Center-out placement: 1st at centre, 2nd above, 3rd
 *     below, 4th above-above, 5th below-below.
 *   • Left totem  — messaging channels parsed from notification_channels.
 *     Same stacking pattern so both flanks read as mirror emblems.
 *   • Policy strip — a footer row of compact chips for review mode, memory
 *     state, event subscriptions, error handler, and flow step count.
 *
 * The `CapabilitySigil`, helpers (`humanizeCron`, `parseChannels`,
 * `stackOffset`, `DIM_META`, …) and the totem components are exported so
 * the GlyphWide variant can reuse them without duplication.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock,
  ListTodo, Plug, MessageSquare, UserCheck, Brain, Activity, AlertTriangle,
  Mail, Bell, Send, Phone, Hash, Workflow,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { useAgentStore } from '@/stores/agentStore';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology, useUseCaseFlows, CHAIN_DIMENSIONS } from './useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from './ChronologyCommandHub';
import { CapabilityMatrix } from './CapabilityMatrix';
import type {
  ChronologyRow, ChronologyTrigger, ChronologyConnector, DimensionKey,
} from './useUseCaseChronology';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

type Props = ChronologyCommandHubProps;

/* ── Dimension palette ────────────────────────────────────────────── */

export interface DimMeta {
  labelKey: keyof Translations['templates']['chronology'];
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  colorClass: string;
}

export const DIM_META: Record<DimensionKey, DimMeta> = {
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

export function triggerIcon(type: string) {
  return TRIGGER_ICONS[type] ?? Zap;
}

export function prettyTriggerType(t: Translations, type: string): string {
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

/* ── Cron humaniser ───────────────────────────────────────────────── */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  const timeStr = (() => {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  const minEvery = /^\*\/(\d+)$/.exec(min);
  if (minEvery && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${minEvery[1]} min`;
  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && hourEvery && dom === '*' && mon === '*' && dow === '*') return `Every ${hourEvery[1]}h`;
  if (dom === '*' && mon === '*' && dow === '*' && timeStr) return `Daily · ${timeStr}`;
  if ((dow === '1-5' || dow === 'MON-FRI') && dom === '*' && mon === '*' && timeStr) return `Weekdays · ${timeStr}`;
  if ((dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') && dom === '*' && mon === '*' && timeStr) return `Weekends · ${timeStr}`;
  if (dom === '*' && mon === '*' && timeStr) {
    const days: string[] = [];
    for (const part of dow.split(',')) {
      const n = parseInt(part, 10);
      if (Number.isNaN(n) || n < 0 || n > 7) continue;
      const name = DAYS[n % 7];
      if (name) days.push(name);
    }
    if (days.length > 0) return `${days.join('/')} · ${timeStr}`;
  }
  return cron;
}

export function triggerDetail(tr: ChronologyTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return humanizeCron(cron);
  }
  return tr.description ?? '';
}

/* ── Channel parser ───────────────────────────────────────────────── */

export interface ParsedChannel {
  type: string;
  description: string;
}

export function parseChannels(summary: string | undefined): ParsedChannel[] {
  if (!summary) return [];
  return summary.split(' · ').map((seg) => {
    const [t, ...rest] = seg.split(':');
    return { type: (t ?? '').trim(), description: rest.join(':').trim() };
  }).filter((ch) => ch.type.length > 0);
}

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  slack: Hash, teams: Hash, discord: Hash,
  telegram: Send,
  email: Mail, smtp: Mail, mail: Mail, gmail: Mail, outlook: Mail,
  sms: Phone,
  webhook: Webhook,
  push: Bell, notification: Bell, notify: Bell,
};

const CHANNEL_TINTS: Record<string, string> = {
  slack: '#4a154b', teams: '#5059C9', discord: '#5865F2',
  telegram: '#229ED9',
  email: '#60a5fa', gmail: '#ea4335', outlook: '#0078d4', smtp: '#60a5fa', mail: '#60a5fa',
  sms: '#22c55e',
  webhook: '#64748b',
  push: '#a78bfa', notification: '#a78bfa', notify: '#a78bfa',
};

export function channelIcon(type: string) {
  return CHANNEL_ICONS[type.toLowerCase()] ?? MessageSquare;
}

export function channelTint(type: string): string {
  return CHANNEL_TINTS[type.toLowerCase()] ?? '#60a5fa';
}

/* ── Totem positioning ────────────────────────────────────────────── */

/** Center-out vertical stacking: 1st at 0, 2nd above, 3rd below, 4th above², 5th below². */
export function stackOffset(i: number): number {
  if (i === 0) return 0;
  const step = Math.ceil(i / 2);
  return i % 2 === 1 ? -step : step;
}

export function ConnectorTotem({ connectors, side, tileSize, spacing, max = 5 }: {
  connectors: ChronologyConnector[];
  side: 'left' | 'right';
  tileSize: number;
  spacing: number;
  max?: number;
}) {
  const shown = connectors.slice(0, max);
  const overflow = connectors.length - shown.length;
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ [side]: 10, width: tileSize } as React.CSSProperties}>
      {shown.map((cn, i) => {
        const offset = stackOffset(i);
        const meta = getConnectorMeta(cn.name);
        return (
          <div
            key={`${cn.name}-${i}`}
            className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-card-border flex items-center justify-center shadow-elevation-1 transition-transform"
            style={{
              top: `calc(50% + ${offset * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
              boxShadow: `0 0 10px ${(meta?.color ?? '#60a5fa')}33, 0 1px 2px rgba(0,0,0,0.25)`,
            }}
            title={`${cn.label || cn.name}${cn.purpose ? ` — ${cn.purpose}` : ''}`}
          >
            <ConnectorIcon meta={meta} size={tileSize >= 44 ? 'w-6 h-6' : 'w-4 h-4'} />
          </div>
        );
      })}
      {overflow > 0 && (() => {
        const offset = stackOffset(max);
        return (
          <div
            className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-dashed border-card-border flex items-center justify-center text-foreground/65 typo-label tabular-nums"
            style={{
              top: `calc(50% + ${offset * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
            }}
          >
            +{overflow}
          </div>
        );
      })()}
    </div>
  );
}

export function ChannelTotem({ channels, side, tileSize, spacing, max = 4 }: {
  channels: ParsedChannel[];
  side: 'left' | 'right';
  tileSize: number;
  spacing: number;
  max?: number;
}) {
  const shown = channels.slice(0, max);
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ [side]: 10, width: tileSize } as React.CSSProperties}>
      {shown.map((ch, i) => {
        const offset = stackOffset(i);
        const Icon = channelIcon(ch.type);
        const tint = channelTint(ch.type);
        return (
          <div
            key={`${ch.type}-${i}`}
            className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-card-border flex items-center justify-center"
            style={{
              top: `calc(50% + ${offset * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
              background: `linear-gradient(135deg, ${tint}22 0%, transparent 100%), rgba(var(--card-bg-rgb), 0.9)`,
              boxShadow: `0 0 10px ${tint}44, 0 1px 2px rgba(0,0,0,0.25)`,
            }}
            title={`${ch.type}${ch.description ? ` — ${ch.description}` : ''}`}
          >
            <Icon className={tileSize >= 44 ? 'w-5 h-5' : 'w-4 h-4'} style={{ color: tint }} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Policy strip ─────────────────────────────────────────────────── */

function reviewLabel(summary: string | undefined): string | null {
  if (!summary) return null;
  const head = summary.split(':')[0]?.trim() ?? '';
  if (!head) return null;
  if (head === 'manual_review') return 'Manual review';
  if (head === 'required') return 'Review required';
  if (head === 'optional') return 'Review optional';
  if (head === 'on_output') return 'Review on output';
  return head.charAt(0).toUpperCase() + head.slice(1).replace(/_/g, ' ');
}

export function PolicyStrip({ row }: { row: ChronologyRow }) {
  const chips: Array<{ icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; label: string; detail?: string }> = [];

  const review = reviewLabel(row.reviewSummary);
  if (review) chips.push({ icon: UserCheck, color: DIM_META.review.color, label: review });

  if (row.memorySummary) {
    chips.push({ icon: Brain, color: DIM_META.memory.color, label: 'Memory' });
  }

  if (row.events.length > 0) {
    const first = row.events[0]?.event_type ?? '';
    chips.push({
      icon: Activity,
      color: DIM_META.event.color,
      label: row.events.length > 1 ? `${first} +${row.events.length - 1}` : first,
    });
  }

  if (row.errorSummary) {
    chips.push({ icon: AlertTriangle, color: DIM_META.error.color, label: 'Error plan' });
  }

  if (row.steps.length > 0) {
    chips.push({ icon: Workflow, color: DIM_META.task.color, label: `${row.steps.length} steps` });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((ch, i) => {
        const Icon = ch.icon;
        return (
          <span
            key={i}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-card-border bg-card-bg/80 backdrop-blur typo-label text-foreground"
            style={{ boxShadow: `inset 0 0 0 1px ${ch.color}22` }}
          >
            <Icon className="w-3 h-3" style={{ color: ch.color }} />
            <span className="truncate max-w-[110px]">{ch.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/* ── Sigil ────────────────────────────────────────────────────────── */

const PETAL_ANGLES: Record<DimensionKey, number> = {
  trigger: 0, task: 45, connector: 90, message: 135,
  review: 180, memory: 225, event: 270, error: 315,
};

export function CapabilitySigil({ row, rowIndex, hovered, size }: {
  row: ChronologyRow;
  rowIndex: number;
  hovered: boolean;
  size: number;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const linkedCount = Object.values(row.presence).filter((p) => p === 'linked').length;

  const center = size / 2;
  const petalOuter = size * 0.44;
  const petalInner = size * 0.14;
  const coreR = size * 0.12;
  const iconRLinked = size * 0.28;
  const iconRShared = size * 0.24;
  const guideInner = size * 0.305;

  const petalPath =
    `M 0 -${petalInner} C ${size * 0.06} -${petalOuter * 0.49}, ${size * 0.06} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.06} -${petalOuter * 0.77}, -${size * 0.06} -${petalOuter * 0.49}, 0 -${petalInner} Z`;
  const petalPathDashed =
    `M 0 -${petalInner} C ${size * 0.05} -${petalOuter * 0.46}, ${size * 0.05} -${petalOuter * 0.71}, 0 -${petalOuter - 10} ` +
    `C -${size * 0.05} -${petalOuter * 0.71}, -${size * 0.05} -${petalOuter * 0.46}, 0 -${petalInner} Z`;
  const nubPath =
    `M 0 -${petalInner} C ${size * 0.012} -${petalInner * 1.15}, ${size * 0.012} -${petalInner * 1.3}, 0 -${petalInner * 1.4} ` +
    `C -${size * 0.012} -${petalInner * 1.3}, -${size * 0.012} -${petalInner * 1.15}, 0 -${petalInner} Z`;

  const coreId = `sigil-core-${row.id}-${rowIndex}`;
  const glowId = `sigil-glow-${row.id}-${rowIndex}`;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        style={{ opacity: row.enabled ? 1 : 0.5 }}
        animate={hovered ? { scale: 1.035 } : { scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <defs>
          <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="55%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
          </radialGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        <circle cx={center} cy={center} r={guideInner} fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2,4" />

        {CHAIN_DIMENSIONS.map((dim, i) => {
          const presence = row.presence[dim];
          const meta = DIM_META[dim];
          const angle = PETAL_ANGLES[dim];
          const petalGrad = `sigil-petal-${row.id}-${rowIndex}-${i}`;

          if (presence === 'none') {
            return (
              <g key={`petal-${dim}`} transform={`translate(${center} ${center}) rotate(${angle})`}>
                <path d={nubPath} fill="currentColor" fillOpacity="0.2" />
              </g>
            );
          }

          if (presence === 'shared') {
            return (
              <g key={`petal-${dim}`} transform={`translate(${center} ${center}) rotate(${angle})`}>
                <path
                  d={petalPathDashed}
                  fill={meta.color}
                  fillOpacity="0.08"
                  stroke={meta.color}
                  strokeWidth="1.4"
                  strokeOpacity="0.75"
                  strokeDasharray="4,4"
                />
              </g>
            );
          }

          return (
            <g key={`petal-${dim}`} transform={`translate(${center} ${center}) rotate(${angle})`}>
              <defs>
                <linearGradient id={petalGrad} x1="0" y1={-petalOuter} x2="0" y2={-petalInner} gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor={meta.color} stopOpacity="0.95" />
                  <stop offset="55%" stopColor={meta.color} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={meta.color} stopOpacity="0.12" />
                </linearGradient>
              </defs>
              <path
                d={petalPath}
                fill={`url(#${petalGrad})`}
                stroke={meta.color}
                strokeWidth="1.3"
                strokeOpacity="0.95"
                filter={`url(#${glowId})`}
              />
              <circle cx={0} cy={-petalOuter + 8} r={3} fill="#fff" opacity="0.95" />
            </g>
          );
        })}

        <circle cx={center} cy={center} r={coreR + 10} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        <circle cx={center} cy={center} r={coreR} fill={`url(#${coreId})`} />
        <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity={row.enabled ? 0.45 : 0.18} strokeWidth="1.2" />
        <text
          x={center}
          y={center + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-current"
          style={{ fontSize: `${size * 0.09}px`, fontWeight: 700, letterSpacing: '0.03em' }}
        >
          {linkedCount}
        </text>
        <text
          x={center}
          y={center + size * 0.065}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-current"
          style={{ fontSize: `${size * 0.027}px`, letterSpacing: '0.3em', opacity: 0.55 }}
        >
          DIMS
        </text>
      </motion.svg>

      {CHAIN_DIMENSIONS.map((dim) => {
        const presence = row.presence[dim];
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const angle = PETAL_ANGLES[dim];
        const label = c[meta.labelKey];
        if (presence === 'none') return null;

        const iconR = presence === 'linked' ? iconRLinked : iconRShared;
        const iconBox = presence === 'linked' ? size * 0.094 : size * 0.065;
        const rad = (angle - 90) * Math.PI / 180;
        const scale = hovered ? 1.035 : 1;
        const x = center + iconR * Math.cos(rad) * scale;
        const y = center + iconR * Math.sin(rad) * scale;

        return (
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center pointer-events-none transition-transform duration-300"
            style={{
              left: x - iconBox / 2,
              top: y - iconBox / 2,
              width: iconBox,
              height: iconBox,
            }}
            title={c.presence_tooltip.replace('{label}', label).replace('{state}', presence)}
          >
            {presence === 'linked' ? (
              <>
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `${meta.color}33`,
                    boxShadow: `0 0 14px ${meta.color}77`,
                  }}
                />
                <Icon
                  className="relative"
                  style={{
                    width: iconBox - 10,
                    height: iconBox - 10,
                    color: '#fff',
                    filter: `drop-shadow(0 0 4px ${meta.color})`,
                  }}
                />
              </>
            ) : (
              <Icon className={meta.colorClass} style={{ width: iconBox - 4, height: iconBox - 4, opacity: 0.8 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────────── */

function GlyphCard({ row, index, flow, templateName }: {
  row: ChronologyRow;
  index: number;
  flow: UseCaseFlow | null;
  templateName?: string;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const trigText = row.triggers[0]
    ? (() => {
      const detail = triggerDetail(row.triggers[0]);
      const label = prettyTriggerType(t, row.triggers[0].trigger_type);
      return detail ? detail : label;
    })()
    : c.manual_only;

  const channels = parseChannels(row.messageSummary);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={`relative rounded-modal bg-card-bg border overflow-hidden group transition-[border-color,box-shadow,transform] duration-300 ${
        expanded
          ? 'border-primary/35 col-span-full shadow-elevation-3'
          : 'border-card-border shadow-elevation-2 hover:border-primary/30 hover:-translate-y-1 hover:shadow-elevation-3'
      }`}
    >
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${hovered ? 'opacity-100' : 'opacity-60'}`}
        style={{
          background:
            `radial-gradient(circle at 50% 50%, ${row.enabled ? DIM_META.trigger.color + '22' : 'transparent'} 0%, transparent 55%),` +
            `radial-gradient(ellipse 80% 50% at 50% 100%, ${row.enabled ? DIM_META.memory.color + '18' : 'transparent'} 0%, transparent 70%)`,
        }}
      />
      <div
        className="absolute top-0 left-0 w-full h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-full text-left cursor-pointer min-h-[440px] flex flex-col"
      >
        {/* Hero sigil */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <CapabilitySigil row={row} rowIndex={index} hovered={hovered} size={280} />
        </div>

        {/* Side totems — channels mirror connectors across the sigil's vertical axis */}
        {channels.length > 0 && (
          <ChannelTotem channels={channels} side="left" tileSize={32} spacing={40} max={4} />
        )}
        {row.connectors.length > 0 && (
          <ConnectorTotem connectors={row.connectors} side="right" tileSize={36} spacing={44} max={5} />
        )}

        {/* Header — title + trigger on one row */}
        <div className="relative z-10 flex items-center gap-2 px-4 py-3 bg-gradient-to-b from-card-bg/95 via-card-bg/70 to-transparent backdrop-blur-sm">
          <span className="typo-data text-foreground/55 tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={`typo-heading font-bold uppercase tracking-[0.12em] truncate flex-1 ${row.enabled ? 'text-foreground' : 'text-foreground/50'}`}>
            {row.title}
          </span>
          {!row.enabled && (
            <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/70 shrink-0">
              {c.off_badge}
            </span>
          )}
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card-bg/80 backdrop-blur border border-card-border shadow-elevation-1 typo-body text-foreground shrink-0">
            {TrigIcon && <TrigIcon className="w-3.5 h-3.5 text-amber-400" />}
            <span className="truncate max-w-[150px]">{trigText}</span>
          </span>
        </div>

        <div className="flex-1" />

        {/* Footer — summary + policy strip */}
        <div className="relative z-10 flex flex-col gap-2 px-4 py-3 bg-gradient-to-t from-card-bg/95 via-card-bg/75 to-transparent backdrop-blur-sm">
          {row.summary && (
            <div className="typo-body text-foreground/90 leading-snug line-clamp-2">
              {row.summary}
            </div>
          )}
          <PolicyStrip row={row} />
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
    </motion.div>
  );
}

/* ── Legend ───────────────────────────────────────────────────────── */

function GlyphLegend() {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 rounded-modal bg-card-bg border border-card-border shadow-elevation-1">
      <span className="typo-label font-bold uppercase tracking-[0.15em] text-foreground">{c.legend_label}</span>
      {CHAIN_DIMENSIONS.map((k) => {
        const meta = DIM_META[k];
        const Icon = meta.icon;
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span
              className="inline-flex w-5 h-5 items-center justify-center rounded-sm"
              style={{ background: `${meta.color}33`, boxShadow: `0 0 4px ${meta.color}66` }}
            >
              <Icon className="w-3 h-3" style={{ color: '#fff' }} />
            </span>
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

/* ── Main ─────────────────────────────────────────────────────────── */

function PersonaChronologyGlyphImpl(props: Props) {
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((row, i) => (
              <GlyphCard
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
      {rows.length > 0 && <GlyphLegend />}
    </div>
  );
}

export const PersonaChronologyGlyph = memo(PersonaChronologyGlyphImpl);
