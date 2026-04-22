// @ts-nocheck — visual-review prototype (Variant K · "Ticket").
// Simplifies Forge (H) via a symbolic ticket / postal-slip metaphor.
// One UC = one ticket. The ticket has two halves joined by a perforation:
//
//   ┌──────────────────────┬──────────────────┐
//   │  MAIN STUB           │  ADDRESS STUB     │
//   │                      │                   │
//   │  [postmark stamp      │  deliver to:     │
//   │   = trigger]          │  • App           │
//   │                      │  • In-App        │
//   │   capability name     │  • Slack         │
//   │   + animated gear     │                   │
//   │                      │  [+ channel]     │
//   │  ▪ ▪ ▪  (event mini- │                   │
//   │         stamps)      │                   │
//   └──────────────────────┴──────────────────┘
//
// The trigger becomes a circular postmark in the upper-left. The
// destinations list as "addressees" on the detachable right stub. Events
// appear as a small collection of colored postage stamps at the bottom.
// The perforation between the two halves is rendered as a real dashed
// vertical line with visible tear dots. Routing is unified by default
// (destinations apply to every emitted event) — a single affordance on
// the stub enters per-event mode when needed.
//
// Token rules (feedback_tailwind_brand_tokens): primary = cyan accent,
// status-warning = amber, status-info = blue, status-error = red.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Inbox,
  Info,
  Loader2,
  MapPin,
  Play,
  Plus,
  Send,
  Settings2,
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

// Postmark codes per capability — reinforces the postal metaphor.
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

// Three most common triggers — shown as radial slices in the postmark.
// Anything else falls into Custom via the "Edit…" affordance.
type WhenPresetId = 'weekly_mon' | 'daily_9' | 'hourly' | 'on_event' | 'manual';

interface WhenPreset {
  id: WhenPresetId;
  label: string;
  short: string;
  icon: LucideIcon;
  toSelection: (prev: TriggerSelection, available: string[]) => TriggerSelection;
}

const WHEN_PRESETS: WhenPreset[] = [
  { id: 'weekly_mon', label: 'Weekly Mon 9am', short: 'MON',   icon: Calendar, toSelection: () => ({ time: { preset: 'weekly', weekday: 1, hourOfDay: 9 } }) },
  { id: 'daily_9',    label: 'Daily 9am',       short: 'DLY',   icon: Calendar, toSelection: () => ({ time: { preset: 'daily', hourOfDay: 9 } }) },
  { id: 'hourly',     label: 'Every hour',      short: 'HR',    icon: Clock,    toSelection: () => selectionForTimePreset('hourly', {}) },
  { id: 'on_event',   label: 'On event',        short: 'EVT',   icon: Zap,      toSelection: (_p, a) => ({ event: { eventType: a[0] ?? '' } }) },
  { id: 'manual',     label: 'Manual only',     short: 'MAN',   icon: Play,     toSelection: () => ({}) },
];

function classifyWhen(sel: TriggerSelection): WhenPresetId | null {
  if (sel.event && !sel.time) return 'on_event';
  if (!sel.time && !sel.event) return 'manual';
  if (sel.time?.preset === 'hourly') return 'hourly';
  if (sel.time?.preset === 'weekly' && sel.time?.weekday === 1 && sel.time?.hourOfDay === 9) return 'weekly_mon';
  if (sel.time?.preset === 'daily' && sel.time?.hourOfDay === 9) return 'daily_9';
  return null;
}

function summarizeTrigger(sel: TriggerSelection): string {
  if (!sel.time && !sel.event) return 'MANUAL';
  if (sel.event && !sel.time) return sel.event.eventType ? `ON ${sel.event.eventType.split('.').pop()?.toUpperCase()}` : 'ON EVENT';
  const t = sel.time!;
  if (t.preset === 'hourly') return 'EVERY HR';
  if (t.preset === 'daily') return `DAILY ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
  const wd = WEEKDAYS[t.weekday ?? 1];
  return `${wd.toUpperCase()} ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
}

