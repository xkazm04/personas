/**
 * PersonaChronologyChain — Prototype A: 8-column capability table.
 *
 * Each use case is a single row. Columns:
 *   Trigger · Task · Connector · Message · Review · Memory · Event · Error
 *
 * Icons carry the structural signal (present / shared / absent) and the
 * task title carries the readable one. Click a row to expand a second-row
 * panel with description, flow steps, and dimension details.
 *
 * Typography floor: `text-md` for all body-weight text. `typo-label`
 * (uppercase 12px) is reserved for iconographic chip labels only.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock,
  ChevronRight,
  ListTodo, Plug, MessageSquare, UserCheck, Brain, Activity, AlertTriangle,
  Loader2, Play, CheckCircle2, Sparkles,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useUseCaseChronology } from './useUseCaseChronology';
import type {
  ChronologyRow, ChronologyTrigger, DimensionKey, DimensionPresence,
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

/* ── Dimension metadata ─────────────────────────────────────────────── */

const DIM_META: Record<DimensionKey, { label: string; short: string; icon: React.ComponentType<{ className?: string }>; colorClass: string }> = {
  trigger:   { label: 'Trigger',   short: 'Trig',  icon: Calendar,      colorClass: 'text-amber-400' },
  task:      { label: 'Task',      short: 'Task',  icon: ListTodo,      colorClass: 'text-violet-400' },
  connector: { label: 'Connector', short: 'Apps',  icon: Plug,          colorClass: 'text-cyan-400' },
  message:   { label: 'Message',   short: 'Msg',   icon: MessageSquare, colorClass: 'text-blue-400' },
  review:    { label: 'Review',    short: 'Rev',   icon: UserCheck,     colorClass: 'text-rose-400' },
  memory:    { label: 'Memory',    short: 'Mem',   icon: Brain,         colorClass: 'text-purple-400' },
  event:     { label: 'Event',     short: 'Evt',   icon: Activity,      colorClass: 'text-teal-400' },
  error:     { label: 'Error',     short: 'Err',   icon: AlertTriangle, colorClass: 'text-orange-400' },
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

/* ── Dimension cell ─────────────────────────────────────────────────── */

function PresenceCell({ dim, presence, title }: {
  dim: DimensionKey;
  presence: DimensionPresence;
  title?: string;
}) {
  const meta = DIM_META[dim];
  const Icon = meta.icon;

  if (presence === 'none') {
    return (
      <div className="flex items-center justify-center" title={`${meta.label}: not configured`}>
        <span className="block w-6 h-6 border border-dashed border-card-border rounded-full opacity-40" />
      </div>
    );
  }

  const ring = presence === 'linked'
    ? 'bg-primary/10 border-primary/25'
    : 'bg-primary/5 border-dashed border-card-border';

  return (
    <div
      className={`flex items-center justify-center w-6 h-6 mx-auto rounded-full border ${ring}`}
      title={title || `${meta.label}: ${presence}`}
    >
      <Icon className={`w-3.5 h-3.5 ${meta.colorClass}`} />
    </div>
  );
}

/* ── Trigger cell (icon only) ──────────────────────────────────────── */

function TriggerCell({ row }: { row: ChronologyRow }) {
  if (row.triggers.length === 0) {
    return (
      <div className="flex items-center justify-center" title="Manual only">
        <span className="block w-6 h-6 border border-dashed border-card-border rounded-full opacity-40" />
      </div>
    );
  }
  const first = row.triggers[0]!;
  const Icon = triggerIcon(first.trigger_type);
  const tipParts: string[] = [];
  for (const t of row.triggers) {
    const detail = triggerDetail(t);
    tipParts.push(detail ? `${prettyTriggerType(t.trigger_type)}: ${detail}` : prettyTriggerType(t.trigger_type));
  }
  return (
    <div
      className="flex items-center justify-center w-6 h-6 mx-auto rounded-full border bg-primary/10 border-primary/25"
      title={tipParts.join('\n')}
    >
      <Icon className="w-3.5 h-3.5 text-amber-400" />
    </div>
  );
}

/* ── Connector cell (stacked icons) ─────────────────────────────────── */

function ConnectorCell({ row }: { row: ChronologyRow }) {
  if (row.connectors.length === 0) {
    return (
      <div className="flex items-center justify-center" title="No external services">
        <span className="block w-6 h-6 border border-dashed border-card-border rounded-full opacity-40" />
      </div>
    );
  }
  const shown = row.connectors.slice(0, 3);
  const overflow = row.connectors.length - shown.length;
  return (
    <div
      className="flex items-center justify-center gap-1"
      title={row.connectors.map((c) => getConnectorMeta(c.name).label).join(', ')}
    >
      {shown.map((c, i) => {
        const meta = getConnectorMeta(c.name);
        return (
          <div
            key={i}
            className={`w-6 h-6 rounded-full border flex items-center justify-center ${
              row.shared ? 'border-dashed border-card-border bg-primary/5' : 'border-primary/25 bg-primary/10'
            }`}
          >
            <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
          </div>
        );
      })}
      {overflow > 0 && (
        <span className="text-md font-semibold text-foreground ml-0.5">+{overflow}</span>
      )}
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────────────── */

function ChainRow({ row, index }: { row: ChronologyRow; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className={`cursor-pointer transition-colors border-b border-card-border/50 ${
          expanded ? 'bg-primary/5' : 'hover:bg-primary/5'
        }`}
      >
        <td className="pl-3 pr-1 py-3 w-8">
          <ChevronRight className={`w-4 h-4 text-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </td>
        <td className="pr-2 py-3 w-10 typo-data text-foreground">
          {String(index + 1).padStart(2, '0')}
        </td>

        <td className="px-1 py-3 w-12"><TriggerCell row={row} /></td>

        <td className="px-2 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-md font-semibold text-foreground truncate">{row.title}</span>
            {!row.enabled && (
              <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">Off</span>
            )}
            {row.shared && (
              <span className="typo-label px-1.5 py-0.5 rounded border border-dashed border-card-border text-foreground">Shared</span>
            )}
          </div>
        </td>

        <td className="px-1 py-3 w-28"><ConnectorCell row={row} /></td>

        <td className="px-1 py-3 w-12"><PresenceCell dim="message" presence={row.presence.message} title={row.messageSummary} /></td>
        <td className="px-1 py-3 w-12"><PresenceCell dim="review"  presence={row.presence.review}  title={row.reviewSummary} /></td>
        <td className="px-1 py-3 w-12"><PresenceCell dim="memory"  presence={row.presence.memory}  title={row.memorySummary} /></td>
        <td className="px-1 py-3 w-12"><PresenceCell dim="event"   presence={row.presence.event}   title={row.events.map((e) => e.event_type).join(', ')} /></td>
        <td className="px-1 py-3 w-12 pr-3"><PresenceCell dim="error"   presence={row.presence.error}   title={row.errorSummary} /></td>
      </tr>

      <AnimatePresence initial={false}>
        {expanded && (
          <tr className="border-b border-card-border/50 bg-card-bg/40">
            <td colSpan={10} className="p-0">
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-12 py-4 grid grid-cols-2 gap-x-6 gap-y-3">
                  {(row.summary || row.description) && (
                    <div className="col-span-2">
                      <div className="typo-label text-foreground mb-1.5">Description</div>
                      <div className="text-md text-foreground leading-relaxed">
                        {row.summary || row.description}
                      </div>
                    </div>
                  )}

                  {row.triggers.length > 0 && (
                    <DetailBlock label="Trigger" colorClass="text-amber-400">
                      {row.triggers.map((t, i) => (
                        <div key={i} className="text-md text-foreground">
                          <span className="font-medium">{prettyTriggerType(t.trigger_type)}</span>
                          {triggerDetail(t) && <span className="text-foreground"> — {triggerDetail(t)}</span>}
                        </div>
                      ))}
                    </DetailBlock>
                  )}

                  {row.connectors.length > 0 && (
                    <DetailBlock label="Apps & Services" colorClass="text-cyan-400">
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
                    </DetailBlock>
                  )}

                  {row.steps.length > 0 && (
                    <DetailBlock label={`Flow · ${row.steps.length} steps`} colorClass="text-violet-400" span={2}>
                      <div className="space-y-1">
                        {row.steps.map((s, i) => (
                          <div key={s.id} className="text-md text-foreground leading-snug">
                            <span className="typo-code text-foreground">{String(i + 1).padStart(2, '0')}.</span>{' '}
                            <span className="font-semibold">{s.label}</span>
                            {s.detail && <span className="text-foreground"> — {s.detail}</span>}
                          </div>
                        ))}
                      </div>
                    </DetailBlock>
                  )}

                  {row.messageSummary && <DetailBlock label="Messages" colorClass="text-blue-400"><span className="text-md text-foreground">{row.messageSummary}</span></DetailBlock>}
                  {row.reviewSummary && <DetailBlock label="Human Review" colorClass="text-rose-400"><span className="text-md text-foreground">{row.reviewSummary}</span></DetailBlock>}
                  {row.memorySummary && <DetailBlock label="Memory" colorClass="text-purple-400"><span className="text-md text-foreground">{row.memorySummary}</span></DetailBlock>}
                  {row.events.length > 0 && (
                    <DetailBlock label="Events" colorClass="text-teal-400">
                      <div className="flex flex-wrap gap-1.5">
                        {row.events.slice(0, 4).map((e, i) => (
                          <span key={i} className="typo-code text-foreground px-2 py-0.5 rounded bg-primary/5 border border-card-border">
                            {e.event_type}
                          </span>
                        ))}
                        {row.events.length > 4 && (
                          <span className="text-md text-foreground">+{row.events.length - 4} more</span>
                        )}
                      </div>
                    </DetailBlock>
                  )}
                  {row.errorSummary && <DetailBlock label="Error Handling" colorClass="text-orange-400"><span className="text-md text-foreground">{row.errorSummary}</span></DetailBlock>}
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function DetailBlock({ label, colorClass, children, span = 1 }: {
  label: string;
  colorClass: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <div className={`typo-label mb-1.5 ${colorClass}`}>{label}</div>
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

function PersonaChronologyChainImpl(props: Props) {
  const rows = useUseCaseChronology();

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <CommandBar {...props} />

      <div className="flex-1 min-h-0 flex flex-col rounded-modal bg-card-bg border border-card-border overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-card-border bg-primary/5">
              <th className="w-8" />
              <th className="w-10 pr-2 py-3 text-left">
                <span className="typo-label text-foreground">#</span>
              </th>
              <th className="w-12 px-1 py-3">
                <div className="flex flex-col items-center gap-1">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  <span className="typo-label text-foreground">Trig</span>
                </div>
              </th>
              <th className="px-2 py-3 text-left">
                <div className="flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-violet-400" />
                  <span className="typo-label text-foreground">Task</span>
                </div>
              </th>
              <th className="w-28 px-1 py-3">
                <div className="flex flex-col items-center gap-1">
                  <Plug className="w-4 h-4 text-cyan-400" />
                  <span className="typo-label text-foreground">Apps</span>
                </div>
              </th>
              {(['message','review','memory','event','error'] as DimensionKey[]).map((k) => {
                const m = DIM_META[k];
                const Icon = m.icon;
                return (
                  <th key={k} className="w-12 px-1 py-3">
                    <div className="flex flex-col items-center gap-1">
                      <Icon className={`w-4 h-4 ${m.colorClass}`} />
                      <span className="typo-label text-foreground">{m.short}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-md text-foreground">
                  No capabilities yet — the template is still seeding.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => <ChainRow key={row.id} row={row} index={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const PersonaChronologyChain = memo(PersonaChronologyChainImpl);
