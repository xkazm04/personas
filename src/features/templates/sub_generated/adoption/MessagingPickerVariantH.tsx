// @ts-nocheck — visual-review prototype (Variant H · "Forge").
// Evolves Pipeline (C) by adding kinetic machinery: the capability
// becomes a tiny visible machine. The Runs zone shows an interlocking
// gear cluster that slowly rotates at idle and spins up during test
// runs. The arrow connector renders as a rail with signal packets that
// physically travel from the power rail → gear cluster → events →
// destinations. Each emitted event is stamped with a bespoke SVG glyph
// (buy / sell / hold / generic bolt) so the meaning of the event is
// readable before you read the event name.
//
// Token rules (feedback_tailwind_brand_tokens): primary = cyan accent,
// status-warning = amber, status-info = blue, status-error = red.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
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

export function MessagingPickerVariantH() {
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
    Object.fromEntries(useCases.map((u) => [u.id, selectionForTimePreset('weekly', {})])),
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
      { id: APP_NOTIF, label: 'App notification', shortLabel: 'App',    kind: 'default', icon: Bell },
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
            const status = testStatus[uc.id] ?? 'idle';
            const canPreview = Boolean(previewReady[uc.id]);
            const descExpanded = expandedDesc.has(uc.id);
            const firing = status === 'running';
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
                {/* Header — parity with Pipeline */}
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

                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div key="pipeline" {...HEIGHT_FADE} className="overflow-hidden">
                      {/* Body container with rack backplate + subtle forge glow */}
                      <div
                        className="relative px-5 py-5 bg-gradient-to-b from-foreground/[0.015] to-foreground/[0.04]"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(90deg, transparent 0 19px, color-mix(in srgb, var(--color-foreground) 3%, transparent) 19px 20px)',
                        }}
                      >
                        {/* Forge glow behind the machine */}
                        {firing && (
                          <motion.div
                            aria-hidden
                            className="absolute inset-x-8 top-28 bottom-8 rounded-card pointer-events-none"
                            style={{
                              background:
                                'radial-gradient(circle at 30% 50%, color-mix(in srgb, var(--color-status-warning) 15%, transparent) 0%, transparent 55%)',
                            }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0.35, 0.7, 0.35] }}
                            transition={{ duration: 1.4, repeat: Infinity }}
                          />
                        )}

                        <PowerRail
                          selection={trigger}
                          availableEvents={eventOptions}
                          availableEventKeys={availableEventKeys}
                          onChange={(next) => setTriggerSelection(uc.id, next)}
                          status={status}
                          subscribedCount={subscribedCount}
                        />

                        <div className="grid grid-cols-[1fr_auto_1.5fr] items-stretch gap-0 mt-4 relative">
                          {/* Zone — Runs (gear machine) */}
                          <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-foreground/[0.03] p-4 relative overflow-hidden">
                            <ZoneHeader icon={Sparkles} label="Runs" accent="primary" />
                            <GearMachine firing={firing} />
                            <p className="typo-body text-foreground/75 leading-snug relative">{subtitle}</p>
                            {/* Screw accents */}
                            <Screw className="top-2 left-2" />
                            <Screw className="top-2 right-2" />
                            <Screw className="bottom-2 left-2" />
                            <Screw className="bottom-2 right-2" />
                          </div>

                          <SignalRail firing={firing} />

                          {/* Zone — Events */}
                          <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-status-warning/[0.06] p-4 relative">
                            <ZoneHeader
                              icon={Zap}
                              label="Events"
                              accent="status-warning"
                              count={subscribedCount}
                            />

                            <motion.div
                              layout
                              transition={{ duration: 0.22, ease: FADE.ease }}
                              className="flex flex-col gap-1"
                            >
                              {emits.length === 0 && (
                                <div className="typo-body text-foreground/60 italic">No events emitted</div>
                              )}
                              {emits.map((ev, evIdx) => {
                                const routed = ucRoutes[ev.event_type] ?? new Set<DestId>();
                                const subscribed = routed.size > 0;
                                return (
                                  <motion.div
                                    key={ev.event_type}
                                    layout
                                    transition={{ duration: 0.22, ease: FADE.ease }}
                                    className={`flex items-center gap-2 px-2 py-2 rounded-input transition-colors relative ${
                                      subscribed ? 'bg-status-warning/[0.10]' : 'bg-foreground/[0.02]'
                                    }`}
                                  >
                                    <SignalStamp eventType={ev.event_type} active={subscribed} firing={firing && subscribed} delay={evIdx * 0.1} />
                                    <span
                                      className={`flex-1 min-w-0 typo-body font-medium truncate ${
                                        subscribed ? 'text-foreground' : 'text-foreground/75'
                                      }`}
                                    >
                                      {ev.description}
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <AnimatePresence initial={false}>
                                        {destinations.map((dest) => (
                                          <motion.div
                                            key={dest.id}
                                            layout
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            transition={FADE}
                                          >
                                            <RouteToggle
                                              destination={dest}
                                              active={routed.has(dest.id)}
                                              firing={firing && routed.has(dest.id)}
                                              delay={evIdx * 0.1 + 0.2}
                                              onToggle={() => toggleRoute(uc.id, ev.event_type, dest.id)}
                                              onRemove={
                                                dest.kind === 'channel'
                                                  ? () => removeChannel(dest.id)
                                                  : undefined
                                              }
                                            />
                                          </motion.div>
                                        ))}
                                      </AnimatePresence>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setQuickAddCtx({ ucId: uc.id, eventType: ev.event_type })
                                        }
                                        title="Attach a messaging channel"
                                        className="focus-ring w-8 h-8 rounded-full border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 flex items-center justify-center transition-colors"
                                      >
                                        <Plus className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </motion.div>
                                );
                              })}
                            </motion.div>
                          </div>
                        </div>
                      </div>
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

