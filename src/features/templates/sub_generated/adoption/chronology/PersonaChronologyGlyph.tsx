/**
 * PersonaChronologyGlyph — Prototype B (R3): full-bleed capability sigil.
 *
 * Each use case becomes a unique sigil — eight curved petals around a
 * glowing core — rendered at hero size so the card reads as "one big
 * emblem" instead of a thumbnail above text. Linked dims bloom into
 * filled, glowing petals; shared dims remain dashed outlines; absent
 * dims leave a tiny inward notch.
 *
 * R3 changes:
 *   • Sigil is now the full-card background, 340px, centered behind a
 *     glass header strip and a gradient-overlaid footer.
 *   • Title and humanised trigger time share a single header row.
 *   • All infinite SVG animations removed (no pulsing petals / tip
 *     sparks / drifting particles). Remaining motion is hover-gated.
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

interface DimMeta {
  labelKey: keyof Translations['templates']['chronology'];
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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

/* ── Cron humanizer ───────────────────────────────────────────────── */

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
  if (minEvery && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${minEvery[1]} min`;
  }
  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && hourEvery && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hourEvery[1]}h`;
  }
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
  if (mon === '*' && dow === '*' && timeStr) {
    const domNum = parseInt(dom, 10);
    if (!Number.isNaN(domNum)) return `Monthly · ${domNum}${ordinalSuffix(domNum)} · ${timeStr}`;
  }
  return cron;
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'] as const;
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function triggerDetail(tr: ChronologyTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return humanizeCron(cron);
  }
  return tr.description ?? '';
}

/* ── Sigil ──────────────────────────────────────────────────────────── */

const PETAL_ANGLES: Record<DimensionKey, number> = {
  trigger:   0,
  task:      45,
  connector: 90,
  message:   135,
  review:    180,
  memory:    225,
  event:     270,
  error:     315,
};

const SIZE = 340;
const CENTER = SIZE / 2;
const CORE_R = 42;
const PETAL_OUTER = 150;
const PETAL_INNER = 46;
const ICON_R_LINKED = 96;
const ICON_R_SHARED = 82;