export function MessagingPickerVariantK() {
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
  const [unifiedRoutes, setUnifiedRoutes] = useState<Record<string, Set<DestId>>>(() => {
    const out: Record<string, Set<DestId>> = {};
    for (const uc of useCases) out[uc.id] = new Set<DestId>([IN_APP, APP_NOTIF]);
    return out;
  });

  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  const [previewReady, setPreviewReady] = useState<Record<string, boolean>>({});
  const [previewUcId, setPreviewUcId] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(() => new Set());
  const [postmarkOpen, setPostmarkOpen] = useState<string | null>(null);
  const [quickAddCtx, setQuickAddCtx] = useState<{ ucId: string } | null>(null);

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
  function toggleDestination(ucId: string, destId: DestId) {
    setUnifiedRoutes((prev) => {
      const s = new Set(prev[ucId] ?? []);
      s.has(destId) ? s.delete(destId) : s.add(destId);
      return { ...prev, [ucId]: s };
    });
  }
  function attachChannel(chId: string, ucId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.add(chId);
      return n;
    });
    setUnifiedRoutes((prev) => {
      const s = new Set(prev[ucId] ?? []);
      s.add(chId);
      return { ...prev, [ucId]: s };
    });
  }
  function removeChannel(chId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.delete(chId);
      return n;
    });
    setUnifiedRoutes((prev) => {
      const next: typeof prev = {};
      for (const k of Object.keys(prev)) {
        const s = new Set(prev[k]);
        s.delete(chId);
        next[k] = s;
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
    const routed = unifiedRoutes[ucId] ?? new Set();
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    await mockTestDelivery(Array.from(routed), sample);
    setTestStatus((prev) => ({ ...prev, [ucId]: 'done' }));
    if (routed.has(IN_APP)) setPreviewReady((prev) => ({ ...prev, [ucId]: true }));
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
            const routed = unifiedRoutes[uc.id] ?? new Set<DestId>();
            const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
            const subtitle = UC_SUBTITLE[uc.id] ?? 'User-defined capability';
            const description = UC_DESCRIPTION[uc.id] ?? subtitle;
            const code = UC_CODE[uc.id] ?? 'UC';
            const status = testStatus[uc.id] ?? 'idle';
            const firing = status === 'running';
            const canPreview = Boolean(previewReady[uc.id]);
            const descExpanded = expandedDesc.has(uc.id);
            const activePreset = classifyWhen(trigger);
            const triggerSummary = summarizeTrigger(trigger);
            const isOpen = postmarkOpen === uc.id;
            const serial = String(Math.abs(hashStr(uc.id)) % 9000 + 1000);

            return (
              <motion.div
                key={uc.id}
                layout
                transition={{ duration: 0.25, ease: FADE.ease }}
                className={`relative rounded-card overflow-hidden transition-colors ${
                  on
                    ? 'ring-1 ring-primary/50 bg-primary/[0.04] shadow-elevation-2'
                    : 'ring-1 ring-border/70 bg-foreground/[0.015]'
                }`}
              >
                {/* Compact header — postal origin-station look */}
                <div className="flex items-start gap-4 px-5 py-3.5 border-b border-border/60 bg-gradient-to-r from-primary/[0.04] to-transparent">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(uc.id)}
                    aria-pressed={on}
                    className={`focus-ring flex-shrink-0 mt-1 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                      on
                        ? 'bg-primary ring-1 ring-primary shadow-elevation-1'
                        : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
                    }`}
                  >
                    {on && <Check className="w-4 h-4 text-background" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="inline-flex items-baseline gap-2 text-foreground/50 font-mono text-[10px] uppercase tracking-[0.25em]">
                      <span>№ {code}-{serial}</span>
                      <span className="opacity-60">·</span>
                      <span>ORIGIN {code}</span>
                    </div>
                    <h4
                      className={`mt-0.5 text-3xl font-semibold leading-tight tracking-tight truncate ${
                        on ? 'text-foreground' : 'text-foreground/70'
                      }`}
                    >
                      {uc.name}
                    </h4>
                  </div>
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
                        title="Dispatch a sample delivery"
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
                              <Send className="w-5 h-5" />
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
                    <motion.div key="ticket" {...HEIGHT_FADE} className="overflow-hidden">
                      {/* Ticket body: paper tone + faint diagonal weave */}
                      <div
                        className="relative grid grid-cols-[1fr_auto_0.85fr] items-stretch bg-gradient-to-br from-[color-mix(in_srgb,var(--color-background),var(--color-primary)_1%)] to-[color-mix(in_srgb,var(--color-background),var(--color-status-warning)_1.5%)]"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(45deg, transparent 0 14px, color-mix(in srgb, var(--color-foreground) 2.5%, transparent) 14px 15px)',
                        }}
                      >
                        {/* MAIN STUB (left) */}
                        <div className="relative p-5 pr-4">
                          {/* Postmark (trigger) */}
                          <div className="flex items-start gap-4 mb-4">
                            <Postmark
                              activePreset={activePreset}
                              triggerSummary={triggerSummary}
                              code={code}
                              firing={firing}
                              onClick={() => setPostmarkOpen(isOpen ? null : uc.id)}
                              open={isOpen}
                            />
                            <div className="flex-1 min-w-0 pt-1">
                              <div className="inline-flex items-center gap-1.5 typo-caption uppercase tracking-[0.2em] text-foreground/55 font-semibold mb-1">
                                <Clock className="w-3.5 h-3.5" /> DISPATCH SCHEDULE
                              </div>
                              <p className="typo-body text-foreground/75 leading-snug">{subtitle}</p>
                            </div>
                          </div>

                          {/* When-preset picker opens below the postmark */}
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div key="when-editor" {...HEIGHT_FADE} className="overflow-hidden">
                                <WhenEditor
                                  trigger={trigger}
                                  availableEvents={eventOptions}
                                  availableEventKeys={availableEventKeys}
                                  activePreset={activePreset}
                                  onChange={(next) => setTriggerSelection(uc.id, next)}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Event stamp strip */}
                          <div className="mt-4 pt-3 border-t border-dashed border-foreground/20">
                            <div className="inline-flex items-center gap-1.5 typo-caption uppercase tracking-[0.2em] text-foreground/55 font-semibold mb-2">
                              <Zap className="w-3.5 h-3.5 text-status-warning" /> MANIFEST · {emits.length} ITEM{emits.length === 1 ? '' : 'S'}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {emits.length === 0 && (
                                <span className="typo-body text-foreground/55 italic">No items declared</span>
                              )}
                              {emits.map((ev, i) => (
                                <PostageStamp
                                  key={ev.event_type}
                                  eventType={ev.event_type}
                                  description={ev.description}
                                  active={routed.size > 0}
                                  firing={firing && routed.size > 0}
                                  delay={i * 0.12}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* PERFORATION (center) */}
                        <Perforation />

                        {/* ADDRESS STUB (right) */}
                        <div className="relative p-5 pl-4 flex flex-col gap-3 bg-[color-mix(in_srgb,var(--color-background),var(--color-primary)_1.5%)]">
                          <div className="flex items-center justify-between">
                            <div className="inline-flex items-center gap-1.5 typo-caption uppercase tracking-[0.2em] text-primary font-semibold">
                              <MapPin className="w-3.5 h-3.5" /> DELIVER TO
                            </div>
                            <span className="font-mono text-[10px] uppercase tracking-widest text-foreground/45 tabular-nums">
                              {routed.size}/{destinations.length}
                            </span>
                          </div>

                          <div className="flex flex-col gap-1.5">
                            {destinations.map((dest) => (
                              <AddresseeRow
                                key={dest.id}
                                destination={dest}
                                active={routed.has(dest.id)}
                                firing={firing && routed.has(dest.id)}
                                onToggle={() => toggleDestination(uc.id, dest.id)}
                                onRemove={dest.kind === 'channel' ? () => removeChannel(dest.id) : undefined}
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => setQuickAddCtx({ ucId: uc.id })}
                              className="focus-ring flex items-center gap-2 px-2 py-1.5 rounded-md border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 typo-body font-medium transition-colors mt-1"
                            >
                              <Plus className="w-4 h-4" />
                              Addressee
                            </button>
                          </div>

                          {/* "Certified" seal at the bottom-right */}
                          <div className="mt-auto pt-2 flex items-end justify-end">
                            <CertifiedSeal
                              allAddressed={routed.size > 0}
                              firing={firing}
                            />
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
                  attachChannel(added.id, quickAddCtx.ucId);
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

// ─── Postmark — circular SVG trigger indicator ───────────────────────────

function Postmark({
  activePreset,
  triggerSummary,
  code,
  firing,
  onClick,
  open,
}: {
  activePreset: WhenPresetId | null;
  triggerSummary: string;
  code: string;
  firing: boolean;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      title={open ? 'Close scheduler' : 'Change dispatch schedule'}
      className="focus-ring flex-shrink-0 relative w-28 h-28 rounded-full overflow-visible"
    >
      <svg viewBox="0 0 120 120" className="w-full h-full">
        <defs>
          <radialGradient id="pm-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--color-primary) 14%, var(--color-background))" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-primary) 4%, var(--color-background))" />
          </radialGradient>
        </defs>

        {/* Outer ring — rotating during test */}
        <motion.g
          style={{ originX: 60, originY: 60, transformBox: 'fill-box' }}
          animate={firing ? { rotate: 360 } : { rotate: open ? 10 : 0 }}
          transition={firing ? { duration: 4, ease: 'linear', repeat: Infinity } : { duration: 0.4 }}
        >
          <circle cx={60} cy={60} r={56} fill="url(#pm-bg)" stroke="var(--color-primary)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="3 3" />
          {/* Tick marks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const x1 = 60 + 49 * Math.cos(a);
            const y1 = 60 + 49 * Math.sin(a);
            const x2 = 60 + (i % 6 === 0 ? 43 : 46) * Math.cos(a);
            const y2 = 60 + (i % 6 === 0 ? 43 : 46) * Math.sin(a);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-primary)"
                strokeOpacity={i % 6 === 0 ? 0.7 : 0.3}
                strokeWidth={i % 6 === 0 ? 1.5 : 1}
              />
            );
          })}
        </motion.g>

        {/* Inner ring — static */}
        <circle cx={60} cy={60} r={38} fill="var(--color-background)" stroke="var(--color-primary)" strokeOpacity={0.45} strokeWidth={1.5} />

        {/* Curved code at top */}
        <defs>
          <path id="pm-top-arc" d="M 22 60 A 38 38 0 0 1 98 60" />
          <path id="pm-bot-arc" d="M 98 60 A 38 38 0 0 1 22 60" />
        </defs>
        <text className="fill-primary" style={{ fontSize: 8, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.25em' }}>
          <textPath href="#pm-top-arc" startOffset="50%" textAnchor="middle">
            PERSONAS · DISPATCH
          </textPath>
        </text>
        <text className="fill-foreground/55" style={{ fontSize: 7, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em' }}>
          <textPath href="#pm-bot-arc" startOffset="50%" textAnchor="middle">
            {code} · REV 0.1
          </textPath>
        </text>

        {/* Center label */}
        <text
          x={60}
          y={57}
          textAnchor="middle"
          className="fill-primary"
          style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.1em' }}
        >
          {splitSummary(triggerSummary).a}
        </text>
        <text
          x={60}
          y={70}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', fontWeight: 500, letterSpacing: '0.15em' }}
        >
          {splitSummary(triggerSummary).b}
        </text>

        {/* Active-preset sliver indicator on the outer ring */}
        {activePreset && (
          <PresetSliver preset={activePreset} />
        )}

        {/* Center pulse during test */}
        {firing && (
          <motion.circle
            cx={60}
            cy={60}
            r={12}
            fill="var(--color-primary)"
            fillOpacity={0.4}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            style={{ originX: 60, originY: 60, transformBox: 'fill-box' }}
          />
        )}
      </svg>

      {/* Chevron hint */}
      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-background ring-1 ring-border rounded-full w-5 h-5 flex items-center justify-center text-foreground/60">
        <Settings2 className="w-3 h-3" />
      </span>
    </button>
  );
}

function splitSummary(s: string): { a: string; b: string } {
  const parts = s.split(' ');
  if (parts.length === 1) return { a: s, b: '' };
  const mid = Math.ceil(parts.length / 2);
  return { a: parts.slice(0, mid).join(' '), b: parts.slice(mid).join(' ') };
}

function PresetSliver({ preset }: { preset: WhenPresetId }) {
  // Highlight an arc segment for the active preset position in the ring.
  const idx = WHEN_PRESETS.findIndex((p) => p.id === preset);
  if (idx === -1) return null;
  const total = WHEN_PRESETS.length;
  const slice = (Math.PI * 2) / total;
  const start = -Math.PI / 2 + idx * slice;
  const end = start + slice;
  const r = 52;
  const x1 = 60 + r * Math.cos(start);
  const y1 = 60 + r * Math.sin(start);
  const x2 = 60 + r * Math.cos(end);
  const y2 = 60 + r * Math.sin(end);
  const large = slice > Math.PI ? 1 : 0;
  return (
    <path
      d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
      fill="none"
      stroke="var(--color-primary)"
      strokeWidth={3.5}
      strokeOpacity={0.75}
      strokeLinecap="round"
    />
  );
}

// ─── Perforation — dashed vertical tear line with tear dots ──────────────

function Perforation() {
  return (
    <div className="relative w-8 flex items-stretch justify-center" aria-hidden>
      {/* Top notch */}
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-background ring-1 ring-border/60" />
      {/* Bottom notch */}
      <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-background ring-1 ring-border/60" />
      {/* The dashed tear */}
      <div
        className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-px"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, color-mix(in srgb, var(--color-foreground) 40%, transparent) 50%, transparent 50%)',
          backgroundSize: '2px 8px',
        }}
      />
    </div>
  );
}

// ─── Addressee row — destination as postal recipient ────────────────────

function AddresseeRow({
  destination,
  active,
  firing,
  onToggle,
  onRemove,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`focus-ring w-full flex items-center gap-2.5 px-2 py-2 rounded-md ring-1 transition-all text-left ${
          active
            ? 'ring-primary/50 bg-primary/[0.08] text-foreground'
            : 'ring-border bg-background/60 text-foreground/55 hover:bg-foreground/[0.02] hover:text-foreground/80'
        }`}
        animate={firing ? { boxShadow: ['0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)', '0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent)'] } : {}}
        transition={firing ? { duration: 0.9, repeat: Infinity, ease: 'easeOut' } : undefined}
      >
        <span
          className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full ring-1 transition-colors ${
            active
              ? 'ring-primary/55 bg-primary/15 text-primary'
              : 'ring-border bg-foreground/[0.03] text-foreground/50'
          }`}
        >
          {destination.kind === 'channel' && destination.meta ? (
            <ConnectorIcon meta={destination.meta} size="w-3.5 h-3.5" />
          ) : destination.icon ? (
            <destination.icon className="w-3.5 h-3.5" />
          ) : null}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`typo-body font-medium truncate block ${active ? 'text-foreground' : 'text-foreground/70'}`}>
            {destination.shortLabel}
          </span>
          {destination.kind === 'channel' && (
            <span className="typo-caption font-mono text-foreground/45 truncate block">
              {destination.label.split(' · ')[1]}
            </span>
          )}
        </span>
        <span
          className={`flex-shrink-0 w-4 h-4 rounded-sm ring-1 transition-colors flex items-center justify-center ${
            active ? 'ring-primary/55 bg-primary/20 text-primary' : 'ring-border bg-background text-foreground/25'
          }`}
        >
          {active && <Check className="w-3 h-3" strokeWidth={3} />}
        </span>
      </motion.button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove this channel from all capabilities"
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ─── Postage stamp — per-event mini visual ───────────────────────────────

function PostageStamp({
  eventType,
  description,
  active,
  firing,
  delay,
}: {
  eventType: string;
  description: string;
  active: boolean;
  firing: boolean;
  delay: number;
}) {
  const kind = classifyEvent(eventType);
  const color = active ? 'var(--color-status-warning)' : 'var(--color-foreground)';
  const voice = eventType.split('.').pop() ?? eventType;
  return (
    <motion.div
      className="relative flex flex-col items-center gap-1 p-1.5 rounded-md ring-1 transition-all"
      style={{
        borderColor: active ? 'var(--color-status-warning)' : undefined,
        background: active
          ? 'color-mix(in srgb, var(--color-status-warning) 10%, transparent)'
          : 'color-mix(in srgb, var(--color-foreground) 3%, transparent)',
      }}
      animate={firing ? { scale: [1, 1.08, 1], rotate: [-1, 1, -1] } : {}}
      transition={firing ? { duration: 0.7, delay, repeat: Infinity, ease: 'easeInOut' } : undefined}
      title={`${eventType} — ${description}`}
    >
      {/* Serrated edge overlay */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-md pointer-events-none"
        style={{
          boxShadow: active
            ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--color-status-warning) 55%, transparent)'
            : 'inset 0 0 0 1px color-mix(in srgb, var(--color-foreground) 18%, transparent)',
        }}
      />
      <div
        className="flex items-center justify-center w-10 h-10 rounded"
        style={{
          color,
          background: active
            ? 'color-mix(in srgb, var(--color-status-warning) 18%, transparent)'
            : 'color-mix(in srgb, var(--color-foreground) 4%, transparent)',
        }}
      >
        <svg viewBox="0 0 20 20" className="w-5 h-5">
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
            <path
              d="M 11 2 L 4 12 L 9 12 L 7 18 L 16 8 L 11 8 L 13 2 Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={0.5}
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-foreground/70 font-semibold">
        {voice}
      </span>
    </motion.div>
  );
}

// ─── Certified seal — bottom-right of address stub ───────────────────────

function CertifiedSeal({ allAddressed, firing }: { allAddressed: boolean; firing: boolean }) {
  return (
    <motion.div
      className="relative w-16 h-16"
      animate={firing ? { rotate: [0, -8, 8, 0] } : { rotate: allAddressed ? -10 : 0 }}
      transition={firing ? { duration: 0.4, repeat: Infinity } : { duration: 0.3 }}
    >
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <defs>
          <path id="seal-arc-top" d="M 12 40 A 28 28 0 0 1 68 40" />
          <path id="seal-arc-bot" d="M 68 40 A 28 28 0 0 1 12 40" />
        </defs>
        <circle
          cx={40}
          cy={40}
          r={30}
          fill="none"
          stroke={allAddressed ? 'var(--color-status-warning)' : 'var(--color-foreground)'}
          strokeOpacity={allAddressed ? 0.55 : 0.25}
          strokeWidth={1.5}
          strokeDasharray={allAddressed ? undefined : '4 4'}
        />
        <circle
          cx={40}
          cy={40}
          r={24}
          fill="none"
          stroke={allAddressed ? 'var(--color-status-warning)' : 'var(--color-foreground)'}
          strokeOpacity={allAddressed ? 0.45 : 0.2}
          strokeWidth={1}
        />
        <text className={allAddressed ? 'fill-status-warning' : 'fill-foreground/35'} style={{ fontSize: 6.5, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.3em' }}>
          <textPath href="#seal-arc-top" startOffset="50%" textAnchor="middle">
            {allAddressed ? 'READY TO SHIP' : 'UNADDRESSED'}
          </textPath>
        </text>
        <text className="fill-foreground/45" style={{ fontSize: 6, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.25em' }}>
          <textPath href="#seal-arc-bot" startOffset="50%" textAnchor="middle">
            CERTIFIED MAIL
          </textPath>
        </text>
        {/* Central glyph */}
        {allAddressed ? (
          <g transform="translate(40 40)">
            <path
              d="M -8 -2 L -2 4 L 8 -6"
              fill="none"
              stroke="var(--color-status-warning)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ) : (
          <g transform="translate(40 40)">
            <circle cx={0} cy={0} r={3} fill="none" stroke="var(--color-foreground)" strokeOpacity={0.35} strokeWidth={1.5} />
            <path d="M 0 -3 L 0 3 M -3 0 L 3 0" stroke="var(--color-foreground)" strokeOpacity={0.3} strokeWidth={1} />
          </g>
        )}
      </svg>
    </motion.div>
  );
}

// ─── "When?" editor opened from the postmark ─────────────────────────────

function WhenEditor({
  trigger,
  availableEvents,
  availableEventKeys,
  activePreset,
  onChange,
}: {
  trigger: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  activePreset: WhenPresetId | null;
  onChange: (next: TriggerSelection) => void;
}) {
  const [advanced, setAdvanced] = useState(activePreset === null);
  return (
    <div className="rounded-lg ring-1 ring-border/70 bg-background/85 p-3 mt-1">
      <div className="flex items-center justify-between mb-2">
        <div className="typo-caption uppercase tracking-[0.2em] text-primary font-semibold">
          PICK A SCHEDULE
        </div>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded typo-caption font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
        >
          <Settings2 className="w-3 h-3" />
          {advanced ? 'Presets' : 'Advanced'}
        </button>
      </div>

      {!advanced ? (
        <div className="grid grid-cols-5 gap-1.5">
          {WHEN_PRESETS.map((p) => {
            const Icon = p.icon;
            const on = activePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.toSelection(trigger, availableEventKeys))}
                className={`focus-ring flex flex-col items-center gap-1 px-2 py-2 rounded-md ring-1 transition-all ${
                  on
                    ? 'ring-primary/55 bg-primary/10 text-foreground'
                    : 'ring-border bg-background text-foreground/70 hover:ring-foreground/30'
                }`}
              >
                <Icon className={`w-4 h-4 ${on ? 'text-primary' : 'text-foreground/55'}`} />
                <span className="font-mono text-[10px] uppercase tracking-wider font-semibold">
                  {p.short}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <AdvancedEditor
          selection={trigger}
          availableEvents={availableEvents}
          availableEventKeys={availableEventKeys}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function AdvancedEditor({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
}: {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
}) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;
  const poweredTime = hasTime(selection);
  const poweredEvent = hasEvent(selection);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-md ring-1 ring-primary/25 bg-primary/[0.04] p-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1 typo-caption font-mono uppercase tracking-wider text-primary">
            <Clock className="w-3 h-3" /> Time
          </div>
          {poweredTime ? (
            <button type="button" onClick={() => onChange(disableTimeFamily(selection))} className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button type="button" onClick={() => onChange(enableTimeFamily(selection))} className="focus-ring inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-primary hover:bg-primary/10 typo-caption">
              <Plus className="w-2.5 h-2.5" /> enable
            </button>
          )}
        </div>
        {poweredTime && (
          <>
            <div className="flex flex-wrap gap-0.5">
              {TIME_PRESETS.map((p) => {
                const Icon = p.icon;
                const on = sub === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onChange(selectionForTimePreset(p.key, selection))}
                    className={`focus-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 typo-caption transition-colors ${
                      on ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'bg-foreground/[0.04] text-foreground/65'
                    }`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {p.label}
                  </button>
                );
              })}
            </div>
            {sub !== 'hourly' && (
              <div className="flex items-center gap-1 typo-caption">
                {sub === 'weekly' && (
                  <div className="flex gap-0.5">
                    {WEEKDAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onChange(updateTime(selection, { weekday: i }))}
                        className={`rounded px-1 py-0.5 font-mono transition-colors ${
                          weekday === i ? 'bg-primary/25 text-primary' : 'text-foreground/55 hover:text-foreground'
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
                  className="focus-ring w-10 rounded ring-1 ring-primary/30 bg-primary/10 px-1 font-mono text-foreground text-center tabular-nums"
                />
                <span className="text-foreground/55 font-mono tabular-nums">:00</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-md ring-1 ring-status-info/25 bg-status-info/[0.04] p-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1 typo-caption font-mono uppercase tracking-wider text-status-info">
            <Zap className="w-3 h-3" /> Event
          </div>
          {poweredEvent ? (
            <button type="button" onClick={() => onChange(disableEventFamily(selection))} className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button type="button" onClick={() => onChange(enableEventFamily(selection, availableEventKeys))} className="focus-ring inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-status-info hover:bg-status-info/10 typo-caption">
              <Plus className="w-2.5 h-2.5" /> enable
            </button>
          )}
        </div>
        {poweredEvent && (
          <ThemedSelect
            filterable
            options={availableEvents.length > 0 ? availableEvents : [{ value: '', label: '(no events)' }]}
            value={selection.event?.eventType ?? ''}
            onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
            placeholder="listen for…"
          />
        )}
      </div>
    </div>
  );
}

// ─── Signal classifier (ported from Forge) ───────────────────────────────

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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
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
      titleId="ticket-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="ticket-preview-title"
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