// ─── Gear machine — animated SVG in the Runs zone ─────────────────────────

function GearMachine({ firing }: { firing: boolean }) {
  return (
    <div className="relative -mt-1 mb-1 flex items-center justify-center h-24 pointer-events-none">
      <svg viewBox="0 0 140 96" className="w-full h-full overflow-visible">
        <defs>
          <radialGradient id="gear-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
            <stop offset="60%" stopColor="var(--color-primary)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft glow behind the gears */}
        <ellipse cx="68" cy="48" rx="62" ry="30" fill="url(#gear-glow)" />

        {/* Large gear */}
        <motion.g
          style={{ originX: 52, originY: 48, transformBox: 'fill-box' }}
          animate={{ rotate: 360 }}
          transition={{ duration: firing ? 2.4 : 22, ease: 'linear', repeat: Infinity }}
        >
          <Gear cx={52} cy={48} r={26} teeth={14} accent />
        </motion.g>

        {/* Small gear (counter-rotating) */}
        <motion.g
          style={{ originX: 96, originY: 30, transformBox: 'fill-box' }}
          animate={{ rotate: -360 }}
          transition={{ duration: firing ? 1.6 : 16, ease: 'linear', repeat: Infinity }}
        >
          <Gear cx={96} cy={30} r={16} teeth={10} />
        </motion.g>

        {/* Micro gear (slower) */}
        <motion.g
          style={{ originX: 108, originY: 66, transformBox: 'fill-box' }}
          animate={{ rotate: 360 }}
          transition={{ duration: firing ? 3.6 : 30, ease: 'linear', repeat: Infinity }}
        >
          <Gear cx={108} cy={66} r={11} teeth={8} />
        </motion.g>

        {/* Spark during firing */}
        <AnimatePresence>
          {firing && (
            <>
              {[0, 0.5, 1.0].map((delay) => (
                <motion.circle
                  key={`spark-${delay}`}
                  cx={52}
                  cy={48}
                  r={2}
                  fill="var(--color-status-warning)"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1.4, 0],
                    cx: [52, 52 + (Math.random() - 0.5) * 30],
                    cy: [48, 48 - 12 - Math.random() * 10],
                  }}
                  transition={{ duration: 0.8, delay, repeat: Infinity, ease: 'easeOut' }}
                />
              ))}
            </>
          )}
        </AnimatePresence>
      </svg>
    </div>
  );
}