function CapabilitySigil({ row, rowIndex, hovered }: {
  row: ChronologyRow;
  rowIndex: number;
  hovered: boolean;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const linkedCount = Object.values(row.presence).filter((p) => p === 'linked').length;

  const petalPath =
    `M 0 -${PETAL_INNER} C 20 -74, 20 -116, 0 -${PETAL_OUTER} C -20 -116, -20 -74, 0 -${PETAL_INNER} Z`;
  const petalPathDashed =
    `M 0 -${PETAL_INNER} C 17 -70, 17 -108, 0 -${PETAL_OUTER - 10} C -17 -108, -17 -70, 0 -${PETAL_INNER} Z`;
  const nubPath = `M 0 -${PETAL_INNER} C 4 -54, 4 -60, 0 -64 C -4 -60, -4 -54, 0 -${PETAL_INNER} Z`;

  const coreId = `sigil-core-${row.id}-${rowIndex}`;
  const glowId = `sigil-glow-${row.id}-${rowIndex}`;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <motion.svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
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

        {/* Guide rings */}
        <circle cx={CENTER} cy={CENTER} r={PETAL_OUTER} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        <circle cx={CENTER} cy={CENTER} r={104} fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2,4" />

        {/* Petals */}
        {CHAIN_DIMENSIONS.map((dim, i) => {
          const presence = row.presence[dim];
          const meta = DIM_META[dim];
          const angle = PETAL_ANGLES[dim];
          const petalGrad = `sigil-petal-${row.id}-${rowIndex}-${i}`;

          if (presence === 'none') {
            return (
              <g key={`petal-${dim}`} transform={`translate(${CENTER} ${CENTER}) rotate(${angle})`}>
                <path d={nubPath} fill="currentColor" fillOpacity="0.2" />
              </g>
            );
          }

          if (presence === 'shared') {
            return (
              <g key={`petal-${dim}`} transform={`translate(${CENTER} ${CENTER}) rotate(${angle})`}>
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
            <g key={`petal-${dim}`} transform={`translate(${CENTER} ${CENTER}) rotate(${angle})`}>
              <defs>
                <linearGradient id={petalGrad} x1="0" y1={-PETAL_OUTER} x2="0" y2={-PETAL_INNER} gradientUnits="userSpaceOnUse">
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
              {/* Tip ornament — static spark at petal crown */}
              <circle cx={0} cy={-PETAL_OUTER + 8} r={3} fill="#fff" opacity="0.95" />
            </g>
          );
        })}

        {/* Core */}
        <circle cx={CENTER} cy={CENTER} r={CORE_R + 10} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        <circle cx={CENTER} cy={CENTER} r={CORE_R} fill={`url(#${coreId})`} />
        <circle cx={CENTER} cy={CENTER} r={CORE_R} fill="none" stroke="currentColor" strokeOpacity={row.enabled ? 0.45 : 0.18} strokeWidth="1.2" />
        <text
          x={CENTER}
          y={CENTER + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-current"
          style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '0.03em' }}
        >
          {linkedCount}
        </text>
        <text
          x={CENTER}
          y={CENTER + 22}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-current"
          style={{ fontSize: '9px', letterSpacing: '0.3em', opacity: 0.55 }}
        >
          DIMS
        </text>
      </motion.svg>

      {/* HTML icon overlay — one large icon per petal */}
      {CHAIN_DIMENSIONS.map((dim) => {
        const presence = row.presence[dim];
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const angle = PETAL_ANGLES[dim];
        const label = c[meta.labelKey];
        if (presence === 'none') return null;

        const iconR = presence === 'linked' ? ICON_R_LINKED : ICON_R_SHARED;
        const iconBox = presence === 'linked' ? 32 : 22;
        const rad = (angle - 90) * Math.PI / 180;
        const scale = hovered ? 1.035 : 1;
        const x = CENTER + iconR * Math.cos(rad) * scale;
        const y = CENTER + iconR * Math.sin(rad) * scale;

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

/* ── Card ──────────────────────────────────────────────────────────── */

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
      {/* Ambient backdrop — trigger + memory hues set the emotional tone */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${hovered ? 'opacity-100' : 'opacity-60'}`}
        style={{
          background:
            `radial-gradient(circle at 50% 50%, ${row.enabled ? DIM_META.trigger.color + '22' : 'transparent'} 0%, transparent 55%),` +
            `radial-gradient(ellipse 80% 50% at 50% 100%, ${row.enabled ? DIM_META.memory.color + '18' : 'transparent'} 0%, transparent 70%)`,
        }}
      />
      {/* Light reflection sheet */}
      <div
        className="absolute top-0 left-0 w-full h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-full text-left cursor-pointer min-h-[420px] flex flex-col"
      >
        {/* Hero sigil — centered absolute, behind content */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <CapabilitySigil row={row} rowIndex={index} hovered={hovered} />
        </div>

        {/* Header — title + trigger time on the same row */}
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
            <span className="truncate max-w-[160px]">{trigText}</span>
          </span>
        </div>

        {/* Spacer — pushes footer down while sigil fills the middle */}
        <div className="flex-1" />

        {/* Footer — summary + connectors */}
        <div className="relative z-10 flex flex-col gap-2 px-4 py-3 bg-gradient-to-t from-card-bg/95 via-card-bg/75 to-transparent backdrop-blur-sm">
          {row.summary && (
            <div className="typo-body text-foreground/90 leading-snug line-clamp-2">
              {row.summary}
            </div>
          )}
          {row.connectors.length > 0 && (
            <div className="flex items-center gap-1">
              {row.connectors.slice(0, 6).map((cn, i) => {
                const meta = getConnectorMeta(cn.name);
                return (
                  <div key={i} className="w-7 h-7 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shadow-elevation-1">
                    <ConnectorIcon meta={meta} size="w-4 h-4" />
                  </div>
                );
              })}
              {row.connectors.length > 6 && (
                <span className="text-md font-semibold text-foreground ml-0.5 tabular-nums">
                  +{row.connectors.length - 6}
                </span>
              )}
            </div>
          )}
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

/* ── Legend ─────────────────────────────────────────────────────────── */

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

/* ── Main ───────────────────────────────────────────────────────────── */

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
