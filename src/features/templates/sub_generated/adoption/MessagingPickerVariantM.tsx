// @ts-nocheck — visual-review prototype (Variant M · "Cockpit").
// Dual-mode sibling to Atlas. View mode reads like an instrument cluster:
// three circular gauges report the capability's configuration at a glance.
// Edit mode flips to Forge's power-rail + two-zone editor.
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  ╭─TIME─╮     ╭─EMITS──╮    ╭─DELIVER─╮                 │
//   │ ( postmark ) (3 stamps ) (3✓ fanout )                   │
//   │  ╰──────╯     ╰────────╯    ╰─────────╯                 │
//   │                                                         │
//   │  Composes buy / sell / hold signals from RSI, …         │
//   └─────────────────────────────────────────────────────────┘
//
// Reuses the Ticket postmark for the TIME gauge and Ticket-style check
// marks for addressees in the DELIVER gauge.
//
// Token rules (feedback_tailwind_brand_tokens): primary = cyan accent,
// status-warning = amber, status-info = blue, status-error = red.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Bell,
  Cable,
  Check,
  CheckCircle2,
  Clock,
  Cog,
  Eye,
  Inbox,
  Info,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Plus,
  PowerOff,
  Radio,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  DEV_CLONE_FIXTURE_USE_CASES,
  FALLBACK_SAMPLE,
  MOCK_EMIT_EVENTS_BY_UC,
  SAMPLE_MESSAGE_BY_UC,
  mockTestDelivery,
} from './MessagingPickerShared';
import {
  TIME_PRESETS,
  WEEKDAYS,
  clampHour,
  disableEventFamily,
  disableTimeFamily,
  enableEventFamily,
  enableTimeFamily,
  hasEvent,
  hasTime,
  selectionForTimePreset,
  updateEvent,
  updateTime,
  type TriggerSelection,
} from './useCasePickerShared';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  getConnectorMeta,
  ConnectorIcon,
  type ConnectorMeta,
} from '@/features/shared/components/display/ConnectorMeta';
import { useVaultStore } from '@/stores/vaultStore';
import { QuickAddCredentialModal } from './QuickAddCredentialModal';
import { BaseModal } from '@/lib/ui/BaseModal';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { listAllSubscriptions } from '@/api/overview/events';

const UC_SUBTITLE: Record<string, string> = {
  uc_signals:            'Composes buy / sell / hold signals from RSI, MACD, and earnings data',
  uc_congressional_scan: 'Matches congressional stock disclosures against watched sectors',
  uc_gems:               'Surfaces under-covered names passing technical + catalyst thresholds',
};

const UC_DESCRIPTION: Record<string, string> = {
  uc_signals:
    "Scores each ticker's technical stack (RSI, MACD), earnings, and sector rotation into a composite and emits stocks.signals.{buy,sell,hold}.",
  uc_congressional_scan:
    "Pulls weekly congressional disclosures and cross-checks them against watched sectors.",
  uc_gems:
    "Discovers under-covered names passing a configurable tech-score and catalyst filter.",
};

const UC_CODE: Record<string, string> = {
  uc_signals:            'SGN',
  uc_congressional_scan: 'CDC',
  uc_gems:               'GEM',
};

const COMMON_PERSONA_EVENTS = [
  'system.persona.started',
  'system.persona.completed',
  'system.execution.succeeded',
  'system.execution.failed',
  'scheduler.tick.hourly',
  'scheduler.tick.daily',
];

const MESSAGING_SERVICE_TYPES = [
  'personas_messages',
  'slack',
  'discord',
  'telegram',
  'microsoft_teams',
];

const MESSAGING_CATEGORY = 'messaging';
const APP_NOTIF: DestId = 'app_notif';
const IN_APP: DestId = 'in_app';

type DestId = 'app_notif' | 'in_app' | string;

interface Destination {
  id: DestId;
  label: string;
  shortLabel: string;
  kind: 'default' | 'channel';
  icon?: LucideIcon;
  meta?: ConnectorMeta;
}

const FADE = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };
const HEIGHT_FADE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit:    { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: FADE.ease },
};

function summarizeTrigger(sel: TriggerSelection): string {
  if (!sel.time && !sel.event) return 'MANUAL';
  if (sel.event && !sel.time) return sel.event.eventType ? `ON ${sel.event.eventType.split('.').pop()?.toUpperCase()}` : 'ON EVENT';
  const t = sel.time!;
  if (t.preset === 'hourly') return 'EVERY HR';
  if (t.preset === 'daily') return `DAILY ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
  const wd = WEEKDAYS[t.weekday ?? 1];
  return `${wd.toUpperCase()} ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
}

