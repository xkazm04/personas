/**
 * PersonaChronologyDossier — Prototype C (R3): data-forward briefing card.
 *
 * Where Constellation and Glyph lean on symbolic encoding, Dossier turns
 * every element into a concrete piece of template data the user already
 * cares about:
 *
 *   • Header           — use case title + humanised trigger time in one row
 *   • Connects via     — brand-icon gallery with connector name + purpose
 *   • Notifies via     — parsed messaging channels w/ recognised app icons
 *   • Policies strip   — review mode, memory state, event count, error plan
 *   • Summary          — one-line capability purpose
 *
 * The elements here (ChannelChip, PolicyChip, ConnectorTile) are also
 * reusable for other surfaces that need to summarise a capability. No
 * infinite animations — only entry fades + hover elevation.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock,
  MessageSquare, UserCheck, Brain, Activity, AlertTriangle,
  Mail, Bell, Send, Phone, Hash,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { useAgentStore } from '@/stores/agentStore';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology, useUseCaseFlows } from './useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from './ChronologyCommandHub';
import { CapabilityMatrix } from './CapabilityMatrix';
import type {
  ChronologyRow, ChronologyTrigger, ChronologyConnector,
} from './useUseCaseChronology';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

type Props = ChronologyCommandHubProps;

/* ── Trigger helpers ────────────────────────────────────────────────── */

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function humanizeCron(cron: string): string {
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
  return cron;
}

function triggerDetail(tr: ChronologyTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return humanizeCron(cron);
  }
  return tr.description ?? '';
}

/* ── Messaging channel parser ──────────────────────────────────────── */

interface ParsedChannel {
  type: string;
  description: string;
}

function parseChannels(summary: string | undefined): ParsedChannel[] {
  if (!summary) return [];
  return summary.split(' · ').map((seg) => {
    const [t, ...rest] = seg.split(':');
    return {
      type: (t ?? '').trim(),
      description: rest.join(':').trim(),
    };
  }).filter((ch) => ch.type.length > 0);
}

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  slack: Hash,
  teams: Hash,
  discord: Hash,
  telegram: Send,
  email: Mail,
  smtp: Mail,
  mail: Mail,
  gmail: Mail,
  outlook: Mail,
  sms: Phone,
  webhook: Webhook,
  push: Bell,
  notification: Bell,
  notify: Bell,
};

const CHANNEL_TINTS: Record<string, string> = {
  slack: '#4a154b',
  teams: '#5059C9',
  discord: '#5865F2',
  telegram: '#229ED9',
  email: '#60a5fa',
  gmail: '#ea4335',
  outlook: '#0078d4',
  sms: '#22c55e',
  webhook: '#64748b',
  push: '#a78bfa',
  notification: '#a78bfa',
};

function channelIcon(type: string): React.ComponentType<{ className?: string }> {
  const key = type.toLowerCase();
  return CHANNEL_ICONS[key] ?? MessageSquare;
}

function channelTint(type: string): string {
  return CHANNEL_TINTS[type.toLowerCase()] ?? '#60a5fa';
}

function prettyChannel(type: string): string {
  const key = type.toLowerCase();
  if (key === 'smtp' || key === 'mail') return 'Email';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/* ── Review / memory helpers ────────────────────────────────────── */

function reviewMode(summary: string | undefined): { mode: string; detail: string | null } | null {
  if (!summary) return null;
  const [head, ...rest] = summary.split(':');
  if (!head) return null;
  const mode = head.trim();
  const detail = rest.join(':').trim();
  const prettyMode =
    mode === 'manual_review' ? 'Manual review' :
    mode === 'required'      ? 'Review required' :
    mode === 'optional'      ? 'Review optional' :
    mode === 'on_output'     ? 'Review on output' :
    mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, ' ');
  return { mode: prettyMode, detail: detail || null };
}

function shortenMemory(summary: string | undefined): string | null {
  if (!summary) return null;
  const s = summary.trim();
  if (s.length <= 60) return s;
  return s.slice(0, 58) + '…';
}

/* ── Building blocks ────────────────────────────────────────────────── */

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/55">
      {label}
    </div>
  );
}

