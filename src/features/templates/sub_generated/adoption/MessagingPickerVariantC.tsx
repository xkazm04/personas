// @ts-nocheck — visual-review prototype. See MessagingPickerShared.tsx for
// the cleanup checklist that fires when this variant is merged into
// UseCasePickerStepNeon.
//
// Follow `memory/feedback_tailwind_brand_tokens.md`: never use
// `bg/ring/border-brand-*/N` in this file. Use `primary` for cyan-family
// accents, `status-warning` for the amber Events zone, `status-info` for
// blue Event-trigger accents, `status-error` for the remove-channel glyph.
//
// "Pipeline Canvas" — three zones, matching the runtime dataflow:
//
//   [ Trigger ] ─▶ [ Runs ] ─▶ [ Events ]
//
// The Trigger zone reuses the production TriggerSelection model from
// `useCasePickerShared.ts` (Time + Event families, independent) and
// mirrors UseCasePickerStepNeon's mono-labelled Time panel styling.
//
// The Events zone consolidates the former Channels + TitleBar bell.
// Destinations (App notification, In-App Message, plus user-attached
// messaging credentials) are listed in the top catalog row; each
// emitted event gets its OWN per-destination toggle row below, so a
// user can route one event to In-App only and another to Slack + App
// notification on the same capability. The + button opens
// `QuickAddCredentialModal` against the `messaging` connector
// category. When merging to production, persist per-event routing via
// `create_subscription` / `update_subscription` IPCs in
// `api/overview/events.ts`.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Inbox,
  Info,
  Loader2,
  Play,
  Plus,
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

// Subtitle copy shown inside each UC's Runs card — one short line summarising
// what the capability does.
const UC_SUBTITLE: Record<string, string> = {
  uc_signals:            'Composes buy / sell / hold signals from RSI, MACD, and earnings data',
  uc_congressional_scan: 'Matches congressional stock disclosures against watched sectors',
  uc_gems:               'Surfaces under-covered names passing technical + catalyst thresholds',
};

// Multi-sentence description revealed by the Info toggle on the UC header.
const UC_DESCRIPTION: Record<string, string> = {
  uc_signals:
    "Scores each ticker's technical stack (RSI, MACD), earnings tape, and sector rotation into a single composite. " +
    "Fires a stocks.signals.buy / .sell / .hold event so downstream capabilities — e.g. position sizing, PM notification — can react without re-computing the signal.",
  uc_congressional_scan:
    "Pulls weekly congressional stock disclosures and cross-checks them against the user's watched sectors. " +
    "Raises stocks.congress.disclosure for each hit and stocks.congress.sector_shift when disclosure volume spikes relative to the 8-week rolling average.",
  uc_gems:
    "Discovers under-covered names that pass a configurable tech-score and catalyst filter. " +
    "Rejected candidates are surfaced too (stocks.gems.filtered_out) so the user can tune thresholds without losing the full candidate set.",
};

const MESSAGING_SERVICE_TYPES = [
  'personas_messages', // built-in local channel — exposed as the In-App Message default, not as an attachable credential
  'slack',
  'discord',
  'telegram',
  'microsoft_teams',
];

const MESSAGING_CATEGORY = 'messaging';

// Default destination ids — always present regardless of vault state.
const APP_NOTIF: DestId = 'app_notif';
const IN_APP: DestId = 'in_app';

type DestId = 'app_notif' | 'in_app' | string; // string = vault credential id

interface Destination {
  id: DestId;
  label: string;
  shortLabel: string;
  kind: 'default' | 'channel';
  icon?: LucideIcon;
  meta?: ConnectorMeta;
}

// Shared motion presets — kept tight so the whole step feels responsive.
const FADE = {
  duration: 0.18,
  ease: [0.22, 0.61, 0.36, 1] as const,
};
const HEIGHT_FADE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit:    { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: FADE.ease },
};
const SWAP_FADE = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: 4 },
  transition: FADE,
};