export function MessagingPickerVariantM() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  const vaultCredentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  useEffect(() => {
    fetchCredentials().catch(() => { /* prototype */ });
  }, [fetchCredentials]);

  const [subscribedEventTypes, setSubscribedEventTypes] = useState<string[]>([]);
  useEffect(() => {
    listAllSubscriptions()
      .then((subs) => {
        const types = new Set<string>();
        for (const s of subs) types.add(s.event_type);
        setSubscribedEventTypes(Array.from(types));
      })
      .catch(() => { /* prototype */ });
  }, []);

  const availableEventKeys = useMemo(() => {
    const out = new Set<string>();
    for (const uc of useCases) {
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) out.add(ev.event_type);
    }
    for (const t of subscribedEventTypes) out.add(t);
    for (const t of COMMON_PERSONA_EVENTS) out.add(t);
    return Array.from(out).sort();
  }, [useCases, subscribedEventTypes]);

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEventKeys.map((e) => ({ value: e, label: e })),
    [availableEventKeys],
  );

  const attachableChannels = useMemo(
    () =>
      vaultCredentials
        .filter(
          (c) =>
            MESSAGING_SERVICE_TYPES.includes(c.service_type) &&
            c.service_type !== 'personas_messages' &&
            c.healthcheck_last_success === true,
        )
        .map((c) => ({ id: c.id, service_type: c.service_type, name: c.name })),
    [vaultCredentials],
  );

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));
  const [triggerByUc, setTriggerByUc] = useState<Record<string, TriggerSelection>>(() =>
    Object.fromEntries(useCases.map((u) => [u.id, { time: { preset: 'weekly', weekday: 1, hourOfDay: 9 } }])),
  );
  const [attachedChannels, setAttachedChannels] = useState<Set<string>>(() => new Set());
  const [eventRoutes, setEventRoutes] = useState<Record<string, Record<string, Set<DestId>>>>(() => {
    const out: Record<string, Record<string, Set<DestId>>> = {};
    for (const uc of useCases) {
      out[uc.id] = {};
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) {
        const s = new Set<DestId>();
        s.add(IN_APP);
        if (ev.default_titlebar) s.add(APP_NOTIF);
        out[uc.id][ev.event_type] = s;
      }
    }
    return out;
  });

  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  const [previewReady, setPreviewReady] = useState<Record<string, boolean>>({});
  const [previewUcId, setPreviewUcId] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<Record<string, 'view' | 'edit'>>({});
  const [quickAddCtx, setQuickAddCtx] = useState<{ ucId: string; eventType: string } | null>(null);

  function toggleEnabled(ucId: string) {
    setEnabled((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  }
  function toggleDesc(ucId: string) {
    setExpandedDesc((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  }
  function toggleMode(ucId: string) {
    setMode((prev) => ({ ...prev, [ucId]: (prev[ucId] ?? 'view') === 'view' ? 'edit' : 'view' }));
  }
  function setTriggerSelection(ucId: string, sel: TriggerSelection) {
    setTriggerByUc((prev) => ({ ...prev, [ucId]: sel }));
  }
  function toggleRoute(ucId: string, eventType: string, destId: DestId) {
    setEventRoutes((prev) => {
      const ucMap = { ...(prev[ucId] ?? {}) };
      const s = new Set(ucMap[eventType] ?? []);
      s.has(destId) ? s.delete(destId) : s.add(destId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });
  }
  function attachChannelAndRoute(chId: string, ucId: string, eventType: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.add(chId);
      return n;
    });
    setEventRoutes((prev) => {
      const ucMap = { ...(prev[ucId] ?? {}) };
      const s = new Set(ucMap[eventType] ?? []);
      s.add(chId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });
  }
  function removeChannel(chId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.delete(chId);
      return n;
    });
    setEventRoutes((prev) => {
      const next: typeof prev = {};
      for (const ucId of Object.keys(prev)) {
        const ucMap: Record<string, Set<DestId>> = {};
        for (const eventType of Object.keys(prev[ucId])) {
          const s = new Set(prev[ucId][eventType]);
          s.delete(chId);
          ucMap[eventType] = s;
        }
        next[ucId] = ucMap;
      }
      return next;
    });
  }

  const destinations = useMemo<Destination[]>(() => {
    const out: Destination[] = [
      { id: APP_NOTIF, label: 'App notification', shortLabel: 'App', kind: 'default', icon: Bell },
      { id: IN_APP,    label: 'In-App Message',    shortLabel: 'In-App', kind: 'default', icon: Inbox },
    ];
    for (const chId of attachedChannels) {
      const ch = attachableChannels.find((c) => c.id === chId);
      if (!ch) continue;
      const meta = getConnectorMeta(ch.service_type);
      out.push({
        id: ch.id,
        label: `${meta.label} · ${ch.name}`,
        shortLabel: meta.label,
        kind: 'channel',
        meta,
      });
    }
    return out;
  }, [attachedChannels, attachableChannels]);

  async function runTest(ucId: string) {
    setTestStatus((prev) => ({ ...prev, [ucId]: 'running' }));
    const routes = eventRoutes[ucId] ?? {};
    const union = new Set<DestId>();
    for (const s of Object.values(routes)) for (const d of s) union.add(d);
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    await mockTestDelivery(Array.from(union), sample);
    setTestStatus((prev) => ({ ...prev, [ucId]: 'done' }));
    if (union.has(IN_APP)) setPreviewReady((prev) => ({ ...prev, [ucId]: true }));
    setTimeout(() => {
      setTestStatus((prev) => ({ ...prev, [ucId]: 'idle' }));
    }, 2200);
  }

  const previewSample = previewUcId ? SAMPLE_MESSAGE_BY_UC[previewUcId] ?? FALLBACK_SAMPLE : null;
  const previewUc = previewUcId ? useCases.find((u) => u.id === previewUcId) : null;

  return (
    <>
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {useCases.map((uc) => {
            const on = enabled.has(uc.id);
            const trigger = triggerByUc[uc.id] ?? {};
            const ucRoutes = eventRoutes[uc.id] ?? {};
            const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
            const subtitle = UC_SUBTITLE[uc.id] ?? 'User-defined capability';
            const description = UC_DESCRIPTION[uc.id] ?? subtitle;
            const code = UC_CODE[uc.id] ?? 'UC';
            const status = testStatus[uc.id] ?? 'idle';
            const firing = status === 'running';
            const canPreview = Boolean(previewReady[uc.id]);
            const descExpanded = expandedDesc.has(uc.id);
            const cardMode = mode[uc.id] ?? 'view';
            const triggerSummary = summarizeTrigger(trigger);
            const activeDestinations = new Set<DestId>();
            for (const s of Object.values(ucRoutes)) for (const d of s) activeDestinations.add(d);
            const subscribedCount = emits.reduce(
              (n, ev) => ((ucRoutes[ev.event_type]?.size ?? 0) > 0 ? n + 1 : n),
              0,
            );

            return (
              <motion.div
                key={uc.id}
                layout
                transition={{ duration: 0.25, ease: FADE.ease }}
                className={`rounded-card overflow-hidden transition-colors ${
                  on
                    ? 'ring-1 ring-primary/50 bg-primary/[0.04] shadow-elevation-2'
                    : 'ring-1 ring-border/70 bg-foreground/[0.015]'
                }`}
              >
                {/* Header */}
                <div className="flex items-start gap-4 px-5 py-4 border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(uc.id)}
                    aria-pressed={on}
                    className={`focus-ring flex-shrink-0 mt-1.5 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                      on
                        ? 'bg-primary ring-1 ring-primary shadow-elevation-1'
                        : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
                    }`}
                  >
                    {on && <Check className="w-4 h-4 text-background" strokeWidth={3} />}
                  </button>
                  <h4
                    className={`flex-1 min-w-0 text-3xl font-semibold leading-tight tracking-tight truncate ${
                      on ? 'text-foreground' : 'text-foreground/70'
                    }`}
                  >
                    {uc.name}
                  </h4>
                  {on && (
                    <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleMode(uc.id)}
                        aria-pressed={cardMode === 'edit'}
                        title={cardMode === 'view' ? 'Edit configuration' : 'Done editing'}
                        className={`focus-ring w-10 h-10 rounded-full ring-1 flex items-center justify-center transition-colors ${
                          cardMode === 'edit'
                            ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1'
                            : 'ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
                        }`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={cardMode}
                            initial={{ opacity: 0, rotate: -30 }}
                            animate={{ opacity: 1, rotate: 0 }}
                            exit={{ opacity: 0, rotate: 30 }}
                            transition={{ duration: 0.18 }}
                            className="inline-flex"
                          >
                            {cardMode === 'view' ? <Pencil className="w-5 h-5" /> : <Check className="w-5 h-5" strokeWidth={3} />}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        aria-pressed={descExpanded}
                        className={`focus-ring w-10 h-10 rounded-full ring-1 flex items-center justify-center transition-colors ${
                          descExpanded
                            ? 'ring-primary/60 bg-primary/15 text-primary'
                            : 'ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
                        }`}
                      >
                        <Info className="w-5 h-5" />
                      </button>
                      <AnimatePresence initial={false}>
                        {canPreview && (
                          <motion.button
                            key="preview"
                            type="button"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={FADE}
                            onClick={() => setPreviewUcId(uc.id)}
                            className="focus-ring w-10 h-10 rounded-full ring-1 ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground flex items-center justify-center transition-colors"
                          >
                            <Eye className="w-5 h-5" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                      <button
                        type="button"
                        onClick={() => runTest(uc.id)}
                        disabled={status === 'running'}
                        className="focus-ring w-10 h-10 rounded-full ring-1 ring-primary/60 bg-primary/20 text-primary hover:bg-primary/30 hover:ring-primary/70 disabled:opacity-60 flex items-center justify-center shadow-elevation-1 transition-all"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={status}
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.14 }}
                            className="inline-flex"
                          >
                            {status === 'running' ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : status === 'done' ? (
                              <CheckCircle2 className="w-5 h-5 text-status-success" />
                            ) : (
                              <Play className="w-5 h-5" />
                            )}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {on && descExpanded && (
                    <motion.div key="desc" {...HEIGHT_FADE} className="overflow-hidden">
                      <div className="px-5 py-3.5 bg-foreground/[0.02] border-b border-border/50">
                        <p className="typo-body-lg text-foreground/80 leading-relaxed">{description}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait" initial={false}>
                  {on && cardMode === 'view' && (
                    <motion.div
                      key="view"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: FADE.ease }}
                      className="overflow-hidden"
                    >
                      <CockpitView
                        code={code}
                        subtitle={subtitle}
                        triggerSummary={triggerSummary}
                        emits={emits}
                        ucRoutes={ucRoutes}
                        destinations={destinations}
                        activeDestinations={activeDestinations}
                        firing={firing}
                        onEdit={() => toggleMode(uc.id)}
                      />
                    </motion.div>
                  )}
                  {on && cardMode === 'edit' && (
                    <motion.div
                      key="edit"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: FADE.ease }}
                      className="overflow-hidden"
                    >
                      <ForgeEditor
                        ucId={uc.id}
                        trigger={trigger}
                        eventOptions={eventOptions}
                        availableEventKeys={availableEventKeys}
                        emits={emits}
                        ucRoutes={ucRoutes}
                        destinations={destinations}
                        subtitle={subtitle}
                        subscribedCount={subscribedCount}
                        status={status}
                        onTriggerChange={(next) => setTriggerSelection(uc.id, next)}
                        onToggleRoute={toggleRoute}
                        onRemoveChannel={removeChannel}
                        onAddChannel={(eventType) => setQuickAddCtx({ ucId: uc.id, eventType })}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      {quickAddCtx && (
        <QuickAddCredentialModal
          category={MESSAGING_CATEGORY}
          categoryLabel="messaging channel"
          onCredentialAdded={(serviceType) => {
            void fetchCredentials()
              .then(() => {
                const added = useVaultStore
                  .getState()
                  .credentials.find(
                    (c) => c.service_type === serviceType && c.healthcheck_last_success === true,
                  );
                if (added && quickAddCtx) {
                  attachChannelAndRoute(added.id, quickAddCtx.ucId, quickAddCtx.eventType);
                }
              })
              .finally(() => setQuickAddCtx(null));
          }}
          onClose={() => setQuickAddCtx(null)}
        />
      )}

      <AnimatePresence>
        {previewUcId && previewSample && previewUc && (
          <PreviewModal
            title={previewSample.title}
            subtitle={`In-App Message preview · ${previewUc.name}`}
            onClose={() => setPreviewUcId(null)}
          >
            <MarkdownRenderer content={previewSample.body} className="typo-body leading-relaxed" />
          </PreviewModal>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Cockpit view — three gauges + caption ───────────────────────────────

interface CockpitViewProps {
  code: string;
  subtitle: string;
  triggerSummary: string;
  emits: Array<{ event_type: string; description: string; default_titlebar: boolean }>;
  ucRoutes: Record<string, Set<DestId>>;
  destinations: Destination[];
  activeDestinations: Set<DestId>;
  firing: boolean;
  onEdit: () => void;
}

function CockpitView({
  code,
  subtitle,
  triggerSummary,
  emits,
  ucRoutes,
  destinations,
  activeDestinations,
  firing,
  onEdit,
}: CockpitViewProps) {
  const routedCount = emits.reduce((n, ev) => ((ucRoutes[ev.event_type]?.size ?? 0) > 0 ? n + 1 : n), 0);
  return (
    <div
      className="relative px-5 py-6 bg-gradient-to-b from-foreground/[0.03] to-foreground/[0.06]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--color-primary) 5%, transparent) 0%, transparent 50%), radial-gradient(circle at 80% 100%, color-mix(in srgb, var(--color-status-warning) 4%, transparent) 0%, transparent 50%)',
      }}
    >
      {/* Instrument cluster */}
      <div className="relative grid grid-cols-3 gap-3 items-start">
        {/* TIME gauge */}
        <GaugePanel label="Time · when" accent="primary">
          <Postmark code={code} summary={triggerSummary} firing={firing} />
        </GaugePanel>

        {/* EMITS gauge */}
        <GaugePanel label={`Emits · ${emits.length} event${emits.length === 1 ? '' : 's'}`} accent="status-warning">
          <EmitsGauge emits={emits} routedCount={routedCount} firing={firing} />
        </GaugePanel>

        {/* DELIVER gauge */}
        <GaugePanel label={`Delivers · ${activeDestinations.size} channel${activeDestinations.size === 1 ? '' : 's'}`} accent="primary">
          <DeliverGauge destinations={destinations} active={activeDestinations} firing={firing} />
        </GaugePanel>
      </div>

      {/* Caption */}
      <p className="mt-5 text-center typo-body text-foreground/75 italic leading-snug max-w-3xl mx-auto">
        {subtitle}
      </p>

      {/* Edit affordance */}
      <button
        type="button"
        onClick={onEdit}
        className="focus-ring absolute bottom-3 right-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-caption uppercase tracking-wider font-semibold text-foreground/55 hover:text-primary hover:bg-primary/[0.08] transition-colors"
      >
        <Pencil className="w-3 h-3" />
        Configure
      </button>
    </div>
  );
}

// ─── GaugePanel — shared frame around every instrument ───────────────────

function GaugePanel({
  label,
  accent,
  children,
}: {
  label: string;
  accent: 'primary' | 'status-warning';
  children: React.ReactNode;
}) {
  const labelColor = accent === 'primary' ? 'text-primary' : 'text-status-warning';
  return (
    <div className="relative flex flex-col items-center gap-2 rounded-card ring-1 ring-border/70 bg-background/80 backdrop-blur-sm shadow-elevation-1 p-4">
      {/* corner bezel rivets */}
      <Rivet className="top-1.5 left-1.5" />
      <Rivet className="top-1.5 right-1.5" />
      <Rivet className="bottom-1.5 left-1.5" />
      <Rivet className="bottom-1.5 right-1.5" />

      <div className="flex items-center justify-center h-36">
        {children}
      </div>

      <div className={`typo-caption uppercase tracking-[0.2em] font-semibold ${labelColor}`}>{label}</div>
    </div>
  );
}

function Rivet({ className }: { className?: string }) {
  return (
    <div
      className={`absolute w-2 h-2 rounded-full bg-foreground/8 ring-1 ring-foreground/15 ${className}`}
      aria-hidden
    />
  );
}

// ─── Postmark (TIME gauge) — reused from Ticket ──────────────────────────

function Postmark({ code, summary, firing }: { code: string; summary: string; firing: boolean }) {
  const { a, b } = splitSummary(summary);
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full">
        <defs>
          <radialGradient id={`cockpit-pm-${code}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--color-primary) 14%, var(--color-background))" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-primary) 4%, var(--color-background))" />
          </radialGradient>
          <path id={`cockpit-pm-top-${code}`} d="M 22 60 A 38 38 0 0 1 98 60" />
          <path id={`cockpit-pm-bot-${code}`} d="M 98 60 A 38 38 0 0 1 22 60" />
        </defs>

        <motion.g
          style={{ originX: 60, originY: 60, transformBox: 'fill-box' }}
          animate={firing ? { rotate: 360 } : { rotate: 0 }}
          transition={firing ? { duration: 4, ease: 'linear', repeat: Infinity } : { duration: 0.4 }}
        >
          <circle cx={60} cy={60} r={56} fill={`url(#cockpit-pm-${code})`} stroke="var(--color-primary)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="3 3" />
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const x1 = 60 + 49 * Math.cos(angle);
            const y1 = 60 + 49 * Math.sin(angle);
            const x2 = 60 + (i % 6 === 0 ? 43 : 46) * Math.cos(angle);
            const y2 = 60 + (i % 6 === 0 ? 43 : 46) * Math.sin(angle);
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-primary)" strokeOpacity={i % 6 === 0 ? 0.7 : 0.3} strokeWidth={i % 6 === 0 ? 1.5 : 1} />
            );
          })}
        </motion.g>

        <circle cx={60} cy={60} r={38} fill="var(--color-background)" stroke="var(--color-primary)" strokeOpacity={0.45} strokeWidth={1.5} />

        <text className="fill-primary" style={{ fontSize: 8, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.25em' }}>
          <textPath href={`#cockpit-pm-top-${code}`} startOffset="50%" textAnchor="middle">
            PERSONAS · DISPATCH
          </textPath>
        </text>
        <text className="fill-foreground/55" style={{ fontSize: 7, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em' }}>
          <textPath href={`#cockpit-pm-bot-${code}`} startOffset="50%" textAnchor="middle">
            {code} · REV 0.1
          </textPath>
        </text>

        <text x={60} y={57} textAnchor="middle" className="fill-primary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.1em' }}>
          {a}
        </text>
        <text x={60} y={70} textAnchor="middle" className="fill-foreground" style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', fontWeight: 500, letterSpacing: '0.15em' }}>
          {b}
        </text>

        {firing && (
          <motion.circle
            cx={60}
            cy={60}
            r={12}
            fill="var(--color-primary)"
            fillOpacity={0.35}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            style={{ originX: 60, originY: 60, transformBox: 'fill-box' }}
          />
        )}
      </svg>
    </div>
  );
}

function splitSummary(s: string): { a: string; b: string } {
  const parts = s.split(' ');
  if (parts.length === 1) return { a: s, b: '' };
  const mid = Math.ceil(parts.length / 2);
  return { a: parts.slice(0, mid).join(' '), b: parts.slice(mid).join(' ') };
}

// ─── EmitsGauge — circular counter with radial signal stamps ─────────────

function EmitsGauge({
  emits,
  routedCount,
  firing,
}: {
  emits: Array<{ event_type: string; description: string; default_titlebar: boolean }>;
  routedCount: number;
  firing: boolean;
}) {
  const total = emits.length;
  const ringR = 52;
  // Signal-stamp positions arranged radially around the ring.
  const stampPositions = emits.map((_, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(total, 1)) * Math.PI * 2;
    return { x: 60 + (ringR + 4) * Math.cos(angle), y: 60 + (ringR + 4) * Math.sin(angle) };
  });
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
        <defs>
          <radialGradient id="emits-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--color-status-warning) 14%, var(--color-background))" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-status-warning) 3%, var(--color-background))" />
          </radialGradient>
        </defs>

        {/* Outer ring */}
        <circle cx={60} cy={60} r={56} fill="url(#emits-glow)" stroke="var(--color-status-warning)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 3" />
        {/* Inner ring */}
        <circle cx={60} cy={60} r={34} fill="var(--color-background)" stroke="var(--color-status-warning)" strokeOpacity={0.4} strokeWidth={1.5} />

        {/* Center count */}
        <text x={60} y={57} textAnchor="middle" className="fill-status-warning" style={{ fontSize: 22, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.02em' }}>
          {routedCount}/{total}
        </text>
        <text x={60} y={72} textAnchor="middle" className="fill-foreground/55" style={{ fontSize: 7, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.25em', textTransform: 'uppercase' }}>
          ROUTED
        </text>

        {/* Radial signal stamps (outside the outer ring) */}
        {emits.map((ev, i) => {
          const pos = stampPositions[i];
          const kind = classifyEvent(ev.event_type);
          return (
            <motion.g
              key={ev.event_type}
              transform={`translate(${pos.x - 6} ${pos.y - 6})`}
              animate={firing ? { scale: [1, 1.18, 1] } : {}}
              transition={firing ? { duration: 0.6, delay: i * 0.12, repeat: Infinity, ease: 'easeInOut' } : undefined}
              style={{ originX: 6, originY: 6, transformBox: 'fill-box' }}
            >
              <rect x={0} y={0} width={12} height={12} rx={2} fill="var(--color-status-warning)" fillOpacity={0.18} stroke="var(--color-status-warning)" strokeOpacity={0.55} strokeWidth={1} />
              <g transform="translate(2 2)" className="text-status-warning" style={{ color: 'var(--color-status-warning)' }}>
                <StampGlyph kind={kind} size={8} />
              </g>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── DeliverGauge — fanout rim with addressee dots + checks ─────────────

function DeliverGauge({
  destinations,
  active,
  firing,
}: {
  destinations: Destination[];
  active: Set<DestId>;
  firing: boolean;
}) {
  // Cap the visible destinations on the dial so it doesn't get crowded;
  // any overflow is summarised as "+N".
  const shown = destinations.slice(0, 6);
  const overflow = destinations.length - shown.length;
  const ringR = 48;
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
        <defs>
          <radialGradient id="deliver-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--color-primary) 14%, var(--color-background))" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-primary) 3%, var(--color-background))" />
          </radialGradient>
        </defs>

        {/* Outer ring */}
        <circle cx={60} cy={60} r={54} fill="url(#deliver-glow)" stroke="var(--color-primary)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 3" />

        {/* Fanout beams from center to each destination slot */}
        {shown.map((_, i) => {
          const angle = -Math.PI / 2 + (i / shown.length) * Math.PI * 2;
          const x = 60 + ringR * Math.cos(angle);
          const y = 60 + ringR * Math.sin(angle);
          const isOn = active.has(shown[i].id);
          return (
            <line
              key={`beam-${i}`}
              x1={60}
              y1={60}
              x2={x}
              y2={y}
              stroke={isOn ? 'var(--color-primary)' : 'var(--color-foreground)'}
              strokeOpacity={isOn ? 0.65 : 0.18}
              strokeWidth={isOn ? 1.8 : 1}
              strokeDasharray={isOn ? undefined : '3 3'}
            />
          );
        })}

        {/* Center hub */}
        <circle cx={60} cy={60} r={14} fill="var(--color-background)" stroke="var(--color-primary)" strokeOpacity={0.55} strokeWidth={1.5} />
        <text x={60} y={58} textAnchor="middle" className="fill-primary" style={{ fontSize: 8, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.1em' }}>
          FAN
        </text>
        <text x={60} y={68} textAnchor="middle" className="fill-primary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
          {active.size}
        </text>

        {/* Destination nodes on the rim */}
        {shown.map((dest, i) => {
          const angle = -Math.PI / 2 + (i / shown.length) * Math.PI * 2;
          const x = 60 + ringR * Math.cos(angle);
          const y = 60 + ringR * Math.sin(angle);
          const isOn = active.has(dest.id);
          return (
            <motion.g
              key={dest.id}
              animate={firing && isOn ? { scale: [1, 1.2, 1] } : {}}
              transition={firing && isOn ? { duration: 0.9, delay: i * 0.1, repeat: Infinity, ease: 'easeOut' } : undefined}
              style={{ originX: x, originY: y, transformBox: 'fill-box' }}
            >
              <circle
                cx={x}
                cy={y}
                r={7}
                fill={isOn ? 'color-mix(in srgb, var(--color-primary) 20%, var(--color-background))' : 'var(--color-background)'}
                stroke={isOn ? 'var(--color-primary)' : 'var(--color-foreground)'}
                strokeOpacity={isOn ? 0.7 : 0.3}
                strokeWidth={isOn ? 2 : 1.2}
              />
              {isOn && (
                <path
                  d={`M ${x - 2.5} ${y} L ${x - 0.5} ${y + 2} L ${x + 2.5} ${y - 2}`}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </motion.g>
          );
        })}

        {/* Overflow indicator */}
        {overflow > 0 && (
          <text x={60} y={116} textAnchor="middle" className="fill-foreground/45" style={{ fontSize: 8, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            + {overflow} more
          </text>
        )}
      </svg>

      {/* HTML label strip — destination short names under each rim node.
          Rendered via absolute positioning so the text can use live theme
          colors and stay crisp at any zoom. */}
      {shown.map((dest, i) => {
        const angle = -Math.PI / 2 + (i / shown.length) * Math.PI * 2;
        const leftPct = ((60 + (ringR + 12) * Math.cos(angle)) / 120) * 100;
        const topPct = ((60 + (ringR + 12) * Math.sin(angle)) / 120) * 100;
        const isOn = active.has(dest.id);
        return (
          <div
            key={`lbl-${dest.id}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          >
            <span className={`inline-block px-1 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider font-semibold whitespace-nowrap ${
              isOn ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'text-foreground/45'
            }`}>
              {dest.shortLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stamp glyph (ported) ────────────────────────────────────────────────

function StampGlyph({ kind, size = 14 }: { kind: StampKind; size?: number }) {
  const s = size;
  return (
    <svg viewBox="0 0 20 20" width={s} height={s}>
      {kind === 'up' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 14 L 10 6 L 16 14" />
          <path d="M 4 17 L 16 17" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'down' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 6 L 10 14 L 16 6" />
          <path d="M 4 3 L 16 3" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'hold' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M 4 10 L 16 10" />
          <path d="M 4 5 L 16 5" strokeOpacity={0.45} />
          <path d="M 4 15 L 16 15" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'scan' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx={10} cy={10} r={6} />
          <path d="M 14.5 14.5 L 18 18" />
        </g>
      )}
      {kind === 'gem' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
          <path d="M 10 3 L 17 8 L 14 17 L 6 17 L 3 8 Z" />
          <path d="M 3 8 L 17 8" strokeOpacity={0.5} />
        </g>
      )}
      {kind === 'spike' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 13 L 6 13 L 8 6 L 11 17 L 13 10 L 18 10" />
        </g>
      )}
      {kind === 'bolt' && (
        <path d="M 11 2 L 4 12 L 9 12 L 7 18 L 16 8 L 11 8 L 13 2 Z" fill="currentColor" stroke="currentColor" strokeWidth={0.5} strokeLinejoin="round" />
      )}
    </svg>
  );
}

type StampKind = 'up' | 'down' | 'hold' | 'scan' | 'gem' | 'spike' | 'bolt';

function classifyEvent(eventType: string): StampKind {
  const t = eventType.toLowerCase();
  if (t.endsWith('.buy') || t.includes('.up') || t.includes('discovered')) return 'up';
  if (t.endsWith('.sell') || t.includes('.down') || t.includes('filtered_out') || t.includes('failed')) return 'down';
  if (t.endsWith('.hold') || t.includes('succeeded') || t.includes('completed')) return 'hold';
  if (t.includes('scan') || t.includes('disclosure')) return 'scan';
  if (t.includes('gem')) return 'gem';
  if (t.includes('shift') || t.includes('spike')) return 'spike';
  return 'bolt';
}

// ─── Forge editor (edit mode) — identical to Atlas's edit mode ───────────

interface ForgeEditorProps {
  ucId: string;
  trigger: TriggerSelection;
  eventOptions: ThemedSelectOption[];
  availableEventKeys: string[];
  emits: Array<{ event_type: string; description: string; default_titlebar: boolean }>;
  ucRoutes: Record<string, Set<DestId>>;
  destinations: Destination[];
  subtitle: string;
  subscribedCount: number;
  status: 'idle' | 'running' | 'done';
  onTriggerChange: (next: TriggerSelection) => void;
  onToggleRoute: (ucId: string, eventType: string, destId: DestId) => void;
  onRemoveChannel: (chId: string) => void;
  onAddChannel: (eventType: string) => void;
}

function ForgeEditor({
  ucId,
  trigger,
  eventOptions,
  availableEventKeys,
  emits,
  ucRoutes,
  destinations,
  subtitle,
  subscribedCount,
  status,
  onTriggerChange,
  onToggleRoute,
  onRemoveChannel,
  onAddChannel,
}: ForgeEditorProps) {
  const firing = status === 'running';
  return (
    <div
      className="relative px-5 py-5 bg-gradient-to-b from-foreground/[0.015] to-foreground/[0.04]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(90deg, transparent 0 19px, color-mix(in srgb, var(--color-foreground) 3%, transparent) 19px 20px)',
      }}
    >
      <PowerRail
        selection={trigger}
        availableEvents={eventOptions}
        availableEventKeys={availableEventKeys}
        onChange={onTriggerChange}
        status={status}
        subscribedCount={subscribedCount}
      />

      <div className="grid grid-cols-[1fr_auto_1.5fr] items-stretch gap-0 mt-4">
        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-foreground/[0.03] p-4">
          <ZoneHeader icon={Sparkles} label="Runs" accent="primary" />
          <p className="typo-body text-foreground/75 leading-snug">{subtitle}</p>
        </div>

        <PipelineArrow firing={firing} />

        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-status-warning/[0.06] p-4">
          <ZoneHeader icon={Zap} label="Events" accent="status-warning" count={subscribedCount} />
          <div className="flex flex-col gap-1">
            {emits.length === 0 && <div className="typo-body text-foreground/60 italic">No events emitted</div>}
            {emits.map((ev, i) => {
              const routed = ucRoutes[ev.event_type] ?? new Set<DestId>();
              const subscribed = routed.size > 0;
              return (
                <div
                  key={ev.event_type}
                  className={`flex items-center gap-2 px-2 py-2 rounded-input transition-colors ${
                    subscribed ? 'bg-status-warning/[0.10]' : 'bg-foreground/[0.02]'
                  }`}
                >
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                    style={{
                      color: subscribed ? 'var(--color-status-warning)' : 'var(--color-foreground)',
                      opacity: subscribed ? 1 : 0.35,
                      background: subscribed ? 'color-mix(in srgb, var(--color-status-warning) 14%, transparent)' : 'transparent',
                      boxShadow: subscribed ? 'inset 0 0 0 1px color-mix(in srgb, var(--color-status-warning) 40%, transparent)' : 'inset 0 0 0 1px color-mix(in srgb, var(--color-foreground) 15%, transparent)',
                    }}
                  >
                    <StampGlyph kind={classifyEvent(ev.event_type)} size={14} />
                  </div>
                  <span className={`flex-1 min-w-0 typo-body font-medium truncate ${subscribed ? 'text-foreground' : 'text-foreground/75'}`}>
                    {ev.description}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {destinations.map((dest) => (
                      <RouteToggle
                        key={dest.id}
                        destination={dest}
                        active={routed.has(dest.id)}
                        firing={firing && routed.has(dest.id)}
                        delay={i * 0.1 + 0.2}
                        onToggle={() => onToggleRoute(ucId, ev.event_type, dest.id)}
                        onRemove={dest.kind === 'channel' ? () => onRemoveChannel(dest.id) : undefined}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => onAddChannel(ev.event_type)}
                      className="focus-ring w-8 h-8 rounded-full border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneHeader({ icon: Icon, label, accent, count }: { icon: LucideIcon; label: string; accent: 'primary' | 'status-warning'; count?: number }) {
  const textColor = accent === 'primary' ? 'text-primary' : 'text-status-warning';
  const badgeClasses =
    accent === 'primary'
      ? 'bg-primary/20 text-primary ring-primary/30'
      : 'bg-status-warning/20 text-status-warning ring-status-warning/30';
  return (
    <div className={`typo-body uppercase tracking-wider flex items-center gap-2 font-semibold ${textColor}`}>
      <Icon className="w-5 h-5" />
      {label}
      {typeof count === 'number' && (
        <span className={`ml-auto inline-flex items-center justify-center min-w-6 h-6 rounded-full px-2 typo-body font-bold ring-1 ${badgeClasses}`}>
          {count}
        </span>
      )}
    </div>
  );
}

function PipelineArrow({ firing }: { firing: boolean }) {
  return (
    <div className="self-center flex items-center mx-3" aria-hidden>
      <div className="w-3 h-px bg-foreground/25" />
      <ArrowRight className={`w-6 h-6 ${firing ? 'text-status-warning' : 'text-foreground/45'}`} />
    </div>
  );
}

function RouteToggle({
  destination,
  active,
  firing,
  delay,
  onToggle,
  onRemove,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  delay: number;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          active
            ? 'bg-primary/15 ring-2 ring-primary/55 text-primary shadow-elevation-1'
            : 'bg-foreground/[0.04] ring-1 ring-border text-foreground/45 hover:text-foreground hover:ring-foreground/40'
        }`}
        animate={firing ? { boxShadow: ['0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)', '0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent)'] } : {}}
        transition={firing ? { duration: 0.9, delay, repeat: Infinity, ease: 'easeOut' } : undefined}
      >
        {destination.kind === 'channel' && destination.meta ? (
          <ConnectorIcon meta={destination.meta} size="w-4 h-4" />
        ) : destination.icon ? (
          <destination.icon className="w-4 h-4" />
        ) : null}
      </motion.button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ─── Power rail ──────────────────────────────────────────────────────────

interface PowerRailProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
  status: 'idle' | 'running' | 'done';
  subscribedCount: number;
}

function PowerRail({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
  status,
  subscribedCount,
}: PowerRailProps) {
  const firing = status === 'running';
  const poweredTime = hasTime(selection);
  const poweredEvent = hasEvent(selection);
  const powered = poweredTime || poweredEvent;
  return (
    <div className="relative rounded-card ring-1 ring-border/80 bg-gradient-to-b from-foreground/[0.035] to-foreground/[0.015] overflow-hidden shadow-elevation-1">
      <div className="flex items-center gap-1 px-6 pt-2.5">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.span
            key={i}
            className={`h-1 flex-1 rounded-full ${powered ? 'bg-primary/70' : 'bg-foreground/15'}`}
            animate={firing ? { opacity: [0.3, 1, 0.3] } : {}}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.05, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <div className="flex items-start gap-4 px-6 py-3">
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 transition-colors ${
            powered ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1' : 'ring-border bg-background text-foreground/40'
          }`}>
            {powered ? <Radio className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
          </div>
          <span className="typo-caption uppercase tracking-wider text-foreground/55 font-semibold">Source</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-primary">
              <Clock className="w-3.5 h-3.5" />
              Time trigger
              <LED on={poweredTime} accent="primary" />
            </div>
            {poweredTime ? (
              <button type="button" onClick={() => onChange(disableTimeFamily(selection))} className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button type="button" onClick={() => onChange(enableTimeFamily(selection))} className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-primary hover:bg-primary/10 typo-caption">
                <Plus className="w-3 h-3" /> enable
              </button>
            )}
          </div>
          {poweredTime && <TimeControls selection={selection} onChange={onChange} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-status-info">
              <Zap className="w-3.5 h-3.5" />
              Event trigger
              <LED on={poweredEvent} accent="info" />
            </div>
            {poweredEvent ? (
              <button type="button" onClick={() => onChange(disableEventFamily(selection))} className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button type="button" onClick={() => onChange(enableEventFamily(selection, availableEventKeys))} className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-status-info hover:bg-status-info/10 typo-caption">
                <Plus className="w-3 h-3" /> enable
              </button>
            )}
          </div>
          {poweredEvent && (
            <ThemedSelect
              filterable
              options={availableEvents.length > 0 ? availableEvents : [{ value: '', label: '(no events declared)' }]}
              value={selection.event?.eventType ?? ''}
              onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
              placeholder="Pick an event"
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-1 pt-1 pr-1">
          <div className="inline-flex items-center gap-1.5 typo-caption font-mono text-foreground/65">
            <Cog className="w-3.5 h-3.5" />
            <span className="tabular-nums text-foreground font-semibold">{subscribedCount}</span>
            emitting
          </div>
          <span className="typo-caption uppercase tracking-wider text-foreground/45 font-semibold">events</span>
        </div>
      </div>
    </div>
  );
}

function TimeControls({ selection, onChange }: { selection: TriggerSelection; onChange: (next: TriggerSelection) => void }) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {TIME_PRESETS.map((p) => {
          const Icon = p.icon;
          const on = sub === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForTimePreset(p.key, selection))}
              className={`focus-ring inline-flex items-center gap-1 rounded px-2 py-0.5 typo-caption font-medium transition-colors ${
                on ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {p.label}
            </button>
          );
        })}
      </div>
      {sub !== 'hourly' && (
        <div className="flex items-center gap-1.5 typo-caption">
          {sub === 'weekly' && (
            <div className="flex gap-0.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange(updateTime(selection, { weekday: i }))}
                  className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                    weekday === i ? 'bg-primary/25 text-primary' : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.05]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <span className="text-foreground/55 font-mono ml-auto">@</span>
          <input
            type="number"
            min={0}
            max={23}
            value={hourOfDay}
            onChange={(e) => onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))}
            className="focus-ring w-12 rounded ring-1 ring-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-foreground text-center tabular-nums"
          />
          <span className="text-foreground/55 font-mono tabular-nums">:00</span>
        </div>
      )}
    </div>
  );
}

function LED({ on, accent }: { on: boolean; accent: 'primary' | 'info' | 'warning' }) {
  const bg = on ? (accent === 'primary' ? 'bg-primary' : accent === 'info' ? 'bg-status-info' : 'bg-status-warning') : 'bg-foreground/20';
  const glow = on
    ? accent === 'primary'
      ? 'shadow-[0_0_6px_var(--color-primary)]'
      : accent === 'info'
      ? 'shadow-[0_0_6px_var(--color-status-info)]'
      : 'shadow-[0_0_6px_var(--color-status-warning)]'
    : '';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${bg} ${glow}`} />;
}

// ─── Preview modal ────────────────────────────────────────────────────────

function PreviewModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="cockpit-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3 id="cockpit-preview-title" className="typo-body-lg font-semibold text-foreground/95 tracking-tight inline-flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-card bg-primary/15 ring-1 ring-primary/30 text-primary">
              <Inbox className="w-5 h-5" />
            </span>
            {title}
          </h3>
          {subtitle && <p className="typo-body text-foreground/70 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="focus-ring p-1.5 rounded-card hover:bg-secondary/60 text-foreground/80 hover:text-foreground transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">{children}</div>
    </BaseModal>
  );
}