function ConnectorTile({ connector }: { connector: ChronologyConnector }) {
  const meta = getConnectorMeta(connector.name);
  return (
    <div className="group/tile flex flex-col items-start gap-1.5 p-2 rounded-modal bg-primary/5 border border-card-border hover:bg-primary/10 hover:border-primary/25 transition-colors">
      <div className="flex items-center gap-2 w-full">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${meta?.color ?? '#60a5fa'}22` }}
        >
          <ConnectorIcon meta={meta} size="w-5 h-5" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="typo-body font-semibold text-foreground truncate">
            {connector.label || connector.name}
          </span>
          {connector.purpose && (
            <span className="typo-label text-foreground/60 truncate">
              {connector.purpose}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelChip({ channel }: { channel: ParsedChannel }) {
  const Icon = channelIcon(channel.type);
  const tint = channelTint(channel.type);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-modal bg-primary/5 border border-card-border">
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ background: `${tint}33`, boxShadow: `0 0 6px ${tint}55` }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex flex-col min-w-0">
        <span className="typo-label font-semibold text-foreground truncate">
          {prettyChannel(channel.type)}
        </span>
        {channel.description && (
          <span className="typo-label text-foreground/60 truncate max-w-[200px]">
            {channel.description}
          </span>
        )}
      </div>
    </div>
  );
}

function PolicyChip({ icon: Icon, color, label, detail }: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  detail?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-modal bg-primary/5 border border-card-border">
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ background: `${color}33`, boxShadow: `0 0 6px ${color}55` }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex flex-col min-w-0">
        <span className="typo-label font-semibold text-foreground truncate">{label}</span>
        {detail && (
          <span className="typo-label text-foreground/60 truncate max-w-[200px]">{detail}</span>
        )}
      </div>
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

function DossierCard({ row, index, flow, templateName }: {
  row: ChronologyRow;
  index: number;
  flow: UseCaseFlow | null;
  templateName?: string;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [expanded, setExpanded] = useState(false);
  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const trigLabel = row.triggers[0]
    ? prettyTriggerType(t, row.triggers[0].trigger_type)
    : null;
  const trigDetail = row.triggers[0] ? triggerDetail(row.triggers[0]) : null;

  const channels = parseChannels(row.messageSummary);
  const review = reviewMode(row.reviewSummary);
  const memoryShort = shortenMemory(row.memorySummary);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={`relative rounded-modal bg-card-bg border overflow-hidden group transition-[border-color,box-shadow,transform] duration-300 ${
        expanded
          ? 'border-primary/35 shadow-elevation-3'
          : 'border-card-border shadow-elevation-2 hover:border-primary/25 hover:-translate-y-0.5 hover:shadow-elevation-3'
      }`}
    >
      {/* Ambient mesh backdrop keyed off trigger hue */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60 group-hover:opacity-80 transition-opacity"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 10% 0%, rgba(251,191,36,0.10) 0%, transparent 55%),' +
            'radial-gradient(ellipse 60% 50% at 100% 100%, rgba(96,165,250,0.08) 0%, transparent 65%)',
        }}
      />
      {/* Left accent bar keyed to trigger — a quick visual identifier */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: row.enabled ? 'linear-gradient(180deg, #fbbf24 0%, transparent 100%)' : 'transparent' }}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-full flex flex-col gap-3 p-4 text-left cursor-pointer"
      >
        {/* Header — index + title + trigger on one line */}
        <div className="flex items-center gap-2">
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
          {trigLabel && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 shadow-elevation-1 typo-body text-foreground shrink-0">
              {TrigIcon && <TrigIcon className="w-3.5 h-3.5 text-amber-400" />}
              <span className="truncate max-w-[180px]">
                {trigDetail || trigLabel}
              </span>
            </span>
          )}
        </div>

        {/* Summary */}
        {row.summary && (
          <div className="typo-body text-foreground/85 leading-snug line-clamp-2">
            {row.summary}
          </div>
        )}

        {/* Panels — Connects / Notifies side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* CONNECTS VIA */}
          <div className="flex flex-col gap-2 p-3 rounded-modal bg-card-bg/40 border border-card-border/60">
            <SectionLabel label={c.dim_apps} />
            {row.connectors.length > 0 ? (
              <div className="grid grid-cols-2 gap-1.5">
                {row.connectors.slice(0, 4).map((cn, i) => (
                  <ConnectorTile key={i} connector={cn} />
                ))}
                {row.connectors.length > 4 && (
                  <div className="flex items-center justify-center rounded-modal border border-dashed border-card-border typo-label text-foreground/65">
                    +{row.connectors.length - 4} more
                  </div>
                )}
              </div>
            ) : (
              <span className="typo-label text-foreground/50 italic">None configured</span>
            )}
          </div>

          {/* NOTIFIES VIA */}
          <div className="flex flex-col gap-2 p-3 rounded-modal bg-card-bg/40 border border-card-border/60">
            <SectionLabel label={c.dim_message} />
            {channels.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {channels.slice(0, 4).map((ch, i) => (
                  <ChannelChip key={i} channel={ch} />
                ))}
              </div>
            ) : (
              <span className="typo-label text-foreground/50 italic">No channels</span>
            )}
          </div>
        </div>

        {/* Policies strip */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {review && (
            <PolicyChip
              icon={UserCheck}
              color="#fb7185"
              label={review.mode}
              detail={review.detail}
            />
          )}
          {row.memorySummary && (
            <PolicyChip
              icon={Brain}
              color="#c084fc"
              label={c.dim_memory}
              detail={memoryShort}
            />
          )}
          {row.events.length > 0 && (
            <PolicyChip
              icon={Activity}
              color="#2dd4bf"
              label={c.dim_event}
              detail={row.events.map((e) => e.event_type).slice(0, 2).join(' · ') +
                (row.events.length > 2 ? ` +${row.events.length - 2}` : '')}
            />
          )}
          {row.errorSummary && (
            <PolicyChip
              icon={AlertTriangle}
              color="#fb923c"
              label={c.dim_error}
              detail={row.errorSummary.length > 60 ? row.errorSummary.slice(0, 58) + '…' : row.errorSummary}
            />
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

/* ── Main ───────────────────────────────────────────────────────────── */

function PersonaChronologyDossierImpl(props: Props) {
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
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
            {rows.map((row, i) => (
              <DossierCard
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
    </div>
  );
}

export const PersonaChronologyDossier = memo(PersonaChronologyDossierImpl);