export function MessagingPickerVariantC() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  const vaultCredentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  useEffect(() => {
    fetchCredentials().catch(() => {
      /* prototype ignores vault load errors */
    });
  }, [fetchCredentials]);

  const availableEventKeys = useMemo(() => {
    const out = new Set<string>();
    for (const uc of useCases) {
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) out.add(ev.event_type);
    }
    return Array.from(out);
  }, [useCases]);

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEventKeys.map((e) => ({ value: e, label: e })),
    [availableEventKeys],
  );

  // Healthchecked messaging credentials the user can attach as destinations.
  // personas_messages is excluded here — it's surfaced as the In-App default.
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

  // UC state ---------------------------------------------------------------
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));
  const [triggerByUc, setTriggerByUc] = useState<Record<string, TriggerSelection>>(() =>
    Object.fromEntries(useCases.map((u) => [u.id, selectionForTimePreset('weekly', {})])),
  );
  // Channels attached to the persona as destinations — shared across UCs so
  // adding once surfaces the destination tile on every capability.
  const [attachedChannels, setAttachedChannels] = useState<Set<string>>(() => new Set());

  // Per-event routing: uc → event_type → Set<destinationId>. Each row routes
  // independently so a user can fan an event to some destinations while
  // keeping others off.
  const [eventRoutes, setEventRoutes] = useState<Record<string, Record<string, Set<DestId>>>>(() => {
    const out: Record<string, Record<string, Set<DestId>>> = {};
    for (const uc of useCases) {
      out[uc.id] = {};
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) {
        const s = new Set<DestId>();
        s.add(IN_APP); // every event defaults to in-app
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
  const [quickAddUcId, setQuickAddUcId] = useState<string | null>(null);

  function toggleEnabled(ucId: string) {
    setEnabled((prev) => {
      const n = new Set(prev);
      if (n.has(ucId)) n.delete(ucId);
      else n.add(ucId);
      return n;
    });
  }

  function toggleDesc(ucId: string) {
    setExpandedDesc((prev) => {
      const n = new Set(prev);
      if (n.has(ucId)) n.delete(ucId);
      else n.add(ucId);
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
      if (s.has(destId)) s.delete(destId);
      else s.add(destId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });
    // TODO (prototype→prod): persist routing via update_subscription so the
    // persona runtime fans events out to the matching destinations.
  }

  function attachChannel(chId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.add(chId);
      return n;
    });
  }

  function removeChannel(chId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.delete(chId);
      return n;
    });
    // Strip the detached channel from every event route so the count chip
    // and test-run target set stay in sync.
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
    if (union.has(IN_APP)) {
      setPreviewReady((prev) => ({ ...prev, [ucId]: true }));
    }
    setTimeout(() => {
      setTestStatus((prev) => ({ ...prev, [ucId]: 'idle' }));
    }, 2000);
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
            const subtitle = UC_SUBTITLE[uc.id] ?? 'User-defined capability on this persona';
            const description = UC_DESCRIPTION[uc.id] ?? subtitle;
            const status = testStatus[uc.id] ?? 'idle';
            const canPreview = Boolean(previewReady[uc.id]);
            const descExpanded = expandedDesc.has(uc.id);
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
                {/* UC row header */}
                <div className="flex items-center gap-3.5 px-5 py-4 border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(uc.id)}
                    aria-pressed={on}
                    aria-label={on ? 'Disable capability' : 'Enable capability'}
                    className={`focus-ring flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                      on
                        ? 'bg-primary ring-1 ring-primary shadow-elevation-1'
                        : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
                    }`}
                  >
                    {on && <Check className="w-4 h-4 text-background" strokeWidth={3} />}
                  </button>
                  <h4 className={`flex-1 typo-heading truncate ${on ? 'text-foreground' : 'text-foreground/55'}`}>
                    {uc.name}
                  </h4>
                  {on && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        aria-pressed={descExpanded}
                        aria-label={descExpanded ? 'Hide capability details' : 'Show capability details'}
                        title={descExpanded ? 'Hide details' : 'Show details'}
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
                            title="Preview the in-app message"
                            aria-label="Preview in-app message"
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
                        title="Run a test through the full pipeline"
                        aria-label="Run test"
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
                    <motion.div
                      key="desc"
                      {...HEIGHT_FADE}
                      className="overflow-hidden"
                    >
                      <div className="px-5 py-3.5 bg-foreground/[0.02] border-b border-border/50">
                        <p className="typo-body text-foreground/80 leading-relaxed">{description}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      key="pipeline"
                      {...HEIGHT_FADE}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-[1.2fr_auto_0.9fr_auto_1.7fr] items-stretch gap-0 px-5 py-5">
                        {/* Zone 1 — Trigger */}
                        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-primary/[0.05] p-4">
                          <ZoneHeader icon={Clock} label="Trigger" accent="primary" />
                          <TriggerZone
                            selection={trigger}
                            availableEvents={eventOptions}
                            availableEventKeys={availableEventKeys}
                            onChange={(next) => setTriggerSelection(uc.id, next)}
                          />
                        </div>

                        <PipelineArrow />

                        {/* Zone 2 — Runs (subtitle only) */}
                        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-foreground/[0.03] p-4">
                          <ZoneHeader icon={Sparkles} label="Runs" accent="primary" />
                          <p className="typo-body-lg text-foreground/75 leading-snug">{subtitle}</p>
                        </div>

                        <PipelineArrow />

                        {/* Zone 3 — Events */}
                        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-status-warning/[0.06] p-4">
                          <ZoneHeader
                            icon={Bell}
                            label="Events"
                            accent="status-warning"
                            count={subscribedCount}
                          />

                          <div className="flex flex-col gap-2">
                            <SubsectionLabel>Destinations</SubsectionLabel>
                            <motion.div layout transition={{ duration: 0.22, ease: FADE.ease }} className="flex items-center gap-2 flex-wrap">
                              <AnimatePresence initial={false}>
                                {destinations.map((dest) => (
                                  <motion.div
                                    key={dest.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.85 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.85 }}
                                    transition={FADE}
                                  >
                                    <DestinationChip
                                      destination={dest}
                                      onRemove={
                                        dest.kind === 'channel' ? () => removeChannel(dest.id) : undefined
                                      }
                                    />
                                  </motion.div>
                                ))}
                              </AnimatePresence>
                              <motion.button
                                layout
                                type="button"
                                onClick={() => setQuickAddUcId(uc.id)}
                                className="focus-ring h-10 px-3 rounded-full border border-dashed border-border text-foreground/65 hover:text-foreground hover:border-foreground/40 inline-flex items-center gap-1.5 typo-body font-medium transition-colors"
                                title="Attach a messaging credential from the Vault catalog"
                                aria-label="Attach messaging channel"
                              >
                                <Plus className="w-4 h-4" />
                                Channel
                              </motion.button>
                            </motion.div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <SubsectionLabel>Subscriptions</SubsectionLabel>
                            <motion.div layout transition={{ duration: 0.22, ease: FADE.ease }} className="flex flex-col gap-1">
                              {emits.length === 0 && (
                                <div className="typo-body text-foreground/60 italic">No events emitted</div>
                              )}
                              {emits.map((ev) => {
                                const routed = ucRoutes[ev.event_type] ?? new Set<DestId>();
                                const subscribed = routed.size > 0;
                                return (
                                  <motion.div
                                    key={ev.event_type}
                                    layout
                                    transition={{ duration: 0.22, ease: FADE.ease }}
                                    className={`flex items-center gap-2 px-2 py-2 rounded-input transition-colors ${
                                      subscribed ? 'bg-status-warning/[0.10]' : 'bg-foreground/[0.02]'
                                    }`}
                                  >
                                    <span
                                      className={`flex-1 min-w-0 typo-body font-medium truncate ${
                                        subscribed ? 'text-foreground' : 'text-foreground/75'
                                      }`}
                                    >
                                      {ev.description}
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {destinations.map((dest) => (
                                        <RouteToggle
                                          key={dest.id}
                                          destination={dest}
                                          active={routed.has(dest.id)}
                                          onToggle={() => toggleRoute(uc.id, ev.event_type, dest.id)}
                                        />
                                      ))}
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

      {quickAddUcId && (
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
                if (added) attachChannel(added.id);
              })
              .finally(() => setQuickAddUcId(null));
          }}
          onClose={() => setQuickAddUcId(null)}
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

// ─── Preview modal ────────────────────────────────────────────────────────
// Local modal so we can set a z-index above the AdoptionWizardModal shell
// (`BaseModal portal` defaults to `z-[10000]`; production `DetailModal`
// hard-codes `z-[200]` and renders below the wizard, invisible). We pin this
// panel to `z-[10500]` so the preview floats above every wrapping modal.

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
      titleId="pipeline-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="pipeline-preview-title"
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

// ─── Zone + Pipeline helpers ──────────────────────────────────────────────

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

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="typo-body uppercase tracking-wider font-semibold text-foreground/60">
      {children}
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="self-center flex items-center mx-3" aria-hidden="true">
      <div className="w-3 h-px bg-foreground/25" />
      <ArrowRight className="w-6 h-6 text-foreground/45" />
    </div>
  );
}

// Destination catalog chip — labelled pill that identifies an available
// destination. Default destinations (App notification, In-App Message) are
// permanent; channel destinations show a remove-× on hover.
function DestinationChip({
  destination,
  onRemove,
}: {
  destination: Destination;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <div
        className="inline-flex items-center gap-2 h-10 px-3 rounded-full ring-1 ring-border bg-foreground/[0.04] text-foreground/85"
        title={destination.label}
      >
        {destination.kind === 'channel' && destination.meta ? (
          <ConnectorIcon meta={destination.meta} size="w-5 h-5" />
        ) : destination.icon ? (
          <destination.icon className="w-5 h-5 text-foreground/80" />
        ) : null}
        <span className="typo-body font-medium">{destination.shortLabel}</span>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove this channel"
          aria-label={`Remove ${destination.label}`}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-3 h-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// Compact per-event routing toggle — one per destination, tinted by kind
// when active.
function RouteToggle({
  destination,
  active,
  onToggle,
}: {
  destination: Destination;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`${active ? 'Disable' : 'Enable'} ${destination.label}`}
      title={`${active ? 'Disable' : 'Enable'} ${destination.label}`}
      className={`focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        active
          ? 'bg-primary/15 ring-2 ring-primary/55 text-primary shadow-elevation-1'
          : 'bg-foreground/[0.04] ring-1 ring-border text-foreground/45 hover:text-foreground hover:ring-foreground/40'
      }`}
    >
      {destination.kind === 'channel' && destination.meta ? (
        <ConnectorIcon meta={destination.meta} size="w-4 h-4" />
      ) : destination.icon ? (
        <destination.icon className="w-4 h-4" />
      ) : null}
    </button>
  );
}

// ─── Trigger zone ────────────────────────────────────────────────────────

interface TriggerZoneProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
}

function TriggerZone({ selection, availableEvents, availableEventKeys, onChange }: TriggerZoneProps) {
  return (
    <motion.div layout transition={{ duration: 0.22, ease: FADE.ease }} className="flex flex-col gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {hasTime(selection) ? (
          <motion.div key="time-panel" layout {...SWAP_FADE}>
            <TimeFamilyPanel
              selection={selection}
              onChange={onChange}
              onDisable={() => onChange(disableTimeFamily(selection))}
            />
          </motion.div>
        ) : (
          <motion.div key="time-add" layout {...SWAP_FADE}>
            <AddFamilyButton
              label="Time trigger"
              icon={Clock}
              onClick={() => onChange(enableTimeFamily(selection))}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {hasEvent(selection) ? (
          <motion.div key="event-panel" layout {...SWAP_FADE}>
            <EventFamilyPanel
              selection={selection}
              availableEvents={availableEvents}
              onChange={onChange}
              onDisable={() => onChange(disableEventFamily(selection))}
            />
          </motion.div>
        ) : (
          <motion.div key="event-add" layout {...SWAP_FADE}>
            <AddFamilyButton
              label="Event trigger"
              icon={Zap}
              onClick={() => onChange(enableEventFamily(selection, availableEventKeys))}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AddFamilyButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-lg border border-dashed border-foreground/20 text-foreground/70 typo-body font-medium hover:border-primary/50 hover:text-primary hover:bg-primary/[0.05] transition-colors"
    >
      <Plus className="w-4 h-4" />
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

interface FamilyPanelProps {
  selection: TriggerSelection;
  onChange: (next: TriggerSelection) => void;
  onDisable: () => void;
}

function TimeFamilyPanel({ selection, onChange, onDisable }: FamilyPanelProps) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;

  return (
    <motion.div layout className="rounded-xl ring-1 ring-primary/25 bg-primary/[0.06] p-3.5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body font-mono font-semibold uppercase tracking-wider text-primary">
          <Clock className="w-4 h-4" />
          Time trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="focus-ring p-1 rounded hover:bg-foreground/[0.08] text-foreground/55 hover:text-foreground transition-colors"
          aria-label="Remove time trigger"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TIME_PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = sub === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForTimePreset(p.key, selection))}
              className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 typo-body font-medium transition-colors ${
                isActive
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/55 tracking-wide shadow-elevation-1'
                  : 'bg-foreground/[0.04] ring-1 ring-border text-foreground/70 hover:bg-foreground/[0.08] hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {p.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {sub === 'daily' && (
          <motion.div key="daily" layout {...SWAP_FADE} className="flex items-center gap-2 typo-body">
            <span className="text-foreground/60 font-mono">at</span>
            <input
              type="number"
              min={0}
              max={23}
              value={hourOfDay}
              onChange={(e) => onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))}
              className="focus-ring w-16 rounded-md ring-1 ring-primary/30 focus:ring-primary bg-primary/10 px-2 py-1.5 font-mono text-foreground focus:outline-none text-center tabular-nums"
            />
            <span className="text-foreground/60 font-mono tabular-nums">:00</span>
          </motion.div>
        )}

        {sub === 'weekly' && (
          <motion.div key="weekly" layout {...SWAP_FADE} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 typo-body">
              <span className="text-foreground/60 font-mono">on</span>
              <div className="inline-flex gap-1 rounded-lg ring-1 ring-border bg-gradient-to-r from-primary/10 to-primary/[0.03] p-1 flex-wrap">
                {WEEKDAYS.map((d, i) => {
                  const isActive = weekday === i;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onChange(updateTime(selection, { weekday: i }))}
                      className={`rounded-md px-2 py-1 font-mono typo-body font-medium transition-colors ${
                        isActive
                          ? 'bg-primary/25 text-primary ring-1 ring-primary/40 shadow-elevation-1'
                          : 'text-foreground/65 hover:text-foreground hover:bg-foreground/[0.05]'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 typo-body">
              <span className="text-foreground/60 font-mono">at</span>
              <input
                type="number"
                min={0}
                max={23}
                value={hourOfDay}
                onChange={(e) => onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))}
                className="focus-ring w-16 rounded-md ring-1 ring-primary/30 focus:ring-primary bg-primary/10 px-2 py-1.5 font-mono text-foreground focus:outline-none text-center tabular-nums"
              />
              <span className="text-foreground/60 font-mono tabular-nums">:00</span>
            </div>
          </motion.div>
        )}

        {sub === 'hourly' && (
          <motion.p key="hourly" layout {...SWAP_FADE} className="typo-body text-foreground/60 font-mono">
            ▸ cron <span className="text-primary">0 * * * *</span>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface EventFamilyPanelProps extends FamilyPanelProps {
  availableEvents: ThemedSelectOption[];
}

function EventFamilyPanel({ selection, availableEvents, onChange, onDisable }: EventFamilyPanelProps) {
  return (
    <motion.div layout className="rounded-xl ring-1 ring-status-info/30 bg-status-info/[0.06] p-3.5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body font-mono font-semibold uppercase tracking-wider text-status-info">
          <Zap className="w-4 h-4" />
          Event trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="focus-ring p-1 rounded hover:bg-foreground/[0.08] text-foreground/55 hover:text-foreground transition-colors"
          aria-label="Remove event trigger"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 typo-body">
        <span className="text-foreground/60 font-mono flex-shrink-0">listen for</span>
        <ThemedSelect
          wrapperClassName="flex-1 min-w-0"
          filterable
          options={
            availableEvents.length > 0
              ? availableEvents
              : [{ value: '', label: '(no events declared by this template)' }]
          }
          value={selection.event?.eventType ?? ''}
          onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
          placeholder="Pick an event"
        />
      </div>
    </motion.div>
  );
}