function Gear({
  cx,
  cy,
  r,
  teeth,
  accent = false,
}: {
  cx: number;
  cy: number;
  r: number;
  teeth: number;
  accent?: boolean;
}) {
  // Build a gear path: star-like outer edge from alternating outer/inner
  // radii at each tooth step, then a concentric hub hole.
  const outer = r;
  const inner = r - 3.5;
  const pts: string[] = [];
  const steps = teeth * 2;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = i % 2 === 0 ? outer : inner;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  pts.push('Z');
  return (
    <g>
      <path
        d={pts.join(' ')}
        fill={accent ? 'color-mix(in srgb, var(--color-primary) 18%, var(--color-background))' : 'color-mix(in srgb, var(--color-foreground) 6%, var(--color-background))'}
        stroke={accent ? 'var(--color-primary)' : 'var(--color-foreground)'}
        strokeOpacity={accent ? 0.55 : 0.28}
        strokeWidth={1.25}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.45}
        fill="var(--color-background)"
        stroke={accent ? 'var(--color-primary)' : 'var(--color-foreground)'}
        strokeOpacity={accent ? 0.45 : 0.25}
        strokeWidth={1}
      />
      {/* Hub pin */}
      <circle cx={cx} cy={cy} r={1.5} fill={accent ? 'var(--color-primary)' : 'var(--color-foreground)'} fillOpacity={0.6} />
      {/* Spoke hints */}
      {[0, 60, 120].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = cx + r * 0.2 * Math.cos(rad);
        const y1 = cy + r * 0.2 * Math.sin(rad);
        const x2 = cx + r * 0.42 * Math.cos(rad);
        const y2 = cy + r * 0.42 * Math.sin(rad);
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={accent ? 'var(--color-primary)' : 'var(--color-foreground)'}
            strokeOpacity={accent ? 0.4 : 0.2}
            strokeWidth={1}
          />
        );
      })}
    </g>
  );
}

function Screw({ className }: { className?: string }) {
  return (
    <div className={`absolute w-2 h-2 rounded-full bg-foreground/10 ring-1 ring-foreground/15 ${className}`} aria-hidden>
      <span className="block w-full h-px bg-foreground/25 translate-y-[3px] rotate-45 origin-center" />
    </div>
  );
}

// ─── Signal rail between Runs and Events ─────────────────────────────────

function SignalRail({ firing }: { firing: boolean }) {
  return (
    <div className="self-stretch flex items-stretch mx-3 relative w-12" aria-hidden="true">
      <svg viewBox="0 0 48 60" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        {/* The rail: two parallel lines forming a "track" */}
        <line x1={2} y1={30} x2={46} y2={30} stroke="var(--color-foreground)" strokeOpacity={0.25} strokeWidth={1.5} />
        <line
          x1={2}
          y1={30}
          x2={46}
          y2={30}
          stroke="var(--color-primary)"
          strokeOpacity={firing ? 0.8 : 0.35}
          strokeWidth={2}
          strokeDasharray="3 4"
        />

        {/* Input terminal */}
        <circle cx={2} cy={30} r={3} fill="var(--color-background)" stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={1.5} />
        {/* Output terminal → arrow head */}
        <polygon
          points="46,30 38,24 40,30 38,36"
          fill={firing ? 'var(--color-status-warning)' : 'var(--color-foreground)'}
          fillOpacity={firing ? 0.95 : 0.45}
        />

        {/* Traveling signal packet */}
        {firing && (
          <>
            {[0, 0.35, 0.7].map((delay) => (
              <motion.rect
                key={`packet-${delay}`}
                x={-4}
                y={27.5}
                width={6}
                height={5}
                rx={1}
                fill="var(--color-status-warning)"
                filter="drop-shadow(0 0 4px var(--color-status-warning))"
                initial={{ x: -4, opacity: 0 }}
                animate={{ x: [-4, 44], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.1, delay, repeat: Infinity, ease: 'easeOut' }}
              />
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Signal stamp — bespoke SVG glyph per event type ─────────────────────

function SignalStamp({
  eventType,
  active,
  firing,
  delay,
}: {
  eventType: string;
  active: boolean;
  firing: boolean;
  delay: number;
}) {
  const color = active ? 'var(--color-status-warning)' : 'var(--color-foreground)';
  const opacity = active ? 1 : 0.35;
  const kind = classifyEvent(eventType);

  return (
    <motion.div
      className="relative flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
      style={{
        color,
        opacity,
        background: active
          ? 'color-mix(in srgb, var(--color-status-warning) 14%, transparent)'
          : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px color-mix(in srgb, var(--color-status-warning) 40%, transparent)' : 'inset 0 0 0 1px color-mix(in srgb, var(--color-foreground) 15%, transparent)',
      }}
      animate={firing ? { scale: [1, 1.15, 1] } : {}}
      transition={firing ? { duration: 0.6, delay, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <svg viewBox="0 0 20 20" className="w-4 h-4">
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
            <path d="M 10 4 L 10 10" strokeOpacity={0.6} />
          </g>
        )}
        {kind === 'gem' && (
          <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
            <path d="M 10 3 L 17 8 L 14 17 L 6 17 L 3 8 Z" />
            <path d="M 3 8 L 17 8 M 7 8 L 10 17 M 13 8 L 10 17" strokeOpacity={0.5} />
          </g>
        )}
        {kind === 'spike' && (
          <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M 2 13 L 6 13 L 8 6 L 11 17 L 13 10 L 18 10" />
          </g>
        )}
        {kind === 'bolt' && (
          <path
            d="M 11 2 L 4 12 L 9 12 L 7 18 L 16 8 L 11 8 L 13 2 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
        )}
      </svg>
    </motion.div>
  );
}

type StampKind = 'up' | 'down' | 'hold' | 'scan' | 'gem' | 'spike' | 'bolt';

function classifyEvent(eventType: string): StampKind {
  const t = eventType.toLowerCase();
  if (t.endsWith('.buy') || t.includes('.up') || t.includes('discovered')) return 'up';
  if (t.endsWith('.sell') || t.includes('.down') || t.includes('filtered_out') || t.includes('failed')) return 'down';
  if (t.endsWith('.hold') || t.includes('succeeded') || t.includes('completed')) return 'hold';
  if (t.includes('scan') || t.includes('disclosure')) return 'scan';
  if (t.includes('gem') || t.includes('discovered')) return 'gem';
  if (t.includes('shift') || t.includes('spike')) return 'spike';
  return 'bolt';
}

// ─── Route toggle (with firing pulse) ─────────────────────────────────────

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
        title={`${active ? 'Disable' : 'Enable'} ${destination.label}`}
        className={`focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          active
            ? 'bg-primary/15 ring-2 ring-primary/55 text-primary shadow-elevation-1'
            : 'bg-foreground/[0.04] ring-1 ring-border text-foreground/45 hover:text-foreground hover:ring-foreground/40'
        }`}
        animate={
          firing
            ? { boxShadow: ['0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)', '0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent)'] }
            : {}
        }
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
          title="Remove this channel from all events"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ─── Zone header ──────────────────────────────────────────────────────────

function ZoneHeader({
  icon: Icon,
  label,
  accent,
  count,
}: {
  icon: LucideIcon;
  label: string;
  accent: 'primary' | 'status-warning' | 'status-info';
  count?: number;
}) {
  const textColor =
    accent === 'primary'
      ? 'text-primary'
      : accent === 'status-warning'
      ? 'text-status-warning'
      : 'text-status-info';
  const badgeClasses =
    accent === 'primary'
      ? 'bg-primary/20 text-primary ring-primary/30'
      : accent === 'status-warning'
      ? 'bg-status-warning/20 text-status-warning ring-status-warning/30'
      : 'bg-status-info/20 text-status-info ring-status-info/30';
  return (
    <div className={`typo-body uppercase tracking-wider flex items-center gap-2 font-semibold ${textColor}`}>
      <Icon className="w-5 h-5" />
      {label}
      {typeof count === 'number' && (
        <span
          className={`ml-auto inline-flex items-center justify-center min-w-6 h-6 rounded-full px-2 typo-body font-bold ring-1 ${badgeClasses}`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Power rail (with rack-ear screws) ────────────────────────────────────

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
      {/* Rack-ear screws */}
      <Screw className="top-1.5 left-1.5" />
      <Screw className="top-1.5 right-1.5" />
      <Screw className="bottom-1.5 left-1.5" />
      <Screw className="bottom-1.5 right-1.5" />

      {/* Top LED strip */}
      <div className="flex items-center gap-1 px-6 pt-2.5">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.span
            key={i}
            className={`h-1 flex-1 rounded-full ${powered ? 'bg-primary/70' : 'bg-foreground/15'}`}
            animate={firing ? { opacity: [0.3, 1, 0.3] } : {}}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.05,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      <div className="flex items-start gap-4 px-6 py-3">
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 transition-colors ${
              powered
                ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1'
                : 'ring-border bg-background text-foreground/40'
            }`}
            title={powered ? 'Trigger armed' : 'Manual only'}
          >
            {powered ? <Radio className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
          </div>
          <span className="typo-caption uppercase tracking-wider text-foreground/55 font-semibold">
            Source
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-primary">
              <Clock className="w-3.5 h-3.5" />
              Time trigger
              <LED on={poweredTime} accent="primary" />
            </div>
            {poweredTime ? (
              <button
                type="button"
                onClick={() => onChange(disableTimeFamily(selection))}
                className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
                aria-label="Remove time trigger"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange(enableTimeFamily(selection))}
                className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-primary hover:bg-primary/10 typo-caption"
              >
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
              <button
                type="button"
                onClick={() => onChange(disableEventFamily(selection))}
                className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange(enableEventFamily(selection, availableEventKeys))}
                className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-status-info hover:bg-status-info/10 typo-caption"
              >
                <Plus className="w-3 h-3" /> enable
              </button>
            )}
          </div>
          {poweredEvent && (
            <ThemedSelect
              filterable
              options={
                availableEvents.length > 0
                  ? availableEvents
                  : [{ value: '', label: '(no events declared)' }]
              }
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
          <span className="typo-caption uppercase tracking-wider text-foreground/45 font-semibold">
            events
          </span>
        </div>
      </div>
    </div>
  );
}

function TimeControls({
  selection,
  onChange,
}: {
  selection: TriggerSelection;
  onChange: (next: TriggerSelection) => void;
}) {
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
                on
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                  : 'bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08]'
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
                    weekday === i
                      ? 'bg-primary/25 text-primary'
                      : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.05]'
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
  const bg = on
    ? accent === 'primary'
      ? 'bg-primary'
      : accent === 'info'
      ? 'bg-status-info'
      : 'bg-status-warning'
    : 'bg-foreground/20';
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

function PreviewModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="forge-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="forge-preview-title"
            className="typo-body-lg font-semibold text-foreground/95 tracking-tight inline-flex items-center gap-2.5"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-card bg-primary/15 ring-1 ring-primary/30 text-primary">
              <Inbox className="w-5 h-5" />
            </span>
            {title}
          </h3>
          {subtitle && <p className="typo-body text-foreground/70 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="focus-ring p-1.5 rounded-card hover:bg-secondary/60 text-foreground/80 hover:text-foreground transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">{children}</div>
    </BaseModal>
  );
}
